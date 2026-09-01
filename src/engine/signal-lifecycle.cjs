"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");
const { cleanInterval, cleanSymbol, validateMarketDatum } = require("./contracts.cjs");

const SCHEMA_VERSION = 1;
const ACTIVE_DIRECTIONS = new Set(["COMPRA", "VENDA"]);
const ACTIVE_STATES = new Set(["CONFIRMED_BUY", "CONFIRMED_SELL", "WEAKENING_BUY", "WEAKENING_SELL", "SUSPENDED_DATA"]);
const VALID_STATES = new Set(["NEUTRAL", "CANDIDATE_BUY", "CANDIDATE_SELL", ...ACTIVE_STATES, "INVALIDATED"]);
const EVENT_TYPES = new Set(["signal-candidate", "signal-confirmed", "signal-weakened", "signal-invalidated", "signal-suspended", "signal-resumed", "signal-candidate-cancelled"]);
const id = () => crypto.randomBytes(12).toString("hex");
const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const finite = (value) => Number.isFinite(Number(value));
const timestamp = (value) => finite(value) && Number(value) > 0;
const validDirection = (value) => value == null || ACTIVE_DIRECTIONS.has(value);

const initial = (now = Date.now()) => ({ schemaVersion: SCHEMA_VERSION, current: {}, events: [], metrics: { evaluations: 0, candidates: 0, confirmed: 0, invalidated: 0, falseCandidates: 0 }, updatedAt: now });

function validCurrent(value) {
  return isObject(value)
    && typeof value.key === "string" && value.key.length <= 64
    && VALID_STATES.has(value.status)
    && typeof value.symbol === "string"
    && typeof value.interval === "string"
    && validDirection(value.direction)
    && Number.isInteger(Number(value.consistentEvaluations || 0))
    && Number.isInteger(Number(value.weakEvaluations || 0))
    && timestamp(value.lastEvaluatedAt)
    && (value.signalId == null || (typeof value.signalId === "string" && value.signalId.length <= 64))
    && (value.candidateSince == null || timestamp(value.candidateSince))
    && (value.confirmedAt == null || timestamp(value.confirmedAt))
    && (value.confirmedPrice == null || (finite(value.confirmedPrice) && Number(value.confirmedPrice) > 0))
    && (value.confirmedPriceAt == null || timestamp(value.confirmedPriceAt))
    && (value.invalidatedAt == null || timestamp(value.invalidatedAt));
}

function validEvent(value) {
  return isObject(value)
    && typeof value.eventId === "string" && value.eventId.length <= 64
    && EVENT_TYPES.has(value.type)
    && typeof value.key === "string" && value.key.length <= 64
    && typeof value.symbol === "string"
    && typeof value.interval === "string"
    && validDirection(value.direction)
    && timestamp(value.at)
    && (value.signalId == null || (typeof value.signalId === "string" && value.signalId.length <= 64));
}

function validate(value) {
  return isObject(value)
    && value.schemaVersion === SCHEMA_VERSION
    && isObject(value.current)
    && Object.values(value.current).every(validCurrent)
    && Array.isArray(value.events) && value.events.length <= 20000 && value.events.every(validEvent)
    && isObject(value.metrics)
    && ["evaluations", "candidates", "confirmed", "invalidated", "falseCandidates"].every((key) => Number.isInteger(Number(value.metrics[key])) && Number(value.metrics[key]) >= 0)
    && timestamp(value.updatedAt);
}

function stateFor(direction, prefix) { return `${prefix}_${direction === "COMPRA" ? "BUY" : "SELL"}`; }
function directionForState(state) { return /BUY$/.test(state) ? "COMPRA" : /SELL$/.test(state) ? "VENDA" : null; }

function rebasePlan(plan, analysisPrice, confirmedPrice, direction) {
  if (!isObject(plan) || !(Number(analysisPrice) > 0) || !(Number(confirmedPrice) > 0)) return null;
  const ratio = Number(confirmedPrice) / Number(analysisPrice);
  const scaled = (value) => Number.isFinite(Number(value)) ? Number((Number(value) * ratio).toPrecision(10)) : null;
  const next = { ...plan, entry: Number(confirmedPrice), stop: scaled(plan.stop), target1: scaled(plan.target1), target2: scaled(plan.target2), basedOn: "confirmed-market-price" };
  const valid = direction === "COMPRA"
    ? next.stop < next.entry && next.target1 > next.entry && next.target2 > next.entry
    : next.stop > next.entry && next.target1 < next.entry && next.target2 < next.entry;
  return valid ? next : null;
}

class SignalLifecycleStore {
  constructor(dataDirectory, { now = () => Date.now(), confirmationsRequired = 2, invalidationsRequired = 2, activationMargin = 4, holdMargin = 6, minimumQuality = 65, minimumMtfCoverage = 60, minimumMtfAlignment = 45, maxPriceAgeMs = 2500 } = {}) {
    this.now = now;
    this.config = { confirmationsRequired, invalidationsRequired, activationMargin, holdMargin, minimumQuality, minimumMtfCoverage, minimumMtfAlignment, maxPriceAgeMs };
    this.store = new JsonStore(dataDirectory, "signal-lifecycle.json", () => initial(this.now()), { validate });
  }

  #key(symbol, interval) { return `${cleanSymbol(symbol)}|${cleanInterval(interval)}`; }
  #neutral(key, symbol, interval, at) { return { key, symbol, interval, status: "NEUTRAL", direction: null, signalId: null, candidateSince: null, consistentEvaluations: 0, weakEvaluations: 0, lastEvaluatedAt: at, confirmedAt: null, confirmedPrice: null, confirmedPriceAt: null, invalidatedAt: null, invalidationReason: null }; }
  #emit(type, current, at, extra = {}) {
    const event = Object.freeze({ eventId: id(), type, key: current.key, symbol: current.symbol, interval: current.interval, direction: current.direction, signalId: current.signalId, at, ...structuredClone(extra) });
    this.store.value.events.push(event);
    this.store.value.events = this.store.value.events.slice(-20000);
    return structuredClone(event);
  }
  #eligible(analysis) {
    const direction = ACTIVE_DIRECTIONS.has(analysis?.signal) ? analysis.signal : null;
    const threshold = Number(analysis?.threshold || 30);
    const directionalScore = direction === "COMPRA" ? Number(analysis.score) : direction === "VENDA" ? -Number(analysis.score) : -Infinity;
    const mtf = analysis?.multiTimeframe || {};
    return Boolean(direction
      && directionalScore >= threshold + this.config.activationMargin
      && Number(analysis?.confidence || 0) >= this.config.minimumQuality
      && Number(analysis?.dataQuality?.score || 0) >= this.config.minimumQuality
      && mtf.status === "ready"
      && Number(mtf.coverage || 0) >= this.config.minimumMtfCoverage
      && Number(mtf.alignment || 0) >= this.config.minimumMtfAlignment);
  }
  #holding(analysis, direction) {
    if (analysis?.signal !== direction) return false;
    const threshold = Number(analysis?.threshold || 30);
    const directionalScore = direction === "COMPRA" ? Number(analysis.score) : -Number(analysis.score);
    return directionalScore >= threshold - this.config.holdMargin
      && Number(analysis?.dataQuality?.score || 0) >= this.config.minimumQuality - 10
      && analysis?.multiTimeframe?.status === "ready";
  }

  evaluate(analysis, priceDatum, at = this.now()) {
    const symbol = cleanSymbol(analysis?.symbol); const interval = cleanInterval(analysis?.interval); const key = this.#key(symbol, interval);
    const data = this.store.value; const previous = structuredClone(data.current[key] || this.#neutral(key, symbol, interval, at));
    let current = structuredClone(previous); const events = []; data.metrics.evaluations += 1;
    const datum = validateMarketDatum(priceDatum, { symbol, maxAgeMs: this.config.maxPriceAgeMs, maxExchangeAgeMs: this.config.maxPriceAgeMs, now: at });
    // Candle age is timeframe-dependent (a valid 4h candle can be hours old).
    // The analysis engine already scores that correctly; confirmation additionally
    // requires the independent realtime datum below to be at most maxPriceAgeMs old.
    const dataFresh = !analysis?.dataQuality || Number(analysis.dataQuality.score || 0) >= this.config.minimumQuality;
    if (!datum || datum.stale || !dataFresh) {
      if (ACTIVE_STATES.has(current.status) && current.status !== "SUSPENDED_DATA") {
        current.resumeStatus = current.status; current.status = "SUSPENDED_DATA"; current.lastEvaluatedAt = at;
        events.push(this.#emit("signal-suspended", current, at, { reason: "dados_realtime_atrasados" }));
      } else current.lastEvaluatedAt = at;
      data.current[key] = current; data.updatedAt = at; this.store.saveQueued();
      return { current: structuredClone(current), events };
    }
    if (current.status === "SUSPENDED_DATA") {
      current.status = VALID_STATES.has(current.resumeStatus) ? current.resumeStatus : "NEUTRAL"; delete current.resumeStatus;
      events.push(this.#emit("signal-resumed", current, at, { reason: "dados_realtime_restaurados" }));
    }
    const eligible = this.#eligible(analysis); const rawDirection = ACTIVE_DIRECTIONS.has(analysis.signal) ? analysis.signal : null;
    if (current.status === "NEUTRAL" || current.status === "INVALIDATED") {
      if (eligible) {
        current = { ...this.#neutral(key, symbol, interval, at), status: stateFor(rawDirection, "CANDIDATE"), direction: rawDirection, candidateSince: at, consistentEvaluations: 1, analysisId: analysis.id, lastEvaluationId: analysis.id };
        data.metrics.candidates += 1; events.push(this.#emit("signal-candidate", current, at, { analysisId: analysis.id }));
      } else current = this.#neutral(key, symbol, interval, at);
    } else if (/^CANDIDATE_/.test(current.status)) {
      if (!eligible || rawDirection !== current.direction) {
        data.metrics.falseCandidates += 1; events.push(this.#emit("signal-candidate-cancelled", current, at, { reason: "condicao_nao_persistiu", analysisId: analysis.id }));
        current = this.#neutral(key, symbol, interval, at);
      } else {
        if (analysis.id !== current.lastEvaluationId) current.consistentEvaluations += 1; current.lastEvaluationId = analysis.id; current.lastEvaluatedAt = at; current.analysisId = analysis.id;
        if (current.consistentEvaluations >= this.config.confirmationsRequired) {
          const signalId = id();
          current = { ...current, status: stateFor(current.direction, "CONFIRMED"), signalId, confirmedAt: at, confirmedPrice: datum.value, confirmedPriceAt: datum.exchangeTimestamp, confirmedPriceSource: datum.source || "realtime", sourceCandleCloseTime: analysis.latestCandleCloseTime, scoreAtConfirm: analysis.score, confidenceAtConfirm: analysis.confidence, mtfAlignment: analysis.multiTimeframe?.alignment ?? null, mtfCoverage: analysis.multiTimeframe?.coverage ?? null, dataQuality: analysis.dataQuality?.score ?? null, analysisId: analysis.id, confirmedPlan: rebasePlan(analysis.plan, analysis.price, datum.value, current.direction), weakEvaluations: 0 };
          data.metrics.confirmed += 1; events.push(this.#emit("signal-confirmed", current, at, { analysisId: analysis.id, confirmedPrice: datum.value, confirmedPriceAt: datum.exchangeTimestamp, sourceCandleCloseTime: analysis.latestCandleCloseTime }));
        }
      }
    } else if (ACTIVE_STATES.has(current.status)) {
      const confirmedDirection = current.direction || directionForState(current.status);
      if (this.#holding(analysis, confirmedDirection)) {
        const wasWeak = /^WEAKENING_/.test(current.status);
        current.status = stateFor(confirmedDirection, "CONFIRMED"); current.weakEvaluations = 0; current.lastEvaluatedAt = at; current.analysisId = analysis.id;
        if (wasWeak) events.push(this.#emit("signal-resumed", current, at, { reason: "condicao_recuperada", analysisId: analysis.id }));
      } else {
        current.weakEvaluations = Number(current.weakEvaluations || 0) + 1; current.status = stateFor(confirmedDirection, "WEAKENING"); current.lastEvaluatedAt = at;
        if (current.weakEvaluations === 1) events.push(this.#emit("signal-weakened", current, at, { reason: rawDirection && rawDirection !== confirmedDirection ? "direcao_oposta_em_avaliacao" : "perda_de_forca", analysisId: analysis.id }));
        if (current.weakEvaluations >= this.config.invalidationsRequired) {
          current.status = "INVALIDATED"; current.invalidatedAt = at; current.invalidationReason = rawDirection && rawDirection !== confirmedDirection ? "direcao_oposta_exige_nova_confirmacao" : "condicao_tecnica_nao_sustentada";
          data.metrics.invalidated += 1; events.push(this.#emit("signal-invalidated", current, at, { reason: current.invalidationReason, analysisId: analysis.id }));
        }
      }
    }
    data.current[key] = current; data.updatedAt = at; this.store.saveQueued();
    return { current: structuredClone(current), events };
  }

  current({ symbol = null, interval = null } = {}) {
    const values = Object.values(this.store.value.current);
    return values.filter((item) => (!symbol || item.symbol === cleanSymbol(symbol)) && (!interval || item.interval === cleanInterval(interval))).map((item) => structuredClone(item));
  }
  get(symbol, interval) { return structuredClone(this.store.value.current[this.#key(symbol, interval)] || null); }
  history({ symbol = null, interval = null, direction = null, from = null, to = null, limit = 200 } = {}) {
    return this.store.value.events.filter((event) => (!symbol || event.symbol === cleanSymbol(symbol)) && (!interval || event.interval === cleanInterval(interval)) && (!direction || event.direction === direction) && (!from || event.at >= Number(from)) && (!to || event.at <= Number(to))).slice(-Math.min(1000, Math.max(1, Number(limit) || 200))).reverse().map((event) => structuredClone(event));
  }
  health() { return { ...this.store.value.metrics, active: Object.values(this.store.value.current).filter((item) => ACTIVE_STATES.has(item.status)).length, candidates: Object.values(this.store.value.current).filter((item) => /^CANDIDATE_/.test(item.status)).length, config: { ...this.config }, persistence: this.store.diagnostics() }; }
  async flushPersistence() { await this.store.flush(); }
}

module.exports = { SignalLifecycleStore, SCHEMA_VERSION, initial, validate, rebasePlan, ACTIVE_STATES, EVENT_TYPES };
