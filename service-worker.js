const MENU_ID = "capture-full-page";
const OFFSCREEN_URL = "offscreen.html";
const CAPTURE_DELAY_MS = 560;
const MAX_CAPTURE_FRAMES = 20000;
const RPC_TIMEOUT_MS = 15000;

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
    closeOffscreenIfIdle().catch(() => {});
    return;
  }

  if (message?.type !== "capture-active-tab") return;

  chrome.tabs.query({ active: true, currentWindow: true })
    .then(async ([tab]) => {
      if (!tab?.id || tab.windowId == null) {
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
  if (!tab?.id || tab.windowId == null) return null;
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
      target: { tabId },
      files: ["content.js"]
    });

    port = chrome.tabs.connect(tabId, { name: `cfp:${sessionId}` });
    rpc = createPortRPC(port);

    const prep = await rpc.call("prepare");
    prepared = true;

    if (!prep || prep.windowWidth <= 0 || prep.windowHeight <= 0 ||
        prep.targetWidth <= 0 || prep.targetHeight <= 0) {
      throw new Error("Could not measure this page.");
    }

    await ensureOffscreen();
    const start = await chrome.runtime.sendMessage({
      target: "cfp-offscreen",
      type: "start",
      sessionId,
      prep
    });
    throwIfOffscreenError(start);
    offscreenStarted = true;

    markInitialized();

    let frameCount = 0;
    let position = prep.position;
    let previousPositionKey = null;

    while (position) {
      if (frameCount >= MAX_CAPTURE_FRAMES) {
        throw new Error(
          `Capture exceeded the safety limit of ${MAX_CAPTURE_FRAMES} frames.`
        );
      }

      const positionKey = [
        position.logicalX,
        position.logicalY,
        position.sourceLeft,
        position.sourceTop
      ].join(":");

      if (positionKey === previousPositionKey) {
        throw new Error("Page scrolling stopped making progress during capture.");
      }
      previousPositionKey = positionKey;

      const dataUrl = await captureVisible(tabId, windowId);

      const result = await chrome.runtime.sendMessage({
        target: "cfp-offscreen",
        type: "frame",
        sessionId,
        dataUrl,
        position,
        firstFrame: frameCount === 0
      });
      throwIfOffscreenError(result);

      frameCount += 1;

      const next = await rpc.call("advance");
      if (next.done) break;
      if (!next.position) {
        throw new Error("The page did not provide the next capture position.");
      }
      position = next.position;

      // captureVisibleTab is limited to two calls per second. Allow the page and
      // compositor to settle between scrolls as well.
      await sleep(CAPTURE_DELAY_MS);
    }

    if (frameCount === 0) throw new Error("No screenshot frames were captured.");

    // The page no longer needs to remain expanded/scrolled once every viewport
    // has been captured. Restore it before the potentially expensive PNG encode.
    try {
      await rpc.call("restore");
      prepared = false;
    } catch (error) {
      console.warn("Capture Full Page could not restore the page early:", error);
    }

    const finished = await chrome.runtime.sendMessage({
      target: "cfp-offscreen",
      type: "finish",
      sessionId
    });
    throwIfOffscreenError(finished);

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
        revokeOffscreenUrl(finishedUrl).catch(() => {});
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  } finally {
    if (prepared && rpc) {
      await rpc.call("restore").catch(() => {});
    }

    try { port?.disconnect(); } catch {}
    rpc?.close();

    if (offscreenStarted && !finishedUrl) {
      await abortOffscreenSession(sessionId).catch(() => {});
    }

    if (finishedUrl && !downloadOwnsUrl) {
      await revokeOffscreenUrl(finishedUrl).catch(() => {});
    }
  }
}

function createPortRPC(port) {
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
    if (!message || message.replyTo == null) return;
    settlePending(message.replyTo, item => {
      if (message.error) item.reject(new Error(message.error));
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
        port.postMessage({ id, method, payload });
      });
    },
    close() {
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

async function captureVisible(tabId, windowId) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assertOriginalTabActive(tabId, windowId);

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      await assertOriginalTabActive(tabId, windowId);
      if (dataUrl) return dataUrl;
    } catch (error) {
      if (activeCapture?.cancelReason) throw error;
      lastError = error;
    }

    await sleep(520);
  }

  throw lastError || new Error("captureVisibleTab failed.");
}

async function ensureOffscreen() {
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

async function abortOffscreenSession(sessionId) {
  const result = await chrome.runtime.sendMessage({
    target: "cfp-offscreen",
    type: "abort",
    sessionId
  });
  throwIfOffscreenError(result);
}

async function revokeOffscreenUrl(url) {
  if (!url) return;
  const result = await chrome.runtime.sendMessage({
    target: "cfp-offscreen",
    type: "revoke",
    url
  });
  throwIfOffscreenError(result);

  if (result?.idle && !activeCapture) {
    await closeOffscreenIfIdle();
  }
}

async function closeOffscreenIfIdle() {
  if (activeCapture || offscreenCreation) return;

  const documentUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  if (!contexts.length || activeCapture) return;

  let status;
  try {
    status = await chrome.runtime.sendMessage({
      target: "cfp-offscreen",
      type: "status"
    });
  } catch {
    return;
  }

  if (!status?.idle || activeCapture) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

function throwIfOffscreenError(result) {
  if (result?.error) throw new Error(result.error);
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
