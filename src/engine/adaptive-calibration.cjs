"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SCHEMA_VERSION = 5;
const INTERVAL_MS = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "2h": 7200000, "4h": 14400000, "6h": 21600000, "8h": 28800000, "12h": 43200000, "1d": 86400000 };
const MIN_HORIZON_FACTOR = 0.8;
const MAX_HORIZON_FACTOR = 1.25;
const ACTIVE_SIGNALS = new Set(["COMPRA", "VENDA"]);
const MAX_RECENT = 250;
const MAX_SEEN = 10000;

const initial = (now = Date.now()) => ({
  schemaVersion: SCHEMA_VERSION,
  samples: 0,
  hits: 0,
  misses: 0,
  draws: 0,
  skippedHorizon: 0,
  buckets: {},
  groups: {},
  recent: [],
  shadowPending: [],
  shadowSeen: [],
  shadowSettled: 0,
  shadowSkipped: 0,
  updatedAt: now,
});

const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isFiniteTimestamp = (value) => Number.isFinite(value) && value > 0;
const validInterval = (value) => typeof value === "string" && Number.isFinite(INTERVAL_MS[value]);
const validSignal = (value) => ACTIVE_SIGNALS.has(value);
const validBucket = (value) => Boolean(isObject(value) && isCount(value.samples) && isCount(value.hits) && isCount(value.misses) && value.hits + value.misses === value.samples);
const validReason = (value) => Boolean(isObject(value) && typeof value.group === "string" && value.group.length > 0 && value.group.length <= 60 && Number.isFinite(value.points));

function validRecentRecord(value) {
  if (!isObject(value) || !isFiniteTimestamp(value.at) || typeof value.symbol !== "string" || value.symbol.length < 1 || value.symbol.length > 24 || !validInterval(value.interval) || !validSignal(value.predicted)) return false;
  if (value.skipped === true) return typeof value.reason === "string" && value.reason.length > 0;
  if (value.draw === true) return value.actual === "NEUTRO";
  return validSignal(value.actual) && typeof value.hit === "boolean";
}

function validShadowPending(value) {
  return Boolean(
    isObject(value)
    && typeof value.id === "string" && value.id.length >= 8 && value.id.length <= 80
    && typeof value.key === "string" && value.key.length > 0 && value.key.length <= 240
    && typeof value.symbol === "string" && value.symbol.length > 0 && value.symbol.length <= 24
    && validInterval(value.interval)
    && validSignal(value.predicted)
    && Number.isFinite(value.entryPrice) && value.entryPrice > 0
    && isFiniteTimestamp(value.observedAt)
    && isFiniteTimestamp(value.dueAt) && value.dueAt > value.observedAt
    && Number(value.expectedHorizonMs) === INTERVAL_MS[value.interval]
    && isCount(value.settlementAttempts)
    && (value.signalId == null || (typeof value.signalId === "string" && value.signalId.length >= 8 && value.signalId.length <= 80))
    && (value.analysisId == null || (typeof value.analysisId === "string" && value.analysisId.length > 0 && value.analysisId.length <= 240))
    && (value.nextSettlementAttemptAt == null || isFiniteTimestamp(value.nextSettlementAttemptAt))
    && Array.isArray(value.reasons) && value.reasons.every(validReason)
  );
}

function validSeen(value) {
  return Boolean(isObject(value) && typeof value.key === "string" && value.key.length > 0 && value.key.length <= 240 && isFiniteTimestamp(value.at));
}

function validate(value) {
  return Boolean(
    isObject(value)
    && value.schemaVersion === SCHEMA_VERSION
    && isCount(value.samples) && isCount(value.hits) && isCount(value.misses) && value.hits + value.misses === value.samples
    && isCount(value.draws) && isCount(value.skippedHorizon)
    && isObject(value.buckets) && Object.entries(value.buckets).every(([key, entry]) => key.length > 0 && key.length <= 160 && validBucket(entry))
    && (!value.buckets.global || (value.buckets.global.samples === value.samples && value.buckets.global.hits === value.hits && value.buckets.global.misses === value.misses))
    && isObject(value.groups) && Object.entries(value.groups).every(([key, entry]) => key.length > 0 && key.length <= 220 && validBucket(entry))
    && Array.isArray(value.recent) && value.recent.length <= MAX_RECENT && value.recent.every(validRecentRecord)
    && Array.isArray(value.shadowPending) && value.shadowPending.every(validShadowPending)
    && Array.isArray(value.shadowSeen) && value.shadowSeen.length <= MAX_SEEN && value.shadowSeen.every(validSeen)
    && new Set(value.shadowSeen.map((item) => item.key)).size === value.shadowSeen.length
    && isCount(value.shadowSettled) && isCount(value.shadowSkipped)
    && isFiniteTimestamp(value.updatedAt)
  );
}

function safeCount(value) { return isCount(value) ? value : 0; }
function sanitizeBucketMap(value, maximumKeyLength) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => typeof key === "string" && key.length > 0 && key.length <= maximumKeyLength && validBucket(entry)));
}

function migrate(value) {
  if (!isObject(value)) return value;
  // Current-schema corruption must reach validate() so JsonStore can recover from
  // its backup/quarantine instead of silently deleting malformed nested records.
  if (value.schemaVersion === SCHEMA_VERSION || Number(value.schemaVersion) > SCHEMA_VERSION) return value;
  const hits = safeCount(value.hits);
  const misses = safeCount(value.misses);
  const pending = Array.isArray(value.shadowPending) ? value.shadowPending.filter(validShadowPending) : [];
  const seen = Array.isArray(value.shadowSeen) ? value.shadowSeen.filter(validSeen).slice(-MAX_SEEN) : [];
  return {
    ...initial(isFiniteTimestamp(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now()),
    samples: hits + misses,
    hits,
    misses,
    draws: safeCount(value.draws),
    skippedHorizon: safeCount(value.skippedHorizon),
    buckets: sanitizeBucketMap(value.buckets, 160),
    groups: sanitizeBucketMap(value.groups, 220),
    recent: Array.isArray(value.recent) ? value.recent.filter(validRecentRecord).slice(-MAX_RECENT) : [],
    shadowPending: pending,
    shadowSeen: [...new Map(seen.map((item) => [item.key, item])).values()],
    shadowSettled: safeCount(value.shadowSettled),
    shadowSkipped: safeCount(value.shadowSkipped),
  };
}

function bucket(map, key) {
  if (!map[key]) map[key] = { samples: 0, hits: 0, misses: 0 };
  return map[key];
}

function update(target, hit) {
  target.samples += 1;
  if (hit) target.hits += 1;
  else target.misses += 1;
}

function bayesianReliability(entry, priorSamples = 10, priorRate = 0.5) {
  const samples = Number(entry?.samples || 0);
  const hits = Number(entry?.hits || 0);
  return (hits + priorSamples * priorRate) / (samples + priorSamples);
}

function horizonCompatibility(durationMs, expectedHorizonMs, { minimumFactor = MIN_HORIZON_FACTOR, maximumFactor = MAX_HORIZON_FACTOR } = {}) {
  const duration = Number(durationMs);
  const expected = Number(expectedHorizonMs);
  if (!(expected > 0) || !Number.isFinite(duration)) return { compatible: false, reason: "horizonte_invalido" };
  if (duration < expected * minimumFactor) return { compatible: false, reason: "horizonte_muito_curto" };
  if (duration > expected * maximumFactor) return { compatible: false, reason: "horizonte_muito_longo" };
  return { compatible: true, reason: null };
}

function normalizedReasons(reasons) {
  return (Array.isArray(reasons) ? reasons : []).slice(0, 20).map((reason) => ({ group: String(reason?.group || "").slice(0, 60), points: Number(reason?.points) })).filter(validReason);
}

function signalObservationKey(reading) {
  const identity = Number(reading?.latestCandleCloseTime || reading?.latestCandleOpenTime || reading?.at);
  if (!reading?.symbol || !validInterval(reading.interval) || !validSignal(reading.signal) || !isFiniteTimestamp(identity)) return null;
  // One unbiased observation per closed candle. The direction is deliberately
  // not part of the key, so a noisy intrabar micro update cannot teach both
  // COMPRA and VENDA for the same market horizon.
  return `${String(reading.symbol).toUpperCase()}|${reading.interval}|${identity}`.slice(0, 240);
}

function pushRecent(data, value) { data.recent.push(value); data.recent = data.recent.slice(-MAX_RECENT); }

function recordOutcome(data, reading, entryPrice, exitPrice, at, source) {
  const delta = Number(exitPrice) - Number(entryPrice);
  if (!Number.isFinite(delta) || !Number.isFinite(Number(entryPrice)) || !(Number(entryPrice) > 0)) return null;
  const common = { at, symbol: reading.symbol, interval: reading.interval, predicted: reading.signal, confidence: reading.confidence, score: reading.score, source };
  if (Math.abs(delta) <= Math.abs(Number(entryPrice)) * 1e-10) {
    data.draws += 1;
    pushRecent(data, { ...common, actual: "NEUTRO", draw: true });
    return "draw";
  }
  const actual = delta > 0 ? "COMPRA" : "VENDA";
  const hit = reading.signal === actual;
  data.samples += 1;
  if (hit) data.hits += 1;
  else data.misses += 1;
  ["global", `interval:${reading.interval}`, `symbol:${reading.symbol}`, `pair:${reading.symbol}|${reading.interval}`].forEach((key) => update(bucket(data.buckets, key), hit));
  for (const reason of normalizedReasons(reading.reasons)) {
    if (reason.points === 0) continue;
    update(bucket(data.groups, `group:${reading.symbol}|${reading.interval}|${reason.group}`), Math.sign(reason.points) === (actual === "COMPRA" ? 1 : -1));
  }
  pushRecent(data, { ...common, actual, hit });
  return hit ? "hit" : "miss";
}

function shadowResolutionMap(resolutions) {
  if (Array.isArray(resolutions)) return Object.fromEntries(resolutions.filter((item) => item?.id).map((item) => [item.id, item.datum || item]));
  return isObject(resolutions) ? resolutions : {};
}

class AdaptiveCalibrator {
  constructor(dataDirectory, { now = () => Date.now(), maxShadowPending = 20000 } = {}) {
    this.now = now;
    this.maxShadowPending = Math.max(100, Number(maxShadowPending) || 20000);
    this.store = new JsonStore(dataDirectory, "adaptive-calibration.json", () => initial(this.now()), { migrate, validate });
  }

  profile({ symbol = "GLOBAL", interval = "15m" } = {}) {
    const data = this.store.value;
    const pairKey = `pair:${symbol}|${interval}`;
    const entry = data.buckets[pairKey];
    const pairSamples = Number(entry?.samples || 0);
    const reliability = pairSamples ? bayesianReliability(entry) : 0.5;
    const applied = pairSamples >= 30;
    const groups = {};
    const groupPrefix = `group:${symbol}|${interval}|`;
    for (const [key, value] of Object.entries(data.groups)) {
      if (!key.startsWith(groupPrefix)) continue;
      const name = key.slice(groupPrefix.length);
      const rate = bayesianReliability(value, 14, 0.5);
      const maturity = clamp(value.samples / 40, 0, 1);
      groups[name] = applied ? Number(clamp(1 + (rate - 0.5) * 0.6 * maturity, 0.88, 1.12).toFixed(4)) : 1;
    }
    const maturity = clamp(pairSamples / 60, 0, 1);
    return {
      enabled: true,
      samples: data.samples,
      pairSamples,
      applied,
      reliability: Number(reliability.toFixed(4)),
      confidenceFactor: applied ? Number(clamp(1 + (reliability - 0.5) * 0.3 * maturity, 0.94, 1.05).toFixed(4)) : 1,
      thresholdAdjustment: applied ? Math.round(clamp((0.5 - reliability) * 12 * maturity, -1, 3)) : 0,
      groupWeights: groups,
      methodology: "Somente sinais confirmados são avaliados automaticamente no horizonte exato; operações manuais vinculadas não duplicam a amostra; pesos são isolados por par e timeframe.",
      updatedAt: data.updatedAt,
    };
  }

  recordSettled(trades = []) {
    const data = this.store.value;
    let changed = false;
    for (const trade of trades) {
      const reading = trade.analysisSnapshot;
      if (!reading || !validSignal(reading.signal) || !validInterval(reading.interval) || typeof reading.symbol !== "string") continue;
      if (trade.result === "unresolved") continue;
      // Once a signal is part of the unbiased shadow dataset, a user-selected
      // operation from the same candle must not give that signal a second vote.
      const linkedSignalId = trade.signalId || reading.signalId || reading.signalLifecycle?.signalId;
      const observedKey = linkedSignalId ? `confirmed:${linkedSignalId}` : signalObservationKey(reading);
      if (observedKey && data.shadowSeen.some((item) => item.key === observedKey)) continue;
      const expectedHorizonMs = Number(reading.expectedHorizonMs || INTERVAL_MS[reading.interval]);
      const tradeDurationMs = Number(trade.durationMs);
      const compatibility = horizonCompatibility(tradeDurationMs, expectedHorizonMs);
      if (!compatibility.compatible) {
        data.skippedHorizon += 1;
        pushRecent(data, { at: Number(trade.closedAt) || this.now(), symbol: reading.symbol, interval: reading.interval, predicted: reading.signal, skipped: true, reason: compatibility.reason, tradeDurationMs: Number.isFinite(tradeDurationMs) ? tradeDurationMs : null, expectedHorizonMs, source: "operacao_demo" });
        changed = true;
        continue;
      }
      if (recordOutcome(data, reading, trade.entryPrice, trade.exitPrice, Number(trade.closedAt) || this.now(), "operacao_demo")) changed = true;
    }
    if (changed) {
      data.updatedAt = this.now();
      this.store.saveQueued();
    }
    return this.status();
  }

  observeConfirmedSignal(signal, analysis = null, now = this.now()) {
    if (!signal || !validSignal(signal.direction) || !signal.signalId || !isFiniteTimestamp(signal.confirmedAt) || !(Number(signal.confirmedPrice) > 0)) return { recorded: false, reason: "sinal_nao_confirmado" };
    const reading = analysis || {};
    const symbol = String(signal.symbol || reading.symbol || "").toUpperCase();
    const interval = String(signal.interval || reading.interval || "");
    const entryPrice = Number(signal.confirmedPrice);
    const expectedHorizonMs = INTERVAL_MS[interval];
    if (!symbol || symbol.length > 24 || !expectedHorizonMs || !(entryPrice > 0) || !isFiniteTimestamp(now)) return { recorded: false, reason: "sinal_invalido" };
    const key = `confirmed:${String(signal.signalId)}`.slice(0, 240);
    if (!key) return { recorded: false, reason: "sinal_invalido" };
    const alreadySeen = this.store.value.shadowSeen.some((item) => item.key === key);
    if (alreadySeen) return { recorded: false, reason: "duplicado" };
    if (this.store.value.shadowPending.length >= this.maxShadowPending) return { recorded: false, reason: "limite_pendente" };
    const observation = {
      id: crypto.createHash("sha256").update(key).digest("hex").slice(0, 24),
      key,
      symbol,
      interval,
      predicted: signal.direction,
      entryPrice,
      observedAt: Number(signal.confirmedAt),
      dueAt: Number(signal.confirmedAt) + expectedHorizonMs,
      expectedHorizonMs,
      confidence: Number.isFinite(Number(signal.confidenceAtConfirm ?? reading.confidence)) ? Number(signal.confidenceAtConfirm ?? reading.confidence) : null,
      score: Number.isFinite(Number(signal.scoreAtConfirm ?? reading.score)) ? Number(signal.scoreAtConfirm ?? reading.score) : null,
      reasons: normalizedReasons(reading.reasons),
      signalId: String(signal.signalId),
      analysisId: String(signal.analysisId || reading.id || "").slice(0, 240) || null,
      settlementAttempts: 0,
      nextSettlementAttemptAt: null,
    };
    this.store.value.shadowPending.push(observation);
    this.store.value.shadowSeen = [...this.store.value.shadowSeen, { key, at: now }].slice(-MAX_SEEN);
    this.store.value.updatedAt = now;
    this.store.saveQueued();
    return { recorded: true, observation: structuredClone(observation) };
  }

  observeSignal(analysis, now = this.now()) {
    if (analysis?.signalLifecycle?.signalId) return this.observeConfirmedSignal(analysis.signalLifecycle, analysis, now);
    return { recorded: false, reason: "aguardando_sinal_confirmado" };
  }

  shadowDue(now = this.now(), limit = 100) {
    const cleanLimit = clamp(Math.floor(Number(limit) || 100), 1, 1000);
    return this.store.value.shadowPending
      .filter((item) => item.dueAt <= now && (!item.nextSettlementAttemptAt || item.nextSettlementAttemptAt <= now))
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, cleanLimit)
      .map((item) => structuredClone(item));
  }

  settleShadow(resolutions = {}, now = this.now(), { toleranceMs = 1500, maxAttempts = 8, maxPendingMs = 2 * 60 * 1000 } = {}) {
    const data = this.store.value;
    const byId = shadowResolutionMap(resolutions);
    const remaining = [];
    const settled = [];
    let changed = false;
    for (const observation of data.shadowPending) {
      if (observation.dueAt > now || (observation.nextSettlementAttemptAt && observation.nextSettlementAttemptAt > now)) { remaining.push(observation); continue; }
      const datum = byId[observation.id];
      const exitPrice = Number(datum?.value ?? datum?.exitPrice);
      const exitPriceAt = Number(datum?.exchangeTimestamp ?? datum?.exitPriceAt);
      const validResolution = exitPrice > 0 && isFiniteTimestamp(exitPriceAt) && exitPriceAt <= observation.dueAt && observation.dueAt - exitPriceAt <= toleranceMs;
      if (!validResolution) {
        const attempts = observation.settlementAttempts + 1;
        const terminal = attempts >= maxAttempts || now - observation.dueAt >= maxPendingMs;
        changed = true;
        if (terminal) {
          data.shadowSkipped += 1;
          pushRecent(data, { at: now, symbol: observation.symbol, interval: observation.interval, predicted: observation.predicted, skipped: true, reason: "preco_historico_indisponivel", source: "shadow" });
          settled.push({ id: observation.id, status: "skipped" });
        } else {
          remaining.push({ ...observation, settlementAttempts: attempts, nextSettlementAttemptAt: now + Math.min(30000, 2000 * (2 ** Math.max(0, attempts - 1))) });
        }
        continue;
      }
      const reading = { symbol: observation.symbol, interval: observation.interval, signal: observation.predicted, confidence: observation.confidence, score: observation.score, reasons: observation.reasons };
      const outcome = recordOutcome(data, reading, observation.entryPrice, exitPrice, observation.dueAt, "shadow");
      if (outcome) {
        data.shadowSettled += 1;
        settled.push({ id: observation.id, status: "settled", outcome, exitPrice, exitPriceAt });
      } else {
        data.shadowSkipped += 1;
        settled.push({ id: observation.id, status: "skipped" });
      }
      changed = true;
    }
    if (changed) {
      data.shadowPending = remaining;
      data.updatedAt = now;
      this.store.saveQueued();
    }
    return settled;
  }

  status() {
    const data = this.store.value;
    const accuracy = data.samples ? (data.hits / data.samples) * 100 : null;
    return {
      samples: data.samples,
      hits: data.hits,
      misses: data.misses,
      draws: data.draws,
      skippedHorizon: data.skippedHorizon,
      accuracy: accuracy == null ? null : Number(accuracy.toFixed(2)),
      learning: data.samples < 12 ? "aquecendo" : data.samples < 60 ? "calibrando" : "maduro",
      shadow: { pending: data.shadowPending.length, pendingObservations: data.shadowPending.length, completedObservations: data.shadowSettled, droppedObservations: data.shadowSkipped, settled: data.shadowSettled, skipped: data.shadowSkipped },
      recent: data.recent.slice(-30).reverse(),
      updatedAt: data.updatedAt,
      persistence: this.store.diagnostics(),
    };
  }

  reset() {
    this.store.value = initial(this.now());
    this.store.saveQueued();
    return this.status();
  }

  async flushPersistence() { await this.store.flush(); }

  static snapshot(analysis) {
    if (!analysis) return null;
    return {
      symbol: analysis.symbol,
      interval: analysis.interval,
      signal: analysis.signal,
      score: analysis.score,
      confidence: analysis.confidence,
      regime: analysis.regime,
      reasons: normalizedReasons(analysis.reasons),
      expectedHorizonMs: INTERVAL_MS[analysis.interval] || null,
      latestCandleOpenTime: analysis.latestCandleOpenTime,
      latestCandleCloseTime: analysis.latestCandleCloseTime,
      at: analysis.ts,
    };
  }
}

module.exports = {
  AdaptiveCalibrator,
  bayesianReliability,
  horizonCompatibility,
  INTERVAL_MS,
  MIN_HORIZON_FACTOR,
  MAX_HORIZON_FACTOR,
  SCHEMA_VERSION,
  initial,
  migrate,
  validate,
  validBucket,
  validRecentRecord,
  validShadowPending,
};
