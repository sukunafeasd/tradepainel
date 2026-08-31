"use strict";

const fs = require("node:fs");

async function runSmoke(mainWindow, environment = process.env) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Janela indisponível para o teste visual.");
  const screenshotFile = environment.DIEFTRADE_SMOKE_SCREENSHOT;
  if (!screenshotFile) throw new Error("DIEFTRADE_SMOKE_SCREENSHOT não foi informado.");
  await new Promise((resolve) => setTimeout(resolve, 9_000));
  const result = await mainWindow.webContents.executeJavaScript(`(async()=>{
    document.querySelector('[data-theme="midnight"]')?.click();
    const input=document.getElementById('paperQty');
    if(input){input.value='100';input.dispatchEvent(new Event('input',{bubbles:true}));}
    document.getElementById('paperForm')?.requestSubmit();
    await new Promise(r=>setTimeout(r,5000));
    document.querySelector('[data-tab="paper"]')?.click();
    await new Promise(r=>setTimeout(r,150));
    return {
      theme:document.body.dataset.theme,
      paperMessage:document.getElementById('paperMessage')?.textContent||'',
      openTrades:document.querySelectorAll('#positions .trade-open').length,
      coinCount:Number(document.getElementById('coinCount')?.textContent||0),
      price:document.getElementById('price')?.textContent||'',
      duck:Boolean(document.getElementById('pixel')),
      chartTools:document.querySelectorAll('.chart-actions button').length,
      simStats:document.querySelectorAll('#simStats>div').length,
      healthItems:document.querySelectorAll('#healthGrid .health-item').length,
      authHint:document.querySelector('.secure-note')?.textContent.includes('AQ.')||false
    };
  })()`);
  if (environment.DIEFTRADE_SMOKE_REPORT) {
    fs.writeFileSync(environment.DIEFTRADE_SMOKE_REPORT, JSON.stringify(result, null, 2));
  }
  const image = await mainWindow.webContents.capturePage();
  fs.writeFileSync(screenshotFile, image.toPNG());
  return result;
}

module.exports = { runSmoke };
