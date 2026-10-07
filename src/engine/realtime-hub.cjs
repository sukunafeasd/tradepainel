"use strict";

const EventEmitter = require("events");
const WebSocket = require("ws");
const { cleanSymbol, cleanInterval } = require("./contracts.cjs");
const { ExchangeClock } = require("./clock.cjs");

const STREAM_HOSTS = ["wss://stream.binance.com:9443", "wss://stream.binance.com:443", "wss://data-stream.binance.vision"];
const STABLES = new Set(["USDC", "FDUSD", "BUSD", "TUSD", "USDE", "DAI", "EUR", "AEUR", "BRL"]);
const STREAM_FRESH_MS = { ticker: 10000, candle: 12000, book: 8000, quote: 8000, flow: 10000 };
const EVENT_FUTURE_TOLERANCE_MS = 2000;
const EVENT_MAX_LAG_MS = 15000;
const SYMBOL_SILENCE_RECONNECT_MS = 20000;
const SNAPSHOT_INTERVAL_MS = 100;

const numeric = value => ['number','string'].includes(typeof value) && String(value).trim()!=='' && Number.isFinite(Number(value));
const finitePositive = (value) => numeric(value) && Number(value) > 0 ? Number(value) : null;
const finiteNonnegative = (value) => numeric(value) && Number(value) >= 0 ? Number(value) : null;
const sequenceId = value => (typeof value === "number" && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value)) ? null : BigInt(value);

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
    this.alertSocket = null;
    this.symbol = "BTCUSDT";
    this.interval = "15m";
    this.symbolGeneration = 0;
    this.marketGeneration = 0;
    this.alertGeneration = 0;
    this.symbolReconnectTimer = null;
    this.marketReconnectTimer = null;
    this.alertReconnectTimer = null;
    this.retry = 0;
    this.closed = true;
    this.state = this.#blankState();
    this.market = new Map();
    this.alertSymbols = new Set();
    this.alertTradeIds = new Map();
    this.priceHistory = new Map();
    this.flowQueue = [];
    this.flowHead = 0;
    this.flowDirty = true;
    this.depthUpdateId = null;
    this.quoteUpdateId = null;
    this.latestAggregateId = null;
    this.latestRawTradeId = null;
    this.flowTotals = { buy: 0, sell: 0, buyQuote: 0, sellQuote: 0 };
    this.tradeIds = new Map();
    this.lastMarketBroadcastMono = 0;
    this.lastMarketEventMono = 0;
    this.marketOpenedMono = 0;
    this.symbolOpenedMono = 0;
    this.lastSymbolEventMono = 0;
    this.clients = new Set();
    this.metrics = { reconnects: 0, marketReconnects: 0, alertReconnects: 0, alertStreams: 0, connectedAt: null, lastDisconnectAt: null, lastError: null, symbolHost: null, marketHost: null, alertHost: null, malformedEvents: 0, rejectedTimestamps: 0, outOfOrderEvents: 0, duplicateTrades: 0, generation: 0, snapshotIntervalMs: SNAPSHOT_INTERVAL_MS };
    this.flushTimer = null;
    this.staleTimer = null;
  }

  #blankState() {
    return { symbol: this.symbol, interval: this.interval, generation: this.symbolGeneration, connected: false, stale: true, lastEventAt: 0, freshness: { ticker: null, candle: null, book: null, quote: null, flow: null }, ticker: null, candle: null, book: { bids: [], asks: [], imbalance: null, bidVolume: 0, askVolume: 0 }, trades: [], flow: { buyVolume: 0, sellVolume: 0, buyQuoteVolume: 0, sellQuoteVolume: 0, delta: 0, deltaQuote: 0, buyRatio: null, windowMs: 60000, sampleDurationMs: 0, trades: 0 }, dirty: true };
  }

  #ensureTimers() {
    if (!this.flushTimer) { this.flushTimer = setInterval(() => this.#flush(), SNAPSHOT_INTERVAL_MS); this.flushTimer.unref?.(); }
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
    this.flowHead = 0; this.flowDirty = true;
    this.depthUpdateId = null; this.quoteUpdateId = null;
    this.latestAggregateId = null; this.latestRawTradeId = null;
    this.flowTotals = { buy: 0, sell: 0, buyQuote: 0, sellQuote: 0 };
    this.tradeIds.clear();
    this.lastSymbolEventMono = 0;
    this.state = this.#blankState();
    try { old?.close(1000, "troca de mercado"); } catch {}
    if (!this.closed) this.#connectSymbol(this.symbolGeneration);
    this.publish("market-reset", { symbol: clean, interval: frame, generation: this.symbolGeneration });
    return true;
  }

  watchPriceSymbols(symbols = []) {
    const next = [...new Set((Array.isArray(symbols) ? symbols : []).map((symbol) => cleanSymbol(symbol)))].sort();
    const current = [...this.alertSymbols].sort();
    if (next.length === current.length && next.every((symbol, index) => symbol === current[index])) return false;
    this.alertSymbols = new Set(next);
    this.metrics.alertStreams = next.length;
    this.alertTradeIds.clear();
    this.alertGeneration += 1;
    clearTimeout(this.alertReconnectTimer);
    this.alertReconnectTimer = null;
    const old = this.alertSocket;
    this.alertSocket = null;
    try { old?.close(1000, "alertas atualizados"); } catch {}
    if (!this.closed && next.length) this.#connectAlertPrices(this.alertGeneration);
    return true;
  }

  snapshot() {
    this.#refreshFlow(this.clock.now());
    const { dirty, ...safe } = this.state;
    const snapshot = structuredClone({ ...safe, connection: this.metrics });
    const nowMono = performance.now();
    for (const [component, item] of Object.entries(snapshot.freshness)) {
      if (!item) continue;
      item.ageMs = Math.max(0, nowMono - item.receivedMono, this.clock.now() - item.exchangeTimestamp);
      item.stale = Boolean(item.invalidated || item.ageMs > STREAM_FRESH_MS[component]);
    }
    snapshot.stale = !snapshot.connected || !["candle", "book", "ticker"].some(component => (component!=='candle'||!snapshot.candle?.awaitingExchange) && snapshot.freshness[component] && !snapshot.freshness[component].stale);
    if (snapshot.freshness.quote?.stale && snapshot.ticker) {
      for (const field of ["bid", "ask", "bidQuantity", "askQuantity", "spread", "spreadPct"]) snapshot.ticker[field] = null;
    }
    if (snapshot.freshness.book?.stale) snapshot.book.imbalance = null;
    return snapshot;
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
      const ageMs = Math.max(0, nowMono - item.receivedMono, now - item.eventTime);
      if (ageMs <= maxAgeMs && item.last > 0) output[symbol] = { symbol, value: item.last, exchangeTimestamp: item.eventTime, receivedAt: item.receivedAt, ageMs, source: "binance-mini-ticker", stale: false };
    }
    const tickerFresh = this.state.freshness.ticker;
    const tickerAge = tickerFresh ? Math.max(0, nowMono - tickerFresh.receivedMono, now - tickerFresh.exchangeTimestamp) : Infinity;
    if (this.state.ticker?.last > 0 && tickerFresh && !tickerFresh.invalidated && tickerAge <= maxAgeMs) output[this.symbol] = { symbol: this.symbol, value: this.state.ticker.last, exchangeTimestamp: tickerFresh.exchangeTimestamp, receivedAt: tickerFresh.receivedAt, ageMs: tickerAge, source: "binance-aggtrade", stale: false, generation: this.symbolGeneration };
    return output;
  }

  datumAt(symbol, timestamp, toleranceMs = 1500) {
    const rows = this.priceHistory.get(cleanSymbol(symbol)) || [];
    const eligible = rows.filter((item) => item.source === "binance-aggtrade" && item.exchangeTimestamp <= timestamp && timestamp - item.exchangeTimestamp <= toleranceMs);
    const best = eligible.sort((a, b) => b.exchangeTimestamp - a.exchangeTimestamp)[0];
    return best ? structuredClone(best) : null;
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
          if (!row || typeof row !== "object") { this.metrics.malformedEvents += 1; continue; }
          let symbol = String(row.s || "");
          if (!symbol.endsWith("USDT")) continue;
          try { symbol = cleanSymbol(symbol); }
          catch { this.metrics.malformedEvents += 1; continue; }
          const base = symbol.slice(0, -4);
          if (STABLES.has(base) || /(UP|DOWN|BULL|BEAR)$/.test(base)) continue;
          const last = finitePositive(row.c); const open = finitePositive(row.o); const high = finitePositive(row.h); const low = finitePositive(row.l); const volume = finiteNonnegative(row.v); const quoteVolume = finiteNonnegative(row.q);
          const eventTime = Number.isFinite(Number(row.E)) ? Number(row.E) : receivedAt;
          if (!(last && open && high && low && volume != null && quoteVolume != null) || !this.#validEventTimestamp(eventTime, receivedAt)) { this.metrics.rejectedTimestamps += 1; continue; }
          if (eventTime < (this.market.get(symbol)?.eventTime || 0)) { this.metrics.outOfOrderEvents += 1; continue; }
          this.market.set(symbol, { symbol, base, quote: "USDT", last, changePct: ((last / open) - 1) * 100, high, low, volume, quoteVolume, eventTime, receivedAt, receivedMono: nowMono, live: true });
          this.emit("market-price", { symbol, value: last, exchangeTimestamp: eventTime, receivedAt, source: "binance-mini-ticker", stale: false });
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
    socket.on("error", (error) => { if (this.closed || generation !== this.marketGeneration || socket !== this.marketSocket) return; this.metrics.lastError = error?.message || "Falha no radar"; try { socket.terminate(); } catch {} });
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
      this.socket = null; this.symbolOpenedMono = 0; this.lastSymbolEventMono = 0; this.state.connected = false; this.state.stale = true; this.state.dirty = true; this.metrics.reconnects += 1; this.metrics.lastDisconnectAt = this.clock.now();
      for (const item of Object.values(this.state.freshness)) if (item) { item.invalidated = true; item.stale = true; }
      if (!this.closed) { this.symbolHostIndex = (this.symbolHostIndex + 1) % this.streamHosts.length; const delay = Math.min(15000, this.reconnectBaseMs * (2 ** Math.min(this.retry++, 4))) + Math.random() * 300; this.symbolReconnectTimer = setTimeout(() => this.#connectSymbol(generation), delay); }
    });
    socket.on("error", (error) => { if (this.closed || generation !== this.symbolGeneration || socket !== this.socket) return; this.metrics.lastError = error?.message || "Falha no fluxo"; try { socket.terminate(); } catch {} });
  }

  #fresh(component, exchangeTimestamp, receivedAt, receivedMono) {
    this.state.freshness[component] = { exchangeTimestamp, receivedAt, receivedMono, ageMs: 0, stale: false };
    this.state.lastEventAt = Math.max(this.state.lastEventAt, receivedAt);
    this.state.connected = true;
  }

  #connectAlertPrices(generation) {
    if (this.closed || generation !== this.alertGeneration || !this.alertSymbols.size || this.#socketReady(this.alertSocket)) return;
    const host = this.streamHosts[generation % this.streamHosts.length];
    const socket = new this.WebSocketImpl(`${host}/ws`, { handshakeTimeout: 10000 });
    this.alertSocket = socket;
    socket.on("open", () => {
      if (generation !== this.alertGeneration || socket !== this.alertSocket) return;
      this.metrics.alertHost = host;
      try { socket.send(JSON.stringify({ method: "SUBSCRIBE", params: [...this.alertSymbols].map((symbol) => `${symbol.toLowerCase()}@aggTrade`), id: generation })); }
      catch (error) { this.emit("warning", error); try { socket.terminate(); } catch {} }
    });
    socket.on("message", (raw) => {
      if (generation !== this.alertGeneration || socket !== this.alertSocket || this.closed) return;
      try {
        const data = JSON.parse(raw.toString());
        if (data?.result === null || data?.e !== "aggTrade") return;
        const symbol = String(data.s || "").toUpperCase();
        if (!this.alertSymbols.has(symbol)) return;
        const receivedAt = this.clock.now(); const price = finitePositive(data.p); const exchangeTimestamp = Number(data.T); const tradeId = String(data.a ?? "");
        if (!price || !tradeId || !this.#validEventTimestamp(exchangeTimestamp, receivedAt)) { this.metrics.rejectedTimestamps += 1; return; }
        if (this.alertTradeIds.get(symbol) === tradeId) return;
        this.alertTradeIds.set(symbol, tradeId);
        this.emit("alert-price", { symbol, value: price, exchangeTimestamp, receivedAt, source: "binance-alert-aggtrade", stale: false, tradeId });
      } catch (error) { this.metrics.malformedEvents += 1; this.emit("warning", error); }
    });
    socket.on("close", () => {
      if (generation !== this.alertGeneration || socket !== this.alertSocket) return;
      this.alertSocket = null; this.metrics.alertReconnects += 1;
      if (!this.closed && this.alertSymbols.size) this.alertReconnectTimer = setTimeout(() => this.#connectAlertPrices(generation), 1500 + Math.random() * 500);
    });
    socket.on("error", (error) => { if (this.closed || generation !== this.alertGeneration || socket !== this.alertSocket) return; this.metrics.lastError = error?.message || "Falha no fluxo de alertas"; try { socket.terminate(); } catch {} });
  }

  #validEventTimestamp(exchangeTimestamp, receivedAt) {
    return Number.isFinite(Number(exchangeTimestamp)) && Number(exchangeTimestamp) <= receivedAt + EVENT_FUTURE_TOLERANCE_MS && Number(exchangeTimestamp) >= receivedAt - EVENT_MAX_LAG_MS;
  }

  #connectionStale(nowMono = performance.now()) {
    const activity = this.lastSymbolEventMono || this.symbolOpenedMono;
    if (!activity || nowMono - activity > SYMBOL_SILENCE_RECONNECT_MS) return true;
    return !["candle", "book", "ticker"].some((component) => (component!=='candle'||!this.state.candle?.awaitingExchange) && this.state.freshness[component] && !this.state.freshness[component].stale);
  }

  #rememberPrice(datum) {
    const rows = this.priceHistory.get(datum.symbol) || [];
    rows.push(datum);
    const minimum = datum.exchangeTimestamp - 10 * 60 * 1000;
    while (rows.length && rows[0].exchangeTimestamp < minimum) rows.shift();
    if (rows.length > 20000) rows.splice(0, rows.length - 20000);
    this.priceHistory.set(datum.symbol, rows);
  }

  #refreshFlow(now) {
    // A cursor avoids shifting the entire queue for each trade in a burst.
    const minimum = now - 60000;
    while (this.flowHead < this.flowQueue.length && this.flowQueue[this.flowHead].t < minimum) {
      const trade = this.flowQueue[this.flowHead++], quote = trade.price * trade.quantity;
      if (trade.side === "buy") { this.flowTotals.buy -= trade.quantity; this.flowTotals.buyQuote -= quote; }
      else { this.flowTotals.sell -= trade.quantity; this.flowTotals.sellQuote -= quote; }
      this.tradeIds.delete(trade.id); this.flowDirty = true; this.state.dirty = true;
    }
    if (!this.flowDirty) return;
    if (this.flowHead === this.flowQueue.length) {
      this.flowQueue = []; this.flowHead = 0;
      this.flowTotals = { buy: 0, sell: 0, buyQuote: 0, sellQuote: 0 };
    } else if (this.flowHead > 2048 && this.flowHead * 2 >= this.flowQueue.length) {
      this.flowQueue = this.flowQueue.slice(this.flowHead); this.flowHead = 0;
    }
    const count = this.flowQueue.length - this.flowHead, totals = this.flowTotals, total = totals.buy + totals.sell;
    this.state.trades = this.flowQueue.slice(Math.max(this.flowHead, this.flowQueue.length - 160)).reverse();
    this.state.flow = { buyVolume: totals.buy, sellVolume: totals.sell, buyQuoteVolume: totals.buyQuote, sellQuoteVolume: totals.sellQuote, delta: totals.buy - totals.sell, deltaQuote: totals.buyQuote - totals.sellQuote, buyRatio: total ? totals.buy / total : null, windowMs: 60000, sampleDurationMs: count ? Math.max(0, this.flowQueue.at(-1).t - this.flowQueue[this.flowHead].t) : 0, trades: count };
    this.flowDirty = false;
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
        const eventTime = Number(data.E || receivedAt); if (!this.#validEventTimestamp(eventTime, receivedAt)) { this.metrics.rejectedTimestamps += 1; return; }
        const previous = this.state.candle;
        if(previous&&candle.t<previous.t&&candle.closed&&candle.closeTime+1===previous.t){
          this.publish('candle-closed',{...candle,symbol:context.symbol,interval:context.interval});return;
        }
        if (previous && (candle.t < previous.t || (candle.t === previous.t && ((!previous.awaitingExchange && eventTime < this.state.freshness.candle.exchangeTimestamp) || (previous.closed && !candle.closed))))) { this.metrics.outOfOrderEvents += 1; return; }
        this.state.candle = candle;
        // Trades update the provisional OHLC between official kline events.
        // Volumes remain exchange-reported; never add trades on top of kline totals.
        const tickerTime = this.state.freshness.ticker?.exchangeTimestamp;
        const lastKlineId=sequenceId(k.L),newerTrade=this.latestRawTradeId!=null&&lastKlineId!=null&&this.latestRawTradeId>lastKlineId;
        if (!candle.closed && (tickerTime > eventTime || newerTrade) && tickerTime >= candle.t && tickerTime <= candle.closeTime) {
          candle.close = this.state.ticker.last; candle.high = Math.max(candle.high, candle.close); candle.low = Math.min(candle.low, candle.close);
          if(previous?.t===candle.t){candle.high=Math.max(candle.high,previous.high);candle.low=Math.min(candle.low,previous.low);}
        }
        this.#fresh("candle", eventTime, receivedAt, receivedMono); accepted = true;
      } else if (data.e === "aggTrade") {
        if (String(data.s || "").toUpperCase() !== context.symbol) return;
        const trade = { id: String(data.a ?? ""), t: Number(data.T), price: finitePositive(data.p), quantity: finitePositive(data.q), side: data.m ? "sell" : "buy" };
        if (!trade.id || !Number.isFinite(trade.t) || !trade.price || !trade.quantity || !this.#validEventTimestamp(trade.t, receivedAt)) { this.metrics.rejectedTimestamps += 1; return; }
        if (this.tradeIds.has(trade.id)) { this.metrics.duplicateTrades += 1; return; }
        const aggregateId=sequenceId(data.a);
        if(aggregateId==null){this.metrics.malformedEvents+=1;return;}
        if(this.latestAggregateId!=null&&aggregateId<=this.latestAggregateId){this.metrics.outOfOrderEvents+=1;return;}
        if (trade.t < (this.state.freshness.ticker?.exchangeTimestamp || 0)) { this.metrics.outOfOrderEvents += 1; return; }
        this.latestAggregateId=aggregateId;this.latestRawTradeId=sequenceId(data.l);
        this.tradeIds.set(trade.id, trade.t);
        this.flowQueue.push(trade);
        const quote = trade.price * trade.quantity;
        if (trade.side === "buy") { this.flowTotals.buy += trade.quantity; this.flowTotals.buyQuote += quote; } else { this.flowTotals.sell += trade.quantity; this.flowTotals.sellQuote += quote; }
        this.flowDirty = true;
        const current = this.state.ticker || { bid: null, ask: null, bidQuantity: null, askQuantity: null, spread: null, spreadPct: null };
        this.state.ticker = { ...current, last: trade.price };
        // A first observed trade is only a visual preview. The official kline
        // supplies the true opening price and accumulated exchange volume.
        const frame=Number.parseInt(context.interval,10)*({m:60000,h:3600000,d:86400000}[context.interval.at(-1)]);
        const start=Math.floor(trade.t/frame)*frame;
        if(!this.state.candle||trade.t>this.state.candle.closeTime){
          this.state.candle={t:start,closeTime:start+frame-1,open:trade.price,high:trade.price,low:trade.price,close:trade.price,volume:0,closed:false,awaitingExchange:true,volumeAvailable:false};
          this.#fresh('candle',trade.t,receivedAt,receivedMono);
        }
        const candle = this.state.candle;
        if (candle && !candle.closed && trade.t >= candle.t && trade.t <= candle.closeTime && trade.t >= this.state.freshness.candle.exchangeTimestamp) {
          candle.close = trade.price; candle.high = Math.max(candle.high, trade.price); candle.low = Math.min(candle.low, trade.price);
        }
        const priceDatum = { symbol: context.symbol, value: trade.price, exchangeTimestamp: trade.t, receivedAt, source: "binance-aggtrade", stale: false, tradeId: trade.id, generation: context.generation };
        this.#rememberPrice(priceDatum);
        this.emit("price", structuredClone(priceDatum));
        this.#fresh("ticker", trade.t, receivedAt, receivedMono); this.#fresh("flow", trade.t, receivedAt, receivedMono); accepted = true;
      } else if (data.e === "depthUpdate") {
        // This subscription uses partial depth snapshots, not incremental diffs.
        this.metrics.malformedEvents += 1; return;
      } else if (Array.isArray(data.bids) && Array.isArray(data.asks)) {
        if (data.s && String(data.s).toUpperCase() !== context.symbol) return;
        const id = sequenceId(data.lastUpdateId);
        if (id == null) { this.metrics.malformedEvents += 1; return; }
        if (this.depthUpdateId != null && id < this.depthUpdateId) { this.metrics.outOfOrderEvents += 1; return; }
        const parse = (rows, order) => {
          if (rows.length > 500 || !rows.every(row => Array.isArray(row) && row.length >= 2 && finitePositive(row[0]) && finiteNonnegative(row[1]) != null)) return [];
          return [...new Map(rows.map(([price, quantity]) => [Number(price), Number(quantity)])).entries()].filter(([, quantity]) => quantity > 0).sort((a, b) => order * (a[0] - b[0])).slice(0, 20);
        };
        const bids = parse(data.bids, -1); const asks = parse(data.asks, 1);
        if (!bids.length || !asks.length || Math.max(...bids.map(([p]) => p)) > Math.min(...asks.map(([p]) => p))) return;
        if (id === this.depthUpdateId && (JSON.stringify(bids) !== JSON.stringify(this.state.book.bids) || JSON.stringify(asks) !== JSON.stringify(this.state.book.asks))) { this.metrics.outOfOrderEvents += 1; return; }
        const mid = (bids[0][0] + asks[0][0]) / 2;
        const weighted = (rows) => rows.reduce((sum, [price, quantity]) => sum + quantity / (1 + Math.abs(price - mid) / mid * 1000), 0);
        const bidVolume = weighted(bids); const askVolume = weighted(asks);
        const eventTime = Number(data.E || receivedAt); if (!this.#validEventTimestamp(eventTime, receivedAt)) { this.metrics.rejectedTimestamps += 1; return; }
        this.state.book = { bids, asks, bidVolume, askVolume, imbalance: bidVolume + askVolume ? bidVolume / (bidVolume + askVolume) : 0.5 };
        this.depthUpdateId = id;
        this.#fresh("book", eventTime, receivedAt, receivedMono); accepted = true;
      } else if (data.b && data.a && data.B != null && data.A != null) {
        if (data.s && String(data.s).toUpperCase() !== context.symbol) return;
        const bid = finitePositive(data.b); const ask = finitePositive(data.a); const bidQuantity = finiteNonnegative(data.B); const askQuantity = finiteNonnegative(data.A);
        if (!bid || !ask || bid > ask || bidQuantity == null || askQuantity == null) return;
        const id = sequenceId(data.u);
        if (id == null) { this.metrics.malformedEvents += 1; return; }
        if (this.quoteUpdateId != null && id <= this.quoteUpdateId) { this.metrics.outOfOrderEvents += 1; return; }
        const mid = (bid + ask) / 2;
        const eventTime = Number(data.E || receivedAt); if (!this.#validEventTimestamp(eventTime, receivedAt)) { this.metrics.rejectedTimestamps += 1; return; }
        this.state.ticker = { ...(this.state.ticker || {}), bid, ask, bidQuantity, askQuantity, spread: ask - bid, spreadPct: ((ask - bid) / mid) * 100 };
        this.quoteUpdateId = id;
        this.#fresh("quote", eventTime, receivedAt, receivedMono); accepted = true;
      }
      if (!accepted) return;
      this.lastSymbolEventMono = receivedMono;
      this.state.stale = this.#connectionStale(receivedMono);
      this.state.dirty = true;
    } catch (error) { this.metrics.malformedEvents += 1; this.emit("warning", error); }
  }

  #watchdog() {
    this.#refreshFlow(this.clock.now());
    const nowMono = performance.now(); let changed = false;
    for (const [component, threshold] of Object.entries(STREAM_FRESH_MS)) {
      const item = this.state.freshness[component];
      if (!item) continue;
      const ageMs = Math.max(0, nowMono - item.receivedMono, this.clock.now() - item.exchangeTimestamp);
      const stale = Boolean(item.invalidated || ageMs > threshold);
      if (stale !== item.stale || Math.abs(item.ageMs - ageMs) > 500) changed = true;
      item.ageMs = ageMs; item.stale = stale;
    }
    const stale = this.#connectionStale(nowMono);
    if (stale !== this.state.stale) { this.state.stale = stale; changed = true; }
    const symbolActivity = this.lastSymbolEventMono || this.symbolOpenedMono;
    if (this.socket?.readyState === this.WebSocketImpl.OPEN && symbolActivity && nowMono - symbolActivity > SYMBOL_SILENCE_RECONNECT_MS) { const socket = this.socket; this.metrics.lastError = "Fluxo aberto sem nenhuma mensagem válida; reconectando."; try { socket.terminate(); } catch {} }
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
    this.symbolGeneration += 1; this.marketGeneration += 1; this.alertGeneration += 1;
    clearTimeout(this.symbolReconnectTimer); clearTimeout(this.marketReconnectTimer); clearTimeout(this.alertReconnectTimer);
    this.symbolReconnectTimer = null; this.marketReconnectTimer = null; this.alertReconnectTimer = null;
    if (this.flushTimer) clearInterval(this.flushTimer); if (this.staleTimer) clearInterval(this.staleTimer);
    this.flushTimer = null; this.staleTimer = null;
    for (const socket of [this.socket, this.marketSocket, this.alertSocket]) { try { socket?.close(1000, "encerrando"); } catch {} }
    this.socket = null; this.marketSocket = null; this.alertSocket = null;
    this.clients.clear();
  }
}

module.exports = { RealtimeHub, STREAM_HOSTS, STREAM_FRESH_MS, EVENT_FUTURE_TOLERANCE_MS, EVENT_MAX_LAG_MS, SYMBOL_SILENCE_RECONNECT_MS, SNAPSHOT_INTERVAL_MS };
