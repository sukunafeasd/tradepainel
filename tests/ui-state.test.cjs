"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {getEventListeners}=require("node:events");
const source=fs.readFileSync(path.join(__dirname,"../src/ui/app.js"),"utf8").replace(/bootstrap\(\);\s*$/," ");
function harness(extra={}){
  const elements=new Map();
  const context=vm.createContext({console,AbortController,DOMException,setTimeout,clearTimeout,URLSearchParams,
    document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{textContent:"",className:"",style:{}});return elements.get(id);}},...extra});
  vm.runInContext(source,context);
  return{context,run:code=>vm.runInContext(code,context)};
}
test('dados ausentes nao sao formatados como zero',()=>{const h=harness();for(const fn of ['fmt','money','pct','priceFormat']){assert.equal(h.run(`${fn}(null)`),'--');assert.equal(h.run(`${fn}(undefined)`),'--');assert.equal(h.run(`${fn}("")`),'--');}assert.equal(h.run('fmt(0)'),'0');assert.equal(h.run('pct(0)'),'+0.00%');});
test('preco pequeno nao e arredondado para zero no grafico',()=>{const h=harness();assert.notEqual(h.run('priceNumber(0.000000125)'),'0');assert.equal(h.run('priceNumber(0.000000125)'),'0,000000125');});
test('virada de periodo preserva velas recebidas antes do proximo REST',()=>{
  const h=harness();h.run('requestChart=()=>{};state.analysis={series:{candles:[{t:1,close:100}]}};');
  const candle={t:2,open:100,high:105,low:99,close:103,volume:5,closed:false};
  h.context.candle=candle;h.run('mergeLiveCandle(candle)');
  h.context.candle={...candle,closed:true};h.run('mergeLiveCandle(candle)');
  h.context.candle={...candle,t:3};h.run('mergeLiveCandle(candle)');
  assert.equal(h.run('displayCandles().length'),3);assert.equal(h.run('displayCandles()[1].closed'),true);
  h.context.candle=candle;h.run('mergeLiveCandle(candle)');assert.equal(h.run('displayCandles().at(-1).t'),3);
});
test('redesenhos sao consolidados em um frame sem cancelar o anterior',()=>{
  const frames=[];const h=harness({requestAnimationFrame:cb=>{frames.push(cb);return frames.length;}});
  h.run('drawChart=()=>{};requestChart();requestChart();requestChart();');assert.equal(frames.length,1);frames[0]();h.run('requestChart()');assert.equal(frames.length,2);
});
test('historico confirmado nao e substituido por vela provisoria antiga',()=>{const h=harness();h.run('state.analysis={series:{candles:[{t:2,close:105,closed:true}]}};state.liveCandles=[{t:2,close:99,closed:false}];');assert.equal(h.run('displayCandles()[0].close'),105);});
test('snapshot sem mudanca na vela nao solicita outro redraw',()=>{const h=harness();h.run('let paints=0;requestChart=()=>{paints++};const candle={t:1,open:100,high:101,low:99,close:100,volume:10,closed:false};mergeLiveCandle(candle);mergeLiveCandle({...candle});');assert.equal(h.run('paints'),1);h.run('mergeLiveCandle({...candle,close:101})');assert.equal(h.run('paints'),2);});
test('eventos da conexao SSE substituida nao contaminam interface',()=>{
  const sources=[];class Source{constructor(){this.handlers={};sources.push(this);}addEventListener(type,fn){this.handlers[type]=fn;}close(){}}
  const h=harness({EventSource:Source});h.run('renderLive=()=>{};connectStream();connectStream();');sources[0].handlers.snapshot({data:JSON.stringify({symbol:'BTCUSDT',interval:'15m',ticker:{last:99}})});assert.equal(h.run('state.live'),null);sources[0].onerror();assert.equal(h.run('$("connection").textContent'),'');sources[1].handlers.snapshot({data:JSON.stringify({symbol:'BTCUSDT',interval:'15m',ticker:{last:101}})});assert.equal(h.run('state.live.ticker.last'),101);
});
test("polling nao cancela analise lenta ainda em andamento",async()=>{
  let resolve,calls=0;
  const pending=new Promise(r=>resolve=r);
  const h=harness({fetch:async()=>{calls++;await pending;return{ok:true,json:async()=>({id:"slow"})};}});
  h.run('renderAnalysis=()=>{};refreshSignals=async()=>{}');
  const first=h.run('refreshAnalysis()');
  await h.run('refreshAnalysis(true)');
  assert.equal(calls,1);
  assert.equal(h.run('state.analysisController.signal.aborted'),false);
  resolve();await first;
  assert.equal(h.run('state.analysis.id'),"slow");
  assert.equal(h.run('state.analysisController'),null);
});
test("timeout inclui corpo da resposta, nao apenas cabecalhos",async()=>{
  const h=harness({fetch:async(url,request)=>({ok:true,json:()=>new Promise((resolve,reject)=>request.signal.addEventListener("abort",()=>reject(request.signal.reason),{once:true}))})});
  await assert.rejects(h.run('api("/slow-body",{timeoutMs:20})'),/demorou demais/);
});
test("requisicoes concluidas removem listener de cancelamento",async()=>{
  const controller=new AbortController();
  const h=harness({signal:controller.signal,fetch:async()=>({ok:true,json:async()=>({ok:true})})});
  for(let i=0;i<20;i++)await h.run('api("/fast",{signal})');
  assert.equal(getEventListeners(controller.signal,"abort").length,0);
});
test("trocar mercado descarta vela provisoria e resposta antiga de IA",async()=>{
  const h=harness({fetch:async()=>({ok:true,json:async()=>({ok:true})})});
  h.run('loadDrawings=()=>{};updateSelection=()=>{};renderCoins=()=>{};connectStream=()=>{};refreshAnalysis=async()=>{};state.provisionalCandle={t:123};state.aiGeneration=4;');
  await h.run('selectMarket()');
  assert.equal(h.run('state.provisionalCandle'),null);
  assert.equal(h.run('state.aiGeneration'),5);
});
test("alterar retorno preserva saldo, operacoes e historico",async()=>{
  const h=harness({fetch:async()=>({ok:true,json:async()=>({payoutRate:.9})})});
  h.run('renderPaper=()=>{};state.paper={balance:9900,payoutRate:.82,open:[{id:"open"}],results:[{id:"result"}]};$("paperPayout").value="0.90";');
  await h.run('savePaperSettings()');
  assert.equal(h.run('state.paper.balance'),9900);
  assert.equal(h.run('state.paper.open[0].id'),"open");
  assert.equal(h.run('state.paper.results[0].id'),"result");
  assert.equal(h.run('state.paper.payoutRate'),.9);
  assert.equal(h.run('$("paperPayout").disabled'),false);
});
test("busca antiga do diario nao sobrescreve busca mais recente",async()=>{
  const pending=[];
  const h=harness({fetch:url=>new Promise(resolve=>pending.push({url,resolve}))});
  h.run('renderJournal=()=>{}');
  const old=h.run('loadJournal({query:"old"})'),latest=h.run('loadJournal({query:"new"})');
  pending[1].resolve({ok:true,json:async()=>({items:[{id:"new"}],query:"new"})});await latest;
  pending[0].resolve({ok:true,json:async()=>({items:[{id:"old"}],query:"old"})});await old;
  assert.equal(h.run('state.journal[0].id'),"new");
  assert.equal(h.run('state.journalPage.query'),"new");
});
test("desenhos malformados sao filtrados sem quebrar grafico",()=>{
  let payload=JSON.stringify([null,{type:"trend"},{type:"horizontal",price:-1},{type:"horizontal",price:100},{type:"trend",a:{t:1,price:2},b:{t:2,price:3}}]);
  const h=harness({localStorage:{getItem:()=>payload,setItem:()=>{throw Error("quota");}}});
  h.run('loadDrawings()');assert.equal(h.run('state.chartDrawings.length'),2);
  assert.doesNotThrow(()=>h.run('saveDrawings()'));
  payload='{}';h.run('loadDrawings()');assert.equal(h.run('state.chartDrawings.length'),0);
});
