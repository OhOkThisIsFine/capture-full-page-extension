const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  compositor,
  worker,
  content,
  prep,
  scope,
  deferred,
} = require("./dispatcher-harness.cjs");
const tick = () => new Promise((r) => setImmediate(r));
const identity = { tabId: 0, windowId: 0, incognito: false };
for (const stage of ["decode", "finalize"])
  for (const rejection of [false, true])
    test(`cancel held ${stage} retains all frame-local inputs until ${rejection ? "rejection" : "resolution"} with fresh session coexistence`, async () => {
      const c = compositor(),
        p = prep(scope(), { height: 9000 }),
        held = deferred();
      let entered = false;
      assert.equal((await c.request(p, "start", { prep: p })).ok, true);
      const nativeBitmap = c.c.createImageBitmap,
        NativeCanvas = c.c.OffscreenCanvas;
      if (stage === "decode")
        c.c.createImageBitmap = () => {
          entered = true;
          return held.promise;
        };
      else
        c.c.OffscreenCanvas = class extends NativeCanvas {
          convertToBlob() {
            entered = true;
            return held.promise;
          }
        };
      const plan = c.P.makeTraversal(p);
      let previous = null,
        pending;
      while (!entered) {
        const spec = c.P.nextFrameSpec(plan, previous);
        assert.ok(spec);
        pending = c.frame(p, spec);
        await tick();
        if (!entered) {
          assert.equal((await pending).ok, true);
          previous = spec;
        }
      }
      const s = c.api.sessions.get(p.sessionId),
        inputs = [...c.api.resources.values()].filter(
          (l) =>
            l.owner === s &&
            ["transportStrings", "inputBlob", "frameBitmap"].includes(
              l.category,
            ),
        );
      assert.deepEqual(
        inputs.map((l) => l.category).sort(),
        stage === "decode"
          ? ["inputBlob", "transportStrings"]
          : ["frameBitmap", "inputBlob", "transportStrings"],
      );
      assert.equal(
        inputs.find((l) => l.category === "transportStrings").bytes,
        4 * "data:image/png;base64,AA==".length,
      );
      await c.request(p, "abort");
      for (const lease of inputs)
        assert.equal(c.api.resources.get(lease.backing), lease, lease.category);
      const retained = [...c.api.resources.values()].filter(
          (l) => l.owner === s,
        ),
        retainedBytes = retained.reduce((n, l) => n + l.bytes, 0);
      assert.equal(c.api.statusSnapshot().pendingDisposalBytes, retainedBytes);
      assert.equal(c.api.statusSnapshot().accountedBytes, retainedBytes);
      c.c.createImageBitmap = nativeBitmap;
      c.c.OffscreenCanvas = NativeCanvas;
      const next = prep(scope(), { height: 180 });
      assert.equal((await c.request(next, "start", { prep: next })).ok, true);
      assert.equal(
        (await c.frame(next, c.P.nextFrameSpec(c.P.makeTraversal(next), null)))
          .ok,
        true,
      );
      for (const lease of inputs)
        assert.equal(c.api.resources.get(lease.backing), lease);
      if (rejection) held.reject(Error("synthetic native rejection"));
      else
        held.resolve(
          stage === "decode"
            ? {
                width: 200,
                height: 180,
                close() {
                  c.counts.closed++;
                },
              }
            : new Blob(["late tile"]),
        );
      assert.equal((await pending).ok, false);
      assert.equal(
        [...c.api.resources.values()].filter((l) => l.owner === s).length,
        0,
      );
      assert.equal(c.api.sessions.size, 1);
      assert.equal(c.counts.urls, 0);
      await c.request(next, "abort");
      assert.equal(c.api.resources.size, 0);
    });
test("recovery explicitly orders old tombstones and live outputs, keeps timestamp ties ambiguous", async () => {
  const producer = worker();
  await producer.run();
  await producer.workerApi.reconcileOwnedDownloads();
  await tick();
  const live = [...producer.api.outputRecords.values()][0].wire;
  const w = worker();
  await tick();
  const tombstone = (terminalAt) => ({
    kind: "tombstone",
    ...scope(),
    intentId: scope().owner,
    targetBrowser: "chrome",
    ...identity,
    sourceUrl: "blob:synthetic-prior",
    downloadId: null,
    sourceState: "expired",
    downloadState: "unknown",
    apiOutcome: "timed-out",
    outcomeCode: "SOURCE_EXPIRED",
    revision: 1,
    terminalAt,
  });
  const older = tombstone(live.createdAt - 1);
  w.P.validateOutputRecord(older);
  const current = [...producer.api.outputRecords.values()][0];
  w.api.outputRecords.clear();
  w.api.outputRecords.set(older.intentId, { wire: older });
  w.api.outputRecords.set(live.intentId, current);
  w.workerApi.operationStates.clear();
  let recovered = await w.workerApi.recoverOperationStatus(identity);
  assert.equal(recovered.operationId, live.operationId);
  const newer = tombstone(live.createdAt + 1);
  w.api.outputRecords.set(newer.intentId, { wire: newer });
  w.workerApi.operationStates.clear();
  recovered = await w.workerApi.recoverOperationStatus(identity);
  assert.equal(recovered.operationId, newer.operationId);
  assert.equal(recovered.phase, "expired");
  newer.terminalAt = live.createdAt;
  w.workerApi.operationStates.clear();
  recovered = await w.workerApi.recoverOperationStatus(identity);
  assert.equal(recovered.operationId, null);
  assert.equal(recovered.phase, "idle");
});
test("source expiry publishes terminal status without native events in Firefox shared route", async () => {
  const w = worker({ target: "firefox" });
  await w.run();
  const url = w.downloads[0].url;
  w.items.push({
    id: 0,
    url,
    incognito: false,
    byExtensionId: "synthetic-extension",
    state: "in_progress",
    paused: false,
    canResume: false,
  });
  await w.workerApi.reconcileOwnedDownloads();
  assert.equal(w.workerApi.getOperationState(identity).phase, "saving");
  w.advance(598000);
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(w.workerApi.getOperationState(identity).phase, "saving");
  w.advance(2000);
  for (let i = 0; i < 8; i++) await tick();
  const status = w.workerApi.getOperationState(identity);
  assert.equal(status.phase, "expired");
  assert.equal(status.code, "SOURCE_EXPIRED");
  assert.equal(w.counts.revoked.length, 1);
});
test("new operation resets previous progress, dimensions, warnings and restoration", () => {
  const w = worker(),
    operation = {
      ...identity,
      operationId: scope().operationId,
      captureContext: { incognito: false },
    };
  w.workerApi.setOperationState(operation, "capturing", {
    begin: true,
    acceptedFrames: 9,
    attemptedFrames: 10,
    width: 200,
    height: 900,
    warnings: ["LIVE_MOTION"],
    restoration: {
      status: "acknowledged",
      restoredCount: 7,
      preservedPageChanges: 0,
      failedCount: 0,
      codes: [],
    },
  });
  const next = { ...operation, operationId: scope().operationId };
  const status = w.workerApi.setOperationState(next, "preparing", {
    begin: true,
  });
  assert.equal(status.acceptedFrames, 0);
  assert.equal(status.attemptedFrames, 0);
  assert.equal(status.width, null);
  assert.equal(status.height, null);
  assert.equal(status.warnings.length, 0);
  assert.equal(status.restoration, null);
});
for (const stage of ["getContexts", "createDocument", "executeScript"])
  test(`cancel held setup ${stage} settles foreground and permits another start while retaining native effect`, async () => {
    const w = worker(),
      held = deferred(),
      entered = deferred();
    await tick();
    if (stage === "getContexts")
      w.workerContext.chrome.runtime.getContexts = () => {
        entered.resolve();
        return held.promise;
      };
    if (stage === "createDocument") {
      w.workerContext.chrome.runtime.getContexts = async () => [];
      w.workerContext.chrome.offscreen.createDocument = () => {
        entered.resolve();
        return held.promise;
      };
    }
    if (stage === "executeScript")
      w.workerContext.chrome.scripting.executeScript = () => {
        entered.resolve();
        return held.promise;
      };
    const first = w.workerApi.startCapture(w.tab);
    assert.ok(first);
    await entered.promise;
    const status = w.workerApi.getOperationState(identity);
    w.workerApi.cancelRequestedOperation({
      operationId: status.operationId,
      tabId: 0,
      incognito: false,
    });
    await first.done;
    assert.equal(w.workerApi.getActive(), null);
    assert.equal(w.downloads.length, 0);
    const second = w.workerApi.startCapture(w.tab);
    assert.ok(second);
    if (stage === "getContexts")
      w.workerContext.chrome.runtime.getContexts = async () => [{}];
    if (stage === "createDocument")
      w.workerContext.chrome.runtime.getContexts = async () => [{}];
    if (stage === "executeScript")
      w.workerContext.chrome.scripting.executeScript = async () => {};
    held.resolve(stage === "getContexts" ? [{}] : undefined);
    await second.done;
    assert.equal(w.workerApi.getActive(), null);
    assert.equal(w.downloads.length, 1);
  });
test("chunked DOM scan yields to owned cancellation and releases traversal references", async () => {
  const h = content(),
    preparing = h.api.prepare();
  h.waits.shift().resolve();
  await preparing;
  const context = h.api.getState();
  h.api.enableGeometry();
  const before = context.metadataBytes;
  let tail = null;
  for (let i = 0; i < 1000; i++) {
    const node = { nodeType: 1, previousElementSibling: tail };
    tail = node;
  }
  h.root.lastElementChild = tail;
  let visited = 0;
  const scanning = (async () => {
    for await (const node of h.api.batchedElements(h.root, context, 12000))
      visited++;
  })();
  await tick();
  assert.ok(visited <= 256);
  assert.ok(context.domYields?.size);
  await h.api.restore(context);
  await assert.rejects(scanning, (e) => e.code === "CANCELLED");
  assert.ok(visited <= 256);
  assert.equal(context.domYields.size, 0);
  assert.ok(context.metadataBytes >= before);
});
test("late native completion after foreground cleanup schedules one generation-checked idle close", async () => {
  const w = worker();
  await w.run();
  assert.equal(w.workerApi.liveOperations.size, 0);
  let exists = true,
    closed = 0;
  w.workerContext.chrome.runtime.getContexts = async () => (exists ? [{}] : []);
  w.workerContext.chrome.offscreen.closeDocument = async () => {
    closed++;
    exists = false;
  };
  w.runtime.sendMessage = (notification) =>
    new Promise((resolve) => {
      const listener = [
        ...w.workerContext.chrome.runtime.onMessage.listeners,
      ].at(-1);
      listener(
        notification,
        {
          id: w.workerContext.chrome.runtime.id,
          url: w.workerContext.chrome.runtime.getURL("offscreen.html"),
        },
        resolve,
      );
    });
  w.items.push({
    id: 0,
    url: w.downloads[0].url,
    incognito: false,
    byExtensionId: "synthetic-extension",
    state: "complete",
    paused: false,
    canResume: false,
  });
  await w.workerApi.reconcileOwnedDownloads();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(closed, 1);
  assert.equal(w.workerApi.getOperationState(identity).phase, "saved");
  assert.equal(w.counts.revoked.length, 1);
  assert.equal(w.api.resources.size, 0);
});
test("status polling observes expiry when the native notification wake-up is unavailable", async () => {
  const w = worker();
  await w.run();
  w.items.push({
    id: 0,
    url: w.downloads[0].url,
    incognito: false,
    byExtensionId: "synthetic-extension",
    state: "in_progress",
    paused: false,
    canResume: false,
  });
  await w.workerApi.reconcileOwnedDownloads();
  w.advance(600000);
  for (let i = 0; i < 4; i++) await tick();
  const status = await w.workerApi.recoverOperationStatus(identity);
  assert.equal(status.phase, "expired");
  assert.equal(status.code, "SOURCE_EXPIRED");
});
test("control RPCs use phase-specific deadlines and cleanup gets one independent two-second grace", async () => {
  const w = worker(),
    scopeValue = scope(),
    operation = { ...scopeValue, expiresAt: 900000, monoDeadline: 900000 };
  const timeouts = [],
    nativeTimer = w.workerContext.setTimeout;
  w.workerContext.setTimeout = (fn, ms) => {
    timeouts.push(ms);
    return nativeTimer(fn, ms);
  };
  let listener, sent;
  const port = {
    onMessage: {
      addListener(fn) {
        listener = fn;
      },
      removeListener() {},
    },
    onDisconnect: { addListener() {}, removeListener() {} },
    postMessage(message) {
      sent = message;
    },
  };
  const rpc = w.workerApi.createPortRPC(port, scopeValue, operation);
  for (const [method, expected] of [
    ["prepare", 15000],
    ["position", 5000],
    ["snapshot", 2000],
    ["accept-frame", 2000],
  ]) {
    const pending = rpc.call(method, {});
    assert.equal(timeouts.at(-1), expected);
    listener({
      replyTo: sent.id,
      protocolVersion: 1,
      ...scopeValue,
      result: {},
    });
    await pending;
  }
  operation.expiresAt = -1;
  operation.monoDeadline = -1;
  const restore = rpc.call("restore", { reason: "failure" });
  assert.equal(timeouts.at(-1), 2000);
  listener({ replyTo: sent.id, protocolVersion: 1, ...scopeValue, result: {} });
  await restore;
  w.clock.now += 1500;
  const cancel = rpc.call("cancel", { reason: "USER_CANCELLED" });
  assert.equal(timeouts.at(-1), 500);
  listener({ replyTo: sent.id, protocolVersion: 1, ...scopeValue, result: {} });
  await cancel;
  rpc.close();
});
test("real root discovery yields within its DOM batch and cancellation removes owned pause rules", async () => {
  const h = content(),
    preparing = h.api.prepare();
  h.waits.shift().resolve();
  await preparing;
  const context = h.api.getState(),
    doc = h.c.document,
    styles = [];
  doc.nodeType = 9;
  doc.head = {
    appendChild(style) {
      styles.push(style);
    },
  };
  doc.createElement = () => ({
    setAttribute() {},
    remove() {
      styles.splice(styles.indexOf(this), 1);
    },
  });
  let calls = 0,
    tail = null;
  for (let i = 0; i < 1000; i++) {
    const node = {
      nodeType: 1,
      previousElementSibling: tail,
      getAnimations(options) {
        assert.equal(options.subtree, false);
        calls++;
        return [];
      },
    };
    tail = node;
  }
  h.root.lastElementChild = tail;
  const discovering = h.api.discoverCaptureRoots(context, { remaining: 50000 });
  await tick();
  assert.ok(context.domYields.size);
  assert.ok(calls <= 256);
  await h.api.restore(context);
  await assert.rejects(discovering, (e) => e.code === "CANCELLED");
  assert.ok(calls <= 256);
  assert.equal(styles.length, 0);
  assert.equal(context.domYields.size, 0);
});
test("per-frame bounded traversal rejects the 12001st element rather than scanning preparation's full allowance", async () => {
  const h = content(),
    preparing = h.api.prepare();
  h.waits.shift().resolve();
  await preparing;
  const context = h.api.getState();
  h.api.enableGeometry();
  let tail = null;
  for (let i = 0; i < 12001; i++)
    tail = { nodeType: 1, previousElementSibling: tail };
  h.root.lastElementChild = tail;
  let count = 0;
  await assert.rejects(
    (async () => {
      for await (const node of h.api.batchedElements(h.root, context, 12000))
        count++;
    })(),
    (e) => e.code === "RESOURCE_LIMIT",
  );
  assert.equal(count, 12000);
  await h.api.restore(context);
});
test("filtered scanline queue retains the canonical fourfold inflight backing allowance", async () => {
  const c = compositor(),
    p = prep(scope(), { height: 180 });
  await c.request(p, "start", { prep: p });
  await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  const s = c.api.sessions.get(p.sessionId);
  const source = c.api.makeScanlineSource(s);
  assert.equal(source.queue.bytes, 4 * 16 * (s.widthPx * 4 + 1));
  source.dispose();
  await c.request(p, "abort");
  assert.equal(c.api.resources.size, 0);
});
test("owned shorthand undo updates still-owned longhands without inventing page edits", async () => {
  const h = content(),
    preparing = h.api.prepare();
  h.waits.shift().resolve();
  await preparing;
  const context = h.api.getState(),
    axes = new Map();
  h.root.style = {
    getPropertyValue(name) {
      if (name === "overflow")
        return axes.has("x") && axes.has("y")
          ? axes.get("x").value === axes.get("y").value
            ? axes.get("x").value
            : axes.get("x").value + " " + axes.get("y").value
          : "";
      return axes.get("y")?.value || "";
    },
    getPropertyPriority(name) {
      return name === "overflow"
        ? axes.has("x") && axes.has("y")
          ? axes.get("x").priority
          : ""
        : axes.get("y")?.priority || "";
    },
    setProperty(name, value, priority = "") {
      if (name === "overflow") {
        axes.set("x", { value, priority });
        axes.set("y", { value, priority });
      } else axes.set("y", { value, priority });
    },
    removeProperty(name) {
      if (name === "overflow") axes.clear();
      else axes.delete("y");
    },
  };
  h.api.writeOwnedProperty(h.root, "overflow-y", "visible");
  context.rollback.push(() =>
    h.api.restoreProperty(h.root, "overflow-y", "", ""),
  );
  h.api.writeOwnedProperty(h.root, "overflow", "visible");
  context.rollback.push(() =>
    h.api.restoreProperty(h.root, "overflow", "", ""),
  );
  const summary = await h.api.restore(context);
  assert.equal(axes.size, 0);
  assert.equal(summary.preservedPageChanges, 0);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.codes.length, 0);
});
test("a newer page style cannot be legitimized or overwritten by a repeated owned write", async () => {
  const h = content(),
    preparing = h.api.prepare();
  h.waits.shift().resolve();
  await preparing;
  const context = h.api.getState();
  h.api.writeOwnedProperty(h.root, "height", "900px");
  context.rollback.push(() => h.api.restoreProperty(h.root, "height", "", ""));
  h.root.style.setProperty("height", "333px", "important");
  assert.throws(
    () => h.api.writeOwnedProperty(h.root, "height", "1000px"),
    (e) => e.code === "GEOMETRY_CHANGED",
  );
  const summary = await h.api.restore(context);
  assert.equal(h.root.style.getPropertyValue("height"), "333px");
  assert.equal(summary.preservedPageChanges, 1);
  assert.ok(summary.codes.includes("PAGE_STYLE_CHANGED"));
});
