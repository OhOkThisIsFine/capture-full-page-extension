const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { content } = require("./dispatcher-harness.cjs");
async function prepared(h) {
  const promise = h.api.prepare();
  h.waits.shift().resolve();
  await promise;
  return h.api.getState();
}
function node(h, parent = h.root, style = {}) {
  return {
    nodeType: 1,
    ownerDocument: h.c.document,
    parentElement: parent,
    computedStyle: style,
    getRootNode: () => h.c.document,
  };
}
test("composed mapping follows slots and open shadow hosts and rejects cycles", () => {
  const h = content(),
    host = node(h),
    shadow = { nodeType: 11, mode: "open", host },
    target = node(h, null);
  target.getRootNode = () => shadow;
  assert.deepEqual(
    [...h.api.composedAncestors(target, { includeSelf: true })],
    [target, host, h.root],
  );
  const slot = node(h, host);
  target.assignedSlot = slot;
  assert.deepEqual(
    [...h.api.composedAncestors(target, { includeSelf: true })],
    [target, slot, host, h.root],
  );
  slot.parentElement = target;
  assert.throws(
    () => [...h.api.composedAncestors(target, { includeSelf: true })],
    (e) => e.code === "RESOURCE_LIMIT",
  );
});
test("fixed anchor under transformed host remains ordinary content rather than viewport suppression", () => {
  const h = content(),
    host = node(h, h.root, { transform: "matrix(1, 0, 0, 1, 0, 0)" }),
    fixed = node(h, host, { position: "fixed" });
  h.c.getComputedStyle = (el) => el.computedStyle || {};
  const context = { scroller: h.root, isDocument: true };
  assert.equal(
    h.api.classifyCaptureAnchor(fixed, context).kind,
    "nonviewport-fixed",
  );
  host.computedStyle = {};
  assert.equal(
    h.api.classifyCaptureAnchor(fixed, context).kind,
    "viewport-fixed",
  );
  fixed.ownerDocument = {
    defaultView: { getComputedStyle: (el) => h.c.getComputedStyle(el) },
  };
  assert.equal(
    h.api.classifyCaptureAnchor(fixed, context).kind,
    "nonviewport-fixed",
  );
});
test("preserve mapping rejects rounded clips and masks through composed ancestors", () => {
  const h = content(),
    host = node(h, h.root, {
      overflowX: "hidden",
      overflowY: "hidden",
      borderTopLeftRadius: "40px",
    }),
    target = node(h, host);
  h.c.getComputedStyle = (el) => el.computedStyle || {};
  const context = { scroller: target, isDocument: false };
  assert.throws(
    () => h.api.assertSupportedMapping(context),
    (e) => e.code === "UNSUPPORTED_TARGET_MAPPING",
  );
  host.computedStyle = { overflowX: "hidden", overflowY: "hidden" };
  assert.doesNotThrow(() => h.api.assertSupportedMapping(context));
  host.computedStyle = { clipPath: "circle(50%)" };
  assert.throws(
    () => h.api.assertSupportedMapping(context),
    (e) => e.code === "UNSUPPORTED_TARGET_MAPPING",
  );
});
test("persistent mapping rejects rotation, mask and reparenting despite equal numeric snapshots", async () => {
  for (const mutation of ["rotate", "mask", "parent"]) {
    const h = content();
    h.c.getComputedStyle = (el) => el.computedStyle || {};
    const context = await prepared(h),
      spec = h.c.__cfpProtocol.nextFrameSpec(context.plan, null),
      moving = h.api.moveTo(context, spec);
    h.waits.shift().resolve();
    await moving;
    if (mutation === "rotate") h.root.computedStyle = { rotate: "180deg" };
    if (mutation === "mask")
      h.root.computedStyle = { maskImage: "linear-gradient(black, black)" };
    if (mutation === "parent") h.root.parentElement = node(h, null);
    assert.throws(
      () => h.api.snapshot(context, spec),
      (e) => e.code === "GEOMETRY_CHANGED",
    );
    assert.equal(context.lastAcceptedSpec, null);
    await h.api.restore();
  }
});
test("rollback owns entry-time scroll before expanded geometry clamps 8000 to 500", async () => {
  for (const external of [false, true]) {
    const h = content();
    h.root.scrollTop = 200;
    const context = await prepared(h);
    h.api.writeOwnedScroll(context, h.root, 0, 8000);
    if (external) h.root.scrollTop = 300;
    context.rollback.push(() => {
      h.root.scrollTop = Math.min(h.root.scrollTop, 500);
    });
    const result = await h.api.restore();
    assert.equal(h.root.scrollTop, external ? 300 : 200);
    assert.equal(result.preservedPageChanges, external ? 1 : 0);
    assert.equal(result.codes.includes("PAGE_SCROLL_CHANGED"), external);
    assert.deepEqual(await h.api.restore(context), result);
  }
});
test("owned style clamp updates settled offsets and replaced document gets no old scroll write", async () => {
  const h = content();
  h.root.scrollTop = 200;
  const context = await prepared(h);
  h.api.writeOwnedScroll(context, h.root, 0, 8000);
  const set = h.root.style.setProperty;
  h.root.style.setProperty = (...args) => {
    set(...args);
    h.root.scrollTop = Math.min(h.root.scrollTop, 500);
  };
  h.api.writeOwnedProperty(h.root, "height", "500px");
  assert.equal(context.scrollRecords[0].lastOwned.top, 500);
  await h.api.restore();
  assert.equal(h.root.scrollTop, 200);
  const next = await prepared(h);
  h.api.writeOwnedScroll(next, h.root, 0, 900);
  h.root.ownerDocument = {};
  const result = await h.api.restore();
  assert.equal(h.root.scrollTop, 900);
  assert.equal(result.status, "partial");
  assert.ok(result.codes.includes("DOCUMENT_REPLACED"));
});
test("content preparation and capture deadlines cannot be extended by a backward wall clock", async () => {
  const h = content();
  const preparing = h.api.prepare().catch((error) => error);
  h.clock.wall = -10000;
  h.clock.mono = 15000;
  h.waits.shift().resolve();
  assert.equal((await preparing).code, "PREPARE_TIMEOUT");
  assert.equal(h.api.getState(), null);
  h.clock.wall = 0;
  h.clock.mono = 0;
  const context = await prepared(h),
    spec = h.c.__cfpProtocol.nextFrameSpec(context.plan, null);
  h.clock.wall = -10000;
  h.clock.mono = 600000;
  await assert.rejects(
    h.api.moveTo(context, spec),
    (error) => error.code === "CAPTURE_TIMEOUT",
  );
  await h.api.restore();
});
test("mapping comparisons account temporary signatures and retain no per-snapshot growth", async () => {
  const h = content(),
    context = await prepared(h),
    before = context.metadataBytes;
  for (let i = 0; i < 100; i++) h.api.assertMappingUnchanged(context);
  assert.equal(context.metadataBytes, before);
  context.metadataBytes = 16 * 1024 * 1024 - 1;
  assert.throws(
    () => h.api.assertMappingUnchanged(context),
    (error) => error.code === "RESOURCE_LIMIT",
  );
  assert.equal(context.metadataBytes, 16 * 1024 * 1024 - 1);
  await h.api.restore();
});
