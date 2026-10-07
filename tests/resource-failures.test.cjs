const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { compositor, prep, scope } = require("./dispatcher-harness.cjs");
for (const kind of [
  "tile-convert",
  "tile-decode",
  "image-data",
  "compressor-constructor",
  "reader-acquire",
  "reader-read",
  "pipe-write",
  "blob-constructor",
])
  test(`encoder ${kind} failure releases backing allocations and permits fresh admission`, async () => {
    const c = compositor(),
      p = prep(scope(), { height: 180 });
    assert.equal((await c.request(p, "start", { prep: p })).ok, true);
    await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
    const NativeCanvas = c.c.OffscreenCanvas,
      NativeBitmap = c.c.createImageBitmap,
      NativeCompression = c.c.CompressionStream,
      NativeBlob = c.c.Blob;
    const canvases = [];
    c.c.OffscreenCanvas = class extends NativeCanvas {
      constructor(...args) {
        super(...args);
        canvases.push(this);
      }
      getContext() {
        const ctx = super.getContext();
        if (kind === "image-data")
          ctx.getImageData = () => {
            throw Error("synthetic ImageData failure");
          };
        return ctx;
      }
    };
    if (kind === "tile-convert")
      for (const tile of c.api.sessions.get(p.sessionId).activeTiles.values())
        tile.canvas.convertToBlob = async () => {
          throw Error("synthetic convert failure");
        };
    if (kind === "tile-decode")
      c.c.createImageBitmap = async (blob) => {
        if (blob.syntheticWidth) throw Error("synthetic tile decode failure");
        return NativeBitmap(blob);
      };
    if (kind === "blob-constructor")
      c.c.Blob = class extends NativeBlob {
        constructor(parts, options) {
          if (options?.type === "image/png")
            throw Error("synthetic Blob failure");
          super(parts, options);
        }
      };
    if (
      kind.startsWith("compressor") ||
      kind.startsWith("reader") ||
      kind === "pipe-write"
    )
      c.c.CompressionStream = class {
        constructor(format) {
          if (kind === "compressor-constructor")
            throw Error("synthetic compressor failure");
          const stream = new NativeCompression(format);
          this.writable =
            kind === "pipe-write"
              ? new WritableStream({
                  write() {
                    throw Error("synthetic pipe failure");
                  },
                })
              : stream.writable;
          this.readable = {
            getReader() {
              if (kind === "reader-acquire")
                throw Error("synthetic getReader failure");
              const reader = stream.readable.getReader();
              return {
                read: () =>
                  kind === "reader-read"
                    ? Promise.reject(Error("synthetic read failure"))
                    : reader.read(),
                cancel: (error) => reader.cancel(error),
                releaseLock: () => reader.releaseLock(),
              };
            },
          };
        }
      };
    const result = await c.request(p, "finish", { intentId: scope().owner });
    assert.equal(result.ok, false, kind);
    assert.equal(c.counts.urls, 0);
    assert.equal(c.api.sessions.size, 0);
    assert.equal(c.api.resources.size, 0, kind);
    assert.equal(c.api.statusSnapshot().pendingDisposalBytes, 0, kind);
    for (const canvas of canvases) {
      assert.equal(canvas.width, 1);
      assert.equal(canvas.height, 1);
    }
    c.c.OffscreenCanvas = NativeCanvas;
    c.c.createImageBitmap = NativeBitmap;
    c.c.CompressionStream = NativeCompression;
    c.c.Blob = NativeBlob;
    const fresh = prep();
    assert.equal((await c.request(fresh, "start", { prep: fresh })).ok, true);
    await c.request(fresh, "abort");
    assert.equal(c.api.resources.size, 0);
  });
test("returned excessive compressor backing records observed native peak and drops ownership", async () => {
  const c = compositor(),
    p = prep(scope(), { height: 180 });
  await c.request(p, "start", { prep: p });
  const s = c.api.sessions.get(p.sessionId);
  s.operationEnvelopeBytes = 16 * 1024 * 1024 + 1024 * 1024;
  const bytes = new Uint8Array(2 * 1024 * 1024),
    reader = {
      read: async () => ({ done: false, value: bytes.subarray(0, 1) }),
    },
    encoding = { parts: [], leases: new Set(), staging: null, failed: null };
  await assert.rejects(
    c.api.collectIdatChunks(reader, s, encoding),
    (error) => error.code === "RESOURCE_LIMIT",
  );
  assert.equal(s.excessNativeAllocation, true);
  assert.ok(s.observedNativePeak >= 19 * 1024 * 1024);
  await c.request(p, "abort");
  assert.equal(c.api.resources.size, 0);
});
test("oversized returned native bitmap is observed and closed before fresh admission", async () => {
  const c = compositor(),
    p = prep();
  await c.request(p, "start", { prep: p });
  const s = c.api.sessions.get(p.sessionId);
  c.c.createImageBitmap = async () => ({
    width: 30000,
    height: 1000,
    close() {
      c.counts.closed++;
    },
  });
  const reply = await c.frame(p, c.P.nextFrameSpec(c.P.makeTraversal(p), null));
  assert.equal(reply.code, "RESOURCE_LIMIT");
  assert.equal(s.excessNativeAllocation, true);
  assert.ok(s.observedNativePeak >= 120000000);
  assert.equal(c.counts.closed, 1);
  assert.equal(c.api.resources.size, 0);
  assert.equal(c.counts.urls, 0);
});
