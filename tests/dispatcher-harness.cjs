const fs=require('node:fs'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function event(){const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit(...args){for(const f of [...listeners])f(...args);},listeners};}
function protocol(c){vm.runInContext(fs.readFileSync('capture-protocol.js','utf8'),c);return c.__cfpProtocol;}
function scope(){return {operationId:randomUUID(),sessionId:randomUUID(),owner:randomUUID()};}
function prep(identity=scope(),{width=200,height=2000,viewportWidth=200,viewportHeight=180}={}) {
 const signature={innerWidth:viewportWidth,innerHeight:viewportHeight,layoutWidth:viewportWidth,layoutHeight:viewportHeight,scrollWidth:width,scrollHeight:height,devicePixelRatio:1,visualScale:1,visualOffsetLeft:0,visualOffsetTop:0,geometryGeneration:0,geometryEpoch:0};
 return {...identity,planId:randomUUID(),documentNonce:randomUUID(),windowWidth:viewportWidth,windowHeight:viewportHeight,targetWidth:width,targetHeight:height,direction:'ltr',signature,position:{logicalX:0,logicalY:0,sourceLeft:0,sourceTop:0,clientWidth:viewportWidth,clientHeight:viewportHeight,stickyCrop:0}};
}
function snapshot(prep,spec,changes={}) {return {...prep.signature,owner:prep.owner,sessionId:prep.sessionId,operationId:prep.operationId,planId:prep.planId,documentNonce:prep.documentNonce,sequence:spec.sequence,scrollEpoch:0,nativeScrollLeft:spec.logicalX,nativeScrollTop:spec.logicalY,logicalX:spec.logicalX,logicalY:spec.logicalY,sourceLeft:spec.sourceLeft,sourceTop:spec.sourceTop,clientWidth:spec.clientWidth,clientHeight:spec.clientHeight,...changes};}
function compositor(options={}) {
 const counts={draw:0,convert:0,closed:0,urls:0,fetch:0};
 const runtime={id:'synthetic-extension',getURL:p=>'chrome-extension://synthetic-extension/'+p,onMessage:event(),sendMessage:async()=>{}};
 const c=vm.createContext({chrome:{runtime},crypto:{randomUUID},console,setTimeout:()=>0,clearTimeout(){},TextEncoder,Uint8Array,Uint32Array,DataView,Blob,AbortController,ReadableStream,Response,CompressionStream,URL:{createObjectURL(){counts.urls++;return 'blob:synthetic-'+counts.urls;},revokeObjectURL(){}},fetch:async()=>{counts.fetch++;return {ok:true,blob:async()=>new Blob()};},createImageBitmap:async()=>({width:options.bitmapWidth||200,height:options.bitmapHeight||180,close(){counts.closed++;}})});
 c.OffscreenCanvas=class {constructor(w,h){this.width=w;this.height=h;}getContext(){return {fillRect(){},drawImage(){counts.draw++;},getImageData:(x,y,w,h)=>({data:new Uint8Array(w*h*4)})};}async convertToBlob(){counts.convert++;return new Blob();}};
 const P=protocol(c);
 vm.runInContext(fs.readFileSync('offscreen.js','utf8')+'\nglobalThis.api={sessions,createSession,validateTileCoverage,pngChunk,finalizeTile,getTile,finalizeTilesBefore};',c);
 const request=(identity,type,payload={})=>c.__cfpCompositorHandle({target:'cfp-offscreen',protocolVersion:1,requestId:randomUUID(),type,...identity,...payload});
 const frame=(p,spec,changes={})=>request(p,'frame',{spec,preSnapshot:snapshot(p,spec),postSnapshot:snapshot(p,spec),dataUrl:'data:image/png;base64,AA==',...changes});
 return {c,P,api:c.api,request,frame,counts,runtime};
}
function content() {
 const waits=[],root={scrollLeft:17,scrollTop:23,scrollWidth:200,scrollHeight:2000,clientWidth:200,clientHeight:180};
 const runtime={onConnect:event()};
 const c=vm.createContext({crypto:{randomUUID},getComputedStyle:()=>({boxSizing:'content-box',direction:'ltr',writingMode:'horizontal-tb',transform:'none'}),HTMLIFrameElement:class {},window:{innerWidth:200,innerHeight:180,devicePixelRatio:1},document:{scrollingElement:root,documentElement:root},chrome:{runtime},console,setTimeout,clearTimeout});
 protocol(c);
 let source=fs.readFileSync('content.js','utf8').replace(/\}\)\(\);\s*$/,`globalThis.api={prepare,moveTo,snapshot,restore,getState:()=>state,setDetector:fn=>detectPrimaryScroller=fn,expandFrames:expandSameOriginIframes,writeOwnedProperty,restoreProperty};
 allElements=function*(){yield* globalThis.elements;};detectPrimaryScroller=()=>document.scrollingElement;
 installCaptureStyles=()=>[];discoverCaptureRoots=()=>{};
 expandSameOriginIframes=()=>({count:0,blocked:0,restore(){}});
 neutralizeFixedBackgrounds=snapshotVisibleElements=suppressViewportAnchoredElements=()=>{};
 settle=async()=>{await globalThis.wait();};})();`);
 c.wait=()=>{const d=deferred();waits.push(d);return d.promise;};c.elements=[];vm.runInContext(source,c);
 return {api:c.api,root,waits,c,runtime};
}
function worker(options={}) {
 let now=0;const captureTimes=[],frames=[],downloads=[];
 const comp=compositor(options),identity=scope();let pagePrep,commanded,acquisitions=0,captureCalls=0;
 const contentPort={onMessage:event(),onDisconnect:event(),disconnect(){this.onDisconnect.emit();},postMessage(message){
   let result;
   if(message.method==='prepare'){pagePrep=prep(message,options);result=pagePrep;}
   else if(message.method==='position'){commanded=message.payload;result=snapshot(pagePrep,commanded);}
   else if(message.method==='snapshot'){result=snapshot(pagePrep,commanded);if(options.snapshot)result=options.snapshot(result,{acquisitions:acquisitions++,captureCalls,commanded});}
   else result={acknowledged:true,partial:false,failed:[]};
   queueMicrotask(()=>this.onMessage.emit({replyTo:message.id,protocolVersion:1,operationId:message.operationId,sessionId:message.sessionId,owner:message.owner,result}));
 }};
 const tab={id:0,windowId:0,active:true,url:'https://synthetic.invalid/',title:'synthetic'};
 const runtime={id:'synthetic-extension',getURL:p=>'chrome-extension://synthetic-extension/'+p,onInstalled:event(),onStartup:event(),onMessage:event(),sendMessage:async message=>{if(message.type==='frame')frames.push(message);return comp.c.__cfpCompositorHandle(message);}};
 const timers=new Map();let timerId=0;
 const c=vm.createContext({crypto:{randomUUID},console,URL,Date:class extends Date{static now(){return now;}},queueMicrotask,chrome:{runtime,contextMenus:{onClicked:event(),removeAll(){},create(){}},tabs:{onActivated:event(),get:async()=>tab,query:async()=>[tab],connect:()=>contentPort,captureVisibleTab:async()=>{captureTimes.push(now);captureCalls++;if(options.capture)await options.capture(captureCalls);return 'data:image/png;base64,AA==';}},scripting:{executeScript:async()=>{}},downloads:{download:async item=>{downloads.push(item);return 0;},onChanged:event()},offscreen:{createDocument:async()=>{},closeDocument:async()=>{} }},setTimeout(fn,ms){const id=++timerId;if(ms<=560){now+=ms;queueMicrotask(fn);}else timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 runtime.getContexts=async()=>[{contextType:'OFFSCREEN_DOCUMENT'}];
 protocol(c);vm.runInContext(fs.readFileSync('service-worker.js','utf8')+'\nglobalThis.api={captureFullPage,createPortRPC,callCompositor,captureVisible,startCapture,getActive:()=>activeCapture};',c);
 return {...comp,workerContext:c,workerApi:c.api,contentPort,captureTimes,frames,downloads,timers,tab,run:()=>c.api.captureFullPage(tab,()=>{})};
}
module.exports={deferred,event,protocol,scope,prep,snapshot,compositor,content,worker};
