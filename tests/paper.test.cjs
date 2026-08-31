"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AlertsStore, JournalStore, validAlertArray, validJournalArray, migrateAlerts, migrateJournal } = require("../src/engine/paper.cjs");
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-paper-"));
const datum = (value, at) => ({ symbol: "BTCUSDT", value, exchangeTimestamp: at, receivedAt: at, source: "test", stale: false });

test("alerta de cruzamento não dispara só porque já nasceu acima", () => {
  const dir = temp(); let now = 100000;
  try { const alerts = new AlertsStore(dir, { now: () => now }); const item = alerts.add({ symbol: "BTCUSDT", kind: "price_gte", value: 100, currentDatum: datum(110, now) }); assert.equal(alerts.checkPrice(datum(111, ++now)).length, 0); assert.equal(alerts.checkPrice(datum(90, ++now)).length, 0); const hits = alerts.checkPrice(datum(101, ++now)); assert.equal(hits[0].id, item.id); assert.equal(hits[0].hitPrice, 101); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("diário valida, pesquisa, pagina e remove", () => {
  const dir = temp();
  try { const journal = new JournalStore(dir, { now: () => 123 }); const item = journal.add({ symbol: "BTCUSDT", interval: "15m", setup: "Rompimento", note: "volume forte" }); assert.equal(journal.list({ query: "volume" })[0].id, item.id); assert.equal(journal.list({ offset: 1 }).length, 0); assert.equal(journal.remove(item.id), true); assert.equal(journal.remove(item.id), false); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("primeiro preço vira baseline persistida sem disparar após reinício", () => {
  const dir=temp();let now=200000;
  try{let alerts=new AlertsStore(dir,{now:()=>now});const item=alerts.add({symbol:"BTCUSDT",kind:"price_gte",value:100});assert.equal(alerts.checkPrice(datum(110,++now)).length,0);alerts=new AlertsStore(dir,{now:()=>now});assert.equal(alerts.checkPrice(datum(111,++now)).length,0);assert.equal(alerts.list()[0].id,item.id);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("schemas persistidos rejeitam estruturas rasas e migram registros antigos", () => {
  assert.equal(validAlertArray([{ id: "a".repeat(16), symbol: "BTCUSDT", kind: "signal_buy", interval: "qualquer", active: true, createdAt: 1 }]), false);
  assert.equal(validJournalArray([{ id: "b".repeat(16), symbol: "BTCUSDT", interval: "15m", createdAt: 1, side: "observe", note: {}, setup: "x" }]), false);
  const alerts = migrateAlerts([{ id: "a".repeat(16), symbol: "BTCUSDT", kind: "signal_buy", interval: "15m", active: true, createdAt: 1 }]);
  const journal = migrateJournal([{ id: "b".repeat(16), symbol: "BTCUSDT", interval: "15m", createdAt: 1, side: "observe", note: "n", setup: "s" }]);
  assert.equal(validAlertArray(alerts), true); assert.equal(validJournalArray(journal), true);
});
