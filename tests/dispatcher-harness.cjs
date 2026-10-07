const fs = require("node:fs"),
  vm = require("node:vm"),
  { randomUUID } = require("node:crypto");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function event() {
  const listeners = new Set();
  return {
    addListener: (f) => listeners.add(f),
    removeListener: (f) => listeners.delete(f),
    emit(...args) {
      for (const f of [...listeners]) f(...args);
    },
    listeners,
  };
}
function protocol(c) {
  vm.runInContext(fs.readFileSync("capture-protocol.js", "utf8"), c);
  return c.__cfpProtocol;
}
function scope() {
  return {
    operationId: randomUUID(),
    sessionId: randomUUID(),
    owner: randomUUID(),
  };
}
function prep(
  identity = scope(),
  {
    width = 200,
    height = 2000,
    viewportWidth = 200,
    viewportHeight = 180,
  } = {},
) {
  return {
    protocolVersion: 1,
    operationId: identity.operationId,
    sessionId: identity.sessionId,
    owner: identity.owner,
    planId: randomUUID(),
    documentNonce: randomUUID(),
    strategy: "document",
    captureScope: "full-page",
    windowWidth: viewportWidth,
    windowHeight: viewportHeight,
    layoutWidth: viewportWidth,
    layoutHeight: viewportHeight,
    targetWidth: width,
    targetHeight: height,
    sourceLeft: 0,
    sourceTop: 0,
    clientWidth: viewportWidth,
    clientHeight: viewportHeight,
    direction: "ltr",
    writingMode: "horizontal-tb",
    physicalScrollWidth: width,
    physicalScrollHeight: height,
    devicePixelRatio: 1,
    visualViewport: null,
    geometryGeneration: 0,
    warnings: [],
  };
}
function snapshot(prep, spec, changes = {}) {
  const result = {};
  for (const key of [
    "protocolVersion",
    "operationId",
    "sessionId",
    "owner",
    "planId",
    "documentNonce",
    "geometryGeneration",
    "windowWidth",
    "windowHeight",
    "layoutWidth",
    "layoutHeight",
    "physicalScrollWidth",
    "physicalScrollHeight",
    "sourceLeft",
    "sourceTop",
    "clientWidth",
    "clientHeight",
    "devicePixelRatio",
    "visualViewport",
    "warnings",
  ])
    result[key] = prep[key];
  return {
    ...result,
    sequence: spec.sequence,
    scrollEpoch: 0,
    geometryEpoch: 0,
    nativeScrollLeft: spec.logicalX,
    nativeScrollTop: spec.logicalY,
    logicalX: spec.logicalX,
    logicalY: spec.logicalY,
    ...changes,
  };
}
function manifest(target = "chrome") {
  return target === "firefox"
    ? {
        background: {
          scripts: ["capture-protocol.js", "offscreen.js", "service-worker.js"],
        },
        browser_specific_settings: {
          gecko: { id: "capture-full-page@ohokthisisfine.github" },
        },
      }
    : {
        background: { service_worker: "service-worker.js" },
        permissions: ["offscreen"],
      };
}
function compositor(options = {}) {
  const counts = {
    draw: 0,
    convert: 0,
    closed: 0,
    urls: 0,
    fetch: 0,
    revoked: [],
  };
  const clock = options.clock || { now: 0 },
    timers = new Map();
  let timerId = 0;
  const runtime = {
    id: "synthetic-extension",
    getURL: (p) => "chrome-extension://synthetic-extension/" + p,
    getManifest: () => manifest(options.target),
    onMessage: event(),
    sendMessage: async (m) => ({ ...m, ok: true, queued: true }),
  };
  const c = vm.createContext({
    chrome: { runtime },
    crypto: { randomUUID },
    console,
    Date: class extends Date {
      static now() {
        return clock.now;
      }
    },
    performance: { now: () => clock.now },
    setTimeout(fn, ms) {
      const id = ++timerId;
      if (ms === 0) queueMicrotask(fn);
      else timers.set(id, { fn, at: clock.now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    TextEncoder,
    Uint8Array,
    Uint32Array,
    DataView,
    Blob,
    queueMicrotask,
    AbortController,
    ReadableStream,
    Response,
    CompressionStream,
    URL: {
      createObjectURL() {
        counts.urls++;
        return "blob:synthetic-" + counts.urls;
      },
      revokeObjectURL(url) {
        counts.revoked.push(url);
      },
    },
    fetch: async () => {
      counts.fetch++;
      return { ok: true, blob: async () => new Blob(["synthetic input"]) };
    },
    createImageBitmap: async (blob) => ({
      width: blob.syntheticWidth || options.bitmapWidth || 200,
      height: blob.syntheticHeight || options.bitmapHeight || 180,
      close() {
        counts.closed++;
      },
    }),
  });
  c.OffscreenCanvas = class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return {
        fillRect() {},
        drawImage() {
          counts.draw++;
        },
        getImageData: (x, y, w, h) => ({ data: new Uint8Array(w * h * 4) }),
      };
    }
    async convertToBlob() {
      counts.convert++;
      const blob = new Blob();
      blob.syntheticWidth = this.width;
      blob.syntheticHeight = this.height;
      return blob;
    }
  };
  const P = protocol(c);
  vm.runInContext(
    fs.readFileSync("offscreen.js", "utf8") +
      "\nglobalThis.api={sessions,resources,outputRecords,statusSnapshot,reserveBytes,addFrame,createSession,validateTileCoverage,encodePngChunk,encodePngFromTiles,collectIdatChunks,makeScanlineSource,finalizeTile,getTile,finalizeTilesBefore};",
    c,
  );
  const envelope = (identity, type, payload = {}) => {
    const extra =
      type === "start"
        ? {
            captureContext: {
              targetBrowser: options.target || "chrome",
              tabId: 0,
              windowId: 0,
              incognito: false,
            },
            deadlines: {
              operationExpiresAt: clock.now + 900000,
              captureExpiresAt: clock.now + 600000,
              encodeBudgetMs: 300000,
            },
            budget: {
              operationEnvelopeBytes: 512 * 1024 * 1024,
              maxOutputBytes: 128 * 1024 * 1024,
              observedLedgerRevision: 0,
            },
          }
        : type === "abort"
          ? { reason: "USER_CANCELLED" }
          : {};
    return {
      target: "cfp-offscreen",
      protocolVersion: 1,
      requestId: randomUUID(),
      type,
      ...(["status", "download-list"].includes(type)
        ? { requesterOwner: identity.requesterOwner }
        : {
            operationId: identity.operationId,
            sessionId: identity.sessionId,
            owner: identity.owner,
          }),
      ...extra,
      ...payload,
    };
  };
  const dispatch = (message) =>
    options.target === "firefox"
      ? c.__cfpCompositorHandle(message)
      : new Promise((resolve) =>
          runtime.onMessage.emit(
            message,
            { id: runtime.id, url: runtime.getURL("service-worker.js") },
            resolve,
          ),
        );
  const request = (identity, type, payload = {}) =>
    dispatch(envelope(identity, type, payload));
  const syntheticEncoder = () =>
    vm.runInContext(
      'encodePngFromTiles=async s=>{const blob=new Blob(["synthetic encoded output"]);s.encodedBlobPendingHandoff=reserveBytes(s,"pendingOutputBlob",blob,blob.size);return blob;}',
      c,
    );
  const frame = (p, spec, changes = {}) =>
    request(p, "frame", {
      spec,
      preSnapshot: snapshot(p, spec),
      postSnapshot: snapshot(p, spec),
      dataUrl: "data:image/png;base64,AA==",
      ...changes,
    });
  return {
    c,
    P,
    api: c.api,
    request,
    envelope,
    dispatch,
    frame,
    counts,
    runtime,
    syntheticEncoder,
    compositorTimers: timers,
    clock,
    advance(ms) {
      clock.now += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= clock.now) {
          timers.delete(id);
          timer.fn();
        }
    },
  };
}
function content() {
  const waits = [],
    root = {
      scrollLeft: 17,
      scrollTop: 23,
      scrollWidth: 200,
      scrollHeight: 2000,
      clientWidth: 200,
      clientHeight: 180,
    };
  const runtime = { id: "synthetic-extension", onConnect: event() };
  const c = vm.createContext({
    crypto: { randomUUID },
    getComputedStyle: () => ({
      boxSizing: "content-box",
      direction: "ltr",
      writingMode: "horizontal-tb",
      transform: "none",
    }),
    HTMLIFrameElement: class {},
    window: { innerWidth: 200, innerHeight: 180, devicePixelRatio: 1 },
    document: { scrollingElement: root, documentElement: root },
    chrome: { runtime },
    console,
    setTimeout,
    clearTimeout,
  });
  protocol(c);
  let source = fs.readFileSync("content.js", "utf8").replace(
    /\}\)\(\);\s*$/,
    `globalThis.api={prepare,moveTo,snapshot,acceptFrame,restore,getState:()=>state,setDetector:fn=>detectPrimaryScroller=fn,expandFrames:expandSameOriginIframes,writeOwnedProperty,restoreProperty};
 allElements=function*(){yield* globalThis.elements;};detectPrimaryScroller=()=>document.scrollingElement;
 installCaptureStyles=()=>[];discoverCaptureRoots=()=>{};
 expandSameOriginIframes=()=>({count:0,blocked:0,restore(){}});
 neutralizeFixedBackgrounds=snapshotVisibleElements=suppressViewportAnchoredElements=()=>{};
 settle=async()=>{await globalThis.wait();};})();`,
  );
  c.wait = () => {
    const d = deferred();
    waits.push(d);
    return d.promise;
  };
  c.elements = [];
  c.window.top = c.window;
  vm.runInContext(source, c);
  return { api: c.api, root, waits, c, runtime };
}
function worker(options = {}) {
  const clock = { now: 0 };
  const captureTimes = [],
    frames = [],
    downloads = [],
    items = [],
    injections = [];
  const downloadEntered = deferred(),
    captureEntered = deferred();
  const comp = compositor({ ...options, clock }),
    identity = scope();
  let pagePrep,
    commanded,
    acquisitions = 0,
    captureCalls = 0;
  const contentPort = {
    onMessage: event(),
    onDisconnect: event(),
    disconnect() {
      this.onDisconnect.emit();
    },
    postMessage(message) {
      let result;
      if (message.method === "prepare") {
        pagePrep = prep(message, options);
        result = pagePrep;
      } else if (message.method === "position") {
        commanded = message.payload.spec;
        result = snapshot(pagePrep, commanded);
      } else if (message.method === "snapshot") {
        result = snapshot(pagePrep, commanded);
        if (options.snapshot)
          result = options.snapshot(result, {
            acquisitions: acquisitions++,
            captureCalls,
            commanded,
          });
      } else if (message.method === "accept-frame")
        result = { acceptedSequence: message.payload.spec.sequence };
      else result = { acknowledged: true, partial: false, failed: [] };
      queueMicrotask(() =>
        this.onMessage.emit({
          replyTo: message.id,
          protocolVersion: 1,
          operationId: message.operationId,
          sessionId: message.sessionId,
          owner: message.owner,
          result,
        }),
      );
    },
  };
  const tab = {
    id: 0,
    windowId: 0,
    active: true,
    incognito: false,
    url: "https://synthetic.invalid/",
    title: "synthetic",
  };
  const runtime = {
    id: "synthetic-extension",
    getURL: (p) => "chrome-extension://synthetic-extension/" + p,
    getManifest: () => manifest(options.target),
    onInstalled: event(),
    onStartup: event(),
    onMessage: event(),
    sendMessage: async (message) => {
      if (message.type === "frame") frames.push(message);
      return comp.dispatch(message);
    },
  };
  const timers = new Map();
  let timerId = 0;
  const c = vm.createContext({
    crypto: { randomUUID },
    console,
    URL,
    TextEncoder,
    AbortController,
    performance: { now: () => clock.now },
    Date: class extends Date {
      static now() {
        return clock.now;
      }
    },
    queueMicrotask,
    chrome: {
      runtime,
      contextMenus: { onClicked: event(), removeAll() {}, create() {} },
      tabs: {
        onActivated: event(),
        onRemoved: event(),
        onUpdated: event(),
        onDetached: event(),
        onAttached: event(),
        get: async () => tab,
        query: async () => [tab],
        connect: () => contentPort,
        captureVisibleTab: async () => {
          captureTimes.push(clock.now);
          captureCalls++;
          captureEntered.resolve(captureCalls);
          if (options.capture) await options.capture(captureCalls);
          return "data:image/png;base64,AA==";
        },
      },
      scripting: {
        executeScript: async (item) => {
          injections.push(item);
        },
      },
      downloads: {
        download: (item) => {
          downloads.push(item);
          downloadEntered.resolve(item);
          return options.download ? options.download(item) : Promise.resolve(0);
        },
        search: (query) =>
          options.search
            ? options.search(query)
            : Promise.resolve(
                items.filter((item) =>
                  query.id === undefined
                    ? item.url === query.url
                    : item.id === query.id,
                ),
              ),
        onCreated: event(),
        onChanged: event(),
      },
      offscreen: {
        createDocument: async () => {},
        closeDocument: async () => {},
      },
    },
    setTimeout(fn, ms) {
      const id = ++timerId;
      if (ms <= 560) {
        clock.now += ms;
        queueMicrotask(fn);
      } else timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  runtime.getContexts = async () => [{ contextType: "OFFSCREEN_DOCUMENT" }];
  if (options.target === "firefox") {
    c.browser = { downloads: c.chrome.downloads };
    c.__cfpCompositorHandle = comp.c.__cfpCompositorHandle;
    c.__cfpRegisterWorkerNotifications =
      comp.c.__cfpRegisterWorkerNotifications;
  }
  protocol(c);
  vm.runInContext(
    fs.readFileSync("service-worker.js", "utf8") +
      "\nglobalThis.api={captureFullPage,createPortRPC,callCompositor,captureVisible,startCapture,getActive:()=>activeCapture,getBrowserTarget,makeDownloadOptions,makeFilename,invokeDownloadOnce,observeDownloadInitiation,reconcileOwnedDownloads,bindContentPort,closeContentBinding,latchSourceLoss,liveOperations,pendingWorkerPixelProducers};",
    c,
  );
  return {
    ...comp,
    workerContext: c,
    workerApi: c.api,
    contentPort,
    captureTimes,
    frames,
    downloads,
    downloadEntered,
    captureEntered,
    items,
    injections,
    timers,
    tab,
    run: () => c.api.captureFullPage(tab, () => {}),
  };
}
module.exports = {
  deferred,
  event,
  protocol,
  scope,
  prep,
  snapshot,
  compositor,
  content,
  worker,
};
