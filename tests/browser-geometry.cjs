const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { PNG } = require(process.env.PNGJS_MODULE || "pngjs");
const { browserTask } = require("./browser-harness.cjs");
const output = process.env.CFP_QA_OUTPUT;
if (!output) throw Error("Task-owned output required");
fs.mkdirSync(output, { recursive: true });
const fixtures = {
  fixed:
    '<style>html,body{margin:0;width:400px;height:1800px}.header{position:fixed;top:0;left:0;width:100%;height:80px;background:rgb(200,30,40)}.marker{position:absolute;top:100px;left:0;width:400px;height:100px;background:rgb(20,100,200)}</style><div class="header"></div><div class="marker"></div>',
  transformed:
    '<style>html,body{margin:0;width:400px;height:1800px}.host{position:relative;transform:translateZ(0);margin-top:100px;width:400px;height:900px}.anchored{position:fixed;top:0;width:400px;height:900px;background:rgb(30,180,40)}.marker{position:absolute;top:800px;width:400px;height:50px;background:rgb(20,100,200)}</style><div class="host"><div class="anchored"><div class="marker"></div></div></div>',
  wide: '<style>html,body{margin:0;width:800px;height:1800px}.header{position:sticky;top:0;width:800px;height:80px;overflow:hidden;background:rgb(200,30,40)}.marker{position:absolute;top:100px;left:0;width:800px;height:100px;background:rgb(20,100,200)}</style><div class="header"></div><div class="marker"></div>',
};
const report = {
  scope:
    "Native DOM and screenshot source, real trusted compositor/encoder; no installed extension or native downloads",
  fixtures: [],
};
browserTask(
  (url) => "<!doctype html>" + fixtures[url.slice(1)],
  async ({ page, base, source, browser }) => {
    report.browser = browser;
    await page.setViewportSize({ width: 400, height: 600 });
    for (const name of Object.keys(fixtures)) {
      await page.goto(base + "/" + name);
      await page.evaluate(source);
      const p = await page.evaluate(() => qa.prepare()),
        plan = await page.evaluate((p) => __cfpProtocol.makeTraversal(p), p);
      const request = (type, payload = {}) =>
        page.evaluate((message) => __cfpCompositorHandle(message), {
          target: "cfp-offscreen",
          protocolVersion: 1,
          requestId: randomUUID(),
          operationId: p.operationId,
          sessionId: p.sessionId,
          owner: p.owner,
          type,
          ...payload,
        });
      assert.equal(
        (
          await request("start", {
            prep: p,
            captureContext: {
              targetBrowser: "firefox",
              tabId: 0,
              windowId: 0,
              incognito: false,
            },
            deadlines: {
              operationExpiresAt: Date.now() + 900000,
              captureExpiresAt: Date.now() + 600000,
              encodeBudgetMs: 300000,
            },
            budget: {
              operationEnvelopeBytes: 512 * 1024 * 1024,
              maxOutputBytes: 128 * 1024 * 1024,
              observedLedgerRevision: 0,
            },
          })
        ).ok,
        true,
      );
      let previous = null,
        count = 0;
      const hidden = [];
      while (true) {
        const spec = await page.evaluate(
          ({ plan, previous }) => __cfpProtocol.nextFrameSpec(plan, previous),
          { plan, previous },
        );
        if (!spec) break;
        const preSnapshot = await page.evaluate(
          (spec) => qa.moveTo(qa.getState(), spec),
          spec,
        );
        hidden.push(await page.evaluate(() => qa.getState().hidden.size));
        const screenshot = await page.screenshot(),
          postSnapshot = await page.evaluate(
            (spec) => qa.snapshot(qa.getState(), spec),
            spec,
          ),
          reply = await request("frame", {
            spec,
            preSnapshot,
            postSnapshot,
            dataUrl: "data:image/png;base64," + screenshot.toString("base64"),
          });
        assert.equal(reply.ok, true, JSON.stringify(reply));
        await page.evaluate(
          ({ spec, reply }) =>
            qa.acceptFrame(qa.getState(), {
              spec,
              bitmapWidth: reply.bitmapWidth,
              bitmapHeight: reply.bitmapHeight,
              rect: reply.rect,
              novelRect: reply.novelRect,
            }),
          { spec, reply },
        );
        previous = spec;
        count++;
      }
      const restoration = await page.evaluate(() => qa.restore());
      assert.equal(restoration.status, "acknowledged");
      const intentId = randomUUID(),
        finished = await request("finish", { intentId });
      assert.equal(finished.ok, true, JSON.stringify(finished));
      const bytes = Buffer.from(
          await page.evaluate(
            async (url) =>
              Array.from(
                new Uint8Array(await (await fetch(url)).arrayBuffer()),
              ),
            finished.url,
          ),
        ),
        png = PNG.sync.read(bytes),
        x = name === "wide" ? 700 : 20,
        y = name === "transformed" ? 910 : 120;
      assert.deepEqual(
        [
          ...png.data.subarray(
            (y * png.width + x) * 4,
            (y * png.width + x) * 4 + 3,
          ),
        ],
        [20, 100, 200],
        name + " lower marker at document coordinates",
      );
      if (name === "transformed") assert.ok(hidden.every((n) => n === 0));
      else assert.ok(hidden.some((n) => n === 1));
      if (name === "wide") assert.deepEqual(hidden.slice(0, 3), [0, 0, 0]);
      fs.writeFileSync(path.join(output, name + ".png"), bytes);
      assert.equal(
        (
          await request("download-release", {
            intentId,
            expectedRevision: finished.revision,
            reason: "DISCARDED_UNARMED",
          })
        ).ok,
        true,
      );
      report.fixtures.push({
        name,
        frames: count,
        hidden,
        marker: { x, y, rgb: [20, 100, 200] },
        restoration,
      });
      console.log("NATIVE GEOMETRY PASS", name);
    }
    await page.goto(base + "/fixed");
    await page.evaluate(source);
    const mappingRejections = await page.evaluate(() => {
      const host = document.createElement("div"),
        target = document.createElement("div");
      host.style.cssText =
        "overflow:hidden;border-radius:20px;width:200px;height:100px";
      host.append(target);
      document.body.append(host);
      const codes = [];
      for (const kind of ["rounded", "masked"]) {
        if (kind === "masked") {
          host.style.borderRadius = "0";
          host.style.clipPath = "circle(50%)";
        }
        try {
          qa.assertSupportedMapping({ scroller: target, isDocument: false });
          codes.push("accepted");
        } catch (error) {
          codes.push(error.code);
        }
      }
      host.remove();
      return codes;
    });
    assert.deepEqual(mappingRejections, [
      "UNSUPPORTED_TARGET_MAPPING",
      "UNSUPPORTED_TARGET_MAPPING",
    ]);
    report.mappingRejections = mappingRejections;
    await page.goto(base + "/fixed");
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.id = "child-test";
      frame.srcdoc =
        "<!doctype html><style>html,body{margin:0;width:300px;height:1000px}</style>synthetic child";
      frame.style.cssText = "width:300px;height:200px";
      document.body.append(frame);
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#child-test").contentDocument?.readyState ===
        "complete",
    );
    await page.evaluate(source);
    const childPrep = await page.evaluate(() => qa.prepare());
    const childRotation = await page.evaluate((p) => {
      const frame = document.querySelector("#child-test");
      frame.contentDocument.documentElement.style.rotate = "180deg";
      const spec = __cfpProtocol.nextFrameSpec(
        __cfpProtocol.makeTraversal(p),
        null,
      );
      try {
        qa.snapshot(qa.getState(), spec);
        return "accepted";
      } catch (error) {
        return error.code;
      }
    }, childPrep);
    assert.equal(childRotation, "GEOMETRY_CHANGED");
    await page.evaluate(() => qa.restore());
    report.childRealmRotation = childRotation;
    fs.writeFileSync(
      path.join(output, "native-geometry-report.json"),
      JSON.stringify(report, null, 2),
    );
  },
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
