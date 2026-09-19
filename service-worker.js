const MENU_ID = "capture-full-page";
const OFFSCREEN_URL = "offscreen.html";
const CAPTURE_DELAY_MS = 560;

const activeCaptures = new Set();
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
  startCapture(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "capture-active-tab") return;

  chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (!tab?.id || tab.windowId == null) {
        sendResponse({ ok: false, error: "No active tab is available to capture." });
        return;
      }

      if (!startCapture(tab)) {
        sendResponse({ ok: false, error: "A capture is already running for this tab." });
        return;
      }

      sendResponse({ ok: true });
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
  if (!tab?.id || tab.windowId == null) return false;
  if (activeCaptures.has(tab.id)) return false;

  activeCaptures.add(tab.id);
  captureFullPage(tab)
    .catch(error => console.error("Capture Full Page failed:", error))
    .finally(() => activeCaptures.delete(tab.id));

  return true;
}

async function captureFullPage(tab) {
  const sessionId = crypto.randomUUID();
  const tabId = tab.id;
  let port = null;
  let rpc = null;
  let prepared = false;

  try {
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

    let frameCount = 0;
    let position = prep.position;

    while (position) {
      const dataUrl = await captureVisible(tab.windowId);

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
      position = next.position;

      // captureVisibleTab is limited to two calls per second. FireShot also
      // allows time for the page/compositor to settle between scrolls.
      await sleep(CAPTURE_DELAY_MS);
    }

    if (frameCount === 0) throw new Error("No screenshot frames were captured.");

    const finished = await chrome.runtime.sendMessage({
      target: "cfp-offscreen",
      type: "finish",
      sessionId
    });
    throwIfOffscreenError(finished);

    if (!finished?.url) throw new Error("Could not encode the screenshot.");

    const downloadId = await chrome.downloads.download({
      url: finished.url,
      filename: makeFilename(tab),
      saveAs: false,
      conflictAction: "uniquify"
    });

    if (downloadId == null) throw new Error("Chrome did not start the download.");

    const listener = delta => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete" || delta.state.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener);
        chrome.runtime.sendMessage({
          target: "cfp-offscreen",
          type: "revoke",
          url: finished.url
        }).catch(() => {});
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  } finally {
    if (prepared && rpc) {
      await rpc.call("restore").catch(() => {});
    }
    try { port?.disconnect(); } catch {}
    rpc?.close();
  }
}

function createPortRPC(port) {
  let seq = 0;
  let disconnected = false;
  const pending = new Map();

  const onMessage = message => {
    if (!message || message.replyTo == null) return;
    const item = pending.get(message.replyTo);
    if (!item) return;
    pending.delete(message.replyTo);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message.result);
  };

  const onDisconnect = () => {
    disconnected = true;
    const err = new Error("The page capture connection was closed.");
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);

  return {
    call(method, payload = null) {
      if (disconnected) return Promise.reject(new Error("Capture connection is closed."));
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ id, method, payload });
      });
    },
    close() {
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      const err = new Error("Capture RPC closed.");
      for (const { reject } of pending.values()) reject(err);
      pending.clear();
    }
  };
}

async function captureVisible(windowId) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      if (dataUrl) return dataUrl;
    } catch (error) {
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
