const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm");
const {
  scope,
  prep,
  snapshot,
  compositor,
  content,
  worker,
} = require("./dispatcher-harness.cjs");
function acceptance(
  P,
  p,
  spec,
  width = p.windowWidth,
  height = p.windowHeight,
) {
  return {
    spec,
    bitmapWidth: width,
    bitmapHeight: height,
    rect: P.frameRect(p, spec, width, height),
    novelRect: P.novelFrameRect(P.makeTraversal(p), spec, width, height),
  };
}
test("canonical geometry records reject extra keys, prototype surprises and accessors without evaluating them", () => {
  const c = compositor(),
    p = prep();
  assert.throws(
    () => c.P.makeTraversal({ ...p, position: {} }),
    (e) => e.code === "INVALID_ENVELOPE",
  );
  let invoked = 0;
  const getter = { ...p };
  Object.defineProperty(getter, "targetWidth", {
    enumerable: true,
    get() {
      invoked++;
      return 200;
    },
  });
  assert.throws(
    () => c.P.makeTraversal(getter),
    (e) => e.code === "INVALID_ENVELOPE",
  );
  assert.equal(invoked, 0);
  const inherited = Object.assign(Object.create({ unexpected: true }), p);
  assert.throws(
    () => c.P.makeTraversal(inherited),
    (e) => e.code === "INVALID_ENVELOPE",
  );
  const warnings = [];
  Object.defineProperty(warnings, "0", {
    enumerable: true,
    get() {
      invoked++;
      return "LIVE_MOTION";
    },
  });
  assert.throws(
    () => c.P.makeTraversal({ ...p, warnings }),
    (e) => e.code === "INVALID_ENVELOPE",
  );
  assert.equal(invoked, 0);
});
test("canonical UUID tokens and numerical bounds reject before compositor allocation", async () => {
  const c = compositor(),
    p = prep();
  for (const changes of [
    { planId: p.owner },
    { planId: p.planId.toUpperCase() },
    { targetWidth: NaN },
    { clientHeight: Infinity },
    { targetHeight: 16777217 },
    { targetWidth: -1 },
    { devicePixelRatio: 17 },
  ]) {
    const r = await c.request(p, "start", { prep: { ...p, ...changes } });
    assert.equal(r.ok, false);
    assert.equal(c.api.sessions.size, 0);
    assert.equal(c.counts.draw, 0);
    assert.equal(c.counts.urls, 0);
  }
  assert.equal(c.P.uuid("00000000-0000-1000-8000-000000000000"), false);
  assert.deepEqual(
    { ...c.P.getQualifiedCapabilities("chrome") },
    { privateCapture: false, preserveVirtualizer: false },
  );
  assert.deepEqual(
    { ...c.P.getQualifiedCapabilities("firefox") },
    { privateCapture: false, preserveVirtualizer: false },
  );
});
test("traversal throws at frame limit without returning a partially usable plan", () => {
  const c = compositor();
  assert.throws(
    () =>
      c.P.makeTraversal(
        prep(scope(), {
          width: 16777216,
          height: 16777216,
          viewportWidth: 1,
          viewportHeight: 1,
        }),
      ),
    (e) => e.code === "RESOURCE_LIMIT",
  );
  const p = prep(scope(), { width: 480, height: 2000 }),
    plan = c.P.makeTraversal(p);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.prep), true);
  let previous = null,
    count = 0,
    spec;
  while ((spec = c.P.nextFrameSpec(plan, previous))) {
    assert.equal(spec.sequence, spec.row * plan.columns + spec.column);
    assert.ok(spec.logicalX <= plan.maxX && spec.logicalY <= plan.maxY);
    previous = spec;
    count++;
  }
  assert.equal(count, plan.estimatedFrames);
});
test("complete PNG data URL cap and decoded bitmap cap are separate exact boundaries", () => {
  const c = compositor(),
    P = c.P,
    prefix = "data:image/png;base64,";
  const limit = prefix + "A".repeat(P.MAX_FRAME_DATA_URL_CHARS - prefix.length);
  assert.equal(P.validateFrameDataUrl(limit).length, 50331648);
  assert.throws(
    () => P.validateFrameDataUrl(limit + "A"),
    (e) => e.code === "RESOURCE_LIMIT",
  );
  assert.equal(P.cssBitmap(4096, 4096), 67108864);
  assert.throws(
    () => P.cssBitmap(4096, 4097),
    (e) => e.code === "RESOURCE_LIMIT",
  );
  assert.throws(
    () => P.validateFrameDataUrl("data:image/jpeg;base64,AA=="),
    (e) => e.code === "INVALID_ENVELOPE",
  );
});
test("oversized decoded result is closed before any canvas draw", async () => {
  const c = compositor({ bitmapWidth: 4096, bitmapHeight: 4097 }),
    p = prep();
  await c.request(p, "start", { prep: p });
  const r = await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  assert.equal(r.code, "RESOURCE_LIMIT");
  assert.equal(c.counts.closed, 1);
  assert.equal(c.counts.draw, 0);
  assert.equal(c.counts.urls, 0);
});
test("physical growth as well as shrinkage invalidates frozen mapping", () => {
  const c = compositor(),
    p = prep(),
    plan = c.P.makeTraversal(p),
    spec = c.P.nextFrameSpec(plan, null);
  for (const physicalScrollHeight of [1999, 2001])
    assert.equal(
      c.P.validateSnapshot(
        plan,
        spec,
        snapshot(p, spec, { physicalScrollHeight }),
      ).code,
      "GEOMETRY_CHANGED",
    );
});
test("first writer owns overlapping pixels exactly once across rows and columns", async () => {
  const c = compositor(),
    p = prep(scope(), { width: 480, height: 1000 });
  await c.request(p, "start", { prep: p });
  const pixels = new Uint8Array(480 * 1000);
  c.c.OffscreenCanvas = class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return {
        fillRect() {},
        drawImage(bitmap, sx, sy, sw, sh, dx, dy) {
          for (let y = dy; y < dy + sh; y++)
            for (let x = dx; x < dx + sw; x++) {
              const index = y * 480 + x;
              assert.equal(pixels[index], 0, "overlap rewritten");
              pixels[index]++;
            }
        },
      };
    }
    async convertToBlob() {
      return new Blob();
    }
  };
  const plan = c.P.makeTraversal(p);
  let previous = null,
    spec;
  while ((spec = c.P.nextFrameSpec(plan, previous))) {
    const r = await c.frame(p, spec);
    assert.equal(r.ok, true, JSON.stringify(r));
    previous = spec;
  }
  assert.ok(pixels.every((v) => v === 1));
  c.syntheticEncoder();
  assert.equal(
    (await c.request(p, "finish", { intentId: scope().owner })).ok,
    true,
  );
});
test("content cannot move to a new spec before accepted acknowledgment and duplicate ACK is idempotent", async () => {
  const h = content(),
    pending = h.api.prepare();
  h.waits.shift().resolve();
  const p = await pending,
    P = h.c.__cfpProtocol,
    plan = P.makeTraversal(p),
    first = P.nextFrameSpec(plan, null),
    second = P.nextFrameSpec(plan, first);
  const position = h.api.moveTo(h.api.getState(), first);
  h.waits.shift().resolve();
  await position;
  const illegal = h.api.moveTo(h.api.getState(), second).then(
    () => null,
    (error) => error,
  );
  await Promise.resolve();
  h.waits.shift()?.resolve();
  const illegalResult = await illegal;
  assert.ok(
    illegalResult &&
      ["FRAME_NOT_ACCEPTED", "FRAME_SEQUENCE_MISMATCH"].includes(
        illegalResult.code,
      ),
    "new position must reject before acceptance",
  );
  assert.equal(h.api.getState().lastAcceptedSpec, null);
  const a = acceptance(P, p, first);
  assert.equal(h.api.acceptFrame(h.api.getState(), a).acceptedSequence, 0);
  const count = h.api.getState().acceptedPixelRects.length;
  assert.equal(h.api.acceptFrame(h.api.getState(), a).acceptedSequence, 0);
  assert.equal(h.api.getState().acceptedPixelRects.length, count);
  const next = h.api.moveTo(h.api.getState(), second);
  h.waits.shift().resolve();
  await next;
  await h.api.restore();
});
test("lost content acceptance reply cancels without following frame or download", async () => {
  const w = worker({ width: 200, height: 400 }),
    original = w.contentPort.postMessage;
  w.contentPort.postMessage = function (message) {
    if (message.method === "accept-frame") return;
    return original.call(this, message);
  };
  const pending = w.run();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.frames.length, 1);
  const callbacks = [...w.timers.values()];
  for (const callback of callbacks) callback();
  await assert.rejects(pending);
  assert.equal(w.frames.length, 1);
  assert.equal(w.downloads.length, 0);
  assert.equal(w.counts.urls, 0);
});
test("geometry retries and transient capture errors have five total native calls per spec", async () => {
  const w = worker({
    width: 200,
    height: 180,
    capture(n) {
      if (n === 1 || n === 3) throw Error("synthetic transient");
    },
    snapshot(s, { acquisitions, captureCalls }) {
      return captureCalls > 0 && acquisitions % 2 === 1
        ? { ...s, scrollEpoch: 1 }
        : s;
    },
  });
  await assert.rejects(w.run(), (e) => e.code === "SCROLL_CHANGED");
  assert.equal(w.captureTimes.length, 5);
  assert.equal(w.frames.length, 0);
  assert.equal(w.downloads.length, 0);
  for (let i = 1; i < w.captureTimes.length; i++)
    assert.ok(w.captureTimes[i] - w.captureTimes[i - 1] >= 560);
});
