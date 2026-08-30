"use strict";

const state = { token:"", symbol:"BTCUSDT", interval:"15m", coins:[], live:null, analysis:null, paper:null, alerts:[], journal:[], side:"buy", eventSource:null };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>'"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const fmt = (v, max=8) => Number.isFinite(Number(v)) ? new Intl.NumberFormat("pt-BR",{maximumFractionDigits:max}).format(Number(v)) : "--";
const money = (v) => Number.isFinite(Number(v)) ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"USD"}).format(Number(v)) : "--";
const pct = (v,d=2) => Number.isFinite(Number(v)) ? `${Number(v)>=0?"+":""}${Number(v).toFixed(d)}%` : "--";
const api = async (url, options={}) => {
  const res = await fetch(url,{...options,headers:{"Content-Type":"application/json","X-Dief-Token":state.token,...options.headers}});
  const data = await res.json().catch(()=>({error:`HTTP ${res.status}`}));
  if(!res.ok) throw new Error(data.error||`Falha ${res.status}`);
  return data;
};
const toast = (message,error=false) => { const el=$("toast"); el.textContent=message; el.className=`toast show${error?" error":""}`; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.className="toast",3200); };
const priceFormat = (v) => { const n=Number(v); if(!Number.isFinite(n)) return "--"; const digits=n>=1000?2:n>=1?4:n>=.01?6:8; return `$${fmt(n,digits)}`; };

function readToken(){ const url=new URL(location.href); state.token=url.searchParams.get("t")||""; url.searchParams.delete("t"); history.replaceState(null,"",url.pathname); }
function clock(){ $("clock").textContent=new Date().toLocaleTimeString("pt-BR"); }
function setConnection(online,text){ $("pulse").className=`pulse ${online?"online":"offline"}`; $("connection").textContent=text; }

async function bootstrap(){
  readToken(); clock(); setInterval(clock,1000);
  bind();
  try{
    const data=await api("/api/bootstrap");
    state.coins=data.coins||[]; state.symbol=data.selected.symbol; state.interval=data.selected.interval; state.paper=data.paper; state.alerts=data.alerts||[]; state.journal=data.journal||[];
    renderCoins(); renderPaper(); renderAlerts(); renderJournal(); updateSelection(); connectStream();
    await refreshAnalysis();
    setInterval(refreshCoins,10000); setInterval(()=>refreshAnalysis(true),6500);
  }catch(error){ setConnection(false,"falha local"); toast(error.message,true); }
}

function bind(){
  $("coinSearch").addEventListener("input",renderCoins);
  $("intervals").addEventListener("click",async(e)=>{const b=e.target.closest("button[data-i]");if(!b)return;state.interval=b.dataset.i;await selectMarket();});
  $("tabs").addEventListener("click",(e)=>{const b=e.target.closest("button[data-tab]");if(!b)return;document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".tab-page").forEach(x=>x.classList.toggle("active",x.id===`tab-${b.dataset.tab}`));if(b.dataset.tab==="reading")drawChart();});
  document.querySelectorAll(".side-toggle button").forEach(b=>b.addEventListener("click",()=>{state.side=b.dataset.side;document.querySelectorAll(".side-toggle button").forEach(x=>x.classList.toggle("active",x===b));}));
  $("paperForm").addEventListener("submit",submitPaper); $("alertForm").addEventListener("submit",submitAlert); $("journalForm").addEventListener("submit",submitJournal); $("aiForm").addEventListener("submit",saveAi); $("removeAi").addEventListener("click",removeAi); $("aiRead").addEventListener("click",readAi);
  window.addEventListener("resize",()=>requestAnimationFrame(drawChart));
}

async function refreshCoins(){ try{state.coins=await api("/api/coins?limit=220");renderCoins();}catch{} }
function renderCoins(){
  const q=$("coinSearch").value.trim().toUpperCase(); const rows=state.coins.filter(c=>!q||c.symbol.includes(q)||c.base?.includes(q));
  $("coinCount").textContent=rows.length; $("coinList").innerHTML=rows.map(c=>`<div class="coin-row ${c.symbol===state.symbol?"active":""}" data-symbol="${esc(c.symbol)}"><div><b>${esc(c.base||c.symbol.replace("USDT",""))}</b><small>/ USDT</small></div><span class="last">${priceFormat(c.last).slice(1)}</span><b class="${Number(c.changePct)>=0?"positive":"negative"}">${pct(c.changePct)}</b></div>`).join("")||`<p class="legal">Nenhum par encontrado.</p>`;
  $("coinList").querySelectorAll("[data-symbol]").forEach(row=>row.addEventListener("click",async()=>{state.symbol=row.dataset.symbol;await selectMarket();}));
}
async function selectMarket(){
  updateSelection(); renderCoins(); $("chartEmpty").style.display="grid"; $("chartEmpty").textContent="Atualizando a leitura…";
  try{await api("/api/live/select",{method:"POST",body:JSON.stringify({symbol:state.symbol,interval:state.interval})});connectStream();await refreshAnalysis();}catch(error){toast(error.message,true);}
}
function updateSelection(){
  const base=state.symbol.replace(/USDT$/,""); $("symbol").textContent=`${base}/USDT`; $("coinMark").textContent=base==="BTC"?"₿":base.slice(0,2); document.querySelectorAll("#intervals button").forEach(b=>b.classList.toggle("active",b.dataset.i===state.interval));
}
function connectStream(){
  state.eventSource?.close(); const es=new EventSource(`/api/live/stream?t=${encodeURIComponent(state.token)}`); state.eventSource=es;
  es.addEventListener("ready",()=>setConnection(true,"mercado ao vivo"));
  for(const type of ["snapshot","market"]) es.addEventListener(type,(event)=>{try{state.live=JSON.parse(event.data);renderLive();}catch{}});
  es.onerror=()=>setConnection(false,"reconectando…");
}
function renderLive(){
  const l=state.live;if(!l)return; setConnection(Boolean(l.connected&&!l.stale),l.stale?"dados atrasados":"mercado ao vivo");
  if(l.ticker?.last) $("price").textContent=priceFormat(l.ticker.last);
  const coin=state.coins.find(c=>c.symbol===state.symbol); if(coin){$("change").textContent=pct(coin.changePct);$("change").className=coin.changePct>=0?"positive":"negative";}
  const ratio=Number(l.flow?.buyRatio); $("buyRatio").textContent=Number.isFinite(ratio)?`${(ratio*100).toFixed(1)}%`:"--"; $("buySplit").style.width=`${(Number.isFinite(ratio)?ratio:.5)*100}%`;
  const imb=Number(l.book?.imbalance); $("imbalance").textContent=Number.isFinite(imb)?`${(imb*100).toFixed(1)}%`:"--"; $("bookSplit").style.width=`${(Number.isFinite(imb)?imb:.5)*100}%`;
  $("spread").textContent=pct(l.ticker?.spreadPct,4); $("delta").textContent=`Delta: ${fmt(l.flow?.delta,4)}`; renderBook(l.book);renderTape(l.trades);
}
function renderBook(book={}){
  const side=(rows,kind)=>{const max=Math.max(...(rows||[]).map(x=>x[1]),1);return `<div class="book-side ${kind}">${(rows||[]).slice(0,12).map(([p,q])=>`<div class="book-row" style="--depth:${Math.max(4,q/max*100)}%"><span class="${kind==="ask"?"negative":"positive"}">${fmt(p,8)}</span><span>${fmt(q,5)}</span></div>`).join("")}</div>`};
  $("book").innerHTML=side(book.bids,"bid")+side(book.asks,"ask");
}
function renderTape(trades=[]){$("tape").innerHTML=(trades||[]).slice(0,35).map(t=>`<div class="tape-row"><b class="${t.side==="buy"?"positive":"negative"}">${t.side==="buy"?"COMPRA":"VENDA"}</b><span>${fmt(t.price,8)}</span><span>${fmt(t.quantity,5)}</span></div>`).join("")||`<p class="legal">Aguardando negócios…</p>`;}

async function refreshAnalysis(silent=false){
  try{const a=await api(`/api/analysis/${state.symbol}?interval=${state.interval}`);state.analysis=a;renderAnalysis();if(!silent){$("chartEmpty").style.display="none";}}
  catch(error){if(!silent)toast(error.message,true);}
}
function renderAnalysis(){
  const a=state.analysis;if(!a)return; $("price").textContent=priceFormat(a.price); $("signal").textContent=a.signal;$("signal").className=`signal ${a.signal==="COMPRA"?"buy":a.signal==="VENDA"?"sell":""}`; $("regime").textContent=a.regime; $("confidence").textContent=`${a.confidence}%`;$("confidenceBar").style.width=`${a.confidence}%`;$("score").textContent=a.score>0?`+${a.score}`:a.score;$("scoreDot").style.left=`calc(${Math.max(0,Math.min(100,(a.score+100)/2))}% - 5px)`;
  const mt=a.multiTimeframe||{};$("alignment").textContent=`${mt.alignment??0}%`;const frames=mt.frames||{};$("frames").innerHTML=["1m","5m","15m","1h","4h"].map(f=>`<i title="${f}: ${esc(frames[f]?.signal||"--")}" class="${frames[f]?.signal==="COMPRA"?"buy":frames[f]?.signal==="VENDA"?"sell":""}"></i>`).join("");
  $("reasons").innerHTML=(a.reasons||[]).slice(0,12).map(r=>`<div class="reason ${r.points<0?"negative-reason":""}"><span class="dir">${r.points>0?"↗":r.points<0?"↘":"•"}</span><span>${esc(r.text||r.label||r.reason)}</span><b>${r.points>0?"+":""}${r.points}</b></div>`).join("");
  const labels={rsi:"RSI 14",macdHistogram:"MACD hist.",adx:"ADX",atrPct:"ATR %",volumeRatio:"Volume",stochasticK:"Estocástico K",ema9:"EMA 9",ema20:"EMA 20",ema50:"EMA 50",ema200:"EMA 200",vwap:"VWAP",roc:"ROC"};
  $("indicators").innerHTML=Object.entries(labels).map(([k,l])=>`<div class="data-item"><span>${l}</span><b>${fmt(a.indicators?.[k],k.includes("ema")||k==="vwap"?8:3)}</b></div>`).join("");
  $("warnings").innerHTML=(a.warnings||[]).map(w=>`<p>• ${esc(w)}</p>`).join("")||"<p>• Nenhum aviso automático adicional; risco de mercado continua existindo.</p>";
  $("staleBadge").textContent=state.live?.stale?"ATRASADO":"AO VIVO"; renderPlan(a.plan);renderLevels(a.levels);drawChart();
}
function renderPlan(p){$("riskPlan").innerHTML=p?[["Entrada",p.entry],["Stop técnico",p.stop],["Alvo 1",p.target1],["Alvo 2",p.target2],["Risco/retorno",`1:${p.riskReward2}`],["Qtd. ref.",p.suggestedQuantity]].map(([l,v])=>`<div class="risk-card"><span>${l}</span><b>${fmt(v,8)}</b></div>`).join(""):`<p class="legal">Sinal em espera: não há plano de entrada até existir confluência suficiente.</p>`;}
function renderLevels(levels={}){const group=(title,rows,cls)=>`<div class="level-group"><h3 class="${cls}">${title}</h3>${(rows||[]).map(x=>`<div class="level-row"><span>${fmt(x.price,8)}</span><small>${x.touches} toques</small></div>`).join("")||"<small>Sem nível forte próximo.</small>"}</div>`;$("levels").innerHTML=group("SUPORTES",levels.supports,"positive")+group("RESISTÊNCIAS",levels.resistances,"negative");}

function drawChart(){
  const canvas=$("chart"),wrap=canvas.parentElement,a=state.analysis; if(!a?.series?.candles?.length)return; const dpr=devicePixelRatio||1,w=wrap.clientWidth,h=wrap.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const candles=a.series.candles.slice(-150),count=candles.length,pad={l:10,r:70,t:10,b:52},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;const highs=candles.map(c=>c.high),lows=candles.map(c=>c.low),max=Math.max(...highs),min=Math.min(...lows),range=Math.max(max-min,1e-9),y=v=>pad.t+(max-v)/range*ch,x=i=>pad.l+(i+.5)/count*cw,bar=Math.max(1,cw/count*.62);
  ctx.strokeStyle="#14271b";ctx.fillStyle="#6e8176";ctx.font="10px Segoe UI";for(let i=0;i<6;i++){const yy=pad.t+i*ch/5;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();const val=max-i*range/5;ctx.fillText(fmt(val,val>100?2:6),w-pad.r+8,yy+3)}
  const volMax=Math.max(...candles.map(c=>c.volume),1);candles.forEach((c,i)=>{const xx=x(i),up=c.close>=c.open,color=up?"#2eea7b":"#ff5e6c";ctx.fillStyle=up?"#2eea7b25":"#ff5e6c25";const vh=Math.min(38,c.volume/volMax*38);ctx.fillRect(xx-bar/2,h-pad.b+43-vh,bar,vh);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(xx,y(c.high));ctx.lineTo(xx,y(c.low));ctx.stroke();ctx.fillStyle=color;const top=y(Math.max(c.open,c.close)),bottom=y(Math.min(c.open,c.close));ctx.fillRect(xx-bar/2,top,bar,Math.max(1,bottom-top));});
  const drawLine=(values,color)=>{const arr=values.slice(-count);ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.beginPath();let started=false;arr.forEach((v,i)=>{if(!Number.isFinite(v))return;const xx=x(i),yy=y(v);if(!started){ctx.moveTo(xx,yy);started=true}else ctx.lineTo(xx,yy)});ctx.stroke()};drawLine(a.series.ema9,"#ffcb52");drawLine(a.series.ema20,"#35e083");drawLine(a.series.ema50,"#6b8cff");drawLine(a.series.vwap,"#ca6bff");
}

async function submitPaper(e){e.preventDefault();try{const out=await api("/api/paper/order",{method:"POST",body:JSON.stringify({symbol:state.symbol,side:state.side,quantity:Number($("paperQty").value),note:$("paperNote").value})});state.paper=out.portfolio;renderPaper();$("paperMessage").textContent="Ordem simulada executada.";toast("Simulação registrada");}catch(error){$("paperMessage").textContent=error.message;}}
function renderPaper(){const p=state.paper;if(!p)return;$("cash").textContent=money(p.cash);$("equity").textContent=money(p.equity);$("paperReturn").textContent=pct(p.totalReturn);$("paperReturn").className=p.totalReturn>=0?"positive":"negative";$("realized").textContent=money(p.realized);$("positions").innerHTML=(p.positions||[]).map(x=>`<div class="list-row"><span><b>${esc(x.symbol)}</b><small> ${fmt(x.quantity,8)} @ ${fmt(x.average,8)}</small></span><b class="${x.unrealized>=0?"positive":"negative"}">${money(x.unrealized)}</b></div>`).join("")||`<p class="legal">Nenhuma posição simulada.</p>`;$("trades").innerHTML=(p.trades||[]).slice(0,12).map(t=>`<div class="list-row"><span><b class="${t.side==="buy"?"positive":"negative"}">${t.side==="buy"?"COMPRA":"VENDA"}</b> ${esc(t.symbol)}</span><small>${fmt(t.quantity,8)} @ ${fmt(t.price,8)}</small></div>`).join("");}
async function submitAlert(e){e.preventDefault();try{const item=await api("/api/alerts",{method:"POST",body:JSON.stringify({symbol:state.symbol,kind:$("alertKind").value,value:Number($("alertValue").value),note:$("alertNote").value})});state.alerts.unshift(item);renderAlerts();toast("Alerta criado");}catch(error){toast(error.message,true);}}
function renderAlerts(){$("alertsList").innerHTML=state.alerts.map(a=>`<div class="list-row"><span><b>${esc(a.symbol)}</b><small> ${a.kind==="price_gte"?"≥":"≤"} ${fmt(a.value,8)}</small></span><button class="danger" data-alert="${a.id}">×</button></div>`).join("");$("alertsList").querySelectorAll("[data-alert]").forEach(b=>b.onclick=async()=>{await api(`/api/alerts/${b.dataset.alert}`,{method:"DELETE"});state.alerts=state.alerts.filter(x=>x.id!==b.dataset.alert);renderAlerts();});}
async function submitJournal(e){e.preventDefault();try{const item=await api("/api/journal",{method:"POST",body:JSON.stringify({symbol:state.symbol,interval:state.interval,setup:$("journalSetup").value,note:$("journalNote").value,side:"observe"})});state.journal.unshift(item);renderJournal();toast("Anotação salva");}catch(error){toast(error.message,true);}}
function renderJournal(){$("journalList").innerHTML=state.journal.slice(0,10).map(j=>`<div class="list-row"><span><b>${esc(j.symbol)}</b> ${esc(j.setup||"Observação")}<small> ${new Date(j.createdAt).toLocaleString("pt-BR")}</small></span><button class="danger" data-journal="${j.id}">×</button></div>`).join("");$("journalList").querySelectorAll("[data-journal]").forEach(b=>b.onclick=async()=>{await api(`/api/journal/${b.dataset.journal}`,{method:"DELETE"});state.journal=state.journal.filter(x=>x.id!==b.dataset.journal);renderJournal();});}
async function saveAi(e){e.preventDefault();try{const key=$("aiKey").value.trim();if(!key)throw new Error("Cole uma chave nova.");const result=await api("/api/ai/config",{method:"POST",body:JSON.stringify({apiKey:key,model:$("aiModel").value.trim()})});$("aiKey").value="";$("aiStatus").textContent=result.configured?`Protegida no Windows · ${result.model}`:"Não configurada";toast("Chave salva de forma protegida");}catch(error){$("aiStatus").textContent=error.message;}}
async function removeAi(){try{await api("/api/ai/config",{method:"DELETE"});$("aiStatus").textContent="Chave removida.";toast("Chave de IA removida");}catch(error){toast(error.message,true);}}
async function readAi(){const b=$("aiRead");b.disabled=true;$("aiResult").textContent="Gerando uma leitura complementar sem enviar ordens…";try{const out=await api("/api/ai/read",{method:"POST",body:JSON.stringify({symbol:state.symbol,interval:state.interval})});$("aiResult").textContent=formatAi(out);}catch(error){$("aiResult").textContent=error.message;}finally{b.disabled=false;}}
function formatAi(v){if(typeof v==="string")return v;const lines=[];for(const [k,val] of Object.entries(v||{}))lines.push(`${k.replace(/_/g," ").toUpperCase()}: ${Array.isArray(val)?val.join(" · "):typeof val==="object"?JSON.stringify(val):val}`);return lines.join("\n\n");}

bootstrap();
