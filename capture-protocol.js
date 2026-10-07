(() => {
  "use strict";
  if (globalThis.__cfpProtocol?.protocolVersion === 1) return;
  const protocolVersion = 1, MAX_CAPTURE_FRAMES = 20000;
  const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  function fault(code, message) { return Object.assign(new Error(message), { code }); }
  function assertFiniteGeometry(value, fieldName, { positive = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > maximum) throw fault("INVALID_GEOMETRY", `Invalid ${fieldName}.`);
    return value;
  }
  function makeTraversal(prep) {
    if (!uuid(prep?.planId)) throw fault("INVALID_PLAN", "Invalid plan identity.");
    const width = assertFiniteGeometry(prep.targetWidth, "targetWidth", {positive:true});
    const height = assertFiniteGeometry(prep.targetHeight, "targetHeight", {positive:true});
    const viewportWidth = assertFiniteGeometry(prep.position.clientWidth, "clientWidth", {positive:true});
    const viewportHeight = assertFiniteGeometry(prep.position.clientHeight, "clientHeight", {positive:true});
    for (const name of ["windowWidth", "windowHeight"]) assertFiniteGeometry(prep[name], name, {positive:true});
    for (const name of ["sourceLeft", "sourceTop"]) assertFiniteGeometry(prep.position[name], name);
    const plan = {planId:prep.planId,width,height,viewportWidth,viewportHeight,windowWidth:prep.windowWidth,windowHeight:prep.windowHeight,owner:prep.owner,sessionId:prep.sessionId,documentNonce:prep.documentNonce,direction:prep.direction,signature:prep.signature,maxX:Math.max(0,width-viewportWidth),maxY:Math.max(0,height-viewportHeight),sourceLeft:prep.position.sourceLeft,sourceTop:prep.position.sourceTop};
    let previous = null, count = 0;
    while ((previous = nextFrameSpec(plan, previous)) && count <= MAX_CAPTURE_FRAMES) count++;
    return Object.freeze({...plan,estimatedFrames:count});
  }
  function nextFrameSpec(plan, previous) {
    let sequence = 0, row = 0, column = 0, logicalX = 0, logicalY = 0;
    if (previous) {
      sequence = previous.sequence + 1; row = previous.row; column = previous.column + 1; logicalY = previous.logicalY;
      if (previous.logicalX < plan.maxX) logicalX = Math.min(plan.maxX, previous.logicalX + Math.max(1,plan.viewportWidth-30));
      else {
        if (previous.logicalY >= plan.maxY) return null;
        const overlap = Math.min(previous.row === 0 ? 300 : 190, Math.floor(plan.viewportHeight/2)+1);
        logicalY = Math.min(plan.maxY,previous.logicalY+Math.max(1,plan.viewportHeight-overlap)); row++; column = 0;
      }
    }
    return Object.freeze({planId:plan.planId,sequence,row,column,logicalX,logicalY,sourceLeft:plan.sourceLeft,sourceTop:plan.sourceTop,clientWidth:plan.viewportWidth,clientHeight:plan.viewportHeight,stickyCrop:0});
  }
  const specFields = Object.freeze(["planId","sequence","row","column","logicalX","logicalY","sourceLeft","sourceTop","clientWidth","clientHeight","stickyCrop"]);
  const sameSpec = (a,b) => !!a && !!b && specFields.every(k=>a[k]===b[k]);
  function validateSnapshot(plan, spec, snapshot) {
    const bad = (code,retryable=false) => ({ok:false,code,retryable});
    if (!snapshot || !spec || snapshot.planId !== plan.planId || snapshot.planId !== spec.planId || !uuid(snapshot.documentNonce)) return bad("STALE_DOCUMENT");
    for (const key of ["owner","sessionId"]) if (!uuid(snapshot[key]) || (plan[key] && snapshot[key] !== plan[key])) return bad("INVALID_IDENTITY");
    if (plan.documentNonce && snapshot.documentNonce !== plan.documentNonce) return bad("STALE_DOCUMENT");
    if (snapshot.sequence !== spec.sequence) return bad("FRAME_ORDER");
    for (const key of ["geometryGeneration","geometryEpoch","scrollEpoch"]) if (!Number.isSafeInteger(snapshot[key]) || snapshot[key]<0) return bad("INVALID_GEOMETRY");
    const numeric = ["logicalX","logicalY","nativeScrollLeft","nativeScrollTop","innerWidth","innerHeight","layoutWidth","layoutHeight","scrollWidth","scrollHeight","sourceLeft","sourceTop","clientWidth","clientHeight","devicePixelRatio","visualScale","visualOffsetLeft","visualOffsetTop"];
    if (numeric.some(key=>!Number.isFinite(snapshot[key]))) return bad("INVALID_GEOMETRY");
    for (const key of ["sourceLeft","sourceTop","clientWidth","clientHeight"]) if (snapshot[key] !== spec[key]) return bad("GEOMETRY_CHANGED");
    if (snapshot.innerWidth !== plan.windowWidth || snapshot.innerHeight !== plan.windowHeight || snapshot.clientWidth !== plan.viewportWidth || snapshot.clientHeight !== plan.viewportHeight) return bad("GEOMETRY_CHANGED");
    const signature = plan.signature;
    if (signature) for (const key of ["layoutWidth","layoutHeight","devicePixelRatio","visualScale","visualOffsetLeft","visualOffsetTop","geometryGeneration","geometryEpoch"]) if (snapshot[key] !== signature[key]) return bad("GEOMETRY_CHANGED");
    if (snapshot.visualScale !== 1 || snapshot.visualOffsetLeft !== 0 || snapshot.visualOffsetTop !== 0) return bad("UNSUPPORTED_MAPPING");
    if (Math.abs(snapshot.logicalX-spec.logicalX)>0.5 || Math.abs(snapshot.logicalY-spec.logicalY)>0.5) return bad("SCROLL_CHANGED",true);
    if (snapshot.scrollWidth < plan.width || snapshot.scrollHeight < plan.height || (plan.direction === "rtl" && signature && snapshot.scrollWidth !== signature.scrollWidth)) return bad("GEOMETRY_CHANGED");
    return {ok:true,code:null,retryable:false};
  }
  function snapshotPair(plan,spec,pre,post) {
    for (const s of [pre,post]) { const r=validateSnapshot(plan,spec,s); if(!r.ok)return r; }
    for (const key of ["documentNonce","geometryGeneration","geometryEpoch","devicePixelRatio","visualScale","visualOffsetLeft","visualOffsetTop"]) if(pre[key]!==post[key])return {ok:false,code:"GEOMETRY_CHANGED",retryable:false};
    if(pre.scrollEpoch!==post.scrollEpoch || pre.logicalX!==post.logicalX || pre.logicalY!==post.logicalY)return {ok:false,code:"SCROLL_CHANGED",retryable:true};
    return {ok:true,code:null,retryable:false};
  }
  function frameRect(prep,p,bitmapWidth,bitmapHeight) {
    for(const [key,value] of Object.entries({bitmapWidth,bitmapHeight})) assertFiniteGeometry(value,key,{positive:true});
    const rx=bitmapWidth/prep.windowWidth, ry=bitmapHeight/prep.windowHeight;
    for(const key of ["sourceLeft","sourceTop","logicalX","logicalY"])assertFiniteGeometry(p[key],key);
    for(const key of ["clientWidth","clientHeight"])assertFiniteGeometry(p[key],key,{positive:true});
    const sx=Math.round(p.sourceLeft*rx), sy=Math.round(p.sourceTop*ry), sourceWidth=Math.round(p.clientWidth*rx), sourceHeight=Math.round(p.clientHeight*ry);
    if(p.stickyCrop!==0 || sx+sourceWidth>bitmapWidth || sy+sourceHeight>bitmapHeight)throw fault("INVALID_CROP","Frame crop exceeds bitmap.");
    const dx=Math.round(p.logicalX*rx), dy=Math.round(p.logicalY*ry);
    const sw=Math.min(sourceWidth,Math.floor(prep.targetWidth*rx)-dx), sh=Math.min(sourceHeight,Math.floor(prep.targetHeight*ry)-dy);
    if(sw<=0 || sh<=0)throw fault("INVALID_CROP","Frame is outside output.");
    return {sx,sy,sw,sh,dx,dy};
  }
  function errorResult(code,message) { return {ok:false,code,error:message}; }
  globalThis.__cfpProtocol = Object.freeze({protocolVersion,MAX_CAPTURE_FRAMES,uuid,fault,assertFiniteGeometry,makeTraversal,nextFrameSpec,validateSnapshot,snapshotPair,frameRect,sameSpec,errorResult});
})();
