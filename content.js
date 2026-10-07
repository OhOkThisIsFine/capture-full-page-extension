(() => {
  if (window !== window.top) throw new Error("Top-frame capture is required.");
  if (window.__cfpFireStyleInstalled) return;
  const P = globalThis.__cfpProtocol;
  if (!P || P.protocolVersion !== 1) throw new Error("Capture protocol unavailable.");
  window.__cfpFireStyleInstalled = true;
  const documentNonce = crypto.randomUUID();
  let state = null;

  chrome.runtime.onConnect.addListener(port => {
    if(port.sender?.id!==chrome.runtime.id || !port.name.startsWith("cfp:") || !P.uuid(port.name.slice(4)))return;
    const owner = {cancelled:false,context:null};
    let commands = Promise.resolve(), identity = null, lastId = 0;
    const dispatch = async message => {
      try{P.ownRecord(message,["id","method","protocolVersion","operationId","sessionId","owner","payload"]);}catch{return;}
      const fields = ["operationId","sessionId","owner"];
      if (!message || message.protocolVersion !== 1 || !Number.isSafeInteger(message.id) || message.id<=lastId || fields.some(k=>!P.uuid(message[k]))) return;
      if (!identity) {
        if (message.method !== "prepare" || port.name !== `cfp:${message.sessionId}`) return;
        identity = {protocolVersion:1,...Object.fromEntries(fields.map(k=>[k,message[k]]))};
        owner.identity=identity;
      }
      if (fields.some(k=>message[k] !== identity[k])) return;
      lastId = message.id;
      const reply = {replyTo:message.id,protocolVersion:1,...identity};
      try {
        let result;
        switch(message.method) {
          case "prepare": if(owner.prepared)throw P.fault("ALREADY_PREPARED");owner.prepared=true;result=await prepare(owner,message.payload);break;
          case "position": result = await moveTo(owner.context,message.payload.spec); break;
          case "snapshot": result = snapshot(owner.context,message.payload.spec); break;
          case "accept-frame": result=acceptFrame(owner.context,message.payload);break;
          case "restore": result = await restore(owner.context); break;
          case "cancel": owner.cancelled=true; result = await restore(owner.context); break;
          default: throw P.fault("INVALID_COMMAND","Unknown capture command.");
        }
        port.postMessage({...reply,result});
      } catch(error) { port.postMessage({...reply,code:error.code || "CAPTURE_FAILED",error:P.errorResult(error.code).error}); }
    };
    port.onMessage.addListener(message => { if(message?.method==="cancel"){dispatch(message).catch(()=>{});return;}commands=commands.then(()=>dispatch(message)).catch(()=>{}); });
    port.onDisconnect.addListener(()=>{owner.cancelled=true;restore(owner.context).catch(()=>{});});
  });

  function checkOwner(context) {
    if (!context || context.cancelled || context.owner.cancelled || state !== context) {
      throw new Error("Capture session was cancelled.");
    }
  }

  async function prepare(owner = {cancelled:false,identity:{protocolVersion:1,operationId:crypto.randomUUID(),sessionId:crypto.randomUUID(),owner:crypto.randomUUID()}}, options = {strategy:"auto",prepareExpiresAt:Date.now()+15000,operationExpiresAt:Date.now()+900000}) {
    const identity=owner.identity;
    P.ownRecord(options,["strategy","prepareExpiresAt","operationExpiresAt"]);
    if(!["auto","preserve"].includes(options.strategy) || !Number.isFinite(options.prepareExpiresAt) || !Number.isFinite(options.operationExpiresAt))throw P.fault("INVALID_ENVELOPE");
    if(options.strategy==="preserve" && !P.getQualifiedCapabilities("chrome").preserveVirtualizer)throw P.fault("UNSUPPORTED_TARGET_MAPPING");
    if (state) restore(state);
    if (owner.cancelled) throw new Error("Capture session was cancelled.");
    const context = { owner, identity, planId:crypto.randomUUID(), cancelled: false, rollback: [], scrollRollback: [], hidden: new Map(), changedStyles: [], ownedStyles:[], roots:new WeakSet(), effects:new WeakSet(), listeners:[], observers:[], warnings:new Set(), scrollEpoch:0,geometryEpoch:0,geometryGeneration:0 };
    owner.context = context;
    state = context;
    try {

    const documentScroller = measureDocument(document).scroller;
    const documentOriginal = {
      left: document.scrollingElement ? documentScroller.scrollLeft : window.scrollX,
      top: document.scrollingElement ? documentScroller.scrollTop : window.scrollY
    };

    context.scrollRollback.push(() => {
      if(!document.scrollingElement)window.scrollTo(documentOriginal.left,documentOriginal.top);
      else {documentScroller.scrollLeft = documentOriginal.left;documentScroller.scrollTop = documentOriginal.top;}
    });
    snapshotIframeScroll(context);

    const initialDocumentWidth = Math.max(
      documentScroller.scrollWidth,
      documentScroller.clientWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
      1
    );
    const initialDocumentHeight = Math.max(
      documentScroller.scrollHeight,
      documentScroller.clientHeight,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      1
    );

    const detected = detectPrimaryScroller();
    let scroller = detected;
    let isDocument = isDocumentScroller(scroller);
    let nestedExpansion = null;

    // If a modern web app keeps its real content inside a large nested scroller,
    // first try FireShot's other strategy: temporarily unlock that scroller so
    // it expands IN PLACE. Then capture the document, preserving the surrounding
    // app shell (header/sidebar/toolbars) instead of cropping down to the scroller.
    if (!isDocument) {
      const nestedOriginal = {
        left: scroller.scrollLeft,
        top: scroller.scrollTop
      };
      const frozenNested = {
        scrollWidth: Math.max(scroller.scrollWidth, scroller.clientWidth, 1),
        scrollHeight: Math.max(scroller.scrollHeight, scroller.clientHeight, 1),
        clientWidth: Math.max(scroller.clientWidth, 1),
        clientHeight: Math.max(scroller.clientHeight, 1)
      };

      const nested = scroller;
      context.scrollRollback.push(() => {
        nested.scrollLeft = nestedOriginal.left;
        nested.scrollTop = nestedOriginal.top;
      });
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      await settle();
      checkOwner(context);

      const unlock = unlockScrollableElement(scroller, frozenNested, context);
      await settle();
      checkOwner(context);

      const expandedDocumentWidth = Math.max(
        documentScroller.scrollWidth,
        document.documentElement.scrollWidth,
        document.body?.scrollWidth || 0,
        documentScroller.clientWidth,
        1
      );
      const expandedDocumentHeight = Math.max(
        documentScroller.scrollHeight,
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
        documentScroller.clientHeight,
        1
      );

      const expectedExtraY = Math.max(0, frozenNested.scrollHeight - frozenNested.clientHeight);
      const expectedExtraX = Math.max(0, frozenNested.scrollWidth - frozenNested.clientWidth);
      const growthY = Math.max(0, expandedDocumentHeight - initialDocumentHeight);
      const growthX = Math.max(0, expandedDocumentWidth - initialDocumentWidth);

      const expandedEnoughY =
        expectedExtraY <= 8 ||
        growthY >= Math.min(80, Math.max(20, expectedExtraY * 0.25));

      const expandedEnoughX =
        expectedExtraX <= 8 ||
        growthX >= Math.min(80, Math.max(20, expectedExtraX * 0.25));

      if (expandedEnoughY && expandedEnoughX) {
        // Cap the frozen output to what existed BEFORE capture. If unlocking or
        // scrolling triggers lazy loading, normal full-page capture won't chase it.
        const expectedHeight = initialDocumentHeight + expectedExtraY;
        const expectedWidth = initialDocumentWidth + expectedExtraX;

        nestedExpansion = {
          element: scroller,
          original: nestedOriginal,
          restoreStyles: unlock.restore,
          frozenNested
        };

        scroller = documentScroller;
        isDocument = true;

        // Allow a little layout slack, but never adopt arbitrary later growth.
        var frozenTargetHeight = Math.max(
          initialDocumentHeight,
          Math.min(expandedDocumentHeight, expectedHeight + 192)
        );
        var frozenTargetWidth = Math.max(
          initialDocumentWidth,
          Math.min(expandedDocumentWidth, expectedWidth + 64)
        );
      } else {
        unlock.restore();
        scroller.scrollLeft = nestedOriginal.left;
        scroller.scrollTop = nestedOriginal.top;
        await settle();
      checkOwner(context);

        var frozenTargetWidth = Math.max(scroller.scrollWidth, scroller.clientWidth, 1);
        var frozenTargetHeight = Math.max(scroller.scrollHeight, scroller.clientHeight, 1);
      }
    } else {
      var frozenTargetWidth = Math.max(scroller.scrollWidth, scroller.clientWidth, 1);
      var frozenTargetHeight = Math.max(scroller.scrollHeight, scroller.clientHeight, 1);
    }

    const iframeExpansion = expandSameOriginIframes(isDocument ? null : scroller, context);
    if (iframeExpansion.count > 0) {
      await settle();
      checkOwner(context);

      if (isDocument) {
        frozenTargetWidth = Math.max(
          frozenTargetWidth,
          documentScroller.scrollWidth,
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0
        );
        frozenTargetHeight = Math.max(
          frozenTargetHeight,
          documentScroller.scrollHeight,
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0
        );
      } else {
        frozenTargetWidth = Math.max(frozenTargetWidth, scroller.scrollWidth, scroller.clientWidth);
        frozenTargetHeight = Math.max(frozenTargetHeight, scroller.scrollHeight, scroller.clientHeight);
      }
    }

    if (iframeExpansion.blocked > 0) {
      console.warn(
        `Capture Full Page: ${iframeExpansion.blocked} cross-origin iframe(s) could not be expanded and will remain viewport-only.`
      );
    }

    const originalScrollLeft = scroller.scrollLeft;
    const originalScrollTop = scroller.scrollTop;
    const captureStyles = installCaptureStyles(context);

    Object.assign(context, {
      scroller,
      isDocument,
      captureStyles,
      iframeExpansion,
      originalScrollLeft,
      originalScrollTop,
      documentScroller,
      documentOriginal,
      nestedExpansion,
      targetWidth: frozenTargetWidth,
      targetHeight: frozenTargetHeight,
      currentX: 0,
      currentY: 0,
      logicalOffsetX: 0,
      logicalOffsetY: 0,
      firstVerticalMove: true,
      hidden: new Map(),
      changedStyles: [],
      tracked: new WeakMap(),
      frameIndex: 0
    });

    neutralizeFixedBackgrounds();

    assertSupportedMapping(context);
    writeLogicalScroll(context,0,0);
    await settle();
    checkOwner(context);
    snapshotVisibleElements();
    const viewport = measureViewport(context);
    const metrics=liveMetrics(context);
    const strategy=isDocument ? (nestedExpansion ? "expanded-nested" : "document") : "preserve";
    if(strategy==="preserve" && !P.getQualifiedCapabilities("chrome").preserveVirtualizer)throw P.fault("UNSUPPORTED_TARGET_MAPPING");
    context.prep = P.validatePrep({...identity,documentNonce,planId:context.planId,strategy,
      captureScope:strategy==="preserve" ? "target-only" : "full-page",
      windowWidth:window.innerWidth,windowHeight:window.innerHeight,layoutWidth:metrics.layoutWidth,layoutHeight:metrics.layoutHeight,
      targetWidth:context.targetWidth,targetHeight:context.targetHeight,...viewport,
      direction:getComputedStyle(scroller).direction || "ltr",writingMode:"horizontal-tb",
      physicalScrollWidth:metrics.physicalScrollWidth,physicalScrollHeight:metrics.physicalScrollHeight,
      devicePixelRatio:metrics.devicePixelRatio,visualViewport:metrics.visualViewport,geometryGeneration:context.geometryGeneration,warnings:[...context.warnings].sort().sort()});
    context.signature={...metrics};
    context.plan=P.makeTraversal(context.prep);
    context.lastAcceptedSpec=null;
    installGeometryObservers(context);
    return context.prep;
    } catch (error) {
      await restore(context);
      throw error;
    }
  }

  function measureDocument(doc) {
    const win=doc.defaultView || window;
    const root=doc.compatMode === "BackCompat" ? doc.body : doc.documentElement;
    const scroller=doc.scrollingElement || root;
    return {scroller,viewportWidth:root?.clientWidth || win.innerWidth,viewportHeight:root?.clientHeight || win.innerHeight,
      scrollWidth:Math.max(scroller?.scrollWidth || 0,root?.scrollWidth || 0,win.innerWidth),
      scrollHeight:Math.max(scroller?.scrollHeight || 0,root?.scrollHeight || 0,win.innerHeight),direction:getComputedStyle(scroller).direction || "ltr"};
  }
  function measureViewport(context) {
    if(context.isDocument) {const m=measureDocument(document);return {sourceLeft:0,sourceTop:0,clientWidth:m.viewportWidth,clientHeight:m.viewportHeight};}
    const s=context.scroller,r=s.getBoundingClientRect();
    return {sourceLeft:r.left+s.clientLeft,sourceTop:r.top+s.clientTop,clientWidth:s.clientWidth,clientHeight:s.clientHeight};
  }
  function readLogicalScroll(context) {
    const s=context.scroller,windowRoute=context.isDocument && !document.scrollingElement;
    const nativeX=windowRoute ? window.scrollX : s.scrollLeft,nativeY=windowRoute ? window.scrollY : s.scrollTop;
    const rtl=getComputedStyle(s).direction === "rtl";
    return {nativeX,nativeY,logicalX:rtl ? nativeX+s.scrollWidth-measureViewport(context).clientWidth : nativeX,logicalY:nativeY};
  }
  function writeLogicalScroll(context,x,y) {
    const s=context.scroller,nativeX=getComputedStyle(s).direction === "rtl" ? x-(s.scrollWidth-measureViewport(context).clientWidth) : x;
    if(context.isDocument && !document.scrollingElement) window.scrollTo(nativeX,y);
    else {s.scrollLeft=nativeX;s.scrollTop=y;}
  }
  function assertSupportedMapping(context) {
    for(let el=context.scroller;el;el=el.parentElement) {
      const css=getComputedStyle(el);
      if((css.writingMode && css.writingMode!=="horizontal-tb") || (css.transform && css.transform!=="none")) throw P.fault("UNSUPPORTED_MAPPING","Unsupported capture target mapping.");
    }
    const v=window.visualViewport;
    if(v && (v.scale!==1 || Math.abs(v.offsetLeft)>0.5 || Math.abs(v.offsetTop)>0.5)) throw P.fault("UNSUPPORTED_MAPPING","Pinch zoom mapping is unsupported.");
  }
  function liveMetrics(context) {
    const v=window.visualViewport,m=measureDocument(document),p=measureViewport(context),s=context.scroller;
    return {...p,windowWidth:window.innerWidth,windowHeight:window.innerHeight,layoutWidth:m.viewportWidth,layoutHeight:m.viewportHeight,
      physicalScrollWidth:s.scrollWidth,physicalScrollHeight:s.scrollHeight,devicePixelRatio:window.devicePixelRatio || 1,
      visualViewport:v ? {scale:v.scale,offsetLeft:v.offsetLeft,offsetTop:v.offsetTop,width:v.width,height:v.height} : null,
      geometryGeneration:context.geometryGeneration,geometryEpoch:context.geometryEpoch};
  }
  function installGeometryObservers(context) {
    const listen=(target,type,fn)=>{if(!target?.addEventListener)return;target.addEventListener(type,fn,{passive:true});context.listeners.push(()=>target.removeEventListener(type,fn));};
    listen(context.isDocument ? window : context.scroller,"scroll",()=>context.scrollEpoch++);
    const geometry=()=>{context.geometryEpoch++;context.geometryGeneration++;};
    listen(window,"resize",geometry);listen(window.visualViewport,"resize",geometry);listen(window.visualViewport,"scroll",geometry);
    if(typeof ResizeObserver!=="undefined") {
      let previous=null;
      const observer=new ResizeObserver(()=>{const m=liveMetrics(context),key=[m.clientWidth,m.clientHeight,m.layoutWidth,m.layoutHeight].join(":");if(previous!==null && key!==previous)geometry();previous=key;});
      observer.observe(context.scroller);if(context.scroller!==document.documentElement)observer.observe(document.documentElement);context.observers.push(observer);
    }
  }
  function snapshot(context,spec) {
    checkOwner(context);
    if(!P.sameSpec(spec,context.commandedSpec))throw P.fault("FRAME_SEQUENCE_MISMATCH","Snapshot does not match commanded frame.");
    assertSupportedMapping(context);
    const metrics=liveMetrics(context),original=context.signature;
    const keys=["sourceLeft","sourceTop","clientWidth","clientHeight","windowWidth","windowHeight","layoutWidth","layoutHeight","devicePixelRatio","physicalScrollWidth","physicalScrollHeight"];
    if(keys.some(k=>metrics[k]!==original[k])) {context.geometryGeneration++;metrics.geometryGeneration=context.geometryGeneration;}
    const scroll=readLogicalScroll(context);
    return {documentNonce,...context.identity,planId:context.planId,sequence:spec.sequence,...metrics,
      nativeScrollLeft:scroll.nativeX,nativeScrollTop:scroll.nativeY,logicalX:scroll.logicalX,logicalY:scroll.logicalY,
      scrollEpoch:context.scrollEpoch,warnings:[...context.warnings].sort()};
  }
  async function moveTo(context,spec) {
    checkOwner(context);
    const expected=P.nextFrameSpec(context.plan,context.lastAcceptedSpec);
    if(!P.sameSpec(spec,expected) && !P.sameSpec(spec,context.commandedSpec))throw P.fault("FRAME_SEQUENCE_MISMATCH","Position does not match planned traversal.");
    if(context.commandedSpec && !P.sameSpec(spec,context.commandedSpec) && !P.sameSpec(context.commandedSpec,context.lastAcceptedSpec))throw P.fault("FRAME_NOT_ACCEPTED");
    context.commandedSpec=spec;
    context.provisionalCandidates=new Map();
    discoverCaptureRoots(context,{remaining:12000});
    writeLogicalScroll(context,spec.logicalX,spec.logicalY);
    await settle();checkOwner(context);
    context.currentX=context.scroller.scrollLeft;context.currentY=context.scroller.scrollTop;
    suppressViewportAnchoredElements(spec);
    return snapshot(context,spec);
  }
  function acceptFrame(context,payload) {
    checkOwner(context);
    P.ownRecord(payload,["spec","bitmapWidth","bitmapHeight","rect","novelRect"]);
    const {spec,bitmapWidth,bitmapHeight,rect,novelRect}=payload;
    P.ownRecord(rect,["sx","sy","sw","sh","dx","dy"]);
    if(novelRect!==null)P.ownRecord(novelRect,["sx","sy","sw","sh","dx","dy"]);
    P.validateSpec(context.plan,spec);
    if(!P.sameSpec(spec,context.commandedSpec))throw P.fault("FRAME_SEQUENCE_MISMATCH");
    const expectedRect=P.frameRect(context.prep,spec,bitmapWidth,bitmapHeight),expectedNovel=P.novelFrameRect(context.plan,spec,bitmapWidth,bitmapHeight);
    if(!P.sameRect(rect,expectedRect) || !P.sameRect(novelRect,expectedNovel))throw P.fault("INVALID_GEOMETRY");
    if(context.bitmapWidth!==undefined && (context.bitmapWidth!==bitmapWidth || context.bitmapHeight!==bitmapHeight))throw P.fault("BITMAP_SCALE_CHANGED");
    if(P.sameSpec(spec,context.lastAcceptedSpec))return {acceptedSequence:spec.sequence};
    if(!P.sameSpec(spec,P.nextFrameSpec(context.plan,context.lastAcceptedSpec)))throw P.fault("FRAME_SEQUENCE_MISMATCH");
    context.bitmapWidth=bitmapWidth;context.bitmapHeight=bitmapHeight;
    context.lastAcceptedSpec=spec;
    for(const [node,observation] of context.provisionalCandidates || [])context.tracked.set(node,observation);
    context.provisionalCandidates?.clear();
    if(novelRect)(context.acceptedRects ||= []).push({x0:novelRect.dx/(bitmapWidth/context.prep.windowWidth),y0:novelRect.dy/(bitmapHeight/context.prep.windowHeight),x1:(novelRect.dx+novelRect.sw)/(bitmapWidth/context.prep.windowWidth),y1:(novelRect.dy+novelRect.sh)/(bitmapHeight/context.prep.windowHeight)});
    return {acceptedSequence:spec.sequence};
  }
  function getViewportMetrics() {return measureViewport(state);}

  function detectPrimaryScroller() {
    const docScroller = document.scrollingElement || document.documentElement;
    const docScrollable =
      docScroller.scrollHeight > docScroller.clientHeight + 4 ||
      docScroller.scrollWidth > docScroller.clientWidth + 4;

    let best = null;
    let bestScore = -Infinity;
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el === document.body || el === document.documentElement) continue;
      if (el.clientWidth < 100 || el.clientHeight < 100) continue;
      if (el.scrollWidth <= el.clientWidth + 4 && el.scrollHeight <= el.clientHeight + 4) continue;

      const style = getComputedStyle(el);
      if (!isScrollableStyle(style)) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) continue;
      if (rect.width > window.innerWidth + 4 || rect.height > window.innerHeight + 60) continue;

      const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const coverage = (visibleWidth * visibleHeight) / viewportArea;
      const widthFrac = visibleWidth / Math.max(1, window.innerWidth);
      const heightFrac = visibleHeight / Math.max(1, window.innerHeight);

      if (widthFrac < 0.5 || heightFrac < 0.55) continue;
      if (docScrollable && coverage < 0.65 && el.scrollHeight < docScroller.scrollHeight * 0.75) continue;

      const overflowGain = Math.log2(1 + Math.max(
        el.scrollHeight / Math.max(1, el.clientHeight),
        el.scrollWidth / Math.max(1, el.clientWidth)
      ));
      const score = coverage * 10 + widthFrac * 2 + heightFrac * 3 + overflowGain;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best) return docScroller;

    if (docScrollable) {
      const rect = best.getBoundingClientRect();
      const dominates =
        rect.width >= window.innerWidth * 0.72 &&
        rect.height >= window.innerHeight * 0.72 &&
        best.scrollHeight >= docScroller.scrollHeight * 0.75;
      if (!dominates) return docScroller;
    }

    return best;
  }

  // Based on FireShot's scroll-container unlocking strategy: preserve every
  // changed inline style, relax overflow/height constraints on the target and
  // its ancestors, and account for flex/grid/positioned layouts.
  function unlockScrollableElement(target, frozen, context) {
    const saved = new Map();

    const restore = () => {
      for (const [node, props] of [...saved.entries()].reverse()) {
        for (const [prop, value] of Object.entries(props)) restoreProperty(node, prop, value.value, value.priority);
      }
      saved.clear();
    };
    context?.rollback.push(restore);

    function save(el) {
      if (saved.has(el)) return;
      const props = [
        "overflow", "overflow-x", "overflow-y",
        "height", "min-height", "max-height",
        "flex-shrink", "flex-basis", "align-self",
        "position", "top", "bottom", "left", "right"
      ];
      const values = {};
      for (const prop of props) {
        values[prop] = {
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop)
        };
      }
      saved.set(el, values);
    }

    function set(el, prop, value) {
      save(el);
      writeOwnedProperty(el,prop,value);
    }

    let el = target;
    while (el && el instanceof HTMLElement) {
      save(el);
      const cs = getComputedStyle(el);

      for (const prop of ["overflow", "overflow-x", "overflow-y"]) {
        const cssName = prop;
        const jsValue =
          prop === "overflow" ? cs.overflow :
          prop === "overflow-x" ? cs.overflowX :
          cs.overflowY;
        if (["auto", "scroll", "hidden", "clip", "overlay"].includes(jsValue)) {
          set(el, cssName, "visible");
        }
      }

      if (cs.maxHeight !== "none") set(el, "max-height", "none");

      if (el === target) {
        // For absolutely-positioned virtual content, "height:auto" can collapse.
        // Force the exact pre-capture scroll height instead.
        set(el, "height", `${Math.ceil(frozen.scrollHeight)}px`);
        set(el, "min-height", `${Math.min(Math.ceil(frozen.scrollHeight), 1000000)}px`);
        set(el, "max-height", "none");
        set(el, "overflow", "visible");
        set(el, "overflow-y", "visible");
      } else {
        const numericHeight = parseFloat(cs.height);
        if (cs.height !== "auto" && Number.isFinite(numericHeight)) {
          set(el, "min-height", cs.height);
          set(el, "height", "auto");
        }
      }

      const parent = el.parentElement;
      if (parent) {
        const parentDisplay = getComputedStyle(parent).display;
        if (parentDisplay === "flex" || parentDisplay === "inline-flex") {
          set(el, "flex-shrink", "0");
          if (cs.flexBasis !== "auto") set(el, "flex-basis", "auto");
          if (cs.alignSelf === "stretch") set(el, "align-self", "flex-start");
        } else if (parentDisplay === "grid" || parentDisplay === "inline-grid") {
          if (cs.alignSelf === "stretch") set(el, "align-self", "start");
        }
      }

      if (el === document.body || el === document.documentElement) {
        set(el, "height", "auto");
        set(el, "min-height", "100%");
      }

      if (cs.position === "absolute" || cs.position === "fixed") {
        set(el, "position", "relative");
        set(el, "top", "auto");
        set(el, "bottom", "auto");
        set(el, "left", "auto");
        set(el, "right", "auto");
      }

      if (el === document.documentElement) break;
      el = el.parentElement;
    }

    return {restore};
  }

  function installPauseStyle(root,context) {
    if(context.roots.has(root))return;
    context.roots.add(root);
    const doc=root.nodeType===9 ? root : root.ownerDocument;
    const style=doc.createElement("style");style.setAttribute("data-cfp-capture-style",context.planId);
    style.textContent="*, *::before, *::after { animation-play-state:paused!important; scroll-behavior:auto!important; scroll-snap-type:none!important; }";
    (root.nodeType===9 ? root.head || root.documentElement : root).appendChild(style);
    context.ownedStyles.push(style);
  }
  function classifyLiveEffects(root,visibleRect,context) {
    for(const effect of root.getAnimations?.({subtree:true}) || []) {
      context.effects.add(effect);
      if(effect.playState!=="running" && !effect.pending)continue;
      const target=effect.effect?.target,rect=target?.getBoundingClientRect?.();
      if(rect && rect.right>visibleRect.left && rect.bottom>visibleRect.top && rect.left<visibleRect.right && rect.top<visibleRect.bottom)context.warnings.add("LIVE_MOTION");
    }
  }
  function discoverCaptureRoots(context,budget) {
    const visited=new WeakSet();
    const visit=root=>{
      if(!root || visited.has(root) || budget.remaining<=0)return;visited.add(root);installPauseStyle(root,context);
      classifyLiveEffects(root,{left:0,top:0,right:window.innerWidth,bottom:window.innerHeight},context);
      for(const el of root.querySelectorAll?.("*") || []) {
        if(--budget.remaining<0)break;
        if(el.shadowRoot)visit(el.shadowRoot);
        if(el instanceof HTMLIFrameElement)try{const doc=el.contentDocument;if(doc){void doc.location.href;visit(doc);}}catch{}
      }
    };
    visit(document);
    if(budget.remaining<=0)throw P.fault("RESOURCE_LIMIT");
  }
  function restoreOwnedStyles(context) {for(const node of context.ownedStyles)node.remove();context.ownedStyles.length=0;}
  function installCaptureStyles(context) {discoverCaptureRoots(context,{remaining:12000});return context.ownedStyles;}

  function snapshotIframeScroll(context) {
    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLIFrameElement)) continue;
      try {
        const frameDocument = el.contentDocument;
        if (!frameDocument) continue;
        void frameDocument.location.href;
        const root = frameDocument.scrollingElement || frameDocument.documentElement;
        if (!root) continue;
        const left = root.scrollLeft, top = root.scrollTop;
        context.scrollRollback.push(() => {
          if (el.contentDocument !== frameDocument) return;
          root.scrollLeft = left;
          root.scrollTop = top;
        });
      } catch {}
    }
  }

  function expandSameOriginIframes(scopeScroller, context) {
    const saved = [];
    const rollback = () => {
      for (const {el, props} of [...saved].reverse()) {
        for (const [prop, value] of Object.entries(props)) restoreProperty(el, prop, value.value, value.priority);
      }
    };
    const restoreScroll = () => {
      for (const {el, frameDocument, root, left, top} of [...saved].reverse()) {
        try {
          if (el.contentDocument === frameDocument) {
            root.scrollLeft = left;
            root.scrollTop = top;
          }
        } catch {}
      }
      saved.length = 0;
    };
    context?.rollback.push(rollback);
    if (context) (context.scrollRollback ||= []).push(restoreScroll);
    let count = 0;
    let blocked = 0;

    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLIFrameElement)) continue;
      if (scopeScroller && !scopeScroller.contains(el)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      let frameDocument;
      try {
        frameDocument = el.contentDocument;
        if (!frameDocument) {
          blocked += 1;
          continue;
        }
        // Accessing location forces the same-origin check in browsers that
        // expose a non-null contentDocument proxy.
        void frameDocument.location.href;
      } catch {
        blocked += 1;
        continue;
      }

      const root = frameDocument.scrollingElement || frameDocument.documentElement;
      if (!root) continue;

      const contentWidth = Math.max(
        root.scrollWidth,
        frameDocument.documentElement?.scrollWidth || 0,
        frameDocument.body?.scrollWidth || 0,
        el.clientWidth
      );
      const contentHeight = Math.max(
        root.scrollHeight,
        frameDocument.documentElement?.scrollHeight || 0,
        frameDocument.body?.scrollHeight || 0,
        el.clientHeight
      );

      const needsWidth = contentWidth > el.clientWidth + 4;
      const needsHeight = contentHeight > el.clientHeight + 4;
      if (!needsWidth && !needsHeight) continue;

      const props = {};
      for (const prop of ["width", "height", "max-width", "max-height"]) {
        props[prop] = {
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop)
        };
      }
      saved.push({ el, props, frameDocument, root, left: root.scrollLeft, top: root.scrollTop });

      // A border-box CSS size includes decorations outside the iframe's inner
      // browsing viewport. Preserve room for the frozen content dimensions.
      const frameStyle = getComputedStyle(el);
      const decoration = (...properties) => properties.reduce(
        (total, property) => total + (parseFloat(frameStyle[property]) || 0), 0
      );
      const extraWidth = frameStyle.boxSizing === "border-box"
        ? decoration("borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight") : 0;
      const extraHeight = frameStyle.boxSizing === "border-box"
        ? decoration("borderTopWidth", "borderBottomWidth", "paddingTop", "paddingBottom") : 0;

      if (needsWidth) {
        writeOwnedProperty(el,"width", `${Math.ceil(contentWidth + extraWidth)}px`);
        writeOwnedProperty(el,"max-width", "none");
      }
      if (needsHeight) {
        writeOwnedProperty(el,"height", `${Math.ceil(contentHeight + extraHeight)}px`);
        writeOwnedProperty(el,"max-height", "none");
      }

      count += 1;
    }

    return {
      count,
      blocked,
      restore() { rollback(); restoreScroll(); }
    };
  }

  function isScrollableStyle(style) {
    const values = [style.overflow, style.overflowX, style.overflowY];
    return values.some(value => value === "auto" || value === "scroll" || value === "overlay");
  }

  function isDocumentScroller(el) {
    return el === document.scrollingElement || el === document.documentElement || el === document.body;
  }

  function* allElements(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!(node instanceof Element)) continue;
      yield node;

      if (node.shadowRoot) {
        const shadowChildren = Array.from(node.shadowRoot.children);
        for (let i = shadowChildren.length - 1; i >= 0; i -= 1) stack.push(shadowChildren[i]);
      }

      const children = Array.from(node.children);
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  }

  function snapshotVisibleElements() {
    if (!state) return;
    const { scroller } = state;
    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLElement) || el === scroller) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < -window.innerHeight || rect.top > window.innerHeight * 2) continue;
      state.tracked.set(el, {
        left: rect.left,
        top: rect.top,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop
      });
    }
  }

  function suppressViewportAnchoredElements(spec) {
    const context=state,scroller=context.scroller;
    let visited=0;
    for(const el of allElements(document.documentElement)) {
      if(++visited>12000)break;
      if(!(el instanceof HTMLElement) || el===scroller || el.contains(scroller))continue;
      const style=getComputedStyle(el);
      if(style.position!=="fixed" && style.position!=="sticky")continue;
      const rect=el.getBoundingClientRect();
      if(rect.width<=0 || rect.height<=0 || style.display==="none" || style.visibility==="hidden")continue;
      const previous=context.tracked.get(el);
      if(spec.sequence===0 || !previous) {context.provisionalCandidates.set(el,{rect,logicalX:spec.logicalX,logicalY:spec.logicalY,represented:style.position==="fixed" || spec.logicalY===0 || (Math.abs(rect.top-(parseFloat(style.top)||0))>0.5)});continue;}
      if(style.position==="sticky" && !previous.represented) {
        context.provisionalCandidates.set(el,{...previous,represented:Math.abs(rect.top-(parseFloat(style.top)||0))>0.5});
      }
      if(previous.represented && !context.hidden.has(el))hideElement(el);
      if(Number(getComputedStyle(el).opacity)!==0) {
        const output={x0:spec.logicalX+rect.left-spec.sourceLeft,y0:spec.logicalY+rect.top-spec.sourceTop,x1:spec.logicalX+rect.right-spec.sourceLeft,y1:spec.logicalY+rect.bottom-spec.sourceTop};
        const required={x0:spec.logicalX,y0:spec.logicalY,x1:spec.logicalX+spec.clientWidth,y1:spec.logicalY+spec.clientHeight};
        if(uncoveredIntersection(output,required,context.acceptedRects || []))throw P.fault("UNSUPPORTED_OCCLUSION","Repeated occlusion blocks required capture pixels.");
      }
    }
    // Reaching the next position means the preceding position was accepted by the worker.

    context.lastPosition=spec;
  }
  function uncoveredIntersection(a,b,covered) {
    let pieces=[{x0:Math.max(a.x0,b.x0),y0:Math.max(a.y0,b.y0),x1:Math.min(a.x1,b.x1),y1:Math.min(a.y1,b.y1)}].filter(r=>r.x1>r.x0 && r.y1>r.y0);
    for(const c of covered)pieces=pieces.flatMap(r=>{
      const x0=Math.max(r.x0,c.x0),y0=Math.max(r.y0,c.y0),x1=Math.min(r.x1,c.x1),y1=Math.min(r.y1,c.y1);
      if(x1<=x0 || y1<=y0)return [r];
      return [{...r,y1:y0},{...r,y0:y1},{x0:r.x0,x1:x0,y0,y1},{x0:x1,x1:r.x1,y0,y1}].filter(p=>p.x1>p.x0 && p.y1>p.y0);
    });
    return pieces.length>0;
  }
  function hideElement(el) {
    if(state.hidden.has(el))return;
    // A removable rule preserves page inline values and active CSS transitions.
    const root=el.getRootNode(),doc=el.ownerDocument,style=doc.createElement("style");
    const token=`cfp-${crypto.randomUUID()}`,previous=el.getAttribute("data-cfp-occluder");
    el.setAttribute("data-cfp-occluder",token);style.setAttribute("data-cfp-capture-style",state.planId);
    style.textContent=`[data-cfp-occluder="${token}"] { opacity:0!important; }`;
    (root.nodeType===9 ? root.head || root.documentElement : root).appendChild(style);
    state.ownedStyles.push(style);state.hidden.set(el,{doc,token,previous});
  }

  function neutralizeFixedBackgrounds() {
    let visited = 0;
    for (const el of allElements(document.documentElement)) {
      if (++visited > 12000) break;
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.backgroundAttachment !== "fixed") continue;

      state.changedStyles.push({
        el,
        property: "background-attachment",
        value: el.style.getPropertyValue("background-attachment"),
        priority: el.style.getPropertyPriority("background-attachment")
      });
      writeOwnedProperty(el,"background-attachment", "scroll");
    }
  }

  async function restore(old = state) {
    if (!old || old.cancelled) return {status:"acknowledged",restoredCount:0,preservedPageChanges:0,failedCount:0,codes:[]};
    old.cancelled = true;
    if (state === old) state = null;
    const summary={status:"acknowledged",restoredCount:0,preservedPageChanges:0,failedCount:0,codes:[]};
    const attempt=(fn,code="STYLE_RESTORE_FAILED")=>{try{fn();summary.restoredCount++;}catch{summary.status="partial";summary.failedCount++;if(!summary.codes.includes(code))summary.codes.push(code);}};
    for(const remove of old.listeners)attempt(remove);
    for(const observer of old.observers)attempt(()=>observer.disconnect());
    attempt(()=>restoreOwnedStyles(old));
    for(const [el,saved] of old.hidden)attempt(()=>{if(el.ownerDocument===saved.doc && el.getAttribute("data-cfp-occluder")===saved.token){if(saved.previous===null)el.removeAttribute("data-cfp-occluder");else el.setAttribute("data-cfp-occluder",saved.previous);}});
    for(const item of old.changedStyles)attempt(()=>restoreProperty(item.el,item.property,item.value,item.priority));
    for(const undo of old.rollback.reverse())attempt(undo);
    old.rollback.length = 0;
    // Restore offsets only after every expanded dimension has been collapsed.
    // Setting scroll offsets forces layout using the restored dimensions.
    for (const undo of old.scrollRollback.reverse()) {
      attempt(undo,"SCROLL_RESTORE_FAILED");
    }
    old.scrollRollback.length = 0;
    summary.codes.sort();
    return summary;
  }

  const ownedWrites = new WeakMap();
  function writeOwnedProperty(el,property,value,priority="important") {
    let records=ownedWrites.get(el);if(!records){records=new Map();ownedWrites.set(el,records);}
    if(!records.has(property))records.set(property,{document:el.ownerDocument,previousValue:el.style.getPropertyValue(property),previousPriority:el.style.getPropertyPriority(property)});
    el.style.setProperty(property,value,priority);const record=records.get(property);record.writtenValue=el.style.getPropertyValue(property);record.writtenPriority=el.style.getPropertyPriority(property);
  }
  function restoreProperty(el, property, value, priority) {
    const records=ownedWrites.get(el),record=records?.get(property);
    if(record) {records.delete(property);if(el.ownerDocument!==record.document || el.style.getPropertyValue(property)!==record.writtenValue || el.style.getPropertyPriority(property)!==record.writtenPriority)return;value=record.previousValue;priority=record.previousPriority;}
    if (!el?.style) return;
    if (value) el.style.setProperty(property, value, priority || "");
    else el.style.removeProperty(property);
  }

  async function settle() {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
    });
    await new Promise(resolve => setTimeout(resolve, 120));
  }
})();
