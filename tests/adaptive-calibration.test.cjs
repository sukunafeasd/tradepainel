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
      closedAt: at,
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

