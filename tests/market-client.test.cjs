"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const {MarketClient}=require("../src/engine/market-client.cjs");

test("erro 400 determinístico não percorre todos os hosts",async()=>{const original=global.fetch;let calls=0;global.fetch=async()=>{calls+=1;return{ok:false,status:400,headers:new Headers(),text:async()=>"bad"};};try{const client=new MarketClient({hosts:["https://a.test","https://b.test"]});await assert.rejects(()=>client.get("/bad"),/HTTP 400/);assert.equal(calls,1);}finally{global.fetch=original;}});

test("failover aprende host saudável e mede latência total",async()=>{const original=global.fetch,calls=[];global.fetch=async(url)=>{calls.push(url);if(url.startsWith("https://bad"))throw new Error("offline");return{ok:true,status:200,headers:new Headers(),json:async()=>({ok:true})};};try{const client=new MarketClient({hosts:["https://bad","https://good"],timeout:500,totalTimeout:2000});assert.deepEqual(await client.get("/ok",{},0),{ok:true});assert.equal(client.status().host,"https://good");await client.get("/next",{},0);assert.match(calls.at(-1),/^https:\/\/good/);assert.ok(client.status().totalLatencyMs>=0);}finally{global.fetch=original;}});

test("cache tem limite e force ignora valor anterior",async()=>{const original=global.fetch;let value=0;global.fetch=async()=>({ok:true,status:200,headers:new Headers(),json:async()=>({value:++value})});try{const client=new MarketClient({hosts:["https://ok"],cacheLimit:2});const first=await client.get("/a",{},10000);assert.deepEqual(await client.get("/a",{},10000),first);const forced=await client.get("/a",{},10000,{force:true});assert.notEqual(forced.value,first.value);await client.get("/b",{},10000);await client.get("/c",{},10000);assert.equal(client.status().cachedItems,2);}finally{global.fetch=original;}});

test("ticker preserva snapshot de book e usa timestamp real do último negócio",async()=>{
  const original=global.fetch,calls=[];
  global.fetch=async(url)=>{
    calls.push(url);
    if(url.includes("ticker/24hr"))return{ok:true,status:200,headers:new Headers(),json:async()=>({lastPrice:"100",bidPrice:"99",askPrice:"101"})};
    return{ok:true,status:200,headers:new Headers(),json:async()=>[{p:"100.25",T:950,a:7}]};
  };
  try{
    const clock={now:()=>1100,status:()=>({})};
    const client=new MarketClient({hosts:["https://ok"],clock});
    const ticker=await client.ticker("BTCUSDT");
    assert.equal(ticker.last,100);
    assert.equal(ticker.datum.value,100.25);
    assert.equal(ticker.datum.exchangeTimestamp,950);
    assert.equal(ticker.datum.receivedAt,1100);
    assert.equal(ticker.datum.source,"binance-rest-aggtrade");
    assert.equal(calls.length,2);
    assert.ok(calls.some(url=>url.includes("aggTrades")&&url.includes("limit=1")));
  }finally{global.fetch=original;}
});

test("preço histórico nunca escolhe negócio após o vencimento",async()=>{
  const original=global.fetch,calls=[];
  global.fetch=async(url)=>{calls.push(url);return{ok:true,status:200,headers:new Headers(),json:async()=>[{p:"102",T:1001,a:2},{p:"99",T:999,a:1}]};};
  try{
    const clock={now:()=>1100,status:()=>({})};
    const client=new MarketClient({hosts:["https://ok"],clock});
    const historical=await client.priceAt("BTCUSDT",1000,{toleranceMs:10});
    assert.equal(historical.value,99);
    assert.equal(historical.exchangeTimestamp,999);
    assert.match(calls.at(-1),/endTime=1000/);
  }finally{global.fetch=original;}
});

test("priceAt pagina uma página cheia e alcança a cauda antes do vencimento",async()=>{
  const original=global.fetch,calls=[];
  const fullPage=Array.from({length:1000},(_,index)=>({p:String(90+index/1000),T:900,a:index+1}));
  global.fetch=async(url)=>{
    calls.push(url);
    if(url.includes("fromId=1001"))return{ok:true,status:200,headers:new Headers(),json:async()=>[
      {p:"101",T:998,a:1001},
      {p:"102",T:999,a:1002},
      {p:"999",T:1001,a:1003},
    ]};
    return{ok:true,status:200,headers:new Headers(),json:async()=>fullPage};
  };
  try{
    const clock={now:()=>1100,status:()=>({})};
    const client=new MarketClient({hosts:["https://ok"],clock});
    const historical=await client.priceAt("BTCUSDT",1000,{toleranceMs:200});
    assert.equal(historical.value,102);
    assert.equal(historical.exchangeTimestamp,999);
    assert.equal(historical.tradeId,1002);
    assert.equal(calls.length,2);
    assert.match(calls[0],/startTime=800/);
    assert.match(calls[1],/fromId=1001/);
  }finally{global.fetch=original;}
});
