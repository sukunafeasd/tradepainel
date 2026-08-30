"use strict";

const EventEmitter = require("events");
const WebSocket = require("ws");

const STREAM_HOSTS = [
  "wss://stream.binance.com:9443",
  "wss://stream.binance.com:443",
  "wss://data-stream.binance.vision",
];

class RealtimeHub extends EventEmitter {
  constructor({ streamHosts = STREAM_HOSTS } = {}) {
    super();
    this.streamHosts = streamHosts;
    this.hostIndex = 0;
    this.socket = null;
    this.marketSocket = null;
    this.symbol = "BTCUSDT";
    this.interval = "15m";
    this.retry = 0;
    this.closed = false;
    this.state = this.#blankState();
    this.market = new Map();
    this.clients = new Set();
    this.flushTimer = setInterval(() => this.#flush(), 250);
    this.staleTimer = setInterval(() => this.#markStale(), 1000);
    this.flushTimer.unref();
    this.staleTimer.unref();
  }

  #blankState() {
    return {
      symbol: this.symbol,
      interval: this.interval,
      connected: false,
      stale: true,
      lastEventAt: 0,
      ticker: null,
      candle: null,
      book: { bids: [], asks: [], imbalance: null, bidVolume: 0, askVolume: 0 },
      trades: [],
      flow: { buyVolume: 0, sellVolume: 0, delta: 0, buyRatio: 0.5, windowMs: 60000 },
      dirty: true,
    };
  }

  start() {
    this.closed = false;
    this.#connectMarket();
    this.#connectSymbol();
  }

  select(symbol, interval = this.interval) {
    const clean = String(symbol || "").toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(clean)) throw new Error("Par inválido.");
    if (clean === this.symbol && interval === this.interval) return;
    this.symbol = clean;
    this.interval = interval;
    this.state = this.#blankState();
    if (this.socket) this.socket.close(1000, "troca de ativo");
    this.#connectSymbol();
  }

  snapshot() {
    const { dirty, ...safe } = this.state;
    return JSON.parse(JSON.stringify(safe));
  }

  marketSnapshot(limit = 180) {
    return [...this.market.values()]
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, limit);
  }

  addClient(send) {
    this.clients.add(send);
    send({ type: "snapshot", data: this.snapshot() });
    return () => this.clients.delete(send);
  }

  #connectMarket() {
    if (this.closed || this.marketSocket?.readyState === WebSocket.OPEN) return;
    const url = `${this.streamHosts[this.hostIndex % this.streamHosts.length]}/ws/!miniTicker@arr`;
    const socket = new WebSocket(url, { handshakeTimeout: 10000 });
    this.marketSocket = socket;
    socket.on("message", (raw) => {
      try {
        const rows = JSON.parse(raw.toString());
        if (!Array.isArray(rows)) return;
        rows.forEach((row) => {
          if (!String(row.s || "").endsWith("USDT")) return;
          const base = row.s.slice(0, -4);
          if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return;
          const last = Number(row.c);
          const open = Number(row.o);
          this.market.set(row.s, {
            symbol: row.s, base, quote: "USDT", last,
            changePct: open ? ((last / open) - 1) * 100 : 0,
            high: Number(row.h), low: Number(row.l), volume: Number(row.v), quoteVolume: Number(row.q), live: true,
          });
        });
        this.emit("market", this.marketSnapshot());
      } catch {}
    });
    socket.on("close", () => {
      if (!this.closed) setTimeout(() => this.#connectMarket(), 2500 + Math.random() * 1500);
    });
    socket.on("error", () => socket.terminate());
  }

  #connectSymbol() {
    if (this.closed) return;
    const lower = this.symbol.toLowerCase();
    const streams = [
      `${lower}@kline_${this.interval}`,
      `${lower}@aggTrade`,
      `${lower}@bookTicker`,
      `${lower}@depth20@100ms`,
    ].join("/");
    const url = `${this.streamHosts[this.hostIndex % this.streamHosts.length]}/stream?streams=${streams}`;
    const socket = new WebSocket(url, { handshakeTimeout: 10000 });
    this.socket = socket;
    socket.on("open", () => {
      this.retry = 0;
      this.state.connected = true;
      this.state.stale = false;
      this.state.dirty = true;
    });
    socket.on("message", (raw) => this.#handleMessage(raw));
    socket.on("close", () => {
      if (socket !== this.socket) return;
      this.state.connected = false;
      this.state.stale = true;
      this.state.dirty = true;
      if (!this.closed) {
        this.hostIndex = (this.hostIndex + 1) % this.streamHosts.length;
        const delay = Math.min(15000, 800 * (2 ** Math.min(this.retry++, 4))) + Math.random() * 500;
        setTimeout(() => this.#connectSymbol(), delay);
      }
    });
    socket.on("error", () => socket.terminate());
  }

  #handleMessage(raw) {
    try {
      const envelope = JSON.parse(raw.toString());
      const data = envelope.data || envelope;
      const now = Date.now();
      this.state.lastEventAt = now;
      this.state.connected = true;
      this.state.stale = false;
      if (data.e === "kline") {
        const k = data.k;
        this.state.candle = {
          t: Number(k.t), closeTime: Number(k.T), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c),
          volume: Number(k.v), quoteVolume: Number(k.q), trades: Number(k.n), takerBuyVolume: Number(k.V), closed: Boolean(k.x),
        };
      } else if (data.e === "aggTrade") {
        const trade = { id: data.a, t: Number(data.T), price: Number(data.p), quantity: Number(data.q), side: data.m ? "sell" : "buy" };
        this.state.trades.unshift(trade);
        this.state.trades = this.state.trades.filter((item) => now - item.t <= 60000).slice(0, 160);
        let buyVolume = 0;
        let sellVolume = 0;
        this.state.trades.forEach((item) => item.side === "buy" ? buyVolume += item.quantity : sellVolume += item.quantity);
        const total = buyVolume + sellVolume;
        this.state.flow = { buyVolume, sellVolume, delta: buyVolume - sellVolume, buyRatio: total ? buyVolume / total : 0.5, windowMs: 60000 };
      } else if (data.e === "depthUpdate" || (Array.isArray(data.bids) && Array.isArray(data.asks))) {
        const bids = (data.bids || data.b || []).map(([price, quantity]) => [Number(price), Number(quantity)]).filter(([, q]) => q > 0).slice(0, 20);
        const asks = (data.asks || data.a || []).map(([price, quantity]) => [Number(price), Number(quantity)]).filter(([, q]) => q > 0).slice(0, 20);
        const bidVolume = bids.reduce((sum, [, quantity]) => sum + quantity, 0);
        const askVolume = asks.reduce((sum, [, quantity]) => sum + quantity, 0);
        this.state.book = { bids, asks, bidVolume, askVolume, imbalance: bidVolume + askVolume ? bidVolume / (bidVolume + askVolume) : 0.5 };
      } else if (data.b && data.a && data.B != null && data.A != null) {
        const bid = Number(data.b);
        const ask = Number(data.a);
        const last = this.state.ticker?.last || (bid + ask) / 2;
        this.state.ticker = { last, bid, ask, bidQuantity: Number(data.B), askQuantity: Number(data.A), spread: ask - bid, spreadPct: last ? ((ask - bid) / last) * 100 : null };
      }
      if (data.e === "aggTrade" && this.state.ticker) this.state.ticker.last = Number(data.p);
      this.state.dirty = true;
      this.emit("update", this.snapshot());
    } catch (error) {
      this.emit("warning", error);
    }
  }

  #markStale() {
    const stale = !this.state.lastEventAt || Date.now() - this.state.lastEventAt > 5000;
    if (stale !== this.state.stale) {
      this.state.stale = stale;
      this.state.dirty = true;
    }
  }

  #flush() {
    if (!this.state.dirty) return;
    const payload = { type: "market", data: this.snapshot() };
    this.state.dirty = false;
    for (const send of this.clients) {
      try { send(payload); } catch { this.clients.delete(send); }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.flushTimer);
    clearInterval(this.staleTimer);
    for (const socket of [this.socket, this.marketSocket]) {
      try { socket?.close(1000, "encerrando"); } catch {}
    }
    this.clients.clear();
  }
}

module.exports = { RealtimeHub, STREAM_HOSTS };
