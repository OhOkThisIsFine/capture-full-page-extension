"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  Q = require("../../scripts/qa-contract.cjs"),
  { ordinaryFile } = require("../../scripts/verify-qa-candidate.cjs");
const CELL = 128;
function color(col, row) {
  return [
    20 + (col % 10) * 17,
    30 + (row % 10) * 19,
    50 + ((col + row) % 10) * 17,
    255,
  ];
}
function grid(width, height) {
  let html = `<div class="qa-grid" style="width:${width}px;height:${height}px;display:grid;grid-template-columns:repeat(${width / CELL},128px);grid-auto-rows:128px;overflow:hidden">`;
  for (let y = 0; y < Math.ceil(height / CELL); y++)
    for (let x = 0; x < width / CELL; x++) {
      const rgb = color(x, y);
      html += `<div style="background:rgb(${rgb.slice(0, 3)});font:2px sans-serif;overflow:hidden">.</div>`;
    }
  return html + "</div>";
}
function page(id, body, css = "") {
  return `<!doctype html><meta charset="utf-8"><title>CFP QA ${id}</title><style>html,body{margin:0;padding:0}*{box-sizing:border-box}${css}</style>${body}`;
}
function fixtures({ preserveVirtualizer = false } = {}) {
  const result = [];
  const add = (
    id,
    width,
    height,
    body,
    css = "",
    offsetX = 0,
    offsetY = 0,
    gridWidth = width,
    gridHeight = height,
  ) =>
    result.push({
      id,
      title: `CFP QA ${id}`,
      route: `/fixture/${id}`,
      width,
      height,
      offsetX,
      offsetY,
      gridWidth,
      gridHeight,
      html: page(id, body, css),
      result: "success",
    });
  for (const [id, w, h] of [
    ["coordinate-grid", 2048, 1024],
    ["short-viewports", 2048, 1024],
    ["fractional-scale", 2048, 1024],
    ["tile-boundary-8192", 1024, 8300],
    ["tile-boundary-adaptive", 4096, 2200],
  ])
    add(id, w, h, grid(w, h), `html,body{width:${w}px;height:${h}px}`);
  add(
    "nested-static-shell",
    2048,
    1088,
    '<div style="height:64px">synthetic shell</div><section style="height:256px;width:2048px;overflow:auto">' +
      grid(2048, 1024) +
      "</section>",
    "html,body{width:2048px}",
    0,
    64,
    2048,
    1024,
  );
  add(
    "iframe-padding",
    2096,
    1136,
    '<div style="height:64px">synthetic frame padding</div><iframe src="/frame-grid" style="display:block;width:2096px;height:256px;padding:16px;border:8px solid rgb(100,40,160)"></iframe>',
    "html,body{width:2096px;height:1136px}",
    24,
    88,
    2048,
    1024,
  );
  const root = path.resolve(__dirname, "../fixtures");
  for (const [id, file] of [
    ["preserve-required", "app-shell.html"],
    ["shrinking-scroller", "shrinking-scroller.html"],
  ]) {
    const bytes = ordinaryFile(path.join(root, file), 2 * 1024 * 1024);
    result.push({
      id,
      title: `CFP QA ${id}`,
      route: `/fixture/${id}`,
      html: bytes
        .toString("utf8")
        .replace(/<title>[^<]*<\/title>/, `<title>CFP QA ${id}</title>`),
      result: "pre-initiation-failure",
    });
  }
  const virtualSource = ordinaryFile(
    path.join(root, "virtual-scroller.html"),
    65536,
  ).toString("utf8");
  for (const mode of [
    "scroll-only",
    "resize-observer",
    "recycled",
    "recreated",
  ]) {
    const id = "virtual-" + mode;
    result.push({
      id,
      title: `CFP QA ${id}`,
      route: `/fixture/${id}`,
      kind: "virtual",
      width: 900,
      height: 4000,
      html: virtualSource.replaceAll("__MODE__", mode),
      result: preserveVirtualizer ? "success" : "pre-initiation-failure",
    });
  }
  return result.map((f) =>
    Object.freeze({
      ...f,
      ...(f.id === "nested-static-shell"
        ? {
            initialGeometry: { width: 2048, height: 320 },
            expandedGeometry: { width: 2048, height: 1088 },
          }
        : {}),
      sourceSha256: Q.digest(Buffer.from(f.html)),
    }),
  );
}
function routes(list) {
  const map = new Map(list.map((f) => [f.route, Buffer.from(f.html)]));
  map.set(
    "/frame-grid",
    Buffer.from(
      page(
        "frame-inner",
        grid(2048, 1024),
        "html,body{width:2048px;height:1024px}",
      ),
    ),
  );
  map.set(
    "/",
    Buffer.from(
      `<!doctype html><title>CFP isolated native QA</title><h1>Manual native capture fixtures</h1><p>This is a new task-owned profile. Load only the verified candidate through ordinary browser UI. Record genuine gestures, native Downloads preference and extension ID/version; stop at a persistent permission prompt. Write reviewer evidence in the owned run directory. No check passes from opening this page.</p><p id="viewport"></p><script>function show(){document.querySelector("#viewport").textContent="Observed index viewport: "+innerWidth+" � "+innerHeight+" CSS px; DPR "+devicePixelRatio+". Resize through ordinary UI before loading a fixture; width must not exceed fixture width and height must not exceed fixture height.";}addEventListener("resize",show);show();</script><ul>${list.map((f) => `<li><a href="${f.route}">${f.title}</a></li>`).join("")}</ul>`,
    ),
  );
  return map;
}
function handleRequest(routeMap, req, res) {
  const host = req.headers?.host || "";
  const allowedHost = /^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(host);
  if (
    !allowedHost ||
    req.socket?.remoteAddress !== "127.0.0.1" ||
    !["GET", "HEAD"].includes(req.method) ||
    !routeMap.has(req.url)
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'",
  });
  res.end(req.method === "HEAD" ? undefined : routeMap.get(req.url));
}
function filenamePattern(fixture) {
  return new RegExp(
    `^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_127\\.0\\.0\\.1_CFP QA ${fixture.id}(?:[ -]?\\([0-9]{1,6}\\)|-[0-9]{1,6})?\\.png$`,
  );
}
function verifyPixels(png, fixture) {
  Q.requireThat(
    fixture.result === "success",
    "Unexpected download for failure fixture",
  );
  const ratio = png.width / fixture.width;
  Q.requireThat(
    ratio >= 0.1 &&
      ratio <= 8 &&
      Math.abs(png.height - fixture.height * ratio) <= 1,
    "Native output dimensions/scale mismatch",
  );
  const seam =
    fixture.id === "tile-boundary-8192"
      ? 8192
      : fixture.id === "tile-boundary-adaptive"
        ? 2048
        : null;
  if (seam !== null)
    Q.requireThat(
      ratio === 1 &&
        png.width === fixture.width &&
        png.height === fixture.height &&
        png.height > seam &&
        Math.min(8192, Math.floor((8 * 1024 * 1024) / png.width)) === seam,
      "Named tile case must cross exact production boundary at scale 1",
    );
  let samples = 0,
    seamSamples = 0;
  if (seam !== null)
    for (const y of [seam - 1, seam, seam + 1])
      for (let x = 0; x < png.width; x++) {
        Q.requireThat(
          Q.canonical(png.pixel(x, y)).equals(
            Q.canonical(color(Math.floor(x / CELL), Math.floor(y / CELL))),
          ),
          "Independent tile seam pixel mismatch",
        );
        seamSamples++;
      }
  if (fixture.kind === "virtual") {
    for (let row = 0; row < 100; row++) {
      for (const [x, rgb] of [
        [10, [30, 210, 120, 255]],
        [450, [(row * 17) % 251, (row * 29) % 251, (row * 43) % 251, 255]],
        [890, [230, 40, 90, 255]],
      ]) {
        Q.requireThat(
          Q.canonical(
            png.pixel(
              Math.floor(x * ratio),
              Math.floor((row * 40 + 20) * ratio),
            ),
          ).equals(Q.canonical(rgb)),
          "Virtual row identity/edge mismatch",
        );
        samples++;
      }
    }
    return {
      width: png.width,
      height: png.height,
      scale: ratio,
      markerSamples: samples,
      seamSamples,
      passed: true,
    };
  }
  for (let y = 0; y < fixture.gridHeight; y += CELL)
    for (let x = 0; x < fixture.gridWidth; x += CELL) {
      const px = Math.min(
          png.width - 1,
          Math.floor((fixture.offsetX + x + 64) * ratio),
        ),
        py = Math.min(
          png.height - 1,
          Math.floor(
            (fixture.offsetY + y + Math.min(64, (fixture.gridHeight - y) / 2)) *
              ratio,
          ),
        );
      Q.requireThat(
        Q.canonical(png.pixel(px, py)).equals(
          Q.canonical(color(x / CELL, Math.floor(y / CELL))),
        ),
        "Independent coordinate marker mismatch",
      );
      samples++;
    }
  return {
    width: png.width,
    height: png.height,
    scale: ratio,
    markerSamples: samples,
    seamSamples,
    passed: true,
  };
}
module.exports = {
  CELL,
  color,
  fixtures,
  routes,
  handleRequest,
  filenamePattern,
  verifyPixels,
};
