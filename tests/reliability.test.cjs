const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
function content() {
  const waits = [];
  const root = {scrollLeft: 17, scrollTop: 23, scrollWidth: 200, scrollHeight: 2000, clientWidth: 200, clientHeight: 180};
  const c = vm.createContext({getComputedStyle:()=>({boxSizing:'content-box'}),HTMLIFrameElement:class {},window:{innerWidth:200,innerHeight:180}, document:{scrollingElement:root,documentElement:root},chrome:{runtime:{onConnect:{addListener(){}}}},console,setTimeout,clearTimeout});
  let source = fs.readFileSync(process.env.CFP_CONTENT_FILE||'content.js','utf8');
  source = source.replace(/\}\)\(\);\s*$/, `globalThis.api = {prepare, advance, restore, currentPosition, getState:()=>state, setDetector:fn=>detectPrimaryScroller=fn, expandFrames:expandSameOriginIframes};
    allElements=function*(){yield* globalThis.elements;};
    detectPrimaryScroller = () => document.scrollingElement;
    installCaptureStyles = () => [];
    expandSameOriginIframes = () => ({count:0,blocked:0,restore(){}});
    neutralizeFixedBackgrounds = snapshotVisibleElements = suppressViewportAnchoredElements = () => {};
    settle = async () => { const w = globalThis.wait(); await w; };
  })();`);
  c.wait = () => {const d = deferred(); waits.push(d); return d.promise;};
  vm.runInContext(source,c);
  c.elements=[];

  return {api:c.api,root,waits,c};
}
function compositor() {
  const c = vm.createContext({chrome:{runtime:{onMessage:{addListener(){}}}}, console, setTimeout:()=>0, clearTimeout(){}, TextEncoder, Uint8Array,Uint32Array,DataView,Blob,AbortController,URL:{createObjectURL(){c.urls++;return 'blob:test';},revokeObjectURL(){}}, urls:0});
  vm.runInContext(fs.readFileSync('offscreen.js','utf8')+'\nglobalThis.api={handle,sessions,createSession,validateTileCoverage,pngChunk,finalizeTile};',c);
  return c;
}
test('old preparation released after new session cannot change or restore it', async () => {
  const {api,root,waits,c} = content();
  const old = api.prepare();
  const oldResult = old.then(()=>null,e=>e);
  const restoring = api.restore(); waits[1]?.resolve(); await restoring;
  assert.equal(root.scrollTop,23);
  const next = api.prepare();
  const owner = api.getState();
  waits[0].resolve();
  assert.ok(await oldResult);
  assert.equal(api.getState(),owner);
  waits[waits.length-1].resolve();
  await next;
  assert.equal(api.getState(),owner);
});
test('short viewport rows retain positive pixels and full rounded coverage', async () => {
  for (const height of [100,149,150,151,180,190,191,300,800]) for (const scale of [1,1.25,2]) {
    const {api,root,waits,c} = content(); root.clientHeight=height; c.window.innerHeight=height;
    const prep=api.prepare(); waits.shift().resolve(); await prep;
    const rects=[{x0:0,y0:0,x1:200,y1:Math.round(height*scale)}];
    for(let i=0;i<100;i++) {
      const pending=api.advance(); waits.shift()?.resolve(); const r=await pending; if(r.done) break;
      const p=r.position, crop=Math.floor(p.stickyCrop*scale), start=Math.round(p.logicalY*scale)+crop;
      const retained=Math.round(height*scale)-crop; assert.ok(retained>0);
      rects.push({x0:0,y0:start,x1:200,y1:Math.min(Math.floor(2000*scale),start+retained)});
    }
    compositor().api.validateTileCoverage(200,Math.floor(2000*scale),rects,0,10000);
  }
});
test('cancelled finish cannot create URL after encoding resolves', async () => {
  const c=compositor(), s=c.api.createSession({});
  Object.assign(s,{frames:1,ratioX:1,widthPx:1,heightPx:1,tileHeight:1});
  s.savedTiles.set(0,{height:1,coverage:[{x0:0,y0:0,x1:1,y1:1}]});
  c.api.sessions.set('old',s);
  const d=deferred(); c.encoding=d.promise;
  vm.runInContext('encodePngFromTiles=()=>encoding',c);
  const pending=c.api.handle({type:'finish',sessionId:'old'});
  const result=pending.then(()=>null,e=>e);
  await c.api.handle({type:'abort',sessionId:'old'}); d.resolve(new Blob());
  assert.ok(await result); assert.equal(c.urls,0); assert.equal(c.api.sessions.size,0);
});

test('nested early scroll and partial unlock roll back before newer preparation', async () => {
  for (const stage of [0,1]) {
    const {api,root,waits,c}=content();
    class Node {
      constructor(){this.props=new Map([['height',['180px','important']]]);this.style={getPropertyValue:p=>this.props.get(p)?.[0]||'',getPropertyPriority:p=>this.props.get(p)?.[1]||'',setProperty:(p,v,q)=>this.props.set(p,[v,q]),removeProperty:p=>this.props.delete(p)};}
    }
    const nested=new Node(); Object.assign(nested,{scrollLeft:11,scrollTop:37,scrollWidth:200,scrollHeight:1000,clientWidth:200,clientHeight:180});
    c.HTMLElement=Node; c.nested=nested;
    c.getComputedStyle=()=>({overflow:'auto',overflowX:'auto',overflowY:'auto',height:'180px',maxHeight:'none',position:'static'});
    api.setDetector(()=>nested);
    const before=JSON.stringify([...nested.props]);
    const pending=api.prepare(); const outcome=pending.then(()=>null,e=>e);
    if(stage===1){waits[0].resolve();await new Promise(r=>setImmediate(r));assert.notEqual(JSON.stringify([...nested.props]),before);}
    await api.restore();
    assert.equal(nested.scrollTop,37); assert.equal(nested.scrollLeft,11); assert.equal(JSON.stringify([...nested.props]),before);
    api.setDetector(()=>root);
    const next=api.prepare(); const owner=api.getState();
    waits[stage].resolve(); assert.ok(await outcome); assert.equal(api.getState(),owner);
    waits.at(-1).resolve();await next; await api.restore();assert.equal(root.scrollTop,23);
  }
});

test('recovery preserves completed URL and cancels deferred frame decode',async()=>{
  const c=compositor(), d=deferred();let closed=0;
  c.fetch=async()=>({ok:true,blob:async()=>new Blob()}); c.createImageBitmap=()=>d.promise;
  await c.api.handle({type:'start',sessionId:'done',owner:'A',prep:{}});
  const s=c.api.sessions.get('done');Object.assign(s,{frames:1,ratioX:1,widthPx:1,heightPx:1,tileHeight:1});
  s.savedTiles.set(0,{height:1,coverage:[{x0:0,y0:0,x1:1,y1:1}]});
  vm.runInContext('encodePngFromTiles=async()=>new Blob()',c);
  await c.api.handle({type:'finish',sessionId:'done'});
  await c.api.handle({type:'start',sessionId:'old',owner:'A',prep:{}});
  const frame=c.api.handle({type:'frame',sessionId:'old',dataUrl:'fixture'}).then(()=>null,e=>e);
  await new Promise(r=>setImmediate(r));
  await c.api.handle({type:'start',sessionId:'new',owner:'B',prep:{}});
  d.resolve({close(){closed++;}});assert.ok(await frame);assert.equal(closed,1);
  assert.equal(c.api.sessions.size,1);assert.equal(c.urls,1);
  assert.equal((await c.api.handle({type:'status'})).idle,false);
  await c.api.handle({type:'revoke',url:'blob:test'});
});

test('PNG IEND has independently known CRC',()=>{
  const chunk=compositor().api.pngChunk('IEND',new Uint8Array());
  assert.equal(Buffer.from(chunk).toString('hex'),'0000000049454e44ae426082');
});

test('aborted tile encoding cannot repopulate retained tile maps',async()=>{
  const c=compositor(),d=deferred();await c.api.handle({type:'start',sessionId:'old',prep:{}});
  const s=c.api.sessions.get('old');const canvas={width:200,height:180,convertToBlob:()=>d.promise};
  s.activeTiles.set(0,{canvas,height:180,coverage:[]});
  const pending=c.api.finalizeTile(s,0).then(()=>null,e=>e);
  await c.api.handle({type:'abort',sessionId:'old'});d.resolve(new Blob());
  assert.ok(await pending);assert.equal(s.savedTiles.size,0);assert.equal(s.activeTiles.size,0);assert.equal(canvas.width,1);
});

test('actual compositor covers short viewport rows across horizontal columns',async()=>{
  for(const height of [100,149,150,151,180,190,191,300,800]) for(const scale of [1,1.25,2]) {
    const {api,root,waits,c}=content();root.clientHeight=height;root.scrollWidth=480;c.window.innerHeight=height;
    const preparing=api.prepare();waits.shift().resolve();const prep=await preparing;
    const comp=compositor();comp.fetch=async()=>({ok:true,blob:async()=>new Blob()});
    comp.createImageBitmap=async()=>({width:200*scale,height:Math.round(height*scale),close(){}});
    comp.OffscreenCanvas=class {constructor(w,h){this.width=w;this.height=h;}getContext(){return {fillRect(){},drawImage(){}};}async convertToBlob(){return new Blob();}};
    await comp.api.handle({type:'start',sessionId:'fixture',prep});
    await comp.api.handle({type:'frame',sessionId:'fixture',position:prep.position});
    for(let i=0;i<500;i++) {
      const pending=api.advance();waits.shift()?.resolve();const r=await pending;
      if(r.done)break;
      await comp.api.handle({type:'frame',sessionId:'fixture',position:r.position});
    }
    vm.runInContext('encodePngFromTiles=async()=>new Blob()',comp);
    const result=await comp.api.handle({type:'finish',sessionId:'fixture'});
    assert.equal(result.width,Math.floor(480*scale));assert.equal(result.height,Math.floor(2000*Math.round(height*scale)/height));
  }
});

test('iframe rollback restores styles and internal scroll only for original document',()=>{
  const {api,c}=content();
  class Frame {
    constructor(){this.props=new Map([['height',['100px','']]]);this.style={getPropertyValue:p=>this.props.get(p)?.[0]||'',getPropertyPriority:p=>this.props.get(p)?.[1]||'',setProperty:(p,v,q)=>this.props.set(p,[v,q]),removeProperty:p=>this.props.delete(p)};this.clientWidth=100;this.clientHeight=100;this.contentDocument={location:{href:'fixture'},scrollingElement:{scrollWidth:300,scrollHeight:400,scrollLeft:12,scrollTop:34}};}
    getBoundingClientRect(){return {width:100,height:100};}
  }
  c.HTMLIFrameElement=Frame;
  for(const navigated of [false,true]) for(const borderBox of [false,true]) {
    c.getComputedStyle=()=>({boxSizing:borderBox?'border-box':'content-box',borderLeftWidth:'8px',borderRightWidth:'8px',borderTopWidth:'8px',borderBottomWidth:'8px',paddingLeft:'2px',paddingRight:'2px',paddingTop:'2px',paddingBottom:'2px'});
    const frame=new Frame();c.elements=[frame];const doc=frame.contentDocument,root=doc.scrollingElement,before=JSON.stringify([...frame.props]);
    const expansion=api.expandFrames(null,{rollback:[]});
    assert.equal(frame.style.getPropertyValue('width'),borderBox?'320px':'300px');
    assert.equal(frame.style.getPropertyValue('height'),borderBox?'420px':'400px');
    root.scrollLeft=0;root.scrollTop=0;
    if(navigated)frame.contentDocument={};
    expansion.restore();assert.equal(JSON.stringify([...frame.props]),before);
    assert.equal(root.scrollTop,navigated?0:34);assert.equal(root.scrollLeft,navigated?0:12);
  }
});

test('iframe scroll snapshot precedes preparation layout changes',async()=>{
  const {api,c,waits}=content();const frame=new c.HTMLIFrameElement();
  const root={scrollLeft:12,scrollTop:34};frame.contentDocument={location:{href:'fixture'},scrollingElement:root};c.elements=[frame];
  const pending=api.prepare();const outcome=pending.then(()=>null,e=>e);
  root.scrollTop=0;root.scrollLeft=0; // Model a layout-induced scroll clamp during suspended preparation.
  const owner=api.getState();let expanded=true;
  owner.rollback.push(()=>{expanded=false;});
  const saved=owner.scrollRollback[1];owner.scrollRollback[1]=()=>{assert.equal(expanded,false);saved();};
  await api.restore();assert.equal(root.scrollTop,34);assert.equal(root.scrollLeft,12);
  waits[0].resolve();assert.ok(await outcome);
});




