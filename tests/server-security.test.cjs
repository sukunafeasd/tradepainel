"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../src/server.cjs");

class FakeLive {
  constructor(){this.symbol="BTCUSDT";this.interval="15m";this.state={ticker:{last:50000}};}
  start(){} close(){} select(s,i){this.symbol=s;this.interval=i;} addClient(){return()=>{};} marketSnapshot(){return[{symbol:"BTCUSDT",base:"BTC",last:50000,changePct:1,quoteVolume:1e9}];}
  snapshot(){return{symbol:this.symbol,interval:this.interval,connected:true,stale:false,ticker:{last:50000},book:{bids:[],asks:[]},trades:[],flow:{buyRatio:.5}};}
}
const credentials={status:()=>({configured:false,encryptionAvailable:true}),load:()=>({apiKey:"",model:"gpt-5"}),save:()=>({configured:true}),remove:()=>({configured:false})};

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
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.trade.direction,"up");
    assert.equal(result.portfolio.balance,9900);
    assert.equal(result.portfolio.open.length,1);
  } finally {await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
