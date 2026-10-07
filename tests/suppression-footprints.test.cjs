const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { content } = require("./dispatcher-harness.cjs");
async function fixture({
  wide = false,
  fixed = false,
  headerHeight = 80,
} = {}) {
  const h = content();
  if (wide) h.root.scrollWidth = 400;
  const pending = h.api.prepare();
  h.waits.shift().resolve();
  await pending;
  const context = h.api.getState();
  h.api.enableGeometry();
  const styles = [];
  h.c.document.nodeType = 9;
  h.c.document.head = { appendChild: (style) => styles.push(style) };
  h.c.document.createElement = () => ({
    setAttribute() {},
    textContent: "",
    remove() {
      const i = styles.indexOf(this);
      if (i >= 0) styles.splice(i, 1);
    },
  });
  function element(parent, box, css = {}) {
    const e = new h.c.HTMLElement(),
      attrs = new Map();
    Object.assign(e, {
      nodeType: 1,
      ownerDocument: h.c.document,
      parentElement: parent,
      tagName: "DIV",
      textContent: "",
      computedStyle: css,
      getRootNode: () => h.c.document,
      getBoundingClientRect: () => (typeof box === "function" ? box() : box),
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: (name) => attrs.delete(name),
    });
    return e;
  }
  const width = wide ? 400 : 200,
    box = (left = 0, top = 0, w = width, height = 80) => ({
      left,
      top,
      right: left + w,
      bottom: top + height,
      width: w,
      height,
    });
  const header = element(
    h.root,
    () => box(-h.root.scrollLeft, 0, width, headerHeight),
    {
      position: fixed ? "fixed" : "sticky",
      overflowX: "hidden",
      overflowY: "hidden",
    },
  );
  h.root.lastElementChild = header;
  h.c.getComputedStyle = (e, pseudo) => {
    if (pseudo) return { content: e.pseudo || "none" };
    const token = e.getAttribute?.("data-cfp-occluder"),
      hidden =
        token && styles.some((style) => style.textContent.includes(token));
    return { ...e.computedStyle, opacity: hidden && !e.defeat ? "0" : "1" };
  };
  async function natural() {
    const pending = h.api.snapshotVisibleElements();
    if (h.waits.length) h.waits.shift().resolve();
    await pending;
  }
  async function frame({ accept = true } = {}) {
    const P = h.c.__cfpProtocol,
      spec = P.nextFrameSpec(context.plan, context.lastAcceptedSpec),
      pending = h.api.moveTo(context, spec);
    h.waits.shift().resolve();
    await pending;
    if (accept)
      h.api.acceptFrame(context, {
        spec,
        bitmapWidth: 200,
        bitmapHeight: 180,
        rect: P.frameRect(context.prep, spec, 200, 180),
        novelRect: P.novelFrameRect(context.plan, spec, 200, 180),
      });
    return spec;
  }
  return { h, context, header, element, box, natural, frame, styles };
}
test("wide qualified sticky header collects every natural horizontal fragment before hiding", async () => {
  const f = await fixture({ wide: true });
  await f.natural();
  await f.frame();
  assert.equal(f.context.hidden.size, 0);
  await f.frame();
  assert.equal(f.context.hidden.size, 0);
  await f.frame();
  assert.equal(f.context.hidden.size, 0);
  await f.frame();
  assert.equal(f.context.hidden.size, 1);
  assert.equal(f.context.occluders.get(f.header).naturalAccepted.length, 3);
  await f.h.api.restore();
  assert.equal(f.styles.length, 0);
});
test("viewport fixed header can hide only after an acknowledged initial fragment", async () => {
  const f = await fixture({ fixed: true });
  await f.natural();
  await f.frame({ accept: false });
  assert.equal(f.context.hidden.size, 0);
  const P = f.h.c.__cfpProtocol,
    spec = f.context.commandedSpec;
  f.h.api.acceptFrame(f.context, {
    spec,
    bitmapWidth: 200,
    bitmapHeight: 180,
    rect: P.frameRect(f.context.prep, spec, 200, 180),
    novelRect: P.novelFrameRect(f.context.plan, spec, 200, 180),
  });
  await f.frame();
  assert.equal(f.context.hidden.size, 1);
  await f.h.api.restore();
});
test("overflowing descendants and generated paint never become parent-border suppression permission", async () => {
  for (const mode of ["overflow", "pseudo", "text"]) {
    const f = await fixture();
    if (mode === "overflow") {
      const child = f.element(f.header, f.box(0, 300, 200, 30), {
        position: "absolute",
      });
      f.header.lastElementChild = child;
    }
    if (mode === "pseudo") f.header.pseudo = '"generated"';
    if (mode === "text") {
      f.header.textContent = "escaped text";
      const text = { nodeType: 3, length: 12, textContent: "escaped text" };
      f.header.firstChild = text;
      f.h.c.document.createRange = () => ({
        selectNodeContents() {},
        getClientRects: () => [f.box(0, 100, 20, 20)],
        detach() {},
      });
    }
    await f.natural();
    assert.equal(f.context.occluders.get(f.header).suppressionFootprint, null);
    await f.frame();
    await assert.rejects(f.frame(), (e) => e.code === "UNSUPPORTED_OCCLUSION");
    assert.equal(f.context.hidden.size, 0);
    await f.h.api.restore();
  }
});
test("transformed fixed descendants keep their lower document content and receive no opacity rule", async () => {
  const f = await fixture({ fixed: true });
  const host = f.element(f.h.root, f.box(0, 100, 200, 900), {
    transform: "matrix(1, 0, 0, 1, 0, 0)",
  });
  f.h.root.lastElementChild = host;
  host.lastElementChild = f.header;
  f.header.parentElement = host;
  await f.natural();
  await f.frame();
  await f.frame();
  assert.equal(f.context.hidden.size, 0);
  assert.equal(f.context.occluders.size, 0);
  await f.h.api.restore();
});
test("defeated opacity and newly appearing candidate fail before new pixels can be accepted", async () => {
  for (const mode of ["defeated", "new"]) {
    const f = await fixture({ fixed: true, headerHeight: 140 });
    if (mode === "new") {
      f.h.root.lastElementChild = null;
      await f.natural();
      await f.frame();
      f.h.root.lastElementChild = f.header;
    } else {
      await f.natural();
      await f.frame();
      f.header.defeat = true;
    }
    await assert.rejects(f.frame(), (e) => e.code === "UNSUPPORTED_OCCLUSION");
    assert.equal(f.context.lastAcceptedSpec.sequence, 0);
    await f.h.api.restore();
  }
});
test("footprint qualification never materializes whole-subtree textContent", async () => {
  const f = await fixture();
  let reads = 0;
  Object.defineProperty(f.header, "textContent", {
    get() {
      reads++;
      throw Error("unbounded native concatenation");
    },
  });
  await f.natural();
  await f.frame();
  await f.frame();
  assert.equal(reads, 0);
  assert.equal(f.context.hidden.size, 1);
  await f.h.api.restore();
});
