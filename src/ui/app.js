"use strict";

const state = { token:"", symbol:"BTCUSDT", interval:"15m", coins:[], live:null, analysis:null, paper:null, alerts:[], journal:[], side:"buy", eventSource:null, chartFrame:null, chartZoom:120, chartOffset:0, chartFollow:true, chartCrosshair:null, chartDrag:null, chartMetrics:null, lastResultId:null };
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
  readToken(); applyPreferences(); clock(); setInterval(clock,1000);
  bind();
  try{
    const data=await api("/api/bootstrap");
    state.coins=data.coins||[]; state.symbol=data.selected.symbol; state.interval=data.selected.interval; state.paper=data.paper; state.alerts=data.alerts||[]; state.journal=data.journal||[];state.lastResultId=state.paper?.results?.[0]?.id||"__empty__";
    $("aiProvider").value=data.ai?.provider||"gemini";$("aiModel").value=data.ai?.model||($("aiProvider").value==="gemini"?"gemini-2.5-flash":"gpt-5");
    $("aiStatus").textContent=data.ai?.configured?`Chave protegida · ${data.ai.provider==="gemini"?"Gemini":"OpenAI"} · ${data.ai.model}`:"IA ainda não configurada";
    renderCoins(); renderPaper(); renderAlerts(); renderJournal(); updateSelection(); connectStream();
    await refreshAnalysis();
    setInterval(refreshCoins,10000); setInterval(()=>refreshAnalysis(true),6500);setInterval(refreshPaper,500);
  }catch(error){ setConnection(false,"falha local"); toast(error.message,true); }
}

function bind(){
  $("coinSearch").addEventListener("input",renderCoins);
  $("intervals").addEventListener("click",async(e)=>{const b=e.target.closest("button[data-i]");if(!b)return;state.interval=b.dataset.i;await selectMarket();});
  $("tabs").addEventListener("click",(e)=>{const b=e.target.closest("button[data-tab]");if(!b)return;document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".tab-page").forEach(x=>x.classList.toggle("active",x.id===`tab-${b.dataset.tab}`));if(b.dataset.tab==="reading")drawChart();});
  document.querySelectorAll(".side-toggle button").forEach(b=>b.addEventListener("click",()=>{state.side=b.dataset.side;document.querySelectorAll(".side-toggle button").forEach(x=>x.classList.toggle("active",x===b));}));
  document.querySelectorAll(".side-toggle button").forEach(b=>b.addEventListener("click",updateOrderPreview));
  $("paperQty").addEventListener("input",updateOrderPreview);$("paperExpiry").addEventListener("change",updateOrderPreview);
  document.querySelectorAll(".quick-values button").forEach(b=>b.addEventListener("click",()=>{$("paperQty").value=b.dataset.value;updateOrderPreview();}));
  $("paperForm").addEventListener("submit",submitPaper); $("alertForm").addEventListener("submit",submitAlert); $("journalForm").addEventListener("submit",submitJournal); $("aiForm").addEventListener("submit",saveAi); $("removeAi").addEventListener("click",removeAi); $("aiRead").addEventListener("click",readAi);
  $("resetPaper").addEventListener("click",resetPaper);$("aiProvider").addEventListener("change",()=>setAiProviderDefaults(true));
  $("openSettings").addEventListener("click",()=>{$("settingsModal").classList.add("open");$("settingsModal").setAttribute("aria-hidden","false");}); $("closeSettings").addEventListener("click",closeSettings); $("settingsModal").addEventListener("click",e=>{if(e.target===$("settingsModal"))closeSettings();});
  $("themeGrid").addEventListener("click",e=>{const b=e.target.closest("[data-theme]");if(!b)return;savePreference("theme",b.dataset.theme);applyPreferences();});
  $("uiScale").addEventListener("change",e=>{savePreference("scale",e.target.value);applyPreferences();}); $("reduceMotion").addEventListener("change",e=>{savePreference("reduceMotion",e.target.checked);applyPreferences();});
  $("chartFollow").addEventListener("click",()=>setChartView(0,state.chartZoom,true));$("chartOlder").addEventListener("click",()=>setChartView(state.chartOffset+Math.max(10,Math.round(state.chartZoom/5)),state.chartZoom,false));$("chartZoomIn").addEventListener("click",()=>setChartView(state.chartOffset,Math.max(30,state.chartZoom-20),state.chartFollow));$("chartZoomOut").addEventListener("click",()=>setChartView(state.chartOffset,Math.min(260,state.chartZoom+20),state.chartFollow));$("chartReset").addEventListener("click",()=>setChartView(0,120,true));
  const chart=$("chart");chart.addEventListener("wheel",e=>{e.preventDefault();setChartView(state.chartOffset,Math.max(30,Math.min(260,state.chartZoom+(e.deltaY>0?20:-20))),state.chartFollow);},{passive:false});chart.addEventListener("pointerdown",e=>{state.chartDrag={x:e.clientX,offset:state.chartOffset};chart.setPointerCapture?.(e.pointerId);});chart.addEventListener("pointermove",e=>{const box=chart.getBoundingClientRect();state.chartCrosshair={x:e.clientX-box.left,y:e.clientY-box.top};if(state.chartDrag&&state.chartMetrics){const step=Math.max(2,state.chartMetrics.cw/state.chartMetrics.count),moved=Math.round((e.clientX-state.chartDrag.x)/step);setChartView(state.chartDrag.offset+moved,state.chartZoom,false);}else requestChart();});chart.addEventListener("pointerup",()=>{state.chartDrag=null;});chart.addEventListener("pointercancel",()=>{state.chartDrag=null;});chart.addEventListener("pointerleave",()=>{if(!state.chartDrag){state.chartCrosshair=null;$("chartTooltip").style.display="none";requestChart();}});
  window.addEventListener("resize",()=>requestAnimationFrame(drawChart));
}

function requestChart(){if(state.chartFrame)cancelAnimationFrame(state.chartFrame);state.chartFrame=requestAnimationFrame(drawChart);}
function setChartView(offset,zoom,follow=false){const max=Math.max(0,(state.analysis?.series?.candles?.length||0)-30);state.chartOffset=Math.max(0,Math.min(max,Number(offset)||0));state.chartZoom=Math.max(30,Math.min(260,Number(zoom)||120));state.chartFollow=Boolean(follow&&state.chartOffset===0);$("chartFollow").classList.toggle("active",state.chartFollow);requestChart();}
function setAiProviderDefaults(force=false){const provider=$("aiProvider").value,target=provider==="gemini"?"gemini-2.5-flash":"gpt-5";if(force||!$("aiModel").value.trim())$("aiModel").value=target;$("aiKey").placeholder=provider==="gemini"?"Cole a chave do Google AI Studio":"Cole a chave da OpenAI";}

function closeSettings(){$("settingsModal").classList.remove("open");$("settingsModal").setAttribute("aria-hidden","true");}
function savePreference(key,value){const prefs=JSON.parse(localStorage.getItem("dieftrade.preferences")||"{}");prefs[key]=value;localStorage.setItem("dieftrade.preferences",JSON.stringify(prefs));}
function applyPreferences(){let prefs={};try{prefs=JSON.parse(localStorage.getItem("dieftrade.preferences")||"{}");}catch{}const theme=prefs.theme||"dief",scale=prefs.scale||"normal";document.body.dataset.theme=theme;document.body.dataset.scale=scale;document.body.classList.toggle("reduce-motion",Boolean(prefs.reduceMotion));if($("themeGrid"))document.querySelectorAll(".theme-choice").forEach(x=>x.classList.toggle("active",x.dataset.theme===theme));if($("uiScale"))$("uiScale").value=scale;if($("reduceMotion"))$("reduceMotion").checked=Boolean(prefs.reduceMotion);setTimeout(drawChart,30);}

async function refreshCoins(){ try{state.coins=await api("/api/coins?limit=220");renderCoins();}catch{} }
function renderCoins(){
  const q=$("coinSearch").value.trim().toUpperCase(); const rows=state.coins.filter(c=>!q||c.symbol.includes(q)||c.base?.includes(q));
  $("coinCount").textContent=rows.length; $("coinList").innerHTML=rows.map(c=>`<div class="coin-row ${c.symbol===state.symbol?"active":""}" data-symbol="${esc(c.symbol)}"><div><b>${esc(c.base||c.symbol.replace("USDT",""))}</b><small>/ USDT</small></div><span class="last">${priceFormat(c.last).slice(1)}</span><b class="${Number(c.changePct)>=0?"positive":"negative"}">${pct(c.changePct)}</b></div>`).join("")||`<p class="legal">Nenhum par encontrado.</p>`;
  $("coinList").querySelectorAll("[data-symbol]").forEach(row=>row.addEventListener("click",async()=>{state.symbol=row.dataset.symbol;await selectMarket();}));
}
async function selectMarket(){
  state.chartOffset=0;state.chartFollow=true;state.chartCrosshair=null;
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
  es.addEventListener("coins",event=>{try{state.coins=JSON.parse(event.data);renderCoins();}catch{}});
  es.onerror=()=>setConnection(false,"reconectando…");
}
function renderLive(){
  const l=state.live;if(!l)return; setConnection(Boolean(l.connected&&!l.stale),l.stale?"dados atrasados":"mercado ao vivo");
  if(l.ticker?.last) $("price").textContent=priceFormat(l.ticker.last);
  const coin=state.coins.find(c=>c.symbol===state.symbol); if(coin){$("change").textContent=pct(coin.changePct);$("change").className=coin.changePct>=0?"positive":"negative";}
  const ratio=Number(l.flow?.buyRatio); $("buyRatio").textContent=Number.isFinite(ratio)?`${(ratio*100).toFixed(1)}%`:"--"; $("buySplit").style.width=`${(Number.isFinite(ratio)?ratio:.5)*100}%`;
  const imb=Number(l.book?.imbalance); $("imbalance").textContent=Number.isFinite(imb)?`${(imb*100).toFixed(1)}%`:"--"; $("bookSplit").style.width=`${(Number.isFinite(imb)?imb:.5)*100}%`;
  $("spread").textContent=pct(l.ticker?.spreadPct,4); $("delta").textContent=`Delta: ${fmt(l.flow?.delta,4)}`; renderBook(l.book);renderTape(l.trades);
  mergeLiveCandle(l.candle);
}
function mergeLiveCandle(candle){if(!candle||!state.analysis?.series?.candles?.length)return;const rows=state.analysis.series.candles,last=rows.at(-1);if(Number(last.t)===Number(candle.t))rows[rows.length-1]={...last,...candle};else if(Number(candle.t)>Number(last.t)){rows.push(candle);if(rows.length>500)rows.shift();}if(state.chartFollow)state.chartOffset=0;requestChart();}
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
  $("staleBadge").textContent=state.live?.stale?"ATRASADO":"AO VIVO"; renderPlan(a.plan);renderLevels(a.levels);updatePixel();updateOrderPreview();drawChart();
}
function updatePixel(){const signal=state.analysis?.signal||"AGUARDE",pixel=$("pixel");pixel.className=`pixel-wrap ${signal==="COMPRA"?"mood-up":signal==="VENDA"?"mood-down":"mood-flat"}`;$("pixelTip").textContent=signal==="COMPRA"?"hum… compradores acordaram":signal==="VENDA"?"cuidado, pressão vendedora":"mercado pensando; eu também";}
function renderPlan(p){$("riskPlan").innerHTML=p?[["Entrada",p.entry],["Stop técnico",p.stop],["Alvo 1",p.target1],["Alvo 2",p.target2],["Risco/retorno",`1:${p.riskReward2}`],["Qtd. ref.",p.suggestedQuantity]].map(([l,v])=>`<div class="risk-card"><span>${l}</span><b>${fmt(v,8)}</b></div>`).join(""):`<p class="legal">Sinal em espera: não há plano de entrada até existir confluência suficiente.</p>`;}
function renderLevels(levels={}){const group=(title,rows,cls)=>`<div class="level-group"><h3 class="${cls}">${title}</h3>${(rows||[]).map(x=>`<div class="level-row"><span>${fmt(x.price,8)}</span><small>${x.touches} toques</small></div>`).join("")||"<small>Sem nível forte próximo.</small>"}</div>`;$("levels").innerHTML=group("SUPORTES",levels.supports,"positive")+group("RESISTÊNCIAS",levels.resistances,"negative");}

function drawChart(){
  const canvas=$("chart"),wrap=canvas.parentElement,a=state.analysis,all=a?.series?.candles||[]; if(!all.length)return; const dpr=devicePixelRatio||1,w=wrap.clientWidth,h=wrap.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const end=Math.max(1,all.length-state.chartOffset),start=Math.max(0,end-state.chartZoom),candles=all.slice(start,end),count=candles.length,pad={l:12,r:82,t:12,b:52},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;const highs=candles.map(c=>Number(c.high)),lows=candles.map(c=>Number(c.low)),rawMax=Math.max(...highs),rawMin=Math.min(...lows),margin=Math.max((rawMax-rawMin)*.06,rawMax*1e-6),max=rawMax+margin,min=rawMin-margin,range=Math.max(max-min,1e-9),y=v=>pad.t+(max-v)/range*ch,x=i=>pad.l+(i+.5)/count*cw,bar=Math.max(1,cw/count*.62);state.chartMetrics={cw,count,pad,w,h,start,end};
  ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue("--line")||"#14271b";ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--muted")||"#6e8176";ctx.font="10px Segoe UI";for(let i=0;i<6;i++){const yy=pad.t+i*ch/5;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();const val=max-i*range/5;ctx.fillText(fmt(val,val>100?2:6),w-pad.r+8,yy+3)}
  for(let i=0;i<5;i++){const idx=Math.min(count-1,Math.round(i*(count-1)/4)),xx=x(idx),time=new Date(Number(candles[idx]?.t||0)).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--muted")||"#6e8176";ctx.fillText(time,Math.max(pad.l,Math.min(w-pad.r-35,xx-17)),h-8);}
  const volMax=Math.max(...candles.map(c=>c.volume),1);candles.forEach((c,i)=>{const xx=x(i),up=c.close>=c.open,color=up?"#2eea7b":"#ff5e6c";ctx.fillStyle=up?"#2eea7b25":"#ff5e6c25";const vh=Math.min(38,c.volume/volMax*38);ctx.fillRect(xx-bar/2,h-pad.b+43-vh,bar,vh);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(xx,y(c.high));ctx.lineTo(xx,y(c.low));ctx.stroke();ctx.fillStyle=color;const top=y(Math.max(c.open,c.close)),bottom=y(Math.min(c.open,c.close));ctx.fillRect(xx-bar/2,top,bar,Math.max(1,bottom-top));});
  const drawLine=(values,color)=>{const arr=(values||[]).slice(start,end);ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.beginPath();let started=false;arr.forEach((v,i)=>{if(!Number.isFinite(v))return;const xx=x(i),yy=y(v);if(!started){ctx.moveTo(xx,yy);started=true}else ctx.lineTo(xx,yy)});ctx.stroke()};drawLine(a.series.ema9,"#ffcb52");drawLine(a.series.ema20,"#35e083");drawLine(a.series.ema50,"#6b8cff");drawLine(a.series.vwap,"#ca6bff");
  const last=candles.at(-1),lastY=y(last.close),up=last.close>=last.open,lastColor=up?"#18d873":"#ff5e6c";ctx.setLineDash([5,4]);ctx.strokeStyle=lastColor;ctx.beginPath();ctx.moveTo(pad.l,lastY);ctx.lineTo(w-pad.r,lastY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=lastColor;ctx.fillRect(w-pad.r+3,lastY-10,pad.r-6,20);ctx.fillStyle="#061009";ctx.font="bold 10px Segoe UI";ctx.fillText(fmt(last.close,last.close>100?2:6),w-pad.r+7,lastY+4);
  const tip=$("chartTooltip"),cross=state.chartCrosshair;if(cross&&cross.x>=pad.l&&cross.x<=w-pad.r&&cross.y>=pad.t&&cross.y<=h-pad.b){const idx=Math.max(0,Math.min(count-1,Math.floor((cross.x-pad.l)/cw*count))),c=candles[idx],xx=x(idx),yy=Math.max(pad.t,Math.min(h-pad.b,cross.y)),hoverPrice=max-(yy-pad.t)/ch*range;ctx.setLineDash([3,4]);ctx.strokeStyle="#93aa9b88";ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,h-pad.b);ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();ctx.setLineDash([]);tip.style.display="block";tip.style.left=`${Math.min(w-225,Math.max(8,xx+12))}px`;tip.style.top=`${Math.max(8,Math.min(h-86,yy-42))}px`;tip.innerHTML=`<b>${new Date(Number(c.t)).toLocaleString("pt-BR")}</b><span>A ${fmt(c.open,8)} · M ${fmt(c.high,8)}</span><span>m ${fmt(c.low,8)} · F ${fmt(c.close,8)}</span><span>Cursor ${fmt(hoverPrice,8)}</span>`;}else tip.style.display="none";
}

function paperPrice(){return Number(state.live?.ticker?.last||state.analysis?.price);}
function expiryLabel(ms){if(ms>=60000)return `${Math.round(ms/60000)} min`;return `${Math.round(ms/1000)} s`;}
function countdown(ms){const total=Math.max(0,Math.ceil(Number(ms)/1000)),m=Math.floor(total/60),s=total%60;return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;}
function updateOrderPreview(){if(!$("orderPreview"))return;const stake=Number($("paperQty").value),price=paperPrice(),duration=Number($("paperExpiry").value);if(!(stake>0)||!(price>0)){$("orderPreview").textContent="Escolha se o preço estará acima ou abaixo ao terminar o tempo.";return;}const direction=state.side==="buy"?"acima":"abaixo",profit=stake*Number(state.paper?.payoutRate||.82);$("orderPreview").textContent=`${money(stake)} em ${state.symbol.replace("USDT","/USDT")}: você vence se o preço terminar ${direction} de ${priceFormat(price)} após ${expiryLabel(duration)}. Lucro no acerto: ${money(profit)}.`;}
async function submitPaper(e){e.preventDefault();const stake=Number($("paperQty").value),price=paperPrice(),durationMs=Number($("paperExpiry").value);$("paperMessage").textContent="";try{if(!(stake>=1)||!(price>0))throw new Error("Informe um valor a partir de US$ 1 e aguarde o preço ao vivo.");if(stake>(state.paper?.balance||0))throw new Error(`Saldo virtual insuficiente. Disponível: ${money(state.paper?.balance||0)}.`);const out=await api("/api/paper/order",{method:"POST",body:JSON.stringify({symbol:state.symbol,direction:state.side==="buy"?"up":"down",stake,durationMs,interval:state.interval,note:$("paperNote").value})});state.paper=out.portfolio;renderPaper();$("paperMessage").textContent=`Operação iniciada; resultado em ${expiryLabel(durationMs)}.`;toast("Operação demo iniciada");}catch(error){$("paperMessage").textContent=error.message;toast(error.message,true);}}
async function refreshPaper(){try{const latest=await api("/api/paper");const newest=latest.results?.[0];if(newest&&newest.id!==state.lastResultId)toast(newest.result==="win"?`Acerto: +${money(newest.profit)}`:newest.result==="draw"?"Empate: valor devolvido":`Perda: ${money(Math.abs(newest.profit))}`,newest.result==="loss");if(newest)state.lastResultId=newest.id;state.paper=latest;renderPaper();}catch{}}
async function resetPaper(){try{state.paper=await api("/api/paper/reset",{method:"POST",body:"{}"});state.lastResultId="__empty__";renderPaper();$("paperMessage").textContent="Saldo restaurado para US$ 10.000.";toast("Simulador restaurado");}catch(error){toast(error.message,true);}}
function renderPaper(){const p=state.paper;if(!p)return;$("cash").textContent=money(p.balance);$("equity").textContent=money(p.locked);$("paperReturn").textContent=money(p.realized);$("paperReturn").className=p.realized>=0?"positive":"negative";$("realized").textContent=`${fmt(p.winRate,1)}% · ${p.wins||0}V/${p.losses||0}D`;$("payoutRate").textContent=`${Math.round(Number(p.payoutRate||.82)*100)}%`;$("positions").innerHTML=(p.open||[]).map(x=>`<div class="list-row trade-open"><span><b class="${x.direction==="up"?"positive":"negative"}">${x.direction==="up"?"▲ ALTA":"▼ BAIXA"}</b> ${esc(x.symbol)}<small> · ${money(x.stake)}</small><br><small>Entrada ${fmt(x.entryPrice,8)} · Agora ${fmt(x.currentPrice,8)}</small></span><strong class="countdown">${countdown(x.remainingMs)}</strong></div>`).join("")||`<p class="legal">Nenhuma operação em andamento. Escolha Alta ou Baixa para começar.</p>`;$("trades").innerHTML=(p.results||[]).slice(0,16).map(t=>`<div class="list-row"><span><b class="${t.result==="win"?"positive":t.result==="loss"?"negative":""}">${t.result==="win"?"GANHOU":t.result==="loss"?"PERDEU":"EMPATE"}</b> ${esc(t.symbol)}<small> · ${t.direction==="up"?"ALTA":"BAIXA"}</small></span><small class="${t.profit>=0?"positive":"negative"}">${t.profit>=0?"+":""}${money(t.profit)}<br>${fmt(t.entryPrice,8)} → ${fmt(t.exitPrice,8)}</small></div>`).join("")||`<p class="legal">Seus resultados aparecerão aqui ao terminar o tempo.</p>`;updateOrderPreview();}
async function submitAlert(e){e.preventDefault();try{const item=await api("/api/alerts",{method:"POST",body:JSON.stringify({symbol:state.symbol,kind:$("alertKind").value,value:Number($("alertValue").value),note:$("alertNote").value})});state.alerts.unshift(item);renderAlerts();toast("Alerta criado");}catch(error){toast(error.message,true);}}
function renderAlerts(){$("alertsList").innerHTML=state.alerts.map(a=>`<div class="list-row"><span><b>${esc(a.symbol)}</b><small> ${a.kind==="price_gte"?"≥":"≤"} ${fmt(a.value,8)}</small></span><button class="danger" data-alert="${a.id}">×</button></div>`).join("");$("alertsList").querySelectorAll("[data-alert]").forEach(b=>b.onclick=async()=>{await api(`/api/alerts/${b.dataset.alert}`,{method:"DELETE"});state.alerts=state.alerts.filter(x=>x.id!==b.dataset.alert);renderAlerts();});}
async function submitJournal(e){e.preventDefault();try{const item=await api("/api/journal",{method:"POST",body:JSON.stringify({symbol:state.symbol,interval:state.interval,setup:$("journalSetup").value,note:$("journalNote").value,side:"observe"})});state.journal.unshift(item);renderJournal();toast("Anotação salva");}catch(error){toast(error.message,true);}}
function renderJournal(){$("journalList").innerHTML=state.journal.slice(0,10).map(j=>`<div class="list-row"><span><b>${esc(j.symbol)}</b> ${esc(j.setup||"Observação")}<small> ${new Date(j.createdAt).toLocaleString("pt-BR")}</small></span><button class="danger" data-journal="${j.id}">×</button></div>`).join("");$("journalList").querySelectorAll("[data-journal]").forEach(b=>b.onclick=async()=>{await api(`/api/journal/${b.dataset.journal}`,{method:"DELETE"});state.journal=state.journal.filter(x=>x.id!==b.dataset.journal);renderJournal();});}
async function saveAi(e){e.preventDefault();try{const key=$("aiKey").value.trim(),provider=$("aiProvider").value;if(!key)throw new Error("Cole uma chave nova.");const result=await api("/api/ai/config",{method:"POST",body:JSON.stringify({apiKey:key,provider,model:$("aiModel").value.trim()})});$("aiKey").value="";$("aiStatus").textContent=result.configured?`Protegida no Windows · ${result.provider==="gemini"?"Gemini":"OpenAI"} · ${result.model}`:"Não configurada";toast("Chave salva de forma protegida");}catch(error){$("aiStatus").textContent=error.message;}}
async function removeAi(){try{await api("/api/ai/config",{method:"DELETE"});$("aiStatus").textContent="Chave removida.";toast("Chave de IA removida");}catch(error){toast(error.message,true);}}
async function readAi(){const b=$("aiRead");b.disabled=true;$("aiResult").textContent="Gerando uma leitura complementar sem enviar ordens…";try{const out=await api("/api/ai/read",{method:"POST",body:JSON.stringify({symbol:state.symbol,interval:state.interval})});$("aiResult").textContent=formatAi(out.content||out);}catch(error){$("aiResult").textContent=error.message;}finally{b.disabled=false;}}
function formatAi(v){if(typeof v==="string")return v;const lines=[];for(const [k,val] of Object.entries(v||{}))lines.push(`${k.replace(/_/g," ").toUpperCase()}: ${Array.isArray(val)?val.join(" · "):typeof val==="object"?JSON.stringify(val):val}`);return lines.join("\n\n");}
bootstrap();
