const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm");
const {
  deferred,
  scope,
  prep,
  snapshot,
  compositor,
  content,
} = require("./dispatcher-harness.cjs");
async function prepareContent(h) {
  const pending = h.api.prepare();
  h.waits.shift().resolve();
  return pending;
}
test("old preparation released after new session cannot change or restore it", async () => {
  const h = content(),
    old = h.api.prepare().then(
      () => null,
      (e) => e,
    );
  await h.api.restore();
  assert.equal(h.root.scrollTop, 23);
  const next = h.api.prepare(),
    owner = h.api.getState();
  h.waits.shift().resolve();
  assert.ok(await old);
  assert.equal(h.api.getState(), owner);
  h.waits.shift().resolve();
  await next;
  await h.api.restore();
});
test("short viewport rows retain positive pixels and full rounded coverage", () => {
  for (const height of [100, 149, 150, 151, 180, 190, 191, 300, 800])
    for (const scale of [1, 1.25, 2]) {
      const c = compositor(),
        p = prep(scope(), { viewportHeight: height }),
        plan = c.P.makeTraversal(p),
        rects = [];
      let previous = null,
        spec;
      while ((spec = c.P.nextFrameSpec(plan, previous))) {
        const r = c.P.frameRect(
          p,
          spec,
          Math.round(200 * scale),
          Math.round(height * scale),
        );
        assert.ok(r.sh > 0);
        rects.push({ x0: r.dx, y0: r.dy, x1: r.dx + r.sw, y1: r.dy + r.sh });
        previous = spec;
      }
      c.api.validateTileCoverage(
        Math.floor(200 * scale),
        Math.floor((2000 * Math.round(height * scale)) / height),
        rects,
        0,
        10000,
      );
    }
});
test("cancelled finish cannot create URL after encoding resolves", async () => {
  const c = compositor({ bitmapWidth: 1, bitmapHeight: 1 }),
    p = prep(scope(), {
      width: 1,
      height: 1,
      viewportWidth: 1,
      viewportHeight: 1,
    });
  await c.request(p, "start", { prep: p });
  await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  const d = deferred();
  c.c.encoding = d.promise;
  vm.runInContext("encodePngFromTiles=()=>encoding", c.c);
  const pending = c.request(p, "finish", { intentId: scope().owner });
  await new Promise((r) => setImmediate(r));
  await c.request(p, "abort");
  d.resolve(new Blob());
  assert.equal((await pending).ok, false);
  assert.equal(c.counts.urls, 0);
  assert.equal(c.api.sessions.size, 0);
});
test("nested early scroll and partial unlock roll back before newer preparation", async () => {
  for (const stage of [0, 1]) {
    const h = content();
    class Node {
      constructor() {
        this.ownerDocument = h.c.document;
        this.parentElement = h.root;
        this.props = new Map([["height", ["180px", "important"]]]);
        this.style = {
          getPropertyValue: (p) => this.props.get(p)?.[0] || "",
          getPropertyPriority: (p) => this.props.get(p)?.[1] || "",
          setProperty: (p, v, q) => this.props.set(p, [v, q]),
          removeProperty: (p) => this.props.delete(p),
        };
      }
    }
    const nested = new Node();
    Object.assign(nested, {
      scrollLeft: 11,
      scrollTop: 37,
      scrollWidth: 200,
      scrollHeight: 1000,
      clientWidth: 200,
      clientHeight: 180,
    });
    h.c.HTMLElement = Node;
    h.c.getComputedStyle = () => ({
      overflow: "auto",
      overflowX: "auto",
      overflowY: "auto",
      height: "180px",
      maxHeight: "none",
      position: "static",
    });
    h.api.setDetector(() => nested);
    const before = JSON.stringify([...nested.props]);
    const pending = h.api.prepare().then(
      () => null,
      (e) => e,
    );
    if (stage === 1) {
      h.waits[0].resolve();
      await new Promise((r) => setImmediate(r));
      assert.notEqual(JSON.stringify([...nested.props]), before);
    }
    await h.api.restore();
    assert.equal(nested.scrollTop, 37);
    assert.equal(nested.scrollLeft, 11);
    assert.equal(JSON.stringify([...nested.props]), before);
    h.api.setDetector(() => h.root);
    const next = h.api.prepare(),
      owner = h.api.getState();
    h.waits[stage].resolve();
    assert.ok(await pending);
    assert.equal(h.api.getState(), owner);
    h.waits.at(-1).resolve();
    await next;
    await h.api.restore();
    assert.equal(h.root.scrollTop, 23);
  }
});
test("recovery preserves completed URL and cancels deferred frame decode", async () => {
  const c = compositor({ bitmapWidth: 1, bitmapHeight: 1 }),
    p = prep(scope(), {
      width: 1,
      height: 1,
      viewportWidth: 1,
      viewportHeight: 1,
    });
  await c.request(p, "start", { prep: p });
  await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  c.syntheticEncoder();
  const intentId = scope().owner;
  const done = await c.request(p, "finish", { intentId });
  const old = prep(scope(), {
    width: 1,
    height: 1,
    viewportWidth: 1,
    viewportHeight: 1,
  });
  await c.request(old, "start", { prep: old });
  const d = deferred();
  c.c.createImageBitmap = () => d.promise;
  const pending = c.frame(old, c.P.nextFrameSpec(c.P.makeTraversal(old), null));
  await new Promise((r) => setImmediate(r));
  const next = prep();
  assert.equal(
    (await c.request(next, "start", { prep: next })).code,
    "ALREADY_STARTED",
  );
  const status = await c.request({ requesterOwner: next.owner }, "status");
  assert.equal(
    (
      await c.request(old, "abort", {
        reason: "WORKER_REPLACED",
        expectedContextId: status.contextId,
        expectedLifecycleGeneration: status.lifecycleGeneration,
      })
    ).ok,
    true,
  );
  assert.equal((await c.request(next, "start", { prep: next })).ok, true);
  d.resolve({
    width: 1,
    height: 1,
    close() {
      c.counts.closed++;
    },
  });
  assert.equal((await pending).ok, false);
  assert.equal(c.counts.closed, 2);
  assert.equal(c.api.sessions.size, 1);
  assert.equal(c.counts.urls, 1);
  assert.equal(
    (await c.request({ requesterOwner: next.owner }, "status")).idle,
    false,
  );
  await c.request(p, "download-release", {
    intentId,
    expectedRevision: done.revision,
    reason: "DISCARDED_UNARMED",
  });
});
test("PNG IEND has independently known CRC", () => {
  assert.equal(
    Buffer.from(
      compositor().api.encodePngChunk("IEND", new Uint8Array()),
    ).toString("hex"),
    "0000000049454e44ae426082",
  );
});
test("aborted tile encoding cannot repopulate retained tile maps", async () => {
  const c = compositor(),
    p = prep();
  await c.request(p, "start", { prep: p });
  const s = c.api.sessions.get(p.sessionId),
    d = deferred();
  Object.assign(s, { widthPx: 200, heightPx: 180, tileHeight: 180 });
  const tile = c.api.getTile(s, 0),
    canvas = tile.canvas;
  canvas.convertToBlob = () => d.promise;
  tile.coverage = [{ x0: 0, y0: 0, x1: 200, y1: 180 }];
  const pending = c.api.finalizeTile(s, 0).then(
    () => null,
    (e) => e,
  );
  await c.request(p, "abort");
  d.resolve(new Blob());
  assert.ok(await pending);
  assert.equal(s.savedTiles.size, 0);
  assert.equal(s.activeTiles.size, 0);
  assert.equal(canvas.width, 1);
});
test("actual compositor covers short viewport rows across horizontal columns", async () => {
  for (const height of [100, 149, 150, 151, 180, 190, 191, 300, 800])
    for (const scale of [1, 1.25, 2]) {
      const c = compositor({
          bitmapWidth: Math.round(200 * scale),
          bitmapHeight: Math.round(height * scale),
        }),
        p = prep(scope(), { width: 480, viewportHeight: height });
      assert.equal((await c.request(p, "start", { prep: p })).ok, true);
      let previous = null,
        spec;
      const plan = c.P.makeTraversal(p);
      while ((spec = c.P.nextFrameSpec(plan, previous))) {
        const result = await c.frame(p, spec);
        assert.equal(result.ok, true, JSON.stringify(result));
        previous = spec;
      }
      c.syntheticEncoder();
      const result = await c.request(p, "finish", { intentId: scope().owner });
      assert.equal(result.width, Math.floor(480 * scale));
      assert.equal(
        result.height,
        Math.floor((2000 * Math.round(height * scale)) / height),
      );
    }
});
test("iframe rollback restores styles and internal scroll only for original document", () => {
  const h = content();
  class Frame {
    constructor() {
      this.props = new Map([["height", ["100px", ""]]]);
      this.style = {
        getPropertyValue: (p) => this.props.get(p)?.[0] || "",
        getPropertyPriority: (p) => this.props.get(p)?.[1] || "",
        setProperty: (p, v, q) => this.props.set(p, [v, q]),
        removeProperty: (p) => this.props.delete(p),
      };
      this.clientWidth = 100;
      this.clientHeight = 100;
      this.contentDocument = {
        location: { href: "synthetic" },
        scrollingElement: {
          scrollWidth: 300,
          scrollHeight: 400,
          scrollLeft: 12,
          scrollTop: 34,
        },
      };
      this.contentDocument.scrollingElement.ownerDocument =
        this.contentDocument;
    }
    getBoundingClientRect() {
      return { width: 100, height: 100 };
    }
  }
  h.c.HTMLIFrameElement = Frame;
  for (const navigated of [false, true])
    for (const borderBox of [false, true]) {
      h.c.getComputedStyle = () => ({
        boxSizing: borderBox ? "border-box" : "content-box",
        borderLeftWidth: "8px",
        borderRightWidth: "8px",
        borderTopWidth: "8px",
        borderBottomWidth: "8px",
        paddingLeft: "2px",
        paddingRight: "2px",
        paddingTop: "2px",
        paddingBottom: "2px",
      });
      const frame = new Frame();
      h.c.elements = [frame];
      const doc = frame.contentDocument,
        root = doc.scrollingElement,
        before = JSON.stringify([...frame.props]);
      const operation = { rollback: [] },
        expansion = h.api.expandFrames(null, operation);
      assert.equal(
        frame.style.getPropertyValue("width"),
        borderBox ? "320px" : "300px",
      );
      assert.equal(
        frame.style.getPropertyValue("height"),
        borderBox ? "420px" : "400px",
      );
      h.api.writeOwnedScroll(operation, root, 0, 0);
      if (navigated) frame.contentDocument = {};
      expansion.restore();
      assert.equal(JSON.stringify([...frame.props]), before);
      assert.equal(root.scrollTop, navigated ? 0 : 34);
      assert.equal(root.scrollLeft, navigated ? 0 : 12);
    }
});
test("iframe scroll snapshot precedes preparation layout changes", async () => {
  const h = content(),
    frame = new h.c.HTMLIFrameElement(),
    root = { scrollLeft: 12, scrollTop: 34 };
  frame.contentDocument = {
    location: { href: "synthetic" },
    scrollingElement: root,
  };
  root.ownerDocument = frame.contentDocument;
  h.c.elements = [frame];
  const pending = h.api.prepare().then(
    () => null,
    (e) => e,
  );
  const owner = h.api.getState();
  h.api.writeOwnedScroll(owner, root, 0, 0);
  let expanded = true;
  owner.rollback.push(() => {
    expanded = false;
  });
  const saved = owner.scrollRollback[1];
  owner.scrollRollback[1] = () => {
    assert.equal(expanded, false);
    saved();
  };
  await h.api.restore();
  assert.equal(root.scrollTop, 34);
  assert.equal(root.scrollLeft, 12);
  h.waits[0].resolve();
  assert.ok(await pending);
});
