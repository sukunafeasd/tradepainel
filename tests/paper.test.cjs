"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AlertsStore, JournalStore, validAlertArray, validJournalArray, migrateAlerts, migrateJournal } = require("../src/engine/paper.cjs");
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-paper-"));
const datum = (value, at) => ({ symbol: "BTCUSDT", value, exchangeTimestamp: at, receivedAt: at, source: "test", stale: false });

test("alerta de cruzamento não dispara só porque já nasceu acima", async () => {
  const dir = temp(); let now = 100000; let alerts;
  try { alerts = new AlertsStore(dir, { now: () => now }); const item = alerts.add({ symbol: "BTCUSDT", kind: "price_gte", value: 100, currentDatum: datum(110, now) }); assert.equal(alerts.checkPrice(datum(111, ++now)).length, 0); assert.equal(alerts.checkPrice(datum(90, ++now)).length, 0); const hits = alerts.checkPrice(datum(101, ++now)); assert.equal(hits[0].id, item.id); assert.equal(hits[0].hitPrice, 101); }
  finally { await alerts?.flushPersistence?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("diário valida, pesquisa, pagina e remove", async () => {
  const dir = temp(); let journal;
  try { journal = new JournalStore(dir, { now: () => 123 }); const item = journal.add({ symbol: "BTCUSDT", interval: "15m", setup: "Rompimento", note: "volume forte" }); assert.equal(journal.list({ query: "volume" })[0].id, item.id); assert.equal(journal.list({ offset: 1 }).length, 0); assert.equal(journal.remove(item.id), true); assert.equal(journal.remove(item.id), false); }
  finally { await journal?.flushPersistence?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("primeiro preço vira baseline persistida sem disparar após reinício", async () => {
  const dir=temp();let now=200000;
  try{let alerts=new AlertsStore(dir,{now:()=>now});const item=alerts.add({symbol:"BTCUSDT",kind:"price_gte",value:100});assert.equal(alerts.checkPrice(datum(110,++now)).length,0);await alerts.flushPersistence();alerts=new AlertsStore(dir,{now:()=>now});assert.equal(alerts.checkPrice(datum(111,++now)).length,0);assert.equal(alerts.list()[0].id,item.id);await alerts.flushPersistence();}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("schemas persistidos rejeitam estruturas rasas e migram registros antigos", () => {
  assert.equal(validAlertArray([{ id: "a".repeat(16), symbol: "BTCUSDT", kind: "signal_buy", interval: "qualquer", active: true, createdAt: 1 }]), false);
  assert.equal(validJournalArray([{ id: "b".repeat(16), symbol: "BTCUSDT", interval: "15m", createdAt: 1, side: "observe", note: {}, setup: "x" }]), false);
  const alerts = migrateAlerts([{ id: "a".repeat(16), symbol: "BTCUSDT", kind: "signal_buy", interval: "15m", active: true, createdAt: 1 }]);
  const journal = migrateJournal([{ id: "b".repeat(16), symbol: "BTCUSDT", interval: "15m", createdAt: 1, side: "observe", note: "n", setup: "s" }]);
  assert.equal(validAlertArray(alerts), true); assert.equal(validJournalArray(journal), true);
});

test("scheduler enxerga todos os alvos técnicos e símbolos de preço sem corte oculto", async () => {
  const dir=temp();let now=300000;let alerts;
  try {
    alerts=new AlertsStore(dir,{now:()=>++now});
    for(let index=0;index<40;index+=1) alerts.add({symbol:`X${String(index).padStart(2,"0")}USDT`,interval:"1m",kind:"signal_buy"});
    alerts.add({symbol:"BTCUSDT",kind:"price_gte",value:100});
    alerts.add({symbol:"ETHUSDT",kind:"price_lte",value:10});
    assert.equal(alerts.analysisTargets().length,40);
    assert.equal(alerts.analysisTargets({offset:25,limit:10}).length,10);
    assert.deepEqual(new Set(alerts.priceSymbols()),new Set(["BTCUSDT","ETHUSDT"]));
  } finally { await alerts?.flushPersistence?.(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test("alerta de qualidade exige sinal direcional ativo", async () => {
  const dir = temp(); let now = 400000; let alerts;
  try {
    alerts = new AlertsStore(dir, { now: () => ++now });
    const item = alerts.add({ symbol: "BTCUSDT", interval: "15m", kind: "confidence_gte", value: 80 });
    assert.equal(alerts.checkAnalysis({ id: "wait", symbol: "BTCUSDT", interval: "15m", signal: "AGUARDE", confidence: 95, price: 100, dataQuality: { score: 90 } }).length, 0);
    const [hit] = alerts.checkAnalysis({ id: "buy", symbol: "BTCUSDT", interval: "15m", signal: "COMPRA", confidence: 80, price: 101, dataQuality: { score: 90 } });
    assert.equal(hit.id, item.id);
    assert.equal(hit.hitSignal, "COMPRA");
  } finally { await alerts?.flushPersistence?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("alerta direcional dispara somente em evento novo de sinal confirmado", async () => {
  const dir=temp();let alerts;
  try{alerts=new AlertsStore(dir,{now:()=>1_700_000_000_000});const created=alerts.add({symbol:"BTCUSDT",interval:"1m",kind:"signal_buy"});assert.equal(alerts.checkAnalysis({symbol:"BTCUSDT",interval:"1m",signal:"COMPRA",confidence:90,price:100,id:"raw",dataQuality:{score:90}}).length,0);const hit=alerts.checkSignalEvent({type:"signal-confirmed",signalId:"signal-1",analysisId:"analysis-1",symbol:"BTCUSDT",interval:"1m",direction:"COMPRA",at:1_700_000_000_100,confirmedPrice:101,confirmedPriceAt:1_700_000_000_090});assert.equal(hit.length,1);assert.equal(hit[0].id,created.id);assert.equal(hit[0].signalId,"signal-1");assert.equal(alerts.checkSignalEvent({type:"signal-confirmed",signalId:"signal-1",symbol:"BTCUSDT",interval:"1m",direction:"COMPRA",at:1_700_000_000_200}).length,0);}
  finally{await alerts?.flushPersistence?.();fs.rmSync(dir,{recursive:true,force:true});}
});
