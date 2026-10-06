"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const EventEmitter=require("node:events");const {RealtimeHub}=require("../src/engine/realtime-hub.cjs");

class FakeSocket extends EventEmitter{static CONNECTING=0;static OPEN=1;static CLOSED=3;static instances=[];constructor(url){super();this.url=url;this.readyState=FakeSocket.CONNECTING;this.sent=[];FakeSocket.instances.push(this);}open(){this.readyState=FakeSocket.OPEN;this.emit("open");}send(value){this.sent.push(JSON.parse(value));}message(value){this.emit("message",Buffer.from(JSON.stringify(value)));}close(){this.readyState=FakeSocket.CLOSED;this.emit("close");}terminate(){this.close();}}
const clock={now:()=>1_800_000_000_000,status:()=>({synced:true})};
const kline=(overrides={})=>({stream:'btcusdt@kline_15m',data:{e:'kline',E:clock.now()-200,s:'BTCUSDT',k:{s:'BTCUSDT',i:'15m',t:clock.now()-5000,T:clock.now()+894999,o:'100',h:'102',l:'98',c:'101',v:'10',q:'1000',n:10,V:'5',x:false,...overrides}}});

test('negocio atualiza OHLC provisorio sem duplicar volume da bolsa',()=>{
  FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:['wss://test'],WebSocketImpl:FakeSocket,clock});
  try{hub.start();const socket=FakeSocket.instances[1];socket.open();socket.message(kline());socket.message({data:{e:'aggTrade',s:'BTCUSDT',a:100,T:clock.now(),p:'105',q:'3',m:false}});
    assert.equal(hub.snapshot().candle.close,105);assert.equal(hub.snapshot().candle.high,105);assert.equal(hub.snapshot().candle.volume,10);
    socket.message(kline());assert.equal(hub.snapshot().candle.close,105);
  }finally{hub.close();}
});
test('preco e vela nao retrocedem com eventos atrasados',()=>{
  FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:['wss://test'],WebSocketImpl:FakeSocket,clock});
  try{hub.start();const socket=FakeSocket.instances[1];socket.open();socket.message(kline({x:true}));socket.message(kline());assert.equal(hub.snapshot().candle.closed,true);
    socket.message({data:{e:'aggTrade',s:'BTCUSDT',a:2,T:clock.now(),p:'105',q:'3',m:false}});
    socket.message({data:{e:'aggTrade',s:'BTCUSDT',a:1,T:clock.now()-100,p:'99',q:'3',m:false}});
    assert.equal(hub.snapshot().ticker.last,105);assert.equal(hub.snapshot().flow.trades,1);assert.equal(hub.snapshot().candle.close,101);assert.equal(hub.snapshot().connection.outOfOrderEvents,2);
  }finally{hub.close();}
});
test('snapshot e emitido em ate 100ms sem enviar lote para cada negocio',t=>{
  t.mock.timers.enable({apis:['setInterval']});FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:['wss://test'],WebSocketImpl:FakeSocket,clock});const events=[];
  try{hub.start();hub.addClient(event=>events.push(event));events.length=0;const socket=FakeSocket.instances[1];socket.open();
    for(let a=1;a<=50;a++)socket.message({data:{e:'aggTrade',s:'BTCUSDT',a,T:clock.now(),p:String(100+a),q:'1',m:false}});
    t.mock.timers.tick(99);assert.equal(events.length,0);t.mock.timers.tick(1);assert.equal(events.length,1);assert.equal(events[0].data.ticker.last,150);
  }finally{hub.close();t.mock.timers.reset();}
});
test('mensagem recem recebida nao torna uma cotacao antiga fresca',()=>{
  FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:['wss://test'],WebSocketImpl:FakeSocket,clock});
  try{hub.start();const socket=FakeSocket.instances[1];socket.open();socket.message({data:{e:'aggTrade',s:'BTCUSDT',a:1,T:clock.now()-11000,p:'100',q:'1',m:false}});
    assert.equal(hub.priceDatums().BTCUSDT,undefined);assert.equal(hub.snapshot().freshness.ticker.stale,true);assert.equal(hub.snapshot().stale,true);
  }finally{hub.close();}
});

test("radar ignora pares fora do contrato sem interromper os itens validos do lote",()=>{
  FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:["wss://test"],WebSocketImpl:FakeSocket,clock});const seen=[],warnings=[];
  hub.on('market-price',datum=>seen.push(datum.symbol));hub.on('warning',error=>warnings.push(error));
  try{hub.start();const socket=FakeSocket.instances[0];socket.open();
    const row={c:'100',o:'90',h:'105',l:'85',v:'2',q:'200',E:clock.now()};
    socket.message([null,{...row,s:'INVALID-NAMEUSDT'},{...row,s:'BTCUSDT'},{...row,s:'ETHUSDT'}]);
    assert.deepEqual(seen,['BTCUSDT','ETHUSDT']);assert.equal(warnings.length,0);assert.equal(hub.marketSnapshot().length,2);assert.ok(hub.snapshot().connection.malformedEvents>=2);
  }finally{hub.close();}
});

test("mensagem de socket antigo não contamina novo ativo",()=>{FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:["wss://test"],WebSocketImpl:FakeSocket,clock});try{hub.start();const old=FakeSocket.instances[1];old.open();hub.select("ETHUSDT","1m");const current=FakeSocket.instances.at(-1);current.open();old.message({stream:"btcusdt@aggTrade",data:{e:"aggTrade",s:"BTCUSDT",a:1,T:clock.now(),p:"50000",q:"1",m:false}});assert.equal(hub.snapshot().symbol,"ETHUSDT");assert.equal(hub.snapshot().ticker,null);current.message({stream:"ethusdt@aggTrade",data:{e:"aggTrade",s:"ETHUSDT",a:2,T:clock.now(),p:"2000",q:"2",m:false}});assert.equal(hub.priceDatums().ETHUSDT.value,2000);assert.equal(hub.priceDatums().BTCUSDT,undefined);}finally{hub.close();}});

test("aggTrade duplicado não altera fluxo duas vezes",()=>{FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:["wss://test"],WebSocketImpl:FakeSocket,clock});try{hub.start();const socket=FakeSocket.instances[1];socket.open();const event={stream:"btcusdt@aggTrade",data:{e:"aggTrade",s:"BTCUSDT",a:9,T:clock.now(),p:"100",q:"3",m:false}};socket.message(event);socket.message(event);assert.equal(hub.snapshot().flow.buyVolume,3);assert.equal(hub.snapshot().connection.duplicateTrades,1);}finally{hub.close();}});

test("snapshot do scanner não permite mutar estado interno",()=>{FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:["wss://test"],WebSocketImpl:FakeSocket,clock});try{hub.start();const market=FakeSocket.instances[0];market.open();market.message([{s:"BTCUSDT",c:"100",o:"90",h:"105",l:"85",v:"2",q:"200",E:clock.now()}]);const first=hub.marketSnapshot();first[0].last=0;assert.equal(hub.marketSnapshot()[0].last,100);}finally{hub.close();}});

test("eventos futuros são rejeitados e scanner publica preços de todos os pares",()=>{FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:["wss://test"],WebSocketImpl:FakeSocket,clock});const seen=[];hub.on("market-price",datum=>seen.push(datum));try{hub.start();const market=FakeSocket.instances[0],symbol=FakeSocket.instances[1];market.open();symbol.open();market.message([{s:"BTCUSDT",c:"100",o:"90",h:"105",l:"85",v:"2",q:"200",E:clock.now()},{s:"ETHUSDT",c:"20",o:"19",h:"21",l:"18",v:"3",q:"60",E:clock.now()}]);assert.deepEqual(new Set(seen.map(x=>x.symbol)),new Set(["BTCUSDT","ETHUSDT"]));symbol.message({stream:"btcusdt@aggTrade",data:{e:"aggTrade",s:"BTCUSDT",a:10,T:clock.now()+5000,p:"999",q:"1",m:false}});assert.notEqual(hub.snapshot().ticker?.last,999);assert.ok(hub.snapshot().connection.rejectedTimestamps>=1);}finally{hub.close();}});

test("alertas de preço recebem aggTrade dedicado dos símbolos monitorados",()=>{FakeSocket.instances=[];const hub=new RealtimeHub({streamHosts:["wss://test"],WebSocketImpl:FakeSocket,clock});const seen=[];hub.on("alert-price",datum=>seen.push(datum));try{hub.start();hub.watchPriceSymbols(["ETHUSDT","BTCUSDT"]);const socket=FakeSocket.instances.at(-1);socket.open();assert.deepEqual(new Set(socket.sent[0].params),new Set(["btcusdt@aggTrade","ethusdt@aggTrade"]));socket.message({e:"aggTrade",s:"ETHUSDT",a:42,T:clock.now(),p:"2000",q:"1",m:false});assert.equal(seen[0].symbol,"ETHUSDT");assert.equal(seen[0].value,2000);assert.equal(seen[0].exchangeTimestamp,clock.now());}finally{hub.close();}});
