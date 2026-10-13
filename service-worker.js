if (!globalThis.__cfpProtocol && typeof importScripts === "function")
  importScripts("capture-protocol.js");
const WP = globalThis.__cfpProtocol;
if (!WP || WP.protocolVersion !== 1)
  throw new Error("Capture protocol unavailable.");
const MENU_ID = "capture-full-page";
const OFFSCREEN_URL = "offscreen.html";
const CAPTURE_DELAY_MS = 560;
const MAX_CAPTURE_FRAMES = 20000;
const RPC_TIMEOUT_MS = 15000;
const compositorOwner = crypto.randomUUID();
let lastCaptureInvocationStart = -Infinity;
let compositorContext = null;

let activeCapture = null;
let offscreenCreation = null;
let offscreenClosing = null;

function installMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Capture full page",
      contexts: ["all"],
    });
  });
}

chrome.runtime.onInstalled.addListener(installMenu);
chrome.runtime.onStartup.addListener(installMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const handle = startCapture(tab);
  handle?.initialized.catch(() => {});
});

const liveScopes = new WeakSet(),
  contextScopes = new WeakSet(),
  outputScopes = new WeakSet(),
  recoveryScopes = new WeakSet(),
  abandonedScopes = new WeakSet();
const outputCreators = new WeakMap(),
  liveOperations = new Set(),
  ownedOutputs = new Map(),
  pendingWorkerPixelProducers = new Set();
const contextScope = Object.freeze({ requesterOwner: compositorOwner });
contextScopes.add(contextScope);
function getBrowserTarget() {
  const m = chrome.runtime.getManifest();
  if (
    m.background?.service_worker === "service-worker.js" &&
    m.permissions?.includes("offscreen") &&
    !m.browser_specific_settings?.gecko
  )
    return "chrome";
  if (
    m.browser_specific_settings?.gecko?.id ===
      "capture-full-page@ohokthisisfine.github" &&
    JSON.stringify(m.background?.scripts) ===
      JSON.stringify([
        "capture-protocol.js",
        "offscreen.js",
        "service-worker.js",
      ])
  )
    return "firefox";
  throw WP.fault("UNSUPPORTED_BROWSER");
}
function getDownloadApi(target) {
  const api =
    target === "chrome"
      ? chrome.downloads
      : target === "firefox"
        ? globalThis.browser?.downloads
        : null;
  if (
    !api ||
    typeof api.download !== "function" ||
    typeof api.search !== "function"
  )
    throw WP.fault("UNSUPPORTED_BROWSER");
  return api;
}
const browserTarget = getBrowserTarget(),
  downloadApi = getDownloadApi(browserTarget);
function latchSourceLoss(operation, reason) {
  if (!operation.sourceLost) {
    operation.sourceLost = true;
    operation.cancelReason = reason;
    operation.controller?.abort();
    abortOffscreenSession(operation).catch(() => {});
  }
}
chrome.tabs.onActivated.addListener((info) => {
  for (const op of liveOperations)
    if (info.windowId === op.windowId && info.tabId !== op.tabId)
      latchSourceLoss(op, "TAB_CHANGED");
});
chrome.tabs.onRemoved.addListener((id) => {
  for (const op of liveOperations)
    if (id === op.tabId) latchSourceLoss(op, "NAVIGATED");
});
chrome.tabs.onUpdated.addListener((id, change) => {
  for (const op of liveOperations)
    if (
      id === op.tabId &&
      (change.status === "loading" || change.url !== undefined)
    )
      latchSourceLoss(op, "NAVIGATED");
});
for (const event of [chrome.tabs.onDetached, chrome.tabs.onAttached])
  event.addListener((id) => {
    for (const op of liveOperations)
      if (id === op.tabId) latchSourceLoss(op, "TAB_CHANGED");
  });
function bindContentPort(operation, port, identity) {
  checkOperation(operation);
  if (operation.currentContentBinding) throw WP.fault("INVALID_IDENTITY");
  const binding = {
    port,
    identity,
    sessionId: identity.sessionId,
    shutdownExpected: false,
    closed: false,
    rpc: null,
    onSourceDisconnect: null,
  };
  binding.onSourceDisconnect = () => {
    if (
      operation.currentContentBinding === binding &&
      !binding.shutdownExpected
    ) {
      binding.closed = true;
      latchSourceLoss(operation, "NAVIGATED");
    }
  };
  operation.currentContentBinding = binding;
  port.onDisconnect.addListener(binding.onSourceDisconnect);
  binding.rpc = createPortRPC(port, identity, operation);
  return binding;
}
function closeContentBinding(operation, binding) {
  if (!binding) return;
  binding.shutdownExpected = true;
  binding.port.onDisconnect.removeListener(binding.onSourceDisconnect);
  binding.closed = true;
  binding.rpc.close();
  try {
    binding.port.disconnect();
  } catch {}
  if (operation.currentContentBinding === binding)
    operation.currentContentBinding = null;
}
function makeOutputScope(entry, creator = null) {
  const scope = Object.freeze({
    operationId: entry.operationId,
    sessionId: entry.sessionId,
    owner: entry.owner,
    intentId: entry.intentId,
  });
  (creator ? outputScopes : recoveryScopes).add(scope);
  if (creator) outputCreators.set(scope, creator);
  return scope;
}
function ownedItemUrl(entry) {
  return entry.kind === "output" ? entry.url : entry.sourceUrl;
}
function matchOwnedItem(entry, item) {
  return (
    Number.isSafeInteger(item?.id) &&
    item.id >= 0 &&
    item.url === ownedItemUrl(entry) &&
    typeof item.incognito === "boolean" &&
    item.incognito === entry.incognito &&
    (item.byExtensionId === undefined ||
      item.byExtensionId === chrome.runtime.id) &&
    (entry.downloadId === null || entry.downloadId === item.id)
  );
}
function wireItem(item) {
  const result = {
    id: item.id,
    url: item.url,
    incognito: item.incognito,
    state: item.state,
    paused: item.paused,
  };
  if (item.byExtensionId !== undefined)
    result.byExtensionId = item.byExtensionId;
  if (item.canResume !== undefined) result.canResume = item.canResume;
  return result;
}
async function listOutputs() {
  return (await callCompositor(contextScope, "download-list")).entries;
}
async function exactEntry(scope) {
  return (await listOutputs()).find(
    (e) =>
      e.intentId === scope.intentId &&
      ["operationId", "sessionId", "owner"].every((k) => e[k] === scope[k]),
  );
}
async function mutateOutput(scope, type, makePayload) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const entry = await exactEntry(scope);
    if (!entry) return null;
    try {
      return (
        await callCompositor(scope, type, {
          intentId: scope.intentId,
          expectedRevision: entry.revision,
          ...makePayload(entry),
        })
      ).entry;
    } catch (error) {
      if (error.code !== "REVISION_CHANGED" || attempt === 1) throw error;
    }
  }
}
function boundedObservation(promise, ms, late) {
  let timer,
    settled = false;
  return new Promise((resolve) => {
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    Promise.resolve(promise).then(
      (value) => {
        if (settled) late?.({ kind: "resolved", value });
        else settle({ kind: "resolved", value });
      },
      (error) => {
        if (settled) late?.({ kind: "rejected" });
        else settle({ kind: "rejected" });
      },
    );
    timer = setTimeout(() => settle({ kind: "timeout" }), Math.max(0, ms));
  });
}
let reconcilePromise = null,
  reconcileDirty = false;
function reconcileOwnedDownloads() {
  reconcileDirty = true;
  if (reconcilePromise) return reconcilePromise;
  const run = async () => {
    do {
      reconcileDirty = false;
      const entries = await listOutputs();
      for (const entry of entries) {
        projectOwnedStatus(entry);
        if (entry.kind === "output" && entry.sourceState !== "armed") continue;
        let scope = ownedOutputs.get(entry.intentId);
        if (!scope) {
          scope = makeOutputScope(entry);
          ownedOutputs.set(entry.intentId, scope);
        }
        const query =
          entry.downloadId === null
            ? { url: ownedItemUrl(entry), limit: 2 }
            : { id: entry.downloadId };
        let search;
        try {
          search = downloadApi.search(query);
        } catch {
          continue;
        }
        const apply = async (result) => {
          if (!Array.isArray(result)) return;
          const current = await exactEntry(scope);
          if (!current || current.revision !== entry.revision) return;
          const matches = result.filter((item) =>
            matchOwnedItem(current, item),
          );
          if (matches.length !== 1) return;
          const item = wireItem(matches[0]);
          let updated = current;
          if (updated.downloadId === null)
            updated = (
              await callCompositor(scope, "download-bind", {
                intentId: scope.intentId,
                downloadId: item.id,
                expectedRevision: updated.revision,
                basis: "exact-item",
                item,
              })
            ).entry;
          updated = (
            await callCompositor(scope, "download-update", {
              intentId: scope.intentId,
              expectedRevision: updated.revision,
              item,
            })
          ).entry;
          projectOwnedStatus(updated);
          if (
            updated.kind === "output" &&
            ["complete", "interrupted-final"].includes(updated.downloadState)
          )
            await callCompositor(scope, "download-release", {
              intentId: scope.intentId,
              expectedRevision: updated.revision,
              reason:
                updated.downloadState === "complete"
                  ? "DOWNLOAD_COMPLETE"
                  : "DOWNLOAD_INTERRUPTED_FINAL",
            });
        };
        const observed = await boundedObservation(search, 15000, (result) => {
          if (result.kind === "resolved") apply(result.value).catch(() => {});
        });
        if (observed.kind === "resolved")
          await apply(observed.value).catch(() => {});
      }
    } while (reconcileDirty);
  };
  const promise = run();
  reconcilePromise = promise;
  promise
    .finally(() => {
      if (reconcilePromise === promise) {
        reconcilePromise = null;
        if (reconcileDirty) reconcileOwnedDownloads().catch(() => {});
        else closeOffscreenIfIdle().catch(() => {});
      }
    })
    .catch(() => {});
  return promise;
}
for (const event of [downloadApi.onCreated, downloadApi.onChanged])
  event.addListener(() => reconcileOwnedDownloads().catch(() => {}));
function invokeDownloadOnce(operation, options) {
  checkOperation(operation);
  if (operation.initiationAttempted) throw WP.fault("ALREADY_STARTED");
  setOperationState(operation, "initiating");
  operation.initiationAttempted = true;
  try {
    return { promise: downloadApi.download(options) };
  } catch {
    return { failure: true };
  }
}
async function observeDownloadInitiation(operation, invocation) {
  const scope = operation.outputScope;
  const record = async (result) => {
    try {
      if (
        result.kind === "resolved" &&
        Number.isSafeInteger(result.value) &&
        result.value >= 0
      ) {
        await mutateOutput(scope, "download-bind", () => ({
          downloadId: result.value,
          basis: "api-result",
        }));
        setOperationState(operation, "saving");
        await reconcileOwnedDownloads();
      } else {
        const apiOutcome =
            result.kind === "timeout"
              ? "timed-out"
              : result.kind === "rejected"
                ? "failed"
                : "invalid",
          code =
            apiOutcome === "failed"
              ? "DOWNLOAD_START_FAILED"
              : apiOutcome === "invalid"
                ? "DOWNLOAD_START_INVALID"
                : "DOWNLOAD_START_UNCERTAIN";
        await mutateOutput(scope, "download-observe", () => ({
          apiOutcome,
          code,
        }));
        setOperationState(operation, "uncertain", { code });
        await reconcileOwnedDownloads();
      }
    } catch {}
  };
  if (invocation.failure) {
    record({ kind: "rejected" }).catch(() => {});
    return { kind: "failed", code: "DOWNLOAD_START_FAILED" };
  }
  if (!invocation.promise || typeof invocation.promise.then !== "function") {
    record({ kind: "invalid" }).catch(() => {});
    return { kind: "invalid", code: "DOWNLOAD_START_INVALID" };
  }
  const result = await boundedObservation(
    invocation.promise,
    Math.min(15000, Math.max(0, operation.expiresAt - Date.now())),
    (r) => {
      record(r).catch(() => {});
    },
  );
  record(result).catch(() => {});
  return result;
}
async function releaseNeverInitiatedOutput(operation, scope) {
  if (
    !liveScopes.has(operation) ||
    !liveOperations.has(operation) ||
    outputCreators.get(scope) !== operation ||
    operation.initiationAttempted
  )
    throw WP.fault("INVALID_IDENTITY");
  return mutateOutput(scope, "download-release", () => ({
    reason: "CANCELLED_BEFORE_INITIATION",
  }));
}
function makeDownloadOptions({ target, tab, url, filename }) {
  const options = { url, filename, saveAs: false, conflictAction: "uniquify" };
  if (target === "firefox") options.incognito = tab.incognito;
  return options;
}
async function recoverCompositor() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const status = await callCompositor(contextScope, "status", {}, 2000);
    if (!status.activeSession) return status;
    const scope = Object.freeze({ ...status.activeSession });
    abandonedScopes.add(scope);
    try {
      await callCompositor(
        scope,
        "abort",
        {
          reason: "WORKER_REPLACED",
          expectedContextId: status.contextId,
          expectedLifecycleGeneration: status.lifecycleGeneration,
        },
        2000,
      );
    } catch (error) {
      if (error.code !== "STALE_RECOVERY" || attempt === 1) throw error;
      continue;
    }
    const fresh = await callCompositor(contextScope, "status", {}, 2000);
    if (fresh.activeSession) throw WP.fault("STALE_RECOVERY");
    return fresh;
  }
  throw WP.fault("STALE_RECOVERY");
}

const operationStates = new Map(),
  actionUpdates = new Map();
function getOperationKey(tabId, incognito) {
  return `${tabId}:${incognito ? "private" : "normal"}`;
}
function publicText(phase, count, code) {
  return {
    idle: "Ready to capture",
    preparing: "Preparing capture",
    capturing: `Capturing \u00b7 ${count} frames`,
    encoding: "Encoding PNG",
    initiating: "Saving PNG",
    saving: "Saving PNG",
    paused: "Download paused",
    resumable: "Download interrupted; resumption may be available",
    saved: "Saved",
    cancelled: "Capture cancelled",
    failed: WP.fault(code).message,
    uncertain: "The earlier download result could not be verified",
    expired: "Screenshot source expired; resumption may no longer work",
  }[phase];
}
function setOperationState(operation, nextPhase, details = {}) {
  if (typeof operation.captureContext?.incognito !== "boolean") return null;
  const key = getOperationKey(
      operation.tabId,
      operation.captureContext.incognito,
    ),
    prior = details.begin ? null : operationStates.get(key);
  if (prior && prior.operationId !== operation.operationId && !details.begin)
    return null;
  if (prior?.operationId === operation.operationId && prior.phase === "saved")
    nextPhase = "saved";
  if (
    prior?.operationId === operation.operationId &&
    [
      "initiating",
      "saving",
      "paused",
      "resumable",
      "saved",
      "uncertain",
      "expired",
    ].includes(prior.phase) &&
    nextPhase === "cancelled"
  )
    nextPhase = prior.phase;
  const snapshot = WP.validatePublicStatus({
    operationId: operation.operationId,
    tabId: operation.tabId,
    windowId: operation.windowId,
    incognito: operation.captureContext.incognito,
    phase: nextPhase,
    acceptedFrames: details.acceptedFrames ?? prior?.acceptedFrames ?? 0,
    attemptedFrames: details.attemptedFrames ?? prior?.attemptedFrames ?? 0,
    width: details.width ?? prior?.width ?? null,
    height: details.height ?? prior?.height ?? null,
    warnings: details.warnings ?? prior?.warnings ?? [],
    code: details.code ?? (nextPhase === "failed" ? "CAPTURE_FAILED" : null),
    text: publicText(
      nextPhase,
      details.acceptedFrames ?? prior?.acceptedFrames ?? 0,
      details.code,
    ),
    restoration: details.restoration ?? prior?.restoration ?? null,
  });
  operation.phase = nextPhase;
  operationStates.delete(key);
  operationStates.set(key, snapshot);
  while (operationStates.size > 20)
    operationStates.delete(operationStates.keys().next().value);
  renderActionStatus(snapshot).catch(() => {});
  return snapshot;
}
function getOperationState({ tabId, windowId, incognito }) {
  const current = operationStates.get(getOperationKey(tabId, incognito));
  if (current?.windowId === windowId) return { ...current };
  return WP.validatePublicStatus({
    operationId: null,
    tabId,
    windowId,
    incognito,
    phase: "idle",
    acceptedFrames: 0,
    attemptedFrames: 0,
    width: null,
    height: null,
    warnings: [],
    code: null,
    text: "Ready to capture",
    restoration: null,
  });
}
function renderActionStatus(snapshot) {
  const action = chrome.action;
  if (!action?.setBadgeText || !action?.setTitle) return Promise.resolve();
  const key = getOperationKey(snapshot.tabId, snapshot.incognito),
    previous = actionUpdates.get(key) || Promise.resolve();
  const update = previous
    .catch(() => {})
    .then(async () => {
      if (operationStates.get(key) !== snapshot) return;
      const badge = {
        preparing: "PREP",
        capturing: "CAP",
        encoding: "PNG",
        initiating: "SAVE",
        saving: "SAVE",
        paused: "SAVE",
        resumable: "SAVE",
        saved: "DONE",
        failed: "ERR",
        cancelled: "",
        idle: "",
        uncertain: "?",
        expired: "?",
      }[snapshot.phase];
      await action.setBadgeText({ tabId: snapshot.tabId, text: badge });
      if (operationStates.get(key) === snapshot)
        await action.setTitle({ tabId: snapshot.tabId, title: snapshot.text });
    });
  actionUpdates.set(key, update);
  update
    .finally(() => {
      if (actionUpdates.get(key) === update) actionUpdates.delete(key);
    })
    .catch(() => {});
  return update;
}
function validateExtensionSender(sender, { kind }) {
  return (
    sender?.id === chrome.runtime.id &&
    !sender.tab &&
    sender.url ===
      chrome.runtime.getURL(kind === "popup" ? "popup.html" : OFFSCREEN_URL)
  );
}
function cancelRequestedOperation({ operationId, tabId, incognito }) {
  const operation = [...liveOperations].find(
    (op) =>
      op.operationId === operationId &&
      op.tabId === tabId &&
      op.captureContext?.incognito === incognito,
  );
  if (
    !operation ||
    !["preparing", "capturing", "encoding"].includes(operation.phase)
  )
    throw WP.fault("INVALID_IDENTITY");
  operation.cancelReason = "USER_CANCELLED";
  operation.controller.abort();
  abortOffscreenSession(operation).catch(() => {});
  const binding = operation.currentContentBinding;
  operation.cancelAcknowledgement = binding?.rpc
    .call("cancel", { reason: "USER_CANCELLED" })
    .then((summary) => {
      operation.restoration = WP.validateRestoreSummary(summary);
      setOperationState(operation, "cancelled", {
        restoration: operation.restoration,
      });
    })
    .catch(() => {
      operation.restoration = {
        status: "unverified",
        restoredCount: 0,
        preservedPageChanges: 0,
        failedCount: 0,
        codes: ["PORT_DISCONNECTED"],
      };
      setOperationState(operation, "cancelled", {
        restoration: operation.restoration,
      });
    });
  return setOperationState(operation, "cancelled");
}
function projectOwnedStatus(entry, { recover = false } = {}) {
  const operation = {
    operationId: entry.operationId,
    tabId: entry.tabId,
    windowId: entry.windowId,
    captureContext: { incognito: entry.incognito },
  };
  const key = getOperationKey(entry.tabId, entry.incognito),
    prior = operationStates.get(key);
  if (
    !prior &&
    !recover &&
    ![...liveOperations].some((op) => op.operationId === entry.operationId)
  )
    return null;
  if (prior && prior.operationId !== entry.operationId) return prior;
  let phase =
    entry.downloadState === "complete"
      ? "saved"
      : entry.sourceState === "expired"
        ? "expired"
        : entry.downloadState === "interrupted-final"
          ? "failed"
          : entry.downloadState === "paused" || entry.paused
            ? "paused"
            : entry.downloadState === "interrupted-resumable"
              ? "resumable"
              : entry.downloadState === "in_progress"
                ? "saving"
                : "uncertain";
  return setOperationState(operation, phase, {
    width: entry.width ?? null,
    height: entry.height ?? null,
    code:
      phase === "failed"
        ? "DOWNLOAD_START_FAILED"
        : phase === "expired"
          ? "SOURCE_EXPIRED"
          : null,
  });
}
async function recoverOperationStatus(identity) {
  const current = getOperationState(identity);
  if (current.operationId) {
    if (
      ["initiating", "saving", "paused", "resumable", "uncertain"].includes(
        current.phase,
      )
    )
      try {
        const entry = (await listOutputs()).find(
          (entry) =>
            entry.operationId === current.operationId &&
            entry.tabId === identity.tabId &&
            entry.windowId === identity.windowId &&
            entry.incognito === identity.incognito,
        );
        if (entry) return projectOwnedStatus(entry) || current;
      } catch {}
    return current;
  }
  let entries;
  try {
    entries = await listOutputs();
  } catch {
    return {
      ...current,
      text: "Ready to capture. Earlier results may be unavailable after restart.",
    };
  }
  const matches = entries.filter(
    (entry) =>
      entry.tabId === identity.tabId &&
      entry.windowId === identity.windowId &&
      entry.incognito === identity.incognito,
  );
  if (matches.length === 1)
    return projectOwnedStatus(matches[0], { recover: true });
  const live = matches
    .filter((entry) => entry.kind === "output")
    .sort((a, b) => b.createdAt - a.createdAt);
  // Terminal time orders completions, not captures. An earlier tombstone can
  // be excluded; overlapping terminal/live records or multiple tombstones
  // cannot establish newest operation authority with this unchanged schema.
  if (
    live.length &&
    (live.length === 1 || live[0].createdAt > live[1].createdAt) &&
    matches.every(
      (entry) =>
        entry.kind === "output" || entry.terminalAt < live[0].createdAt,
    )
  )
    return projectOwnedStatus(live[0], { recover: true });
  if (matches.length)
    return {
      ...current,
      phase: "uncertain",
      text: "Earlier capture order is uncertain after restart.",
    };
  return {
    ...current,
    text: "Ready to capture. Earlier results may be unavailable after restart.",
  };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const target = Object.getOwnPropertyDescriptor(
    message || {},
    "target",
  )?.value;
  if (target === "cfp-worker") {
    if (
      browserTarget !== "chrome" ||
      !validateExtensionSender(sender, { kind: "offscreen" })
    )
      return;
    handleCompositorNotification(message, null)
      .then(sendResponse)
      .catch(() => {});
    return true;
  }
  const type = Object.getOwnPropertyDescriptor(message || {}, "type")?.value;
  if (
    !["capture-active-tab", "capture-status", "capture-cancel"].includes(type)
  )
    return;
  if (!validateExtensionSender(sender, { kind: "popup" })) {
    sendResponse({ type, ok: false, ...WP.errorResult("INVALID_SENDER") });
    return;
  }
  let request;
  try {
    request = WP.validatePopupRequest(message);
  } catch (error) {
    sendResponse({ type, ok: false, ...WP.errorResult(error.code) });
    return;
  }
  (async () => {
    const [queried] = await chrome.tabs.query({
      active: true,
      windowId: request.windowId,
    });
    if (!Number.isSafeInteger(queried?.id))
      throw WP.fault("CAPTURE_CONTEXT_UNVERIFIED");
    const tab = await chrome.tabs.get(queried.id);
    if (
      tab.id !== queried.id ||
      tab.windowId !== request.windowId ||
      !tab.active ||
      typeof tab.incognito !== "boolean"
    )
      throw WP.fault("CAPTURE_CONTEXT_UNVERIFIED");
    let status;
    if (type === "capture-active-tab") {
      const handle = startCapture(tab);
      if (!handle) throw WP.fault("SESSION_BUSY");
      await handle.initialized;
      status = getOperationState({
        tabId: tab.id,
        windowId: tab.windowId,
        incognito: tab.incognito,
      });
    } else if (type === "capture-cancel") {
      if (request.tabId !== tab.id) throw WP.fault("INVALID_IDENTITY");
      status = cancelRequestedOperation({
        operationId: request.operationId,
        tabId: tab.id,
        incognito: tab.incognito,
      });
    } else
      status = await recoverOperationStatus({
        tabId: tab.id,
        windowId: tab.windowId,
        incognito: tab.incognito,
      });
    sendResponse({ type, requestId: request.requestId, ok: true, status });
  })().catch((error) =>
    sendResponse({
      type,
      requestId: request.requestId,
      ...WP.errorResult(error.code),
    }),
  );
  return true;
});

function startCapture(tab) {
  if (
    !Number.isSafeInteger(tab?.id) ||
    tab.id < 0 ||
    !Number.isSafeInteger(tab.windowId) ||
    tab.windowId < 0
  )
    return null;
  if (activeCapture || pendingWorkerPixelProducers.size) return null;

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
    run: null,
    operationId: crypto.randomUUID(),
  };

  activeCapture = capture;

  const markInitialized = () => {
    if (capture.initialized) return;
    capture.initialized = true;
    capture.resolveInitialized();
  };

  capture.run = captureFullPage(tab, markInitialized, capture)
    .catch((error) => {
      if (!capture.initialized) {
        capture.initialized = true;
        capture.rejectInitialized(error);
      }
      // Typed status is retained for reopening the popup.
    })
    .finally(() => {
      if (activeCapture === capture) activeCapture = null;
      closeOffscreenIfIdle().catch(() => {});
    });

  initialized.catch(() => {});
  return { operationId: capture.operationId, initialized, done: capture.run };
}

const pendingPageInjections = new Set();
const cleanupGraces = new WeakMap();
function cleanupBudget(scope) {
  let deadline = cleanupGraces.get(scope);
  if (!deadline) {
    deadline = { wall: Date.now() + 2000, mono: performance.now() + 2000 };
    cleanupGraces.set(scope, deadline);
  }
  return Math.max(
    0,
    Math.min(
      2000,
      deadline.wall - Date.now(),
      deadline.mono - performance.now(),
    ),
  );
}
async function awaitOperation(scope, native, timeoutMs = 15000) {
  checkOperation(scope);
  let timer, onAbort;
  try {
    const result = await Promise.race([
      Promise.resolve(native),
      new Promise((_, reject) => {
        onAbort = () =>
          reject(WP.fault(scope.cancelReason || "USER_CANCELLED"));
        scope.controller.signal.addEventListener("abort", onAbort, {
          once: true,
        });
        if (scope.controller.signal.aborted) onAbort();
        timer = setTimeout(
          () => reject(WP.fault("TRANSPORT_FAILED")),
          Math.max(
            0,
            Math.min(
              timeoutMs,
              scope.expiresAt - Date.now(),
              scope.monoDeadline - performance.now(),
            ),
          ),
        );
      }),
    ]);
    checkOperation(scope);
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) scope.controller.signal.removeEventListener("abort", onAbort);
  }
}
async function captureFullPage(tab, markInitialized, capture = null) {
  const sessionId = crypto.randomUUID();
  const scope = {
    operationId: capture?.operationId || crypto.randomUUID(),
    sessionId,
    owner: compositorOwner,
    tabId: tab.id,
    windowId: tab.windowId,
    expiresAt: Date.now() + WP.MAX_OPERATION_MS,
    monoDeadline: performance.now() + WP.MAX_OPERATION_MS,
    sourceLost: false,
    cancelReason: null,
    initiationAttempted: false,
    currentContentBinding: null,
    outputScope: null,
    controller: new AbortController(),
  };
  if (pendingWorkerPixelProducers.size) throw WP.fault("RESOURCE_LIMIT");
  liveScopes.add(scope);
  liveOperations.add(scope);
  if (capture) capture.operation = scope;
  let outputScope = null;
  const tabId = tab.id;
  const windowId = tab.windowId;
  let port = null;
  let rpc = null;
  let prepared = false;
  let offscreenStarted = false;
  let finishedUrl = null;
  let binding = null;

  try {
    const actualTab = await awaitOperation(scope, chrome.tabs.get(tabId));
    checkOperation(scope);
    if (
      actualTab?.id !== tabId ||
      actualTab.windowId !== windowId ||
      typeof actualTab?.incognito !== "boolean"
    )
      throw WP.fault("CAPTURE_CONTEXT_UNVERIFIED");
    scope.captureContext = Object.freeze({
      targetBrowser: browserTarget,
      tabId,
      windowId,
      incognito: actualTab.incognito,
    });
    setOperationState(scope, "preparing", { begin: true });
    if (
      actualTab.incognito &&
      !WP.getQualifiedCapabilities(browserTarget).privateCapture
    )
      throw WP.fault("PRIVATE_CAPTURE_UNVERIFIED");
    const admission = await awaitOperation(scope, recoveryReady());
    checkOperation(scope);
    if (
      admission.retainedUrlCount >= WP.MAX_RETAINED_URLS ||
      admission.retainedUrlBytes + WP.MAX_ENCODED_BYTES >
        WP.MAX_RETAINED_URL_BYTES ||
      WP.MAX_ACCOUNTED_BYTES - admission.accountedBytes < 128 * 1024 * 1024
    )
      throw WP.fault("RESOURCE_LIMIT");
    await assertOriginalTabActive(scope);

    // A cancelled injection can still land; serialize subsequent preparations
    // behind its actual settlement without keeping the foreground capture locked.
    await awaitOperation(scope, Promise.allSettled([...pendingPageInjections]));
    const injection = Promise.resolve(
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["capture-protocol.js", "content.js"],
      }),
    );
    pendingPageInjections.add(injection);
    injection
      .finally(() => pendingPageInjections.delete(injection))
      .catch(() => {});
    await awaitOperation(scope, injection);

    port = chrome.tabs.connect(tabId, { name: `cfp:${sessionId}`, frameId: 0 });
    binding = bindContentPort(scope, port, scope);
    rpc = binding.rpc;

    const prep = await rpc.call("prepare", {
      strategy: "auto",
      prepareExpiresAt: Date.now() + WP.MAX_PREPARE_MS,
      operationExpiresAt: scope.expiresAt,
    });
    prepared = true;

    if (
      !prep ||
      prep.windowWidth <= 0 ||
      prep.windowHeight <= 0 ||
      prep.targetWidth <= 0 ||
      prep.targetHeight <= 0
    ) {
      throw new Error("Could not measure this page.");
    }

    await awaitOperation(scope, ensureOffscreen());
    offscreenStarted = true;
    const plan = WP.makeTraversal(prep);
    scope.captureExpiresAt = Math.min(
      scope.expiresAt,
      Date.now() + WP.MAX_CAPTURE_MS,
    );
    scope.captureMonoDeadline =
      performance.now() +
      Math.min(WP.MAX_CAPTURE_MS, scope.monoDeadline - performance.now());
    if (
      plan.estimatedFrames * CAPTURE_DELAY_MS >
      Math.min(
        scope.captureExpiresAt - Date.now(),
        scope.captureMonoDeadline - performance.now(),
      )
    )
      throw WP.fault("CAPTURE_TIMEOUT");
    if (plan.estimatedFrames > MAX_CAPTURE_FRAMES)
      throw WP.fault("FRAME_LIMIT", "Capture exceeds frame limit.");
    const start = await callCompositor(scope, "start", {
      prep,
      captureContext: scope.captureContext,
      deadlines: {
        operationExpiresAt: scope.expiresAt,
        captureExpiresAt: scope.captureExpiresAt,
        encodeBudgetMs: WP.MAX_ENCODE_MS,
      },
      budget: {
        operationEnvelopeBytes:
          WP.MAX_ACCOUNTED_BYTES - admission.accountedBytes,
        maxOutputBytes: WP.MAX_ENCODED_BYTES,
        observedLedgerRevision: admission.ledgerRevision,
      },
    });
    throwIfOffscreenError(start);
    setOperationState(scope, "capturing", { warnings: prep.warnings });
    markInitialized();
    let frameCount = 0,
      previousAcceptedSpec = null,
      spec;
    while ((spec = WP.nextFrameSpec(plan, previousAcceptedSpec))) {
      checkOperation(scope);
      let acquired = null;
      const frameBudget = { remaining: 5 };
      for (let acquisition = 0; acquisition < 3; acquisition++) {
        await assertOriginalTabActive(scope);
        const positioned = await rpc.call("position", { spec });
        const positionCheck = WP.validateSnapshot(plan, spec, positioned);
        if (!positionCheck.ok && !positionCheck.retryable)
          throw WP.fault(positionCheck.code, "Position snapshot rejected.");
        const preSnapshot = await rpc.call("snapshot", { spec });
        const preCheck = WP.validateSnapshot(plan, spec, preSnapshot);
        if (!preCheck.ok) {
          if (preCheck.retryable && acquisition < 2) continue;
          throw WP.fault(preCheck.code, "Pre-capture snapshot rejected.");
        }
        setOperationState(scope, "capturing", {
          attemptedFrames:
            (getOperationState({ ...scope.captureContext }).attemptedFrames ||
              0) + 1,
        });
        const dataUrl = await captureVisible(
          tabId,
          windowId,
          scope,
          frameBudget,
        );
        await assertOriginalTabActive(scope);
        checkOperation(scope);
        const postSnapshot = await rpc.call("snapshot", { spec });
        const validation = WP.snapshotPair(
          plan,
          spec,
          preSnapshot,
          postSnapshot,
        );
        if (!validation.ok) {
          if (validation.retryable && acquisition < 2) continue;
          throw WP.fault(validation.code, "Capture geometry changed.");
        }
        acquired = { spec, preSnapshot, postSnapshot, dataUrl };
        break;
      }
      if (!acquired)
        throw WP.fault("SCROLL_CHANGED", "Capture scroll retries exhausted.");
      checkOperation(scope);
      const result = await callCompositor(scope, "frame", acquired); // timeout is ambiguous: never replay
      throwIfOffscreenError(result);
      if (result.acceptedSequence !== spec.sequence)
        throw WP.fault(
          "FRAME_SEQUENCE_MISMATCH",
          "Unexpected accepted frame sequence.",
        );
      if (
        !WP.sameRect(
          result.rect,
          WP.frameRect(prep, spec, result.bitmapWidth, result.bitmapHeight),
        ) ||
        !WP.sameRect(
          result.novelRect,
          WP.novelFrameRect(
            plan,
            spec,
            result.bitmapWidth,
            result.bitmapHeight,
          ),
        )
      )
        throw WP.fault("INVALID_GEOMETRY");
      frameCount++;
      setOperationState(scope, "capturing", {
        acceptedFrames: frameCount,
        width: Math.floor(
          (prep.targetWidth * result.bitmapWidth) / prep.windowWidth,
        ),
        height: Math.floor(
          (prep.targetHeight * result.bitmapHeight) / prep.windowHeight,
        ),
        warnings: acquired.postSnapshot.warnings,
      });
      const accepted = await rpc.call("accept-frame", {
        spec,
        bitmapWidth: result.bitmapWidth,
        bitmapHeight: result.bitmapHeight,
        rect: result.rect,
        novelRect: result.novelRect,
      });
      if (accepted.acceptedSequence !== spec.sequence)
        throw WP.fault("FRAME_SEQUENCE_MISMATCH");
      previousAcceptedSpec = spec;
    }

    if (frameCount === 0)
      throw new Error("No screenshot frames were captured.");

    // The page no longer needs to remain expanded/scrolled once every viewport
    // has been captured. Restore it before the potentially expensive PNG encode.
    try {
      scope.restoration = WP.validateRestoreSummary(
        await rpc.call("restore", { reason: "success" }),
      );
      prepared = false;
    } catch (error) {
      scope.restoration = {
        status: "unverified",
        restoredCount: 0,
        preservedPageChanges: 0,
        failedCount: 0,
        codes: ["PORT_DISCONNECTED"],
      };
    }

    setOperationState(scope, "encoding", { restoration: scope.restoration });
    const intentId = crypto.randomUUID();
    const finished = await callCompositor(scope, "finish", { intentId });
    throwIfOffscreenError(finished);
    outputScope = makeOutputScope({ ...scope, intentId }, scope);
    scope.outputScope = outputScope;
    ownedOutputs.set(intentId, outputScope);
    if (!finished?.url) throw new Error("Could not encode the screenshot.");
    finishedUrl = finished.url;

    const armed = await callCompositor(outputScope, "download-arm", {
      intentId,
      url: finishedUrl,
      byteLength: finished.byteLength,
      ...scope.captureContext,
    });
    checkOperation(scope);
    const filename = makeFilename(tab);
    await observeDownloadInitiation(
      scope,
      invokeDownloadOnce(
        scope,
        makeDownloadOptions({
          target: browserTarget,
          tab: actualTab,
          url: finishedUrl,
          filename,
        }),
      ),
    );
  } catch (error) {
    setOperationState(
      scope,
      scope.cancelReason === "USER_CANCELLED" ? "cancelled" : "failed",
      { code: error.code || "CAPTURE_FAILED" },
    );
    throw error;
  } finally {
    // Abort rejects foreground RPCs immediately; preserve the separately bounded
    // owned cancel/restore acknowledgement before closing this page binding.
    if (scope.cancelAcknowledgement) {
      await scope.cancelAcknowledgement;
      if (scope.restoration?.status === "acknowledged") prepared = false;
    }
    if (prepared && rpc) {
      try {
        scope.restoration = WP.validateRestoreSummary(
          await rpc.call("restore", {
            reason:
              scope.cancelReason === "USER_CANCELLED" ? "cancel" : "failure",
          }),
        );
      } catch {
        scope.restoration = {
          status: "unverified",
          restoredCount: 0,
          preservedPageChanges: 0,
          failedCount: 0,
          codes: ["PORT_DISCONNECTED"],
        };
      }
    }

    if (scope.restoration)
      setOperationState(scope, scope.phase || "failed", {
        restoration: scope.restoration,
      });
    closeContentBinding(scope, binding);

    if (offscreenStarted && !finishedUrl) {
      await abortOffscreenSession(scope).catch(() => {});
    }

    if (finishedUrl && !scope.initiationAttempted)
      await releaseNeverInitiatedOutput(scope, outputScope).catch(() => {});
    liveOperations.delete(scope);
  }
}

function createPortRPC(port, scope, operation = null) {
  let seq = 0;
  let disconnected = false;
  const pending = new Map();

  const settlePending = (messageId, action) => {
    const item = pending.get(messageId);
    if (!item) return null;
    pending.delete(messageId);
    clearTimeout(item.timer);
    item.signal?.removeEventListener("abort", item.onAbort);
    action(item);
    return item;
  };

  const onMessage = (message) => {
    if (
      !message ||
      message.protocolVersion !== 1 ||
      ["operationId", "sessionId", "owner"].some(
        (k) => message[k] !== scope[k],
      ) ||
      !Number.isSafeInteger(message.replyTo)
    )
      return;
    settlePending(message.replyTo, (item) => {
      if (message.error)
        item.reject(WP.fault(message.code || "CAPTURE_FAILED", message.error));
      else item.resolve(message.result);
    });
  };

  const onDisconnect = () => {
    disconnected = true;
    const err = new Error("The page capture connection was closed.");
    for (const id of [...pending.keys()])
      settlePending(id, (item) => item.reject(err));
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);

  return {
    call(method, payload = null) {
      if (operation && !["restore", "cancel"].includes(method))
        try {
          checkOperation(operation);
        } catch (error) {
          return Promise.reject(error);
        }
      if (disconnected)
        return Promise.reject(new Error("Capture connection is closed."));

      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            settlePending(id, (item) =>
              item.reject(new Error(`Capture command "${method}" timed out.`)),
            );
          },
          ["restore", "cancel"].includes(method)
            ? operation && !["success", "fallback"].includes(payload?.reason)
              ? cleanupBudget(operation)
              : 2000
            : Math.max(
                0,
                Math.min(
                  method === "prepare"
                    ? 15000
                    : method === "position"
                      ? 5000
                      : 2000,
                  operation ? operation.expiresAt - Date.now() : Infinity,
                  operation
                    ? operation.monoDeadline - performance.now()
                    : Infinity,
                ),
              ),
        );

        const signal =
          operation && !["restore", "cancel"].includes(method)
            ? operation.controller.signal
            : null;
        const onAbort = () =>
          settlePending(id, (item) =>
            item.reject(WP.fault(operation.cancelReason || "USER_CANCELLED")),
          );
        pending.set(id, { resolve, reject, timer, signal, onAbort });
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
        if (!pending.has(id)) return;
        try {
          port.postMessage({
            id,
            method,
            payload,
            protocolVersion: 1,
            operationId: scope.operationId,
            sessionId: scope.sessionId,
            owner: scope.owner,
          });
        } catch (error) {
          settlePending(id, (item) => item.reject(error));
        }
      });
    },
    close() {
      disconnected = true;
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      const err = new Error("Capture RPC closed.");
      for (const id of [...pending.keys()])
        settlePending(id, (item) => item.reject(err));
    },
  };
}

async function assertOriginalTabActive(operation) {
  checkOperation(operation);
  const tab = await awaitOperation(operation, chrome.tabs.get(operation.tabId));
  checkOperation(operation);
  if (
    !tab ||
    tab.windowId !== operation.windowId ||
    !tab.active ||
    (operation.captureContext &&
      tab.incognito !== operation.captureContext.incognito)
  ) {
    latchSourceLoss(operation, "TAB_CHANGED");
    checkOperation(operation);
  }
  const [activeTab] = await awaitOperation(
    operation,
    chrome.tabs.query({
      active: true,
      windowId: operation.windowId,
    }),
  );
  checkOperation(operation);
  if (!activeTab || activeTab.id !== operation.tabId) {
    latchSourceLoss(operation, "TAB_CHANGED");
    checkOperation(operation);
  }
}
function checkOperation(scope) {
  if (scope.sourceLost || scope.cancelReason)
    throw WP.fault(scope.cancelReason || "USER_CANCELLED");
  if (Date.now() >= scope.expiresAt || performance.now() >= scope.monoDeadline)
    throw WP.fault("OPERATION_TIMEOUT");
}
async function awaitPixelProducer(operation, factory) {
  const token = {};
  pendingWorkerPixelProducers.add(token);
  let timer, onAbort, native;
  try {
    native = Promise.resolve(factory());
    native
      .finally(() => pendingWorkerPixelProducers.delete(token))
      .catch(() => {});
    const cancelled = new Promise((_, reject) => {
      onAbort = () =>
        reject(WP.fault(operation.cancelReason || "USER_CANCELLED"));
      operation.controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      if (operation.controller.signal.aborted) onAbort();
      timer = setTimeout(
        () => reject(WP.fault("CAPTURE_TIMEOUT")),
        Math.max(
          0,
          Math.min(
            operation.captureExpiresAt - Date.now(),
            operation.captureMonoDeadline - performance.now(),
          ),
        ),
      );
    });
    return await Promise.race([native, cancelled]);
  } catch (error) {
    if (!native) pendingWorkerPixelProducers.delete(token);
    throw error;
  } finally {
    clearTimeout(timer);
    if (onAbort)
      operation.controller.signal.removeEventListener("abort", onAbort);
  }
}
async function captureVisible(
  tabId,
  windowId,
  scope,
  frameBudget = { remaining: 5 },
) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    checkOperation(scope);
    await assertOriginalTabActive(scope);
    const delay = Math.max(
      0,
      lastCaptureInvocationStart + CAPTURE_DELAY_MS - Date.now(),
    );
    if (delay) await sleep(delay);
    checkOperation(scope);
    await assertOriginalTabActive(scope);
    if (frameBudget.remaining <= 0) throw WP.fault("RESOURCE_LIMIT");
    frameBudget.remaining--;
    lastCaptureInvocationStart = Date.now();
    try {
      const dataUrl = await awaitPixelProducer(scope, () =>
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
      );
      WP.validateFrameDataUrl(dataUrl);
      await assertOriginalTabActive(scope);
      if (dataUrl) return dataUrl;
    } catch (error) {
      if (
        scope.sourceLost ||
        ["CAPTURE_TIMEOUT", "OPERATION_TIMEOUT", "RESOURCE_LIMIT"].includes(
          error.code,
        )
      )
        throw error;
      lastError = error;
    }

    checkOperation(scope);
  }

  throw lastError || new Error("captureVisibleTab failed.");
}

function hasSharedCompositor() {
  return (
    browserTarget === "firefox" &&
    typeof globalThis.__cfpCompositorHandle === "function"
  );
}

async function callCompositor(scope, type, payload = {}, timeoutMs = null) {
  const context = type === "status" || type === "download-list";
  if (
    context
      ? !contextScopes.has(scope)
      : type === "abort" && payload.reason === "WORKER_REPLACED"
        ? !abandonedScopes.has(scope)
        : ["start", "frame", "finish", "abort"].includes(type)
          ? !liveScopes.has(scope)
          : !outputScopes.has(scope) && !recoveryScopes.has(scope)
  )
    throw WP.fault("INVALID_IDENTITY");
  const creator = outputCreators.get(scope);
  if (
    (type === "download-bind" && payload.basis === "api-result") ||
    type === "download-observe"
  )
    if (!creator?.initiationAttempted) throw WP.fault("INVALID_IDENTITY");
  if (
    type === "download-release" &&
    ["CANCELLED_BEFORE_INITIATION", "DISCARDED_UNARMED"].includes(
      payload.reason,
    )
  )
    if (!creator || !liveOperations.has(creator) || creator.initiationAttempted)
      throw WP.fault("INVALID_IDENTITY");
  const message = {
    target: "cfp-offscreen",
    type,
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    ...(context
      ? { requesterOwner: scope.requesterOwner }
      : {
          operationId: scope.operationId,
          sessionId: scope.sessionId,
          owner: scope.owner,
        }),
    ...payload,
  };
  const validateResponse = WP.makeCompositorResponseValidator(message);
  let timer,
    onAbort,
    producer,
    producerPending = false;
  try {
    if (type === "frame") {
      const charge = 4 * message.dataUrl.length;
      if (charge > WP.MAX_ACCOUNTED_BYTES) throw WP.fault("RESOURCE_LIMIT");
      producer = {};
      pendingWorkerPixelProducers.add(producer);
    }
    const operation = hasSharedCompositor()
      ? globalThis.__cfpCompositorHandle(message)
      : chrome.runtime.sendMessage(message);
    if (producer) {
      producerPending = true;
      Promise.resolve(operation)
        .finally(() => pendingWorkerPixelProducers.delete(producer))
        .catch(() => {});
    }
    const cancellation =
      liveScopes.has(scope) && ["start", "frame", "finish"].includes(type)
        ? new Promise((_, reject) => {
            onAbort = () =>
              reject(WP.fault(scope.cancelReason || "USER_CANCELLED"));
            scope.controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
            if (scope.controller.signal.aborted) onAbort();
          })
        : new Promise(() => {});
    const result = await Promise.race([
      operation,
      cancellation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(WP.fault("TRANSPORT_FAILED")),
          timeoutMs ??
            (type === "finish"
              ? Math.min(
                  WP.MAX_ENCODE_MS,
                  Math.max(0, scope.expiresAt - Date.now()),
                )
              : ["start", "frame"].includes(type)
                ? Math.max(
                    0,
                    Math.min(
                      60000,
                      scope.expiresAt - Date.now(),
                      scope.monoDeadline - performance.now(),
                    ),
                  )
                : type === "abort" && liveScopes.has(scope)
                  ? cleanupBudget(scope)
                  : 2000),
        );
      }),
    ]);
    validateResponse(result);
    if (context)
      compositorContext = {
        contextId: result.contextId,
        lifecycleGeneration: result.lifecycleGeneration,
      };
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) scope.controller.signal.removeEventListener("abort", onAbort);
    if (producer && !producerPending)
      pendingWorkerPixelProducers.delete(producer);
    if (type === "frame") {
      message.dataUrl = null;
      payload.dataUrl = null;
    }
  }
}

async function ensureOffscreen() {
  if (hasSharedCompositor()) return;
  const closing = offscreenClosing;
  if (closing) await closing.catch(() => {});
  const creating = offscreenCreation;
  if (creating) await creating;
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_URL),
    query = () =>
      chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [documentUrl],
      });
  if ((await query()).length) return;
  if (!offscreenCreation) {
    const create = async () => {
      for (let attempt = 0; attempt < 2; attempt++)
        try {
          await chrome.offscreen.createDocument({
            url: OFFSCREEN_URL,
            reasons: ["BLOBS"],
            justification: "Assemble captured viewport tiles and encode a PNG.",
          });
          return;
        } catch (error) {
          if ((await query()).length) return;
          if (attempt === 1) throw error;
        }
    };
    const promise = create();
    offscreenCreation = promise;
    promise
      .finally(() => {
        if (offscreenCreation === promise) offscreenCreation = null;
      })
      .catch(() => {});
  }
  await offscreenCreation;
}

async function abortOffscreenSession(scope) {
  return callCompositor(scope, "abort", {
    reason: scope.cancelReason || "USER_CANCELLED",
  });
}

function closeOffscreenIfIdle() {
  if (
    hasSharedCompositor() ||
    activeCapture ||
    pendingWorkerPixelProducers.size ||
    reconcilePromise ||
    offscreenCreation ||
    offscreenClosing ||
    !chrome.offscreen?.closeDocument
  )
    return Promise.resolve();
  // Install the complete closing promise before the first asynchronous query.
  const run = async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    if (
      !contexts.length ||
      activeCapture ||
      offscreenCreation ||
      reconcilePromise
    )
      return;
    const first = await callCompositor(contextScope, "status");
    if (
      !first.idle ||
      activeCapture ||
      offscreenCreation ||
      pendingWorkerPixelProducers.size ||
      reconcilePromise
    )
      return;
    const fresh = await callCompositor(contextScope, "status");
    if (
      !fresh.idle ||
      fresh.contextId !== first.contextId ||
      fresh.lifecycleGeneration !== first.lifecycleGeneration ||
      activeCapture ||
      offscreenCreation ||
      pendingWorkerPixelProducers.size ||
      reconcilePromise
    )
      return;
    await chrome.offscreen.closeDocument();
  };
  const promise = Promise.resolve().then(run);
  offscreenClosing = promise;
  promise
    .finally(() => {
      if (offscreenClosing === promise) offscreenClosing = null;
    })
    .catch(() => {});
  return promise;
}

function throwIfOffscreenError(result) {
  if (!result || result.ok !== true)
    throw WP.fault(
      result?.code || "CAPTURE_FAILED",
      result?.error || "Compositor request failed.",
    );
}

function makeFilename(tab, now = new Date()) {
  let host = "page";
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, "") || "page";
  } catch {}

  const title = (tab.title || "page").trim();
  const d = now;
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

  const encoder = new TextEncoder();
  const truncate = (value, max) => {
    let result = "",
      bytes = 0;
    for (const point of value) {
      const size = encoder.encode(point).length;
      if (bytes + size > max) break;
      result += point;
      bytes += size;
    }
    return result;
  };
  const clean = (text, budget) =>
    truncate(
      String(text)
        .normalize("NFC")
        .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, "_")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, ""),
      budget,
    ).replace(/[. ]+$/g, "") || "page";
  const safeHost = clean(host, 60),
    titleBudget =
      240 - encoder.encode(stamp + "_" + safeHost + "_" + ".png").length;
  return `${stamp}_${safeHost}_${clean(title, titleBudget)}.png`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let notificationMarker = null;
async function handleCompositorNotification(notification, trustedRoute) {
  if (
    browserTarget === "firefox" &&
    (!notificationMarker || trustedRoute !== notificationMarker)
  )
    throw WP.fault("INVALID_SENDER");
  const normalized = WP.validateNotification(notification);
  if (
    normalized.requesterOwner !== compositorOwner ||
    !compositorContext ||
    normalized.contextId !== compositorContext.contextId ||
    normalized.lifecycleGeneration < compositorContext.lifecycleGeneration
  )
    throw WP.fault("INVALID_IDENTITY");
  compositorContext.lifecycleGeneration = normalized.lifecycleGeneration;
  if (normalized.type === "download-reconcile-needed")
    reconcileOwnedDownloads().catch(() => {});
  else closeOffscreenIfIdle().catch(() => {});
  return { ...normalized, ok: true, queued: true };
}
if (browserTarget === "firefox") {
  if (typeof globalThis.__cfpRegisterWorkerNotifications !== "function")
    throw WP.fault("UNSUPPORTED_BROWSER");
  notificationMarker = globalThis.__cfpRegisterWorkerNotifications(
    handleCompositorNotification,
  );
}
async function recoverExistingContext() {
  if (!hasSharedCompositor()) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    if (!contexts.length) return { ok: true };
  }
  try {
    return { ok: true, status: await recoverCompositor() };
  } catch {
    return { ok: false, code: "RECOVERY_UNVERIFIED" };
  }
}
let recoveryPromise = recoverExistingContext();
recoveryPromise.catch(() => {});
let recoveryRetry = null;
async function performRecoveryReady() {
  let ready = await recoveryPromise;
  if (!ready.ok) {
    if (!recoveryRetry) {
      recoveryRetry = recoverExistingContext();
      recoveryRetry
        .finally(() => {
          recoveryRetry = null;
        })
        .catch(() => {});
    }
    ready = await recoveryRetry;
    if (!ready.ok) throw WP.fault("RECOVERY_UNVERIFIED");
    recoveryPromise = Promise.resolve(ready);
  }
  await ensureOffscreen();
  return recoverCompositor();
}

let readinessPromise = null;
function recoveryReady() {
  if (readinessPromise) return readinessPromise;
  const promise = Promise.resolve().then(performRecoveryReady);
  readinessPromise = promise;
  promise
    .finally(() => {
      if (readinessPromise === promise) readinessPromise = null;
    })
    .catch(() => {});
  return promise;
}
