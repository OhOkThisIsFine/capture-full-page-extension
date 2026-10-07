const MAX_TILE_HEIGHT = 8192;
const MAX_TILE_PIXELS = 8 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 200 * 1024 * 1024;

const sessions = new Map();
const blobUrls = new Set();
const sessionUrls = new Map();

const P = globalThis.__cfpProtocol;
if (!P || P.protocolVersion!==1) throw new Error("Capture protocol unavailable.");
const contextId=crypto.randomUUID(),lifecycleGeneration=1;
let requesterOwner=null;
const outputRecords=new Map();
const operationTypes=new Set(["start","frame","finish","abort","revoke"]);
function envelope(message) {
  const valid=message?.target==="cfp-offscreen" && message.protocolVersion===1 && P.uuid(message.requestId);
  const context=message?.type==="status";
  if(!valid || (context ? !P.uuid(message.requesterOwner) : !operationTypes.has(message.type) || ["operationId","sessionId","owner"].some(k=>!P.uuid(message[k]))) || (message.type==="finish" && !P.uuid(message.intentId)))throw P.fault("INVALID_ENVELOPE","Invalid compositor envelope.");
  const keys=context ? ["target","type","protocolVersion","requestId","requesterOwner"] : ["target","type","protocolVersion","requestId","operationId","sessionId","owner"];
  if(message.intentId!==undefined){if(!P.uuid(message.intentId))throw P.fault("INVALID_ENVELOPE","Invalid intent identity.");keys.push("intentId");}
  return Object.fromEntries(keys.map(k=>[k,message[k]]));
}
function authenticatedWorker(sender) {
  return sender?.id===chrome.runtime.id && !sender.tab && (!sender.url || sender.url===chrome.runtime.getURL("service-worker.js"));
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.target!=="cfp-offscreen")return;
  if(!authenticatedWorker(sender)){sendResponse(P.errorResult("INVALID_SENDER","Untrusted compositor sender."));return;}
  trustedBackgroundEntry(message).then(sendResponse);return true;
});
async function trustedBackgroundEntry(message) {
  let echo;
  try {echo=envelope(message);} catch {return {target:"cfp-offscreen",type:"protocol-error",protocolVersion:1,requestId:P.uuid(message?.requestId)?message.requestId:null,...P.errorResult("INVALID_ENVELOPE","Invalid compositor envelope.")};}
  try {return {...echo,...await handle(message)};} catch(error){return {...echo,...P.errorResult(error.code || "CAPTURE_FAILED",String(error?.message || error))};}
}
function assertSessionIdentity(s,message) {
  if(!s || ["operationId","sessionId","owner"].some(k=>s[k]!==message[k]))throw P.fault("INVALID_IDENTITY","Capture session identity mismatch.");
}
async function handle(message) {
  if(message.type==="status") {requesterOwner=message.requesterOwner;return {ok:true,idle:isIdle(),contextId,lifecycleGeneration,retainedUrlCount:blobUrls.size};}
  if(message.type==="start") {
    if(sessions.has(message.sessionId))throw P.fault("SESSION_EXISTS","Capture session already exists.");
    if(["owner","operationId","sessionId"].some(k=>message.prep?.[k]!==message[k]))throw P.fault("INVALID_IDENTITY","Preparation identity mismatch.");
    const session=createSession(message.prep,message.owner);Object.assign(session,{operationId:message.operationId,sessionId:message.sessionId});
    // Fully validate a new preparation before replacing abandoned active work.
    for(const [id,old] of sessions)if(old.owner!==message.owner)cleanupSession(id);
    sessions.set(message.sessionId,session);requesterOwner=message.owner;renewSession(message.sessionId);return {ok:true};
  }
  if(message.type==="revoke") {
    const output=outputRecords.get(message.url);
    if(!output || ["operationId","sessionId","owner","intentId"].some(k=>output[k]!==message[k]))throw P.fault("INVALID_IDENTITY","Output identity mismatch.");
    revoke(message.url);return {ok:true,idle:isIdle()};
  }
  const s=sessions.get(message.sessionId);
  assertSessionIdentity(s,message);
  if(message.type==="abort") {cleanupSession(message.sessionId);return {ok:true,idle:isIdle()};}
  if(s.busy)throw P.fault("SESSION_BUSY","Capture session is busy.");
  const token={};s.busy=token;
  try {return message.type==="frame" ? await addFrame(message) : await finish(message.sessionId,message.intentId);}
  catch(error){if(error.code!=="FRAME_ORDER" && error.code!=="SCROLL_CHANGED" && error.code!=="STALE_DOCUMENT" && error.code!=="GEOMETRY_CHANGED")cleanupSession(message.sessionId);throw error;}
  finally {if(s.busy===token)s.busy=null;}
}

function createSession(prep, owner) {
  return {
    prep,
    plan:P.makeTraversal(prep),
    owner,
    lastAcceptedSpec:null,
    finalizedThroughIndex:-1,
    firstBitmapWidth:null,
    firstBitmapHeight:null,
    cancelled: false,
    controller: new AbortController(),
    ratioX: null,
    ratioY: null,
    widthPx: null,
    heightPx: null,
    tileHeight: null,
    activeTiles: new Map(),
    savedTiles: new Map(),
    lastDestY: 0,
    frames: 0
  };
}

function renewSession(id, encoding = false) {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.deadline);
  s.deadline = setTimeout(() => {
    if (sessions.get(id) !== s) return;
    cleanupSession(id);
    if(isIdle())notifyIdle();
  }, encoding ? 10 * 60 * 1000 : 5 * 60 * 1000);
}

function checkSession(s) {
  if (s.cancelled || ![...sessions.values()].includes(s)) throw new Error("Capture session was cancelled.");
}

async function addFrame(message) {
  const s = sessions.get(message.sessionId);
  if (!s) throw new Error("Unknown capture session.");
  renewSession(message.sessionId);

  const expected=P.nextFrameSpec(s.plan,s.lastAcceptedSpec);
  if(!P.sameSpec(message.spec,expected))throw P.fault("FRAME_ORDER","Unexpected frame sequence or coordinates.");
  const validation=P.snapshotPair(s.plan,message.spec,message.preSnapshot,message.postSnapshot);
  if(!validation.ok)throw P.fault(validation.code,"Frame snapshot rejected.");
  if(typeof message.dataUrl!=="string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(message.dataUrl))throw P.fault("INVALID_FRAME","Expected a PNG data URL.");
  const response = await fetch(message.dataUrl, {signal:s.controller.signal});
  checkSession(s);if(!response.ok)throw new Error("Could not read captured frame.");
  const blob=await response.blob();checkSession(s);
  const bitmap=await createImageBitmap(blob);
  try {
    checkSession(s);
    if(s.ratioX==null)initializeGeometry(s,bitmap);
    else if(bitmap.width!==s.firstBitmapWidth || bitmap.height!==s.firstBitmapHeight)throw P.fault("BITMAP_SCALE_CHANGED","Screenshot dimensions changed.");
    for(const snap of [message.preSnapshot,message.postSnapshot]) {
      if(Math.round(snap.logicalX*s.ratioX)!==Math.round(message.spec.logicalX*s.ratioX) || Math.round(snap.logicalY*s.ratioY)!==Math.round(message.spec.logicalY*s.ratioY))throw P.fault("SCROLL_CHANGED","Scroll offset changes device pixel placement.");
    }
    const {sx,sy,sw,sh,dx:destX,dy:destY}=P.frameRect(s.prep,message.spec,bitmap.width,bitmap.height);
    if(s.lastAcceptedSpec && message.spec.row>s.lastAcceptedSpec.row)await finalizeTilesBefore(s,destY);
    checkSession(s);
    drawAcrossTiles(s,bitmap,sx,sy,sw,sh,destX,destY);
    checkSession(s);
    s.lastAcceptedSpec=message.spec;
    s.lastDestY = Math.max(s.lastDestY, destY);
    s.frames += 1;
    return { ok: true, acceptedSequence:message.spec.sequence, ratioX: s.ratioX, ratioY: s.ratioY };
  } finally {
    bitmap.close();
  }
}

function initializeGeometry(s, bitmap) {
  s.firstBitmapWidth=bitmap.width;s.firstBitmapHeight=bitmap.height;
  s.ratioX = bitmap.width / s.prep.windowWidth;
  s.ratioY = bitmap.height / s.prep.windowHeight;

  if (!Number.isFinite(s.ratioX) || !Number.isFinite(s.ratioY) ||
      s.ratioX <= 0 || s.ratioY <= 0) {
    throw new Error("Invalid screenshot scale ratio.");
  }

  s.widthPx = Math.max(1, Math.floor(s.prep.targetWidth * s.ratioX));
  s.heightPx = Math.max(1, Math.floor(s.prep.targetHeight * s.ratioY));

  if (s.widthPx > 32767) {
    throw new Error(`Page is too wide to encode (${s.widthPx}px).`);
  }

  const outputPixels = s.widthPx * s.heightPx;
  if (!Number.isFinite(outputPixels) || outputPixels > MAX_OUTPUT_PIXELS) {
    throw new Error(
      `Screenshot is too large to encode safely (${s.widthPx} × ${s.heightPx}px).`
    );
  }

  s.tileHeight = Math.max(
    1,
    Math.min(MAX_TILE_HEIGHT, Math.floor(MAX_TILE_PIXELS / s.widthPx))
  );
}

function drawAcrossTiles(s, bitmap, sx, sy, sw, sh, dx, dy) {
  const yEnd = dy + sh;
  let y = dy;

  while (y < yEnd) {
    const tileIndex = Math.floor(y / s.tileHeight);
    const tile = getTile(s, tileIndex);
    const globalTileTop = tileIndex * s.tileHeight;
    const localY = y - globalTileTop;
    const amount = Math.min(yEnd - y, tile.height - localY);
    const sourceY = sy + (y - dy);

    tile.ctx.drawImage(
      bitmap,
      sx, sourceY, sw, amount,
      dx, localY, sw, amount
    );

    tile.coverage.push({
      x0: dx,
      y0: localY,
      x1: dx + sw,
      y1: localY + amount
    });

    y += amount;
  }
}

function getTile(s, index) {
  if(index<=s.finalizedThroughIndex || s.savedTiles.has(index))throw P.fault("FINALIZED_REGION_REVISIT","Finalized output region cannot be revisited.");
  let tile = s.activeTiles.get(index);
  if (tile) return tile;

  const startY = index * s.tileHeight;
  const height = Math.min(s.tileHeight, s.heightPx - startY);
  if (height <= 0) throw new Error("Capture tile is outside the output image.");

  const canvas = new OffscreenCanvas(s.widthPx, height);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
  if (!ctx) throw new Error("Could not create capture canvas.");

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  tile = { index, height, canvas, ctx, coverage: [] };
  s.activeTiles.set(index, tile);
  return tile;
}

async function finalizeTilesBefore(s, globalY) {
  const safeBeforeIndex = Math.floor(globalY / s.tileHeight);
  const indexes = [...s.activeTiles.keys()]
    .filter(index => index < safeBeforeIndex)
    .sort((a, b) => a - b);

  for(let index=s.finalizedThroughIndex+1;index<safeBeforeIndex;index++){
    if(!s.activeTiles.has(index))throw P.fault("MISSING_COVERAGE","Cannot finalize a missing tile.");
    await finalizeTile(s,index);checkSession(s);s.finalizedThroughIndex=index;
  }
}

async function finalizeTile(s, index) {
  const tile = s.activeTiles.get(index);
  if (!tile) return;

  if(s.savedTiles.has(index))throw P.fault("FINALIZED_REGION_REVISIT","Tile already saved.");
  validateTileCoverage(s.widthPx,tile.height,tile.coverage,index,s.tileHeight);
  const blob = await tile.canvas.convertToBlob({ type: "image/png" });
  checkSession(s);
  s.savedTiles.set(index, {
    blob,
    height: tile.height,
    coverage: tile.coverage.slice()
  });

  tile.canvas.width = 1;
  tile.canvas.height = 1;
  tile.coverage.length = 0;
  s.activeTiles.delete(index);
}

async function finish(sessionId,intentId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("Unknown capture session.");
  renewSession(sessionId, true);
  if(P.nextFrameSpec(s.plan,s.lastAcceptedSpec)!==null)throw P.fault("MISSING_FRAMES","Not all planned frames were accepted.");
  if (!s.frames || s.ratioX == null) throw new Error("No screenshot frames were captured.");

  const activeIndexes = [...s.activeTiles.keys()].sort((a, b) => a - b);
  for (const index of activeIndexes) await finalizeTile(s, index);

  const expectedTiles = Math.ceil(s.heightPx / s.tileHeight);
  for (let i = 0; i < expectedTiles; i += 1) {
    const tile = s.savedTiles.get(i);
    if (!tile) {
      throw new Error(`Capture is incomplete: output tile ${i} was never captured.`);
    }
    validateTileCoverage(s.widthPx, tile.height, tile.coverage, i, s.tileHeight);
  }

  const pngBlob = await encodePngFromTiles(s);
  checkSession(s);
  const url = URL.createObjectURL(pngBlob);
  blobUrls.add(url);
  sessionUrls.set(sessionId, url);
  outputRecords.set(url,{operationId:s.operationId,sessionId,owner:s.owner,intentId});

  const width = s.widthPx;
  const height = s.heightPx;
  cleanupSession(sessionId);

  setTimeout(() => {
    const removed = revoke(url);
    if (!removed || !isIdle()) return;

    notifyIdle();
  }, 10 * 60 * 1000);

  return {ok:true,intentId,url,width,height,byteLength:pngBlob.size};
}

function validateTileCoverage(width, height, rects, tileIndex, tileHeight) {
  if (!rects?.length) {
    throw new Error(`Capture is incomplete: output tile ${tileIndex} has no pixels.`);
  }

  const yBoundaries = new Set([0, height]);
  for (const rect of rects) {
    const y0 = Math.max(0, Math.min(height, rect.y0));
    const y1 = Math.max(0, Math.min(height, rect.y1));
    if (y1 > y0) {
      yBoundaries.add(y0);
      yBoundaries.add(y1);
    }
  }

  const ys = [...yBoundaries].sort((a, b) => a - b);

  for (let i = 0; i < ys.length - 1; i += 1) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    if (y1 <= y0) continue;

    const intervals = [];
    for (const rect of rects) {
      if (rect.y0 > y0 || rect.y1 < y1) continue;
      const x0 = Math.max(0, Math.min(width, rect.x0));
      const x1 = Math.max(0, Math.min(width, rect.x1));
      if (x1 > x0) intervals.push([x0, x1]);
    }

    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    let coveredTo = 0;
    for (const [x0, x1] of intervals) {
      if (x0 > coveredTo) break;
      coveredTo = Math.max(coveredTo, x1);
      if (coveredTo >= width) break;
    }

    if (coveredTo < width) {
      const globalY = tileIndex * tileHeight + y0;
      throw new Error(
        `Capture is incomplete near output row ${globalY}: pixels after x=${coveredTo} are missing.`
      );
    }
  }
}

function cleanupSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;

  s.cancelled = true;
  clearTimeout(s.deadline);
  s.controller.abort();
  for (const tile of s.activeTiles.values()) {
    try {
      tile.canvas.width = 1;
      tile.canvas.height = 1;
    } catch {}
    tile.coverage.length = 0;
  }

  s.activeTiles.clear();
  s.savedTiles.clear();
  sessions.delete(sessionId);
}

function isIdle() {
  return sessions.size === 0 && blobUrls.size === 0;
}

async function encodePngFromTiles(s) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser does not support streaming PNG compression.");
  }

  const tileEntries = [...s.savedTiles.entries()].sort((a, b) => a[0] - b[0]);
  const scanlines = makeScanlineStream(s.widthPx, tileEntries, s);
  const compressed = await new Response(
    scanlines.pipeThrough(new CompressionStream("deflate"), { signal: s.controller.signal })
  ).arrayBuffer();

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, s.widthPx, false);
  view.setUint32(4, s.heightPx, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
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

function makeScanlineStream(width, tileEntries, s) {
  let tileCursor = 0;
  let bitmap = null;
  let canvas = null;
  let ctx = null;
  let row = 0;
  let tileHeight = 0;
  let disposed=false;

  return new ReadableStream({
    async pull(controller) {
      if(disposed)throw P.fault("CANCELLED","Scanline source disposed.");
      checkSession(s);
      if (!bitmap) {
        if (tileCursor >= tileEntries.length) {
          controller.close();
          return;
        }

        const [, tile] = tileEntries[tileCursor];
        const decoded = await createImageBitmap(tile.blob);
        if(s.cancelled || disposed){decoded.close();throw P.fault("CANCELLED","Scanline source disposed.");}
        checkSession(s);
        bitmap = decoded;
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
        out[dst] = 0;
        out.set(image.subarray(r * stride, (r + 1) * stride), dst + 1);
      }

      checkSession(s);if(disposed)throw P.fault("CANCELLED","Scanline source disposed.");
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
      disposed=true;
      bitmap?.close();
      bitmap = null;
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      tileEntries.length = 0;
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

  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
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

function revokeSessionUrl(sessionId) {
  const url = sessionUrls.get(sessionId);
  if (!url) return false;
  sessionUrls.delete(sessionId);
  return revoke(url);
}

function revoke(url) {
  if (!url || !blobUrls.has(url)) return false;
  URL.revokeObjectURL(url);
  blobUrls.delete(url);
  outputRecords.delete(url);

  for (const [sessionId, sessionUrl] of sessionUrls) {
    if (sessionUrl === url) sessionUrls.delete(sessionId);
  }

  return true;
}


/*
 * Firefox MV3 currently uses a background document rather than an extension
 * service worker. When this file is loaded there as a background script, expose
 * the compositor directly so service-worker.js can call it without creating a
 * Chrome offscreen document. In Chrome this global exists only inside the
 * offscreen document, so the service worker still communicates by message.
 */
function notifyIdle() {
  if(!requesterOwner)return;
  chrome.runtime.sendMessage({target:"cfp-worker",type:"offscreen-idle",protocolVersion:1,requestId:crypto.randomUUID(),requesterOwner,contextId,lifecycleGeneration,idle:true}).catch(()=>{});
}
// Background-document-only trusted entry; popup documents have no reference to it.
globalThis.__cfpCompositorHandle = trustedBackgroundEntry;
