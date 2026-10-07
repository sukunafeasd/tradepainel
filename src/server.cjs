"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const packageJson = require("../package.json");
const { MarketClient } = require("./engine/market-client.cjs");
const { RealtimeHub } = require("./engine/realtime-hub.cjs");
const { analyze, combineTimeframes, applyMtfGate } = require("./engine/analysis.cjs");
const { AlertsStore, JournalStore } = require("./engine/paper.cjs");
const { ExpirySimulator } = require("./engine/expiry-simulator.cjs");
const { AiReader } = require("./engine/ai-reader.cjs");
const { AdaptiveCalibrator } = require("./engine/adaptive-calibration.cjs");
const { ExchangeClock } = require("./engine/clock.cjs");
const { SignalLifecycleStore } = require("./engine/signal-lifecycle.cjs");
const { assessEntry } = require("./engine/entry-assessment.cjs");
const { AppError, cleanSymbol, cleanInterval, cleanLimit, plainObject, validateMarketDatum, ENTRY_PRICE_MAX_AGE_MS } = require("./engine/contracts.cjs");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function createSseWriter(res, { maxQueue = 256 } = {}) {
  const coalescible = new Set(["snapshot", "market", "coins", "ping"]);
  const queue = []; let blocked = false; let closed = false; let overflowed = false;
  const encode = (type, data) => type === "ping" ? ": ping\n\n" : `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const close = () => { closed = true; queue.length = 0; res.off?.("drain", flush); };
  const flush = () => {
    if (closed || res.destroyed) return;
    blocked = false;
    while (queue.length && !blocked) { const item = queue.shift(); blocked = !res.write(item.chunk); }
  };
  const send = (type, data = null) => {
    if (closed || res.destroyed) return false;
    const chunk = encode(type, data);
    if (!blocked && queue.length === 0) { blocked = !res.write(chunk); return !blocked; }
    if (coalescible.has(type)) {
      const existing = queue.findLastIndex?.((item) => item.type === type) ?? -1;
      if (existing >= 0) queue[existing] = { type, chunk }; else queue.push({ type, chunk });
    } else queue.push({ type, chunk });
    while (queue.length > maxQueue) {
      const expendable = queue.findIndex((item) => coalescible.has(item.type));
      if (expendable < 0) break;
      queue.splice(expendable, 1);
    }
    if (queue.length > maxQueue) {
      overflowed = true;
      close();
      if (typeof res.destroy === "function") res.destroy(); else res.end?.();
    }
    return false;
  };
  res.on("drain", flush);
  return { send, close, diagnostics: () => ({ blocked, queued: queue.length, closed, overflowed }) };
}

function createServer({ dataDirectory, uiDirectory, credentialStore, market = null, realtime = null, logger = console } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const clock = market?.clock || realtime?.clock || new ExchangeClock();
  const marketClient = market || new MarketClient({ clock });
  const live = realtime || new RealtimeHub({ clock });
  const calibrator = new AdaptiveCalibrator(dataDirectory, { now: () => clock.now() });
  const analysisCache = new Map();
  const latestFinalAnalysis = new Map();
  const analysisById = new Map();
  const paper = new ExpirySimulator(dataDirectory, { now: () => clock.now(), onSettled: (trades) => { calibrator.recordSettled(trades); analysisCache.clear(); } });
  const alerts = new AlertsStore(dataDirectory, { now: () => clock.now() });
  const journal = new JournalStore(dataDirectory, { now: () => clock.now() });
  const lifecycle = new SignalLifecycleStore(dataDirectory, { now: () => clock.now() });
  const ai = new AiReader(credentialStore, { now: () => clock.now(), dataDirectory });
  const sseResponses = new Set();
  const rate = new Map();
  const analysisAlertSchedule = new Map();
  let server;
  let selectionRevision = 0;
  let settlementTimer = null;
  let alertMonitorTimer = null;
  let settlementRunning = false;
  let shadowSettlementRunning = false;
  let alertMonitorRunning = false;
  let listening = false;
  const alertMonitorMetrics = { targetsActive: 0, targetsQueued: 0, oldestCheckAgeMs: 0, averageCheckIntervalMs: 0, maxCheckLagMs: 0, monitorCycleMs: 0, checks: 0, lastChecks: new Map() };

  const ALERT_ANALYSIS_INTERVAL_MS = 15000;
  const ALERT_ANALYSIS_RETRY_MS = 5000;
  const ALERT_ANALYSIS_BATCH = 12;
  const ALERT_ANALYSIS_CONCURRENCY = 4;

  const log = (level, event, details = {}) => { try { (logger[level] || logger.log).call(logger, JSON.stringify({ level, event, at: clock.now(), ...details })); } catch {} };
  const origin = () => `http://127.0.0.1:${server?.address()?.port || 0}`;
  const securityHeaders = (contentType = null) => ({ ...(contentType ? { "Content-Type": contentType } : {}), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  const json = (res, status, value) => { const payload = JSON.stringify(value); res.writeHead(status, { ...securityHeaders("application/json; charset=utf-8"), "Content-Length": Buffer.byteLength(payload) }); res.end(payload); };
  const text = (res, status, value, contentType = "text/plain; charset=utf-8", extraHeaders = {}) => { const payload = String(value); res.writeHead(status, { ...securityHeaders(contentType), ...extraHeaders, "Content-Length": Buffer.byteLength(payload) }); res.end(payload); };
  const publicError = (error) => error instanceof AppError ? error.publicMessage : error?.name === "StorageError" ? "Falha ao acessar os dados locais. Consulte o diagnóstico." : "O DiefTrade encontrou uma falha interna. Tente novamente.";
  const fail = (res, status, error, code = null) => json(res, status, { error: error instanceof AppError ? error.publicMessage : typeof error === "string" ? error : publicError(error), code: code || error?.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR") });

  const authorize = (req, url, { allowQuery = false } = {}) => {
    const presented = req.headers["x-dief-token"] || (allowQuery ? url.searchParams.get("t") : "") || "";
    const expected = Buffer.from(token); const received = Buffer.from(String(presented));
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return false;
    const requestOrigin = req.headers.origin;
    return !requestOrigin || requestOrigin === origin();
  };

  const enforceRate = (req) => {
    const key = req.socket.remoteAddress || "local"; const now = performance.now(); const entry = rate.get(key) || { start: now, count: 0 };
    if (now - entry.start > 60000) { entry.start = now; entry.count = 0; }
    entry.count += 1; rate.set(key, entry);
    if (entry.count > 360) throw new AppError("Muitas solicitações locais. Aguarde um instante.", { status: 429, code: "RATE_LIMIT" });
  };

  const body = (req, limit = 128 * 1024) => new Promise((resolve, reject) => {
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return reject(new AppError("Use Content-Type application/json.", { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" }));
    const chunks = []; let size = 0; let tooLarge = false;
    req.on("data", (chunk) => { size += chunk.length; if (size > limit) { tooLarge = true; return; } chunks.push(chunk); });
    req.on("end", () => {
      if (tooLarge) return reject(new AppError("Conteúdo grande demais.", { status: 413, code: "PAYLOAD_TOO_LARGE" }));
      if (!chunks.length) return resolve({});
      try { resolve(plainObject(JSON.parse(Buffer.concat(chunks).toString("utf8")))); }
      catch (error) { reject(error instanceof AppError ? error : new AppError("JSON inválido.", { status: 400, code: "INVALID_JSON", cause: error })); }
    });
    req.on("error", (error) => reject(new AppError("Falha ao receber o conteúdo.", { status: 400, code: "BODY_READ_FAILED", cause: error })));
  });

  const microSnapshot = () => {
    const snapshot = live.snapshot(); const items = [snapshot.freshness?.ticker, snapshot.freshness?.book, snapshot.freshness?.flow]; const ageMs = items.every(Boolean) ? Math.max(...items.map((item) => Number(item.ageMs) || 0)) : Infinity;
    return { stale: snapshot.stale || items.some(item => !item || item.stale) || Boolean(snapshot.freshness?.quote?.stale), ageMs, spreadPct: snapshot.ticker?.spreadPct, bookImbalance: snapshot.book?.imbalance, buyRatio: snapshot.flow?.buyRatio, delta: snapshot.flow?.delta, deltaQuote: snapshot.flow?.deltaQuote };
  };

  const cacheSet = (key, value) => { analysisCache.set(key, { expiresAtMono: performance.now() + 4000, value: structuredClone(value) }); while (analysisCache.size > 250) analysisCache.delete(analysisCache.keys().next().value); };
  const setLatestAnalysis = (key, value) => {
    if (latestFinalAnalysis.has(key)) latestFinalAnalysis.delete(key);
    latestFinalAnalysis.set(key, { savedAtMono: performance.now(), value: structuredClone(value) });
    while (latestFinalAnalysis.size > 250) latestFinalAnalysis.delete(latestFinalAnalysis.keys().next().value);
    if (value?.id) { if (analysisById.has(value.id)) analysisById.delete(value.id); analysisById.set(value.id, { savedAtMono: performance.now(), value: structuredClone(value) }); while (analysisById.size > 500) analysisById.delete(analysisById.keys().next().value); }
  };
  const processFinalAnalysis = async (value) => {
    let datum = priceDatums()[value.symbol];
    if (!datum) { try { datum = (await marketClient.ticker(value.symbol, { force: true })).datum; } catch {} }
    const evaluated = lifecycle.evaluate(value, datum, clock.now());
    const final = { ...value, signalLifecycle: evaluated.current,entryAssessment:assessEntry(value,evaluated.current,datum,clock.now(),currentQuote(value.symbol)) };
    setLatestAnalysis(`${final.symbol}|${final.interval}`, final);
    for (const event of evaluated.events) {
      live.publish?.(event.type, event);
      if (event.type === "signal-confirmed") {
        try { calibrator.observeConfirmedSignal?.(evaluated.current, final); } catch (error) { log("warn", "shadow_calibration_observe_failed", { signalId: event.signalId, message: error.message }); }
        alerts.checkSignalEvent?.(event).forEach((alert) => live.publish?.("alert", alert));
      }
    }
    alerts.checkAnalysis(final).forEach((alert) => live.publish?.("alert", alert));
    return final;
  };
  const mapLimited = async (items, concurrency, worker) => {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) { const index = cursor; cursor += 1; await worker(items[index], index); }
    }));
  };
  const getAnalysis = async (symbol, interval, { force = false, micro = null } = {}) => {
    const clean = cleanSymbol(symbol); const frame = cleanInterval(interval); const key = `${clean}|${frame}`; const cached = analysisCache.get(key);
    if (!force && cached && performance.now() < cached.expiresAtMono) return structuredClone(cached.value);
    if (cached && performance.now() >= cached.expiresAtMono) analysisCache.delete(key);
    const candles = await marketClient.klines(clean, frame, 500, { force });
    const portfolio = paper.snapshot(live.priceDatums?.() || {}, clock.now());
    const value = analyze(candles, { symbol: clean, interval: frame, micro: micro ?? (clean === live.symbol ? microSnapshot() : { stale: true }), account: portfolio.balance, calibration: calibrator.profile({ symbol: clean, interval: frame }), now: clock.now() });
    cacheSet(key, value); return structuredClone(value);
  };

  const confluenceFrames = (mainInterval) => mainInterval === "1d" ? ["15m", "1h", "4h", "1d"] : ["1m", "5m", "15m", "1h", "4h"];
  const getConfluence = async (symbol, mainInterval = "15m", force = false) => {
    const frames = confluenceFrames(mainInterval);
    const settled = await Promise.allSettled(frames.map(async (frame) => [frame, await getAnalysis(symbol, frame, { force, micro: { stale: true } })]));
    const results = {};
    settled.forEach((item, index) => { const frame = frames[index]; results[frame] = item.status === "fulfilled" ? item.value[1] : { error: item.reason?.message || "falha" }; });
    return combineTimeframes(results, { expectedFrames: frames });
  };

  const priceDatums = () => live.priceDatums?.({ maxAgeMs: 5000 }) || {};
  const currentQuote = symbol => {
    const snapshot=live.snapshot(),fresh=snapshot.freshness?.quote;
    if(snapshot.symbol!==symbol||!fresh||fresh.stale||!snapshot.connected)return null;
    return {symbol,bid:snapshot.ticker?.bid,ask:snapshot.ticker?.ask,receivedAt:fresh.receivedAt,stale:false};
  };

  async function settleDue() {
    if (!listening || settlementRunning) return [];
    const due = paper.due(clock.now()); if (!due.length) return [];
    settlementRunning = true;
    const resolutions = {};
    try {
      await Promise.all(due.map(async (trade) => {
        const realtimeDatum = live.datumAt?.(trade.symbol, trade.expiresAt, 1500);
        if (realtimeDatum) { resolutions[trade.id] = realtimeDatum; return; }
        try { const historical = await marketClient.priceAt(trade.symbol, trade.expiresAt, { toleranceMs: 1500 }); if (historical) resolutions[trade.id] = historical; }
        catch (error) { log("warn", "settlement_price_unavailable", { tradeId: trade.id, symbol: trade.symbol, message: error.message }); }
      }));
      const settled = paper.settleResolved(resolutions, clock.now());
      for (const trade of settled) live.publish?.("paper-result", trade);
      return settled;
    } finally { settlementRunning = false; }
  }

  async function settleShadowDue() {
    if (!listening || shadowSettlementRunning || typeof calibrator.shadowDue !== "function") return [];
    const due = calibrator.shadowDue(clock.now(), 50); if (!due.length) return [];
    shadowSettlementRunning = true;
    const resolutions = {};
    try {
      await mapLimited(due, 4, async (observation) => {
        const realtimeDatum = live.datumAt?.(observation.symbol, observation.dueAt, 1500);
        if (realtimeDatum) { resolutions[observation.id] = realtimeDatum; return; }
        try { const historical = await marketClient.priceAt(observation.symbol, observation.dueAt, { toleranceMs: 1500 }); if (historical) resolutions[observation.id] = historical; }
        catch (error) { log("warn", "shadow_calibration_price_unavailable", { observationId: observation.id, symbol: observation.symbol, interval: observation.interval, message: error.message }); }
      });
      const settled = calibrator.settleShadow(resolutions, clock.now());
      if (settled.some((item) => item.status === "settled")) analysisCache.clear();
      return settled;
    } finally { shadowSettlementRunning = false; }
  }

  async function monitorAnalysisAlerts() {
    const cycleStarted = performance.now();
    if (!listening || alertMonitorRunning) return;
    const targets = alerts.analysisTargets();
    const activeKeys = new Set(targets.map(({ symbol, interval }) => `${symbol}|${interval}`));
    alertMonitorMetrics.targetsActive = targets.length;
    for (const key of analysisAlertSchedule.keys()) if (!activeKeys.has(key)) analysisAlertSchedule.delete(key);
    if (!targets.length) return;
    const nowMono = performance.now();
    for (const target of targets) { const key = `${target.symbol}|${target.interval}`; if (!analysisAlertSchedule.has(key)) analysisAlertSchedule.set(key, { nextCheckAtMono: 0, failures: 0 }); }
    const due = targets.filter((target) => Number(analysisAlertSchedule.get(`${target.symbol}|${target.interval}`)?.nextCheckAtMono || 0) <= nowMono).sort((left, right) => Number(analysisAlertSchedule.get(`${left.symbol}|${left.interval}`)?.nextCheckAtMono || 0) - Number(analysisAlertSchedule.get(`${right.symbol}|${right.interval}`)?.nextCheckAtMono || 0)).slice(0, ALERT_ANALYSIS_BATCH);
    alertMonitorMetrics.targetsQueued = targets.filter((target) => Number(analysisAlertSchedule.get(`${target.symbol}|${target.interval}`)?.nextCheckAtMono || 0) <= nowMono).length;
    const lags = targets.map((target) => Math.max(0, nowMono - Number(analysisAlertSchedule.get(`${target.symbol}|${target.interval}`)?.nextCheckAtMono || nowMono)));
    alertMonitorMetrics.oldestCheckAgeMs = lags.length ? Math.round(Math.max(...lags)) : 0;
    alertMonitorMetrics.maxCheckLagMs = Math.max(alertMonitorMetrics.maxCheckLagMs, alertMonitorMetrics.oldestCheckAgeMs);
    if (!due.length) return;
    alertMonitorRunning = true;
    try {
      await mapLimited(due, ALERT_ANALYSIS_CONCURRENCY, async ({ symbol, interval }) => {
        const key = `${symbol}|${interval}`;
        try {
          const base = await getAnalysis(symbol, interval); const final = await processFinalAnalysis(applyMtfGate(base, await getConfluence(symbol, interval)));
          const last = alertMonitorMetrics.lastChecks.get(key); if (last) alertMonitorMetrics.averageCheckIntervalMs = alertMonitorMetrics.averageCheckIntervalMs ? Math.round((alertMonitorMetrics.averageCheckIntervalMs * 0.8) + ((performance.now() - last) * 0.2)) : Math.round(performance.now() - last); alertMonitorMetrics.lastChecks.set(key, performance.now()); alertMonitorMetrics.checks += 1;
          analysisAlertSchedule.set(key, { nextCheckAtMono: performance.now() + ALERT_ANALYSIS_INTERVAL_MS, failures: 0 });
        } catch (error) {
          const failures = Number(analysisAlertSchedule.get(key)?.failures || 0) + 1;
          analysisAlertSchedule.set(key, { nextCheckAtMono: performance.now() + Math.min(ALERT_ANALYSIS_INTERVAL_MS, ALERT_ANALYSIS_RETRY_MS * failures), failures });
          log("warn", "alert_monitor_failed", { symbol, interval, failures, message: error.message });
        }
      });
    } finally { alertMonitorRunning = false; alertMonitorMetrics.monitorCycleMs = Math.round(performance.now() - cycleStarted); }
  }

  const syncAlertPriceSubscriptions = () => live.watchPriceSymbols?.(alerts.priceSymbols());
  const dispatchPriceAlerts = (datum) => {
    const hits = alerts.checkPrice(datum);
    hits.forEach((alert) => live.publish?.("alert", alert));
    if (hits.length) syncAlertPriceSubscriptions();
  };
  const onPrice = (datum) => {
    paper.updatePrices({ [datum.symbol]: datum }, clock.now());
    dispatchPriceAlerts(datum);
  };
  const onMarketPrice = (datum) => dispatchPriceAlerts(datum);
  const onAlertPrice = (datum) => dispatchPriceAlerts(datum);
  live.on?.("price", onPrice);
  live.on?.("market-price", onMarketPrice);
  live.on?.("alert-price", onAlertPrice);
  live.on?.("warning", (error) => log("warn", "realtime_warning", { message: error.message }));

  async function api(req, res, url) {
    const pathname = url.pathname;
    const allowQuery = pathname === "/api/live/stream";
    if (!authorize(req, url, { allowQuery })) return fail(res, 401, "Sessão local inválida.", "UNAUTHORIZED");
    enforceRate(req);
    if (pathname !== "/api/live/stream" && url.searchParams.has("t")) return fail(res, 400, "Token por URL só é aceito no fluxo SSE.", "QUERY_TOKEN_NOT_ALLOWED");

    if (pathname === "/api/health/liveness" || pathname === "/api/health") {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      const snapshot = live.snapshot();
      const paperDiagnostics = paper.store.diagnostics(); const archiveDiagnostics = paper.archive?.diagnostics?.() || { issues: [] };
      return json(res, 200, { ok: true, version: packageJson.version, uptimeSeconds: Math.round(process.uptime()), live: snapshot, market: marketClient.status(), ai: { ...credentialStore.status(), telemetry: ai.telemetry() }, calibration: calibrator.status(), signalLifecycle: lifecycle.health(), alertMonitor: { activeTargets: alerts.analysisTargets().length, scheduledTargets: analysisAlertSchedule.size, batchSize: ALERT_ANALYSIS_BATCH, concurrency: ALERT_ANALYSIS_CONCURRENCY, ...Object.fromEntries(Object.entries(alertMonitorMetrics).filter(([key]) => key !== "lastChecks")) }, memory: { rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }, clock: clock.status(), persistence: { paper: { ...paperDiagnostics, archive: archiveDiagnostics, issues: [...(paperDiagnostics.issues || []), ...(archiveDiagnostics.issues || [])] }, alerts: alerts.store.diagnostics(), journal: journal.store.diagnostics(), calibration: calibrator.store?.diagnostics?.() || { issues: [] }, signals: lifecycle.store.diagnostics() }, safety: { realOrders: false, publicMarketDataOnly: true } });
    }
    if (pathname === "/api/health/readiness") {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      const snapshot = live.snapshot(); const ready = Boolean(snapshot.connected && !snapshot.stale && Object.keys(priceDatums()).length);
      return json(res, ready ? 200 : 503, { ok: ready, ready, live: { connected: snapshot.connected, stale: snapshot.stale, freshness: snapshot.freshness }, lastMarketSuccessAt: marketClient.status().lastSuccessAt });
    }
    if (pathname === "/api/bootstrap") {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      let coins = live.marketSnapshot();
      try { const rest = await marketClient.topPairs("USDT", 220); coins = [...new Map([...rest, ...coins].map((item) => [item.symbol, item])).values()].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 220); }
      catch (error) { log("warn", "bootstrap_rest_degraded", { message: error.message }); }
      return json(res, 200, { degraded: !coins.length, coins, selected: { symbol: live.symbol, interval: live.interval }, paper: paper.snapshot(priceDatums(), clock.now()), alerts: alerts.list(), journal: journal.page({ limit: 25 }), ai: credentialStore.status(), calibration: calibrator.status(), signals: lifecycle.current() });
    }
    if (pathname === "/api/coins") {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      const limit = cleanLimit(url.searchParams.get("limit"), 180, 500); let coins = live.marketSnapshot(limit);
      try { const rest = await marketClient.topPairs("USDT", limit); coins = [...new Map([...rest, ...coins].map((item) => [item.symbol, item])).values()].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, limit); } catch (error) { if (!coins.length) throw error; }
      return json(res, 200, coins);
    }
    if (pathname === "/api/live/select") {
      if (req.method !== "POST") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      const input = await body(req); const symbol = cleanSymbol(input.symbol); const interval = cleanInterval(input.interval);
      const revision = ++selectionRevision;
      if (marketClient.assertTradable) await marketClient.assertTradable(symbol);
      if (revision !== selectionRevision) return fail(res, 409, "Seleção substituída por uma alteração mais recente.", "SELECTION_SUPERSEDED");
      live.select(symbol, interval); analysisCache.clear(); return json(res, 200, { ok: true, symbol, interval, generation: live.symbolGeneration });
    }
    if (pathname === "/api/live/stream") {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      req.socket.setNoDelay(true);
      res.writeHead(200, { ...securityHeaders("text/event-stream; charset=utf-8"), Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      const writer = createSseWriter(res); writer.send("ready", { symbol: live.symbol, interval: live.interval, localConnected: true });
      const remove = live.addClient((event) => writer.send(event.type, event.data));
      const keepAlive = setInterval(() => writer.send("ping"), 12000); const entry = { res, remove, keepAlive, writer }; sseResponses.add(entry);
      req.on("close", () => { clearInterval(keepAlive); remove(); writer.close(); sseResponses.delete(entry); }); return;
    }

    let match;
    if ((match = pathname.match(/^\/api\/klines\/([A-Za-z0-9]+)$/))) {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      return json(res, 200, await marketClient.klines(cleanSymbol(match[1]), cleanInterval(url.searchParams.get("interval")), cleanLimit(url.searchParams.get("limit"), 500, 1000)));
    }
    if ((match = pathname.match(/^\/api\/analysis\/([A-Za-z0-9]+)$/))) {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      const symbol = cleanSymbol(match[1]); const interval = cleanInterval(url.searchParams.get("interval")); const force = url.searchParams.get("force") === "1";
      const base = await getAnalysis(symbol, interval, { force }); const mtf = await getConfluence(symbol, interval, force); const final = await processFinalAnalysis(applyMtfGate(base, mtf));
      return json(res, 200, final);
    }
    if ((match = pathname.match(/^\/api\/confluence\/([A-Za-z0-9]+)$/))) {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      return json(res, 200, await getConfluence(cleanSymbol(match[1]), cleanInterval(url.searchParams.get("interval") || live.interval)));
    }
    if(pathname==='/api/signals/entry'&&req.method==='GET'){
      const symbol=cleanSymbol(url.searchParams.get('symbol')),interval=cleanInterval(url.searchParams.get('interval'));
      const analysis=latestFinalAnalysis.get(`${symbol}|${interval}`)?.value;
      return json(res,200,assessEntry(analysis,lifecycle.get(symbol,interval),priceDatums()[symbol],clock.now(),currentQuote(symbol)));
    }
    if (pathname === "/api/paper" && req.method === "GET") return json(res, 200, paper.snapshot(priceDatums(), clock.now()));
    if (pathname === "/api/paper/order" && req.method === "POST") {
      const input = await body(req); const symbol = cleanSymbol(input.symbol); const interval = cleanInterval(input.interval);
      const savedReading = latestFinalAnalysis.get(`${symbol}|${interval}`);
      const reading = savedReading && performance.now() - savedReading.savedAtMono <= 60_000 ? structuredClone(savedReading.value) : null;
      // A abertura não espera uma análise de rede: usa a última leitura visível, quando
      // recente, e captura a cotação autoritativa no exato momento da confirmação.
      let datum = priceDatums()[symbol];
      const candidate = validateMarketDatum(datum, { symbol, maxAgeMs: ENTRY_PRICE_MAX_AGE_MS, now: clock.now() });
      if (!candidate || candidate.stale) { const ticker = await marketClient.ticker(symbol, { force: true }); datum = ticker.datum; }
      const signal = lifecycle.get(symbol, interval);
      if (input.signalId && signal?.signalId !== input.signalId) throw new AppError("O sinal selecionado não é mais o sinal atual. Atualize a leitura.", { status: 409, code: "SIGNAL_MISMATCH" });
      const trade = paper.place({ ...input, symbol, interval, entryDatum: datum, entryPrice: undefined, analysisSnapshot: AdaptiveCalibrator.snapshot(reading), signalContext: signal?.signalId ? { signalId: signal.signalId, signalConfirmedAt: signal.confirmedAt, signalConfirmedPrice: signal.confirmedPrice, signalAgeAtOrder: Math.max(0, clock.now() - Number(signal.confirmedAt)), analysisId: reading?.id || null } : null, idempotencyKey: req.headers["idempotency-key"] || input.idempotencyKey, now: clock.now() });
      await paper.flushPersistence?.();
      return json(res, 201, { trade, confirmedEntryPrice: trade.entryPrice, confirmedEntryPriceAt: trade.entryPriceAt, portfolio: paper.snapshot(priceDatums(), clock.now()) });
    }
    if (pathname === "/api/paper/reset" && req.method === "POST") { const input = await body(req); if (input.confirm !== true) throw new AppError("Confirme a exclusão do histórico do simulador.", { status: 409, code: "CONFIRM_REQUIRED" }); await paper.flushPersistence?.(); const snapshot = paper.reset(10000); await paper.flushPersistence?.(); return json(res, 200, snapshot); }
    if (pathname === "/api/paper/settings" && req.method === "POST") { paper.settings(await body(req)); await paper.flushPersistence?.(); return json(res, 200, paper.snapshot(priceDatums(), clock.now())); }
    if (pathname === "/api/paper/export" && req.method === "GET") {
      const rows = (paper.allResults?.() || paper.store.value.results.slice()).reverse(); const history = paper.historyDetails?.() || { complete: true, unavailable: 0 }; const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`; const header = ["abertura", "expiracao", "liquidacao", "par", "tempo", "direcao", "valor", "entrada", "saida", "resultado", "lucro", "nota", "sinal_painel", "confianca"];
      const lines = rows.map((trade) => [trade.openedAt, trade.expiresAt, trade.settledAt, trade.symbol, trade.interval, trade.direction, trade.stake, trade.entryPrice, trade.exitPrice, trade.result, trade.profit, trade.note, trade.analysisSnapshot?.signal, trade.analysisSnapshot?.confidence].map(quote).join(","));
      return text(res, 200, `\uFEFF${header.join(",")}\n${lines.join("\n")}`, "text/csv; charset=utf-8", { "Content-Disposition": "attachment; filename=historico-dieftrade.csv", "X-Dief-History-Complete": history.complete ? "1" : "0", "X-Dief-History-Unavailable": String(history.unavailable || 0) });
    }
    if (pathname === "/api/alerts" && req.method === "GET") return json(res, 200, alerts.list());
    if (pathname === "/api/alerts" && req.method === "POST") { const input = await body(req); const symbol = cleanSymbol(input.symbol); if (marketClient.assertTradable) await marketClient.assertTradable(symbol); const created = alerts.add({ ...input, symbol, interval: input.interval || live.interval, currentDatum: priceDatums()[symbol] }); await alerts.flushPersistence(); syncAlertPriceSubscriptions(); void monitorAnalysisAlerts(); return json(res, 201, created); }
    if ((match = pathname.match(/^\/api\/alerts\/([a-f0-9]+)$/)) && req.method === "DELETE") { const removed = alerts.remove(match[1]); if (removed) { await alerts.flushPersistence(); syncAlertPriceSubscriptions(); } return removed ? json(res, 200, { ok: true, removed: true }) : fail(res, 404, "Alerta não encontrado.", "NOT_FOUND"); }
    if (pathname === "/api/journal" && req.method === "GET") return json(res, 200, journal.page({ offset: Math.max(0, Number(url.searchParams.get("offset")) || 0), limit: cleanLimit(url.searchParams.get("limit"), 25, 100), query: url.searchParams.get("q") || "" }));
    if (pathname === "/api/journal" && req.method === "POST") { const input = await body(req); const symbol = cleanSymbol(input.symbol); if (marketClient.assertTradable) await marketClient.assertTradable(symbol); const created = journal.add({ ...input, symbol }); await journal.flushPersistence(); return json(res, 201, created); }
    if ((match = pathname.match(/^\/api\/journal\/([a-f0-9]+)$/)) && req.method === "DELETE") { const removed = journal.remove(match[1]); if (removed) await journal.flushPersistence(); return removed ? json(res, 200, { ok: true, removed: true }) : fail(res, 404, "Anotação não encontrada.", "NOT_FOUND"); }
    if (pathname === "/api/ai/config" && req.method === "GET") return json(res, 200, credentialStore.status());
    if (pathname === "/api/ai/config" && req.method === "POST") {
      const input = await body(req); const temporary = { load: () => ({ apiKey: String(input.apiKey || "").trim(), provider: input.provider, model: input.model }), status: () => ({ stored: true, operational: true }) };
      const diagnostic = await new AiReader(temporary, { cooldownMs: 0, dailyLimit: 2 }).diagnose(); return json(res, 200, { ...credentialStore.save(input), diagnostic });
    }
    if (pathname === "/api/ai/config" && req.method === "DELETE") return json(res, 200, credentialStore.remove());
    if (pathname === "/api/ai/test" && req.method === "POST") { await body(req); return json(res, 200, await ai.diagnose()); }
    if (pathname === "/api/ai/read" && req.method === "POST") {
      const input = await body(req); const symbol = cleanSymbol(input.symbol); const interval = cleanInterval(input.interval); const analysisId = String(input.analysisId || "");
      if (!analysisId) throw new AppError("Atualize a leitura antes de pedir a IA.", { status: 409, code: "AI_ANALYSIS_ID_REQUIRED" });
      const stored = analysisById.get(analysisId); const analysis = stored && performance.now() - stored.savedAtMono <= 30_000 ? structuredClone(stored.value) : null;
      if (!analysis) throw new AppError("A análise exibida expirou. Atualize-a e tente novamente.", { status: 409, code: "AI_ANALYSIS_STALE" });
      if (analysis.symbol !== symbol || analysis.interval !== interval) throw new AppError("A análise não pertence ao par e timeframe exibidos.", { status: 409, code: "AI_ANALYSIS_MISMATCH" });
      if (Number(analysis.dataQuality?.score || 0) < 60) throw new AppError("Os dados desta análise não têm qualidade ou atualidade suficiente para a IA.", { status: 409, code: "AI_ANALYSIS_LOW_QUALITY" });
      return json(res, 200, await ai.read(analysis));
    }
    if (pathname === "/api/signals/current" && req.method === "GET") return json(res, 200, lifecycle.current({ symbol: url.searchParams.get("symbol") || null, interval: url.searchParams.get("interval") || null }));
    if (pathname === "/api/signals/history" && req.method === "GET") return json(res, 200, lifecycle.history({ symbol: url.searchParams.get("symbol") || null, interval: url.searchParams.get("interval") || null, direction: url.searchParams.get("direction") || null, from: url.searchParams.get("from"), to: url.searchParams.get("to"), limit: cleanLimit(url.searchParams.get("limit"), 200, 1000) }));
    if (pathname === "/api/calibration" && req.method === "GET") return json(res, 200, calibrator.status());
    if (pathname === "/api/calibration/reset" && req.method === "POST") { const input = await body(req); if (input.confirm !== true) throw new AppError("Confirme a limpeza da calibração.", { status: 409, code: "CONFIRM_REQUIRED" }); analysisCache.clear(); await calibrator.flushPersistence?.(); const status = calibrator.reset(); await calibrator.flushPersistence?.(); return json(res, 200, status); }
    return fail(res, 404, "Rota não encontrada.", "NOT_FOUND");
  }

  function staticFile(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
    let requested;
    try { requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); } catch { return fail(res, 400, "Caminho inválido.", "INVALID_PATH"); }
    const base = path.resolve(uiDirectory); const file = path.resolve(base, `.${requested}`);
    if (file !== base && !file.startsWith(base + path.sep)) return fail(res, 403, "Caminho inválido.", "FORBIDDEN");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, "Arquivo não encontrado.", "NOT_FOUND");
    const stat = fs.statSync(file); res.writeHead(200, { ...securityHeaders(MIME[path.extname(file).toLowerCase()] || "application/octet-stream"), "Cache-Control": path.extname(file) === ".html" ? "no-store" : "public, max-age=3600", "Content-Length": stat.size }); if (req.method === "HEAD") return res.end(); fs.createReadStream(file).on("error", (error) => { log("error", "static_read_failed", { message: error.message }); res.destroy(); }).pipe(res);
  }

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) await api(req, res, url); else staticFile(req, res, url);
    } catch (error) {
      if (!listening) { if (!res.writableEnded) res.end(); return; }
      const status = error instanceof AppError ? error.status : 500;
      if (status >= 500) log("error", "request_failed", { method: req.method, path: String(req.url || "").split("?")[0], message: error.message, stack: error.stack?.split("\n").slice(0, 4).join(" | ") });
      if (!res.headersSent) fail(res, status, error); else res.end();
    }
  });

  return {
    token, live, market: marketClient, clock, paper, alerts, journal, calibrator, lifecycle, ai,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", async () => {
          server.removeListener("error", reject); listening = true;
          try { await marketClient.syncClock?.(); } catch (error) { log("warn", "clock_sync_failed", { message: error.message }); }
          live.start(); syncAlertPriceSubscriptions(); settlementTimer = setInterval(() => { paper.updatePrices(priceDatums(), clock.now()); void settleDue(); void settleShadowDue(); }, 1000); settlementTimer.unref?.(); alertMonitorTimer = setInterval(() => void monitorAnalysisAlerts(), 2500); alertMonitorTimer.unref?.(); void settleDue(); void settleShadowDue(); void monitorAnalysisAlerts(); resolve({ port: server.address().port, token });
        });
      });
    },
    async close() {
      listening = false; if (settlementTimer) clearInterval(settlementTimer); if (alertMonitorTimer) clearInterval(alertMonitorTimer); settlementTimer = null; alertMonitorTimer = null;
      live.off?.("price", onPrice); live.off?.("market-price", onMarketPrice); live.off?.("alert-price", onAlertPrice); live.close(); marketClient.close?.();
      for (const entry of sseResponses) { clearInterval(entry.keepAlive); entry.remove(); entry.writer?.close(); try { entry.res.end(); } catch {} } sseResponses.clear();
      const persistenceFlushes = await Promise.allSettled([paper.flushPersistence?.(), alerts.flushPersistence?.(), journal.flushPersistence?.(), calibrator.flushPersistence?.(), lifecycle.flushPersistence?.(), ai.flushPersistence?.()]);
      persistenceFlushes.filter((item) => item.status === "rejected").forEach((item) => log("error", "persistence_flush_failed", { message: item.reason?.message || "Falha ao esvaziar fila" }));
      if (!server.listening) return;
      await new Promise((resolve) => {
        const force = setTimeout(() => { server.closeAllConnections?.(); resolve(); }, 1500);
        force.unref?.();
        server.close(() => { clearTimeout(force); resolve(); });
        server.closeIdleConnections?.();
      });
    },
  };
}

module.exports = { createServer, createSseWriter };
