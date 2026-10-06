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
