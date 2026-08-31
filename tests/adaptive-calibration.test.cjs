"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AdaptiveCalibrator } = require("../src/engine/adaptive-calibration.cjs");

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
    calibration.recordSettled(Array.from({ length: 30 }, (_, index) => ({ entryPrice: 100, exitPrice: 101, closedAt: Date.now() + index, durationMs: 900000, result: "win", analysisSnapshot: reading("BTCUSDT") })));
    assert.equal(calibration.profile({ symbol: "BTCUSDT", interval: "15m" }).applied, true);
    assert.equal(calibration.profile({ symbol: "ETHUSDT", interval: "15m" }).applied, false);
    assert.deepEqual(calibration.profile({ symbol: "ETHUSDT", interval: "15m" }).groupWeights, {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

