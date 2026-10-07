"use strict";

const { AppError, cleanSymbol, cleanInterval, cleanLimit, finiteNumber, INTERVALS, validateMarketDatum } = require("./contracts.cjs");
const { ExchangeClock } = require("./clock.cjs");

const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com"];
const STABLES = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDE", "DAI", "EUR", "AEUR", "BRL"]);
const VERSION = require("../../package.json").version;

class MarketClient {
  constructor({ hosts = HOSTS, timeout = 8500, totalTimeout = 18000, cacheLimit = 300, clock = new ExchangeClock() } = {}) {
    this.hosts = [...hosts];
    this.timeout = timeout;
    this.totalTimeout = totalTimeout;
    this.cacheLimit = cacheLimit;
    this.clock = clock;
    this.cache = new Map();
    this.inFlight = new Map();
    this.controllers = new Set();
    this.closed = false;
    this.preferredHostIndex = 0;
    this.cooldownUntilMono = 0;
    this.lastHost = null;
    this.lastLatency = null;
    this.lastTotalLatency = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.failovers = 0;
    this.symbols = new Map();
  }

  #cacheGet(path) {
    const cached = this.cache.get(path);
    if (!cached) return null;
    if (performance.now() >= cached.expiresAtMono) { this.cache.delete(path); return null; }
    this.cache.delete(path);
    this.cache.set(path, cached);
    return structuredClone(cached.value);
  }

  #cachePut(path, value, ttl) {
    if (!(ttl > 0)) return;
    this.cache.set(path, { expiresAtMono: performance.now() + ttl, value: structuredClone(value) });
    while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
  }

  async get(pathname, params = {}, ttl = 0, { force = false, timing = null } = {}) {
    if (this.closed) throw new AppError("Cliente de mercado encerrado.", { status: 503, code: "MARKET_CLIENT_CLOSED" });
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null)).toString();
    const requestPath = query ? `${pathname}?${query}` : pathname;
    if (!force) {
      const cached = this.#cacheGet(requestPath);
      if (cached != null) return cached;
    }
    if (force) { const value = await this.#fetchFailover(requestPath, timing); this.#cachePut(requestPath, value, ttl); return structuredClone(value); }
    if (!force && this.inFlight.has(requestPath)) { const value = await this.inFlight.get(requestPath); this.#cachePut(requestPath, value, ttl); return structuredClone(value); }
    const task = this.#fetchFailover(requestPath).finally(() => this.inFlight.delete(requestPath));
    this.inFlight.set(requestPath, task);
    const value = await task;
    this.#cachePut(requestPath, value, ttl);
    return structuredClone(value);
  }

  async #fetchFailover(path, timing = null) {
    const errors = [];
    const totalStarted = performance.now();
    const remainingCooldown = this.cooldownUntilMono - performance.now();
    if (remainingCooldown > 0) throw new Error(`Binance em cooldown por limite de requisições (${Math.ceil(remainingCooldown / 1000)} s).`);
    for (let offset = 0; offset < this.hosts.length; offset += 1) {
      if (this.closed) break;
      if (performance.now() - totalStarted >= this.totalTimeout) break;
      const index = (this.preferredHostIndex + offset) % this.hosts.length;
      const host = this.hosts[index];
      const started = performance.now();
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        const perAttempt = Math.min(this.timeout, Math.max(500, this.totalTimeout - (performance.now() - totalStarted)));
        const response = await fetch(host + path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(perAttempt)]), headers: { "User-Agent": `DiefTrade/${VERSION} (public-market-data)` } });
        if (response.status === 418 || response.status === 429) {
          const retryAfter = Math.max(1, Number(response.headers?.get?.("retry-after")) || 5);
          this.cooldownUntilMono = performance.now() + retryAfter * 1000;
          throw new Error(`limite ${response.status}; aguarde ${retryAfter} s`);
        }
        if (response.status >= 400 && response.status < 500 && ![403, 451].includes(response.status)) throw Object.assign(new Error(`HTTP ${response.status}`), { deterministic: true });
        if (response.status === 403 || response.status === 451) throw new Error("indisponível na região");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let result;
        try { result = await response.json(); } catch (error) { throw new Error("A Binance retornou JSON inválido.", { cause: error }); }
        if (timing) { timing.requestStartedMono = started; timing.responseReceivedMono = performance.now(); }
        this.preferredHostIndex = index;
        this.lastHost = host;
        this.lastLatency = Math.round(performance.now() - started);
        this.lastTotalLatency = Math.round(performance.now() - totalStarted);
        this.lastSuccessAt = this.clock.now();
        this.lastError = null;
        return result;
      } catch (error) {
        this.failovers += 1;
        this.lastError = error.message;
        errors.push(`${host}: ${error.message}`);
        if (this.closed) break;
        if (error.deterministic || this.cooldownUntilMono > performance.now()) break;
      } finally {
        this.controllers.delete(controller);
      }
    }
    throw new Error(`Não foi possível consultar a Binance: ${errors.join(" | ") || "tempo total excedido"}`);
  }

  async syncClock() {
    // Failed hosts are not part of the successful request's clock round trip.
    let timing = {};
    let value = await this.get("/api/v3/time", {}, 0, { force: true, timing });
    let serverTime = finiteNumber(value.serverTime, "Horário da Binance");
    if (timing.responseReceivedMono - timing.requestStartedMono > 750) {
      const nextTiming = {};
      try {
        const next = await this.get("/api/v3/time", {}, 0, { force: true, timing: nextTiming });
        const nextTime = finiteNumber(next.serverTime, "Horário da Binance");
        if (nextTiming.responseReceivedMono - nextTiming.requestStartedMono < timing.responseReceivedMono - timing.requestStartedMono) { timing = nextTiming; serverTime = nextTime; }
      } catch { /* Keep the valid first sample when the refinement fails. */ }
    }
    return this.clock.sync(serverTime, timing);
  }

  async serverTime() { return this.get("/api/v3/time", {}, 5000); }

  async exchangeInfo(force = false) {
    const data = await this.get("/api/v3/exchangeInfo", {}, 15 * 60 * 1000, { force });
    const next = new Map();
    for (const row of data.symbols || []) {
      if (row.status !== "TRADING" || row.quoteAsset !== "USDT" || row.isSpotTradingAllowed === false) continue;
      const filters = Object.fromEntries((row.filters || []).map((filter) => [filter.filterType, filter]));
      next.set(row.symbol, { symbol: row.symbol, base: row.baseAsset, quote: row.quoteAsset, tickSize: Number(filters.PRICE_FILTER?.tickSize), stepSize: Number(filters.LOT_SIZE?.stepSize), minQty: Number(filters.LOT_SIZE?.minQty), minNotional: Number(filters.NOTIONAL?.minNotional || filters.MIN_NOTIONAL?.minNotional) });
    }
    this.symbols = next;
    return next;
  }

  async assertTradable(symbol) {
    const clean = cleanSymbol(symbol);
    if (!this.symbols.size) await this.exchangeInfo();
    if (!this.symbols.has(clean)) throw new AppError("O par não existe ou não está disponível para negociação spot.", { status: 422, code: "SYMBOL_NOT_TRADABLE" });
    return this.symbols.get(clean);
  }

  async topPairs(quote = "USDT", limit = 180) {
    const cleanLimitValue = cleanLimit(limit, 180, 500);
    const info = await this.exchangeInfo().catch(() => this.symbols);
    const rows = await this.get("/api/v3/ticker/24hr", {}, 12000);
    return rows.map((row) => {
      try {
        const symbol = cleanSymbol(row.symbol);
        const last = finiteNumber(row.lastPrice, "Último preço", { min: Number.MIN_VALUE });
        const quoteVolume = finiteNumber(row.quoteVolume, "Volume cotado", { min: 0 });
        const base = symbol.slice(0, -quote.length);
        if (!symbol.endsWith(quote) || STABLES.has(base) || /(UP|DOWN|BULL|BEAR)$/.test(base) || (info.size && !info.has(symbol))) return null;
        const bid = Number(row.bidPrice); const ask = Number(row.askPrice); const mid = bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
        return { symbol, base, quote, last, changePct: finiteNumber(row.priceChangePercent, "Variação"), high: finiteNumber(row.highPrice, "Máxima", { min: 0 }), low: finiteNumber(row.lowPrice, "Mínima", { min: 0 }), volume: finiteNumber(row.volume, "Volume", { min: 0 }), quoteVolume, trades: finiteNumber(row.count, "Negócios", { min: 0 }), spreadHint: mid ? ((ask - bid) / mid) * 100 : null, eventTime: Number(row.closeTime) || 0, receivedAt: this.clock.now(), live: false };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, cleanLimitValue);
  }

  async klines(symbol, interval = "15m", limit = 500, { force = false } = {}) {
    const clean = cleanSymbol(symbol);
    const frame = cleanInterval(interval);
    const rows = await this.get("/api/v3/klines", { symbol: clean, interval: frame, limit: Math.max(200, cleanLimit(limit, 500, 1000)) }, 2500, { force });
    const now = this.clock.now();
    return rows.map((row) => {
      const candle = { t: finiteNumber(row[0], "Abertura"), closeTime: finiteNumber(row[6], "Fechamento"), open: finiteNumber(row[1], "Abertura", { min: Number.MIN_VALUE }), high: finiteNumber(row[2], "Máxima", { min: Number.MIN_VALUE }), low: finiteNumber(row[3], "Mínima", { min: Number.MIN_VALUE }), close: finiteNumber(row[4], "Fechamento", { min: Number.MIN_VALUE }), volume: finiteNumber(row[5], "Volume", { min: 0 }), quoteVolume: finiteNumber(row[7], "Volume cotado", { min: 0 }), trades: finiteNumber(row[8], "Negócios", { min: 0 }), takerBuyVolume: finiteNumber(row[9], "Volume comprador", { min: 0 }), takerBuyQuoteVolume: finiteNumber(row[10], "Volume comprador cotado", { min: 0 }) };
      candle.closed = candle.closeTime <= now;
      return candle;
    });
  }

  async depth(symbol, limit = 100) {
    const clean = cleanSymbol(symbol);
    const allowed = [5, 10, 20, 50, 100, 500, 1000, 5000];
    const data = await this.get("/api/v3/depth", { symbol: clean, limit: allowed.includes(limit) ? limit : 100 }, 900);
    const parseRows = (rows, side) => (rows || []).map(([price, quantity]) => [finiteNumber(price, `${side} preço`, { min: Number.MIN_VALUE }), finiteNumber(quantity, `${side} quantidade`, { min: 0 })]);
    const bids = parseRows(data.bids, "Bid"); const asks = parseRows(data.asks, "Ask");
    if (bids[0] && asks[0] && bids[0][0] > asks[0][0]) throw new Error("Book REST cruzado/inválido.");
    return { lastUpdateId: finiteNumber(data.lastUpdateId, "ID do book", { min: 0 }), bids, asks };
  }

  async ticker(symbol, { force = false } = {}) {
    const clean = cleanSymbol(symbol);
    // O ticker de 24 h entrega last/bid/ask no mesmo snapshot HTTP. Isso evita
    // combinar respostas obtidas em instantes diferentes.
    const [snapshot, datum] = await Promise.all([
      this.get("/api/v3/ticker/24hr", { symbol: clean }, 500, { force }),
      this.latestTradeDatum(clean, { force }),
    ]);
    const last = finiteNumber(snapshot.lastPrice, "Último preço", { min: Number.MIN_VALUE });
    const bid = finiteNumber(snapshot.bidPrice, "Bid", { min: Number.MIN_VALUE });
    const ask = finiteNumber(snapshot.askPrice, "Ask", { min: Number.MIN_VALUE });
    if (bid > ask) throw new Error("Ticker REST inválido: bid acima do ask.");
    const mid = (bid + ask) / 2;
    return { symbol: clean, last, bid, ask, spread: ask - bid, spreadPct: ((ask - bid) / mid) * 100, datum };
  }

  async latestTradeDatum(symbol, { force = true } = {}) {
    const clean = cleanSymbol(symbol);
    // /ticker/24hr não informa quando o lastPrice realmente negociou. Para
    // entradas autoritativas usamos o negócio agregado mais recente, cujo T é
    // fornecido pela própria exchange. Um ativo ilíquido passa, assim, pelas
    // regras normais de freshness em vez de ganhar um timestamp local fictício.
    const rows = await this.get("/api/v3/aggTrades", { symbol: clean, limit: 1 }, 0, { force });
    const row = Array.isArray(rows) ? rows.at(-1) : null;
    const value = Number(row?.p);
    const exchangeTimestamp = Number(row?.T);
    if (!(value > 0) || !Number.isFinite(exchangeTimestamp)) throw new Error("A Binance não retornou um último negócio válido.");
    const receivedAt = this.clock.now();
    const datum = validateMarketDatum({ symbol: clean, value, exchangeTimestamp, receivedAt, source: "binance-rest-aggtrade", stale: false, tradeId: row.a }, { symbol: clean, now: receivedAt });
    if (!datum) throw new Error("O último negócio retornado pela Binance possui horário inválido.");
    return datum;
  }

  async priceAt(symbol, timestamp, { toleranceMs = 1500 } = {}) {
    const clean = cleanSymbol(symbol);
    const target = finiteNumber(timestamp, "Horário de expiração");
    const startTime = Math.floor(target - toleranceMs);
    const endTime = Math.floor(target);
    let params = { symbol: clean, startTime, endTime, limit: 1000 };
    let closest = null;
    let previousLastId = null;

    // A Binance devolve no máximo 1000 aggTrades por página e, com uma janela
    // temporal, começa pela cabeça da janela. Em momentos muito ativos isso não
    // contém necessariamente o último negócio antes do vencimento. Seguimos os
    // IDs até alcançar a cauda (ou o primeiro negócio posterior), sem jamais
    // aceitar uma cotação posterior ao target.
    for (;;) {
      const rows = await this.get("/api/v3/aggTrades", params, 0, { force: true });
      if (!Array.isArray(rows) || rows.length === 0) break;

      let lastId = null;
      let reachedAfterTarget = false;
      for (const row of rows) {
        const value = Number(row?.p);
        const exchangeTimestamp = Number(row?.T);
        const id = Number(row?.a);
        if (Number.isSafeInteger(id) && (lastId == null || id > lastId)) lastId = id;
        if (Number.isFinite(exchangeTimestamp) && exchangeTimestamp > target) {
          reachedAfterTarget = true;
          continue;
        }
        if (!(value > 0) || !Number.isFinite(exchangeTimestamp) || exchangeTimestamp < startTime) continue;
        if (!closest || exchangeTimestamp > closest.exchangeTimestamp || (exchangeTimestamp === closest.exchangeTimestamp && Number.isSafeInteger(id) && id > Number(closest.id))) {
          closest = { value, exchangeTimestamp, id: row.a };
        }
      }

      if (reachedAfterTarget || rows.length < 1000) break;
      if (!Number.isSafeInteger(lastId) || (previousLastId != null && lastId <= previousLastId)) {
        throw new Error("Não foi possível paginar o histórico da Binance com segurança.");
      }
      previousLastId = lastId;
      // fromId fornece continuidade exata inclusive quando milhares de trades
      // compartilham o mesmo milissegundo. A próxima página pode atravessar o
      // vencimento; esses itens são filtrados e encerram a busca.
      params = { symbol: clean, fromId: lastId + 1, limit: 1000 };
    }

    if (!closest || target - closest.exchangeTimestamp > toleranceMs) return null;
    return validateMarketDatum({ symbol: clean, value: closest.value, exchangeTimestamp: closest.exchangeTimestamp, receivedAt: this.clock.now(), source: "binance-aggtrade-history", stale: false, tradeId: closest.id }, { symbol: clean, now: this.clock.now() });
  }

  clearCache() { this.cache.clear(); }
  close() { this.closed = true; for (const controller of this.controllers) controller.abort(new Error("Aplicativo encerrando.")); this.controllers.clear(); this.cache.clear(); }
  status() { return { host: this.lastHost, latencyMs: this.lastLatency, totalLatencyMs: this.lastTotalLatency, cachedItems: this.cache.size, inFlight: this.inFlight.size, activeRequests: this.controllers.size, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, failovers: this.failovers, cooldownMs: Math.max(0, Math.round(this.cooldownUntilMono - performance.now())), clock: this.clock.status() }; }
}

module.exports = { MarketClient, HOSTS, INTERVALS };
