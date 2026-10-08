"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { browserTask, source } = require("./browser-harness.cjs");
if (!process.env.CFP_QA_OUTPUT)
  throw Error("Task-owned CFP_QA_OUTPUT required");
const out = path.resolve(process.env.CFP_QA_OUTPUT);
fs.mkdirSync(out, { recursive: true });
const probeSource = source.replace(
  "globalThis.qa={prepare,",
  "globalThis.qa={writeOwnedScroll,writeOwnedProperty,restoreProperty,prepare,",
);
assert.notEqual(probeSource, source);
const fixture =
  '<!doctype html><style>html,body{margin:0;width:100%;height:1100px}.motion{width:40px;height:40px;animation:color 10s linear infinite}@keyframes color{from{background:red}to{background:blue}}</style><div class="motion" style="animation-play-state:running"></div>';
const report = {
  sourceCommit: process.env.CFP_SOURCE_COMMIT || null,
  scope:
    "Isolated native Chrome DOM, production function bodies with test-only internal exposure and controlled settle; no packaged extension, activeTab, captureVisibleTab, native download, worker replacement, Firefox or memory qualification",
  checks: [],
  sourceHashes: {},
};
for (const file of ["capture-protocol.js", "content.js", "offscreen.js"])
  report.sourceHashes[file] = crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(
        path.join(process.env.CFP_EXTENSION_ROOT || process.cwd(), file),
      ),
    )
    .digest("hex");
async function check(name, fn) {
  try {
    const evidence = await fn();
    report.checks.push({ id: name, status: "passed", evidence });
    console.log("PASS", name);
  } catch (e) {
    report.checks.push({ id: name, status: "failed", error: e.stack });
    throw e;
  } finally {
    fs.writeFileSync(
      path.join(out, "native-source-results.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
browserTask(
  (url) =>
    url === "/border"
      ? '<style>html,body{margin:0;width:100%;height:1800px}.header{position:sticky;top:0;width:100%;height:160px;box-sizing:border-box;border:10px solid transparent;border-image:linear-gradient(rgb(200,30,40),rgb(200,30,40)) 1 / 10px / 40px;background:rgb(20,100,200)}</style><div class="header"></div>'
      : url === "/virtual"
        ? '<style>html,body{margin:0;height:100%;overflow:hidden}#list{position:relative;width:100%;height:100%;overflow:auto}.spacer{height:9000px}.row{position:absolute;top:100px;left:0;width:100%;height:80px}</style><div id="list"><div class="spacer"></div><div class="row">rendered window only</div></div>'
        : fixture,
  async ({ page, base, browser }) => {
    report.browser = browser;
    await page.setViewportSize({ width: 400, height: 600 });
    async function setup() {
      await page.goto(base + "/fixture");
      await page.evaluate(probeSource);
      await page.evaluate(() => scrollTo(0, 200));
    }
    for (const external of [false, true])
      await check(
        external
          ? "entry-page-scroll-preserved"
          : "entry-owned-scroll-before-native-collapse",
        async () => {
          await setup();
          const result = await page.evaluate(async (external) => {
            await qa.prepare();
            const context = qa.getState(),
              body = document.body,
              original = body.style.getPropertyValue("height"),
              priority = body.style.getPropertyPriority("height");
            qa.writeOwnedProperty(body, "height", "9000px");
            context.rollback.push(() =>
              qa.restoreProperty(body, "height", original, priority),
            );
            qa.writeOwnedScroll(context, document.scrollingElement, 0, 8000);
            const expanded = scrollY;
            if (external) scrollTo(0, 300);
            let collapsed;
            context.rollback.unshift(() => {
              collapsed = scrollY;
            });
            const restored = await qa.restore(context);
            return {
              expanded,
              collapsed,
              final: scrollY,
              restored,
              styles: document.querySelectorAll("[data-cfp-capture-style]")
                .length,
              bodyStyle: body.style.cssText,
            };
          }, external);
          assert.equal(result.expanded, 8000);
          assert.equal(result.collapsed, external ? 300 : 500);
          assert.equal(result.final, external ? 300 : 200);
          assert.equal(
            result.restored.codes.includes("PAGE_SCROLL_CHANGED"),
            external,
          );
          assert.equal(result.styles, 0);
          assert.equal(result.bodyStyle, "");
          return result;
        },
      );
    await check(
      "native-border-image-outset-marker-stops-before-suppression",
      async () => {
        const { PNG } = require(process.env.PNGJS_MODULE || "pngjs");
        await page.setViewportSize({ width: 400, height: 240 });
        await page.goto(base + "/border");
        const bytes = await page.screenshot(),
          png = PNG.sync.read(bytes),
          offset = (195 * png.width + 100) * 4;
        assert.deepEqual(
          [...png.data.subarray(offset, offset + 3)],
          [200, 30, 40],
          "40px border-image paint extends beyond 160px border box",
        );
        fs.writeFileSync(path.join(out, "border-image-marker.png"), bytes);
        await page.setViewportSize({ width: 400, height: 180 });
        await page.evaluate(probeSource);
        const result = await page.evaluate(async () => {
          const p = await qa.prepare(),
            plan = __cfpProtocol.makeTraversal(p),
            first = __cfpProtocol.nextFrameSpec(plan, null);
          await qa.moveTo(qa.getState(), first);
          qa.acceptFrame(qa.getState(), {
            spec: first,
            bitmapWidth: p.windowWidth,
            bitmapHeight: p.windowHeight,
            rect: __cfpProtocol.frameRect(
              p,
              first,
              p.windowWidth,
              p.windowHeight,
            ),
            novelRect: __cfpProtocol.novelFrameRect(
              plan,
              first,
              p.windowWidth,
              p.windowHeight,
            ),
          });
          let code;
          try {
            await qa.moveTo(
              qa.getState(),
              __cfpProtocol.nextFrameSpec(plan, first),
            );
          } catch (e) {
            code = e.code;
          }
          const hidden = qa.getState().hidden.size,
            accepted = qa.getState().lastAcceptedSpec.sequence,
            restored = await qa.restore();
          return {
            code,
            hidden,
            accepted,
            restored,
            opacity: getComputedStyle(document.querySelector(".header"))
              .opacity,
          };
        });
        assert.equal(result.code, "UNSUPPORTED_OCCLUSION");
        assert.equal(result.hidden, 0);
        assert.equal(result.accepted, 0);
        assert.equal(result.opacity, "1");
        return {
          ...result,
          markerPngSha256: crypto
            .createHash("sha256")
            .update(bytes)
            .digest("hex"),
          markerDimensions: { width: png.width, height: png.height },
          marker: { x: 100, y: 195, rgb: [200, 30, 40] },
        };
      },
    );
    await check(
      "disabled-auto-preserve-preclassified-zero-page-writes",
      async () => {
        await page.goto(base + "/virtual");
        await page.evaluate(probeSource);
        const result = await page.evaluate(async () => {
          const list = document.querySelector("#list");
          list.scrollTop = 100;
          let styleWrites = 0,
            attributes = 0,
            scrollWrites = 0;
          const set = CSSStyleDeclaration.prototype.setProperty,
            remove = CSSStyleDeclaration.prototype.removeProperty,
            attribute = Element.prototype.setAttribute,
            removeAttribute = Element.prototype.removeAttribute;
          CSSStyleDeclaration.prototype.setProperty = function (...args) {
            styleWrites++;
            return set.apply(this, args);
          };
          CSSStyleDeclaration.prototype.removeProperty = function (...args) {
            styleWrites++;
            return remove.apply(this, args);
          };
          Element.prototype.setAttribute = function (...args) {
            attributes++;
            return attribute.apply(this, args);
          };
          Element.prototype.removeAttribute = function (...args) {
            attributes++;
            return removeAttribute.apply(this, args);
          };
          const descriptors = new Map();
          for (const property of ["scrollTop", "scrollLeft"]) {
            const descriptor = Object.getOwnPropertyDescriptor(
              Element.prototype,
              property,
            );
            descriptors.set(property, descriptor);
            Object.defineProperty(Element.prototype, property, {
              ...descriptor,
              set(value) {
                scrollWrites++;
                return descriptor.set.call(this, value);
              },
            });
          }
          const nativeScrollTo = window.scrollTo;
          window.scrollTo = function (...args) {
            scrollWrites++;
            return nativeScrollTo.apply(this, args);
          };
          let observedMutations = 0;
          const observer = new MutationObserver(
            (records) => (observedMutations += records.length),
          );
          observer.observe(document.documentElement, {
            attributes: true,
            childList: true,
            subtree: true,
          });
          let code;
          try {
            await qa.prepare();
          } catch (e) {
            code = e.code;
          }
          const mutations = observedMutations + observer.takeRecords().length;
          observer.disconnect();
          CSSStyleDeclaration.prototype.setProperty = set;
          CSSStyleDeclaration.prototype.removeProperty = remove;
          Element.prototype.setAttribute = attribute;
          Element.prototype.removeAttribute = removeAttribute;
          for (const [property, descriptor] of descriptors)
            Object.defineProperty(Element.prototype, property, descriptor);
          window.scrollTo = nativeScrollTo;
          return {
            code,
            styleWrites,
            attributes,
            scrollWrites,
            mutations,
            originalScroll: 100,
            finalScroll: list.scrollTop,
            stateCleared: qa.getState() === null,
            styles: document.querySelectorAll("[data-cfp-capture-style]")
              .length,
          };
        });
        assert.equal(result.code, "UNSUPPORTED_TARGET_MAPPING");
        assert.equal(result.styleWrites, 0);
        assert.equal(result.attributes, 0);
        assert.equal(result.scrollWrites, 0);
        assert.equal(result.mutations, 0);
        assert.equal(result.finalScroll, 100);
        assert.ok(result.stateCleared);
        assert.equal(result.styles, 0);
        return result;
      },
    );
    await check("cancel-held-position-settle-no-late-mutation", async () => {
      await setup();
      const result = await page.evaluate(async () => {
        const prep = await qa.prepare(),
          context = qa.getState(),
          plan = __cfpProtocol.makeTraversal(prep),
          spec = __cfpProtocol.nextFrameSpec(plan, null);
        let held;
        qa.setSettler(() => new Promise((r) => (held = r)));
        const moving = qa.moveTo(context, spec).then(
          () => ({ ok: true }),
          (e) => ({ ok: false, code: e.code || null, message: e.message }),
        );
        const waitDeadline = performance.now() + 1000;
        while (!held) {
          if (performance.now() > waitDeadline)
            throw Error("No controlled position settle");
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        const started = performance.now(),
          restored = await qa.restore(context),
          elapsed = performance.now() - started,
          afterAck = scrollY;
        held();
        const settled = await moving;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        return {
          restored,
          elapsed,
          afterAck,
          afterSettle: scrollY,
          settled,
          stateCleared: qa.getState() === null,
          styles: document.querySelectorAll("[data-cfp-capture-style]").length,
        };
      });
      assert.equal(result.settled.ok, false);
      assert.equal(result.afterAck, 200);
      assert.equal(result.afterSettle, 200);
      assert.ok(result.elapsed <= 2000);
      assert.ok(result.stateCleared);
      assert.equal(result.styles, 0);
      return result;
    });
    for (const external of [false, true])
      await check(
        external
          ? "css-animation-page-style-preservation"
          : "css-animation-owned-pause-restored",
        async () => {
          await setup();
          const result = await page.evaluate(async (external) => {
            const el = document.querySelector(".motion"),
              original = el.style.cssText,
              animation = el.getAnimations({ subtree: false })[0];
            let mutated = 0;
            for (const method of [
              "pause",
              "play",
              "cancel",
              "finish",
              "commitStyles",
            ])
              animation[method] = () => {
                mutated++;
                throw Error("Animation state mutator " + method);
              };
            await qa.prepare();
            const during = getComputedStyle(el).animationPlayState;
            if (external)
              el.style.setProperty(
                "animation-play-state",
                "paused",
                "important",
              );
            const pageStyle = el.style.cssText;
            const restored = await qa.restore();
            return {
              original,
              during,
              pageStyle,
              finalStyle: el.style.cssText,
              after: getComputedStyle(el).animationPlayState,
              mutated,
              restored,
              styles: document.querySelectorAll("[data-cfp-capture-style]")
                .length,
            };
          }, external);
          assert.equal(result.during, "paused");
          assert.equal(
            result.finalStyle,
            external ? result.pageStyle : result.original,
          );
          assert.equal(result.after, external ? "paused" : "running");
          assert.equal(result.mutated, 0);
          assert.equal(result.styles, 0);
          return result;
        },
      );
  },
).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
