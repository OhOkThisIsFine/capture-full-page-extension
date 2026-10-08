const MAX_TILE_HEIGHT = 8192;
const MAX_TILE_PIXELS = 8 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 200 * 1024 * 1024;

const sessions = new Map();
const blobUrls = new Set();

const P = globalThis.__cfpProtocol;
if (!P || P.protocolVersion !== 1)
  throw new Error("Capture protocol unavailable.");
const contextId = crypto.randomUUID();
let lifecycleGeneration = 1,
  ledgerRevision = 0;
let requesterOwner = null;
const outputRecords = new Map();
const resources = new Map(),
  closedSessions = new Map();
function envelope(message) {
  return P.validateCompositorRequest(message);
}
function monoNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
function reserveBytes(s, category, backing, bytes) {
  P.uint(bytes);
  if (resources.has(backing)) {
    const existing = resources.get(backing);
    if (existing.bytes !== bytes || existing.owner !== s)
      throw P.fault("RESOURCE_LIMIT");
    existing.refs++;
    return existing;
  }
  const total = [...resources.values()].reduce((n, l) => n + l.bytes, 0);
  const categoryTotal = [...resources.values()]
    .filter((l) => l.category === category)
    .reduce((n, l) => n + l.bytes, 0);
  const ceiling =
    category === "activeCanvas"
      ? P.MAX_ACTIVE_CANVAS_BYTES
      : category === "savedTile"
        ? P.MAX_SAVED_TILE_BYTES
        : category === "frameBitmap"
          ? P.MAX_FRAME_BITMAP_BYTES
          : category === "compressorValue"
            ? P.MAX_ENCODED_BYTES
            : category === "retainedOutput"
              ? P.MAX_RETAINED_URL_BYTES
              : P.MAX_ACCOUNTED_BYTES;
  const owned = [...resources.values()]
    .filter((l) => l.owner === s)
    .reduce((n, l) => n + l.bytes, 0);
  if (
    total + bytes > P.MAX_ACCOUNTED_BYTES ||
    categoryTotal + bytes > ceiling ||
    (s && owned + bytes > s.operationEnvelopeBytes)
  )
    throw P.fault("RESOURCE_LIMIT");
  const lease = {
    id: crypto.randomUUID(),
    category,
    bytes,
    refs: 1,
    pending: false,
    owner: s,
    backing,
  };
  resources.set(backing, lease);
  lifecycleGeneration++;
  return lease;
}
function observeReturnedAllocation(s, category, backing, bytes) {
  const total = [...resources.values()].reduce(
      (sum, lease) => sum + lease.bytes,
      0,
    ),
    existing = resources.get(backing);
  s.observedNativePeak = Math.max(
    s.observedNativePeak || 0,
    total + (existing ? 0 : bytes),
  );
  s.observedNativeAllocations = (s.observedNativeAllocations || 0) + 1;
  try {
    return reserveBytes(s, category, backing, bytes);
  } catch (error) {
    s.excessNativeAllocation = true;
    throw error;
  }
}
function inspectReturnedBitmap(s, bitmap) {
  const bytes = 4 * bitmap.width * bitmap.height;
  if (Number.isSafeInteger(bytes) && bytes > 0) {
    const total = [...resources.values()].reduce(
      (sum, lease) => sum + lease.bytes,
      0,
    );
    s.observedNativePeak = Math.max(s.observedNativePeak || 0, total + bytes);
  }
  try {
    return P.cssBitmap(bitmap.width, bitmap.height);
  } catch (error) {
    s.excessNativeAllocation = true;
    throw error;
  }
}
function releaseBytes(lease) {
  if (!lease || resources.get(lease.backing) !== lease) return;
  if (--lease.refs < 0) throw P.fault("RESOURCE_LIMIT");
  if (lease.refs === 0) {
    resources.delete(lease.backing);
    lifecycleGeneration++;
  }
}
async function nativeAwait(s, lease, factory) {
  lease.pending = true;
  s.nativePending.add(lease);
  lifecycleGeneration++;
  try {
    return await factory();
  } finally {
    lease.pending = false;
    s.nativePending.delete(lease);
    lifecycleGeneration++;
    // The caller drops its remaining local backing references before release.
  }
}
function statusSnapshot() {
  const live = [...outputRecords.values()].filter(
      (r) => r.wire.kind === "output",
    ),
    leases = [...resources.values()],
    s = [...sessions.values()][0];
  return {
    contextId,
    lifecycleGeneration,
    idle: isIdle(),
    activeSession: s
      ? {
          operationId: s.operationId,
          sessionId: s.sessionId,
          owner: s.owner,
          phase: s.phase,
          expiresAt:
            s.phase === "encoding" ? s.encodeExpiresAt : s.captureExpiresAt,
        }
      : null,
    retainedUrlCount: live.length,
    retainedUrlBytes: live.reduce((n, r) => n + r.wire.byteLength, 0),
    pendingDisposalBytes: leases
      .filter((l) => l.pending || (l.retainedByFrame && l.owner?.cancelled))
      .reduce((n, l) => n + l.bytes, 0),
    accountedBytes: leases.reduce((n, l) => n + l.bytes, 0),
    ledgerRevision,
  };
}
function publicEntry(record) {
  return { ...record.wire };
}
function bump(record) {
  record.wire.revision++;
  ledgerRevision++;
  lifecycleGeneration++;
}
function exactRecord(message) {
  const record = outputRecords.get(message.intentId);
  if (
    !record ||
    ["operationId", "sessionId", "owner"].some(
      (k) => record.wire[k] !== message[k],
    )
  )
    throw P.fault("INVALID_IDENTITY");
  return record;
}
function requireRevision(record, revision) {
  if (record.wire.revision !== revision) throw P.fault("REVISION_CHANGED");
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
function trimTombstones() {
  const terminal = [...outputRecords.values()]
    .filter((r) => r.wire.kind === "tombstone")
    .sort(
      (a, b) =>
        a.wire.terminalAt - b.wire.terminalAt ||
        a.wire.intentId.localeCompare(b.wire.intentId),
    );
  while (terminal.length > 20) {
    outputRecords.delete(terminal.shift().wire.intentId);
    ledgerRevision++;
  }
}
function releaseSource(record, reason) {
  const e = record.wire;
  if (e.kind !== "output") return;
  const terminalAt = Date.now(),
    sourceUrl = e.url;
  URL.revokeObjectURL(sourceUrl);
  blobUrls.delete(sourceUrl);
  releaseBytes(record.lease);
  record.lease = null;
  record.blob = null;
  for (const timer of record.timers) clearTimeout(timer);
  record.timers = [];
  const tombstone = {
    kind: "tombstone",
    intentId: e.intentId,
    operationId: e.operationId,
    sessionId: e.sessionId,
    owner: e.owner,
    targetBrowser: e.targetBrowser,
    tabId: e.tabId,
    windowId: e.windowId,
    incognito: e.incognito,
    sourceUrl,
    downloadId: e.downloadId,
    sourceState: reason === "SOURCE_EXPIRED" ? "expired" : "released",
    downloadState: e.downloadState,
    apiOutcome: e.apiOutcome,
    outcomeCode: reason === "SOURCE_EXPIRED" ? "SOURCE_EXPIRED" : e.outcomeCode,
    revision: e.revision + 1,
    terminalAt,
  };
  record.wire = tombstone;
  ledgerRevision++;
  lifecycleGeneration++;
  if (
    ![...outputRecords.values()].some(
      (r) => r.wire.kind === "output" && r.wire.sourceState === "armed",
    )
  ) {
    clearTimeout(periodicTimer);
    periodicTimer = null;
  }
  try {
    P.validateOutputRecord(tombstone);
  } catch {
    outputRecords.delete(e.intentId);
    ledgerRevision++;
  }
  trimTombstones();
  if (reason === "SOURCE_EXPIRED")
    reconcileNotification([e.intentId], "expiry");
  if (isIdle()) notifyIdle();
}
function scheduleSourceExpiry(record) {
  const e = record.wire;
  record.timers.push(
    setTimeout(
      () => {
        if (
          record.wire.kind === "output" &&
          record.wire.sourceState === "armed"
        )
          reconcileNotification([e.intentId], "expiry");
      },
      Math.max(0, e.expiresAt - Date.now() - 2000),
    ),
  );
  record.timers.push(
    setTimeout(
      () => {
        if (record.wire.kind !== "output") return;
        releaseSource(record, "SOURCE_EXPIRED");
        if (isIdle()) notifyIdle();
      },
      Math.max(0, e.expiresAt - Date.now()),
    ),
  );
}
function handleOutput(message) {
  const record = exactRecord(message),
    e = record.wire;
  if (message.type === "download-arm") {
    if (
      e.kind !== "output" ||
      e.url !== message.url ||
      e.byteLength !== message.byteLength ||
      ["targetBrowser", "tabId", "windowId", "incognito"].some(
        (k) => e[k] !== message[k],
      )
    )
      throw P.fault("INVALID_IDENTITY");
    if (e.sourceState === "encoded") {
      e.sourceState = "armed";
      e.initiationState = "armed-unknown";
      bump(record);
      schedulePeriodic();
    }
    return { ok: true, entry: publicEntry(record) };
  }
  requireRevision(record, message.expectedRevision);
  if (message.type === "download-bind") {
    if (e.kind === "output" && e.sourceState !== "armed")
      throw P.fault("INVALID_IDENTITY");
    if (e.downloadId !== null && e.downloadId !== message.downloadId)
      throw P.fault("INVALID_IDENTITY");
    if (
      message.basis === "exact-item" &&
      (!matchOwnedItem(e, message.item) ||
        message.item.id !== message.downloadId)
    )
      throw P.fault("INVALID_IDENTITY");
    let changed = false;
    if (e.downloadId === null) {
      e.downloadId = message.downloadId;
      changed = true;
    }
    if (e.kind === "output" && e.initiationState !== "id-known") {
      e.initiationState = "id-known";
      changed = true;
    }
    if (message.basis === "api-result" && e.apiOutcome !== "valid-id") {
      e.apiOutcome = "valid-id";
      changed = true;
    }
    if (changed) bump(record);
  }
  if (message.type === "download-observe") {
    if (e.apiOutcome !== message.apiOutcome || e.outcomeCode !== message.code) {
      e.apiOutcome = message.apiOutcome;
      e.outcomeCode = message.code;
      if (e.kind === "output" && e.downloadId === null)
        e.initiationState =
          message.apiOutcome === "failed" ? "api-failed" : "uncertain";
      bump(record);
    }
  }
  if (message.type === "download-update") {
    if (e.downloadId === null || !matchOwnedItem(e, message.item))
      throw P.fault("INVALID_IDENTITY");
    const item = message.item,
      state =
        item.state === "complete"
          ? "complete"
          : item.state === "interrupted"
            ? item.canResume === false
              ? "interrupted-final"
              : item.canResume === true
                ? "interrupted-resumable"
                : "unknown"
            : item.paused
              ? "paused"
              : "in_progress";
    if (e.downloadState !== "complete") {
      const changed =
        e.downloadState !== state ||
        (e.kind === "output" &&
          (e.paused !== item.paused ||
            e.canResume !== (item.canResume ?? null)));
      e.downloadState = state;
      if (e.kind === "output") {
        e.paused = item.paused;
        e.canResume = item.canResume ?? null;
      }
      if (changed) bump(record);
    }
  }
  if (message.type === "download-release") {
    if (e.kind === "tombstone") return { ok: true, entry: publicEntry(record) };
    const allowed =
      message.reason === "DISCARDED_UNARMED"
        ? e.sourceState === "encoded"
        : message.reason === "CANCELLED_BEFORE_INITIATION"
          ? e.downloadId === null && e.downloadState === "unknown"
          : message.reason === "DOWNLOAD_COMPLETE"
            ? e.downloadState === "complete"
            : message.reason === "DOWNLOAD_INTERRUPTED_FINAL"
              ? e.downloadState === "interrupted-final" && e.canResume === false
              : Date.now() >= e.expiresAt;
    if (!allowed) throw P.fault("INVALID_IDENTITY");
    releaseSource(record, message.reason);
  }
  return { ok: true, entry: publicEntry(record) };
}
const sharedFirefox = (() => {
  const m = chrome.runtime.getManifest();
  return (
    m.browser_specific_settings?.gecko?.id ===
      "capture-full-page@ohokthisisfine.github" &&
    JSON.stringify(m.background?.scripts) ===
      JSON.stringify([
        "capture-protocol.js",
        "offscreen.js",
        "service-worker.js",
      ])
  );
})();
let workerCallback = null,
  workerMarker = null;
if (sharedFirefox)
  globalThis.__cfpRegisterWorkerNotifications = (callback) => {
    if (typeof callback !== "function") throw P.fault("INVALID_IDENTITY");
    workerCallback = callback;
    workerMarker = Object.freeze({});
    return workerMarker;
  };
async function notifyWorker(notification) {
  const normalized = P.validateNotification(notification);
  let timer;
  try {
    const operation = sharedFirefox
      ? workerCallback
        ? workerCallback(normalized, workerMarker)
        : Promise.reject(P.fault("TRANSPORT_FAILED"))
      : chrome.runtime.sendMessage(normalized);
    const ack = await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(P.fault("TRANSPORT_FAILED")), 2000);
      }),
    ]);
    P.ownRecord(ack, [...Object.keys(normalized), "ok", "queued"]);
    if (
      ack.ok !== true ||
      ack.queued !== true ||
      Object.keys(normalized).some(
        (k) => JSON.stringify(ack[k]) !== JSON.stringify(normalized[k]),
      )
    )
      throw P.fault("INVALID_ENVELOPE");
    return ack;
  } finally {
    clearTimeout(timer);
  }
}
let periodicTimer = null;
function reconcileNotification(intentIds, reason) {
  if (!requesterOwner || !intentIds.length) return;
  notifyWorker({
    target: "cfp-worker",
    type: "download-reconcile-needed",
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    requesterOwner,
    contextId,
    lifecycleGeneration,
    intentIds,
    reason,
  }).catch(() => {});
}
function schedulePeriodic() {
  if (periodicTimer !== null) return;
  periodicTimer = setTimeout(() => {
    periodicTimer = null;
    const ids = [...outputRecords.values()]
      .filter((r) => r.wire.kind === "output" && r.wire.sourceState === "armed")
      .map((r) => r.wire.intentId);
    reconcileNotification(ids, "periodic");
    if (ids.length) schedulePeriodic();
  }, 30000);
}
function authenticatedWorker(sender) {
  return (
    sender?.id === chrome.runtime.id &&
    !sender.tab &&
    sender.url === chrome.runtime.getURL("service-worker.js")
  );
}
if (!sharedFirefox)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "cfp-offscreen") return;
    if (!authenticatedWorker(sender)) {
      sendResponse(
        P.errorResult("INVALID_SENDER", "Untrusted compositor sender."),
      );
      return;
    }
    trustedBackgroundEntry(message).then(sendResponse);
    return true;
  });
async function trustedBackgroundEntry(message) {
  let echo;
  try {
    echo = envelope(message);
  } catch {
    return {
      target: "cfp-offscreen",
      type: "protocol-error",
      protocolVersion: 1,
      requestId: P.uuid(message?.requestId) ? message.requestId : null,
      ...P.errorResult("INVALID_ENVELOPE", "Invalid compositor envelope."),
    };
  }
  try {
    return { ...echo, ...(await handle(message)) };
  } catch (error) {
    return { ...echo, ...P.errorResult(error.code || "CAPTURE_FAILED") };
  }
}
function assertSessionIdentity(s, message) {
  if (
    !s ||
    ["operationId", "sessionId", "owner"].some((k) => s[k] !== message[k])
  )
    throw P.fault("INVALID_IDENTITY", "Capture session identity mismatch.");
}
async function handle(message) {
  for (const record of outputRecords.values())
    if (record.wire.kind === "output" && Date.now() >= record.wire.expiresAt)
      releaseSource(record, "SOURCE_EXPIRED");
  if (message.type === "status" || message.type === "download-list") {
    requesterOwner = message.requesterOwner;
    return {
      ok: true,
      ...statusSnapshot(),
      ...(message.type === "download-list"
        ? { entries: [...outputRecords.values()].map(publicEntry) }
        : {}),
    };
  }
  if (message.type.startsWith("download-")) return handleOutput(message);
  if (message.type === "start") {
    for (const [id, expires] of closedSessions)
      if (Date.now() >= expires) closedSessions.delete(id);
    if (
      closedSessions.has(message.sessionId) ||
      [...outputRecords.values()].some(
        (r) => r.wire.sessionId === message.sessionId,
      )
    )
      throw P.fault("CANCELLED");
    if (sessions.size) throw P.fault("ALREADY_STARTED");
    if (closedSessions.size >= 20) throw P.fault("RESOURCE_LIMIT");
    if (
      ["owner", "operationId", "sessionId"].some(
        (k) => message.prep[k] !== message[k],
      )
    )
      throw P.fault("INVALID_IDENTITY");
    const status = statusSnapshot();
    if (
      status.retainedUrlCount + 1 > P.MAX_RETAINED_URLS ||
      status.retainedUrlBytes + message.budget.maxOutputBytes >
        P.MAX_RETAINED_URL_BYTES ||
      P.MAX_ACCOUNTED_BYTES - status.accountedBytes < 128 * 1024 * 1024
    )
      throw P.fault("RESOURCE_LIMIT");
    const session = createSession(message.prep, message.owner);
    Object.assign(session, {
      operationId: message.operationId,
      sessionId: message.sessionId,
      captureContext: { ...message.captureContext },
      operationEnvelopeBytes: Math.min(
        message.budget.operationEnvelopeBytes,
        P.MAX_ACCOUNTED_BYTES -
          status.retainedUrlBytes -
          status.pendingDisposalBytes,
      ),
      maxOutputBytes: message.budget.maxOutputBytes,
      operationExpiresAt: Math.min(
        message.deadlines.operationExpiresAt,
        Date.now() + P.MAX_OPERATION_MS,
      ),
      captureExpiresAt: Math.min(
        message.deadlines.captureExpiresAt,
        Date.now() + P.MAX_CAPTURE_MS,
      ),
      encodeBudgetMs: message.deadlines.encodeBudgetMs,
    });
    session.operationDeadline =
      monoNow() + Math.max(0, session.operationExpiresAt - Date.now());
    session.captureDeadline =
      monoNow() + Math.max(0, session.captureExpiresAt - Date.now());
    session.metadataLease = reserveBytes(
      session,
      "captureMetadata",
      {},
      16 * 1024 * 1024,
    );
    sessions.set(message.sessionId, session);
    requesterOwner = message.owner;
    lifecycleGeneration++;
    renewSession(message.sessionId);
    return { ok: true };
  }
  const s = sessions.get(message.sessionId);
  if (message.type === "abort" && message.reason !== "WORKER_REPLACED" && !s) {
    const matches = [...outputRecords.values()].filter((r) =>
      ["operationId", "sessionId", "owner"].every(
        (k) => r.wire[k] === message[k],
      ),
    );
    if (!matches.length && !closedSessions.has(message.sessionId))
      throw P.fault("INVALID_IDENTITY");
    for (const record of matches)
      if (
        record.wire.kind === "output" &&
        record.wire.sourceState === "encoded"
      )
        releaseSource(record, "DISCARDED_UNARMED");
    return { ok: true, idle: isIdle() };
  }
  assertSessionIdentity(s, message);
  if (message.type === "abort") {
    if (
      message.reason === "WORKER_REPLACED" &&
      (message.expectedContextId !== contextId ||
        message.expectedLifecycleGeneration !== lifecycleGeneration)
    )
      throw P.fault("STALE_RECOVERY");
    cleanupSession(message.sessionId);
    return { ok: true, idle: isIdle() };
  }
  if (s.busy) throw P.fault("SESSION_BUSY");
  const token = {};
  s.busy = token;
  try {
    return message.type === "frame"
      ? await addFrame(message)
      : await finish(message.sessionId, message.intentId);
  } catch (error) {
    if (
      ![
        "FRAME_SEQUENCE_MISMATCH",
        "SCROLL_CHANGED",
        "STALE_DOCUMENT",
        "GEOMETRY_CHANGED",
      ].includes(error.code)
    )
      cleanupSession(message.sessionId);
    throw error;
  } finally {
    if (s.busy === token) s.busy = null;
  }
}

function createSession(prep, owner) {
  return {
    prep,
    phase: "capturing",
    nativePending: new Set(),
    plan: P.makeTraversal(prep),
    owner,
    lastAcceptedSpec: null,
    finalizedThroughIndex: -1,
    firstBitmapWidth: null,
    firstBitmapHeight: null,
    currentRow: -1,
    priorRowsBottom: 0,
    rowRight: 0,
    rowBottom: 0,
    rowDestY: 0,
    cancelled: false,
    controller: new AbortController(),
    ratioX: null,
    ratioY: null,
    widthPx: null,
    heightPx: null,
    tileHeight: null,
    activeTiles: new Map(),
    savedTiles: new Map(),
    lastDestY: 0,
    frames: 0,
  };
}

function renewSession(id, encoding = false) {
  const s = sessions.get(id);
  if (!s) return;
  if (encoding && s.phase !== "encoding") {
    s.phase = "encoding";
    s.encodeExpiresAt = Math.min(
      s.operationExpiresAt,
      Date.now() + Math.min(P.MAX_ENCODE_MS, s.encodeBudgetMs),
    );
    s.encodeDeadline = monoNow() + Math.max(0, s.encodeExpiresAt - Date.now());
    lifecycleGeneration++;
  }
  clearTimeout(s.deadline);
  const remaining = Math.min(
    s.operationDeadline - monoNow(),
    (s.phase === "encoding" ? s.encodeDeadline : s.captureDeadline) - monoNow(),
  );
  s.deadline = setTimeout(
    () => {
      if (sessions.get(id) === s) cleanupSession(id);
      if (isIdle()) notifyIdle();
    },
    Math.max(0, remaining),
  );
}
function checkSession(s) {
  if (s.cancelled || sessions.get(s.sessionId) !== s)
    throw P.fault("CANCELLED");
  if (monoNow() >= s.operationDeadline || Date.now() >= s.operationExpiresAt)
    throw P.fault("OPERATION_TIMEOUT");
  if (
    s.phase === "encoding"
      ? monoNow() >= s.encodeDeadline || Date.now() >= s.encodeExpiresAt
      : monoNow() >= s.captureDeadline || Date.now() >= s.captureExpiresAt
  )
    throw P.fault(
      s.phase === "encoding" ? "ENCODE_TIMEOUT" : "CAPTURE_TIMEOUT",
    );
}

async function addFrame(message) {
  const s = sessions.get(message.sessionId);
  if (!s) throw new Error("Unknown capture session.");
  renewSession(message.sessionId);

  P.validateSpec(s.plan, message.spec);
  const expected = P.nextFrameSpec(s.plan, s.lastAcceptedSpec);
  if (!P.sameSpec(message.spec, expected))
    throw P.fault(
      "FRAME_SEQUENCE_MISMATCH",
      "Unexpected frame sequence or coordinates.",
    );
  const validation = P.snapshotPair(
    s.plan,
    message.spec,
    message.preSnapshot,
    message.postSnapshot,
  );
  if (!validation.ok)
    throw P.fault(validation.code, "Frame snapshot rejected.");
  P.validateFrameDataUrl(message.dataUrl);
  const strings = reserveBytes(
    s,
    "transportStrings",
    {},
    4 * message.dataUrl.length,
  );
  // Native awaits protect their immediate input. These frame locals remain
  // reachable across every await, including tile finalization, until finally.
  strings.retainedByFrame = true;
  let response, blob, blobLease, bitmap, bitmapLease;
  try {
    response = await nativeAwait(s, strings, () =>
      fetch(message.dataUrl, { signal: s.controller.signal }),
    );
    checkSession(s);
    if (!response.ok) throw P.fault("CAPTURE_FAILED");
    blob = await nativeAwait(s, strings, () => response.blob());
    blobLease = observeReturnedAllocation(s, "inputBlob", blob, blob.size);
    blobLease.retainedByFrame = true;
    checkSession(s);
    bitmap = await nativeAwait(s, blobLease, () => createImageBitmap(blob));
    const bitmapBytes = inspectReturnedBitmap(s, bitmap);
    bitmapLease = observeReturnedAllocation(
      s,
      "frameBitmap",
      bitmap,
      bitmapBytes,
    );
    bitmapLease.retainedByFrame = true;
    checkSession(s);
    if (s.ratioX == null) initializeGeometry(s, bitmap);
    else if (
      bitmap.width !== s.firstBitmapWidth ||
      bitmap.height !== s.firstBitmapHeight
    )
      throw P.fault("BITMAP_SCALE_CHANGED", "Screenshot dimensions changed.");
    for (const snap of [message.preSnapshot, message.postSnapshot]) {
      if (
        Math.round(snap.logicalX * s.ratioX) !==
          Math.round(message.spec.logicalX * s.ratioX) ||
        Math.round(snap.logicalY * s.ratioY) !==
          Math.round(message.spec.logicalY * s.ratioY) ||
        Math.round(snap.sourceLeft * s.ratioX) !==
          Math.round(message.spec.sourceLeft * s.ratioX) ||
        Math.round(snap.sourceTop * s.ratioY) !==
          Math.round(message.spec.sourceTop * s.ratioY)
      )
        throw P.fault(
          "SCROLL_CHANGED",
          "Scroll offset changes device pixel placement.",
        );
    }
    const rect = P.frameRect(s.prep, message.spec, bitmap.width, bitmap.height);
    const novelRect = P.novelFrameRect(
      s.plan,
      message.spec,
      bitmap.width,
      bitmap.height,
    );
    const { dx: destX, dy: destY } = rect;
    let priorRowsBottom = s.priorRowsBottom,
      rowRight = s.rowRight;
    if (message.spec.row !== s.currentRow) {
      if (
        message.spec.row !== s.currentRow + 1 ||
        (s.currentRow >= 0 && s.rowRight !== s.widthPx)
      )
        throw P.fault("INCOMPLETE_COVERAGE");
      priorRowsBottom = s.rowBottom;
      rowRight = 0;
      if (s.currentRow >= 0) await finalizeTilesBefore(s, destY);
    } else if (destY !== s.rowDestY || destY + rect.sh !== s.rowBottom)
      throw P.fault("INCOMPLETE_COVERAGE");
    if (
      rect.dx > rowRight ||
      rect.dy > priorRowsBottom ||
      (message.spec.column === 0 && rect.dx !== 0)
    )
      throw P.fault("INCOMPLETE_COVERAGE");
    const left = Math.max(rect.dx, rowRight),
      top = Math.max(rect.dy, priorRowsBottom),
      width = rect.dx + rect.sw - left,
      height = rect.dy + rect.sh - top;
    const localNovel =
      width <= 0 || height <= 0
        ? null
        : {
            sx: rect.sx + left - rect.dx,
            sy: rect.sy + top - rect.dy,
            sw: width,
            sh: height,
            dx: left,
            dy: top,
          };
    if (!P.sameRect(novelRect, localNovel))
      throw P.fault("INCOMPLETE_COVERAGE");
    checkSession(s);
    if (novelRect)
      drawAcrossTiles(
        s,
        bitmap,
        novelRect.sx,
        novelRect.sy,
        novelRect.sw,
        novelRect.sh,
        novelRect.dx,
        novelRect.dy,
      );
    checkSession(s);
    Object.assign(s, {
      currentRow: message.spec.row,
      priorRowsBottom,
      rowRight: Math.max(rowRight, rect.dx + rect.sw),
      rowBottom: rect.dy + rect.sh,
      rowDestY: rect.dy,
      lastAcceptedSpec: message.spec,
    });
    s.lastDestY = Math.max(s.lastDestY, destY);
    s.frames += 1;
    return {
      ok: true,
      acceptedSequence: message.spec.sequence,
      bitmapWidth: bitmap.width,
      bitmapHeight: bitmap.height,
      rect,
      novelRect,
    };
  } finally {
    try {
      bitmap?.close();
    } finally {
      bitmap = null;
      blob = null;
      response = null;
      message.dataUrl = null;
      for (const lease of [bitmapLease, blobLease, strings]) {
        if (!lease) continue;
        lease.retainedByFrame = false;
        releaseBytes(lease);
      }
    }
  }
}

function initializeGeometry(s, bitmap) {
  s.firstBitmapWidth = bitmap.width;
  s.firstBitmapHeight = bitmap.height;
  s.ratioX = bitmap.width / s.prep.windowWidth;
  s.ratioY = bitmap.height / s.prep.windowHeight;

  if (
    !Number.isFinite(s.ratioX) ||
    !Number.isFinite(s.ratioY) ||
    s.ratioX <= 0 ||
    s.ratioY <= 0
  ) {
    throw new Error("Invalid screenshot scale ratio.");
  }

  s.widthPx = Math.floor(s.prep.targetWidth * s.ratioX);
  s.heightPx = Math.floor(s.prep.targetHeight * s.ratioY);

  if (s.widthPx <= 0 || s.heightPx <= 0) throw P.fault("RESOURCE_LIMIT");
  if (s.widthPx > 32767) {
    throw new Error(`Page is too wide to encode (${s.widthPx}px).`);
  }

  const outputPixels = s.widthPx * s.heightPx;
  if (!Number.isFinite(outputPixels) || outputPixels > MAX_OUTPUT_PIXELS) {
    throw new Error(
      `Screenshot is too large to encode safely (${s.widthPx} × ${s.heightPx}px).`,
    );
  }

  s.tileHeight = Math.max(
    1,
    Math.min(MAX_TILE_HEIGHT, Math.floor(MAX_TILE_PIXELS / s.widthPx)),
  );
}

function drawAcrossTiles(s, bitmap, sx, sy, sw, sh, dx, dy) {
  const yEnd = dy + sh;
  let y = dy;

  while (y < yEnd) {
    const tileIndex = Math.floor(y / s.tileHeight);
    const tile = getTile(s, tileIndex);
    const globalTileTop = tileIndex * s.tileHeight;
    const localY = y - globalTileTop;
    const amount = Math.min(yEnd - y, tile.height - localY);
    const sourceY = sy + (y - dy);

    tile.ctx.drawImage(bitmap, sx, sourceY, sw, amount, dx, localY, sw, amount);

    const tail = tile.coverage.at(-1);
    if (
      tail &&
      tail.y0 === localY &&
      tail.y1 === localY + amount &&
      tail.x1 === dx
    )
      tail.x1 = dx + sw;
    else {
      if (
        (s.coverageRectCount || 0) >= P.MAX_CAPTURE_FRAMES * 3 ||
        ((s.coverageRectCount || 0) + 1) * 64 > 16 * 1024 * 1024
      )
        throw P.fault("RESOURCE_LIMIT");
      s.coverageRectCount = (s.coverageRectCount || 0) + 1;
      tile.coverage.push({
        x0: dx,
        y0: localY,
        x1: dx + sw,
        y1: localY + amount,
      });
    }
    y += amount;
  }
}

function getTile(s, index) {
  if (index <= s.finalizedThroughIndex || s.savedTiles.has(index))
    throw P.fault(
      "FINALIZED_REGION_REVISIT",
      "Finalized output region cannot be revisited.",
    );
  let tile = s.activeTiles.get(index);
  if (tile) return tile;

  const startY = index * s.tileHeight;
  const height = Math.min(s.tileHeight, s.heightPx - startY);
  if (height <= 0) throw new Error("Capture tile is outside the output image.");

  const lease = reserveBytes(s, "activeCanvas", {}, 4 * s.widthPx * height);
  let canvas;
  try {
    canvas = new OffscreenCanvas(s.widthPx, height);
    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false,
    });
    if (!ctx) throw P.fault("CAPTURE_FAILED");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    tile = { index, height, canvas, ctx, coverage: [], lease };
    checkSession(s);
    s.activeTiles.set(index, tile);
    return tile;
  } catch (error) {
    if (tile && s.activeTiles.get(index) === tile) s.activeTiles.delete(index);
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    releaseBytes(lease);
    throw error;
  }
}

async function finalizeTilesBefore(s, globalY) {
  const safeBeforeIndex = Math.floor(globalY / s.tileHeight);
  const indexes = [...s.activeTiles.keys()]
    .filter((index) => index < safeBeforeIndex)
    .sort((a, b) => a - b);

  for (
    let index = s.finalizedThroughIndex + 1;
    index < safeBeforeIndex;
    index++
  ) {
    if (!s.activeTiles.has(index))
      throw P.fault("MISSING_COVERAGE", "Cannot finalize a missing tile.");
    await finalizeTile(s, index);
    checkSession(s);
    s.finalizedThroughIndex = index;
  }
}

async function finalizeTile(s, index) {
  const tile = s.activeTiles.get(index);
  if (!tile) return;

  if (s.savedTiles.has(index))
    throw P.fault("FINALIZED_REGION_REVISIT", "Tile already saved.");
  validateTileCoverage(
    s.widthPx,
    tile.height,
    tile.coverage,
    index,
    s.tileHeight,
  );
  let blobLease,
    transferred = false;
  try {
    const blob = await nativeAwait(s, tile.lease, () =>
      tile.canvas.convertToBlob({ type: "image/png" }),
    );
    blobLease = observeReturnedAllocation(s, "savedTile", blob, blob.size);
    checkSession(s);
    const saved = {
      blob,
      height: tile.height,
      coverageValidated: true,
      lease: blobLease,
    };
    s.savedTiles.set(index, saved);
    transferred = true;
    tile.canvas.width = 1;
    tile.canvas.height = 1;
    releaseBytes(tile.lease);
    s.coverageRectCount -= tile.coverage.length;
    tile.coverage.length = 0;
    s.activeTiles.delete(index);
  } finally {
    if (!transferred) releaseBytes(blobLease);
    if (s.cancelled) {
      tile.canvas.width = 1;
      tile.canvas.height = 1;
      releaseBytes(tile.lease);
    }
  }
}

async function finish(sessionId, intentId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("Unknown capture session.");
  renewSession(sessionId, true);
  if (P.nextFrameSpec(s.plan, s.lastAcceptedSpec) !== null)
    throw P.fault("MISSING_FRAMES", "Not all planned frames were accepted.");
  if (!s.frames || s.ratioX == null)
    throw new Error("No screenshot frames were captured.");

  if (s.rowRight !== s.widthPx || s.rowBottom !== s.heightPx)
    throw P.fault("INCOMPLETE_COVERAGE");
  const activeIndexes = [...s.activeTiles.keys()].sort((a, b) => a - b);
  for (const index of activeIndexes) await finalizeTile(s, index);

  const expectedTiles = Math.ceil(s.heightPx / s.tileHeight);
  for (let i = 0; i < expectedTiles; i += 1) {
    const tile = s.savedTiles.get(i);
    if (!tile) {
      throw new Error(
        `Capture is incomplete: output tile ${i} was never captured.`,
      );
    }
    if (tile.coverageValidated !== true) throw P.fault("INCOMPLETE_COVERAGE");
  }

  const pngBlob = await encodePngFromTiles(s);
  checkSession(s);
  let lease, url, record;
  try {
    if (
      !Number.isSafeInteger(pngBlob.size) ||
      pngBlob.size <= 0 ||
      pngBlob.size > s.maxOutputBytes
    )
      throw P.fault("RESOURCE_LIMIT");
    lease = s.encodedBlobPendingHandoff;
    if (
      !lease ||
      lease.backing !== pngBlob ||
      resources.get(pngBlob) !== lease ||
      lease.owner !== s ||
      lease.category !== "pendingOutputBlob"
    )
      throw P.fault("RESOURCE_LIMIT");
    checkSession(s);
    if (outputRecords.has(intentId)) throw P.fault("INVALID_IDENTITY");
    url = URL.createObjectURL(pngBlob);
    if (
      typeof url !== "string" ||
      new TextEncoder().encode(url).byteLength > 512 ||
      !url.startsWith("blob:")
    )
      throw P.fault("INVALID_ENVELOPE");
    const createdAt = Date.now(),
      wire = {
        kind: "output",
        intentId,
        operationId: s.operationId,
        sessionId,
        owner: s.owner,
        ...s.captureContext,
        url,
        width: s.widthPx,
        height: s.heightPx,
        byteLength: pngBlob.size,
        createdAt,
        expiresAt: createdAt + 600000,
        revision: 0,
        sourceState: "encoded",
        initiationState: "not-armed",
        downloadId: null,
        downloadState: "unknown",
        paused: false,
        canResume: null,
        apiOutcome: "pending",
        outcomeCode: null,
        terminalAt: null,
      };
    P.validateOutputRecord(wire);
    checkSession(s);
    record = { wire, blob: pngBlob, lease, timers: [] };
    outputRecords.set(intentId, record);
    blobUrls.add(url);
    lease.category = "retainedOutput";
    lease.owner = null;
    s.encodedBlobPendingHandoff = null;
    ledgerRevision++;
    lifecycleGeneration++;
    scheduleSourceExpiry(record);
    const response = {
      ok: true,
      intentId,
      url,
      width: wire.width,
      height: wire.height,
      byteLength: wire.byteLength,
      revision: wire.revision,
      sourceState: "encoded",
    };
    cleanupSession(sessionId, { completed: true });
    return response;
  } catch (error) {
    if (record && outputRecords.get(intentId) === record) {
      outputRecords.delete(intentId);
      blobUrls.delete(url);
      ledgerRevision++;
    }
    if (url) URL.revokeObjectURL(url);
    releaseBytes(lease);
    s.encodedBlobPendingHandoff = null;
    throw error;
  }
}

function validateTileCoverage(width, height, rects, tileIndex, tileHeight) {
  if (!rects?.length) {
    throw new Error(
      `Capture is incomplete: output tile ${tileIndex} has no pixels.`,
    );
  }

  const yBoundaries = new Set([0, height]);
  for (const rect of rects) {
    const y0 = Math.max(0, Math.min(height, rect.y0));
    const y1 = Math.max(0, Math.min(height, rect.y1));
    if (y1 > y0) {
      yBoundaries.add(y0);
      yBoundaries.add(y1);
    }
  }

  const ys = [...yBoundaries].sort((a, b) => a - b);

  for (let i = 0; i < ys.length - 1; i += 1) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    if (y1 <= y0) continue;

    const intervals = [];
    for (const rect of rects) {
      if (rect.y0 > y0 || rect.y1 < y1) continue;
      const x0 = Math.max(0, Math.min(width, rect.x0));
      const x1 = Math.max(0, Math.min(width, rect.x1));
      if (x1 > x0) intervals.push([x0, x1]);
    }

    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    let coveredTo = 0;
    for (const [x0, x1] of intervals) {
      if (x0 > coveredTo) break;
      coveredTo = Math.max(coveredTo, x1);
      if (coveredTo >= width) break;
    }

    if (coveredTo < width) {
      const globalY = tileIndex * tileHeight + y0;
      throw new Error(
        `Capture is incomplete near output row ${globalY}: pixels after x=${coveredTo} are missing.`,
      );
    }
  }
}

function cleanupSession(sessionId, { completed = false } = {}) {
  const s = sessions.get(sessionId);
  if (!s) return;

  s.cancelled = true;
  if (!completed) closedSessions.set(sessionId, s.operationExpiresAt);
  lifecycleGeneration++;
  clearTimeout(s.deadline);
  s.controller.abort();
  for (const tile of s.activeTiles.values()) {
    if (tile.lease?.pending) continue;
    try {
      tile.canvas.width = 1;
      tile.canvas.height = 1;
    } catch {}
    tile.coverage.length = 0;
  }

  s.activeTiles.clear();
  s.savedTiles.clear();
  sessions.delete(sessionId);
  for (const lease of [...resources.values()])
    if (lease.owner === s && !lease.pending && !lease.retainedByFrame)
      releaseBytes(lease);
}

function isIdle() {
  return sessions.size === 0 && blobUrls.size === 0 && resources.size === 0;
}

function allocate(s, category, bytes, factory) {
  const token = {},
    lease = reserveBytes(s, category, token, bytes);
  try {
    const value = factory();
    resources.delete(token);
    lease.backing = value;
    resources.set(value, lease);
    return { value, lease };
  } catch (error) {
    releaseBytes(lease);
    throw error;
  }
}
function makeScanlineSource(s) {
  const state = {
    disposed: false,
    index: 0,
    loadedTileIndex: null,
    row: 0,
    canvas: null,
    ctx: null,
    canvasLease: null,
    bitmap: null,
    bitmapLease: null,
  };
  const queue = reserveBytes(
    s,
    "scanlineQueue",
    {},
    4 * 16 * (s.widthPx * 4 + 1),
  );
  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.bitmap?.close();
    state.bitmap = null;
    releaseBytes(state.bitmapLease);
    state.bitmapLease = null;
    if (state.canvas) {
      state.canvas.width = 1;
      state.canvas.height = 1;
    }
    state.canvas = null;
    state.ctx = null;
    releaseBytes(state.canvasLease);
    state.canvasLease = null;
    if (!queue.pending) releaseBytes(queue);
  };
  const stream = new ReadableStream(
    {
      async pull(controller) {
        let imageLease, outLease;
        try {
          if (state.disposed) throw P.fault("CANCELLED");
          checkSession(s);
          if (state.loadedTileIndex === null) {
            if (state.index === Math.ceil(s.heightPx / s.tileHeight)) {
              controller.close();
              return;
            }
            let tile = s.savedTiles.get(state.index);
            if (!tile) throw P.fault("INCOMPLETE_COVERAGE");
            let decoded;
            try {
              decoded = await nativeAwait(s, tile.lease, () =>
                createImageBitmap(tile.blob),
              );
              const bytes = inspectReturnedBitmap(s, decoded);
              state.bitmapLease = observeReturnedAllocation(
                s,
                "tileBitmap",
                decoded,
                bytes,
              );
              if (state.disposed) throw P.fault("CANCELLED");
              checkSession(s);
              if (decoded.width !== s.widthPx || decoded.height !== tile.height)
                throw P.fault("BITMAP_SCALE_CHANGED");
              state.bitmap = decoded;
              const canvas = allocate(
                s,
                "scratchCanvas",
                4 * s.widthPx * tile.height,
                () => new OffscreenCanvas(s.widthPx, tile.height),
              );
              state.canvas = canvas.value;
              state.canvasLease = canvas.lease;
              state.ctx = state.canvas.getContext("2d", {
                alpha: false,
                willReadFrequently: true,
              });
              if (!state.ctx) throw P.fault("CAPTURE_FAILED");
              state.ctx.drawImage(decoded, 0, 0);
              state.loadedTileIndex = state.index;
              state.row = 0;
              s.savedTiles.delete(state.index);
              const inputLease = tile.lease;
              tile = null;
              releaseBytes(inputLease);
            } finally {
              decoded?.close();
              state.bitmap = null;
              releaseBytes(state.bitmapLease);
              state.bitmapLease = null;
              if (s.cancelled && tile) {
                const retained = tile.lease;
                tile = null;
                releaseBytes(retained);
              }
            }
          }
          const rows = Math.min(16, state.canvas.height - state.row),
            stride = 4 * s.widthPx;
          const image = allocate(
            s,
            "imageData",
            rows * stride,
            () => state.ctx.getImageData(0, state.row, s.widthPx, rows).data,
          );
          imageLease = image.lease;
          const output = allocate(
            s,
            "filteredScanlines",
            rows * (stride + 1),
            () => new Uint8Array(rows * (stride + 1)),
          );
          outLease = output.lease;
          for (let r = 0; r < rows; r++) {
            output.value[r * (stride + 1)] = 0;
            output.value.set(
              image.value.subarray(r * stride, (r + 1) * stride),
              r * (stride + 1) + 1,
            );
          }
          checkSession(s);
          if (state.disposed) throw P.fault("CANCELLED");
          controller.enqueue(output.value);
          state.row += rows;
          if (state.row === state.canvas.height) {
            state.canvas.width = 1;
            state.canvas.height = 1;
            state.canvas = null;
            state.ctx = null;
            releaseBytes(state.canvasLease);
            state.canvasLease = null;
            state.loadedTileIndex = null;
            state.index++;
          }
        } catch (error) {
          dispose();
          controller.error(error);
        } finally {
          releaseBytes(imageLease);
          releaseBytes(outLease);
        }
      },
      cancel() {
        dispose();
      },
    },
    { highWaterMark: 1 },
  );
  return { stream, dispose, queue, state };
}
async function collectIdatChunks(reader, s, encoding) {
  const staging = allocate(
    s,
    "idatStaging",
    P.IDAT_PAYLOAD_BYTES,
    () => new Uint8Array(P.IDAT_PAYLOAD_BYTES),
  );
  encoding.leases.add(staging.lease);
  encoding.staging = staging.value;
  let used = 0,
    chunkCount = 0,
    encodedBytes = 45;
  const append = (size) => {
    if (
      chunkCount + 1 > P.MAX_IDAT_CHUNKS ||
      encodedBytes + size + 12 > s.maxOutputBytes
    )
      throw P.fault("RESOURCE_LIMIT");
    const part = allocate(s, "encodedPart", size + 12, () =>
      encodePngChunk("IDAT", encoding.staging.subarray(0, size)),
    );
    encoding.parts.push(part.value);
    encoding.leases.add(part.lease);
    chunkCount++;
    encodedBytes += size + 12;
    used = 0;
  };
  while (true) {
    checkSession(s);
    if (encoding.failed) throw encoding.failed;
    let valueLease;
    try {
      const result = await nativeAwait(s, staging.lease, () => reader.read());
      if (result.done) {
        if (encoding.failed) throw encoding.failed;
        checkSession(s);
        break;
      }
      if (!(result.value instanceof Uint8Array))
        throw P.fault("CAPTURE_FAILED");
      const value = result.value;
      valueLease = observeReturnedAllocation(
        s,
        "compressorValue",
        value.buffer,
        value.buffer.byteLength,
      );
      encoding.leases.add(valueLease);
      if (encoding.failed) throw encoding.failed;
      checkSession(s);
      for (let cursor = 0; cursor < value.length; ) {
        checkSession(s);
        if (encoding.failed) throw encoding.failed;
        const count = Math.min(
          P.IDAT_PAYLOAD_BYTES - used,
          value.length - cursor,
        );
        encoding.staging.set(value.subarray(cursor, cursor + count), used);
        used += count;
        cursor += count;
        if (used === P.IDAT_PAYLOAD_BYTES) {
          append(used);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    } finally {
      releaseBytes(valueLease);
      encoding.leases.delete(valueLease);
    }
  }
  if (used) append(used);
  if (chunkCount === 0) throw P.fault("INCOMPLETE_COVERAGE");
  encoding.staging = null;
  releaseBytes(staging.lease);
  encoding.leases.delete(staging.lease);
  return { parts: encoding.parts, encodedBytes, chunkCount };
}
async function encodePngFromTiles(s) {
  checkSession(s);
  if (typeof CompressionStream !== "function") throw P.fault("CAPTURE_FAILED");
  const source = makeScanlineSource(s),
    encoding = { parts: [], leases: new Set(), staging: null, failed: null };
  let reader, pipePromise, readPromise, cancelPromise, timer, onAbort;
  const drop = () => {
    encoding.parts.length = 0;
    encoding.staging = null;
    for (const lease of encoding.leases)
      if (!lease.pending) {
        releaseBytes(lease);
        encoding.leases.delete(lease);
      }
  };
  const failEncoding = (error) => {
    if (encoding.failed) return;
    encoding.failed = error;
    s.cancelled = true;
    s.controller.abort();
    source.dispose();
    if (reader) {
      try {
        cancelPromise = reader.cancel(error);
        Promise.resolve(cancelPromise).catch(() => {});
      } catch {}
    }
    drop();
  };
  try {
    const compressor = new CompressionStream("deflate");
    reader = compressor.readable.getReader();
    source.queue.pending = true;
    s.nativePending.add(source.queue);
    pipePromise = source.stream.pipeTo(compressor.writable, {
      signal: s.controller.signal,
    });
    pipePromise
      .catch(failEncoding)
      .finally(() => {
        source.queue.pending = false;
        s.nativePending.delete(source.queue);
        if (source.state.disposed) releaseBytes(source.queue);
      })
      .catch(() => {});
    readPromise = collectIdatChunks(reader, s, encoding);
    readPromise
      .catch(failEncoding)
      .finally(() => {
        if (encoding.failed) drop();
      })
      .catch(() => {});
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(encoding.failed || P.fault("CANCELLED"));
      s.controller.signal.addEventListener("abort", onAbort, { once: true });
      if (s.controller.signal.aborted) onAbort();
    });
    const [collected] = await Promise.race([
      Promise.all([readPromise, pipePromise]),
      aborted,
    ]);
    checkSession(s);
    if (encoding.failed) throw encoding.failed;
    const ihdrAllocation = allocate(
      s,
      "pngHeader",
      13,
      () => new Uint8Array(13),
    );
    encoding.leases.add(ihdrAllocation.lease);
    const ihdr = ihdrAllocation.value,
      view = new DataView(ihdr.buffer);
    view.setUint32(0, s.widthPx, false);
    view.setUint32(4, s.heightPx, false);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const signature = allocate(
        s,
        "pngHeader",
        8,
        () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
      header = allocate(s, "pngHeader", 25, () => encodePngChunk("IHDR", ihdr)),
      end = allocate(s, "pngHeader", 12, () =>
        encodePngChunk("IEND", new Uint8Array()),
      );
    for (const part of [signature, header, end])
      encoding.leases.add(part.lease);
    const output = allocate(
      s,
      "pendingOutputBlob",
      collected.encodedBytes,
      () =>
        new Blob(
          [signature.value, header.value, ...collected.parts, end.value],
          { type: "image/png" },
        ),
    );
    if (output.value.size !== collected.encodedBytes) {
      releaseBytes(output.lease);
      throw P.fault("RESOURCE_LIMIT");
    }
    s.encodedBlobPendingHandoff = output.lease;
    source.dispose();
    drop();
    return output.value;
  } catch (error) {
    failEncoding(error);
    const settled = Promise.allSettled([
      pipePromise,
      readPromise,
      cancelPromise,
    ]);
    await Promise.race([
      settled,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
    throw encoding.failed || error;
  } finally {
    clearTimeout(timer);
    if (onAbort) s.controller.signal.removeEventListener("abort", onAbort);
    source.dispose();
    drop();
    if (reader) {
      const release = () => {
        try {
          reader.releaseLock();
        } catch {}
      };
      Promise.allSettled([readPromise, cancelPromise])
        .then(release)
        .catch(() => {});
    }
  }
}

function encodePngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);

  view.setUint32(
    8 + data.length,
    crc32(out.subarray(4, 8 + data.length)),
    false,
  );
  return out;
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/*
 * Firefox MV3 currently uses a background document rather than an extension
 * service worker. When this file is loaded there as a background script, expose
 * the compositor directly so service-worker.js can call it without creating a
 * Chrome offscreen document. In Chrome this global exists only inside the
 * offscreen document, so the service worker still communicates by message.
 */
function notifyIdle() {
  if (!requesterOwner) return;
  notifyWorker({
    target: "cfp-worker",
    type: "offscreen-idle",
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    requesterOwner,
    contextId,
    lifecycleGeneration,
    idle: true,
  }).catch(() => {});
}
if (sharedFirefox) globalThis.__cfpCompositorHandle = trustedBackgroundEntry;
