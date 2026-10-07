const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm");
const {
  deferred,
  event,
  scope,
  prep,
  snapshot,
  compositor,
  worker,
  content,
} = require("./dispatcher-harness.cjs");
async function start(c, p) {
  assert.equal((await c.request(p, "start", { prep: p })).ok, true);
  return c.P.makeTraversal(p);
}
test("pre/post equal at wrong command is rejected", async () => {
  const c = compositor(),
    p = prep(),
    plan = await start(c, p),
    spec = c.P.nextFrameSpec(plan, null),
    wrong = snapshot(p, spec, { logicalY: 20 });
  const r = await c.frame(p, spec, { preSnapshot: wrong, postSnapshot: wrong });
  assert.equal(r.code, "SCROLL_CHANGED");
  assert.equal(c.counts.draw, 0);
  assert.equal(c.counts.fetch, 0);
  assert.equal(c.api.sessions.get(p.sessionId).frames, 0);
});
test("backwards after finalized tile is rejected without recreating it", async () => {
  const c = compositor({ bitmapWidth: 1100, bitmapHeight: 2000 }),
    p = prep(scope(), {
      width: 1100,
      height: 12000,
      viewportWidth: 1100,
      viewportHeight: 2000,
    }),
    plan = await start(c, p);
  let spec = null,
    s;
  do {
    spec = c.P.nextFrameSpec(plan, spec);
    assert.equal((await c.frame(p, spec)).ok, true);
    s = c.api.sessions.get(p.sessionId);
  } while (s.finalizedThroughIndex < 0);
  const count = c.counts.draw,
    converted = c.counts.convert,
    saved = s.savedTiles.size;
  const r = await c.frame(p, c.P.nextFrameSpec(plan, null));
  assert.equal(r.code, "FRAME_SEQUENCE_MISMATCH");
  assert.equal(c.counts.draw, count);
  assert.equal(c.counts.convert, converted);
  assert.equal(s.savedTiles.size, saved);
  assert.throws(
    () => c.api.getTile(s, 0),
    (e) => e.code === "FINALIZED_REGION_REVISIT",
  );
  assert.equal(s.activeTiles.has(0), false);
});
test("jump forward never finalizes missing coverage", async () => {
  const c = compositor({ bitmapWidth: 1100, bitmapHeight: 2000 }),
    p = prep(scope(), {
      width: 1100,
      height: 12000,
      viewportWidth: 1100,
      viewportHeight: 2000,
    }),
    plan = await start(c, p);
  let spec = c.P.nextFrameSpec(plan, null);
  spec = c.P.nextFrameSpec(plan, spec);
  const r = await c.frame(p, spec);
  assert.equal(r.code, "FRAME_SEQUENCE_MISMATCH");
  assert.equal(c.counts.convert, 0);
  assert.equal(c.counts.draw, 0);
  assert.equal(c.api.sessions.get(p.sessionId).savedTiles.size, 0);
  const s = c.api.sessions.get(p.sessionId);
  Object.assign(s, { widthPx: 1100, heightPx: 12000, tileHeight: 1000 });
  await assert.rejects(
    c.api.finalizeTilesBefore(s, 2000),
    (e) => e.code === "CAPTURE_FAILED",
  );
  assert.equal(c.counts.convert, 0);
});
test("second bitmap scale change closes bitmap and rejects", async () => {
  const c = compositor(),
    p = prep(),
    plan = await start(c, p),
    first = c.P.nextFrameSpec(plan, null);
  await c.frame(p, first);
  c.c.createImageBitmap = async () => ({
    width: 201,
    height: 180,
    close() {
      c.counts.closed++;
    },
  });
  const draws = c.counts.draw,
    r = await c.frame(p, c.P.nextFrameSpec(plan, first));
  assert.equal(r.code, "BITMAP_SCALE_CHANGED");
  assert.equal(c.counts.closed, 2);
  assert.equal(c.counts.draw, draws);
  assert.equal(c.counts.urls, 0);
  assert.equal(c.api.sessions.size, 0);
});
test("rejected snapshots do not advance accepted sequence", async () => {
  const c = compositor(),
    p = prep(),
    plan = await start(c, p),
    spec = c.P.nextFrameSpec(plan, null);
  const r = await c.frame(p, spec, {
    postSnapshot: snapshot(p, spec, { geometryEpoch: 1 }),
  });
  assert.equal(r.code, "GEOMETRY_CHANGED");
  const s = c.api.sessions.get(p.sessionId);
  assert.equal(s.frames, 0);
  assert.equal(s.lastAcceptedSpec, null);
  assert.equal((await c.frame(p, spec)).acceptedSequence, 0);
  assert.equal(s.frames, 1);
});
test("capture API and geometry retries share throttle", async () => {
  let post = 0;
  const w = worker({
    width: 200,
    height: 180,
    capture(n) {
      if (n === 1) throw Error("synthetic transient");
    },
    snapshot(s, { captureCalls }) {
      if (captureCalls > 1 && post++ === 0) return { ...s, scrollEpoch: 1 };
      return s;
    },
  });
  await w.run();
  assert.equal(w.captureTimes.length, 3);
  for (let i = 1; i < w.captureTimes.length; i++)
    assert.ok(w.captureTimes[i] - w.captureTimes[i - 1] >= 560);
  assert.equal(w.frames.length, 1);
  assert.equal(w.downloads.length, 1);
  assert.equal(w.frames[0].spec.sequence, 0);
});
test("stale document nonce rejects", async () => {
  const c = compositor(),
    p = prep(),
    plan = await start(c, p),
    spec = c.P.nextFrameSpec(plan, null),
    stale = snapshot(p, spec, { documentNonce: scope().owner });
  const r = await c.frame(p, spec, { preSnapshot: stale, postSnapshot: stale });
  assert.equal(r.code, "STALE_DOCUMENT");
  assert.equal(c.counts.fetch, 0);
  assert.equal(c.counts.draw, 0);
  assert.equal(c.counts.urls, 0);
});
test("transport timeout never replays accepted frame", async () => {
  const w = worker({ width: 200, height: 180 }),
    runtime = w.workerContext.chrome.runtime,
    original = runtime.sendMessage;
  let accepted;
  runtime.sendMessage = async (m) => {
    const r = await original(m);
    if (m.type === "frame") {
      accepted = r;
      return new Promise(() => {});
    }
    return r;
  };
  const run = w.run();
  await new Promise((r) => setImmediate(r));
  assert.equal(accepted.ok, true);
  assert.equal(w.frames.length, 1);
  // Exercise the production timeout callback; the VM clock never waits a real minute.
  for (const fn of [...w.timers.values()]) fn();
  await assert.rejects(run, (e) => e.code === "TRANSPORT_FAILED");
  assert.equal(w.frames.length, 1);
  assert.equal(w.downloads.length, 0);
  assert.equal(w.counts.urls, 0);
  assert.equal(w.api.sessions.size, 0);
});
test("busy frame and finish cannot overlap; abort closes late bitmap", async () => {
  const c = compositor(),
    p = prep(),
    plan = await start(c, p),
    spec = c.P.nextFrameSpec(plan, null),
    d = deferred();
  c.c.createImageBitmap = () => d.promise;
  const pending = c.frame(p, spec);
  await new Promise((r) => setImmediate(r));
  assert.equal((await c.frame(p, spec)).code, "SESSION_BUSY");
  assert.equal(
    (await c.request(p, "finish", { intentId: scope().owner })).code,
    "SESSION_BUSY",
  );
  await c.request(p, "abort");
  d.resolve({
    width: 200,
    height: 180,
    close() {
      c.counts.closed++;
    },
  });
  assert.equal((await pending).ok, false);
  assert.equal(c.counts.closed, 1);
  assert.equal(c.counts.draw, 0);
});
test("runtime sender allowlist and trusted route use same envelope validator", async () => {
  const c = compositor(),
    p = prep(),
    request = c.envelope(p, "start", { prep: p });
  let result;
  c.runtime.onMessage.emit(
    request,
    { id: "synthetic-extension", url: c.runtime.getURL("popup.html") },
    (r) => (result = r),
  );
  assert.equal(result.code, "INVALID_SENDER");
  assert.equal(c.api.sessions.size, 0);
  const malformed = await c.dispatch({ ...request, owner: "wrong" });
  assert.equal(malformed.type, "protocol-error");
  assert.equal(malformed.code, "INVALID_ENVELOPE");
  assert.equal(c.api.sessions.size, 0);
  c.runtime.onMessage.emit(
    request,
    { id: "synthetic-extension", url: c.runtime.getURL("service-worker.js") },
    (r) => (result = r),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(result.ok, true);
  assert.equal(result.requestId, request.requestId);
});
test("wrong operation cannot abort active session or revoke completed output", async () => {
  const c = compositor({ bitmapHeight: 180 }),
    p = prep(scope(), { height: 180 }),
    plan = await start(c, p);
  const wrong = { ...p, owner: scope().owner };
  assert.equal((await c.request(wrong, "abort")).code, "INVALID_IDENTITY");
  assert.equal(c.api.sessions.size, 1);
  await c.frame(p, c.P.nextFrameSpec(plan, null));
  c.syntheticEncoder();
  const intentId = scope().owner,
    output = await c.request(p, "finish", { intentId });
  assert.equal(
    (
      await c.request(wrong, "download-release", {
        intentId,
        expectedRevision: output.revision,
        reason: "DISCARDED_UNARMED",
      })
    ).code,
    "INVALID_IDENTITY",
  );
  assert.equal(
    (await c.request({ requesterOwner: p.owner }, "status")).retainedUrlCount,
    1,
  );
  assert.equal(
    (
      await c.request(p, "download-release", {
        intentId,
        expectedRevision: output.revision,
        reason: "DISCARDED_UNARMED",
      })
    ).ok,
    true,
  );
});
test("port wrong identity cannot settle request; close and post throw settle once", async () => {
  const w = worker(),
    identity = scope(),
    port = {
      onMessage: event(),
      onDisconnect: event(),
      postMessage(m) {
        this.message = m;
      },
    },
    rpc = w.workerApi.createPortRPC(port, identity);
  let settled = 0;
  const pending = rpc.call("prepare").then(
    () => {
      settled++;
    },
    () => {
      settled++;
    },
  );
  port.onMessage.emit({
    replyTo: 1,
    protocolVersion: 1,
    ...identity,
    owner: scope().owner,
    result: {},
  });
  await Promise.resolve();
  assert.equal(settled, 0);
  rpc.close();
  await pending;
  assert.equal(settled, 1);
  await assert.rejects(rpc.call("prepare"));
  assert.equal(w.timers.size, 0);
  const throwing = {
      onMessage: event(),
      onDisconnect: event(),
      postMessage() {
        throw Error("synthetic throw");
      },
    },
    other = w.workerApi.createPortRPC(throwing, identity);
  await assert.rejects(other.call("prepare"), /synthetic throw/);
  assert.equal(w.timers.size, 0);
  other.close();
});
test("content position and snapshot dispatch bind document identity", async () => {
  const h = content(),
    identity = scope(),
    port = {
      sender: { id: "synthetic-extension" },
      name: "cfp:" + identity.sessionId,
      onMessage: event(),
      onDisconnect: event(),
      postMessage(m) {
        this.responses.push(m);
      },
      responses: [],
    };
  h.runtime.onConnect.emit(port);
  const send = (id, method, payload) =>
    port.onMessage.emit({
      id,
      method,
      payload,
      protocolVersion: 1,
      ...identity,
    });
  send(1, "prepare", {
    strategy: "auto",
    prepareExpiresAt: 15000,
    operationExpiresAt: 900000,
  });
  await Promise.resolve();
  h.waits[0].resolve();
  await new Promise((r) => setImmediate(r));
  const p = port.responses[0].result,
    plan = h.c.__cfpProtocol.makeTraversal(p),
    spec = h.c.__cfpProtocol.nextFrameSpec(plan, null);
  send(2, "position", { spec });
  await Promise.resolve();
  h.waits[1].resolve();
  await new Promise((r) => setImmediate(r));
  send(3, "snapshot", { spec });
  await new Promise((r) => setImmediate(r));
  assert.equal(port.responses[2].result.documentNonce, p.documentNonce);
  h.root.scrollTop = 25;
  send(4, "snapshot", { spec });
  await new Promise((r) => setImmediate(r));
  assert.equal(port.responses[3].result.logicalY, 25);
  send(5, "restore", { reason: "success" });
  await new Promise((r) => setImmediate(r));
  assert.equal(port.responses[4].result.status, "acknowledged");
  assert.equal(h.root.scrollTop, 25);
  assert.equal(port.responses[4].result.preservedPageChanges, 1);
});
test("owned inline restoration preserves subsequent page writes", () => {
  const h = content(),
    props = new Map([["height", ["10px", ""]]]),
    node = {
      ownerDocument: {},
      style: {
        getPropertyValue: (k) => props.get(k)?.[0] || "",
        getPropertyPriority: (k) => props.get(k)?.[1] || "",
        setProperty: (k, v, p) => props.set(k, [v, p]),
        removeProperty: (k) => props.delete(k),
      },
    };
  h.api.writeOwnedProperty(node, "height", "20px");
  node.style.setProperty("height", "30px", "");
  h.api.restoreProperty(node, "height", "10px", "");
  assert.equal(node.style.getPropertyValue("height"), "30px");
});
test("direct FrameSpec comparisons and compositor dispatch reject accessors without invocation", async () => {
  const c = compositor(),
    p = prep();
  await c.request(p, "start", { prep: p });
  const plan = c.P.makeTraversal(p),
    spec = c.P.nextFrameSpec(plan, null);
  for (const key of Object.keys(spec)) {
    let calls = 0;
    const bad = { ...spec };
    Object.defineProperty(bad, key, {
      enumerable: true,
      get() {
        calls++;
        return spec[key];
      },
    });
    assert.throws(
      () => c.P.sameSpec(bad, spec),
      (e) => e.code === "INVALID_ENVELOPE",
    );
    const payload = {
      spec: bad,
      preSnapshot: snapshot(p, spec),
      postSnapshot: snapshot(p, spec),
      dataUrl: "data:image/png;base64,AA==",
    };
    assert.equal((await c.request(p, "frame", payload)).ok, false);
    await assert.rejects(
      c.api.addFrame({ ...p, ...payload }),
      (e) => e.code === "INVALID_ENVELOPE",
    );
    assert.equal(calls, 0, key);
    assert.equal(c.counts.fetch, 0);
    assert.equal(c.counts.draw, 0);
    assert.equal(c.api.sessions.get(p.sessionId).frames, 0);
  }
  await c.request(p, "abort");
});
test("direct content position, snapshot and acceptance validate FrameSpec descriptors before access", async () => {
  const h = content(),
    preparing = h.api.prepare();
  h.waits.shift().resolve();
  const p = await preparing,
    P = h.c.__cfpProtocol,
    first = P.nextFrameSpec(P.makeTraversal(p), null),
    context = h.api.getState(),
    moving = h.api.moveTo(context, first);
  h.waits.shift().resolve();
  await moving;
  for (const key of Object.keys(first)) {
    let calls = 0;
    const bad = { ...first };
    Object.defineProperty(bad, key, {
      enumerable: true,
      get() {
        calls++;
        return first[key];
      },
    });
    await assert.rejects(
      h.api.moveTo(context, bad),
      (e) => e.code === "INVALID_ENVELOPE",
    );
    assert.throws(
      () => h.api.snapshot(context, bad),
      (e) => e.code === "INVALID_ENVELOPE",
    );
    const rect = P.frameRect(p, first, 200, 180),
      novelRect = P.novelFrameRect(context.plan, first, 200, 180);
    assert.throws(
      () =>
        h.api.acceptFrame(context, {
          spec: bad,
          bitmapWidth: 200,
          bitmapHeight: 180,
          rect,
          novelRect,
        }),
      (e) => e.code === "INVALID_ENVELOPE",
    );
    assert.equal(calls, 0, key);
    assert.equal(context.lastAcceptedSpec, null);
  }
  await h.api.restore();
});
