"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, createSseWriter } = require("../src/server.cjs");
const EventEmitter = require("node:events");

class FakeLive {
  constructor(){this.symbol="BTCUSDT";this.interval="15m";this.state={ticker:{last:50000}};}
  start(){} close(){} select(s,i){this.symbol=s;this.interval=i;} addClient(){return()=>{};} marketSnapshot(){return[{symbol:"BTCUSDT",base:"BTC",last:50000,changePct:1,quoteVolume:1e9}];}
  priceDatums(){const now=Date.now();return{BTCUSDT:{symbol:"BTCUSDT",value:50000,exchangeTimestamp:now,receivedAt:now,source:"test",stale:false}};}
  snapshot(){return{symbol:this.symbol,interval:this.interval,connected:true,stale:false,ticker:{last:50000},book:{bids:[],asks:[]},trades:[],flow:{buyRatio:.5}};}
}
const credentials={status:()=>({configured:false,encryptionAvailable:true}),load:()=>({apiKey:"",model:"gpt-5"}),save:()=>({configured:true}),remove:()=>({configured:false})};

test("simulador consulta REST quando cotacao do radar excede o limite de entrada",async()=>{
  for(const restFresh of [true,false]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dieftrade-entry-freshness-'));let calls=0;
    const live=new FakeLive();live.priceDatums=()=>({BTCUSDT:{symbol:'BTCUSDT',value:50000,exchangeTimestamp:Date.now()-3000,receivedAt:Date.now()-3000,source:'test',stale:false}});
    const market={status:()=>({ok:true}),topPairs:async()=>[],klines:async()=>[],ticker:async()=>{calls++;const now=Date.now()-(restFresh?0:9000);return{last:51000,datum:{symbol:'BTCUSDT',value:51000,exchangeTimestamp:now,receivedAt:now,source:'test-rest',stale:false}};}};
    const app=createServer({dataDirectory:dir,uiDirectory:dir,credentialStore:credentials,market,realtime:live});
    try{
      const {port,token}=await app.listen();
      const res=await fetch(`http://127.0.0.1:${port}/api/paper/order`,{method:'POST',headers:{'X-Dief-Token':token,'Content-Type':'application/json'},body:JSON.stringify({symbol:'BTCUSDT',direction:'up',stake:100,durationMs:60000,interval:'1m'})});
      assert.equal(calls,1);assert.equal(res.status,restFresh?201:503);
      if(restFresh){const result=await res.json();assert.equal(result.trade.entryPrice,51000);assert.equal(result.trade.entryPriceSource,'test-rest');}
      else{const snapshot=app.paper.snapshot();assert.equal(snapshot.balance,10000);assert.equal(snapshot.open.length,0);}
    }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test("API local rejeita chamadas sem token e não expõe chave", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-server-"));
  const ui=path.join(dir,"ui");fs.mkdirSync(ui);fs.writeFileSync(path.join(ui,"index.html"),"ok");
  const market={status:()=>({ok:true}),topPairs:async()=>[],klines:async()=>[],ticker:async()=>({last:50000})};
  const app=createServer({dataDirectory:dir,uiDirectory:ui,credentialStore:credentials,market,realtime:new FakeLive()});
  try {
    const {port,token}=await app.listen();
    const denied=await fetch(`http://127.0.0.1:${port}/api/health`);assert.equal(denied.status,401);
    const allowed=await fetch(`http://127.0.0.1:${port}/api/health`,{headers:{"X-Dief-Token":token}});assert.equal(allowed.status,200);
    const body=await allowed.text();assert.doesNotMatch(body,/apiKey|openaiKey|sk-/i);assert.match(body,/realOrders[^]*false/);
  } finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("API inicia operação por expiração sem enviar ordem real", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-server-expiry-"));
  const ui=path.join(dir,"ui");fs.mkdirSync(ui);fs.writeFileSync(path.join(ui,"index.html"),"ok");
  const market={status:()=>({ok:true}),topPairs:async()=>[],klines:async()=>[],ticker:async()=>({last:50000})};
  const app=createServer({dataDirectory:dir,uiDirectory:ui,credentialStore:credentials,market,realtime:new FakeLive()});
  try {
    const {port,token}=await app.listen();
    const response=await fetch(`http://127.0.0.1:${port}/api/paper/order`,{method:"POST",headers:{"X-Dief-Token":token,"Content-Type":"application/json"},body:JSON.stringify({symbol:"BTCUSDT",direction:"up",stake:100,durationMs:60000,interval:"1m"})});
    assert.equal(response.status,201);
    const result=await response.json();
    assert.equal(result.trade.direction,"up");
    assert.equal(result.portfolio.balance,9900);
    assert.equal(result.portfolio.open.length,1);
  } finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("fronteira HTTP rejeita origem, token em query, método e payload anômalo", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-server-boundary-"));
  const ui=path.join(dir,"ui");fs.mkdirSync(ui);fs.writeFileSync(path.join(ui,"index.html"),"ok");
  const market={status:()=>({ok:true}),topPairs:async()=>[],klines:async()=>[],ticker:async()=>({last:50000})};
  const app=createServer({dataDirectory:dir,uiDirectory:ui,credentialStore:credentials,market,realtime:new FakeLive()});
  try {
    const {port,token}=await app.listen(),base=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/health`,{headers:{"X-Dief-Token":token,Origin:"https://evil.test"}})).status,401);
    assert.equal((await fetch(`${base}/api/health?t=${token}`)).status,401);
    assert.equal((await fetch(`${base}/api/health`,{method:"POST",headers:{"X-Dief-Token":token,"Content-Type":"application/json"},body:"{}"})).status,405);
    assert.equal((await fetch(`${base}/api/paper/reset`,{method:"POST",headers:{"X-Dief-Token":token},body:"{}"})).status,415);
    const scalar=await fetch(`${base}/api/paper/reset`,{method:"POST",headers:{"X-Dief-Token":token,"Content-Type":"application/json"},body:"null"});assert.equal(scalar.status,400);
    const large=await fetch(`${base}/api/paper/reset`,{method:"POST",headers:{"X-Dief-Token":token,"Content-Type":"application/json"},body:JSON.stringify({value:"x".repeat(140000)})});assert.equal(large.status,413);
    const missing=await fetch(`${base}/missing.js`);assert.equal(missing.status,404);assert.equal(missing.headers.get("x-content-type-options"),"nosniff");
  } finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("SSE preserva eventos críticos durante backpressure e consolida snapshots", () => {
  class FakeResponse extends EventEmitter { constructor(){super();this.chunks=[];this.first=true;} write(chunk){this.chunks.push(chunk);if(this.first){this.first=false;return false;}return true;} destroy(){this.destroyed=true;} }
  const res=new FakeResponse(),writer=createSseWriter(res,{maxQueue:4});
  writer.send("ready",{});writer.send("snapshot",{n:1});writer.send("snapshot",{n:2});writer.send("alert",{id:"a"});writer.send("paper-result",{id:"p"});
  assert.equal(writer.diagnostics().blocked,true);res.emit("drain");const output=res.chunks.join("");
  assert.doesNotMatch(output,/"n":1[^]*"n":2/);assert.match(output,/"n":2/);assert.match(output,/event: alert/);assert.match(output,/event: paper-result/);writer.close();
});

test("SSE encerra cliente travado quando a fila crítica atinge o limite real", () => {
  class FakeResponse extends EventEmitter { constructor(){super();this.chunks=[];} write(chunk){this.chunks.push(chunk);return false;} destroy(){this.destroyed=true;} }
  const res=new FakeResponse(),writer=createSseWriter(res,{maxQueue:3});
  writer.send("ready",{});writer.send("alert",{id:1});writer.send("paper-result",{id:2});writer.send("alert",{id:3});writer.send("paper-result",{id:4});
  assert.equal(writer.diagnostics().overflowed,true);assert.equal(writer.diagnostics().closed,true);assert.equal(writer.diagnostics().queued,0);assert.equal(res.destroyed,true);
});

test("exportação HTTP usa o arquivo histórico completo além da retenção visível", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-server-export-"));const ui=path.join(dir,"ui");fs.mkdirSync(ui);fs.writeFileSync(path.join(ui,"index.html"),"ok");
  const market={status:()=>({ok:true}),topPairs:async()=>[],klines:async()=>[],ticker:async()=>({last:100})};
  const app=createServer({dataDirectory:dir,uiDirectory:ui,credentialStore:credentials,market,realtime:new FakeLive()});app.paper.retention=2;let now=Date.now()-300000;
  try {
    for(let index=0;index<5;index+=1){const entry=100+index,trade=app.paper.place({symbol:"BTCUSDT",direction:"up",stake:10,durationMs:30000,interval:"1m",entryDatum:{symbol:"BTCUSDT",value:entry,exchangeTimestamp:now,receivedAt:now,source:"test",stale:false},now});app.paper.settleResolved({[trade.id]:{symbol:"BTCUSDT",value:entry+1,exchangeTimestamp:now+30000,receivedAt:now+30000,source:"test",stale:false}},now+30000);now+=31000;}
    await app.paper.flushPersistence();assert.equal(app.paper.store.value.results.length,2);
    const {port,token}=await app.listen();const response=await fetch(`http://127.0.0.1:${port}/api/paper/export`,{headers:{"X-Dief-Token":token}});assert.equal(response.status,200);assert.equal(response.headers.get("x-dief-history-complete"),"1");const csv=await response.text();assert.equal(csv.trim().split(/\r?\n/).length,6);
  } finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("sinal confirmado alimenta calibração sombra sem depender de operação do usuário", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-server-shadow-"));const ui=path.join(dir,"ui");fs.mkdirSync(ui);fs.writeFileSync(path.join(ui,"index.html"),"ok");
  const widths={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000};
  const trend=(interval)=>{const step=widths[interval]||60000,end=Date.now()-step;return Array.from({length:500},(_,index)=>{const base=100+index*.08+Math.sin(index/8)*1.2,open=base-.07,close=base+.07,t=end-(499-index)*step;return{t,closeTime:t+step-1,open,high:Math.max(open,close)+.35,low:Math.min(open,close)-.35,close,volume:1000+index*2,quoteVolume:(1000+index*2)*close};});};
  const market={status:()=>({ok:true}),topPairs:async()=>[],klines:async(_symbol,interval)=>trend(interval),assertTradable:async()=>true};
  const app=createServer({dataDirectory:dir,uiDirectory:ui,credentialStore:credentials,market,realtime:new FakeLive()});
  try {const {port,token}=await app.listen();const headers={"X-Dief-Token":token};let response=await fetch(`http://127.0.0.1:${port}/api/analysis/BTCUSDT?interval=1m`,{headers});assert.equal(response.status,200);let analysis=await response.json();assert.ok(["COMPRA","VENDA"].includes(analysis.signal));assert.match(analysis.signalLifecycle.status,/^CANDIDATE_/);response=await fetch(`http://127.0.0.1:${port}/api/analysis/BTCUSDT?interval=1m&force=1`,{headers});analysis=await response.json();assert.match(analysis.signalLifecycle.status,/^CONFIRMED_/);assert.equal(app.calibrator.status().shadow.pending,1);await app.calibrator.flushPersistence();}
  finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("APIs de sinais preservam evento e IA rejeita analysisId incompatível", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-server-signals-"));const ui=path.join(dir,"ui");fs.mkdirSync(ui);fs.writeFileSync(path.join(ui,"index.html"),"ok");const step=60000,end=Date.now()-step;const candles=Array.from({length:500},(_,index)=>{const base=100+index*.08+Math.sin(index/8)*1.2,open=base-.07,close=base+.07,t=end-(499-index)*step;return{t,closeTime:t+step-1,open,high:close+.35,low:open-.35,close,volume:1000+index*2,quoteVolume:(1000+index*2)*close};});const market={status:()=>({ok:true}),topPairs:async()=>[],klines:async()=>candles,assertTradable:async()=>true};const app=createServer({dataDirectory:dir,uiDirectory:ui,credentialStore:credentials,market,realtime:new FakeLive()});
  try{const {port,token}=await app.listen(),headers={"X-Dief-Token":token},base=`http://127.0.0.1:${port}`;let response=await fetch(`${base}/api/analysis/BTCUSDT?interval=1m`,{headers});let analysis=await response.json();response=await fetch(`${base}/api/analysis/BTCUSDT?interval=1m&force=1`,{headers});analysis=await response.json();assert.ok(analysis.signalLifecycle.signalId);const current=await (await fetch(`${base}/api/signals/current?symbol=BTCUSDT&interval=1m`,{headers})).json();assert.equal(current[0].signalId,analysis.signalLifecycle.signalId);const history=await (await fetch(`${base}/api/signals/history?symbol=BTCUSDT&interval=1m`,{headers})).json();assert.equal(history.filter(event=>event.type==="signal-confirmed").length,1);const mismatch=await fetch(`${base}/api/ai/read`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({analysisId:analysis.id,symbol:"ETHUSDT",interval:"1m"})});assert.equal(mismatch.status,409);assert.equal((await mismatch.json()).code,"AI_ANALYSIS_MISMATCH");}
  finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
