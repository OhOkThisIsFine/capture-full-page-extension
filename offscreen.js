const TILE_HEIGHT = 8192;
const sessions = new Map();
const blobUrls = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "cfp-offscreen") return;

  handle(message)
    .then(sendResponse)
    .catch(error => {
      console.error("Capture Full Page compositor failed:", error);
      sendResponse({ error: String(error?.message || error) });
    });

  return true;
});

async function handle(message) {
  switch (message.type) {
    case "start":
      sessions.set(message.sessionId, createSession(message.prep));
      return { ok: true };
    case "frame":
      return addFrame(message);
    case "finish":
      return finish(message.sessionId);
    case "revoke":
      revoke(message.url);
      return { ok: true };
    default:
      throw new Error("Unknown compositor command.");
  }
}

function createSession(prep) {
  return {
    prep,
    ratioX: null,
    ratioY: null,
    widthPx: null,
    heightPx: null,
    activeTiles: new Map(),
    savedTiles: new Map(),
    lastDestY: 0,
    frames: 0
  };
}

async function addFrame(message) {
  const s = sessions.get(message.sessionId);
  if (!s) throw new Error("Unknown capture session.");

  const response = await fetch(message.dataUrl);
  if (!response.ok) throw new Error("Could not read captured frame.");
  const bitmap = await createImageBitmap(await response.blob());

  try {
    if (s.ratioX == null) initializeGeometry(s, bitmap);

    const p = message.position;
    const stickyPx = p.stickyCrop > 0 ? Math.max(0, Math.floor(p.stickyCrop * s.ratioY)) : 0;

    const sourceLeft = Math.max(0, Math.round(p.sourceLeft * s.ratioX));
    const sourceTopBase = Math.max(0, Math.round(p.sourceTop * s.ratioY));
    const sourceWidth = Math.max(1, Math.round(p.clientWidth * s.ratioX));
    const sourceHeight = Math.max(1, Math.round(p.clientHeight * s.ratioY));

    const destX = Math.max(0, Math.round(p.logicalX * s.ratioX));
    const destY = Math.max(0, Math.round(p.logicalY * s.ratioY) + stickyPx);

    // Like FireShot, later vertical rows discard the top 150 CSS pixels but
    // place the remainder at y + 150. Because rows moved by viewport-190,
    // this leaves a deliberate overlap instead of an edge-to-edge seam.
    const sx = sourceLeft;
    const sy = sourceTopBase + stickyPx;
    const sw = Math.min(sourceWidth, bitmap.width - sx, s.widthPx - destX);
    const sh = Math.min(
      sourceHeight - stickyPx,
      bitmap.height - sy,
      s.heightPx - destY
    );

    if (sw <= 0 || sh <= 0) return { ok: true };

    await finalizeTilesBefore(s, destY);
    drawAcrossTiles(s, bitmap, sx, sy, sw, sh, destX, destY);

    s.lastDestY = Math.max(s.lastDestY, destY);
    s.frames += 1;
    return { ok: true, ratioX: s.ratioX, ratioY: s.ratioY };
  } finally {
    bitmap.close();
  }
}

function initializeGeometry(s, bitmap) {
  s.ratioX = bitmap.width / s.prep.windowWidth;
  s.ratioY = bitmap.height / s.prep.windowHeight;

  if (!Number.isFinite(s.ratioX) || !Number.isFinite(s.ratioY) || s.ratioX <= 0 || s.ratioY <= 0) {
    throw new Error("Invalid screenshot scale ratio.");
  }

  s.widthPx = Math.max(1, Math.floor(s.prep.targetWidth * s.ratioX));
  s.heightPx = Math.max(1, Math.floor(s.prep.targetHeight * s.ratioY));

  // OffscreenCanvas width limits vary by GPU/browser. Very wide pages are rare;
  // fail clearly rather than silently corrupting the image.
  if (s.widthPx > 32767) {
    throw new Error(`Page is too wide to encode (${s.widthPx}px).`);
  }
}

function drawAcrossTiles(s, bitmap, sx, sy, sw, sh, dx, dy) {
  const yEnd = dy + sh;
  let y = dy;

  while (y < yEnd) {
    const tileIndex = Math.floor(y / TILE_HEIGHT);
    const tile = getTile(s, tileIndex);
    const globalTileTop = tileIndex * TILE_HEIGHT;
    const localY = y - globalTileTop;
    const amount = Math.min(yEnd - y, tile.height - localY);
    const sourceY = sy + (y - dy);

    tile.ctx.drawImage(
      bitmap,
      sx, sourceY, sw, amount,
      dx, localY, sw, amount
    );

    y += amount;
  }
}

function getTile(s, index) {
  let tile = s.activeTiles.get(index);
  if (tile) return tile;

  const startY = index * TILE_HEIGHT;
  const height = Math.min(TILE_HEIGHT, s.heightPx - startY);
  if (height <= 0) throw new Error("Capture tile is outside the output image.");

  const canvas = new OffscreenCanvas(s.widthPx, height);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
  if (!ctx) throw new Error("Could not create capture canvas.");

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  tile = { index, height, canvas, ctx };
  s.activeTiles.set(index, tile);
  return tile;
}

async function finalizeTilesBefore(s, globalY) {
  const safeBeforeIndex = Math.floor(globalY / TILE_HEIGHT);
  const indexes = [...s.activeTiles.keys()]
    .filter(index => index < safeBeforeIndex)
    .sort((a, b) => a - b);

  for (const index of indexes) {
    await finalizeTile(s, index);
  }
}

async function finalizeTile(s, index) {
  const tile = s.activeTiles.get(index);
  if (!tile) return;

  const blob = await tile.canvas.convertToBlob({ type: "image/png" });
  s.savedTiles.set(index, { blob, height: tile.height });
  tile.canvas.width = 1;
  tile.canvas.height = 1;
  s.activeTiles.delete(index);
}

async function finish(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("Unknown capture session.");
  if (!s.frames || s.ratioX == null) throw new Error("No screenshot frames were captured.");

  const activeIndexes = [...s.activeTiles.keys()].sort((a, b) => a - b);
  for (const index of activeIndexes) await finalizeTile(s, index);

  const expectedTiles = Math.ceil(s.heightPx / TILE_HEIGHT);
  for (let i = 0; i < expectedTiles; i += 1) {
    if (!s.savedTiles.has(i)) {
      // A white tile is preferable to malformed PNG data if the browser failed
      // to scroll to a region that existed when capture began.
      const tile = getTile(s, i);
      await finalizeTile(s, i);
    }
  }

  const pngBlob = await encodePngFromTiles(s);
  const url = URL.createObjectURL(pngBlob);
  blobUrls.add(url);
  sessions.delete(sessionId);

  setTimeout(() => revoke(url), 10 * 60 * 1000);
  return { url, width: s.widthPx, height: s.heightPx };
}

async function encodePngFromTiles(s) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser does not support streaming PNG compression.");
  }

  const tileEntries = [...s.savedTiles.entries()].sort((a, b) => a[0] - b[0]);
  const scanlines = makeScanlineStream(s.widthPx, tileEntries);
  const compressed = await new Response(
    scanlines.pipeThrough(new CompressionStream("deflate"))
  ).arrayBuffer();

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, s.widthPx, false);
  view.setUint32(4, s.heightPx, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return new Blob([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(compressed)),
    pngChunk("IEND", new Uint8Array(0))
  ], { type: "image/png" });
}

function makeScanlineStream(width, tileEntries) {
  let tileCursor = 0;
  let bitmap = null;
  let canvas = null;
  let ctx = null;
  let row = 0;
  let tileHeight = 0;

  return new ReadableStream({
    async pull(controller) {
      if (!bitmap) {
        if (tileCursor >= tileEntries.length) {
          controller.close();
          return;
        }

        const [, tile] = tileEntries[tileCursor];
        bitmap = await createImageBitmap(tile.blob);
        tileHeight = tile.height;
        canvas = new OffscreenCanvas(width, tileHeight);
        ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        if (!ctx) throw new Error("Could not decode capture tile.");
        ctx.drawImage(bitmap, 0, 0);
        row = 0;
      }

      const rowsThisChunk = Math.min(16, tileHeight - row);
      const image = ctx.getImageData(0, row, width, rowsThisChunk).data;
      const stride = width * 4;
      const out = new Uint8Array(rowsThisChunk * (stride + 1));

      for (let r = 0; r < rowsThisChunk; r += 1) {
        const dst = r * (stride + 1);
        out[dst] = 0; // PNG filter: None
        out.set(image.subarray(r * stride, (r + 1) * stride), dst + 1);
      }

      controller.enqueue(out);
      row += rowsThisChunk;

      if (row >= tileHeight) {
        bitmap.close();
        bitmap = null;
        canvas.width = 1;
        canvas.height = 1;
        canvas = null;
        ctx = null;
        tileCursor += 1;
      }
    },
    cancel() {
      bitmap?.close();
    }
  });
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);

  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function revoke(url) {
  if (!url || !blobUrls.has(url)) return;
  URL.revokeObjectURL(url);
  blobUrls.delete(url);
}
