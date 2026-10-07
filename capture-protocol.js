(() => {
  "use strict";
  if (globalThis.__cfpProtocol?.protocolVersion === 1) return;
  const protocolVersion = 1;
  const limits = Object.freeze({
    MAX_CAPTURE_FRAMES: 20000,
    CAPTURE_INTERVAL_MS: 560,
    MAX_PREPARE_MS: 15000,
    MAX_CAPTURE_MS: 600000,
    MAX_ENCODE_MS: 300000,
    MAX_OPERATION_MS: 900000,
    MAX_DISCOVERED_ELEMENTS: 50000,
    MAX_CAPTURE_ROOTS: 128,
    MAX_MAPPING_NODES: 512,
    MAX_DISCOVERED_EFFECTS: 2000,
    DOM_BATCH_SIZE: 256,
    IDAT_PAYLOAD_BYTES: 1048576,
    MAX_IDAT_CHUNKS: 128,
    MAX_ENCODED_BYTES: 128 * 1024 * 1024,
    MAX_FRAME_DATA_URL_CHARS: 48 * 1024 * 1024,
    MAX_FRAME_BITMAP_BYTES: 64 * 1024 * 1024,
    MAX_ACTIVE_CANVAS_BYTES: 96 * 1024 * 1024,
    MAX_SAVED_TILE_BYTES: 128 * 1024 * 1024,
    MAX_RETAINED_URLS: 4,
    MAX_RETAINED_URL_BYTES: 256 * 1024 * 1024,
    MAX_ACCOUNTED_BYTES: 512 * 1024 * 1024,
    MAX_TILE_HEIGHT: 8192,
    MAX_TILE_PIXELS: 8 * 1024 * 1024,
    MAX_OUTPUT_PIXELS: 200 * 1024 * 1024,
    MAX_CONTROL_BYTES: 65536,
    MAX_CSS: 16777216,
  });
  const messages = Object.freeze({
    INVALID_ENVELOPE: "Invalid capture protocol envelope.",
    INVALID_GEOMETRY: "Invalid capture geometry.",
    INVALID_IDENTITY: "Capture identity does not match.",
    INVALID_METHOD: "Invalid capture method.",
    ALREADY_PREPARED: "This capture connection is already prepared.",
    PROTOCOL_MISMATCH: "Reload the page before capturing.",
    RESOURCE_LIMIT: "Capture exceeds a resource policy limit.",
    DOCUMENT_REPLACED: "The captured document was replaced.",
    GEOMETRY_CHANGED: "Page geometry changed during capture.",
    SCROLL_CHANGED: "Capture scroll position changed.",
    STALE_DOCUMENT: "The captured document changed.",
    UNSUPPORTED_TARGET_MAPPING: "The capture target mapping is unsupported.",
    FRAME_SEQUENCE_MISMATCH: "Capture frame sequence does not match.",
    FRAME_NOT_ACCEPTED: "The preceding frame has not been acknowledged.",
    INCOMPLETE_COVERAGE: "Capture pixel coverage is incomplete.",
    TRANSPORT_FAILED: "Capture transport failed.",
    SESSION_BUSY: "Capture session is busy.",
    BITMAP_SCALE_CHANGED: "Screenshot dimensions changed.",
    FINALIZED_REGION_REVISIT: "Finalized pixels cannot be revisited.",
    INVALID_SENDER: "Untrusted capture sender.",
    CAPTURE_FAILED: "Capture failed.",
    CANCELLED: "Capture was cancelled.",
    UNSUPPORTED_OCCLUSION: "Repeated occlusion blocks required pixels.",
    RECOVERY_UNVERIFIED: "Capture recovery is unverified.",
    REVISION_CHANGED: "Output revision changed.",
    STALE_RECOVERY: "Recovery observation is stale.",
    ALREADY_STARTED: "Capture session has already started.",
    DOWNLOAD_START_FAILED: "Download initiation failed.",
    DOWNLOAD_START_INVALID: "Download initiation returned an invalid result.",
    DOWNLOAD_START_UNCERTAIN: "Download initiation is uncertain.",
    SOURCE_EXPIRED: "Output source expired.",
    CAPTURE_CONTEXT_UNVERIFIED: "Capture context is unverified.",
    PRIVATE_CAPTURE_UNVERIFIED: "Private capture is not qualified.",
    PRIVATE_ACCESS_DENIED: "Private capture access is denied.",
    PRIVATE_ACCESS_UNVERIFIED: "Private capture access is unverified.",
    UNSUPPORTED_BROWSER: "This browser target is unsupported.",
    USER_CANCELLED: "Capture was cancelled.",
    TAB_CHANGED: "The active capture tab changed.",
    NAVIGATED: "The source document changed.",
    PREPARE_TIMEOUT: "Capture preparation timed out.",
    CAPTURE_TIMEOUT: "Capture acquisition timed out.",
    ENCODE_TIMEOUT: "Capture encoding timed out.",
    OPERATION_TIMEOUT: "Capture operation timed out.",
  });
  const warningCodes = Object.freeze([
    "IFRAME_VIEWPORT_ONLY",
    "LIVE_MOTION",
    "TARGET_ONLY_SCOPE",
  ]);
  const capabilities = Object.freeze({
    chrome: Object.freeze({
      privateCapture: false,
      preserveVirtualizer: false,
    }),
    firefox: Object.freeze({
      privateCapture: false,
      preserveVirtualizer: false,
    }),
  });
  const uuid = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    );
  function fault(code) {
    return Object.assign(new Error(messages[code] || messages.CAPTURE_FAILED), {
      code: messages[code] ? code : "CAPTURE_FAILED",
    });
  }
  function errorResult(code) {
    const error = fault(code);
    return { ok: false, code: error.code, error: error.message };
  }
  function ownRecord(value, fields) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw fault("INVALID_ENVELOPE");
    const proto = Object.getPrototypeOf(value);
    // Cross-context native JSON records have another realm's Object.prototype.
    // Permit that shape only; never read a field before inspecting its descriptor.
    if (proto !== null) {
      const constructor = Object.getOwnPropertyDescriptor(proto, "constructor");
      if (
        Object.getPrototypeOf(proto) !== null ||
        !constructor ||
        !Object.hasOwn(constructor, "value") ||
        typeof constructor.value !== "function" ||
        Function.prototype.toString.call(constructor.value) !==
          "function Object() { [native code] }"
      )
        throw fault("INVALID_ENVELOPE");
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      fields.some((key) => !keys.includes(key))
    )
      throw fault("INVALID_ENVELOPE");
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !Object.hasOwn(d, "value"))
        throw fault("INVALID_ENVELOPE");
    }
    return value;
  }
  function uint(value, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
      throw fault("INVALID_GEOMETRY");
    return value;
  }
  function cssInt(value) {
    uint(value, limits.MAX_CSS);
    if (value === 0) throw fault("INVALID_GEOMETRY");
    return value;
  }
  function assertFiniteGeometry(
    value,
    fieldName,
    { positive = false, maximum = limits.MAX_CSS } = {},
  ) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (positive && value <= 0) ||
      value > maximum
    )
      throw fault("INVALID_GEOMETRY");
    return value;
  }
  function signedOffset(value) {
    if (!Number.isFinite(value) || Math.abs(value) > limits.MAX_CSS)
      throw fault("INVALID_GEOMETRY");
    return value;
  }
  function warnings(value) {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(
        Object.getPrototypeOf(Object.getPrototypeOf(value)),
      ) !== null ||
      value.length > 8
    )
      throw fault("INVALID_ENVELOPE");
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some(
        (key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(String(key)),
      )
    )
      throw fault("INVALID_ENVELOPE");
    const result = [];
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (
        !d ||
        !Object.hasOwn(d, "value") ||
        !warningCodes.includes(d.value) ||
        (i > 0 && result[i - 1] >= d.value)
      )
        throw fault("INVALID_ENVELOPE");
      result.push(d.value);
    }
    return Object.freeze(result);
  }
  function visual(value) {
    if (value === null) return null;
    ownRecord(value, ["scale", "offsetLeft", "offsetTop", "width", "height"]);
    if (
      value.scale !== 1 ||
      Math.abs(value.offsetLeft) > 0.5 ||
      Math.abs(value.offsetTop) > 0.5
    )
      throw fault("UNSUPPORTED_TARGET_MAPPING");
    for (const key of ["offsetLeft", "offsetTop"]) signedOffset(value[key]);
    for (const key of ["width", "height"])
      assertFiniteGeometry(value[key], key, { positive: true });
    return Object.freeze({ ...value });
  }
  function identity(value) {
    if (value.protocolVersion !== 1) throw fault("PROTOCOL_MISMATCH");
    const tokens = [
      value.operationId,
      value.sessionId,
      value.owner,
      value.planId,
      value.documentNonce,
    ];
    if (
      tokens.some((token) => !uuid(token)) ||
      new Set(tokens).size !== tokens.length
    )
      throw fault("INVALID_IDENTITY");
  }
  /** @typedef {{protocolVersion:1,operationId:string,sessionId:string,owner:string,planId:string,documentNonce:string,strategy:string,captureScope:string,windowWidth:number,windowHeight:number,layoutWidth:number,layoutHeight:number,targetWidth:number,targetHeight:number,sourceLeft:number,sourceTop:number,clientWidth:number,clientHeight:number,direction:string,writingMode:string,physicalScrollWidth:number,physicalScrollHeight:number,devicePixelRatio:number,visualViewport:Object|null,geometryGeneration:number,warnings:string[]}} Prep */
  const prepFields = Object.freeze([
    "protocolVersion",
    "operationId",
    "sessionId",
    "owner",
    "planId",
    "documentNonce",
    "strategy",
    "captureScope",
    "windowWidth",
    "windowHeight",
    "layoutWidth",
    "layoutHeight",
    "targetWidth",
    "targetHeight",
    "sourceLeft",
    "sourceTop",
    "clientWidth",
    "clientHeight",
    "direction",
    "writingMode",
    "physicalScrollWidth",
    "physicalScrollHeight",
    "devicePixelRatio",
    "visualViewport",
    "geometryGeneration",
    "warnings",
  ]);
  const snapshotFields = Object.freeze([
    "protocolVersion",
    "operationId",
    "sessionId",
    "owner",
    "planId",
    "documentNonce",
    "sequence",
    "geometryGeneration",
    "nativeScrollLeft",
    "nativeScrollTop",
    "logicalX",
    "logicalY",
    "windowWidth",
    "windowHeight",
    "layoutWidth",
    "layoutHeight",
    "physicalScrollWidth",
    "physicalScrollHeight",
    "sourceLeft",
    "sourceTop",
    "clientWidth",
    "clientHeight",
    "devicePixelRatio",
    "visualViewport",
    "scrollEpoch",
    "geometryEpoch",
    "warnings",
  ]);
  function validatePrep(value) {
    ownRecord(value, prepFields);
    identity(value);
    for (const key of [
      "windowWidth",
      "windowHeight",
      "layoutWidth",
      "layoutHeight",
      "targetWidth",
      "targetHeight",
      "clientWidth",
      "clientHeight",
      "physicalScrollWidth",
      "physicalScrollHeight",
    ])
      cssInt(value[key]);
    for (const key of ["sourceLeft", "sourceTop"])
      assertFiniteGeometry(value[key], key);
    uint(value.geometryGeneration);
    if (value.direction !== "ltr" && value.direction !== "rtl")
      throw fault("INVALID_GEOMETRY");
    if (value.writingMode !== "horizontal-tb")
      throw fault("UNSUPPORTED_TARGET_MAPPING");
    if (
      !["document", "expanded-nested", "preserve"].includes(value.strategy) ||
      value.captureScope !==
        (value.strategy === "preserve" ? "target-only" : "full-page")
    )
      throw fault("INVALID_ENVELOPE");
    if (
      value.targetWidth < value.clientWidth ||
      value.targetHeight < value.clientHeight ||
      !Number.isFinite(value.devicePixelRatio) ||
      value.devicePixelRatio <= 0 ||
      value.devicePixelRatio > 16
    )
      throw fault("INVALID_GEOMETRY");
    return Object.freeze({
      ...value,
      visualViewport: visual(value.visualViewport),
      warnings: warnings(value.warnings),
    });
  }
  /** @typedef {{prep:Prep,planId:string,width:number,height:number,viewportWidth:number,viewportHeight:number,maxX:number,maxY:number,columns:number,rows:number,estimatedFrames:number}} TraversalPlan */
  /** @typedef {{planId:string,sequence:number,row:number,column:number,logicalX:number,logicalY:number,sourceLeft:number,sourceTop:number,clientWidth:number,clientHeight:number,stickyCrop:0}} FrameSpec */
  /** @typedef {{protocolVersion:1,operationId:string,sessionId:string,owner:string,planId:string,documentNonce:string,sequence:number,geometryGeneration:number,nativeScrollLeft:number,nativeScrollTop:number,logicalX:number,logicalY:number,windowWidth:number,windowHeight:number,layoutWidth:number,layoutHeight:number,physicalScrollWidth:number,physicalScrollHeight:number,sourceLeft:number,sourceTop:number,clientWidth:number,clientHeight:number,devicePixelRatio:number,visualViewport:Object|null,scrollEpoch:number,geometryEpoch:number,warnings:string[]}} Snapshot */
  /** @typedef {{status:string,restoredCount:number,preservedPageChanges:number,failedCount:number,codes:string[]}} RestoreSummary */
  const specFields = Object.freeze([
    "planId",
    "sequence",
    "row",
    "column",
    "logicalX",
    "logicalY",
    "sourceLeft",
    "sourceTop",
    "clientWidth",
    "clientHeight",
    "stickyCrop",
  ]);
  function makeTraversal(value) {
    const prep = validatePrep(value),
      width = prep.targetWidth,
      height = prep.targetHeight,
      viewportWidth = prep.clientWidth,
      viewportHeight = prep.clientHeight,
      maxX = Math.max(0, width - viewportWidth),
      maxY = Math.max(0, height - viewportHeight),
      columns = 1 + Math.ceil(maxX / Math.max(1, viewportWidth - 30));
    if (columns > limits.MAX_CAPTURE_FRAMES) throw fault("RESOURCE_LIMIT");
    const base = {
      prep,
      planId: prep.planId,
      width,
      height,
      viewportWidth,
      viewportHeight,
      maxX,
      maxY,
      columns,
    };
    let rows = 1,
      y = 0;
    while (y < maxY) {
      y = Math.min(maxY, y + rowStep(viewportHeight, rows - 1));
      rows++;
      if (rows * columns > limits.MAX_CAPTURE_FRAMES)
        throw fault("RESOURCE_LIMIT");
    }
    return Object.freeze({ ...base, rows, estimatedFrames: rows * columns });
  }
  function rowStep(height, row) {
    return Math.max(
      1,
      height - Math.min(row === 0 ? 300 : 190, Math.floor(height / 2) + 1),
    );
  }
  function rowY(plan, row) {
    if (row === 0) return 0;
    const first = rowStep(plan.viewportHeight, 0),
      later = rowStep(plan.viewportHeight, 1);
    return Math.min(plan.maxY, first + (row - 1) * later);
  }
  function specAt(plan, row, column) {
    return Object.freeze({
      planId: plan.planId,
      sequence: row * plan.columns + column,
      row,
      column,
      logicalX: Math.min(
        plan.maxX,
        column * Math.max(1, plan.viewportWidth - 30),
      ),
      logicalY: rowY(plan, row),
      sourceLeft: plan.prep.sourceLeft,
      sourceTop: plan.prep.sourceTop,
      clientWidth: plan.viewportWidth,
      clientHeight: plan.viewportHeight,
      stickyCrop: 0,
    });
  }
  function sameSpec(a, b) {
    if (!a || !b) return false;
    ownRecord(a, specFields);
    ownRecord(b, specFields);
    return specFields.every((key) => a[key] === b[key]);
  }
  function validateSpec(plan, spec) {
    ownRecord(spec, specFields);
    for (const key of ["sequence", "row", "column"]) uint(spec[key]);
    if (
      spec.row >= plan.rows ||
      spec.column >= plan.columns ||
      !sameSpec(spec, specAt(plan, spec.row, spec.column))
    )
      throw fault("FRAME_SEQUENCE_MISMATCH");
    return spec;
  }
  function nextFrameSpec(plan, previous) {
    if (previous === null) return specAt(plan, 0, 0);
    validateSpec(plan, previous);
    if (previous.sequence + 1 === plan.estimatedFrames) return null;
    const column = (previous.column + 1) % plan.columns,
      row = previous.row + (column === 0 ? 1 : 0);
    return specAt(plan, row, column);
  }
  function sameVisual(a, b) {
    return a === null || b === null
      ? a === b
      : ["scale", "offsetLeft", "offsetTop", "width", "height"].every(
          (key) => a[key] === b[key],
        );
  }
  function validateSnapshot(plan, spec, snapshot) {
    try {
      validateSpec(plan, spec);
      ownRecord(snapshot, snapshotFields);
      identity(snapshot);
      for (const key of [
        "sequence",
        "geometryGeneration",
        "scrollEpoch",
        "geometryEpoch",
      ])
        uint(snapshot[key]);
      for (const key of [
        "windowWidth",
        "windowHeight",
        "layoutWidth",
        "layoutHeight",
        "physicalScrollWidth",
        "physicalScrollHeight",
        "clientWidth",
        "clientHeight",
      ])
        cssInt(snapshot[key]);
      for (const key of ["nativeScrollLeft", "nativeScrollTop"])
        signedOffset(snapshot[key]);
      for (const key of ["logicalX", "logicalY", "sourceLeft", "sourceTop"])
        assertFiniteGeometry(snapshot[key], key);
      warnings(snapshot.warnings);
      visual(snapshot.visualViewport);
      if (
        !Number.isFinite(snapshot.devicePixelRatio) ||
        snapshot.devicePixelRatio <= 0 ||
        snapshot.devicePixelRatio > 16
      )
        throw fault("INVALID_GEOMETRY");
      const prep = plan.prep;
      if (snapshot.documentNonce !== prep.documentNonce)
        throw fault("STALE_DOCUMENT");
      for (const key of ["operationId", "sessionId", "owner", "planId"])
        if (snapshot[key] !== prep[key]) throw fault("INVALID_IDENTITY");
      if (snapshot.sequence !== spec.sequence)
        throw fault("FRAME_SEQUENCE_MISMATCH");
      for (const key of [
        "windowWidth",
        "windowHeight",
        "layoutWidth",
        "layoutHeight",
        "physicalScrollWidth",
        "physicalScrollHeight",
        "sourceLeft",
        "sourceTop",
        "clientWidth",
        "clientHeight",
        "devicePixelRatio",
        "geometryGeneration",
      ])
        if (snapshot[key] !== prep[key]) throw fault("GEOMETRY_CHANGED");
      if (!sameVisual(snapshot.visualViewport, prep.visualViewport))
        throw fault("GEOMETRY_CHANGED");
      if (
        Math.abs(snapshot.logicalX - spec.logicalX) > 0.5 ||
        Math.abs(snapshot.logicalY - spec.logicalY) > 0.5
      )
        throw fault("SCROLL_CHANGED");
      return { ok: true, code: null, retryable: false };
    } catch (error) {
      return {
        ok: false,
        code: error.code || "INVALID_ENVELOPE",
        retryable: error.code === "SCROLL_CHANGED",
      };
    }
  }
  function snapshotPair(plan, spec, pre, post) {
    for (const snapshot of [pre, post]) {
      const result = validateSnapshot(plan, spec, snapshot);
      if (!result.ok) return result;
    }
    if (pre.geometryEpoch !== post.geometryEpoch)
      return { ok: false, code: "GEOMETRY_CHANGED", retryable: false };
    if (
      pre.scrollEpoch !== post.scrollEpoch ||
      pre.logicalX !== post.logicalX ||
      pre.logicalY !== post.logicalY
    )
      return { ok: false, code: "SCROLL_CHANGED", retryable: true };
    return { ok: true, code: null, retryable: false };
  }
  /** @typedef {{sx:number,sy:number,sw:number,sh:number,dx:number,dy:number}} PixelRect */
  function frameRect(value, spec, bitmapWidth, bitmapHeight) {
    const prep = validatePrep(value),
      plan = makeTraversal(prep);
    validateSpec(plan, spec);
    cssBitmap(bitmapWidth, bitmapHeight);
    const rx = bitmapWidth / prep.windowWidth,
      ry = bitmapHeight / prep.windowHeight,
      outputWidth = Math.floor(prep.targetWidth * rx),
      outputHeight = Math.floor(prep.targetHeight * ry);
    if (
      outputWidth <= 0 ||
      outputHeight <= 0 ||
      outputWidth > 32767 ||
      !Number.isSafeInteger(outputWidth * outputHeight) ||
      outputWidth * outputHeight > limits.MAX_OUTPUT_PIXELS
    )
      throw fault("RESOURCE_LIMIT");
    const sx = Math.round(spec.sourceLeft * rx),
      sy = Math.round(spec.sourceTop * ry),
      rawW = Math.round(spec.clientWidth * rx),
      rawH = Math.round(spec.clientHeight * ry),
      dx = Math.round(spec.logicalX * rx),
      dy = Math.round(spec.logicalY * ry);
    if (
      rawW <= 0 ||
      rawH <= 0 ||
      sx + rawW > bitmapWidth ||
      sy + rawH > bitmapHeight
    )
      throw fault("UNSUPPORTED_TARGET_MAPPING");
    const sw = Math.min(rawW, outputWidth - dx),
      sh = Math.min(rawH, outputHeight - dy);
    if (sw <= 0 || sh <= 0) throw fault("UNSUPPORTED_TARGET_MAPPING");
    return Object.freeze({ sx, sy, sw, sh, dx, dy });
  }
  function cssBitmap(width, height) {
    uint(width);
    uint(height);
    const bytes = 4 * width * height;
    if (
      width === 0 ||
      height === 0 ||
      !Number.isSafeInteger(bytes) ||
      bytes > limits.MAX_FRAME_BITMAP_BYTES
    )
      throw fault("RESOURCE_LIMIT");
    return bytes;
  }
  function sameRect(a, b) {
    return a === null || b === null
      ? a === b
      : !!a &&
          !!b &&
          ["sx", "sy", "sw", "sh", "dx", "dy"].every(
            (key) => a[key] === b[key],
          );
  }
  function novelFrameRect(plan, spec, width, height) {
    const rect = frameRect(plan.prep, spec, width, height);
    const priorColumn =
      spec.column > 0
        ? frameRect(
            plan.prep,
            specAt(plan, spec.row, spec.column - 1),
            width,
            height,
          )
        : null;
    const priorRow =
      spec.row > 0
        ? frameRect(plan.prep, specAt(plan, spec.row - 1, 0), width, height)
        : null;
    const right = priorColumn ? priorColumn.dx + priorColumn.sw : 0,
      bottom = priorRow ? priorRow.dy + priorRow.sh : 0;
    if (rect.dx > right || rect.dy > bottom) throw fault("INCOMPLETE_COVERAGE");
    const dx = Math.max(rect.dx, right),
      dy = Math.max(rect.dy, bottom),
      sw = rect.dx + rect.sw - dx,
      sh = rect.dy + rect.sh - dy;
    if (sw <= 0 || sh <= 0) return null;
    return Object.freeze({
      sx: rect.sx + dx - rect.dx,
      sy: rect.sy + dy - rect.dy,
      sw,
      sh,
      dx,
      dy,
    });
  }
  function validateFrameDataUrl(value) {
    if (
      typeof value !== "string" ||
      value.length > limits.MAX_FRAME_DATA_URL_CHARS
    )
      throw fault("RESOURCE_LIMIT");
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
      throw fault("INVALID_ENVELOPE");
    return value;
  }
  function getQualifiedCapabilities(target) {
    if (!Object.hasOwn(capabilities, target)) throw fault("INVALID_ENVELOPE");
    return capabilities[target];
  }
  const cancelReasons = Object.freeze([
    "USER_CANCELLED",
    "TAB_CHANGED",
    "NAVIGATED",
    "PREPARE_TIMEOUT",
    "CAPTURE_TIMEOUT",
    "ENCODE_TIMEOUT",
    "OPERATION_TIMEOUT",
    "RESOURCE_LIMIT",
    "TRANSPORT_FAILED",
  ]);
  const sourceStates = ["encoded", "armed", "released", "expired"],
    initiationStates = [
      "not-armed",
      "armed-unknown",
      "id-known",
      "uncertain",
      "api-failed",
    ],
    downloadStates = [
      "unknown",
      "in_progress",
      "paused",
      "interrupted-resumable",
      "interrupted-final",
      "complete",
    ],
    apiOutcomes = ["pending", "valid-id", "failed", "invalid", "timed-out"];
  const releases = [
    "DISCARDED_UNARMED",
    "CANCELLED_BEFORE_INITIATION",
    "DOWNLOAD_COMPLETE",
    "DOWNLOAD_INTERRUPTED_FINAL",
    "SOURCE_EXPIRED",
  ];
  function enumValue(value, allowed) {
    if (!allowed.includes(value)) throw fault("INVALID_ENVELOPE");
    return value;
  }
  function shape(value, required, optional = []) {
    const keys = Reflect.ownKeys(value || {});
    if (
      required.some((key) => !keys.includes(key)) ||
      keys.some((key) => !required.includes(key) && !optional.includes(key))
    )
      throw fault("INVALID_ENVELOPE");
    return ownRecord(value, keys);
  }
  function utf8(value, maximum) {
    if (
      typeof value !== "string" ||
      new TextEncoder().encode(value).byteLength > maximum
    )
      throw fault("INVALID_ENVELOPE");
    return value;
  }
  function contextKey(value) {
    ownRecord(value, ["targetBrowser", "tabId", "windowId", "incognito"]);
    enumValue(value.targetBrowser, ["chrome", "firefox"]);
    uint(value.tabId);
    uint(value.windowId);
    if (typeof value.incognito !== "boolean")
      throw fault("CAPTURE_CONTEXT_UNVERIFIED");
    return value;
  }
  function item(value) {
    shape(
      value,
      ["id", "url", "incognito", "state", "paused"],
      ["byExtensionId", "canResume"],
    );
    uint(value.id);
    utf8(value.url, 512);
    if (
      typeof value.incognito !== "boolean" ||
      typeof value.paused !== "boolean" ||
      (Object.hasOwn(value, "canResume") &&
        typeof value.canResume !== "boolean")
    )
      throw fault("INVALID_ENVELOPE");
    enumValue(value.state, ["in_progress", "interrupted", "complete"]);
    if (Object.hasOwn(value, "byExtensionId")) utf8(value.byExtensionId, 256);
    return value;
  }
  const outputFields = [
    "kind",
    "intentId",
    "operationId",
    "sessionId",
    "owner",
    "targetBrowser",
    "tabId",
    "windowId",
    "incognito",
    "url",
    "width",
    "height",
    "byteLength",
    "createdAt",
    "expiresAt",
    "revision",
    "sourceState",
    "initiationState",
    "downloadId",
    "downloadState",
    "paused",
    "canResume",
    "apiOutcome",
    "outcomeCode",
    "terminalAt",
  ];
  const tombstoneFields = [
    "kind",
    "intentId",
    "operationId",
    "sessionId",
    "owner",
    "targetBrowser",
    "tabId",
    "windowId",
    "incognito",
    "sourceUrl",
    "downloadId",
    "sourceState",
    "downloadState",
    "apiOutcome",
    "outcomeCode",
    "revision",
    "terminalAt",
  ];
  function validateOutputRecord(value) {
    ownRecord(
      value,
      Object.getOwnPropertyDescriptor(value || {}, "kind")?.value === "output"
        ? outputFields
        : tombstoneFields,
    );
    for (const key of ["intentId", "operationId", "sessionId", "owner"])
      if (!uuid(value[key])) throw fault("INVALID_IDENTITY");
    if (
      new Set([value.intentId, value.operationId, value.sessionId, value.owner])
        .size !== 4
    )
      throw fault("INVALID_IDENTITY");
    contextKey({
      targetBrowser: value.targetBrowser,
      tabId: value.tabId,
      windowId: value.windowId,
      incognito: value.incognito,
    });
    uint(value.revision);
    if (value.downloadId !== null) uint(value.downloadId);
    enumValue(value.downloadState, downloadStates);
    enumValue(value.apiOutcome, apiOutcomes);
    if (
      value.outcomeCode !== null &&
      (!messages[value.outcomeCode] || value.outcomeCode.length > 48)
    )
      throw fault("INVALID_ENVELOPE");
    if (value.kind === "output") {
      enumValue(value.sourceState, ["encoded", "armed"]);
      enumValue(value.initiationState, initiationStates);
      utf8(value.url, 512);
      for (const key of ["width", "height", "byteLength"])
        if (uint(value[key]) === 0) throw fault("INVALID_GEOMETRY");
      if (
        value.byteLength > limits.MAX_ENCODED_BYTES ||
        value.width > 32767 ||
        value.width * value.height > limits.MAX_OUTPUT_PIXELS
      )
        throw fault("RESOURCE_LIMIT");
      uint(value.createdAt);
      uint(value.expiresAt);
      if (
        value.expiresAt !== value.createdAt + 600000 ||
        value.terminalAt !== null ||
        typeof value.paused !== "boolean" ||
        (value.canResume !== null && typeof value.canResume !== "boolean")
      )
        throw fault("INVALID_ENVELOPE");
    } else {
      enumValue(value.kind, ["tombstone"]);
      enumValue(value.sourceState, ["released", "expired"]);
      utf8(value.sourceUrl, 512);
      uint(value.terminalAt);
      utf8(JSON.stringify(value), 1024);
    }
    return value;
  }
  const requestPayloads = Object.freeze({
    start: ["prep", "captureContext", "deadlines", "budget"],
    frame: ["spec", "preSnapshot", "postSnapshot", "dataUrl"],
    finish: ["intentId"],
    abort: ["reason"],
    "download-arm": [
      "intentId",
      "url",
      "byteLength",
      "targetBrowser",
      "tabId",
      "windowId",
      "incognito",
    ],
    "download-bind": ["intentId", "downloadId", "expectedRevision", "basis"],
    "download-observe": ["intentId", "expectedRevision", "apiOutcome", "code"],
    "download-update": ["intentId", "expectedRevision", "item"],
    "download-release": ["intentId", "expectedRevision", "reason"],
    status: [],
    "download-list": [],
  });
  function validateCompositorRequest(value) {
    const descriptors = Object.getOwnPropertyDescriptors(value || {});
    const type = descriptors.type?.value;
    if (!Object.hasOwn(requestPayloads, type)) throw fault("INVALID_ENVELOPE");
    const context = type === "status" || type === "download-list",
      base = [
        "target",
        "type",
        "protocolVersion",
        "requestId",
        ...(context
          ? ["requesterOwner"]
          : ["operationId", "sessionId", "owner"]),
      ],
      required = [...base, ...requestPayloads[type]],
      optional =
        type === "abort"
          ? ["intentId", "expectedContextId", "expectedLifecycleGeneration"]
          : type === "download-bind"
            ? ["item"]
            : [];
    shape(value, required, optional);
    if (
      value.target !== "cfp-offscreen" ||
      value.protocolVersion !== 1 ||
      !uuid(value.requestId)
    )
      throw fault("INVALID_ENVELOPE");
    for (const key of context
      ? ["requesterOwner"]
      : ["operationId", "sessionId", "owner"])
      if (!uuid(value[key])) throw fault("INVALID_ENVELOPE");
    if (value.intentId !== undefined && !uuid(value.intentId))
      throw fault("INVALID_ENVELOPE");
    if (type === "start") {
      validatePrep(value.prep);
      contextKey(value.captureContext);
      ownRecord(value.deadlines, [
        "operationExpiresAt",
        "captureExpiresAt",
        "encodeBudgetMs",
      ]);
      for (const key of Object.keys(value.deadlines))
        if (uint(value.deadlines[key]) === 0) throw fault("INVALID_ENVELOPE");
      if (
        value.deadlines.captureExpiresAt > value.deadlines.operationExpiresAt ||
        value.deadlines.encodeBudgetMs > limits.MAX_ENCODE_MS
      )
        throw fault("INVALID_ENVELOPE");
      ownRecord(value.budget, [
        "operationEnvelopeBytes",
        "maxOutputBytes",
        "observedLedgerRevision",
      ]);
      for (const key of Object.keys(value.budget)) uint(value.budget[key]);
      if (
        value.budget.operationEnvelopeBytes > limits.MAX_ACCOUNTED_BYTES ||
        value.budget.maxOutputBytes > limits.MAX_ENCODED_BYTES ||
        value.budget.maxOutputBytes === 0
      )
        throw fault("RESOURCE_LIMIT");
    }
    if (type === "frame") {
      validateFrameDataUrl(value.dataUrl);
      ownRecord(value.spec, specFields);
      ownRecord(value.preSnapshot, snapshotFields);
      ownRecord(value.postSnapshot, snapshotFields);
    }
    if (type === "abort") {
      if (value.reason === "WORKER_REPLACED") {
        if (!uuid(value.expectedContextId) || value.intentId !== undefined)
          throw fault("INVALID_ENVELOPE");
        uint(value.expectedLifecycleGeneration);
      } else {
        enumValue(value.reason, cancelReasons);
        if (
          value.expectedContextId !== undefined ||
          value.expectedLifecycleGeneration !== undefined
        )
          throw fault("INVALID_ENVELOPE");
      }
    }
    if (type === "download-arm") {
      utf8(value.url, 512);
      if (uint(value.byteLength) === 0) throw fault("INVALID_GEOMETRY");
      contextKey({
        targetBrowser: value.targetBrowser,
        tabId: value.tabId,
        windowId: value.windowId,
        incognito: value.incognito,
      });
    }
    if (
      type.startsWith("download-") &&
      type !== "download-list" &&
      type !== "download-arm"
    )
      uint(value.expectedRevision);
    if (type === "download-bind") {
      uint(value.downloadId);
      enumValue(value.basis, ["api-result", "exact-item"]);
      if (value.basis === "exact-item") item(value.item);
      else if (value.item !== undefined) throw fault("INVALID_ENVELOPE");
    }
    if (type === "download-observe") {
      enumValue(value.apiOutcome, ["failed", "invalid", "timed-out"]);
      enumValue(value.code, [
        "DOWNLOAD_START_FAILED",
        "DOWNLOAD_START_INVALID",
        "DOWNLOAD_START_UNCERTAIN",
      ]);
    }
    if (type === "download-update") item(value.item);
    if (type === "download-release") enumValue(value.reason, releases);
    const control =
      type === "frame"
        ? Object.fromEntries(
            Object.entries(value).filter(([key]) => key !== "dataUrl"),
          )
        : value;
    const bytes = new TextEncoder().encode(JSON.stringify(control)).byteLength;
    if (
      bytes > limits.MAX_CONTROL_BYTES ||
      (type === "frame" && value.dataUrl.length + bytes + 32 > 64 * 1024 * 1024)
    )
      throw fault("RESOURCE_LIMIT");
    return Object.fromEntries(
      base
        .concat(value.intentId === undefined ? [] : ["intentId"])
        .map((key) => [key, value[key]]),
    );
  }
  function makeCompositorResponseValidator(request) {
    const echo = Object.freeze(validateCompositorRequest(request));
    return (value) => validateCompositorResponseEcho(echo, value);
  }
  function validateCompositorResponse(request, value) {
    return makeCompositorResponseValidator(request)(value);
  }
  function validateCompositorResponseEcho(echo, value) {
    const keys = Object.keys(echo);
    ownRecord(value, Reflect.ownKeys(value || {}));
    if (!value || keys.some((key) => value[key] !== echo[key]))
      throw fault("INVALID_IDENTITY");
    if (value.ok === false) {
      ownRecord(value, [...keys, "ok", "code", "error"]);
      if (
        !Object.hasOwn(messages, value.code) ||
        value.error !== errorResult(value.code).error
      )
        throw fault("INVALID_ENVELOPE");
      throw fault(value.code);
    }
    if (value.ok !== true) throw fault("INVALID_ENVELOPE");
    let fields = [];
    switch (echo.type) {
      case "start":
        fields = [];
        break;
      case "frame":
        fields = [
          "acceptedSequence",
          "bitmapWidth",
          "bitmapHeight",
          "rect",
          "novelRect",
        ];
        uint(value.acceptedSequence);
        cssBitmap(value.bitmapWidth, value.bitmapHeight);
        ownRecord(value.rect, ["sx", "sy", "sw", "sh", "dx", "dy"]);
        if (value.novelRect !== null)
          ownRecord(value.novelRect, ["sx", "sy", "sw", "sh", "dx", "dy"]);
        break;
      case "finish":
        fields = [
          "url",
          "width",
          "height",
          "byteLength",
          "revision",
          "sourceState",
        ];
        utf8(value.url, 512);
        for (const key of ["width", "height", "byteLength"])
          if (uint(value[key]) === 0) throw fault("INVALID_GEOMETRY");
        uint(value.revision);
        if (value.sourceState !== "encoded") throw fault("INVALID_ENVELOPE");
        break;
      case "abort":
        fields = ["idle"];
        if (typeof value.idle !== "boolean") throw fault("INVALID_ENVELOPE");
        break;
      case "status":
      case "download-list":
        fields = [
          "contextId",
          "lifecycleGeneration",
          "idle",
          "activeSession",
          "retainedUrlCount",
          "retainedUrlBytes",
          "pendingDisposalBytes",
          "accountedBytes",
          "ledgerRevision",
        ];
        if (!uuid(value.contextId) || typeof value.idle !== "boolean")
          throw fault("INVALID_ENVELOPE");
        for (const key of [
          "lifecycleGeneration",
          "retainedUrlCount",
          "retainedUrlBytes",
          "pendingDisposalBytes",
          "accountedBytes",
          "ledgerRevision",
        ])
          uint(value[key]);
        if (value.activeSession !== null) {
          ownRecord(value.activeSession, [
            "operationId",
            "sessionId",
            "owner",
            "phase",
            "expiresAt",
          ]);
          for (const key of ["operationId", "sessionId", "owner"])
            if (!uuid(value.activeSession[key]))
              throw fault("INVALID_IDENTITY");
          enumValue(value.activeSession.phase, ["capturing", "encoding"]);
          uint(value.activeSession.expiresAt);
        }
        if (echo.type === "download-list") {
          fields.push("entries");
          if (!Array.isArray(value.entries) || value.entries.length > 24)
            throw fault("RESOURCE_LIMIT");
          for (const entry of value.entries) validateOutputRecord(entry);
        }
        break;
      default:
        fields = ["entry"];
        validateOutputRecord(value.entry);
    }
    ownRecord(value, [...keys, "ok", ...fields]);
    utf8(JSON.stringify(value), limits.MAX_CONTROL_BYTES);
    return value;
  }
  function validateNotification(value) {
    const idle =
        Object.getOwnPropertyDescriptor(value || {}, "type")?.value ===
        "offscreen-idle",
      fields = [
        "target",
        "type",
        "protocolVersion",
        "requestId",
        "requesterOwner",
        "contextId",
        "lifecycleGeneration",
        ...(idle ? ["idle"] : ["intentIds", "reason"]),
      ];
    ownRecord(value, fields);
    if (value.target !== "cfp-worker" || value.protocolVersion !== 1)
      throw fault("INVALID_ENVELOPE");
    for (const key of ["requestId", "requesterOwner", "contextId"])
      if (!uuid(value[key])) throw fault("INVALID_IDENTITY");
    uint(value.lifecycleGeneration);
    if (idle) {
      if (value.idle !== true) throw fault("INVALID_ENVELOPE");
    } else {
      if (
        value.type !== "download-reconcile-needed" ||
        !Array.isArray(value.intentIds) ||
        value.intentIds.length > 4 ||
        value.intentIds.some((id) => !uuid(id)) ||
        new Set(value.intentIds).size !== value.intentIds.length
      )
        throw fault("INVALID_ENVELOPE");
      enumValue(value.reason, ["periodic", "expiry"]);
    }
    utf8(JSON.stringify(value), limits.MAX_CONTROL_BYTES);
    return { ...value };
  }
  const restoreCodes = Object.freeze([
    "DOCUMENT_REPLACED",
    "NODE_REPLACED",
    "PAGE_STYLE_CHANGED",
    "PAGE_SCROLL_CHANGED",
    "STYLE_REMOVE_FAILED",
    "STYLE_RESTORE_FAILED",
    "SCROLL_RESTORE_FAILED",
    "PORT_DISCONNECTED",
  ]);
  const publicPhases = Object.freeze([
    "idle",
    "preparing",
    "capturing",
    "encoding",
    "initiating",
    "saving",
    "paused",
    "resumable",
    "saved",
    "cancelled",
    "failed",
    "uncertain",
    "expired",
  ]);
  function validateRestoreSummary(value) {
    ownRecord(value, [
      "status",
      "restoredCount",
      "preservedPageChanges",
      "failedCount",
      "codes",
    ]);
    enumValue(value.status, [
      "acknowledged",
      "partial",
      "failed",
      "unverified",
    ]);
    for (const key of ["restoredCount", "preservedPageChanges", "failedCount"])
      uint(value[key]);
    if (
      !Array.isArray(value.codes) ||
      value.codes.length > 8 ||
      new Set(value.codes).size !== value.codes.length ||
      value.codes.some((code) => !restoreCodes.includes(code))
    )
      throw fault("INVALID_ENVELOPE");
    if (
      value.status === "unverified" &&
      (value.restoredCount || value.preservedPageChanges || value.failedCount)
    )
      throw fault("INVALID_ENVELOPE");
    return value;
  }
  function validatePopupRequest(value) {
    const type = Object.getOwnPropertyDescriptor(value || {}, "type")?.value;
    enumValue(type, ["capture-active-tab", "capture-status", "capture-cancel"]);
    ownRecord(value, [
      "type",
      "requestId",
      "windowId",
      ...(type === "capture-cancel" ? ["tabId", "operationId"] : []),
    ]);
    if (!uuid(value.requestId)) throw fault("INVALID_IDENTITY");
    uint(value.windowId);
    if (type === "capture-cancel") {
      uint(value.tabId);
      if (!uuid(value.operationId)) throw fault("INVALID_IDENTITY");
    }
    return value;
  }
  function validatePublicStatus(value) {
    ownRecord(value, [
      "operationId",
      "tabId",
      "windowId",
      "incognito",
      "phase",
      "acceptedFrames",
      "attemptedFrames",
      "width",
      "height",
      "warnings",
      "code",
      "text",
      "restoration",
    ]);
    if (value.operationId !== null && !uuid(value.operationId))
      throw fault("INVALID_IDENTITY");
    uint(value.tabId);
    uint(value.windowId);
    if (typeof value.incognito !== "boolean") throw fault("INVALID_ENVELOPE");
    enumValue(value.phase, publicPhases);
    uint(value.acceptedFrames, limits.MAX_CAPTURE_FRAMES);
    uint(value.attemptedFrames, limits.MAX_CAPTURE_FRAMES * 5);
    for (const key of ["width", "height"])
      if (value[key] !== null) uint(value[key], limits.MAX_CSS);
    if (
      !Array.isArray(value.warnings) ||
      value.warnings.length > 3 ||
      new Set(value.warnings).size !== value.warnings.length ||
      value.warnings.some((code) => !warningCodes.includes(code))
    )
      throw fault("INVALID_ENVELOPE");
    if (value.code !== null && !Object.hasOwn(messages, value.code))
      throw fault("INVALID_ENVELOPE");
    utf8(value.text, 256);
    if (value.restoration !== null) validateRestoreSummary(value.restoration);
    utf8(JSON.stringify(value), 1024);
    return value;
  }
  globalThis.__cfpProtocol = Object.freeze({
    protocolVersion,
    ...limits,
    uuid,
    fault,
    errorResult,
    ownRecord,
    uint,
    assertFiniteGeometry,
    validatePrep,
    makeTraversal,
    nextFrameSpec,
    validateSpec,
    sameSpec,
    sameRect,
    validateSnapshot,
    snapshotPair,
    frameRect,
    novelFrameRect,
    cssBitmap,
    validateFrameDataUrl,
    getQualifiedCapabilities,
    cancelReasons,
    contextKey,
    validateNotification,
    validateRestoreSummary,
    validatePopupRequest,
    validatePublicStatus,
    publicPhases,
    validateOutputRecord,
    validateCompositorRequest,
    validateCompositorResponse,
    makeCompositorResponseValidator,
  });
})();
