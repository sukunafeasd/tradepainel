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
const { AppError, cleanSymbol, cleanInterval, cleanLimit, plainObject } = require("./engine/contracts.cjs");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function createServer({ dataDirectory, uiDirectory, credentialStore, market = null, realtime = null, logger = console } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const clock = market?.clock || realtime?.clock || new ExchangeClock();
  const marketClient = market || new MarketClient({ clock });
  const live = realtime || new RealtimeHub({ clock });
  const calibrator = new AdaptiveCalibrator(dataDirectory, { now: () => clock.now() });
  const analysisCache = new Map();
  const latestFinalAnalysis = new Map();
  const paper = new ExpirySimulator(dataDirectory, { now: () => clock.now(), onSettled: (trades) => { calibrator.recordSettled(trades); analysisCache.clear(); } });
  const alerts = new AlertsStore(dataDirectory, { now: () => clock.now() });
  const journal = new JournalStore(dataDirectory, { now: () => clock.now() });
  const ai = new AiReader(credentialStore, { now: () => clock.now() });
  const sseResponses = new Set();
  const rate = new Map();
  let server;
  let settlementTimer = null;
  let settlementRunning = false;
  let listening = false;

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
    const snapshot = live.snapshot(); const items = [snapshot.freshness?.ticker, snapshot.freshness?.book, snapshot.freshness?.flow].filter(Boolean); const ageMs = items.length ? Math.max(...items.map((item) => Number(item.ageMs) || 0)) : Infinity;
    return { stale: snapshot.stale || !items.length || items.some((item) => item.stale), ageMs, spreadPct: snapshot.ticker?.spreadPct, bookImbalance: snapshot.book?.imbalance, buyRatio: snapshot.flow?.buyRatio, delta: snapshot.flow?.delta, deltaQuote: snapshot.flow?.deltaQuote };
  };

  const cacheSet = (key, value) => { analysisCache.set(key, { expiresAtMono: performance.now() + 4000, value: structuredClone(value) }); while (analysisCache.size > 250) analysisCache.delete(analysisCache.keys().next().value); };
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

  const onPrice = (datum) => {
    alerts.checkPrice(datum).forEach((alert) => live.publish?.("alert", alert));
    paper.updatePrices({ [datum.symbol]: datum }, clock.now());
    void settleDue();
  };
  live.on?.("price", onPrice);
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
      return json(res, 200, { ok: true, version: packageJson.version, uptimeSeconds: Math.round(process.uptime()), live: snapshot, market: marketClient.status(), ai: credentialStore.status(), calibration: calibrator.status(), memory: { rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }, clock: clock.status(), persistence: { paper: paper.store.diagnostics(), alerts: alerts.store.diagnostics(), journal: journal.store.diagnostics() }, safety: { realOrders: false, publicMarketDataOnly: true } });
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
      return json(res, 200, { degraded: !coins.length, coins, selected: { symbol: live.symbol, interval: live.interval }, paper: paper.snapshot(priceDatums(), clock.now()), alerts: alerts.list(), journal: journal.list({ limit: 100 }), ai: credentialStore.status(), calibration: calibrator.status() });
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
      if (marketClient.assertTradable) await marketClient.assertTradable(symbol);
      live.select(symbol, interval); analysisCache.clear(); return json(res, 200, { ok: true, symbol, interval, generation: live.symbolGeneration });
    }
    if (pathname === "/api/live/stream") {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      res.writeHead(200, { ...securityHeaders("text/event-stream; charset=utf-8"), Connection: "keep-alive", "X-Accel-Buffering": "no" });
      let blocked = false; const write = (chunk) => { if (blocked || res.destroyed) return false; blocked = !res.write(chunk); return !blocked; }; res.on("drain", () => { blocked = false; });
      write(`event: ready\ndata: ${JSON.stringify({ symbol: live.symbol, interval: live.interval, localConnected: true })}\n\n`);
      const remove = live.addClient((event) => write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`));
      const keepAlive = setInterval(() => write(": ping\n\n"), 12000); const entry = { res, remove, keepAlive }; sseResponses.add(entry);
      req.on("close", () => { clearInterval(keepAlive); remove(); sseResponses.delete(entry); }); return;
    }

    let match;
    if ((match = pathname.match(/^\/api\/klines\/([A-Za-z0-9]+)$/))) {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      return json(res, 200, await marketClient.klines(cleanSymbol(match[1]), cleanInterval(url.searchParams.get("interval")), cleanLimit(url.searchParams.get("limit"), 500, 1000)));
    }
    if ((match = pathname.match(/^\/api\/analysis\/([A-Za-z0-9]+)$/))) {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      const symbol = cleanSymbol(match[1]); const interval = cleanInterval(url.searchParams.get("interval")); const force = url.searchParams.get("force") === "1";
      const base = await getAnalysis(symbol, interval, { force }); const mtf = await getConfluence(symbol, interval, force); const final = applyMtfGate(base, mtf);
      latestFinalAnalysis.set(`${symbol}|${interval}`, { savedAtMono: performance.now(), value: structuredClone(final) });
      while (latestFinalAnalysis.size > 250) latestFinalAnalysis.delete(latestFinalAnalysis.keys().next().value);
      alerts.checkAnalysis(final).forEach((alert) => live.publish?.("alert", alert)); return json(res, 200, final);
    }
    if ((match = pathname.match(/^\/api\/confluence\/([A-Za-z0-9]+)$/))) {
      if (req.method !== "GET") return fail(res, 405, "Método não permitido.", "METHOD_NOT_ALLOWED");
      return json(res, 200, await getConfluence(cleanSymbol(match[1]), cleanInterval(url.searchParams.get("interval") || live.interval)));
    }
    if (pathname === "/api/paper" && req.method === "GET") return json(res, 200, paper.snapshot(priceDatums(), clock.now()));
    if (pathname === "/api/paper/order" && req.method === "POST") {
      const input = await body(req); const symbol = cleanSymbol(input.symbol); const interval = cleanInterval(input.interval);
      const savedReading = latestFinalAnalysis.get(`${symbol}|${interval}`);
      const reading = savedReading && performance.now() - savedReading.savedAtMono <= 60_000 ? structuredClone(savedReading.value) : null;
      // A abertura não espera uma análise de rede: usa a última leitura visível, quando
      // recente, e captura a cotação autoritativa no exato momento da confirmação.
      let datum = priceDatums()[symbol];
      if (!datum) { const ticker = await marketClient.ticker(symbol, { force: true }); datum = ticker.datum; }
      const trade = paper.place({ ...input, symbol, interval, entryDatum: datum, entryPrice: undefined, analysisSnapshot: AdaptiveCalibrator.snapshot(reading), idempotencyKey: req.headers["idempotency-key"] || input.idempotencyKey, now: clock.now() });
      return json(res, 201, { trade, confirmedEntryPrice: trade.entryPrice, confirmedEntryPriceAt: trade.entryPriceAt, portfolio: paper.snapshot(priceDatums(), clock.now()) });
    }
    if (pathname === "/api/paper/reset" && req.method === "POST") { const input = await body(req); if (input.confirm !== true) throw new AppError("Confirme a exclusão do histórico do simulador.", { status: 409, code: "CONFIRM_REQUIRED" }); return json(res, 200, paper.reset(10000)); }
    if (pathname === "/api/paper/settings" && req.method === "POST") { paper.settings(await body(req)); return json(res, 200, paper.snapshot(priceDatums(), clock.now())); }
    if (pathname === "/api/paper/export" && req.method === "GET") {
      const rows = paper.store.value.results.slice().reverse(); const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`; const header = ["abertura", "expiracao", "liquidacao", "par", "tempo", "direcao", "valor", "entrada", "saida", "resultado", "lucro", "nota", "sinal_painel", "confianca"];
      const lines = rows.map((trade) => [trade.openedAt, trade.expiresAt, trade.settledAt, trade.symbol, trade.interval, trade.direction, trade.stake, trade.entryPrice, trade.exitPrice, trade.result, trade.profit, trade.note, trade.analysisSnapshot?.signal, trade.analysisSnapshot?.confidence].map(quote).join(","));
      return text(res, 200, `\uFEFF${header.join(",")}\n${lines.join("\n")}`, "text/csv; charset=utf-8", { "Content-Disposition": "attachment; filename=historico-dieftrade.csv" });
    }
    if (pathname === "/api/alerts" && req.method === "GET") return json(res, 200, alerts.list());
    if (pathname === "/api/alerts" && req.method === "POST") { const input = await body(req); return json(res, 201, alerts.add({ ...input, currentDatum: priceDatums()[cleanSymbol(input.symbol)] })); }
    if ((match = pathname.match(/^\/api\/alerts\/([a-f0-9]+)$/)) && req.method === "DELETE") { const removed = alerts.remove(match[1]); return removed ? json(res, 200, { ok: true, removed: true }) : fail(res, 404, "Alerta não encontrado.", "NOT_FOUND"); }
    if (pathname === "/api/journal" && req.method === "GET") return json(res, 200, journal.list({ offset: Math.max(0, Number(url.searchParams.get("offset")) || 0), limit: cleanLimit(url.searchParams.get("limit"), 100, 500), query: url.searchParams.get("q") || "" }));
    if (pathname === "/api/journal" && req.method === "POST") return json(res, 201, journal.add(await body(req)));
    if ((match = pathname.match(/^\/api\/journal\/([a-f0-9]+)$/)) && req.method === "DELETE") { const removed = journal.remove(match[1]); return removed ? json(res, 200, { ok: true, removed: true }) : fail(res, 404, "Anotação não encontrada.", "NOT_FOUND"); }
    if (pathname === "/api/ai/config" && req.method === "GET") return json(res, 200, credentialStore.status());
    if (pathname === "/api/ai/config" && req.method === "POST") {
      const input = await body(req); const temporary = { load: () => ({ apiKey: String(input.apiKey || "").trim(), provider: input.provider, model: input.model }), status: () => ({ stored: true, operational: true }) };
      await new AiReader(temporary, { cooldownMs: 0, dailyLimit: 2 }).diagnose(); return json(res, 200, credentialStore.save(input));
    }
    if (pathname === "/api/ai/config" && req.method === "DELETE") return json(res, 200, credentialStore.remove());
    if (pathname === "/api/ai/test" && req.method === "POST") { await body(req); return json(res, 200, await ai.diagnose()); }
    if (pathname === "/api/ai/read" && req.method === "POST") {
      ai.assertReady(); const input = await body(req); const symbol = cleanSymbol(input.symbol || live.symbol); const interval = cleanInterval(input.interval || live.interval); const base = await getAnalysis(symbol, interval, { force: true }); const analysis = applyMtfGate(base, await getConfluence(symbol, interval, true)); return json(res, 200, await ai.read(analysis));
    }
    if (pathname === "/api/calibration" && req.method === "GET") return json(res, 200, calibrator.status());
    if (pathname === "/api/calibration/reset" && req.method === "POST") { const input = await body(req); if (input.confirm !== true) throw new AppError("Confirme a limpeza da calibração.", { status: 409, code: "CONFIRM_REQUIRED" }); analysisCache.clear(); return json(res, 200, calibrator.reset()); }
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
    token, live, market: marketClient, clock, paper, alerts, journal,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", async () => {
          server.removeListener("error", reject); listening = true;
          try { await marketClient.syncClock?.(); } catch (error) { log("warn", "clock_sync_failed", { message: error.message }); }
          live.start(); settlementTimer = setInterval(() => { paper.updatePrices(priceDatums(), clock.now()); void settleDue(); }, 1000); settlementTimer.unref?.(); void settleDue(); resolve({ port: server.address().port, token });
        });
      });
    },
    async close() {
      listening = false; if (settlementTimer) clearInterval(settlementTimer); settlementTimer = null;
      live.off?.("price", onPrice); live.close(); marketClient.close?.();
      for (const entry of sseResponses) { clearInterval(entry.keepAlive); entry.remove(); try { entry.res.end(); } catch {} } sseResponses.clear();
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

module.exports = { createServer };
