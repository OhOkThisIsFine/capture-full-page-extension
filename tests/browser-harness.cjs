const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const source='window.chrome={runtime:{id:"synthetic",getURL:p=>"chrome-extension://synthetic/"+p,onConnect:{addListener(){}},onMessage:{addListener(){}},sendMessage:async()=>{}}};'+fs.readFileSync(path.join(root,'capture-protocol.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'content.js'),'utf8').replace(/\}\)\(\);\s*$/,'globalThis.qa={prepare,moveTo,snapshot,restore,getState:()=>state,setSettler:fn=>settle=fn};})();')+'\n'+fs.readFileSync(path.join(root,'offscreen.js'),'utf8');
async function browserTask(pages,run){
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(pages(q.url));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cfp-p1-synthetic-'));let context;
 try{context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CFP_CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,chromiumSandbox:true,ignoreDefaultArgs:true,args:['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--disable-features=CalculateNativeWinOcclusion','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--remote-debugging-pipe',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check'],timeout:20000});
  await context.route('**/*',route=>route.request().url().startsWith(base+'/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
  const page=context.pages()[0]||await context.newPage();await run({page,base,source,browser:context.browser().version(),profile});
 }finally{if(context)await context.close();await new Promise(r=>server.close(r));const resolved=path.resolve(profile);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'cfp-p1-synthetic-'))throw Error('Unsafe profile cleanup path');fs.rmSync(resolved,{recursive:true,force:true});}
}
const bands=(count=40)=>'<!doctype html><style>html,body{margin:0;width:400px}div{height:50px;box-sizing:border-box}</style>'+Array.from({length:count},(_,i)=>`<div style="background:rgb(${20+i*5},${40+i*3},${80+i*2})">BAND ${i}</div>`).join('');
module.exports={browserTask,source,bands,root};
