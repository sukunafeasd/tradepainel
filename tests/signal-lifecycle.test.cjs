"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SignalLifecycleStore } = require("../src/engine/signal-lifecycle.cjs");

const base = (overrides = {}) => ({ id:`analysis-${Math.random()}`,symbol:"BTCUSDT",interval:"1m",signal:"COMPRA",score:40,threshold:30,confidence:80,calculatedAt:1_700_000_000_000,latestCandleCloseTime:1_700_000_000_000,marketDataAgeMs:100,dataQuality:{score:90},multiTimeframe:{status:"ready",coverage:100,alignment:75,signal:"COMPRA"},price:100,plan:{entry:100,stop:99,target1:101,target2:102},...overrides });
const datum = (at, value = 100, stale = false) => ({symbol:"BTCUSDT",value,exchangeTimestamp:at,receivedAt:at,source:"aggTrade-test",stale});
test('mesma analise em cache nao conta como duas invalidacoes',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dieftrade-weak-cache-'));let now=1700000000000;try{const store=new SignalLifecycleStore(dir,{now:()=>now});store.evaluate(base(),datum(now));now+=1000;store.evaluate(base(),datum(now));const weak=base({id:'weak',signal:'AGUARDE',score:0});now+=1000;assert.equal(store.evaluate(weak,datum(now)).current.status,'WEAKENING_BUY');now+=1000;assert.equal(store.evaluate(weak,datum(now)).current.status,'WEAKENING_BUY');now+=1000;assert.equal(store.evaluate({...weak,id:'weak-new'},datum(now)).current.status,'INVALIDATED');}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test("candidato estável cria exatamente um sinal e polls repetidos preservam signalId", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-lifecycle-"));let now=1_700_000_000_000;
  try {const store=new SignalLifecycleStore(dir,{now:()=>now});let out=store.evaluate(base(),datum(now),now);assert.equal(out.current.status,"CANDIDATE_BUY");assert.equal(out.events.filter(e=>e.type==="signal-confirmed").length,0);now+=1000;out=store.evaluate(base(),datum(now,101),now);assert.equal(out.current.status,"CONFIRMED_BUY");assert.equal(out.current.confirmedPrice,101);const signalId=out.current.signalId;const confirmedAt=out.current.confirmedAt;now+=1000;out=store.evaluate(base(),datum(now,102),now);assert.equal(out.current.signalId,signalId);assert.equal(out.current.confirmedAt,confirmedAt);assert.equal(store.history({symbol:"BTCUSDT",interval:"1m"}).filter(e=>e.type==="signal-confirmed").length,1);await store.flushPersistence();}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("candidato que desaparece não confirma e chatter marginal não apaga sinal confirmado", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-lifecycle-chatter-"));let now=1_700_000_100_000;
  try {const store=new SignalLifecycleStore(dir,{now:()=>now});store.evaluate(base(),datum(now),now);now+=1000;let out=store.evaluate(base({signal:"AGUARDE",score:29,multiTimeframe:{status:"ready",coverage:100,alignment:0,signal:"AGUARDE"}}),datum(now),now);assert.equal(out.current.status,"NEUTRAL");assert.equal(store.health().falseCandidates,1);now+=1000;store.evaluate(base(),datum(now),now);now+=1000;out=store.evaluate(base(),datum(now),now);const id=out.current.signalId;now+=1000;out=store.evaluate(base({signal:"AGUARDE",score:29}),datum(now),now);assert.equal(out.current.status,"WEAKENING_BUY");assert.equal(out.current.signalId,id);assert.equal(out.current.invalidatedAt,null);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("oposto exige invalidação, neutralização e nova confirmação", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-lifecycle-opposite-"));let now=1_700_000_200_000;const sell=()=>base({signal:"VENDA",score:-42,multiTimeframe:{status:"ready",coverage:100,alignment:75,signal:"VENDA"},plan:{entry:100,stop:101,target1:99,target2:98}});
  try {const store=new SignalLifecycleStore(dir,{now:()=>now});store.evaluate(base(),datum(now),now);now+=1000;let out=store.evaluate(base(),datum(now),now);const buyId=out.current.signalId;now+=1000;out=store.evaluate(sell(),datum(now),now);assert.equal(out.current.status,"WEAKENING_BUY");now+=1000;out=store.evaluate(sell(),datum(now),now);assert.equal(out.current.status,"INVALIDATED");assert.equal(out.current.signalId,buyId);now+=1000;out=store.evaluate(sell(),datum(now),now);assert.equal(out.current.status,"CANDIDATE_SELL");now+=1000;out=store.evaluate(sell(),datum(now),now);assert.equal(out.current.status,"CONFIRMED_SELL");assert.notEqual(out.current.signalId,buyId);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("dados stale suspendem sem invalidar e restart preserva histórico imutável", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-lifecycle-restart-"));let now=1_700_000_300_000;
  try {let store=new SignalLifecycleStore(dir,{now:()=>now});store.evaluate(base(),datum(now),now);now+=1000;let out=store.evaluate(base(),datum(now),now);const id=out.current.signalId;now+=1000;out=store.evaluate(base(),datum(now,100,true),now);assert.equal(out.current.status,"SUSPENDED_DATA");assert.equal(out.current.invalidatedAt,null);now+=1000;out=store.evaluate(base(),datum(now),now);assert.equal(out.current.status,"CONFIRMED_BUY");await store.flushPersistence();const history=store.history({symbol:"BTCUSDT",interval:"1m"});history[0].type="mutated";store=new SignalLifecycleStore(dir,{now:()=>now});assert.equal(store.get("BTCUSDT","1m").signalId,id);assert.notEqual(store.history({symbol:"BTCUSDT",interval:"1m"})[0].type,"mutated");}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("pares e timeframes mantêm ciclos isolados", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-lifecycle-isolation-"));const now=1_700_000_400_000;
  try {const store=new SignalLifecycleStore(dir,{now:()=>now});store.evaluate(base(),datum(now),now);const eth=base({symbol:"ETHUSDT",interval:"5m"}),ethDatum={...datum(now,200),symbol:"ETHUSDT"};store.evaluate(eth,ethDatum,now);assert.equal(store.get("BTCUSDT","1m").status,"CANDIDATE_BUY");assert.equal(store.get("ETHUSDT","5m").status,"CANDIDATE_BUY");assert.equal(store.current().length,2);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
