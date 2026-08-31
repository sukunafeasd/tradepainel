"use strict";

const { JsonStore } = require("./storage.cjs");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const initial = () => ({
  version: 1,
  samples: 0,
  hits: 0,
  misses: 0,
  draws: 0,
  buckets: {},
  groups: {},
  recent: [],
  updatedAt: Date.now(),
});

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
  constructor(dataDirectory) {
    this.store = new JsonStore(dataDirectory, "adaptive-calibration.json", initial);
  }

  profile({ symbol = "GLOBAL", interval = "15m" } = {}) {
    const data = this.store.value;
    const keys = ["global", `interval:${interval}`, `symbol:${symbol}`, `pair:${symbol}|${interval}`];
    const entries = keys.map((key) => data.buckets[key]).filter(Boolean);
    const evidence = entries.reduce((sum, item) => sum + item.samples, 0);
    const weighted = entries.reduce((sum, item) => sum + bayesianReliability(item) * Math.sqrt(Math.max(1, item.samples)), 0);
    const weight = entries.reduce((sum, item) => sum + Math.sqrt(Math.max(1, item.samples)), 0) || 1;
    const reliability = evidence ? weighted / weight : 0.5;
    const groups = {};
    for (const [name, value] of Object.entries(data.groups)) {
      const rate = bayesianReliability(value, 14, 0.5);
      const maturity = clamp(value.samples / 40, 0, 1);
      groups[name] = Number(clamp(1 + (rate - 0.5) * 0.8 * maturity, 0.82, 1.18).toFixed(4));
    }
    const maturity = clamp(data.samples / 60, 0, 1);
    return {
      enabled: true,
      samples: data.samples,
      reliability: Number(reliability.toFixed(4)),
      confidenceFactor: Number(clamp(1 + (reliability - 0.5) * 0.45 * maturity, 0.88, 1.08).toFixed(4)),
      thresholdAdjustment: Math.round(clamp((0.5 - reliability) * 18 * maturity, -2, 5)),
      groupWeights: groups,
      updatedAt: data.updatedAt,
    };
  }

  recordSettled(trades = []) {
    const data = this.store.value;
    let changed = false;
    for (const trade of trades) {
      const reading = trade.analysisSnapshot;
      if (!reading || !["COMPRA", "VENDA"].includes(reading.signal)) continue;
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
        update(bucket(data.groups, String(reason.group).slice(0, 60)), Math.sign(points) === (actual === "COMPRA" ? 1 : -1));
      }
      data.recent.push({
        at: Number(trade.closedAt) || Date.now(),
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
      data.updatedAt = Date.now();
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
      accuracy: accuracy == null ? null : Number(accuracy.toFixed(2)),
      learning: data.samples < 12 ? "aquecendo" : data.samples < 60 ? "calibrando" : "maduro",
      recent: data.recent.slice(-30).reverse(),
      updatedAt: data.updatedAt,
    };
  }

  reset() {
    this.store.value = initial();
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
      at: analysis.ts,
    };
  }
}

module.exports = { AdaptiveCalibrator, bayesianReliability };
