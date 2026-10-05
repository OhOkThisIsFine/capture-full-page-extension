const fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PNG}=require(process.env.PNGJS_MODULE||'pngjs');
const root=path.resolve(__dirname,'..');
const output=process.env.CFP_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'cfp-png-results-'));fs.mkdirSync(output,{recursive:true});
const source='window.chrome={runtime:{onConnect:{addListener(){}},onMessage:{addListener(){}},sendMessage:async()=>{}}};'+fs.readFileSync(root+'/content.js','utf8').replace(/\}\)\(\);\s*$/,'settle=async()=>{};globalThis.qa={prepare,advance,restore};})();')+'\n'+fs.readFileSync(root+'/offscreen.js','utf8');
const inner=`<!doctype html><style>html,body{margin:0}#box{position:relative;width:500px;height:600px;background:#22aabb}.bottom{position:absolute;left:0;top:599px;width:500px;height:1px;background:#ff00ff}.right{position:absolute;left:499px;top:0;width:1px;height:599px;background:#00ffff}</style><div id="box"><div class="bottom"></div><div class="right"></div></div>`;
const frames=`<!doctype html><style>html,body{margin:0}iframe{display:block;width:220px;height:160px;border:8px solid #000;max-width:220px;max-height:160px}#border{box-sizing:border-box}</style><iframe id="content" srcdoc="${inner.replaceAll('"','&quot;')}"></iframe><iframe id="border" srcdoc="${inner.replaceAll('"','&quot;')}"></iframe>`;
const bands=`<!doctype html><style>html,body{margin:0;width:400px}div{height:50px;box-sizing:border-box}</style>`+Array.from({length:20},(_,i)=>`<div style="background:rgb(${20+i*5},${40+i*3},${80+i*2})">BAND ${i}</div>`).join('');
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url==='/frames'?frames:bands);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cfp-pixels-'));let context;const report={scope:'Production content/compositor functions in real browser, transport registration shim and controlled settle, CDP screenshots; activeTab/captureVisibleTab untested',bands:[]};
 try {
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CFP_CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,chromiumSandbox:true,ignoreDefaultArgs:true,args:['--headless=new','--disable-gpu','--disable-background-networking','--disable-features=CalculateNativeWinOcclusion','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--remote-debugging-pipe',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check'],timeout:20000});
  report.browser=context.browser().version();console.log('VERSION',report.browser);const page=context.pages()[0]||await context.newPage();
  async function compose(id){
   const prep=await page.evaluate(()=>qa.prepare());await page.evaluate(m=>__cfpCompositorHandle(m),{type:'start',sessionId:id,prep});let position=prep.position,count=0;
   while(true){const screenshot=await page.screenshot({timeout:10000});
    await page.evaluate(m=>__cfpCompositorHandle(m),{type:'frame',sessionId:id,position,dataUrl:'data:image/png;base64,'+screenshot.toString('base64')});
    const next=await page.evaluate(()=>qa.advance());if(next.done)break;position=next.position;assert.ok(++count<100);
   }
   await page.evaluate(()=>qa.restore());const finished=await page.evaluate(m=>__cfpCompositorHandle(m),{type:'finish',sessionId:id});
   const bytes=Buffer.from(await page.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),finished.url));
   await page.evaluate(m=>__cfpCompositorHandle(m),{type:'revoke',url:finished.url});fs.writeFileSync(path.join(output,id+'.png'),bytes);return PNG.sync.read(bytes);
  }
  for(const height of [100,180,190,191]){
   await page.setViewportSize({width:400,height});await page.goto(base+'/bands');await page.evaluate(source);await page.evaluate(()=>scrollTo(0,37));
   const png=await compose('chrome-bands-'+height);assert.equal(png.height,1000);assert.equal(await page.evaluate(()=>scrollY),37);
   for(let y=0;y<1000;y++){const i=Math.floor(y/50),o=(y*png.width+300)*4;assert.deepEqual([...png.data.subarray(o,o+3)],[20+i*5,40+i*3,80+i*2],`viewport ${height} row ${y}`);}
   report.bands.push({height,width:png.width,outputHeight:png.height,allRowsVerified:true});console.log('PIXELS PASS',height);
   if(height===180){const repeated=await compose('chrome-bands-repeat');assert.deepEqual(repeated.data,png.data);assert.equal((await page.evaluate(()=>__cfpCompositorHandle({type:'status'}))).idle,true);report.repeatedCapture=true;}
  }
  await page.setViewportSize({width:400,height:300});await page.goto(base+'/frames');await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(f=>f.contentDocument?.readyState==='complete'));
  await page.evaluate(()=>{for(const f of document.querySelectorAll('iframe'))f.contentWindow.scrollTo(21,43);});await page.evaluate(source);
  const png=await compose('chrome-frames');let magenta=0,cyan=0;
  for(let o=0;o<png.data.length;o+=4){const d=png.data;if(d[o]===255&&d[o+1]===0&&d[o+2]===255)magenta++;if(d[o]===0&&d[o+1]===255&&d[o+2]===255)cyan++;}
  assert.equal(magenta,1000);assert.equal(cyan,1198);
  const scroll=await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>({x:f.contentWindow.scrollX,y:f.contentWindow.scrollY,style:f.style.cssText})));
  assert.deepEqual(scroll,[{x:21,y:43,style:''},{x:21,y:43,style:''}]);report.frames={width:png.width,height:png.height,magenta,cyan,scroll};console.log('IFRAME PIXELS PASS');
  // Pause after a real browser encode, abort, then release the finish continuation.
  await page.setViewportSize({width:600,height:1400});await page.goto(base+'/bands');await page.evaluate(source);
  const prep=await page.evaluate(()=>qa.prepare());await page.evaluate(m=>__cfpCompositorHandle(m),{type:'start',sessionId:'cancelled',prep});
  const screenshot=await page.screenshot({timeout:10000});await page.evaluate(m=>__cfpCompositorHandle(m),{type:'frame',sessionId:'cancelled',position:prep.position,dataUrl:'data:image/png;base64,'+screenshot.toString('base64')});await page.evaluate(()=>qa.restore());
  await page.evaluate(()=>{
    const originalEncoder=encodePngFromTiles,originalURL=URL.createObjectURL;
    window.createdURLs=0;URL.createObjectURL=blob=>{createdURLs++;return originalURL(blob);};
    const gate=new Promise(resolve=>{window.releaseFinish=resolve;});
    encodePngFromTiles=async s=>{const encoded=await originalEncoder(s);window.encodeReached=true;await gate;return encoded;};
    window.cancelledResult=__cfpCompositorHandle({type:'finish',sessionId:'cancelled'}).then(()=>({ok:true}),e=>({error:e.message}));
  });
  await page.waitForFunction(()=>window.encodeReached);
  await page.evaluate(()=>__cfpCompositorHandle({type:'abort',sessionId:'cancelled'}));
  const cancelled=await page.evaluate(async()=>{releaseFinish();return {result:await cancelledResult,createdURLs,idle:(await __cfpCompositorHandle({type:'status'})).idle};});
  assert.ok(cancelled.result.error);assert.equal(cancelled.createdURLs,0);assert.equal(cancelled.idle,true);report.cancelledFinish=cancelled;console.log('CANCELLED ENCODE PASS');
  fs.writeFileSync(path.join(output,'chrome-pixel-report.json'),JSON.stringify(report,null,2));
 } finally {if(context)await context.close();await new Promise(r=>server.close(r));if(!path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep+'cfp-pixels-'))throw Error('Unexpected profile');fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

