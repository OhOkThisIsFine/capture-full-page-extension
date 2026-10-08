const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { worker, deferred, scope } = require("./dispatcher-harness.cjs");
function request(
  w,
  message,
  sender = {
    id: w.workerContext.chrome.runtime.id,
    url: w.workerContext.chrome.runtime.getURL("popup.html"),
  },
) {
  const listener = [...w.workerContext.chrome.runtime.onMessage.listeners].at(
    -1,
  );
  let returned;
  const promise = new Promise((resolve) => {
    returned = listener(message, sender, resolve);
  });
  return { promise, returned };
}
function identity(w) {
  return {
    tabId: w.tab.id,
    windowId: w.tab.windowId,
    incognito: w.tab.incognito,
  };
}
test("popup commands require exact extension URL, no tab and descriptor-safe request fields", async () => {
  const w = worker(),
    P = w.workerContext.__cfpProtocol,
    message = { type: "capture-status", requestId: scope().owner, windowId: 0 };
  for (const sender of [
    { id: "other", url: w.workerContext.chrome.runtime.getURL("popup.html") },
    {
      id: w.workerContext.chrome.runtime.id,
      url: w.workerContext.chrome.runtime.getURL("other.html"),
    },
    {
      id: w.workerContext.chrome.runtime.id,
      url: w.workerContext.chrome.runtime.getURL("popup.html"),
      tab: { id: 0 },
    },
  ]) {
    assert.equal(
      (await request(w, message, sender).promise).code,
      "INVALID_SENDER",
    );
  }
  for (const field of Object.keys(message)) {
    let reads = 0;
    const bad = { ...message };
    Object.defineProperty(bad, field, {
      enumerable: true,
      get() {
        reads++;
        return message[field];
      },
    });
    assert.throws(() => P.validatePopupRequest(bad));
    assert.equal(reads, 0);
  }
  const valid = request(w, message);
  assert.equal(valid.returned, true);
  const response = await valid.promise;
  assert.equal(response.requestId, message.requestId);
  assert.equal(response.ok, true);
  assert.equal(response.status.phase, "idle");
  assert.equal(w.injections.length, 0);
  assert.equal(w.downloads.length, 0);
});
test("saving is separate from completion and older completion cannot replace a new operation", async () => {
  const w = worker();
  await w.run();
  await w.workerApi.reconcileOwnedDownloads();
  let status = w.workerApi.getOperationState(identity(w));
  assert.notEqual(status.phase, "saved");
  const old = status.operationId,
    item = {
      id: 0,
      url: w.downloads[0].url,
      incognito: false,
      byExtensionId: "synthetic-extension",
      state: "complete",
      paused: false,
      canResume: false,
    };
  w.items.push(item);
  await w.workerApi.reconcileOwnedDownloads();
  status = w.workerApi.getOperationState(identity(w));
  assert.equal(status.phase, "saved");
  const newer = {
    ...identity(w),
    operationId: scope().owner,
    captureContext: { incognito: false },
  };
  w.workerApi.setOperationState(newer, "preparing", { begin: true });
  await w.workerApi.reconcileOwnedDownloads();
  assert.equal(
    w.workerApi.getOperationState(identity(w)).operationId,
    newer.operationId,
  );
  assert.notEqual(newer.operationId, old);
  const serialized = JSON.stringify(status);
  assert.ok(Buffer.byteLength(serialized) <= 1024);
  for (const secret of [
    "blob:",
    "intentId",
    "sessionId",
    "owner",
    "url",
    "title",
  ])
    assert.equal(serialized.includes(secret), false, secret);
});
test("operation-bound cancel aborts held acquisition and reports restoration independently", async () => {
  const held = deferred(),
    w = worker({ capture: () => held.promise });
  const running = w.run().catch((error) => error);
  await w.captureEntered.promise;
  const status = w.workerApi.getOperationState(identity(w));
  assert.equal(status.phase, "capturing");
  assert.throws(
    () =>
      w.workerApi.cancelRequestedOperation({
        operationId: scope().owner,
        tabId: 0,
        incognito: false,
      }),
    (error) => error.code === "INVALID_IDENTITY",
  );
  const ack = w.workerApi.cancelRequestedOperation({
    operationId: status.operationId,
    tabId: 0,
    incognito: false,
  });
  assert.equal(ack.phase, "cancelled");
  const error = await running;
  assert.equal(error.code, "USER_CANCELLED");
  const final = w.workerApi.getOperationState(identity(w));
  assert.equal(final.phase, "cancelled");
  assert.equal(final.restoration.status, "acknowledged");
  assert.equal(w.downloads.length, 0);
  held.resolve();
});
test("close/start is serialized and a rejected close clears only its own lifecycle lock", async () => {
  for (const reject of [false, true]) {
    const w = worker(),
      closing = deferred();
    let exists = true,
      created = 0,
      closeEntered = deferred();
    w.workerContext.chrome.runtime.getContexts = async () =>
      exists ? [{}] : [];
    w.workerContext.chrome.offscreen.closeDocument = () => {
      closeEntered.resolve();
      return closing.promise.then(() => {
        exists = false;
      });
    };
    w.workerContext.chrome.offscreen.createDocument = async () => {
      created++;
      exists = true;
    };
    const close = w.workerApi.closeOffscreenIfIdle().catch((error) => error);
    await closeEntered.promise;
    let ensureDone = false;
    const ensure = w.workerApi.ensureOffscreen().then(() => {
      ensureDone = true;
    });
    await Promise.resolve();
    assert.equal(ensureDone, false);
    if (reject) closing.reject(new Error("synthetic close denial"));
    else closing.resolve();
    await close;
    await ensure;
    assert.equal(created, reject ? 0 : 1);
    assert.equal(ensureDone, true);
  }
});
test("restore summary rejects unknown codes, fabricated disconnected counts and duplicate codes", () => {
  const w = worker(),
    P = w.workerContext.__cfpProtocol;
  assert.throws(() =>
    P.validateRestoreSummary({
      status: "unverified",
      restoredCount: 1,
      preservedPageChanges: 0,
      failedCount: 0,
      codes: ["PORT_DISCONNECTED"],
    }),
  );
  assert.throws(() =>
    P.validateRestoreSummary({
      status: "partial",
      restoredCount: 0,
      preservedPageChanges: 0,
      failedCount: 1,
      codes: ["invented"],
    }),
  );
  assert.throws(() =>
    P.validateRestoreSummary({
      status: "acknowledged",
      restoredCount: 0,
      preservedPageChanges: 1,
      failedCount: 0,
      codes: ["PAGE_SCROLL_CHANGED", "PAGE_SCROLL_CHANGED"],
    }),
  );
});
test("cancel during held native encoding settles the worker and retains pending disposal until reader settlement", async () => {
  const w = worker({ height: 180 }),
    held = deferred(),
    entered = deferred();
  w.c.CompressionStream = class {
    constructor() {
      this.writable = new WritableStream();
      this.readable = {
        getReader: () => ({
          read() {
            entered.resolve();
            return held.promise;
          },
          cancel: () => Promise.reject(Error("synthetic cancel rejection")),
          releaseLock() {},
        }),
      };
    }
  };
  const running = w.run().catch((error) => error);
  await entered.promise;
  const status = w.workerApi.getOperationState(identity(w));
  assert.equal(status.phase, "encoding");
  w.workerApi.cancelRequestedOperation({
    operationId: status.operationId,
    tabId: 0,
    incognito: false,
  });
  assert.equal((await running).code, "USER_CANCELLED");
  assert.equal(w.downloads.length, 0);
  assert.equal(w.counts.urls, 0);
  assert.ok(w.api.statusSnapshot().pendingDisposalBytes >= 1048576);
  w.advance(2000);
  held.resolve({ done: true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.api.resources.size, 0);
  assert.equal(w.counts.urls, 0);
});
