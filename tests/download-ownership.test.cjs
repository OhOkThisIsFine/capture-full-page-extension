const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  zlib = require("node:zlib");
const {
  compositor,
  worker,
  prep,
  scope,
  deferred,
} = require("./dispatcher-harness.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate) {
  for (let step = 0; step < 100; step++) {
    if (predicate()) return;
    await tick();
  }
  assert.ok(predicate(), "synthetic scheduling bound exhausted");
}
async function output(c) {
  const p = prep(scope(), { height: 180 });
  assert.equal((await c.request(p, "start", { prep: p })).ok, true);
  assert.equal(
    (await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null))).ok,
    true,
  );
  c.syntheticEncoder();
  const intentId = scope().owner,
    done = await c.request(p, "finish", { intentId });
  assert.equal(done.ok, true);
  return { p, intentId, done };
}
async function entry(c, p) {
  return (await c.request({ requesterOwner: p.owner }, "download-list"))
    .entries[0];
}
async function arm(c, o) {
  return c.request(o.p, "download-arm", {
    intentId: o.intentId,
    url: o.done.url,
    byteLength: o.done.byteLength,
    targetBrowser: "chrome",
    tabId: 0,
    windowId: 0,
    incognito: false,
  });
}
const item = (e) => ({
  id: 0,
  url: e.url || e.sourceUrl,
  incognito: false,
  state: "complete",
  paused: false,
});
test("strict compositor controls reject old revoke, missing admission and accessor payload without effects", async () => {
  const c = compositor(),
    p = prep();
  let touched = 0;
  const old = {
    target: "cfp-offscreen",
    type: "start",
    protocolVersion: 1,
    requestId: scope().owner,
    operationId: p.operationId,
    sessionId: p.sessionId,
    owner: p.owner,
    prep: p,
  };
  assert.equal((await c.dispatch(old)).code, "INVALID_ENVELOPE");
  const bad = c.envelope(p, "start", { prep: p });
  Object.defineProperty(bad, "budget", {
    get() {
      touched++;
      throw Error("getter");
    },
    enumerable: true,
  });
  assert.equal((await c.dispatch(bad)).code, "INVALID_ENVELOPE");
  assert.equal(touched, 0);
  assert.equal(
    (await c.request(p, "revoke", { url: "blob:other" })).code,
    "INVALID_ENVELOPE",
  );
  assert.equal(c.api.resources.size, 0);
  assert.equal(c.counts.urls, 0);
});
test("exact output intent, revision and immutable native ID govern source release", async () => {
  const c = compositor(),
    o = await output(c),
    a = await arm(c, o);
  assert.equal(a.entry.sourceState, "armed");
  assert.equal((await arm(c, o)).entry.revision, a.entry.revision);
  const b = await c.request(o.p, "download-bind", {
    intentId: o.intentId,
    downloadId: 0,
    expectedRevision: a.entry.revision,
    basis: "api-result",
  });
  assert.equal(b.entry.downloadId, 0);
  assert.equal(
    (
      await c.request(o.p, "download-bind", {
        intentId: o.intentId,
        downloadId: 1,
        expectedRevision: b.entry.revision,
        basis: "api-result",
      })
    ).code,
    "INVALID_IDENTITY",
  );
  assert.equal(
    (
      await c.request(o.p, "download-release", {
        intentId: o.intentId,
        expectedRevision: b.entry.revision,
        reason: "CANCELLED_BEFORE_INITIATION",
      })
    ).code,
    "INVALID_IDENTITY",
  );
  const u = await c.request(o.p, "download-update", {
    intentId: o.intentId,
    expectedRevision: b.entry.revision,
    item: item(b.entry),
  });
  const r = await c.request(o.p, "download-release", {
    intentId: o.intentId,
    expectedRevision: u.entry.revision,
    reason: "DOWNLOAD_COMPLETE",
  });
  assert.equal(r.entry.kind, "tombstone");
  assert.equal(r.entry.downloadState, "complete");
  assert.deepEqual(c.counts.revoked, [o.done.url]);
  assert.equal(c.api.resources.size, 0);
});
test("stale revision cannot overwrite complete and source expiry cannot resurrect pixels", async () => {
  const c = compositor(),
    o = await output(c);
  await arm(c, o);
  c.advance(600001);
  const e = await entry(c, o.p);
  assert.equal(e.sourceState, "expired");
  assert.equal(c.api.resources.size, 0);
  const b = await c.request(o.p, "download-bind", {
    intentId: o.intentId,
    downloadId: 0,
    expectedRevision: e.revision,
    basis: "exact-item",
    item: item(e),
  });
  const complete = await c.request(o.p, "download-update", {
    intentId: o.intentId,
    expectedRevision: b.entry.revision,
    item: item(e),
  });
  assert.equal(complete.entry.downloadState, "complete");
  assert.equal(complete.entry.sourceState, "expired");
  const stale = await c.request(o.p, "download-update", {
    intentId: o.intentId,
    expectedRevision: e.revision,
    item: { ...item(e), state: "in_progress" },
  });
  assert.equal(stale.code, "REVISION_CHANGED");
  assert.equal(c.counts.urls, 1);
  assert.deepEqual(c.counts.revoked, [o.done.url]);
});
test("ordinary browser options stay exact and actual unverified/private tab blocks injection", async () => {
  const w = worker({ height: 180 });
  w.workerContext.browser = {
    downloads: {
      download() {
        throw Error("wrong namespace");
      },
    },
  };
  await w.run();
  assert.equal(w.downloads.length, 1);
  assert.deepEqual(Object.keys(w.downloads[0]).sort(), [
    "conflictAction",
    "filename",
    "saveAs",
    "url",
  ]);
  for (const value of [undefined, true]) {
    const denied = worker({ height: 180 });
    denied.tab.incognito = value;
    await assert.rejects(
      denied.run(),
      (e) =>
        e.code ===
        (value ? "PRIVATE_CAPTURE_UNVERIFIED" : "CAPTURE_CONTEXT_UNVERIFIED"),
    );
    assert.equal(denied.injections.length, 0);
    assert.equal(denied.downloads.length, 0);
  }
  const ff = worker({ height: 180, target: "firefox" });
  await ff.run();
  assert.equal(ff.downloads[0].incognito, false);
  assert.equal(ff.runtime.onMessage.listeners.size, 0);
  assert.equal(typeof ff.c.__cfpCompositorHandle, "function");
});
test("filename keeps local stamp and whole-codepoint UTF8 basename bounds", () => {
  const w = worker();
  const filename = w.workerApi.makeFilename(
    { url: "https://www.example.test/", title: ' /:*?"<>|' + "💫".repeat(200) },
    new Date(2026, 0, 2, 3, 4, 5),
  );
  assert.ok(filename.startsWith("2026-01-02_03-04-05_example.test_"));
  assert.ok(Buffer.byteLength(filename) <= 240);
  assert.equal(/[<>:"/\\|?*\x00-\x1f]/.test(filename), false);
  assert.ok(filename.endsWith(".png"));
});
test("ID zero binds once and early native completion reconciles before promise resolves", async () => {
  const d = deferred(),
    w = worker({
      height: 180,
      download() {
        return d.promise;
      },
    }),
    run = w.run();
  await waitFor(() => w.downloads.length === 1);
  assert.equal(w.downloads.length, 1);
  const download = {
    id: 0,
    url: w.downloads[0].url,
    incognito: false,
    state: "complete",
    paused: false,
  };
  w.items.push(download);
  w.workerContext.chrome.downloads.onCreated.emit(download);
  await tick();
  await tick();
  assert.equal(w.counts.revoked.length, 1);
  d.resolve(0);
  await run;
  await tick();
  assert.equal(w.downloads.length, 1);
  assert.equal(w.counts.revoked.length, 1);
  const e = (
    await w.request({ requesterOwner: scope().owner }, "download-list")
  ).entries[0];
  assert.equal(e.downloadState, "complete");
  assert.equal(e.apiOutcome, "valid-id");
});
test("undefined, synchronous failure and rejection each make exactly one native attempt", async () => {
  for (const download of [
    () => undefined,
    () => {
      throw Error("synthetic");
    },
    () => Promise.reject(Error("synthetic")),
  ]) {
    const w = worker({ height: 180, download });
    await w.run();
    await tick();
    assert.equal(w.downloads.length, 1);
    assert.equal(w.counts.revoked.length, 0);
    assert.equal(w.workerApi.pendingWorkerPixelProducers.size, 0);
  }
});
test("held download foreground times out once and late ID keeps the original armed source", async () => {
  const d = deferred(),
    w = worker({ height: 180, download: () => d.promise }),
    run = w.run();
  await waitFor(() => w.downloads.length === 1);
  assert.equal(w.downloads.length, 1);
  for (const callback of [...w.timers.values()]) callback();
  await run;
  assert.equal(w.counts.revoked.length, 0);
  assert.equal(w.workerApi.pendingWorkerPixelProducers.size, 0);
  d.resolve(0);
  await tick();
  await tick();
  const e = (
    await w.request({ requesterOwner: scope().owner }, "download-list")
  ).entries[0];
  assert.equal(e.downloadId, 0);
  assert.equal(e.sourceState, "armed");
  assert.equal(w.downloads.length, 1);
});
test("cancellation after invocation retains armed source and never replays", async () => {
  const d = deferred(),
    w = worker({ height: 180, download: () => d.promise }),
    run = w.run();
  await waitFor(() => w.downloads.length === 1);
  w.workerContext.chrome.tabs.onActivated.emit({ windowId: 0, tabId: 1 });
  w.workerContext.chrome.tabs.onActivated.emit({ windowId: 0, tabId: 0 });
  for (const callback of [...w.timers.values()]) callback();
  await run;
  assert.equal(w.downloads.length, 1);
  assert.equal(w.counts.revoked.length, 0);
  d.resolve(0);
  await tick();
  assert.equal(w.downloads.length, 1);
});
test("loss during held acquisition latches through A-B-A and blocks recapture until producer settles", async () => {
  const d = deferred(),
    w = worker({ height: 180, capture: () => d.promise }),
    run = w.run();
  await tick();
  w.workerContext.chrome.tabs.onActivated.emit({ windowId: 0, tabId: 1 });
  w.workerContext.chrome.tabs.onActivated.emit({ windowId: 0, tabId: 0 });
  await assert.rejects(run, (e) => e.code === "TAB_CHANGED");
  assert.equal(w.frames.length, 0);
  assert.equal(w.downloads.length, 0);
  assert.equal(w.workerApi.pendingWorkerPixelProducers.size, 1);
  assert.equal(w.workerApi.startCapture(w.tab), null);
  d.resolve();
  await tick();
  assert.equal(w.workerApi.pendingWorkerPixelProducers.size, 0);
});
test("never-invoked cleanup releases exact armed output after lost arm acknowledgment", async () => {
  const w = worker({ height: 180 }),
    runtime = w.workerContext.chrome.runtime,
    send = runtime.sendMessage;
  let armed;
  runtime.sendMessage = async (m) => {
    const result = await send(m);
    if (m.type === "download-arm") {
      armed = result;
      return new Promise(() => {});
    }
    return result;
  };
  const run = w.run();
  await waitFor(() => !!armed);
  assert.equal(armed.entry.sourceState, "armed");
  for (const callback of [...w.timers.values()]) callback();
  await assert.rejects(run, (e) => e.code === "TRANSPORT_FAILED");
  assert.equal(w.downloads.length, 0);
  assert.equal(w.counts.revoked.length, 1);
});
test("deserialized recovery records cannot mint creator-local never-invoked proof", async () => {
  const w = worker({ height: 180 });
  await w.run();
  await tick();
  const e = (
    await w.request({ requesterOwner: scope().owner }, "download-list")
  ).entries[0];
  await assert.rejects(
    w.workerApi.callCompositor(
      { ...e, initiationAttempted: false },
      "download-release",
      {
        intentId: e.intentId,
        expectedRevision: e.revision,
        reason: "CANCELLED_BEFORE_INITIATION",
      },
    ),
    (error) => error.code === "INVALID_IDENTITY",
  );
  assert.equal(w.counts.revoked.length, 0);
});
test("frame allocation failures close bitmap and release exact backing leases before fresh admission", async () => {
  for (const fault of [
    "constructor",
    "null-context",
    "context-throw",
    "fill-throw",
    "insert-before",
    "insert-after",
  ]) {
    const c = compositor(),
      p = prep(scope(), { height: 180 }),
      canvases = [];
    await c.request(p, "start", { prep: p });
    const Native = c.c.OffscreenCanvas;
    c.c.OffscreenCanvas = class extends Native {
      constructor(w, h) {
        if (fault === "constructor") throw Error("constructor");
        super(w, h);
        canvases.push(this);
      }
      getContext() {
        if (fault === "null-context") return null;
        if (fault === "context-throw") throw Error("context");
        const ctx = super.getContext();
        if (fault === "fill-throw")
          ctx.fillRect = () => {
            throw Error("fill");
          };
        return ctx;
      }
    };
    if (fault.startsWith("insert")) {
      const tiles = c.api.sessions.get(p.sessionId).activeTiles,
        insert = tiles.set.bind(tiles);
      tiles.set = (key, value) => {
        if (fault === "insert-after") insert(key, value);
        throw Error("insert");
      };
    }
    const result = await c.frame(
      p,
      c.P.nextFrameSpec(c.P.makeTraversal(p), null),
    );
    assert.equal(result.ok, false);
    assert.equal(c.api.resources.size, 0, fault);
    assert.equal(c.counts.closed, 1, fault);
    assert.equal(c.counts.urls, 0);
    for (const canvas of canvases) assert.equal(canvas.width, 1, fault);
    c.c.OffscreenCanvas = Native;
    const next = prep();
    assert.equal(
      (await c.request(next, "start", { prep: next })).ok,
      true,
      fault,
    );
  }
});
test("abort retains native decode input lease until actual late settlement", async () => {
  const c = compositor(),
    p = prep(),
    d = deferred();
  await c.request(p, "start", { prep: p });
  c.c.createImageBitmap = () => d.promise;
  const pending = c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  await tick();
  await c.request(p, "abort");
  assert.equal(c.api.sessions.size, 0);
  assert.ok(c.api.statusSnapshot().pendingDisposalBytes > 0);
  assert.equal(c.api.statusSnapshot().idle, false);
  d.resolve({
    width: 200,
    height: 180,
    close() {
      c.counts.closed++;
    },
  });
  assert.equal((await pending).ok, false);
  assert.equal(c.counts.closed, 1);
  assert.equal(c.api.resources.size, 0);
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function inflateSingle(bytes, length) {
  const result = zlib.inflateSync(bytes, {
    info: true,
    maxOutputLength: length + 1,
  });
  assert.equal(result.buffer.length, length);
  assert.equal(
    result.engine.bytesWritten,
    bytes.length,
    "trailing compressed input",
  );
  return result.buffer;
}
test("real encoder emits independently checked single-zlib PNG and transfers one charged Blob", async () => {
  const c = compositor(),
    p = prep(scope(), { height: 180 });
  await c.request(p, "start", { prep: p });
  await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  let blob;
  const create = c.c.URL.createObjectURL;
  c.c.URL.createObjectURL = (value) => {
    blob = value;
    const s = c.api.sessions.get(p.sessionId);
    assert.equal(s.cancelled, false);
    assert.equal(s.controller.signal.aborted, false);
    assert.equal(s.encodedBlobPendingHandoff.backing, value);
    return create(value);
  };
  const done = await c.request(p, "finish", { intentId: scope().owner });
  assert.equal(done.ok, true);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const types = [],
    idats = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8),
      payload = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      bytes.readUInt32BE(offset + 8 + length),
      crc(bytes.subarray(offset + 4, offset + 8 + length)),
    );
    types.push(type);
    if (type === "IDAT") idats.push(payload);
    offset += length + 12;
  }
  assert.deepEqual(types, ["IHDR", "IDAT", "IEND"]);
  const compressed = Buffer.concat(idats),
    expected = (200 * 4 + 1) * 180;
  assert.ok(inflateSingle(compressed, expected).every((byte) => byte === 0));
  for (const tail of [
    zlib.deflateSync(Buffer.alloc(0)),
    Buffer.from("arbitrary trailing bytes"),
  ])
    assert.throws(
      () => inflateSingle(Buffer.concat([compressed, tail]), expected),
      /trailing compressed input/,
    );
  assert.equal(c.api.sessions.size, 0);
  assert.equal(c.api.resources.size, 1);
  assert.equal(c.api.statusSnapshot().retainedUrlBytes, blob.size);
});
test("URL and partial ledger insertion failure leave no orphan handoff charge", async () => {
  for (const kind of ["url", "insert-before", "insert-after"]) {
    const c = compositor(),
      p = prep(scope(), { height: 180 });
    await c.request(p, "start", { prep: p });
    await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
    c.syntheticEncoder();
    if (kind === "url")
      c.c.URL.createObjectURL = () => {
        throw Error("url");
      };
    else {
      const insert = c.api.outputRecords.set.bind(c.api.outputRecords);
      c.api.outputRecords.set = (id, record) => {
        if (kind === "insert-after") insert(id, record);
        throw Error("ledger");
      };
    }
    assert.equal(
      (await c.request(p, "finish", { intentId: scope().owner })).ok,
      false,
    );
    assert.equal(c.api.resources.size, 0, kind);
    assert.equal(c.api.outputRecords.size, 0, kind);
    assert.equal(c.counts.revoked.length, kind === "url" ? 0 : 1, kind);
  }
});
test("events arriving during held search require a second reconciliation pass", async () => {
  const held = deferred();
  let first = true,
    searches = 0,
    w;
  w = worker({
    height: 180,
    search: (query) => {
      searches++;
      if (first) {
        first = false;
        return held.promise;
      }
      return Promise.resolve(
        w.items.filter((i) =>
          query.id === undefined ? i.url === query.url : i.id === query.id,
        ),
      );
    },
  });
  await w.run();
  await waitFor(() => searches === 1);
  const native = {
    id: 0,
    url: w.downloads[0].url,
    incognito: false,
    state: "complete",
    paused: false,
  };
  w.items.push(native);
  w.workerContext.chrome.downloads.onChanged.emit({
    id: 0,
    state: { current: "complete" },
  });
  held.resolve([{ ...native, state: "in_progress" }]);
  await w.workerApi.reconcileOwnedDownloads();
  await tick();
  assert.ok(searches >= 2);
  assert.equal(w.counts.revoked.length, 1);
  const e = (
    await w.request({ requesterOwner: scope().owner }, "download-list")
  ).entries[0];
  assert.equal(e.downloadState, "complete");
});
test("synchronous invocation boundary refuses a second native call for the same local operation", async () => {
  const d = deferred(),
    w = worker({ height: 180, download: () => d.promise }),
    run = w.run();
  await waitFor(() => w.downloads.length === 1);
  const operation = [...w.workerApi.liveOperations][0];
  assert.throws(
    () => w.workerApi.invokeDownloadOnce(operation, w.downloads[0]),
    (e) => e.code === "ALREADY_STARTED",
  );
  assert.equal(w.downloads.length, 1);
  d.resolve(0);
  await run;
});
test("IDAT packing retains every byte across multiple payload boundaries and final partial staging", async () => {
  const c = compositor(),
    p = prep();
  await c.request(p, "start", { prep: p });
  const s = c.api.sessions.get(p.sessionId),
    bytes = new Uint8Array(3 * 1048576 + 7);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  let read = 0;
  const reader = {
    read: async () =>
      read++
        ? { done: true }
        : { done: false, value: bytes.subarray(3, bytes.length - 2) },
  };
  const encoding = {
    parts: [],
    leases: new Set(),
    staging: null,
    failed: null,
  };
  const result = await c.api.collectIdatChunks(reader, s, encoding);
  assert.equal(result.chunkCount, 4);
  assert.equal(result.encodedBytes, 45 + (bytes.length - 5) + 4 * 12);
  const payloads = result.parts.map((part) => {
    const b = Buffer.from(part);
    assert.equal(b.toString("ascii", 4, 8), "IDAT");
    const length = b.readUInt32BE(0);
    assert.equal(b.readUInt32BE(length + 8), crc(b.subarray(4, length + 8)));
    return b.subarray(8, length + 8);
  });
  assert.deepEqual(
    Buffer.concat(payloads),
    Buffer.from(bytes.subarray(3, bytes.length - 2)),
  );
  await c.request(p, "abort");
  assert.equal(c.api.resources.size, 0);
});
test("held native compressor read survives bounded cancellation only as pending disposal", async () => {
  const c = compositor(),
    p = prep(scope(), { height: 180 }),
    held = deferred();
  await c.request(p, "start", { prep: p });
  await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  let reading = false;
  c.c.CompressionStream = class {
    constructor() {
      this.writable = new WritableStream();
      this.readable = {
        getReader: () => ({
          read() {
            reading = true;
            return held.promise;
          },
          cancel: () => Promise.reject(Error("synthetic cancel rejection")),
          releaseLock() {},
        }),
      };
    }
  };
  const finish = c.request(p, "finish", { intentId: scope().owner });
  await waitFor(() => reading);
  await c.request(p, "abort");
  c.advance(2000);
  assert.equal((await finish).ok, false);
  assert.ok(c.api.statusSnapshot().pendingDisposalBytes >= 1048576);
  assert.equal(c.counts.urls, 0);
  held.resolve({ done: true });
  await tick();
  await tick();
  assert.equal(c.api.resources.size, 0);
  assert.equal(c.counts.urls, 0);
});
test("native item matching rejects wrong URL, missing/wrong context and conflicting optional owner", async () => {
  const c = compositor(),
    o = await output(c),
    a = await arm(c, o),
    b = await c.request(o.p, "download-bind", {
      intentId: o.intentId,
      downloadId: 0,
      expectedRevision: a.entry.revision,
      basis: "api-result",
    });
  for (const changes of [
    { url: "blob:unrelated" },
    { incognito: undefined },
    { incognito: true },
    { byExtensionId: "another-extension" },
  ]) {
    const result = await c.request(o.p, "download-update", {
      intentId: o.intentId,
      expectedRevision: b.entry.revision,
      item: { ...item(b.entry), ...changes },
    });
    assert.equal(result.ok, false);
    assert.equal(c.counts.revoked.length, 0);
  }
  const u = await c.request(o.p, "download-update", {
    intentId: o.intentId,
    expectedRevision: b.entry.revision,
    item: item(b.entry),
  });
  const older = await c.request(o.p, "download-update", {
    intentId: o.intentId,
    expectedRevision: u.entry.revision,
    item: { ...item(b.entry), state: "in_progress" },
  });
  assert.equal(older.entry.downloadState, "complete");
});
