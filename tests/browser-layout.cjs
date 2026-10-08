const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { browserTask, bands, root } = require("./browser-harness.cjs");
const crypto = require("node:crypto"),
  originalShell = fs.readFileSync(
    path.join(root, "tests/fixtures/app-shell.html"),
    "utf8",
  );
// The original animated/opaque shell must reject before mutation. The positive
// static variant adds a real direct-text leaf at both required exposure edges.
const exposedShell = originalShell.replace(
  "<capture-shadow></capture-shadow>",
  '<div style="height:80px;width:100%">STATIC RIGHT/BOTTOM END SENTINEL</div>',
);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const report = {
  sourceCommit: process.env.CFP_SOURCE_COMMIT || null,
  fixtureHashes: {
    originalShell: hash(originalShell),
    exposedShell: hash(exposedShell),
  },
  scope:
    "Source evaluation in isolated synthetic Chrome profile; no extension loaded, no activeTab grant or native downloads.",
  bands: [],
};
browserTask(
  (url) =>
    url === "/app-shell"
      ? exposedShell
      : url === "/app-shell-opaque"
        ? originalShell
        : bands(),
  async ({ page, base, source, browser }) => {
    report.browser = browser;
    for (const height of [100, 149, 150, 151, 180, 190, 191, 300]) {
      await page.setViewportSize({ width: 400, height });
      await page.goto(base + "/bands");
      await page.evaluate(source);
      await page.evaluate(() => scrollTo(0, 37));
      const result = await page.evaluate(async () => {
        const p = await qa.prepare(),
          plan = __cfpProtocol.makeTraversal(p);
        let previous = null,
          spec,
          count = 0;
        while ((spec = __cfpProtocol.nextFrameSpec(plan, previous))) {
          const snapshot = await qa.moveTo(qa.getState(), spec),
            r = __cfpProtocol.validateSnapshot(plan, spec, snapshot);
          if (!r.ok) throw Error(JSON.stringify(r));
          qa.acceptFrame(qa.getState(), {
            spec,
            bitmapWidth: p.windowWidth,
            bitmapHeight: p.windowHeight,
            rect: __cfpProtocol.frameRect(
              p,
              spec,
              p.windowWidth,
              p.windowHeight,
            ),
            novelRect: __cfpProtocol.novelFrameRect(
              plan,
              spec,
              p.windowWidth,
              p.windowHeight,
            ),
          });
          previous = spec;
          count++;
        }
        const restored = await qa.restore();
        return {
          count,
          scrollY,
          targetHeight: p.targetHeight,
          restored,
          styles: document.querySelectorAll("[data-cfp-capture-style]").length,
        };
      });
      assert.equal(result.scrollY, 37);
      assert.equal(result.targetHeight, 2000);
      assert.equal(result.styles, 0);
      assert.equal(result.restored.status, "acknowledged");
      report.bands.push({ height, ...result });
      console.log("DOM bands pass", height, result.count);
    }
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(base + "/app-shell-opaque");
    await page.waitForFunction(
      () =>
        document.querySelector("#frame").contentDocument?.readyState ===
        "complete",
    );
    await page.evaluate(source);
    const rejected = await page.evaluate(async () => {
      const nested = document.querySelector("#scroller"),
        frame = document.querySelector("#frame");
      nested.scrollTop = 83;
      nested.scrollLeft = 17;
      frame.contentWindow.scrollTo(0, 43);
      const originals = [...document.querySelectorAll("*")].map((el) => ({
        el,
        style: el.style?.cssText || "",
      }));
      let code;
      try {
        await qa.prepare();
      } catch (e) {
        code = e.code;
      }
      return {
        code,
        stylesUnchanged: originals.every(
          ({ el, style }) => (el.style?.cssText || "") === style,
        ),
        nestedTop: nested.scrollTop,
        nestedLeft: nested.scrollLeft,
        frameTop: frame.contentWindow.scrollY,
        styles: document.querySelectorAll("[data-cfp-capture-style]").length,
      };
    });
    assert.equal(rejected.code, "UNSUPPORTED_TARGET_MAPPING");
    assert.ok(rejected.stylesUnchanged);
    assert.equal(rejected.nestedTop, 83);
    assert.equal(rejected.nestedLeft, 17);
    assert.equal(rejected.frameTop, 43);
    assert.equal(rejected.styles, 0);
    report.opaqueShell = rejected;
    await page.goto(base + "/app-shell");
    await page.waitForFunction(
      () =>
        document.querySelector("#frame").contentDocument?.readyState ===
        "complete",
    );
    await page.evaluate(source);
    for (const stage of ["before-unlock", "after-unlock"]) {
      const result = await page.evaluate(async (stage) => {
        const nested = document.querySelector("#scroller");
        nested.scrollTop = 83;
        nested.scrollLeft = 17;
        const frame = document.querySelector("#frame");
        frame.contentWindow.scrollTo(0, 43);
        const originals = [...document.querySelectorAll("*")].map((el) => ({
          el,
          style: el.style?.cssText || "",
        }));
        let calls = 0,
          held;
        qa.setSettler(() =>
          ++calls === (stage === "before-unlock" ? 1 : 2)
            ? new Promise((r) => (held = r))
            : Promise.resolve(),
        );
        const old = qa.prepare().then(
          () => ({ ok: true }),
          (e) => ({ error: e.message }),
        );
        const deadline = Date.now() + 800;
        while (!held) {
          if (Date.now() > deadline)
            throw Error("Preparation pause not reached");
          await new Promise((r) => setTimeout(r, 5));
        }
        const restoration = await qa.restore(),
          restored =
            nested.scrollTop === 83 &&
            nested.scrollLeft === 17 &&
            frame.contentWindow.scrollY === 43 &&
            originals.every(
              ({ el, style }) => (el.style?.cssText || "") === style,
            );
        qa.setSettler(() => Promise.resolve());
        const next = qa.prepare();
        held();
        const oldResult = await old;
        await next;
        await qa.restore();
        return {
          restored,
          restoration,
          oldResult,
          after: nested.scrollTop,
          frameAfter: frame.contentWindow.scrollY,
          styles: document.querySelectorAll("[data-cfp-capture-style]").length,
        };
      }, stage);
      assert.ok(result.restored, JSON.stringify(result));
      assert.equal(result.restoration.preservedPageChanges, 0);
      assert.equal(result.restoration.failedCount, 0);
      assert.ok(result.oldResult.error);
      assert.equal(result.after, 83);
      assert.equal(result.frameAfter, 43);
      assert.equal(result.styles, 0);
      report[stage] = result;
      console.log("Interrupted preparation pass", stage);
    }
    if (process.env.CFP_QA_REPORT)
      fs.writeFileSync(
        process.env.CFP_QA_REPORT,
        JSON.stringify(report, null, 2),
      );
    console.log(JSON.stringify(report));
  },
).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
