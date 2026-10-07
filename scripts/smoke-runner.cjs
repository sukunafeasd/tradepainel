"use strict";

const fs = require("node:fs");

async function runSmoke(mainWindow, environment = process.env, startupTimings = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Janela indisponível para o teste visual.");
  const screenshotFile = environment.DIEFTRADE_SMOKE_SCREENSHOT;
  if (!screenshotFile) throw new Error("DIEFTRADE_SMOKE_SCREENSHOT não foi informado.");
  const result = await mainWindow.webContents.executeJavaScript(`(async()=>{
    const waitUntil=async(predicate,timeout=45000)=>{const started=Date.now();while(Date.now()-started<timeout){if(predicate())return true;await new Promise(r=>setTimeout(r,250));}return false;};
    const bootstrapReady=await waitUntil(()=>Number(document.getElementById('coinCount')?.textContent||0)>0&&document.getElementById('signal')?.textContent!=='ANALISANDO'&&document.getElementById('price')?.textContent!=='--');
    const marketOnline=await waitUntil(()=>document.getElementById('connection')?.textContent==='mercado ao vivo',20000);
    document.querySelector('[data-theme="midnight"]')?.click();
    const input=document.getElementById('paperQty');
    if(input){input.value='100';input.dispatchEvent(new Event('input',{bubbles:true}));}
    if(bootstrapReady&&marketOnline){
      for(let attempt=0;attempt<3;attempt++){
        const fresh=await waitUntil(()=>state.live?.freshness?.ticker&&!state.live.freshness.ticker.stale&&state.live.freshness.ticker.ageMs<1800,10000);
        if(!fresh)break;
        document.getElementById('paperForm')?.requestSubmit();
        await waitUntil(()=>/Entrada confirmada|indisponível|Falha|erro/i.test(document.getElementById('paperMessage')?.textContent||''),15000);
        if(/^Entrada confirmada/.test(document.getElementById('paperMessage')?.textContent||''))break;
        if(!/Preço de entrada fresco indisponível/.test(document.getElementById('paperMessage')?.textContent||''))break;
      }
    }
    document.querySelector('[data-tab="paper"]')?.click();
    await new Promise(r=>setTimeout(r,150));
    const health=await api('/api/health'),live=health.live;
    return {
      bootstrapReady,
      marketOnline,
      liveBookLevels:(live.book?.bids?.length||0)+(live.book?.asks?.length||0),
      liveBookFresh:Boolean(live.freshness?.book&&!live.freshness.book.stale),
      liveQuoteFresh:Boolean(live.freshness?.quote&&!live.freshness.quote.stale),
      theme:document.body.dataset.theme,
      paperMessage:document.getElementById('paperMessage')?.textContent||'',
      openTrades:document.querySelectorAll('#positions .trade-open').length,
      coinCount:Number(document.getElementById('coinCount')?.textContent||0),
      price:document.getElementById('price')?.textContent||'',
      duck:Boolean(document.getElementById('pixel')),
      chartTools:document.querySelectorAll('.chart-actions button').length,
      simStats:document.querySelectorAll('#simStats>div').length,
      healthItems:document.querySelectorAll('#healthGrid .health-item').length,
      apiKeyFormatHint:document.querySelector('.secure-note')?.textContent.includes('AQ.')||false
    };
  })()`);
  result.ok = Boolean(result.bootstrapReady && result.marketOnline && result.liveBookLevels >= 2 && result.liveBookFresh && result.liveQuoteFresh && /^Entrada confirmada/.test(result.paperMessage) && result.coinCount > 0 && result.price !== "--" && result.chartTools >= 5 && result.simStats >= 5 && result.healthItems >= 8);
  result.startup = startupTimings;
  if (environment.DIEFTRADE_SMOKE_REPORT) fs.writeFileSync(environment.DIEFTRADE_SMOKE_REPORT, JSON.stringify(result, null, 2));
  const image = await mainWindow.webContents.capturePage();
  fs.writeFileSync(screenshotFile, image.toPNG());
  if (!result.bootstrapReady) throw new Error("A interface não concluiu o carregamento durante o smoke test.");
  if (!result.marketOnline) throw new Error("O fluxo ao vivo não ficou saudável durante o smoke test.");
  if (result.liveBookLevels < 2 || !result.liveBookFresh || !result.liveQuoteFresh) throw new Error("O book ou o melhor bid/ask não ficaram atualizados no teste real.");
  if (!/^Entrada confirmada/.test(result.paperMessage)) throw new Error(`A operação demo não foi confirmada no smoke test: ${result.paperMessage || "sem retorno"}`);
  if (!(result.coinCount > 0) || result.price === "--" || result.chartTools < 5 || result.simStats < 5 || result.healthItems < 8) throw new Error("A interface carregou com componentes essenciais ausentes.");
  return result;
}

module.exports = { runSmoke };
