"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MarketClient, INTERVALS } = require("./engine/market-client.cjs");
const { RealtimeHub } = require("./engine/realtime-hub.cjs");
const { analyze, combineTimeframes } = require("./engine/analysis.cjs");
const { PaperPortfolio, AlertsStore, JournalStore } = require("./engine/paper.cjs");
const { AiReader } = require("./engine/ai-reader.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const cleanSymbol = (value) => {
  const symbol = String(value || "").toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("Par inválido.");
  return symbol;
};

function createServer({ dataDirectory, uiDirectory, credentialStore, market = null, realtime = null } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const marketClient = market || new MarketClient();
  const live = realtime || new RealtimeHub();
  const paper = new PaperPortfolio(dataDirectory);
  const alerts = new AlertsStore(dataDirectory);
  const journal = new JournalStore(dataDirectory);
  const ai = new AiReader(credentialStore);
  const analysisCache = new Map();
  let server;

  const origin = () => `http://127.0.0.1:${server?.address()?.port || 0}`;
  const securityHeaders = (contentType = null) => ({
    ...(contentType ? { "Content-Type": contentType } : {}),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  const json = (res, status, value) => {
    const body = JSON.stringify(value);
    res.writeHead(status, { ...securityHeaders("application/json; charset=utf-8"), "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  };
  const fail = (res, status, error) => json(res, status, { error: error instanceof Error ? error.message : String(error) });

  const authorize = (req, url) => {
    const presented = req.headers["x-dief-token"] || url.searchParams.get("t") || "";
    const expected = Buffer.from(token);
    const received = Buffer.from(String(presented));
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return false;
    const requestOrigin = req.headers.origin;
    return !requestOrigin || requestOrigin === origin();
  };

  const body = (req, limit = 128 * 1024) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("Conteúdo grande demais.")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("JSON inválido.")); }
    });
    req.on("error", reject);
  });

  const microSnapshot = () => {
    const snapshot = live.snapshot();
    return {
      stale: snapshot.stale,
      spreadPct: snapshot.ticker?.spreadPct,
      bookImbalance: snapshot.book?.imbalance,
      buyRatio: snapshot.flow?.buyRatio,
      delta: snapshot.flow?.delta,
    };
  };

  const getAnalysis = async (symbol, interval, force = false) => {
    const key = `${symbol}|${interval}`;
    const cached = analysisCache.get(key);
    if (!force && cached && Date.now() - cached.at < 4000) return cached.value;
    const candles = await marketClient.klines(symbol, interval, 500);
    const value = analyze(candles, { symbol, interval, micro: symbol === live.symbol ? microSnapshot() : {} });
    analysisCache.set(key, { at: Date.now(), value });
    return value;
  };

  const getConfluence = async (symbol) => {
    const frames = ["1m", "5m", "15m", "1h", "4h"];
    const settled = await Promise.allSettled(frames.map(async (interval) => [interval, await getAnalysis(symbol, interval)]));
    const results = {};
    for (const item of settled) {
      if (item.status === "fulfilled") results[item.value[0]] = item.value[1];
      else results[`error-${Object.keys(results).length}`] = { error: item.reason?.message || "falha" };
    }
    return combineTimeframes(results);
  };

  const prices = () => {
    const map = Object.fromEntries(live.marketSnapshot(500).map((coin) => [coin.symbol, coin.last]));
    if (live.state.ticker?.last) map[live.symbol] = live.state.ticker.last;
    return map;
  };

  async function api(req, res, url) {
    if (!authorize(req, url)) return fail(res, 401, "Sessão local inválida.");
    const pathname = url.pathname;
    if (pathname === "/api/health") return json(res, 200, {
      ok: true, version: "0.3.0", live: live.snapshot(), market: marketClient.status(), ai: credentialStore.status(),
      safety: { realOrders: false, publicMarketDataOnly: true },
    });
    if (pathname === "/api/bootstrap") {
      let coins = live.marketSnapshot();
      if (coins.length < 20) coins = await marketClient.topPairs();
      return json(res, 200, { coins, selected: { symbol: live.symbol, interval: live.interval }, paper: paper.snapshot(prices()), alerts: alerts.list(), journal: journal.list().slice(0, 100), ai: credentialStore.status() });
    }
    if (pathname === "/api/coins") {
      let coins = live.marketSnapshot(Number(url.searchParams.get("limit")) || 180);
      if (coins.length < 20) coins = await marketClient.topPairs("USDT", Number(url.searchParams.get("limit")) || 180);
      return json(res, 200, coins);
    }
    if (pathname === "/api/live/select" && req.method === "POST") {
      const input = await body(req);
      const symbol = cleanSymbol(input.symbol);
      const interval = INTERVALS.has(input.interval) ? input.interval : "15m";
      live.select(symbol, interval);
      analysisCache.clear();
      return json(res, 200, { ok: true, symbol, interval });
    }
    if (pathname === "/api/live/stream") {
      res.writeHead(200, {
        ...securityHeaders("text/event-stream; charset=utf-8"),
        Connection: "keep-alive", "X-Accel-Buffering": "no",
      });
      res.write(`event: ready\ndata: ${JSON.stringify({ symbol: live.symbol, interval: live.interval })}\n\n`);
      const remove = live.addClient((event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`));
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 12000);
      req.on("close", () => { clearInterval(keepAlive); remove(); });
      return;
    }
    let match;
    if ((match = pathname.match(/^\/api\/klines\/([A-Z0-9]+)$/))) {
      const interval = INTERVALS.has(url.searchParams.get("interval")) ? url.searchParams.get("interval") : "15m";
      return json(res, 200, await marketClient.klines(match[1], interval, Number(url.searchParams.get("limit")) || 500));
    }
    if ((match = pathname.match(/^\/api\/analysis\/([A-Z0-9]+)$/))) {
      const interval = INTERVALS.has(url.searchParams.get("interval")) ? url.searchParams.get("interval") : "15m";
      const analysis = await getAnalysis(match[1], interval, url.searchParams.get("force") === "1");
      analysis.multiTimeframe = await getConfluence(match[1]);
      return json(res, 200, analysis);
    }
    if ((match = pathname.match(/^\/api\/confluence\/([A-Z0-9]+)$/))) return json(res, 200, await getConfluence(match[1]));
    if (pathname === "/api/paper" && req.method === "GET") return json(res, 200, paper.snapshot(prices()));
    if (pathname === "/api/paper/order" && req.method === "POST") {
      const input = await body(req);
      const symbol = cleanSymbol(input.symbol);
      const currentPrice = prices()[symbol] || (await marketClient.ticker(symbol)).last;
      return json(res, 200, { trade: paper.order({ ...input, symbol, price: currentPrice }), portfolio: paper.snapshot(prices()) });
    }
    if (pathname === "/api/paper/reset" && req.method === "POST") {
      const input = await body(req);
      return json(res, 200, paper.reset(input.balance));
    }
    if (pathname === "/api/alerts" && req.method === "GET") return json(res, 200, alerts.list());
    if (pathname === "/api/alerts" && req.method === "POST") return json(res, 200, alerts.add(await body(req)));
    if ((match = pathname.match(/^\/api\/alerts\/([a-f0-9]+)$/)) && req.method === "DELETE") { alerts.remove(match[1]); return json(res, 200, { ok: true }); }
    if (pathname === "/api/journal" && req.method === "GET") return json(res, 200, journal.list());
    if (pathname === "/api/journal" && req.method === "POST") return json(res, 200, journal.add(await body(req)));
    if ((match = pathname.match(/^\/api\/journal\/([a-f0-9]+)$/)) && req.method === "DELETE") { journal.remove(match[1]); return json(res, 200, { ok: true }); }
    if (pathname === "/api/ai/config" && req.method === "GET") return json(res, 200, credentialStore.status());
    if (pathname === "/api/ai/config" && req.method === "POST") return json(res, 200, credentialStore.save(await body(req)));
    if (pathname === "/api/ai/config" && req.method === "DELETE") return json(res, 200, credentialStore.remove());
    if (pathname === "/api/ai/read" && req.method === "POST") {
      const input = await body(req);
      const symbol = cleanSymbol(input.symbol || live.symbol);
      const interval = INTERVALS.has(input.interval) ? input.interval : live.interval;
      const analysis = await getAnalysis(symbol, interval, true);
      analysis.multiTimeframe = await getConfluence(symbol);
      return json(res, 200, await ai.read(analysis));
    }
    return fail(res, 404, "Rota não encontrada.");
  }

  function staticFile(req, res, url) {
    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const base = path.resolve(uiDirectory);
    const file = path.resolve(base, `.${requested}`);
    if (file !== base && !file.startsWith(base + path.sep)) return fail(res, 403, "Caminho inválido.");
    const candidate = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(base, "index.html");
    if (!fs.existsSync(candidate)) return fail(res, 404, "Interface não encontrada.");
    const stat = fs.statSync(candidate);
    res.writeHead(200, { ...securityHeaders(MIME[path.extname(candidate).toLowerCase()] || "application/octet-stream"), "Cache-Control": path.extname(candidate) === ".html" ? "no-store" : "public, max-age=3600", "Content-Length": stat.size });
    fs.createReadStream(candidate).pipe(res);
  }

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else staticFile(req, res, url);
    } catch (error) {
      if (!res.headersSent) fail(res, 500, error);
      else res.end();
    }
  });

  const alertTimer = setInterval(() => alerts.check(prices()), 1000);
  alertTimer.unref();

  return {
    token,
    live,
    market: marketClient,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); live.start(); resolve({ port: server.address().port, token }); });
      });
    },
    async close() {
      clearInterval(alertTimer);
      live.close();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { createServer };
