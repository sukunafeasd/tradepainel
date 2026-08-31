"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ExpirySimulator } = require("../src/engine/expiry-simulator.cjs");

test("simulador resolve alta vencedora e atualiza saldo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-expiry-"));
  try {
    const sim = new ExpirySimulator(dir);
    const trade = sim.place({ symbol:"BTCUSDT", direction:"up", stake:100, entryPrice:50000, durationMs:5000 });
    assert.equal(sim.snapshot({ BTCUSDT:50000 }, trade.openedAt).balance, 9900);
    const snap = sim.snapshot({ BTCUSDT:50100 }, trade.expiresAt + 1);
    assert.equal(snap.open.length, 0);
    assert.equal(snap.results[0].result, "win");
    assert.equal(snap.balance, 10082);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test("simulador resolve baixa perdedora e restaura US$ 10 mil", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-expiry-"));
  try {
    const sim = new ExpirySimulator(dir);
    const trade = sim.place({ symbol:"ETHUSDT", direction:"down", stake:250, entryPrice:2000, durationMs:5000 });
    const lost = sim.snapshot({ ETHUSDT:2010 }, trade.expiresAt + 1);
    assert.equal(lost.balance, 9750);
    const reset = sim.reset(10000);
    assert.equal(reset.balance, 10000);
    assert.equal(reset.results.length, 0);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test("simulador calcula expectativa, drawdown e curva de patrimônio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-expiry-stats-"));
  try {
    const sim = new ExpirySimulator(dir);
    let trade = sim.place({ symbol:"BTCUSDT", direction:"up", stake:100, entryPrice:100, durationMs:5000 });
    sim.snapshot({ BTCUSDT:101 }, trade.expiresAt + 1);
    trade = sim.place({ symbol:"BTCUSDT", direction:"up", stake:100, entryPrice:100, durationMs:5000 });
    const snap = sim.snapshot({ BTCUSDT:99 }, trade.expiresAt + 1);
    assert.equal(snap.total, 2);
    assert.ok(Number.isFinite(snap.expectancy));
    assert.ok(snap.maxDrawdown > 0);
    assert.equal(snap.equityCurve.length, 3);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
