"use strict";

const { JsonStore } = require("./storage.cjs");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SCHEMA_VERSION = 3;
const INTERVAL_MS = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "2h": 7200000, "4h": 14400000, "6h": 21600000, "8h": 28800000, "12h": 43200000, "1d": 86400000 };
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
  updatedAt: now,
});

function migrate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...initial(Number(value.updatedAt) || Date.now()),
    ...value,
    schemaVersion: SCHEMA_VERSION,
    buckets: value.buckets && typeof value.buckets === "object" && !Array.isArray(value.buckets) ? value.buckets : {},
    groups: value.groups && typeof value.groups === "object" && !Array.isArray(value.groups) ? value.groups : {},
    recent: Array.isArray(value.recent) ? value.recent.slice(-250) : [],
    skippedHorizon: Number(value.skippedHorizon) || 0,
  };
}

function validate(value) {
  return Boolean(value && value.schemaVersion === SCHEMA_VERSION && Number.isInteger(value.samples) && value.samples >= 0 && Number.isInteger(value.hits) && value.hits >= 0 && Number.isInteger(value.misses) && value.misses >= 0 && Number.isInteger(value.draws) && value.draws >= 0 && value.buckets && value.groups && Array.isArray(value.recent));
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

class AdaptiveCalibrator {
  constructor(dataDirectory, { now = () => Date.now() } = {}) {
    this.now = now;
    this.store = new JsonStore(dataDirectory, "adaptive-calibration.json", () => initial(this.now()), { migrate, validate });
  }

  profile({ symbol = "GLOBAL", interval = "15m" } = {}) {
    const data = this.store.value;
    const pairKey = `pair:${symbol}|${interval}`;
    const keys = [pairKey];
    const entries = keys.map((key) => data.buckets[key]).filter(Boolean);
    const evidence = entries.reduce((sum, item) => sum + item.samples, 0);
    const weighted = entries.reduce((sum, item) => sum + bayesianReliability(item) * Math.sqrt(Math.max(1, item.samples)), 0);
    const weight = entries.reduce((sum, item) => sum + Math.sqrt(Math.max(1, item.samples)), 0) || 1;
    const reliability = evidence ? weighted / weight : 0.5;
    const pairSamples = Number(data.buckets[pairKey]?.samples || 0);
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
      methodology: "Somente resultados com duração compatível com o timeframe; pesos isolados por par e timeframe.",
      updatedAt: data.updatedAt,
    };
  }

  recordSettled(trades = []) {
    const data = this.store.value;
    let changed = false;
    for (const trade of trades) {
      const reading = trade.analysisSnapshot;
      if (!reading || !["COMPRA", "VENDA"].includes(reading.signal)) continue;
      if (trade.result === "unresolved") continue;
      const expectedHorizonMs = Number(reading.expectedHorizonMs || INTERVAL_MS[reading.interval]);
      const tradeDurationMs = Number(trade.durationMs);
      if (!(expectedHorizonMs > 0) || !(tradeDurationMs >= expectedHorizonMs * 0.8)) {
        data.skippedHorizon = (data.skippedHorizon || 0) + 1;
        data.recent.push({ at: Number(trade.closedAt) || this.now(), symbol: reading.symbol, interval: reading.interval, predicted: reading.signal, skipped: true, reason: "horizonte_incompativel", tradeDurationMs: Number.isFinite(tradeDurationMs) ? tradeDurationMs : null, expectedHorizonMs });
        data.recent = data.recent.slice(-250); changed = true; continue;
      }
      const delta = Number(trade.exitPrice) - Number(trade.entryPrice);
      if (!Number.isFinite(delta) || Math.abs(delta) <= Math.abs(Number(trade.entryPrice)) * 1e-10) {
        data.draws += 1;
        changed = true;
        continue;
      }
      const actual = delta > 0 ? "COMPRA" : "VENDA";
      const hit = reading.signal === actual;
      data.samples += 1;
      if (hit) data.hits += 1;
      else data.misses += 1;
      const keys = ["global", `interval:${reading.interval}`, `symbol:${reading.symbol}`, `pair:${reading.symbol}|${reading.interval}`];
      keys.forEach((key) => update(bucket(data.buckets, key), hit));
      for (const reason of reading.reasons || []) {
        const points = Number(reason.points);
        if (!Number.isFinite(points) || points === 0 || !reason.group) continue;
        const groupName = String(reason.group).slice(0, 60);
        update(bucket(data.groups, `group:${reading.symbol}|${reading.interval}|${groupName}`), Math.sign(points) === (actual === "COMPRA" ? 1 : -1));
      }
      data.recent.push({
        at: Number(trade.closedAt) || this.now(),
        symbol: reading.symbol,
        interval: reading.interval,
        predicted: reading.signal,
        actual,
        hit,
        confidence: reading.confidence,
        score: reading.score,
      });
      data.recent = data.recent.slice(-250);
      changed = true;
    }
    if (changed) {
      data.updatedAt = this.now();
      this.store.save();
    }
    return this.status();
  }

  status() {
    const data = this.store.value;
    const accuracy = data.samples ? (data.hits / data.samples) * 100 : null;
    return {
      samples: data.samples,
      hits: data.hits,
      misses: data.misses,
      draws: data.draws,
      skippedHorizon: data.skippedHorizon || 0,
      accuracy: accuracy == null ? null : Number(accuracy.toFixed(2)),
      learning: data.samples < 12 ? "aquecendo" : data.samples < 60 ? "calibrando" : "maduro",
      recent: data.recent.slice(-30).reverse(),
      updatedAt: data.updatedAt,
    };
  }

  reset() {
    this.store.value = initial(this.now());
    this.store.save();
    return this.status();
  }

  static snapshot(analysis) {
    if (!analysis) return null;
    return {
      symbol: analysis.symbol,
      interval: analysis.interval,
      signal: analysis.signal,
      score: analysis.score,
      confidence: analysis.confidence,
      regime: analysis.regime,
      reasons: (analysis.reasons || []).slice(0, 20).map(({ group, points }) => ({ group, points })),
      expectedHorizonMs: INTERVAL_MS[analysis.interval] || null,
      at: analysis.ts,
    };
  }
}

module.exports = { AdaptiveCalibrator, bayesianReliability, INTERVAL_MS };
