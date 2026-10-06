const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createServer}=require('../src/server.cjs');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dieftrade-design-'));
class Live extends EventEmitter {
  constructor(){super();this.symbol='BTCUSDT';this.interval='15m';this.clients=new Set();}
  start(){}close(){}select(s,i){this.symbol=s;this.interval=i;}addClient(send){this.clients.add(send);send({type:'snapshot',data:this.snapshot()});return()=>this.clients.delete(send);}
  publish(data){for(const send of this.clients)send({type:'snapshot',data});}
  marketSnapshot(){return[{symbol:'BTCUSDT',base:'BTC',last:50000,changePct:1.24,quoteVolume:1e9},{symbol:'ETHUSDT',base:'ETH',last:2000,changePct:-.62,quoteVolume:5e8}];}
  priceDatums(){return{BTCUSDT:{symbol:'BTCUSDT',value:50000,exchangeTimestamp:Date.now(),receivedAt:Date.now(),source:'test',stale:false}};}
  snapshot(){return{symbol:this.symbol,interval:this.interval,connected:true,stale:false,ticker:{last:50000,changePct:1.24},book:{bids:[[49999,2]],asks:[[50001,2]]},trades:[],flow:{buyRatio:.5}};}
}
const spacing={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
const market={status:()=>({ok:true}),topPairs:async()=>new Live().marketSnapshot(),ticker:async()=>({last:50000}),klines:async(s,i)=>Array.from({length:500},(_,n)=>{const v=49900+n*.2;return{t:Date.now()-(501-n)*(spacing[i]||900000),open:v-.1,high:v+1,low:v-1,close:v,volume:2000,quoteVolume:v*2000};})};
const credentials={status:()=>({configured:false,encryptionAvailable:true}),load:()=>({apiKey:''})};
(async()=>{
  let browser,server;
  try{
    const realtime=new Live();
    server=createServer({dataDirectory:root,uiDirectory:path.join(__dirname,'../src/ui'),credentialStore:credentials,market,realtime});
    const {port,token}=await server.listen();
    browser=await chromium.launch({executablePath:process.env.DIEFTRADE_CHROMIUM_PATH||chromium.executablePath(),headless:true});
    const page=await browser.newPage({viewport:{width:1540,height:960}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/#t=${token}`);
    await page.waitForFunction(()=>document.getElementById('coinCount').textContent==='2'&&document.getElementById('signal').textContent!=='ANALISANDO');
    const last=await page.evaluate(()=>state.analysis.series.candles.at(-1).t);
    const candle={t:last+900000,open:50000,high:50010,low:49990,close:50010,volume:20,closed:false};
    realtime.publish({...realtime.snapshot(),candle});
    await page.waitForFunction(()=>state.liveCandles?.at(-1)?.close===50010);
    realtime.publish({...realtime.snapshot(),interval:'1m',candle:{...candle,close:49995}});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>state.liveCandles.at(-1).close),50010);
    realtime.publish({...realtime.snapshot(),candle:{...candle,closed:true}});
    realtime.publish({...realtime.snapshot(),candle:{...candle,t:candle.t+900000,close:50005}});
    await page.waitForFunction(()=>state.liveCandles?.length===2);
    assert.equal(await page.evaluate(()=>state.liveCandles[0].closed),true);
    for(const size of [{width:1540,height:960},{width:1120,height:720},{width:960,height:640},{width:480,height:800}]){
      await page.setViewportSize(size);
      for(const theme of ['dief','terminal','midnight','graphite','light']){
        await page.locator('#openSettings').click();
        await page.locator(`button[data-theme="${theme}"]`).click();
        assert.equal(await page.locator('body').getAttribute('data-theme'),theme);
        await page.waitForFunction(()=>getComputedStyle(document.getElementById('chartZoomIn')).backgroundColor===getComputedStyle(document.querySelector('.search')).backgroundColor);
        assert.equal(await page.locator('.shell').evaluate(e=>e.inert),true);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'openSettings');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${theme}/${size.width}: overflow`);
        for(const tab of ['reading','flow','risk','paper','alerts','ai']){
          await page.locator(`[data-tab="${tab}"]`).click();
          assert.equal(await page.locator(`#tab-${tab}`).isVisible(),true);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${theme}/${tab}/${size.width}: overflow`);
        }
        assert.equal(await page.locator('#tabs button svg').count(),6);
        if(size.width===1540||size.width===480){
          await page.locator('[data-tab="reading"]').click();
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.screenshot({path:path.join(os.tmpdir(),`dieftrade-${theme}-${size.width}.png`)});
        }
      }
    }
    await page.setViewportSize({width:1540,height:960});
    await page.locator('#openSettings').click();await page.locator('button[data-theme="dief"]').click();await page.keyboard.press('Escape');
    await page.locator('[data-tab="reading"]').click();
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('chartZoomIn')).backgroundColor===getComputedStyle(document.querySelector('.search')).backgroundColor);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.mouse.move(0,0);
    await page.screenshot({path:path.join(os.tmpdir(),'dieftrade-terminal-refinado.png'),fullPage:false});
    const pixels=await page.locator('#chart').evaluate(canvas=>{const {data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);let painted=0;for(let n=3;n<data.length;n+=4)if(data[n])painted++;return painted;});
    assert.ok(pixels>1000,'Chart must not be blank');
    assert.equal(await page.locator('#chartZoomIn svg').count(),1);
    assert.equal(await page.locator('.brand img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await page.locator('.coin-row').first().focus();
    await page.evaluate(()=>renderCoins());
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.symbol),'BTCUSDT');
    await page.locator('[data-tab="paper"]').click();
    const balance=await page.locator('#cash').textContent();
    await page.locator('#paperPayout').selectOption('0.90');
    await page.waitForFunction(()=>document.getElementById('payoutRate').textContent==='90%'&&!document.getElementById('paperPayout').disabled);
    assert.equal(await page.locator('#cash').textContent(),balance);
    await page.locator('[data-tab="reading"]').click();
    await page.locator('#openSettings').click();await page.locator('#closeSettings').focus();await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'refreshHealth');
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'closeSettings');
    await page.locator('#reduceMotion').check();assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('reduce-motion')),true);
    assert.deepEqual(errors,[]);
    console.log('PASS DiefTrade UI: 5 themes, 4 sizes, 6 tabs, chart pixels, official icon, focus trap/return and reduced motion. Market data is a local fixture.');
  }finally{await browser?.close();await server?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
