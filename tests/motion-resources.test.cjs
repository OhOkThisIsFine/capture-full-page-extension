const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { content } = require("./dispatcher-harness.cjs");
const context = () => ({
  effects: new WeakSet(),
  warnings: new Set(),
  metadataBytes: 0,
  effectCount: 0,
});
test("effect discovery uses element-local enumeration and retains at most the effect budget", () => {
  const h = content(),
    c = context(),
    effects = Array.from({ length: 2000 }, () => ({
      playState: "running",
      effect: {
        target: {
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            right: 10,
            bottom: 10,
          }),
        },
      },
      pause() {
        throw Error("motion changed");
      },
    }));
  let calls = 0;
  const node = {
    getAnimations(options) {
      assert.deepEqual({ ...options }, { subtree: false });
      calls++;
      return effects;
    },
  };
  h.api.classifyLiveEffects(
    node,
    { left: 0, top: 0, right: 200, bottom: 180 },
    c,
  );
  assert.equal(calls, 1);
  assert.equal(c.effectCount, 2000);
  assert.equal(c.metadataBytes, 2000 * 64);
  assert.ok(c.metadataPeak >= 2000 * 64 + 32 + 2000 * 16);
  assert.ok(c.warnings.has("LIVE_MOTION"));
  h.api.classifyLiveEffects(
    node,
    { left: 0, top: 0, right: 200, bottom: 180 },
    c,
  );
  assert.equal(c.effectCount, 2000);
  assert.equal(c.metadataBytes, 2000 * 64);
  assert.equal(c.optionalEffectsStopped, true);
});
test("excessive native effect sequence is observed then dropped without further enumeration", () => {
  const h = content(),
    c = context();
  let calls = 0;
  const node = {
    getAnimations(options) {
      assert.equal(options.subtree, false);
      calls++;
      return Array.from({ length: 2001 }, () => ({ playState: "running" }));
    },
  };
  h.api.classifyLiveEffects(
    node,
    { left: 0, top: 0, right: 200, bottom: 180 },
    c,
  );
  assert.equal(c.metadataPeak, 32 + 16 * 2001);
  assert.equal(c.metadataBytes, 0);
  assert.equal(c.effectCount, 0);
  assert.equal(c.optionalEffectsStopped, true);
  assert.ok(c.warnings.has("LIVE_MOTION"));
  h.api.classifyLiveEffects(node, {}, c);
  assert.equal(calls, 1);
  const near = context();
  near.metadataBytes = 16 * 1024 * 1024 - 10;
  h.api.classifyLiveEffects({ getAnimations: () => [{}] }, {}, near);
  assert.equal(near.metadataBytes, 16 * 1024 * 1024 - 10);
  assert.equal(near.excessObservedAllocation, true);
  assert.ok(near.metadataPeak > 16 * 1024 * 1024);
});
test("effect discovery never calls Document or ShadowRoot getAnimations", () => {
  const h = content(),
    c = {
      ...context(),
      roots: new WeakSet(),
      ownedStyles: [],
      planId: "synthetic",
    };
  let elementCalls = 0;
  const style = () => ({ setAttribute() {}, remove() {} }),
    doc = h.c.document;
  doc.nodeType = 9;
  doc.createElement = style;
  doc.head = { appendChild() {} };
  doc.getAnimations = () => {
    throw Error("root-wide enumeration");
  };
  const shadow = {
    nodeType: 11,
    ownerDocument: doc,
    appendChild() {},
    getAnimations() {
      throw Error("shadow-wide enumeration");
    },
  };
  const child = {
    nodeType: 1,
    getAnimations(options) {
      assert.equal(options.subtree, false);
      elementCalls++;
      return [];
    },
    lastElementChild: null,
  };
  shadow.lastElementChild = child;
  doc.documentElement.nodeType = 1;
  doc.documentElement.shadowRoot = shadow;
  doc.documentElement.getAnimations = () => [];
  h.api.discoverCaptureRoots(c, { remaining: 50000 });
  assert.equal(elementCalls, 1);
  assert.equal(c.rootCount, 2);
  assert.equal(c.metadataBytes, 512);
});
