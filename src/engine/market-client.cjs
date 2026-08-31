"use strict";

const HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
];

const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"]);
const STABLES = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDE", "DAI", "EUR", "AEUR", "BRL"]);

class MarketClient {
  constructor({ hosts = HOSTS, timeout = 8500 } = {}) {
    this.hosts = hosts;
    this.timeout = timeout;
    this.cache = new Map();
    this.inFlight = new Map();
    this.lastHost = null;
    this.lastLatency = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.failovers = 0;
  }

  async get(pathname, params = {}, ttl = 0) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null)).toString();
    const path = query ? `${pathname}?${query}` : pathname;
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.ts < ttl) return cached.value;
    if (this.inFlight.has(path)) return this.inFlight.get(path);
    const task = this.#fetchFailover(path).finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, task);
    const value = await task;
    if (ttl) this.cache.set(path, { ts: Date.now(), value });
    return value;
  }

  async #fetchFailover(path) {
    const errors = [];
    for (const host of this.hosts) {
      const started = performance.now();
      try {
        const response = await fetch(host + path, {
          signal: AbortSignal.timeout(this.timeout),
          headers: { "User-Agent": "DiefTrade/0.2 (public-market-data)" },
        });
        if (response.status === 418 || response.status === 429) {
          errors.push(`${host}: limite ${response.status}`);
          continue;
        }
        if (response.status === 403 || response.status === 451) {
          errors.push(`${host}: indisponível na região`);
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        this.lastHost = host;
        this.lastLatency = Math.round(performance.now() - started);
        this.lastSuccessAt = Date.now();
        this.lastError = null;
        return result;
      } catch (error) {
        this.failovers += 1;
        this.lastError = error.message;
        errors.push(`${host}: ${error.message}`);
      }
    }
    throw new Error(`Não foi possível consultar a Binance: ${errors.slice(0, 3).join(" | ")}`);
  }

  async serverTime() {
    return this.get("/api/v3/time", {}, 5000);
  }

  async topPairs(quote = "USDT", limit = 180) {
    const rows = await this.get("/api/v3/ticker/24hr", {}, 12000);
    return rows
      .filter((row) => String(row.symbol || "").endsWith(quote) && Number(row.lastPrice) > 0)
      .filter((row) => {
        const base = row.symbol.slice(0, -quote.length);
        return !STABLES.has(base) && !/(UP|DOWN|BULL|BEAR)$/.test(base);
      })
      .map((row) => ({
        symbol: row.symbol,
        base: row.symbol.slice(0, -quote.length),
        quote,
        last: Number(row.lastPrice),
        changePct: Number(row.priceChangePercent) || 0,
        high: Number(row.highPrice) || 0,
        low: Number(row.lowPrice) || 0,
        volume: Number(row.volume) || 0,
        quoteVolume: Number(row.quoteVolume) || 0,
        trades: Number(row.count) || 0,
        spreadHint: Number(row.askPrice) > 0 && Number(row.bidPrice) > 0
          ? ((Number(row.askPrice) - Number(row.bidPrice)) / Number(row.lastPrice)) * 100
          : null,
      }))
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, Math.max(1, Math.min(limit, 500)));
  }

  async klines(symbol, interval = "15m", limit = 500) {
    const cleanSymbol = String(symbol || "").toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(cleanSymbol)) throw new Error("Par inválido.");
    if (!INTERVALS.has(interval)) throw new Error("Tempo gráfico inválido.");
    const rows = await this.get("/api/v3/klines", { symbol: cleanSymbol, interval, limit: Math.max(60, Math.min(limit, 1000)) }, 2500);
    return rows.map((row) => ({
      t: Number(row[0]),
      closeTime: Number(row[6]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      quoteVolume: Number(row[7]),
      trades: Number(row[8]),
      takerBuyVolume: Number(row[9]),
      takerBuyQuoteVolume: Number(row[10]),
      closed: Number(row[6]) < Date.now(),
    }));
  }

  async depth(symbol, limit = 100) {
    const cleanSymbol = String(symbol || "").toUpperCase();
    const data = await this.get("/api/v3/depth", { symbol: cleanSymbol, limit: [5, 10, 20, 50, 100, 500, 1000, 5000].includes(limit) ? limit : 100 }, 900);
    return {
      lastUpdateId: data.lastUpdateId,
      bids: data.bids.map(([price, quantity]) => [Number(price), Number(quantity)]),
      asks: data.asks.map(([price, quantity]) => [Number(price), Number(quantity)]),
    };
  }

  async ticker(symbol) {
    const [price, book] = await Promise.all([
      this.get("/api/v3/ticker/price", { symbol }, 1200),
      this.get("/api/v3/ticker/bookTicker", { symbol }, 700),
    ]);
    const last = Number(price.price);
    const bid = Number(book.bidPrice);
    const ask = Number(book.askPrice);
    return { symbol, last, bid, ask, spread: ask - bid, spreadPct: last ? ((ask - bid) / last) * 100 : null };
  }

  status() {
    return { host: this.lastHost, latencyMs: this.lastLatency, cachedItems: this.cache.size, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, failovers: this.failovers };
  }
}

module.exports = { MarketClient, HOSTS, INTERVALS };
