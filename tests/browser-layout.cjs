// Optional real Chromium DOM checks. Does not emulate an activeTab grant.
// Run with PLAYWRIGHT_MODULE and CFP_CHROMIUM_EXECUTABLE for existing tooling.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const source='window.chrome={runtime:{onConnect:{addListener(){}}}};'+
  fs.readFileSync(process.env.CFP_CONTENT_FILE||path.join(root,'content.js'),'utf8')
    .replace(/\}\)\(\);\s*$/, 'let testSettle=()=>Promise.resolve(); settle=()=>testSettle(); globalThis.qa={prepare,advance,restore,setSettler:fn=>testSettle=fn};})();');
const inner=`<!doctype html><style>html,body{margin:0}#box{position:relative;width:500px;height:600px;background:#22aabb}.bottom{position:absolute;left:0;top:599px;width:500px;height:1px;background:#ff00ff}.right{position:absolute;left:499px;top:0;width:1px;height:599px;background:#00ffff}</style><div id="box"><div class="bottom"></div><div class="right"></div></div>`;
const iframePage=`<!doctype html><title>iframe QA</title><style>html,body{margin:0}iframe{display:block;width:220px;height:160px;border:8px solid #000;max-width:220px;max-height:160px}#border{box-sizing:border-box}</style><iframe id="content" srcdoc="${inner.replaceAll('"','&quot;')}"></iframe><iframe id="border" srcdoc="${inner.replaceAll('"','&quot;')}"></iframe>`;
const bands=`<!doctype html><title>numbered bands QA</title><style>html,body{margin:0;width:400px}div{height:50px;box-sizing:border-box}</style>`+Array.from({length:40},(_,i)=>`<div style="background:rgb(${20+i*5},${40+i*3},${80+i*2})">BAND ${i}</div>`).join('');
const report={scope:'Real DOM layout and preparation with controlled await gates and runtime connect registration shim. Rendering/settle timing, captureVisibleTab and PNG fidelity remain untested.',bands:[]};
const server=http.createServer((q,r)=>{
  r.setHeader('Content-Type','text/html');
  r.end(q.url==='/frames'?iframePage:q.url==='/app-shell'
    ?fs.readFileSync(path.join(__dirname,'fixtures/app-shell.html'),'utf8'):bands);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cfp-layout-'));
  let context;
  try {
    context=await chromium.launchPersistentContext(profile,{
      executablePath:process.env.CFP_CHROMIUM_EXECUTABLE||chromium.executablePath(),
      headless:true,chromiumSandbox:true,ignoreDefaultArgs:true,
      args:['--headless=new','--disable-features=CalculateNativeWinOcclusion','--disable-gpu','--disable-background-networking',
        '--disable-background-timer-throttling','--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding','--remote-debugging-pipe',
        `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
        `--disable-extensions-except=${root}`,`--load-extension=${root}`],timeout:20000
    });
    report.browser=context.browser().version();
    const page=context.pages()[0]||await context.newPage();
    console.log('Browser ready',report.browser);await page.bringToFront();
    for(const height of [100,149,150,151,180,190,191,300]) {
      await page.setViewportSize({width:400,height});await page.goto(base+'/bands');
      await page.evaluate(source);await page.evaluate(()=>scrollTo(0,37));
      const result=await page.evaluate(async()=>{
        const prep=await qa.prepare();let count=1,previous=0;
        while(true){const next=await qa.advance();if(next.done)break;
          if(next.position.clientHeight-next.position.stickyCrop<=0)throw Error('No retained rows');
          if(next.position.logicalY<previous)throw Error('Nonmonotonic row');
          previous=next.position.logicalY;if(++count>150)throw Error('Capture did not finish');
        }
        await qa.restore();return {count,scrollY,targetHeight:prep.targetHeight};
      });
      assert.equal(result.scrollY,37);assert.equal(result.targetHeight,2000);
      report.bands.push({height,...result});console.log('DOM bands pass',height,result.count);
    }
    await page.setViewportSize({width:800,height:600});await page.goto(base+'/app-shell');
    await page.waitForFunction(()=>document.querySelector('#frame').contentDocument?.readyState==='complete');
    await page.evaluate(source);
    for(const stage of ['before-unlock','after-unlock']) {
      const result=await page.evaluate(async stage=>{
        const nested=document.querySelector('#scroller');nested.scrollTop=83;nested.scrollLeft=17;
        const frame=document.querySelector('#frame');frame.contentWindow.scrollTo(0,43);
        const originals=[...document.querySelectorAll('*')].map(el=>({el,style:el.style?.cssText||''}));
        let calls=0,held;
        qa.setSettler(()=>++calls===(stage==='before-unlock'?1:2)
          ?new Promise(resolve=>{held=resolve;}):Promise.resolve());
        const old=qa.prepare().then(()=>({ok:true}),e=>({error:e.message}));
        const deadline=Date.now()+800;
        while(!held){if(Date.now()>deadline)throw Error('Preparation pause not reached');await new Promise(r=>setTimeout(r,5));}
        await qa.restore();
        const restored=nested.scrollTop===83&&nested.scrollLeft===17&&frame.contentWindow.scrollY===43&&originals.every(({el,style})=>(el.style?.cssText||'')===style);
        qa.setSettler(()=>Promise.resolve());
        const next=qa.prepare();held();const oldResult=await old;
        await next;await qa.restore();
        return {restored,oldResult,after:nested.scrollTop,frameAfter:frame.contentWindow.scrollY,
          styles:document.querySelectorAll('[data-cfp-capture-style]').length};
      },stage);
      assert.ok(result.restored,JSON.stringify(result));assert.ok(result.oldResult.error);
      assert.equal(result.after,83);assert.equal(result.frameAfter,43);assert.equal(result.styles,0);
      report[stage]=result;console.log('Interrupted preparation pass',stage);
    }
    await page.setViewportSize({width:400,height:300});await page.goto(base+'/frames');
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(f=>f.contentDocument?.readyState==='complete'));
    await page.evaluate(()=>{for(const f of document.querySelectorAll('iframe'))f.contentWindow.scrollTo(21,43);});
    const before=await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>({id:f.id,style:f.style.cssText,x:f.contentWindow.scrollX,y:f.contentWindow.scrollY})));
    await page.evaluate(source);await page.evaluate(()=>qa.prepare());
    report.iframeMetrics=await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>({id:f.id,width:f.contentWindow.innerWidth,height:f.contentWindow.innerHeight,scrollWidth:f.contentDocument.documentElement.scrollWidth,scrollHeight:f.contentDocument.documentElement.scrollHeight})));
    await page.evaluate(()=>qa.restore());
    const after=await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>({id:f.id,style:f.style.cssText,x:f.contentWindow.scrollX,y:f.contentWindow.scrollY})));
    assert.deepEqual(after,before);
    for(const f of report.iframeMetrics){assert.equal(f.width,500,JSON.stringify(f));assert.equal(f.height,600,JSON.stringify(f));}
    report.iframeRestoration={before,after};console.log('Iframe viewport and restoration pass');
    if(process.env.CFP_QA_REPORT)fs.writeFileSync(process.env.CFP_QA_REPORT,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    if(context)await context.close();await new Promise(r=>server.close(r));
    if(!path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep+'cfp-layout-'))throw Error('Unexpected profile path');
    fs.rmSync(profile,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});

