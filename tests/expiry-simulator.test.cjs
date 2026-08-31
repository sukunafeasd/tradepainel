"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ExpirySimulator } = require("../src/engine/expiry-simulator.cjs");

const datum = (symbol, value, at) => ({ symbol, value, exchangeTimestamp: at, receivedAt: at, source: "test", stale: false });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-expiry-"));

test("simulador só liquida com preço histórico da expiração", () => {
  const dir = temp(); let now = 1_800_000_000_000;
  try {
    const sim = new ExpirySimulator(dir, { now: () => now });
    const trade = sim.place({ symbol: "BTCUSDT", direction: "up", stake: 100, entryDatum: datum("BTCUSDT", 50000, now), durationMs: 30000 });
    now = trade.expiresAt + 500;
    sim.updatePrices({ BTCUSDT: datum("BTCUSDT", 99999, now) }, now);
    assert.equal(sim.snapshot({}, now).open[0].status, "pending_settlement");
    assert.equal(sim.settleResolved({}, now).length, 0);
    const settled = sim.settleResolved({ [trade.id]: datum("BTCUSDT", 50100, trade.expiresAt) }, now);
    assert.equal(settled[0].result, "win");
    assert.equal(sim.snapshot({}, now).balance, 10082);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("reinício preserva operação e empate devolve valor", () => {
  const dir = temp(); let now = 1_800_000_100_000;
  try {
    let sim = new ExpirySimulator(dir, { now: () => now });
    const trade = sim.place({ symbol: "ETHUSDT", direction: "down", stake: 250, entryDatum: datum("ETHUSDT", 2000, now), durationMs: 60000, note: "teste" });
    sim = new ExpirySimulator(dir, { now: () => now }); now = trade.expiresAt + 100;
    const [settled] = sim.settleResolved({ [trade.id]: datum("ETHUSDT", 2000, trade.expiresAt) }, now);
    assert.equal(settled.result, "draw"); assert.equal(settled.note, "teste"); assert.equal(sim.snapshot({}, now).balance, 10000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("estatísticas acumuladas sobrevivem à retenção", () => {
  const dir = temp(); let now = 1_800_000_200_000;
  try {
    const sim = new ExpirySimulator(dir, { now: () => now, retention: 1 });
    for (const exit of [101, 99]) { const trade = sim.place({ symbol: "BTCUSDT", direction: "up", stake: 100, entryDatum: datum("BTCUSDT", 100, now), durationMs: 30000 }); now = trade.expiresAt + 1; sim.settleResolved({ [trade.id]: datum("BTCUSDT", exit, trade.expiresAt) }, now); now += 1000; }
    const snap = sim.snapshot({}, now); assert.equal(snap.total, 2); assert.equal(snap.results.length, 1); assert.ok(snap.maxDrawdown > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("múltiplas operações e símbolos vencem juntas sem perder resultado", () => {
  const dir = temp(); let now = 1_800_000_300_000;
  try {
    const sim = new ExpirySimulator(dir, { now: () => now });
    const btc = sim.place({ symbol: "BTCUSDT", direction: "up", stake: 100, entryDatum: datum("BTCUSDT", 100, now), durationMs: 30000 });
    const eth = sim.place({ symbol: "ETHUSDT", direction: "down", stake: 100, entryDatum: datum("ETHUSDT", 100, now), durationMs: 30000 });
    now = btc.expiresAt + 1;
    const settled = sim.settleResolved({
      [btc.id]: datum("BTCUSDT", 101, btc.expiresAt),
      [eth.id]: datum("ETHUSDT", 99, eth.expiresAt),
    }, now);
    assert.equal(settled.length, 2);
    assert.deepEqual(new Set(settled.map((trade) => trade.symbol)), new Set(["BTCUSDT", "ETHUSDT"]));
    assert.equal(sim.snapshot({}, now).total, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
