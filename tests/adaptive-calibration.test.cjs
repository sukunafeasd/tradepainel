"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AdaptiveCalibrator, initial, migrate, validate, horizonCompatibility, SCHEMA_VERSION } = require("../src/engine/adaptive-calibration.cjs");

test("calibração aprende de forma gradual sem pesos extremos", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-calibration-"));
  try {
    const calibration = new AdaptiveCalibrator(dir);
    const trade = (hit, at) => ({
      entryPrice: 100,
      exitPrice: hit ? 101 : 99,
      closedAt: at, durationMs: 60000,
      analysisSnapshot: { symbol: "BTCUSDT", interval: "1m", signal: "COMPRA", confidence: 70, score: 40, reasons: [{ group: "momentum", points: 10 }] },
    });
    calibration.recordSettled(Array.from({ length: 20 }, (_, index) => trade(index < 14, Date.now() + index)));
    const status = calibration.status();
    const profile = calibration.profile({ symbol: "BTCUSDT", interval: "1m" });
    assert.equal(status.samples, 20);
    assert.equal(status.accuracy, 70);
    assert.ok(profile.reliability > 0.5);
    assert.ok(profile.groupWeights.momentum >= 0.82 && profile.groupWeights.momentum <= 1.18);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("calibração ignora horizonte incompatível e não transfere peso entre pares", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-calibration-scope-"));
  try {
    const calibration = new AdaptiveCalibrator(dir);
    const reading = (symbol) => ({ symbol, interval: "15m", signal: "COMPRA", confidence: 80, score: 50, reasons: [{ group: "momentum", points: 10 }] });
    calibration.recordSettled([{ entryPrice: 100, exitPrice: 101, closedAt: Date.now(), durationMs: 60000, result: "win", analysisSnapshot: reading("BTCUSDT") }]);
    assert.equal(calibration.status().samples, 0); assert.equal(calibration.status().skippedHorizon, 1);
    calibration.recordSettled([{ entryPrice: 100, exitPrice: 101, closedAt: Date.now(), durationMs: 1_200_000, result: "win", analysisSnapshot: reading("BTCUSDT") }]);
    assert.equal(calibration.status().samples, 0); assert.equal(calibration.status().skippedHorizon, 2);
    calibration.recordSettled(Array.from({ length: 30 }, (_, index) => ({ entryPrice: 100, exitPrice: 101, closedAt: Date.now() + index, durationMs: 900000, result: "win", analysisSnapshot: reading("BTCUSDT") })));
    assert.equal(calibration.profile({ symbol: "BTCUSDT", interval: "15m" }).applied, true);
    assert.equal(calibration.profile({ symbol: "ETHUSDT", interval: "15m" }).applied, false);
    assert.deepEqual(calibration.profile({ symbol: "ETHUSDT", interval: "15m" }).groupWeights, {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("compatibilidade de horizonte possui limite mínimo e máximo", () => {
  assert.equal(horizonCompatibility(719_999, 900_000).reason, "horizonte_muito_curto");
  assert.equal(horizonCompatibility(720_000, 900_000).compatible, true);
  assert.equal(horizonCompatibility(1_125_000, 900_000).compatible, true);
  assert.equal(horizonCompatibility(1_125_001, 900_000).reason, "horizonte_muito_longo");
});

test("schema v5 valida profundamente buckets, grupos, recentes e pendências shadow", () => {
  const clean = initial(1_700_000_000_000);
  assert.equal(validate(clean), true);
  assert.equal(validate({ ...clean, buckets: { global: { samples: 2, hits: 2, misses: 2 } } }), false);
  assert.equal(validate({ ...clean, groups: { bad: { samples: 1, hits: 1 } } }), false);
  assert.equal(validate({ ...clean, recent: [{}] }), false);
  assert.equal(validate({ ...clean, shadowPending: [{}] }), false);

  const legacy = migrate({ schemaVersion: 3, hits: 3, misses: 2, draws: 1, buckets: { global: { samples: 5, hits: 3, misses: 2 }, corrupt: {} }, groups: {}, recent: [{}], updatedAt: 1_700_000_000_000 });
  assert.equal(legacy.schemaVersion, SCHEMA_VERSION);
  assert.equal(legacy.samples, 5);
  assert.deepEqual(Object.keys(legacy.buckets), ["global"]);
  assert.deepEqual(legacy.recent, []);
  assert.equal(validate(legacy), true);
});

test("shadow calibration observa somente sinais confirmados e calibra timeframes longos", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-shadow-calibration-"));
  let now = 1_700_000_000_000;
  try {
    const calibration = new AdaptiveCalibrator(dir, { now: () => now });
    const analysis = {
      symbol: "BTCUSDT", interval: "1h", signal: "COMPRA", price: 100,
      confidence: 72, score: 45, latestCandleCloseTime: now - 1,
      reasons: [{ group: "momentum", points: 10 }],
    };
    const signal = { signalId: "confirmed-signal-0001", symbol: "BTCUSDT", interval: "1h", direction: "COMPRA", confirmedPrice: 100, confirmedAt: now, confidenceAtConfirm: 72, scoreAtConfirm: 45, analysisId: "analysis-1" };
    const first = calibration.observeConfirmedSignal(signal, { ...analysis, id: "analysis-1" });
    assert.equal(first.recorded, true);
    assert.equal(calibration.observeConfirmedSignal(signal, analysis).reason, "duplicado");
    assert.equal(calibration.shadowDue(now).length, 0);

    calibration.recordSettled([{
      signalId: signal.signalId,
      entryPrice: 100, exitPrice: 102, closedAt: now + 900_000, durationMs: 3_600_000, result: "win",
      analysisSnapshot: { ...analysis, expectedHorizonMs: 3_600_000 },
    }]);
    assert.equal(calibration.status().samples, 0, "uma operação selecionada não deve duplicar o sinal já observado pelo shadow");

    now += 3_600_000;
    const due = calibration.shadowDue(now);
    assert.equal(due.length, 1);
    const settled = calibration.settleShadow({ [due[0].id]: { value: 102, exchangeTimestamp: due[0].dueAt, source: "historical-test" } }, now);
    assert.equal(settled[0].outcome, "hit");
    assert.equal(calibration.profile({ symbol: "BTCUSDT", interval: "1h" }).pairSamples, 1);
    assert.equal(calibration.status().shadow.pendingObservations, 0);
    assert.equal(calibration.status().shadow.completedObservations, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

