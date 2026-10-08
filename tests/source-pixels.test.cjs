const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  zlib = require("node:zlib");
const { compositor, prep, scope } = require("./dispatcher-harness.cjs");
function color(x, y) {
  return [
    x % 251,
    y % 251,
    (Math.floor(x / 251) + Math.floor(y / 251)) % 251,
    255,
  ];
}
function installPixels(h, width, height) {
  let source = null,
    output = null,
    closed = 0;
  const canvases = [];
  class Canvas {
    constructor(w, h) {
      this._w = w;
      this._h = h;
      this.pixels = new Uint8Array(w * h * 4);
      canvases.push(this);
    }
    get width() {
      return this._w;
    }
    set width(w) {
      this._w = w;
      this.pixels = new Uint8Array(w * this._h * 4);
    }
    get height() {
      return this._h;
    }
    set height(h) {
      this._h = h;
      this.pixels = new Uint8Array(this._w * h * 4);
    }
    getContext() {
      const canvas = this;
      return {
        fillRect(x, y, w, h) {
          for (let row = y; row < y + h; row++)
            for (let col = x; col < x + w; col++)
              canvas.pixels.set(
                [255, 255, 255, 255],
                (row * canvas.width + col) * 4,
              );
        },
        drawImage(bitmap, ...args) {
          let sx = 0,
            sy = 0,
            sw = bitmap.width,
            sh = bitmap.height,
            dx = 0,
            dy = 0,
            dw = sw,
            dh = sh;
          if (args.length === 2) [dx, dy] = args;
          else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
          assert.equal(dw, sw, "unexpected source rescaling");
          assert.equal(dh, sh, "unexpected source rescaling");
          for (let row = 0; row < sh; row++) {
            const from = ((sy + row) * bitmap.width + sx) * 4,
              to = ((dy + row) * canvas.width + dx) * 4;
            assert.ok(
              sx >= 0 &&
                sy + row >= 0 &&
                sx + sw <= bitmap.width &&
                sy + row < bitmap.height,
              "source out of bounds",
            );
            canvas.pixels.set(bitmap.pixels.subarray(from, from + sw * 4), to);
          }
        },
        getImageData(x, y, w, h) {
          const data = new Uint8Array(w * h * 4);
          for (let row = 0; row < h; row++)
            data.set(
              canvas.pixels.subarray(
                ((y + row) * canvas.width + x) * 4,
                ((y + row) * canvas.width + x + w) * 4,
              ),
              row * w * 4,
            );
          return { data };
        },
      };
    }
    async convertToBlob() {
      const blob = new Blob([zlib.deflateSync(this.pixels)]);
      blob.pixelWidth = this.width;
      blob.pixelHeight = this.height;
      return blob;
    }
  }
  h.c.OffscreenCanvas = Canvas;
  h.c.createImageBitmap = async (blob) => {
    let pixels, w, h;
    if (blob.pixelWidth) {
      w = blob.pixelWidth;
      h = blob.pixelHeight;
      pixels = new Uint8Array(
        zlib.inflateSync(Buffer.from(await blob.arrayBuffer())),
      );
    } else {
      w = width;
      h = height;
      pixels = source;
    }
    return {
      width: w,
      height: h,
      pixels,
      close() {
        closed++;
        this.pixels = null;
      },
    };
  };
  h.c.URL.createObjectURL = (blob) => {
    output = blob;
    return "blob:coordinate-oracle";
  };
  return {
    setFrame(p, spec) {
      const rx = width / p.windowWidth,
        ry = height / p.windowHeight,
        originX =
          Math.round(spec.logicalX * rx) - Math.round(spec.sourceLeft * rx),
        originY =
          Math.round(spec.logicalY * ry) - Math.round(spec.sourceTop * ry);
      source = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          source.set(color(x + originX, y + originY), (y * width + x) * 4);
    },
    blob: () => output,
    canvases,
    closed: () => closed,
  };
}
function decode(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let width, height;
  const idat = [];
  for (let offset = 8; offset < bytes.length; ) {
    const size = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8),
      payload = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
    }
    if (type === "IDAT") idat.push(payload);
    offset += 12 + size;
  }
  const compressed = Buffer.concat(idat),
    result = zlib.inflateSync(compressed, {
      info: true,
      maxOutputLength: height * (width * 4 + 1) + 1,
    });
  assert.equal(result.engine.bytesWritten, compressed.length);
  assert.equal(result.buffer.length, height * (width * 4 + 1));
  return { width, height, scanlines: result.buffer };
}
for (const fixture of [
  { scale: 0.75, width: 2000, height: 12000, vw: 800, vh: 601 },
  { scale: 1.25, width: 1200, height: 9000, vw: 600, vh: 601 },
  { scale: 2, width: 480, height: 9000, vw: 200, vh: 191 },
  { scale: 1.25, width: 700, height: 8800, vw: 640, vh: 480, crop: true },
  { scale: 0.2, width: 20, height: 21, vw: 10, vh: 3, zero: true },
])
  test(`source-coordinate pixels survive fractional scale ${fixture.scale} and multiple tiles`, async () => {
    const h = compositor(),
      p = prep(scope(), {
        width: fixture.width,
        height: fixture.height,
        viewportWidth: fixture.vw,
        viewportHeight: fixture.vh,
      }),
      bw = Math.round(fixture.vw * fixture.scale),
      bh = Math.round(fixture.vh * fixture.scale),
      pixels = installPixels(h, bw, bh);
    if (fixture.crop)
      Object.assign(p, {
        strategy: "preserve",
        captureScope: "target-only",
        sourceLeft: 31.25,
        sourceTop: 19.5,
        clientWidth: 300,
        clientHeight: 400,
      });
    assert.equal((await h.request(p, "start", { prep: p })).ok, true);
    const plan = h.P.makeTraversal(p);
    let previous = null,
      spec,
      frames = 0,
      maxSaved = 0,
      zeroNovel = 0;
    while ((spec = h.P.nextFrameSpec(plan, previous))) {
      pixels.setFrame(p, spec);
      const reply = await h.frame(p, spec);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      if (reply.novelRect === null) zeroNovel++;
      previous = spec;
      frames++;
      maxSaved = Math.max(
        maxSaved,
        h.api.sessions.get(p.sessionId).savedTiles.size,
      );
    }
    if (!fixture.zero)
      assert.ok(maxSaved >= 1, "no tile was finalized during traversal");
    if (fixture.zero)
      assert.ok(zeroNovel > 0, "fixture did not acquire a zero-novel frame");
    const reply = await h.request(p, "finish", { intentId: scope().owner });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    const image = decode(Buffer.from(await pixels.blob().arrayBuffer()));
    assert.equal(image.width, Math.floor((fixture.width * bw) / fixture.vw));
    assert.equal(image.height, Math.floor((fixture.height * bh) / fixture.vh));
    let mismatch = null;
    for (let y = 0; y < image.height; y++) {
      const row = y * (image.width * 4 + 1);
      assert.equal(image.scanlines[row], 0);
      for (let x = 0; x < image.width; x++) {
        const offset = row + 1 + x * 4,
          c = color(x, y);
        if (
          image.scanlines[offset] !== c[0] ||
          image.scanlines[offset + 1] !== c[1] ||
          image.scanlines[offset + 2] !== c[2] ||
          image.scanlines[offset + 3] !== 255
        ) {
          mismatch = {
            x,
            y,
            actual: [...image.scanlines.subarray(offset, offset + 4)],
            expected: c,
          };
          break;
        }
      }
      if (mismatch) break;
    }
    assert.equal(mismatch, null, JSON.stringify(mismatch));
    assert.ok(frames > 10);
    assert.equal(h.api.resources.size, 1);
    for (const canvas of pixels.canvases) {
      assert.equal(canvas.width, 1);
      assert.equal(canvas.height, 1);
    }
  });
