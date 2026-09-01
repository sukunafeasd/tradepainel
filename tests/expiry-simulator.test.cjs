"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ExpirySimulator, SCHEMA_VERSION } = require("../src/engine/expiry-simulator.cjs");
const { TradeArchive } = require("../src/engine/trade-archive.cjs");

const datum = (symbol, value, at) => ({ symbol, value, exchangeTimestamp: at, receivedAt: at, source: "test", stale: false });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-expiry-"));

test("simulador só liquida com preço histórico da expiração", async () => {
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
    await sim.flushPersistence();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("reinício preserva operação e empate devolve valor", async () => {
  const dir = temp(); let now = 1_800_000_100_000;
  try {
    let sim = new ExpirySimulator(dir, { now: () => now });
    const trade = sim.place({ symbol: "ETHUSDT", direction: "down", stake: 250, entryDatum: datum("ETHUSDT", 2000, now), durationMs: 60000, note: "teste" });
    sim = new ExpirySimulator(dir, { now: () => now }); now = trade.expiresAt + 100;
    const [settled] = sim.settleResolved({ [trade.id]: datum("ETHUSDT", 2000, trade.expiresAt) }, now);
    assert.equal(settled.result, "draw"); assert.equal(settled.note, "teste"); assert.equal(sim.snapshot({}, now).balance, 10000);
    await sim.flushPersistence();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("estatísticas acumuladas sobrevivem à retenção", async () => {
  const dir = temp(); let now = 1_800_000_200_000;
  try {
    const sim = new ExpirySimulator(dir, { now: () => now, retention: 1 });
    for (const exit of [101, 99]) { const trade = sim.place({ symbol: "BTCUSDT", direction: "up", stake: 100, entryDatum: datum("BTCUSDT", 100, now), durationMs: 30000 }); now = trade.expiresAt + 1; sim.settleResolved({ [trade.id]: datum("BTCUSDT", exit, trade.expiresAt) }, now); now += 1000; }
    const snap = sim.snapshot({}, now); assert.equal(snap.total, 2); assert.equal(snap.results.length, 1); assert.ok(snap.maxDrawdown > 0);
    await sim.flushPersistence();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("múltiplas operações e símbolos vencem juntas sem perder resultado", async () => {
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
    await sim.flushPersistence();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("liquidação ausente usa backoff, termina como devolvida e idempotência longa é estável", async () => {
  const dir = temp(); let now = 1_800_000_400_000;
  try {
    const sim = new ExpirySimulator(dir, { now: () => now, settlementPolicy: { maxAttempts: 3, maxPendingMs: 60000, baseRetryMs: 1000, maxRetryMs: 4000 } });
    const key = "pedido-" + "x".repeat(300);
    const trade = sim.place({ symbol: "BTCUSDT", direction: "up", stake: 100, entryDatum: datum("BTCUSDT", 100, now), durationMs: 30000, idempotencyKey: key });
    assert.equal(sim.place({ symbol: "BTCUSDT", direction: "up", stake: 100, entryDatum: datum("BTCUSDT", 100, now), durationMs: 30000, idempotencyKey: key }).id, trade.id);
    now = trade.expiresAt + 10;
    assert.equal(sim.settleResolved({ [trade.id]: datum("BTCUSDT", 999, trade.expiresAt + 1) }, now).length, 0);
    assert.equal(sim.due(now).length, 0);
    now += 1000; assert.equal(sim.settleResolved({}, now).length, 0); assert.equal(sim.due(now).length, 0);
    now += 2000; const [closed] = sim.settleResolved({}, now);
    assert.equal(closed.result, "unresolved"); assert.equal(sim.snapshot({}, now).balance, 10000); assert.equal(sim.snapshot({}, now).unresolved, 1);
    await sim.flushPersistence();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("schema profundo rejeita registros semanticamente corrompidos", () => {
  const dir = temp(); const file = path.join(dir, "expiry-simulator.json");
  try {
    const sim = new ExpirySimulator(dir); sim.reset(10000);
    const corrupted = JSON.parse(fs.readFileSync(file, "utf8"));
    corrupted.schemaVersion = SCHEMA_VERSION; corrupted.open = [{}];
    fs.writeFileSync(file, JSON.stringify(corrupted)); fs.writeFileSync(`${file}.bak`, JSON.stringify(corrupted));
    const recovered = new ExpirySimulator(dir);
    assert.equal(recovered.snapshot().open.length, 0);
    assert.ok(recovered.snapshot().persistence.issues.some((issue) => issue.code === "INVALID_SCHEMA"));
    assert.ok(fs.readdirSync(dir).some((name) => name.startsWith("expiry-simulator.json.corrupt-")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("arquivo histórico preserva detalhes além da retenção e sobrevive ao reinício", async () => {
  const dir = temp(); let now = 1_800_000_500_000;
  try {
    let sim = new ExpirySimulator(dir, { now: () => now, retention: 2 });
    for (let index = 0; index < 5; index += 1) {
      const trade = sim.place({ symbol: "BTCUSDT", direction: "up", stake: 10, entryDatum: datum("BTCUSDT", 100, now), durationMs: 30000 });
      now = trade.expiresAt + 1; sim.settleResolved({ [trade.id]: datum("BTCUSDT", 101 + index, trade.expiresAt) }, now); now += 1000;
    }
    await sim.flushPersistence();
    assert.equal(sim.snapshot({}, now).results.length, 2);
    assert.equal(sim.allResults().length, 5);
    assert.deepEqual(sim.historyDetails(), { available: 5, expected: 5, unavailable: 0, complete: true, archiveFile: path.join(dir, "expiry-results.ndjson") });
    sim = new ExpirySimulator(dir, { now: () => now, retention: 2 });
    assert.equal(sim.allResults().length, 5);
    assert.equal(sim.historyDetails().complete, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("arquivo histórico elimina IDs duplicados inclusive dentro do mesmo lote", () => {
  const dir = temp();
  try {
    const archive = new TradeArchive(dir, "test.ndjson", { validate: (row) => Boolean(row?.id) });
    assert.equal(archive.append([{ id: "trade-1", result: "win" }, { id: "trade-1", result: "win" }]), 1);
    assert.equal(archive.size, 1);
    assert.equal(fs.readFileSync(path.join(dir, "test.ndjson"), "utf8").trim().split(/\r?\n/).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("schema valida profundamente o snapshot técnico armazenado", async () => {
  const dir = temp(); const file = path.join(dir, "expiry-simulator.json"); let now = 1_800_000_600_000;
  try {
    const sim = new ExpirySimulator(dir, { now: () => now });
    sim.place({ symbol: "BTCUSDT", direction: "up", stake: 10, entryDatum: datum("BTCUSDT", 100, now), durationMs: 30000, analysisSnapshot: { symbol: "BTCUSDT", interval: "1m", signal: "COMPRA", confidence: 70, score: 20, reasons: [{ group: "momentum", points: 10 }] } });
    await sim.flushPersistence();
    const corrupted = JSON.parse(fs.readFileSync(file, "utf8"));
    corrupted.open[0].analysisSnapshot.reasons = [{ group: "momentum", points: { nested: true } }];
    fs.writeFileSync(file, JSON.stringify(corrupted)); fs.writeFileSync(`${file}.bak`, JSON.stringify(corrupted));
    const recovered = new ExpirySimulator(dir, { now: () => now });
    assert.equal(recovered.snapshot().open.length, 0);
    assert.ok(recovered.snapshot().persistence.issues.some((issue) => issue.code === "INVALID_SCHEMA"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
