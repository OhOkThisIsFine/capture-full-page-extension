if (!globalThis.__cfpProtocol && typeof importScripts === "function") importScripts("capture-protocol.js");
const WP = globalThis.__cfpProtocol;
if (!WP || WP.protocolVersion!==1) throw new Error("Capture protocol unavailable.");
const MENU_ID = "capture-full-page";
const OFFSCREEN_URL = "offscreen.html";
const CAPTURE_DELAY_MS = 560;
const MAX_CAPTURE_FRAMES = 20000;
const RPC_TIMEOUT_MS = 15000;
const compositorOwner = crypto.randomUUID();
let lastCaptureInvocationStart=-Infinity;
let compositorContext=null;

let activeCapture = null;
let offscreenCreation = null;

function installMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Capture full page",
      contexts: ["all"]
    });
  });
}

chrome.runtime.onInstalled.addListener(installMenu);
chrome.runtime.onStartup.addListener(installMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const initialized = startCapture(tab);
  initialized?.catch(() => {});
});

chrome.tabs.onActivated.addListener(activeInfo => {
  if (!activeCapture) return;
  if (activeInfo.windowId !== activeCapture.windowId) return;
  if (activeInfo.tabId === activeCapture.tabId) return;

  activeCapture.cancelReason =
    "Capture stopped because another tab became active in the capture window.";
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "cfp-worker" && message?.type === "offscreen-idle") {
    const trusted=sender?.id===chrome.runtime.id && !sender.tab && sender.url===chrome.runtime.getURL(OFFSCREEN_URL);
    if(!trusted || message.protocolVersion!==1 || !WP.uuid(message.requestId) || !compositorContext || message.contextId!==compositorContext.contextId || message.lifecycleGeneration!==compositorContext.lifecycleGeneration)return;
    closeOffscreenIfIdle().catch(()=>{});
    sendResponse({...message,ok:true,queued:true});return;
  }

  if (message?.type !== "capture-active-tab") return;

  chrome.tabs.query({ active: true, currentWindow: true })
    .then(async ([tab]) => {
      if (!Number.isSafeInteger(tab?.id) || tab.id<0 || tab.windowId == null) {
        sendResponse({ ok: false, error: "No active tab is available to capture." });
        return;
      }

      const initialized = startCapture(tab);
      if (!initialized) {
        sendResponse({ ok: false, error: "A capture is already running." });
        return;
      }

      try {
        await initialized;
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.message || "Could not initialize the capture."
        });
      }
    })
    .catch(error => {
      sendResponse({
        ok: false,
        error: error?.message || "Could not start the capture."
      });
    });

  return true;
});

function startCapture(tab) {
  if (!Number.isSafeInteger(tab?.id) || tab.id<0 || !Number.isSafeInteger(tab.windowId) || tab.windowId<0) return null;
  if (activeCapture) return null;

  let resolveInitialized;
  let rejectInitialized;
  const initialized = new Promise((resolve, reject) => {
    resolveInitialized = resolve;
    rejectInitialized = reject;
  });

  const capture = {
    tabId: tab.id,
    windowId: tab.windowId,
    initialized: false,
    cancelReason: null,
    resolveInitialized,
    rejectInitialized,
    run: null
  };

  activeCapture = capture;

  const markInitialized = () => {
    if (capture.initialized) return;
    capture.initialized = true;
    capture.resolveInitialized();
  };

  capture.run = captureFullPage(tab, markInitialized)
    .catch(error => {
      if (!capture.initialized) {
        capture.initialized = true;
        capture.rejectInitialized(error);
      }
      console.error("Capture Full Page failed:", error);
    })
    .finally(() => {
      if (activeCapture === capture) activeCapture = null;
      closeOffscreenIfIdle().catch(() => {});
    });

  return initialized;
}

async function captureFullPage(tab, markInitialized) {
  const sessionId = crypto.randomUUID();
  const scope={operationId:crypto.randomUUID(),sessionId,owner:compositorOwner,expiresAt:Date.now()+5*60*1000};
  let outputScope=null;
  const tabId = tab.id;
  const windowId = tab.windowId;
  let port = null;
  let rpc = null;
  let prepared = false;
  let offscreenStarted = false;
  let finishedUrl = null;
  let downloadOwnsUrl = false;

  try {
    await assertOriginalTabActive(tabId, windowId);

    await chrome.scripting.executeScript({
      target: {tabId,frameIds:[0]},
      files: ["capture-protocol.js", "content.js"]
    });

    port = chrome.tabs.connect(tabId, {name:`cfp:${sessionId}`,frameId:0});
    rpc = createPortRPC(port,scope);

    const prep = await rpc.call("prepare",{strategy:"auto",prepareExpiresAt:Date.now()+WP.MAX_PREPARE_MS,operationExpiresAt:scope.expiresAt});
    prepared = true;

    if (!prep || prep.windowWidth <= 0 || prep.windowHeight <= 0 ||
        prep.targetWidth <= 0 || prep.targetHeight <= 0) {
      throw new Error("Could not measure this page.");
    }

    await ensureOffscreen();
    offscreenStarted = true;
    const plan=WP.makeTraversal(prep);
    if(plan.estimatedFrames>MAX_CAPTURE_FRAMES)throw WP.fault("FRAME_LIMIT","Capture exceeds frame limit.");
    const start=await callCompositor(scope,"start",{prep});
    throwIfOffscreenError(start);
    markInitialized();
    let frameCount=0,previousAcceptedSpec=null,spec;
    while((spec=WP.nextFrameSpec(plan,previousAcceptedSpec))) {
      checkOperation(scope);
      let acquired=null;
      const frameBudget={remaining:5};
      for(let acquisition=0;acquisition<3;acquisition++) {
        await assertOriginalTabActive(tabId,windowId);
        const positioned=await rpc.call("position",{spec});
        const positionCheck=WP.validateSnapshot(plan,spec,positioned);
        if(!positionCheck.ok && !positionCheck.retryable)throw WP.fault(positionCheck.code,"Position snapshot rejected.");
        const preSnapshot=await rpc.call("snapshot",{spec});
        const preCheck=WP.validateSnapshot(plan,spec,preSnapshot);
        if(!preCheck.ok){if(preCheck.retryable && acquisition<2)continue;throw WP.fault(preCheck.code,"Pre-capture snapshot rejected.");}
        const dataUrl=await captureVisible(tabId,windowId,scope,frameBudget);
        await assertOriginalTabActive(tabId,windowId);checkOperation(scope);
        const postSnapshot=await rpc.call("snapshot",{spec});
        const validation=WP.snapshotPair(plan,spec,preSnapshot,postSnapshot);
        if(!validation.ok){if(validation.retryable && acquisition<2)continue;throw WP.fault(validation.code,"Capture geometry changed.");}
        acquired={spec,preSnapshot,postSnapshot,dataUrl};break;
      }
      if(!acquired)throw WP.fault("SCROLL_CHANGED","Capture scroll retries exhausted.");
      const result=await callCompositor(scope,"frame",acquired); // timeout is ambiguous: never replay
      throwIfOffscreenError(result);
      if(result.acceptedSequence!==spec.sequence)throw WP.fault("FRAME_SEQUENCE_MISMATCH","Unexpected accepted frame sequence.");
      if(!WP.sameRect(result.rect,WP.frameRect(prep,spec,result.bitmapWidth,result.bitmapHeight)) || !WP.sameRect(result.novelRect,WP.novelFrameRect(plan,spec,result.bitmapWidth,result.bitmapHeight)))throw WP.fault("INVALID_GEOMETRY");
      frameCount++;
      const accepted=await rpc.call("accept-frame",{spec,bitmapWidth:result.bitmapWidth,bitmapHeight:result.bitmapHeight,rect:result.rect,novelRect:result.novelRect});
      if(accepted.acceptedSequence!==spec.sequence)throw WP.fault("FRAME_SEQUENCE_MISMATCH");
      previousAcceptedSpec=spec;
    }

    if (frameCount === 0) throw new Error("No screenshot frames were captured.");

    // The page no longer needs to remain expanded/scrolled once every viewport
    // has been captured. Restore it before the potentially expensive PNG encode.
    try {
      await rpc.call("restore",{reason:"success"});
      prepared = false;
    } catch (error) {
      console.warn("Capture Full Page could not restore the page early:", error);
    }

    const intentId=crypto.randomUUID();
    const finished=await callCompositor(scope,"finish",{intentId});
    throwIfOffscreenError(finished);
    outputScope={...scope,intentId};
    if (!finished?.url) throw new Error("Could not encode the screenshot.");
    finishedUrl = finished.url;

    const downloadId = await chrome.downloads.download({
      url: finishedUrl,
      filename: makeFilename(tab),
      saveAs: false,
      conflictAction: "uniquify"
    });

    if (downloadId == null) throw new Error("Chrome did not start the download.");

    downloadOwnsUrl = true;
    const listener = delta => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete" || delta.state.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener);
        revokeOffscreenUrl(outputScope,finishedUrl).catch(() => {});
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  } finally {
    if (prepared && rpc) {
      await rpc.call("restore",{reason:"failure"}).catch(() => {});
    }

    try { port?.disconnect(); } catch {}
    rpc?.close();

    if (offscreenStarted && !finishedUrl) {
      await abortOffscreenSession(scope).catch(() => {});
    }

    if (finishedUrl && !downloadOwnsUrl) {
      await revokeOffscreenUrl(outputScope,finishedUrl).catch(() => {});
    }
  }
}

function createPortRPC(port,scope) {
  let seq = 0;
  let disconnected = false;
  const pending = new Map();

  const settlePending = (messageId, action) => {
    const item = pending.get(messageId);
    if (!item) return null;
    pending.delete(messageId);
    clearTimeout(item.timer);
    action(item);
    return item;
  };

  const onMessage = message => {
    if (!message || message.protocolVersion!==1 || ["operationId","sessionId","owner"].some(k=>message[k]!==scope[k]) || !Number.isSafeInteger(message.replyTo)) return;
    settlePending(message.replyTo, item => {
      if (message.error) item.reject(WP.fault(message.code || "CAPTURE_FAILED",message.error));
      else item.resolve(message.result);
    });
  };

  const onDisconnect = () => {
    disconnected = true;
    const err = new Error("The page capture connection was closed.");
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(err);
    }
    pending.clear();
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);

  return {
    call(method, payload = null) {
      if (disconnected) return Promise.reject(new Error("Capture connection is closed."));

      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const item = pending.get(id);
          if (!item) return;
          pending.delete(id);
          reject(new Error(`Capture command "${method}" timed out.`));
        }, RPC_TIMEOUT_MS);

        pending.set(id, { resolve, reject, timer });
        try{port.postMessage({id,method,payload,protocolVersion:1,operationId:scope.operationId,sessionId:scope.sessionId,owner:scope.owner});}
        catch(error){settlePending(id,item=>item.reject(error));}
      });
    },
    close() {
      disconnected=true;
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      const err = new Error("Capture RPC closed.");
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(err);
      }
      pending.clear();
    }
  };
}

async function assertOriginalTabActive(tabId, windowId) {
  if (activeCapture?.tabId === tabId && activeCapture.cancelReason) {
    throw new Error(activeCapture.cancelReason);
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab || tab.windowId !== windowId || !tab.active) {
    throw new Error(
      "Capture stopped because the original tab is no longer active in its window."
    );
  }

  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (!activeTab || activeTab.id !== tabId) {
    throw new Error(
      "Capture stopped because the original tab is no longer active in its window."
    );
  }
}

function checkOperation(scope) {
  if(activeCapture?.cancelReason)throw WP.fault("CANCELLED",activeCapture.cancelReason);
  if(Date.now()>=scope.expiresAt)throw WP.fault("DEADLINE_EXCEEDED","Capture deadline exceeded.");
}
async function captureVisible(tabId, windowId,scope,frameBudget={remaining:5}) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    checkOperation(scope);
    await assertOriginalTabActive(tabId, windowId);
    const delay=Math.max(0,lastCaptureInvocationStart+CAPTURE_DELAY_MS-Date.now());
    if(delay)await sleep(delay);
    checkOperation(scope);await assertOriginalTabActive(tabId,windowId);
    if(frameBudget.remaining<=0)throw WP.fault("RESOURCE_LIMIT");
    frameBudget.remaining--;lastCaptureInvocationStart=Date.now();
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      await assertOriginalTabActive(tabId, windowId);
      if (dataUrl) return dataUrl;
    } catch (error) {
      if (activeCapture?.cancelReason) {
        throw new Error(activeCapture.cancelReason);
      }
      lastError = error;
    }

    checkOperation(scope);
  }

  throw lastError || new Error("captureVisibleTab failed.");
}

function hasSharedCompositor() {
  return typeof globalThis.__cfpCompositorHandle === "function";
}

async function callCompositor(scope,type,payload={}) {
  const context=type==="status";
  const message={target:"cfp-offscreen",type,protocolVersion:1,requestId:crypto.randomUUID(),
    ...(context ? {requesterOwner:compositorOwner} : {operationId:scope.operationId,sessionId:scope.sessionId,owner:scope.owner}),...payload};
  let timer;
  try {
    const operation=hasSharedCompositor() ? globalThis.__cfpCompositorHandle(message) : chrome.runtime.sendMessage(message);
    const result=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(WP.fault("TRANSPORT_FAILED","Compositor operation timed out.")),type==="finish"?10*60*1000:60*1000);})]);
    const fields=context ? ["target","type","protocolVersion","requestId","requesterOwner"] : ["target","type","protocolVersion","requestId","operationId","sessionId","owner"];
    if(message.intentId!==undefined)fields.push("intentId");
    if(!result || fields.some(k=>message[k]!==result[k]))throw WP.fault("INVALID_RESPONSE","Compositor response identity mismatch.");
    throwIfOffscreenError(result);
    if(context){if(!WP.uuid(result.contextId) || !Number.isSafeInteger(result.lifecycleGeneration) || result.lifecycleGeneration<0)throw WP.fault("INVALID_RESPONSE","Invalid compositor context.");compositorContext={contextId:result.contextId,lifecycleGeneration:result.lifecycleGeneration};}
    return result;
  } finally {clearTimeout(timer);}
}

async function ensureOffscreen() {
  // Firefox MV3 runs offscreen.js in its background document, where the
  // compositor is directly callable. Chromium uses a separate offscreen page.
  if (hasSharedCompositor()) return;

  if (!chrome.offscreen?.createDocument || !chrome.runtime.getContexts) {
    throw new Error("This browser does not provide a supported capture compositor.");
  }

  const documentUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  if (contexts.length) return;

  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["BLOBS"],
      justification: "Assemble captured viewport tiles and encode a PNG."
    }).finally(() => {
      offscreenCreation = null;
    });
  }
  await offscreenCreation;
}

async function abortOffscreenSession(scope) {return callCompositor(scope,"abort",{reason:"capture-failed"});}
async function revokeOffscreenUrl(scope,url) {
  if(!url)return;
  const result=await callCompositor(scope,"revoke",{url,intentId:scope.intentId});
  if(result.idle && !activeCapture)await closeOffscreenIfIdle();
}

async function closeOffscreenIfIdle() {
  // Firefox's compositor lives in the background document itself; there is no
  // separate document to close.
  if (hasSharedCompositor()) return;
  if (activeCapture || offscreenCreation || !chrome.offscreen?.closeDocument) return;

  const documentUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  if (!contexts.length || activeCapture) return;

  let status;
  try {
    status = await callCompositor(null,"status");
  } catch {
    return;
  }

  if (!status?.idle || activeCapture) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

function throwIfOffscreenError(result) {
  if(!result || result.ok!==true)throw WP.fault(result?.code || "CAPTURE_FAILED",result?.error || "Compositor request failed.");
}

function makeFilename(tab) {
  let host = "page";
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, "") || "page";
  } catch {}

  const title = (tab.title || "page").trim();
  const d = new Date();
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

  const clean = text => text
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 90);

  return `${stamp}_${clean(host)}_${clean(title)}.png`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
