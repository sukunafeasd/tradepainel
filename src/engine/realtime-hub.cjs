"use strict";

const EventEmitter = require("events");
const WebSocket = require("ws");
const { cleanSymbol, cleanInterval } = require("./contracts.cjs");
const { ExchangeClock } = require("./clock.cjs");

const STREAM_HOSTS = ["wss://stream.binance.com:9443", "wss://stream.binance.com:443", "wss://data-stream.binance.vision"];
const STABLES = new Set(["USDC", "FDUSD", "BUSD", "TUSD", "USDE", "DAI", "EUR", "AEUR", "BRL"]);
const STREAM_FRESH_MS = { ticker: 5000, candle: 8000, book: 5000, flow: 5000 };

const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const finiteNonnegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

class RealtimeHub extends EventEmitter {
  constructor({ streamHosts = STREAM_HOSTS, WebSocketImpl = WebSocket, clock = new ExchangeClock(), reconnectBaseMs = 800 } = {}) {
    super();
    this.streamHosts = [...streamHosts];
    this.WebSocketImpl = WebSocketImpl;
    this.clock = clock;
    this.reconnectBaseMs = reconnectBaseMs;
    this.symbolHostIndex = 0;
    this.marketHostIndex = 0;
    this.socket = null;
    this.marketSocket = null;
    this.symbol = "BTCUSDT";
    this.interval = "15m";
    this.symbolGeneration = 0;
    this.marketGeneration = 0;
    this.symbolReconnectTimer = null;
    this.marketReconnectTimer = null;
    this.retry = 0;
    this.closed = true;
    this.state = this.#blankState();
    this.market = new Map();
    this.priceHistory = new Map();
    this.flowQueue = [];
    this.flowTotals = { buy: 0, sell: 0, buyQuote: 0, sellQuote: 0 };
    this.tradeIds = new Map();
    this.lastMarketBroadcastMono = 0;
    this.lastMarketEventMono = 0;
    this.marketOpenedMono = 0;
    this.symbolOpenedMono = 0;
    this.clients = new Set();
    this.metrics = { reconnects: 0, marketReconnects: 0, connectedAt: null, lastDisconnectAt: null, lastError: null, symbolHost: null, marketHost: null, malformedEvents: 0, duplicateTrades: 0, generation: 0 };
    this.flushTimer = null;
    this.staleTimer = null;
  }

  #blankState() {
    return { symbol: this.symbol, interval: this.interval, generation: this.symbolGeneration, connected: false, stale: true, lastEventAt: 0, freshness: { ticker: null, candle: null, book: null, flow: null }, ticker: null, candle: null, book: { bids: [], asks: [], imbalance: null, bidVolume: 0, askVolume: 0 }, trades: [], flow: { buyVolume: 0, sellVolume: 0, buyQuoteVolume: 0, sellQuoteVolume: 0, delta: 0, deltaQuote: 0, buyRatio: 0.5, windowMs: 60000, sampleDurationMs: 0, trades: 0 }, dirty: true };
  }

  #ensureTimers() {
    if (!this.flushTimer) { this.flushTimer = setInterval(() => this.#flush(), 250); this.flushTimer.unref?.(); }
    if (!this.staleTimer) { this.staleTimer = setInterval(() => this.#watchdog(), 1000); this.staleTimer.unref?.(); }
  }

  start() {
    if (!this.closed) return;
    this.closed = false;
    this.#ensureTimers();
    this.#connectMarket(++this.marketGeneration);
    this.#connectSymbol(++this.symbolGeneration);
  }

  select(symbol, interval = this.interval) {
    const clean = cleanSymbol(symbol);
    const frame = cleanInterval(interval);
    if (clean === this.symbol && frame === this.interval && this.socket && [this.WebSocketImpl.OPEN, this.WebSocketImpl.CONNECTING].includes(this.socket.readyState)) return false;
    this.symbol = clean;
    this.interval = frame;
    this.symbolGeneration += 1;
    this.metrics.generation = this.symbolGeneration;
    clearTimeout(this.symbolReconnectTimer);
    this.symbolReconnectTimer = null;
    const old = this.socket;
    this.socket = null;
    this.flowQueue = [];
    this.flowTotals = { buy: 0, sell: 0, buyQuote: 0, sellQuote: 0 };
    this.tradeIds.clear();
    this.state = this.#blankState();
    try { old?.close(1000, "troca de mercado"); } catch {}
    if (!this.closed) this.#connectSymbol(this.symbolGeneration);
    this.publish("market-reset", { symbol: clean, interval: frame, generation: this.symbolGeneration });
    return true;
  }

  snapshot() {
    const { dirty, ...safe } = this.state;
    return structuredClone({ ...safe, connection: this.metrics });
  }

  marketSnapshot(limit = 180) {
    const nowMono = performance.now();
    return [...this.market.values()].filter((item) => nowMono - item.receivedMono <= 90000).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, Math.max(1, Math.min(Number(limit) || 180, 500))).map(({ receivedMono, ...item }) => ({ ...item, ageMs: Math.max(0, nowMono - receivedMono), stale: nowMono - receivedMono > 15000 }));
  }

  priceDatums({ maxAgeMs = 5000 } = {}) {
    const now = this.clock.now();
    const nowMono = performance.now();
    const output = {};
    for (const [symbol, item] of this.market) {
      const ageMs = nowMono - item.receivedMono;
      if (ageMs <= maxAgeMs && item.last > 0) output[symbol] = { symbol, value: item.last, exchangeTimestamp: item.eventTime, receivedAt: item.receivedAt, ageMs, source: "binance-mini-ticker", stale: false };
    }
    const tickerFresh = this.state.freshness.ticker;
    if (this.state.ticker?.last > 0 && tickerFresh && nowMono - tickerFresh.receivedMono <= maxAgeMs) output[this.symbol] = { symbol: this.symbol, value: this.state.ticker.last, exchangeTimestamp: tickerFresh.exchangeTimestamp, receivedAt: tickerFresh.receivedAt, ageMs: now - tickerFresh.receivedAt, source: "binance-aggtrade", stale: false, generation: this.symbolGeneration };
    return output;
  }

  datumAt(symbol, timestamp, toleranceMs = 1500) {
    const rows = this.priceHistory.get(cleanSymbol(symbol)) || [];
    const best = rows.reduce((closest, item) => Math.abs(item.exchangeTimestamp - timestamp) < Math.abs((closest?.exchangeTimestamp ?? Infinity) - timestamp) ? item : closest, null);
    return best && Math.abs(best.exchangeTimestamp - timestamp) <= toleranceMs ? structuredClone(best) : null;
  }

  addClient(send) {
    try { send({ type: "snapshot", data: this.snapshot() }); }
    catch (error) { this.emit("warning", error); return () => {}; }
    this.clients.add(send);
    return () => this.clients.delete(send);
  }

  publish(type, data) {
    const event = { type, data };
    for (const send of this.clients) { try { send(event); } catch (error) { this.clients.delete(send); this.emit("warning", error); } }
  }

  #socketReady(socket) { return socket && [this.WebSocketImpl.OPEN, this.WebSocketImpl.CONNECTING].includes(socket.readyState); }

  #connectMarket(generation) {
    if (this.closed || generation !== this.marketGeneration || this.#socketReady(this.marketSocket)) return;
    const host = this.streamHosts[this.marketHostIndex % this.streamHosts.length];
    const socket = new this.WebSocketImpl(`${host}/ws/!miniTicker@arr`, { handshakeTimeout: 10000 });
    this.marketSocket = socket;
    socket.on("open", () => { if (generation !== this.marketGeneration || socket !== this.marketSocket) return; this.marketOpenedMono = performance.now(); this.metrics.marketHost = host; });
    socket.on("message", (raw) => {
      if (generation !== this.marketGeneration || socket !== this.marketSocket || this.closed) return;
      try {
        const rows = JSON.parse(raw.toString());
        if (!Array.isArray(rows)) throw new Error("miniTicker inválido");
        const nowMono = performance.now(); const receivedAt = this.clock.now(); let accepted = 0;
        for (const row of rows) {
          const symbol = String(row.s || "");
          if (!symbol.endsWith("USDT")) continue;
          const base = symbol.slice(0, -4);
          if (STABLES.has(base) || /(UP|DOWN|BULL|BEAR)$/.test(base)) continue;
          const last = finitePositive(row.c); const open = finitePositive(row.o); const high = finitePositive(row.h); const low = finitePositive(row.l); const volume = finiteNonnegative(row.v); const quoteVolume = finiteNonnegative(row.q);
          const eventTime = Number.isFinite(Number(row.E)) ? Number(row.E) : receivedAt;
          if (!(last && open && high && low && volume != null && quoteVolume != null && eventTime <= receivedAt + 60000)) continue;
          this.market.set(symbol, { symbol, base, quote: "USDT", last, changePct: ((last / open) - 1) * 100, high, low, volume, quoteVolume, eventTime, receivedAt, receivedMono: nowMono, live: true });
          this.#rememberPrice({ symbol, value: last, exchangeTimestamp: eventTime, receivedAt, source: "binance-mini-ticker", stale: false });
          accepted += 1;
        }
        if (!accepted) return;
        this.lastMarketEventMono = nowMono;
        if (nowMono - this.lastMarketBroadcastMono > 750) { this.lastMarketBroadcastMono = nowMono; this.publish("coins", this.marketSnapshot(220)); }
      } catch (error) { this.metrics.malformedEvents += 1; this.emit("warning", error); }
    });
    socket.on("close", () => {
      if (generation !== this.marketGeneration || socket !== this.marketSocket) return;
      this.marketSocket = null; this.marketOpenedMono = 0; this.metrics.marketReconnects += 1; this.marketHostIndex = (this.marketHostIndex + 1) % this.streamHosts.length;
      if (!this.closed) this.marketReconnectTimer = setTimeout(() => this.#connectMarket(generation), 2500 + Math.random() * 1000);
    });
    socket.on("error", (error) => { this.metrics.lastError = error?.message || "Falha no radar"; try { socket.terminate(); } catch {} });
  }

  #connectSymbol(generation) {
    if (this.closed || generation !== this.symbolGeneration || this.#socketReady(this.socket)) return;
    const selectedSymbol = this.symbol; const selectedInterval = this.interval;
    const lower = selectedSymbol.toLowerCase();
    const streams = [`${lower}@kline_${selectedInterval}`, `${lower}@aggTrade`, `${lower}@bookTicker`, `${lower}@depth20@100ms`].join("/");
    const host = this.streamHosts[this.symbolHostIndex % this.streamHosts.length];
    const socket = new this.WebSocketImpl(`${host}/stream?streams=${streams}`, { handshakeTimeout: 10000 });
    this.socket = socket;
    socket.on("open", () => {
      if (generation !== this.symbolGeneration || socket !== this.socket) return;
      this.retry = 0; this.symbolOpenedMono = performance.now(); this.metrics.connectedAt = this.clock.now(); this.metrics.symbolHost = host; this.metrics.lastError = null;
    });
    socket.on("message", (raw) => this.#handleMessage(raw, { socket, generation, symbol: selectedSymbol, interval: selectedInterval }));
    socket.on("close", () => {
      if (generation !== this.symbolGeneration || socket !== this.socket) return;
      this.socket = null; this.symbolOpenedMono = 0; this.state.connected = false; this.state.stale = true; this.state.dirty = true; this.metrics.reconnects += 1; this.metrics.lastDisconnectAt = this.clock.now();
      if (!this.closed) { this.symbolHostIndex = (this.symbolHostIndex + 1) % this.streamHosts.length; const delay = Math.min(15000, this.reconnectBaseMs * (2 ** Math.min(this.retry++, 4))) + Math.random() * 300; this.symbolReconnectTimer = setTimeout(() => this.#connectSymbol(generation), delay); }
    });
    socket.on("error", (error) => { this.metrics.lastError = error?.message || "Falha no fluxo"; try { socket.terminate(); } catch {} });
  }

  #fresh(component, exchangeTimestamp, receivedAt, receivedMono) {
    this.state.freshness[component] = { exchangeTimestamp, receivedAt, receivedMono, ageMs: 0, stale: false };
    this.state.lastEventAt = Math.max(this.state.lastEventAt, receivedAt);
    this.state.connected = true;
  }

  #rememberPrice(datum) {
    const rows = this.priceHistory.get(datum.symbol) || [];
    rows.push(datum);
    const minimum = datum.exchangeTimestamp - 10 * 60 * 1000;
    while (rows.length && rows[0].exchangeTimestamp < minimum) rows.shift();
    if (rows.length > 20000) rows.splice(0, rows.length - 20000);
    this.priceHistory.set(datum.symbol, rows);
  }

  #handleMessage(raw, context) {
    if (context.generation !== this.symbolGeneration || context.socket !== this.socket || context.symbol !== this.symbol || context.interval !== this.interval || this.closed) return;
    try {
      const envelope = JSON.parse(raw.toString());
      const stream = String(envelope.stream || "");
      const data = envelope.data || envelope;
      if (stream && !stream.startsWith(context.symbol.toLowerCase() + "@")) return;
      const receivedAt = this.clock.now(); const receivedMono = performance.now(); let accepted = false;
      if (data.e === "kline") {
        const k = data.k;
        if (!k || String(k.s || data.s || "").toUpperCase() !== context.symbol || String(k.i || "") !== context.interval) return;
        const candle = { t: Number(k.t), closeTime: Number(k.T), open: finitePositive(k.o), high: finitePositive(k.h), low: finitePositive(k.l), close: finitePositive(k.c), volume: finiteNonnegative(k.v), quoteVolume: finiteNonnegative(k.q), trades: finiteNonnegative(k.n), takerBuyVolume: finiteNonnegative(k.V), closed: Boolean(k.x) };
        if (!Number.isFinite(candle.t) || !Number.isFinite(candle.closeTime) || !candle.open || !candle.high || !candle.low || !candle.close || candle.volume == null || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) return;
        this.state.candle = candle; this.#fresh("candle", Number(data.E || k.T), receivedAt, receivedMono); accepted = true;
      } else if (data.e === "aggTrade") {
        if (String(data.s || "").toUpperCase() !== context.symbol) return;
        const trade = { id: String(data.a), t: Number(data.T), price: finitePositive(data.p), quantity: finitePositive(data.q), side: data.m ? "sell" : "buy" };
        if (!Number.isFinite(trade.t) || !trade.price || !trade.quantity || trade.t > receivedAt + 60000) return;
        if (this.tradeIds.has(trade.id)) { this.metrics.duplicateTrades += 1; return; }
        this.tradeIds.set(trade.id, trade.t);
        this.flowQueue.push(trade);
        const quote = trade.price * trade.quantity;
        if (trade.side === "buy") { this.flowTotals.buy += trade.quantity; this.flowTotals.buyQuote += quote; } else { this.flowTotals.sell += trade.quantity; this.flowTotals.sellQuote += quote; }
        const minimum = receivedAt - 60000;
        while (this.flowQueue.length && this.flowQueue[0].t < minimum) {
          const expired = this.flowQueue.shift(); const expiredQuote = expired.price * expired.quantity;
          if (expired.side === "buy") { this.flowTotals.buy -= expired.quantity; this.flowTotals.buyQuote -= expiredQuote; } else { this.flowTotals.sell -= expired.quantity; this.flowTotals.sellQuote -= expiredQuote; }
          this.tradeIds.delete(expired.id);
        }
        const total = this.flowTotals.buy + this.flowTotals.sell;
        this.state.trades = this.flowQueue.slice(-160).reverse();
        this.state.flow = { buyVolume: this.flowTotals.buy, sellVolume: this.flowTotals.sell, buyQuoteVolume: this.flowTotals.buyQuote, sellQuoteVolume: this.flowTotals.sellQuote, delta: this.flowTotals.buy - this.flowTotals.sell, deltaQuote: this.flowTotals.buyQuote - this.flowTotals.sellQuote, buyRatio: total ? this.flowTotals.buy / total : 0.5, windowMs: 60000, sampleDurationMs: this.flowQueue.length ? Math.max(0, trade.t - this.flowQueue[0].t) : 0, trades: this.flowQueue.length };
        const current = this.state.ticker || { bid: null, ask: null, bidQuantity: null, askQuantity: null, spread: null, spreadPct: null };
        this.state.ticker = { ...current, last: trade.price };
        const priceDatum = { symbol: context.symbol, value: trade.price, exchangeTimestamp: trade.t, receivedAt, source: "binance-aggtrade", stale: false, tradeId: trade.id, generation: context.generation };
        this.#rememberPrice(priceDatum);
        this.emit("price", structuredClone(priceDatum));
        this.#fresh("ticker", trade.t, receivedAt, receivedMono); this.#fresh("flow", trade.t, receivedAt, receivedMono); accepted = true;
      } else if (data.e === "depthUpdate" || (Array.isArray(data.bids) && Array.isArray(data.asks))) {
        if (data.s && String(data.s).toUpperCase() !== context.symbol) return;
        const parse = (rows) => (rows || []).map(([price, quantity]) => [finitePositive(price), finiteNonnegative(quantity)]).filter(([price, quantity]) => price && quantity > 0).slice(0, 20);
        const bids = parse(data.bids || data.b); const asks = parse(data.asks || data.a);
        if (!bids.length || !asks.length || Math.max(...bids.map(([p]) => p)) > Math.min(...asks.map(([p]) => p))) return;
        const mid = (bids[0][0] + asks[0][0]) / 2;
        const weighted = (rows) => rows.reduce((sum, [price, quantity]) => sum + quantity / (1 + Math.abs(price - mid) / mid * 1000), 0);
        const bidVolume = weighted(bids); const askVolume = weighted(asks);
        this.state.book = { bids, asks, bidVolume, askVolume, imbalance: bidVolume + askVolume ? bidVolume / (bidVolume + askVolume) : 0.5 };
        this.#fresh("book", Number(data.E || receivedAt), receivedAt, receivedMono); accepted = true;
      } else if (data.b && data.a && data.B != null && data.A != null) {
        if (data.s && String(data.s).toUpperCase() !== context.symbol) return;
        const bid = finitePositive(data.b); const ask = finitePositive(data.a); const bidQuantity = finiteNonnegative(data.B); const askQuantity = finiteNonnegative(data.A);
        if (!bid || !ask || bid > ask || bidQuantity == null || askQuantity == null) return;
        const mid = (bid + ask) / 2;
        this.state.ticker = { ...(this.state.ticker || {}), bid, ask, bidQuantity, askQuantity, spread: ask - bid, spreadPct: ((ask - bid) / mid) * 100 };
        this.#fresh("book", Number(data.E || receivedAt), receivedAt, receivedMono); accepted = true;
      }
      if (!accepted) return;
      this.state.stale = Object.keys(STREAM_FRESH_MS).some((component) => !this.state.freshness[component] || this.state.freshness[component].stale);
      this.state.dirty = true;
    } catch (error) { this.metrics.malformedEvents += 1; this.emit("warning", error); }
  }

  #watchdog() {
    const nowMono = performance.now(); let changed = false;
    for (const [component, threshold] of Object.entries(STREAM_FRESH_MS)) {
      const item = this.state.freshness[component];
      if (!item) continue;
      const ageMs = Math.max(0, nowMono - item.receivedMono);
      const stale = ageMs > threshold;
      if (stale !== item.stale || Math.abs(item.ageMs - ageMs) > 500) changed = true;
      item.ageMs = ageMs; item.stale = stale;
    }
    const stale = Object.keys(STREAM_FRESH_MS).some((component) => !this.state.freshness[component] || this.state.freshness[component].stale);
    if (stale !== this.state.stale) { this.state.stale = stale; changed = true; }
    if (stale && this.socket?.readyState === this.WebSocketImpl.OPEN && this.symbolOpenedMono && nowMono - this.symbolOpenedMono > 10000) { const socket = this.socket; this.metrics.lastError = "Fluxo aberto sem mensagens válidas; reconectando."; try { socket.terminate(); } catch {} }
    const marketActivity = this.lastMarketEventMono || this.marketOpenedMono;
    if (this.marketSocket?.readyState === this.WebSocketImpl.OPEN && marketActivity && nowMono - marketActivity > 20000) { this.metrics.lastError = "Radar aberto sem miniTicker; reconectando."; try { this.marketSocket.terminate(); } catch {} }
    for (const [symbol, item] of this.market) if (nowMono - item.receivedMono > 5 * 60 * 1000) this.market.delete(symbol);
    if (changed) this.state.dirty = true;
  }

  #flush() {
    if (!this.state.dirty) return;
    this.state.dirty = false;
    this.publish("snapshot", this.snapshot());
  }

  close() {
    this.closed = true;
    this.symbolGeneration += 1; this.marketGeneration += 1;
    clearTimeout(this.symbolReconnectTimer); clearTimeout(this.marketReconnectTimer);
    this.symbolReconnectTimer = null; this.marketReconnectTimer = null;
    if (this.flushTimer) clearInterval(this.flushTimer); if (this.staleTimer) clearInterval(this.staleTimer);
    this.flushTimer = null; this.staleTimer = null;
    for (const socket of [this.socket, this.marketSocket]) { try { socket?.close(1000, "encerrando"); } catch {} }
    this.socket = null; this.marketSocket = null;
    this.clients.clear();
  }
}

module.exports = { RealtimeHub, STREAM_HOSTS, STREAM_FRESH_MS };
