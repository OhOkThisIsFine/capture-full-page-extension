(() => {
  if (window !== window.top) throw new Error("Top-frame capture is required.");
  if (window.__cfpFireStyleInstalled) return;
  const P = globalThis.__cfpProtocol;
  if (!P || P.protocolVersion !== 1)
    throw new Error("Capture protocol unavailable.");
  window.__cfpFireStyleInstalled = true;
  const documentNonce = crypto.randomUUID();
  let state = null;

  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.sender?.id !== chrome.runtime.id ||
      !port.name.startsWith("cfp:") ||
      !P.uuid(port.name.slice(4))
    )
      return;
    const owner = { cancelled: false, context: null };
    let commands = Promise.resolve(),
      identity = null,
      lastId = 0;
    const dispatch = async (message) => {
      try {
        P.ownRecord(message, [
          "id",
          "method",
          "protocolVersion",
          "operationId",
          "sessionId",
          "owner",
          "payload",
        ]);
      } catch {
        return;
      }
      const fields = ["operationId", "sessionId", "owner"];
      if (
        !message ||
        message.protocolVersion !== 1 ||
        !Number.isSafeInteger(message.id) ||
        message.id <= lastId ||
        fields.some((k) => !P.uuid(message[k]))
      )
        return;
      if (!identity) {
        if (
          message.method !== "prepare" ||
          port.name !== `cfp:${message.sessionId}`
        )
          return;
        identity = {
          protocolVersion: 1,
          ...Object.fromEntries(fields.map((k) => [k, message[k]])),
        };
        owner.identity = identity;
      }
      if (fields.some((k) => message[k] !== identity[k])) return;
      lastId = message.id;
      const reply = { replyTo: message.id, protocolVersion: 1, ...identity };
      try {
        let result;
        switch (message.method) {
          case "prepare":
            if (owner.prepared) throw P.fault("ALREADY_PREPARED");
            owner.prepared = true;
            result = await prepare(owner, message.payload);
            break;
          case "position":
            P.ownRecord(message.payload, ["spec"]);
            result = await moveTo(owner.context, message.payload.spec);
            break;
          case "snapshot":
            P.ownRecord(message.payload, ["spec"]);
            result = snapshot(owner.context, message.payload.spec);
            break;
          case "accept-frame":
            result = acceptFrame(owner.context, message.payload);
            break;
          case "restore":
            P.ownRecord(message.payload, ["reason"]);
            if (
              !["success", "failure", "cancel", "fallback"].includes(
                message.payload.reason,
              )
            )
              throw P.fault("INVALID_ENVELOPE");
            result = await restore(owner.context);
            break;
          case "cancel":
            P.ownRecord(message.payload, ["reason"]);
            if (!P.cancelReasons.includes(message.payload.reason))
              throw P.fault("INVALID_ENVELOPE");
            owner.cancelled = true;
            result = await restore(owner.context);
            break;
          default:
            throw P.fault("INVALID_METHOD");
        }
        port.postMessage({ ...reply, result });
      } catch (error) {
        port.postMessage({
          ...reply,
          code: error.code || "CAPTURE_FAILED",
          error: P.errorResult(error.code).error,
        });
      }
    };
    port.onMessage.addListener((message) => {
      if (
        Object.getOwnPropertyDescriptor(message || {}, "method")?.value ===
        "cancel"
      ) {
        dispatch(message).catch(() => {});
        return;
      }
      commands = commands.then(() => dispatch(message)).catch(() => {});
    });
    port.onDisconnect.addListener(() => {
      owner.cancelled = true;
      restore(owner.context).catch(() => {});
    });
  });

  function checkOwner(context) {
    if (
      !context ||
      context.cancelled ||
      context.owner.cancelled ||
      state !== context
    ) {
      throw P.fault("CANCELLED");
    }
    const now = Date.now(),
      mono = performance.now();
    if (
      now >= context.operationExpiresAt ||
      mono >= context.operationMonoDeadline
    )
      throw P.fault("OPERATION_TIMEOUT");
    if (
      context.phase === "preparing" &&
      (now >= context.prepareExpiresAt || mono >= context.prepareMonoDeadline)
    )
      throw P.fault("PREPARE_TIMEOUT");
    if (
      context.phase === "capturing" &&
      (now >= context.captureExpiresAt || mono >= context.captureMonoDeadline)
    )
      throw P.fault("CAPTURE_TIMEOUT");
  }

  async function prepare(
    owner = {
      cancelled: false,
      identity: {
        protocolVersion: 1,
        operationId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        owner: crypto.randomUUID(),
      },
    },
    options = {
      strategy: "auto",
      prepareExpiresAt: Date.now() + 15000,
      operationExpiresAt: Date.now() + 900000,
    },
  ) {
    const identity = owner.identity;
    P.ownRecord(options, [
      "strategy",
      "prepareExpiresAt",
      "operationExpiresAt",
    ]);
    if (
      !["auto", "preserve"].includes(options.strategy) ||
      !Number.isFinite(options.prepareExpiresAt) ||
      !Number.isFinite(options.operationExpiresAt)
    )
      throw P.fault("INVALID_ENVELOPE");
    if (
      options.strategy === "preserve" &&
      !P.getQualifiedCapabilities("chrome").preserveVirtualizer
    )
      throw P.fault("UNSUPPORTED_TARGET_MAPPING");
    if (state) restore(state);
    if (owner.cancelled) throw new Error("Capture session was cancelled.");
    const context = {
      owner,
      identity,
      planId: crypto.randomUUID(),
      cancelled: false,
      rollback: [],
      scrollRollback: [],
      hidden: new Map(),
      changedStyles: [],
      ownedStyles: [],
      roots: new WeakSet(),
      effects: new WeakSet(),
      listeners: [],
      observers: [],
      warnings: new Set(),
      scrollEpoch: 0,
      geometryEpoch: 0,
      geometryGeneration: 0,
    };
    const now = Date.now(),
      mono = performance.now();
    context.phase = "preparing";
    context.operationExpiresAt = Math.min(
      options.operationExpiresAt,
      now + P.MAX_OPERATION_MS,
    );
    context.operationMonoDeadline =
      mono + Math.min(P.MAX_OPERATION_MS, context.operationExpiresAt - now);
    context.prepareExpiresAt = Math.min(
      options.prepareExpiresAt,
      now + P.MAX_PREPARE_MS,
      context.operationExpiresAt,
    );
    context.prepareMonoDeadline =
      mono + Math.min(P.MAX_PREPARE_MS, context.prepareExpiresAt - now);
    owner.context = context;
    state = context;
    try {
      checkOwner(context);
      const documentScroller = measureDocument(document).scroller;
      const documentOriginal = {
        left: document.scrollingElement
          ? documentScroller.scrollLeft
          : window.scrollX,
        top: document.scrollingElement
          ? documentScroller.scrollTop
          : window.scrollY,
      };

      registerOwnedScroll(
        context,
        documentScroller,
        document,
        () => measureDocument(document).scroller === documentScroller,
        () =>
          document.scrollingElement
            ? {
                left: documentScroller.scrollLeft,
                top: documentScroller.scrollTop,
              }
            : { left: window.scrollX, top: window.scrollY },
        (left, top) => {
          if (document.scrollingElement) {
            documentScroller.scrollLeft = left;
            documentScroller.scrollTop = top;
          } else window.scrollTo(left, top);
        },
      );
      snapshotIframeScroll(context);

      const initialDocumentWidth = Math.max(
        documentScroller.scrollWidth,
        documentScroller.clientWidth,
        document.documentElement.scrollWidth,
        document.body?.scrollWidth || 0,
        1,
      );
      const initialDocumentHeight = Math.max(
        documentScroller.scrollHeight,
        documentScroller.clientHeight,
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
        1,
      );

      const detected = detectPrimaryScroller();
      let scroller = detected;
      let isDocument = isDocumentScroller(scroller);
      let nestedExpansion = null;

      // If a modern web app keeps its real content inside a large nested scroller,
      // first try FireShot's other strategy: temporarily unlock that scroller so
      // it expands IN PLACE. Then capture the document, preserving the surrounding
      // app shell (header/sidebar/toolbars) instead of cropping down to the scroller.
      if (!isDocument) {
        const nestedOriginal = {
          left: scroller.scrollLeft,
          top: scroller.scrollTop,
        };
        const frozenNested = {
          scrollWidth: Math.max(scroller.scrollWidth, scroller.clientWidth, 1),
          scrollHeight: Math.max(
            scroller.scrollHeight,
            scroller.clientHeight,
            1,
          ),
          clientWidth: Math.max(scroller.clientWidth, 1),
          clientHeight: Math.max(scroller.clientHeight, 1),
        };

        const nested = scroller;
        registerOwnedScroll(context, nested, nested.ownerDocument);
        writeOwnedScroll(context, nested, 0, 0);
        await settle();
        checkOwner(context);

        const unlock = unlockScrollableElement(scroller, frozenNested, context);
        await settle();
        checkOwner(context);

        const expandedDocumentWidth = Math.max(
          documentScroller.scrollWidth,
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0,
          documentScroller.clientWidth,
          1,
        );
        const expandedDocumentHeight = Math.max(
          documentScroller.scrollHeight,
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0,
          documentScroller.clientHeight,
          1,
        );

        const expectedExtraY = Math.max(
          0,
          frozenNested.scrollHeight - frozenNested.clientHeight,
        );
        const expectedExtraX = Math.max(
          0,
          frozenNested.scrollWidth - frozenNested.clientWidth,
        );
        const growthY = Math.max(
          0,
          expandedDocumentHeight - initialDocumentHeight,
        );
        const growthX = Math.max(
          0,
          expandedDocumentWidth - initialDocumentWidth,
        );

        const expandedEnoughY =
          expectedExtraY <= 8 ||
          growthY >= Math.min(80, Math.max(20, expectedExtraY * 0.25));

        const expandedEnoughX =
          expectedExtraX <= 8 ||
          growthX >= Math.min(80, Math.max(20, expectedExtraX * 0.25));

        if (expandedEnoughY && expandedEnoughX) {
          // Cap the frozen output to what existed BEFORE capture. If unlocking or
          // scrolling triggers lazy loading, normal full-page capture won't chase it.
          const expectedHeight = initialDocumentHeight + expectedExtraY;
          const expectedWidth = initialDocumentWidth + expectedExtraX;

          nestedExpansion = {
            element: scroller,
            original: nestedOriginal,
            restoreStyles: unlock.restore,
            frozenNested,
          };

          scroller = documentScroller;
          isDocument = true;

          // Allow a little layout slack, but never adopt arbitrary later growth.
          var frozenTargetHeight = Math.max(
            initialDocumentHeight,
            Math.min(expandedDocumentHeight, expectedHeight + 192),
          );
          var frozenTargetWidth = Math.max(
            initialDocumentWidth,
            Math.min(expandedDocumentWidth, expectedWidth + 64),
          );
        } else {
          unlock.restore();
          writeOwnedScroll(
            context,
            scroller,
            nestedOriginal.left,
            nestedOriginal.top,
          );
          await settle();
          checkOwner(context);

          var frozenTargetWidth = Math.max(
            scroller.scrollWidth,
            scroller.clientWidth,
            1,
          );
          var frozenTargetHeight = Math.max(
            scroller.scrollHeight,
            scroller.clientHeight,
            1,
          );
        }
      } else {
        var frozenTargetWidth = Math.max(
          scroller.scrollWidth,
          scroller.clientWidth,
          1,
        );
        var frozenTargetHeight = Math.max(
          scroller.scrollHeight,
          scroller.clientHeight,
          1,
        );
      }

      const iframeExpansion = expandSameOriginIframes(
        isDocument ? null : scroller,
        context,
      );
      if (iframeExpansion.count > 0) {
        await settle();
        checkOwner(context);

        if (isDocument) {
          frozenTargetWidth = Math.max(
            frozenTargetWidth,
            documentScroller.scrollWidth,
            document.documentElement.scrollWidth,
            document.body?.scrollWidth || 0,
          );
          frozenTargetHeight = Math.max(
            frozenTargetHeight,
            documentScroller.scrollHeight,
            document.documentElement.scrollHeight,
            document.body?.scrollHeight || 0,
          );
        } else {
          frozenTargetWidth = Math.max(
            frozenTargetWidth,
            scroller.scrollWidth,
            scroller.clientWidth,
          );
          frozenTargetHeight = Math.max(
            frozenTargetHeight,
            scroller.scrollHeight,
            scroller.clientHeight,
          );
        }
      }

      if (iframeExpansion.blocked > 0) {
        console.warn(
          `Capture Full Page: ${iframeExpansion.blocked} cross-origin iframe(s) could not be expanded and will remain viewport-only.`,
        );
      }

      const originalScrollLeft = scroller.scrollLeft;
      const originalScrollTop = scroller.scrollTop;
      const captureStyles = installCaptureStyles(context);

      Object.assign(context, {
        scroller,
        isDocument,
        captureStyles,
        iframeExpansion,
        originalScrollLeft,
        originalScrollTop,
        documentScroller,
        documentOriginal,
        nestedExpansion,
        targetWidth: frozenTargetWidth,
        targetHeight: frozenTargetHeight,
        currentX: 0,
        currentY: 0,
        logicalOffsetX: 0,
        logicalOffsetY: 0,
        firstVerticalMove: true,
        hidden: new Map(),
        changedStyles: [],
        tracked: new WeakMap(),
        frameIndex: 0,
      });

      neutralizeFixedBackgrounds();

      assertSupportedMapping(context);
      writeLogicalScroll(context, 0, 0);
      await settle();
      checkOwner(context);
      await snapshotVisibleElements();
      checkOwner(context);
      const viewport = measureViewport(context);
      const metrics = liveMetrics(context);
      const strategy = isDocument
        ? nestedExpansion
          ? "expanded-nested"
          : "document"
        : "preserve";
      if (
        strategy === "preserve" &&
        !P.getQualifiedCapabilities("chrome").preserveVirtualizer
      )
        throw P.fault("UNSUPPORTED_TARGET_MAPPING");
      context.prep = P.validatePrep({
        ...identity,
        documentNonce,
        planId: context.planId,
        strategy,
        captureScope: strategy === "preserve" ? "target-only" : "full-page",
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        layoutWidth: metrics.layoutWidth,
        layoutHeight: metrics.layoutHeight,
        targetWidth: context.targetWidth,
        targetHeight: context.targetHeight,
        ...viewport,
        direction: computed(scroller).direction || "ltr",
        writingMode: "horizontal-tb",
        physicalScrollWidth: metrics.physicalScrollWidth,
        physicalScrollHeight: metrics.physicalScrollHeight,
        devicePixelRatio: metrics.devicePixelRatio,
        visualViewport: metrics.visualViewport,
        geometryGeneration: context.geometryGeneration,
        warnings: [...context.warnings].sort().sort(),
      });
      context.signature = { ...metrics };
      freezeMappingSignature(context);
      context.plan = P.makeTraversal(context.prep);
      context.lastAcceptedSpec = null;
      installGeometryObservers(context);
      context.phase = "capturing";
      context.captureExpiresAt = Math.min(
        context.operationExpiresAt,
        Date.now() + P.MAX_CAPTURE_MS,
      );
      context.captureMonoDeadline = Math.min(
        context.operationMonoDeadline,
        performance.now() + P.MAX_CAPTURE_MS,
      );
      return context.prep;
    } catch (error) {
      await restore(context);
      throw error;
    }
  }

  function measureDocument(doc) {
    const win = doc.defaultView || window;
    const root =
      doc.compatMode === "BackCompat" ? doc.body : doc.documentElement;
    const scroller = doc.scrollingElement || root;
    return {
      scroller,
      viewportWidth: root?.clientWidth || win.innerWidth,
      viewportHeight: root?.clientHeight || win.innerHeight,
      scrollWidth: Math.max(
        scroller?.scrollWidth || 0,
        root?.scrollWidth || 0,
        win.innerWidth,
      ),
      scrollHeight: Math.max(
        scroller?.scrollHeight || 0,
        root?.scrollHeight || 0,
        win.innerHeight,
      ),
      direction: computed(scroller).direction || "ltr",
    };
  }
  function measureViewport(context) {
    if (context.isDocument) {
      const m = measureDocument(document);
      return {
        sourceLeft: 0,
        sourceTop: 0,
        clientWidth: m.viewportWidth,
        clientHeight: m.viewportHeight,
      };
    }
    const s = context.scroller,
      r = s.getBoundingClientRect();
    return {
      sourceLeft: r.left + s.clientLeft,
      sourceTop: r.top + s.clientTop,
      clientWidth: s.clientWidth,
      clientHeight: s.clientHeight,
    };
  }
  function readLogicalScroll(context) {
    const s = context.scroller,
      windowRoute = context.isDocument && !document.scrollingElement;
    const nativeX = windowRoute ? window.scrollX : s.scrollLeft,
      nativeY = windowRoute ? window.scrollY : s.scrollTop;
    const rtl = getComputedStyle(s).direction === "rtl";
    return {
      nativeX,
      nativeY,
      logicalX: rtl
        ? nativeX + s.scrollWidth - measureViewport(context).clientWidth
        : nativeX,
      logicalY: nativeY,
    };
  }
  function writeLogicalScroll(context, x, y) {
    const s = context.scroller,
      nativeX =
        getComputedStyle(s).direction === "rtl"
          ? x - (s.scrollWidth - measureViewport(context).clientWidth)
          : x;
    if (context.isDocument && !document.scrollingElement)
      window.scrollTo(nativeX, y);
    else {
      s.scrollLeft = nativeX;
      s.scrollTop = y;
    }
    const record = context.scrollRecords?.find((record) => record.node === s);
    if (record) record.lastOwned = record.read();
  }
  const mappingProperties = [
    "transform",
    "translate",
    "rotate",
    "scale",
    "transform-origin",
    "perspective",
    "perspective-origin",
    "filter",
    "backdrop-filter",
    "zoom",
    "contain",
    "content-visibility",
    "will-change",
    "overflow-x",
    "overflow-y",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "clip",
    "clip-path",
    "mask-image",
    "mask-border-source",
    "writing-mode",
    "direction",
  ];
  function computed(node, pseudo) {
    const doc = node.ownerDocument || document;
    if (doc === document) return getComputedStyle(node, pseudo);
    if (!doc.defaultView?.getComputedStyle)
      throw P.fault("UNSUPPORTED_TARGET_MAPPING");
    return doc.defaultView.getComputedStyle(node, pseudo);
  }
  function cssValue(css, name) {
    const camel = name.replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase(),
      ),
      value = css.getPropertyValue?.(name) || css[camel];
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  }
  function* composedAncestors(
    node,
    { includeSelf = false, context = state } = {},
  ) {
    const doc = node.ownerDocument;
    if (!doc) throw P.fault("UNSUPPORTED_TARGET_MAPPING");
    let current = node,
      first = true;
    const seen = new WeakSet();
    let count = 0;
    while (current) {
      if (seen.has(current) || ++count > P.MAX_MAPPING_NODES)
        throw P.fault("RESOURCE_LIMIT");
      seen.add(current);
      if (!first || includeSelf) yield current;
      first = false;
      let next = current.assignedSlot || current.parentElement;
      if (!next) {
        const root = current.getRootNode?.();
        if (root === doc) break;
        if (root?.nodeType === 11 && root.host && root.mode === "open")
          next = root.host;
        else if (current === doc.documentElement || current === doc.body) break;
        else throw P.fault("UNSUPPORTED_TARGET_MAPPING");
      }
      if (next.ownerDocument !== doc)
        throw P.fault("UNSUPPORTED_TARGET_MAPPING");
      current = next;
    }
  }
  function styleSignature(node) {
    const css = computed(node);
    return mappingProperties.map((property) => cssValue(css, property));
  }
  function mappingRegistry(context) {
    let bytes = 0,
      complete = false;
    const charge = (amount) => {
      reserveMetadata(context, amount);
      bytes += amount;
    };
    try {
      if (
        context.scroller.ownerDocument !== document ||
        (context.isDocument &&
          measureDocument(document).scroller !== context.scroller)
      )
        throw P.fault("DOCUMENT_REPLACED");
      const nodes = new Map();
      const recordChain = (node) => {
        charge(32);
        const chain = [];
        for (const element of composedAncestors(node, {
          includeSelf: true,
          context,
        })) {
          let entry = nodes.get(element);
          if (!entry) {
            if (nodes.size >= P.MAX_MAPPING_NODES)
              throw P.fault("RESOURCE_LIMIT");
            charge(128);
            const values = styleSignature(element);
            charge(
              values.reduce(
                (sum, value) => sum + new TextEncoder().encode(value).length,
                0,
              ),
            );
            entry = { node: element, document: element.ownerDocument, values };
            nodes.set(element, entry);
          }
          charge(16);
          chain.push(entry);
        }
        return chain;
      };
      const chain = recordChain(context.scroller),
        frames = [],
        candidates = [];
      for (const element of context.occluders?.keys() || []) {
        charge(64);
        candidates.push({ element, chain: recordChain(element) });
      }
      for (const saved of context.expandedFrames || []) {
        if (saved.el.contentDocument !== saved.frameDocument)
          throw P.fault("DOCUMENT_REPLACED");
        const doc = saved.frameDocument,
          m = measureDocument(doc);
        charge(128);
        frames.push({
          element: saved.el,
          document: doc,
          root: m.scroller,
          clientWidth: m.viewportWidth,
          clientHeight: m.viewportHeight,
          scrollWidth: m.scrollWidth,
          scrollHeight: m.scrollHeight,
          outer: recordChain(saved.el),
          inner: recordChain(m.scroller),
        });
      }
      complete = true;
      return {
        document,
        selected: context.scroller,
        chain,
        frames,
        candidates,
        metadataBytes: bytes,
      };
    } finally {
      if (!complete) context.metadataBytes -= bytes;
    }
  }
  function freezeMappingSignature(context) {
    const registry = mappingRegistry(context);
    if (context.mappingSignature)
      context.metadataBytes -= context.mappingSignature.metadataBytes;
    context.mappingSignature = registry;
    return registry;
  }
  function assertMappingUnchanged(context) {
    if (!context.mappingSignature) return;
    let actual;
    try {
      actual = mappingRegistry(context);
      const frozen = context.mappingSignature,
        sameChain = (a, b) =>
          a.length === b.length &&
          a.every(
            (entry, index) =>
              entry.node === b[index].node &&
              entry.document === b[index].document &&
              entry.values.every(
                (value, key) => value === b[index].values[key],
              ),
          );
      if (
        actual.document !== frozen.document ||
        actual.selected !== frozen.selected ||
        !sameChain(actual.chain, frozen.chain) ||
        actual.frames.length !== frozen.frames.length
      )
        throw P.fault("GEOMETRY_CHANGED");
      if (
        frozen.candidates.some(
          (candidate) =>
            candidate.element.ownerDocument !== document ||
            !sameChain(
              actual.candidates.find(
                (current) => current.element === candidate.element,
              )?.chain || [],
              candidate.chain,
            ),
        )
      )
        throw P.fault("GEOMETRY_CHANGED");
      for (let index = 0; index < actual.frames.length; index++) {
        const a = actual.frames[index],
          b = frozen.frames[index];
        if (a.document !== b.document || a.root !== b.root)
          throw P.fault("DOCUMENT_REPLACED");
        if (
          [
            "element",
            "clientWidth",
            "clientHeight",
            "scrollWidth",
            "scrollHeight",
          ].some((key) => a[key] !== b[key]) ||
          !sameChain(a.outer, b.outer) ||
          !sameChain(a.inner, b.inner)
        )
          throw P.fault("GEOMETRY_CHANGED");
      }
    } finally {
      if (actual) {
        context.metadataBytes -= actual.metadataBytes;
        actual = null;
      }
    }
  }
  function assertSupportedMapping(context) {
    for (const element of composedAncestors(context.scroller, {
      includeSelf: true,
      context,
    })) {
      const css = computed(element);
      if (
        cssValue(css, "writing-mode") !== "horizontal-tb" ||
        ["transform", "translate", "rotate", "scale", "perspective"].some(
          (name) => cssValue(css, name) !== "none",
        ) ||
        !["normal", "1"].includes(cssValue(css, "zoom"))
      )
        throw P.fault("UNSUPPORTED_TARGET_MAPPING");
      if (!context.isDocument) {
        const overflow = [
            cssValue(css, "overflow-x"),
            cssValue(css, "overflow-y"),
          ],
          clipped = overflow.some((value) =>
            ["auto", "scroll", "hidden", "clip", "overlay"].includes(value),
          );
        if (
          (clipped &&
            mappingProperties
              .filter((name) => name.startsWith("border-"))
              .some(
                (name) =>
                  !/^0(?:px|%)?(?: 0(?:px|%)?)*$/.test(cssValue(css, name)),
              )) ||
          cssValue(css, "clip") !== "auto" ||
          ["clip-path", "mask-image", "mask-border-source"].some(
            (name) => !["", "none"].includes(cssValue(css, name)),
          ) ||
          cssValue(css, "contain") !== "none" ||
          cssValue(css, "content-visibility") !== "visible"
        )
          throw P.fault("UNSUPPORTED_TARGET_MAPPING");
      }
    }
    const v = window.visualViewport;
    if (
      v &&
      (v.scale !== 1 ||
        Math.abs(v.offsetLeft) > 0.5 ||
        Math.abs(v.offsetTop) > 0.5)
    )
      throw P.fault("UNSUPPORTED_TARGET_MAPPING");
  }
  function classifyCaptureAnchor(element, context) {
    const position = cssValue(computed(element), "position");
    if (position !== "fixed" && position !== "sticky")
      return { kind: "ordinary", reason: "ordinary" };
    if (
      [
        ...composedAncestors(context.scroller, { includeSelf: true, context }),
      ].includes(element)
    )
      return { kind: "ordinary", reason: "capture-ancestor" };
    if (element.ownerDocument !== document)
      return { kind: "nonviewport-fixed", reason: "child-viewport" };
    if (position === "sticky")
      return { kind: "sticky", reason: "natural-footprint-required" };
    for (const ancestor of composedAncestors(element, { context })) {
      const css = computed(ancestor);
      if (
        [
          "transform",
          "translate",
          "rotate",
          "scale",
          "perspective",
          "filter",
          "backdrop-filter",
        ].some(
          (name) =>
            cssValue(css, name) !== "none" && cssValue(css, name) !== "",
        ) ||
        /(?:^| )(?:layout|paint|strict|content)(?: |$)/.test(
          cssValue(css, "contain"),
        )
      )
        return { kind: "nonviewport-fixed", reason: "containing-block" };
      if (
        [
          "transform",
          "translate",
          "rotate",
          "scale",
          "perspective",
          "filter",
          "backdrop-filter",
        ].some((name) => cssValue(css, name) !== "none") ||
        !["normal", "1"].includes(cssValue(css, "zoom")) ||
        cssValue(css, "contain") !== "none" ||
        cssValue(css, "content-visibility") !== "visible"
      )
        return { kind: "indeterminate", reason: "unknown-containing-block" };
      const changes = cssValue(css, "will-change");
      if (
        changes !== "auto" &&
        (!changes ||
          changes
            .split(",")
            .some((name) =>
              [
                "transform",
                "translate",
                "rotate",
                "scale",
                "perspective",
                "filter",
                "backdrop-filter",
                "contain",
                "content-visibility",
                "zoom",
              ].includes(name.trim()),
            ))
      )
        return { kind: "indeterminate", reason: "will-change" };
    }
    return { kind: "viewport-fixed", reason: "top-layout-viewport" };
  }
  function liveMetrics(context) {
    const v = window.visualViewport,
      m = measureDocument(document),
      p = measureViewport(context),
      s = context.scroller;
    return {
      ...p,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      layoutWidth: m.viewportWidth,
      layoutHeight: m.viewportHeight,
      physicalScrollWidth: s.scrollWidth,
      physicalScrollHeight: s.scrollHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      visualViewport: v
        ? {
            scale: v.scale,
            offsetLeft: v.offsetLeft,
            offsetTop: v.offsetTop,
            width: v.width,
            height: v.height,
          }
        : null,
      geometryGeneration: context.geometryGeneration,
      geometryEpoch: context.geometryEpoch,
    };
  }
  function installGeometryObservers(context) {
    const listen = (target, type, fn) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, fn, { passive: true });
      context.listeners.push(() => target.removeEventListener(type, fn));
    };
    listen(
      context.isDocument ? window : context.scroller,
      "scroll",
      () => context.scrollEpoch++,
    );
    const geometry = () => {
      context.geometryEpoch++;
      context.geometryGeneration++;
    };
    listen(window, "resize", geometry);
    listen(window.visualViewport, "resize", geometry);
    listen(window.visualViewport, "scroll", geometry);
    if (typeof ResizeObserver !== "undefined") {
      let previous = null;
      const observer = new ResizeObserver(() => {
        const m = liveMetrics(context),
          key = [
            m.clientWidth,
            m.clientHeight,
            m.layoutWidth,
            m.layoutHeight,
          ].join(":");
        if (previous !== null && key !== previous) geometry();
        previous = key;
      });
      observer.observe(context.scroller);
      if (context.scroller !== document.documentElement)
        observer.observe(document.documentElement);
      context.observers.push(observer);
    }
  }
  function snapshot(context, spec) {
    checkOwner(context);
    P.validateSpec(context.plan, spec);
    assertMappingUnchanged(context);
    if (!P.sameSpec(spec, context.commandedSpec))
      throw P.fault(
        "FRAME_SEQUENCE_MISMATCH",
        "Snapshot does not match commanded frame.",
      );
    assertSupportedMapping(context);
    suppressViewportAnchoredElements(spec);
    const metrics = liveMetrics(context),
      original = context.signature;
    const keys = [
      "sourceLeft",
      "sourceTop",
      "clientWidth",
      "clientHeight",
      "windowWidth",
      "windowHeight",
      "layoutWidth",
      "layoutHeight",
      "devicePixelRatio",
      "physicalScrollWidth",
      "physicalScrollHeight",
    ];
    if (keys.some((k) => metrics[k] !== original[k])) {
      context.geometryGeneration++;
      metrics.geometryGeneration = context.geometryGeneration;
    }
    const scroll = readLogicalScroll(context);
    assertMappingUnchanged(context);
    return {
      documentNonce,
      ...context.identity,
      planId: context.planId,
      sequence: spec.sequence,
      ...metrics,
      nativeScrollLeft: scroll.nativeX,
      nativeScrollTop: scroll.nativeY,
      logicalX: scroll.logicalX,
      logicalY: scroll.logicalY,
      scrollEpoch: context.scrollEpoch,
      warnings: [...context.warnings].sort(),
    };
  }
  async function moveTo(context, spec) {
    checkOwner(context);
    P.validateSpec(context.plan, spec);
    const expected = P.nextFrameSpec(context.plan, context.lastAcceptedSpec);
    if (!P.sameSpec(spec, expected) && !P.sameSpec(spec, context.commandedSpec))
      throw P.fault(
        "FRAME_SEQUENCE_MISMATCH",
        "Position does not match planned traversal.",
      );
    if (
      context.commandedSpec &&
      !P.sameSpec(spec, context.commandedSpec) &&
      !P.sameSpec(context.commandedSpec, context.lastAcceptedSpec)
    )
      throw P.fault("FRAME_NOT_ACCEPTED");
    context.commandedSpec = spec;
    context.provisionalCandidates = new Map();
    discoverCaptureRoots(context, { remaining: P.MAX_DISCOVERED_ELEMENTS });
    writeLogicalScroll(context, spec.logicalX, spec.logicalY);
    await settle();
    checkOwner(context);
    context.currentX = context.scroller.scrollLeft;
    context.currentY = context.scroller.scrollTop;
    assertMappingUnchanged(context);
    suppressViewportAnchoredElements(spec);
    return snapshot(context, spec);
  }
  function acceptFrame(context, payload) {
    checkOwner(context);
    P.ownRecord(payload, [
      "spec",
      "bitmapWidth",
      "bitmapHeight",
      "rect",
      "novelRect",
    ]);
    const { spec, bitmapWidth, bitmapHeight, rect, novelRect } = payload;
    P.ownRecord(rect, ["sx", "sy", "sw", "sh", "dx", "dy"]);
    if (novelRect !== null)
      P.ownRecord(novelRect, ["sx", "sy", "sw", "sh", "dx", "dy"]);
    P.validateSpec(context.plan, spec);
    if (!P.sameSpec(spec, context.commandedSpec))
      throw P.fault("FRAME_SEQUENCE_MISMATCH");
    const expectedRect = P.frameRect(
        context.prep,
        spec,
        bitmapWidth,
        bitmapHeight,
      ),
      expectedNovel = P.novelFrameRect(
        context.plan,
        spec,
        bitmapWidth,
        bitmapHeight,
      );
    if (
      !P.sameRect(rect, expectedRect) ||
      !P.sameRect(novelRect, expectedNovel)
    )
      throw P.fault("INVALID_GEOMETRY");
    if (
      context.bitmapWidth !== undefined &&
      (context.bitmapWidth !== bitmapWidth ||
        context.bitmapHeight !== bitmapHeight)
    )
      throw P.fault("BITMAP_SCALE_CHANGED");
    if (P.sameSpec(spec, context.lastAcceptedSpec))
      return { acceptedSequence: spec.sequence };
    if (
      !P.sameSpec(spec, P.nextFrameSpec(context.plan, context.lastAcceptedSpec))
    )
      throw P.fault("FRAME_SEQUENCE_MISMATCH");
    context.bitmapWidth = bitmapWidth;
    context.bitmapHeight = bitmapHeight;
    context.lastAcceptedSpec = spec;
    for (const [node, observation] of context.provisionalCandidates || []) {
      context.tracked.set(node, observation);
      const record = observation.record;
      if (
        record?.suppressionFootprint &&
        observation.naturalPosition &&
        novelRect &&
        (record.kind !== "viewport-fixed" || spec.sequence === 0)
      ) {
        const bound = quantizedFootprint(context, record.suppressionFootprint),
          intersection = {
            x0: Math.max(bound.x0, novelRect.dx),
            y0: Math.max(bound.y0, novelRect.dy),
            x1: Math.min(bound.x1, novelRect.dx + novelRect.sw),
            y1: Math.min(bound.y1, novelRect.dy + novelRect.sh),
          };
        if (
          intersection.x1 > intersection.x0 &&
          intersection.y1 > intersection.y0
        ) {
          reserveMetadata(context, 64);
          record.naturalAccepted.push(intersection);
        }
      }
    }
    if (novelRect) {
      reserveMetadata(context, 64);
      (context.acceptedPixelRects ||= []).push({
        x0: novelRect.dx,
        y0: novelRect.dy,
        x1: novelRect.dx + novelRect.sw,
        y1: novelRect.dy + novelRect.sh,
      });
    }
    context.provisionalCandidates?.clear();
    if (novelRect)
      (context.acceptedRects ||= []).push({
        x0: novelRect.dx / (bitmapWidth / context.prep.windowWidth),
        y0: novelRect.dy / (bitmapHeight / context.prep.windowHeight),
        x1:
          (novelRect.dx + novelRect.sw) /
          (bitmapWidth / context.prep.windowWidth),
        y1:
          (novelRect.dy + novelRect.sh) /
          (bitmapHeight / context.prep.windowHeight),
      });
    return { acceptedSequence: spec.sequence };
  }
  function getViewportMetrics() {
    return measureViewport(state);
  }

  function detectPrimaryScroller() {
    const docScroller = document.scrollingElement || document.documentElement;
    const docScrollable =
      docScroller.scrollHeight > docScroller.clientHeight + 4 ||
      docScroller.scrollWidth > docScroller.clientWidth + 4;

    let best = null;
    let bestScore = -Infinity;
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el === document.body || el === document.documentElement) continue;
      if (el.clientWidth < 100 || el.clientHeight < 100) continue;
      if (
        el.scrollWidth <= el.clientWidth + 4 &&
        el.scrollHeight <= el.clientHeight + 4
      )
        continue;

      const style = getComputedStyle(el);
      if (!isScrollableStyle(style)) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= window.innerWidth ||
        rect.top >= window.innerHeight
      )
        continue;
      if (
        rect.width > window.innerWidth + 4 ||
        rect.height > window.innerHeight + 60
      )
        continue;

      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
      );
      const coverage = (visibleWidth * visibleHeight) / viewportArea;
      const widthFrac = visibleWidth / Math.max(1, window.innerWidth);
      const heightFrac = visibleHeight / Math.max(1, window.innerHeight);

      if (widthFrac < 0.5 || heightFrac < 0.55) continue;
      if (
        docScrollable &&
        coverage < 0.65 &&
        el.scrollHeight < docScroller.scrollHeight * 0.75
      )
        continue;

      const overflowGain = Math.log2(
        1 +
          Math.max(
            el.scrollHeight / Math.max(1, el.clientHeight),
            el.scrollWidth / Math.max(1, el.clientWidth),
          ),
      );
      const score =
        coverage * 10 + widthFrac * 2 + heightFrac * 3 + overflowGain;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best) return docScroller;

    if (docScrollable) {
      const rect = best.getBoundingClientRect();
      const dominates =
        rect.width >= window.innerWidth * 0.72 &&
        rect.height >= window.innerHeight * 0.72 &&
        best.scrollHeight >= docScroller.scrollHeight * 0.75;
      if (!dominates) return docScroller;
    }

    return best;
  }

  // Based on FireShot's scroll-container unlocking strategy: preserve every
  // changed inline style, relax overflow/height constraints on the target and
  // its ancestors, and account for flex/grid/positioned layouts.
  function unlockScrollableElement(target, frozen, context) {
    const saved = new Map();

    const restore = () => {
      for (const [node, props] of [...saved.entries()].reverse()) {
        for (const [prop, value] of Object.entries(props))
          restoreProperty(node, prop, value.value, value.priority);
      }
      saved.clear();
    };
    context?.rollback.push(restore);

    function save(el) {
      if (saved.has(el)) return;
      const props = [
        "overflow",
        "overflow-x",
        "overflow-y",
        "height",
        "min-height",
        "max-height",
        "flex-shrink",
        "flex-basis",
        "align-self",
        "position",
        "top",
        "bottom",
        "left",
        "right",
      ];
      const values = {};
      for (const prop of props) {
        values[prop] = {
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop),
        };
      }
      saved.set(el, values);
    }

    function set(el, prop, value) {
      save(el);
      writeOwnedProperty(el, prop, value);
    }

    const ancestors = [
      ...composedAncestors(target, { includeSelf: true, context }),
    ];
    for (const el of ancestors) {
      save(el);
      const cs = getComputedStyle(el);

      for (const prop of ["overflow", "overflow-x", "overflow-y"]) {
        const cssName = prop;
        const jsValue =
          prop === "overflow"
            ? cs.overflow
            : prop === "overflow-x"
              ? cs.overflowX
              : cs.overflowY;
        if (["auto", "scroll", "hidden", "clip", "overlay"].includes(jsValue)) {
          set(el, cssName, "visible");
        }
      }

      if (cs.maxHeight !== "none") set(el, "max-height", "none");

      if (el === target) {
        // For absolutely-positioned virtual content, "height:auto" can collapse.
        // Force the exact pre-capture scroll height instead.
        set(el, "height", `${Math.ceil(frozen.scrollHeight)}px`);
        set(
          el,
          "min-height",
          `${Math.min(Math.ceil(frozen.scrollHeight), 1000000)}px`,
        );
        set(el, "max-height", "none");
        set(el, "overflow", "visible");
        set(el, "overflow-y", "visible");
      } else {
        const numericHeight = parseFloat(cs.height);
        if (cs.height !== "auto" && Number.isFinite(numericHeight)) {
          set(el, "min-height", cs.height);
          set(el, "height", "auto");
        }
      }

      const parent = ancestors[ancestors.indexOf(el) + 1];
      if (parent) {
        const parentDisplay = getComputedStyle(parent).display;
        if (parentDisplay === "flex" || parentDisplay === "inline-flex") {
          set(el, "flex-shrink", "0");
          if (cs.flexBasis !== "auto") set(el, "flex-basis", "auto");
          if (cs.alignSelf === "stretch") set(el, "align-self", "flex-start");
        } else if (
          parentDisplay === "grid" ||
          parentDisplay === "inline-grid"
        ) {
          if (cs.alignSelf === "stretch") set(el, "align-self", "start");
        }
      }

      if (el === document.body || el === document.documentElement) {
        set(el, "height", "auto");
        set(el, "min-height", "100%");
      }

      if (cs.position === "absolute" || cs.position === "fixed") {
        set(el, "position", "relative");
        set(el, "top", "auto");
        set(el, "bottom", "auto");
        set(el, "left", "auto");
        set(el, "right", "auto");
      }

      if (el === document.documentElement) break;
    }

    return { restore };
  }

  function installPauseStyle(root, context) {
    if (context.roots.has(root)) return;
    context.roots.add(root);
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const style = doc.createElement("style");
    style.setAttribute("data-cfp-capture-style", context.planId);
    style.textContent =
      "*, *::before, *::after { animation-play-state:paused!important; scroll-behavior:auto!important; scroll-snap-type:none!important; }";
    (root.nodeType === 9
      ? root.head || root.documentElement
      : root
    ).appendChild(style);
    context.ownedStyles.push(style);
  }
  function reserveMetadata(context, bytes) {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      (context.metadataBytes || 0) + bytes > 16 * 1024 * 1024
    )
      throw P.fault("RESOURCE_LIMIT");
    context.metadataBytes = (context.metadataBytes || 0) + bytes;
    context.metadataPeak = Math.max(
      context.metadataPeak || 0,
      context.metadataBytes,
    );
  }
  function chargeObservedAllocation(context, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw P.fault("RESOURCE_LIMIT");
    const lease = { bytes, released: false };
    context.metadataBytes = (context.metadataBytes || 0) + bytes;
    context.metadataPeak = Math.max(
      context.metadataPeak || 0,
      context.metadataBytes,
    );
    const fits =
      Number.isSafeInteger(bytes) &&
      bytes >= 0 &&
      context.metadataBytes <= 16 * 1024 * 1024;
    context.observedAllocations = (context.observedAllocations || 0) + 1;
    if (!fits) context.excessObservedAllocation = true;
    return { lease, fits };
  }
  function releaseObservedAllocation(context, lease) {
    if (!lease || lease.released) return;
    lease.released = true;
    context.metadataBytes -= lease.bytes;
    if (context.metadataBytes < 0) throw P.fault("RESOURCE_LIMIT");
  }
  function classifyLiveEffects(element, visibleRect, context) {
    if (
      context.optionalEffectsStopped ||
      typeof element.getAnimations !== "function"
    )
      return;
    let sequence, lease;
    try {
      sequence = element.getAnimations({ subtree: false });
      const length = sequence.length,
        observed = chargeObservedAllocation(context, 32 + 16 * length);
      lease = observed.lease;
      if (
        !observed.fits ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > P.MAX_DISCOVERED_EFFECTS - (context.effectCount || 0)
      ) {
        context.optionalEffectsStopped = true;
        context.warnings.add("LIVE_MOTION");
        context.excessEffectSequence = true;
        return;
      }
      for (let index = 0; index < length; index++) {
        const effect = sequence[index];
        if (!effect || context.effects.has(effect)) continue;
        reserveMetadata(context, 64);
        context.effects.add(effect);
        context.effectCount = (context.effectCount || 0) + 1;
        if (effect.playState !== "running" && !effect.pending) continue;
        const rect = effect.effect?.target?.getBoundingClientRect?.();
        if (
          rect &&
          rect.right > visibleRect.left &&
          rect.bottom > visibleRect.top &&
          rect.left < visibleRect.right &&
          rect.top < visibleRect.bottom
        )
          context.warnings.add("LIVE_MOTION");
      }
    } catch (error) {
      context.optionalEffectsStopped = true;
      context.warnings.add("LIVE_MOTION");
    } finally {
      sequence = null;
      releaseObservedAllocation(context, lease);
    }
  }
  function discoverCaptureRoots(context, budget) {
    const visited = new WeakSet(),
      elements = new WeakSet();
    const visit = (root) => {
      if (!root || visited.has(root)) return;
      visited.add(root);
      if (!context.roots.has(root)) {
        if ((context.rootCount || 0) >= P.MAX_CAPTURE_ROOTS)
          throw P.fault("RESOURCE_LIMIT");
        reserveMetadata(context, 128);
        context.rootCount = (context.rootCount || 0) + 1;
        installPauseStyle(root, context);
      }
      const start = root.nodeType === 9 ? root.documentElement : root;
      const stack = [];
      let held = 0;
      const push = (node) => {
        if (!node) return;
        if (stack.length >= P.MAX_DISCOVERED_ELEMENTS)
          throw P.fault("RESOURCE_LIMIT");
        reserveMetadata(context, 32);
        held += 32;
        stack.push(node);
      };
      try {
        push(start);
        while (stack.length) {
          const node = stack.pop();
          held -= 32;
          context.metadataBytes -= 32;
          if (!node) continue;
          if (node.nodeType === 11) {
            for (
              let child = node.lastElementChild;
              child;
              child = child.previousElementSibling
            )
              push(child);
            continue;
          }
          if (elements.has(node)) continue;
          elements.add(node);
          discoverElement(context, node);
          if (--budget.remaining < 0) throw P.fault("RESOURCE_LIMIT");
          classifyLiveEffects(
            node,
            {
              left: 0,
              top: 0,
              right: window.innerWidth,
              bottom: window.innerHeight,
            },
            context,
          );
          if (node.shadowRoot) visit(node.shadowRoot);
          if (node instanceof HTMLIFrameElement || node.tagName === "IFRAME")
            try {
              const doc = node.contentDocument;
              if (doc) {
                void doc.location.href;
                visit(doc);
              }
            } catch (error) {
              if (error.code === "RESOURCE_LIMIT") throw error;
            }
          for (
            let child = node.lastElementChild;
            child;
            child = child.previousElementSibling
          )
            push(child);
        }
      } finally {
        context.metadataBytes -= held;
        stack.length = 0;
      }
    };
    visit(document);
  }
  function restoreOwnedStyles(context) {
    for (const node of context.ownedStyles) node.remove();
    context.ownedStyles.length = 0;
  }
  function installCaptureStyles(context) {
    discoverCaptureRoots(context, { remaining: P.MAX_DISCOVERED_ELEMENTS });
    return context.ownedStyles;
  }

  function snapshotIframeScroll(context) {
    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLIFrameElement)) continue;
      try {
        const frameDocument = el.contentDocument;
        if (!frameDocument) continue;
        void frameDocument.location.href;
        const root =
          frameDocument.scrollingElement || frameDocument.documentElement;
        if (!root) continue;
        registerOwnedScroll(
          context,
          root,
          frameDocument,
          () => el.contentDocument === frameDocument,
        );
      } catch (error) {
        if (error.code === "RESOURCE_LIMIT") throw error;
      }
    }
  }

  function expandSameOriginIframes(scopeScroller, context) {
    const saved = [];
    const rollback = () => {
      for (const { el, props } of [...saved].reverse()) {
        for (const [prop, value] of Object.entries(props))
          restoreProperty(el, prop, value.value, value.priority);
      }
    };
    const restoreScroll = () => {
      for (const savedFrame of [...saved].reverse())
        if (savedFrame.scrollRecord)
          restoreOwnedScroll(savedFrame.scrollRecord);
      saved.length = 0;
    };
    context?.rollback.push(rollback);

    let count = 0;
    let blocked = 0;

    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLIFrameElement)) continue;
      if (scopeScroller && !scopeScroller.contains(el)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      let frameDocument;
      try {
        frameDocument = el.contentDocument;
        if (!frameDocument) {
          blocked += 1;
          continue;
        }
        // Accessing location forces the same-origin check in browsers that
        // expose a non-null contentDocument proxy.
        void frameDocument.location.href;
      } catch {
        blocked += 1;
        continue;
      }

      const root =
        frameDocument.scrollingElement || frameDocument.documentElement;
      if (!root) continue;

      const contentWidth = Math.max(
        root.scrollWidth,
        frameDocument.documentElement?.scrollWidth || 0,
        frameDocument.body?.scrollWidth || 0,
        el.clientWidth,
      );
      const contentHeight = Math.max(
        root.scrollHeight,
        frameDocument.documentElement?.scrollHeight || 0,
        frameDocument.body?.scrollHeight || 0,
        el.clientHeight,
      );

      const needsWidth = contentWidth > el.clientWidth + 4;
      const needsHeight = contentHeight > el.clientHeight + 4;
      if (!needsWidth && !needsHeight) continue;

      const props = {};
      for (const prop of ["width", "height", "max-width", "max-height"]) {
        props[prop] = {
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop),
        };
      }
      const savedFrame = {
        el,
        props,
        frameDocument,
        root,
        left: root.scrollLeft,
        top: root.scrollTop,
      };
      saved.push(savedFrame);
      if (context) {
        (context.expandedFrames ||= []).push(savedFrame);
        savedFrame.scrollRecord = registerOwnedScroll(
          context,
          root,
          frameDocument,
          () => el.contentDocument === frameDocument,
        );
      }

      // A border-box CSS size includes decorations outside the iframe's inner
      // browsing viewport. Preserve room for the frozen content dimensions.
      const frameStyle = getComputedStyle(el);
      const decoration = (...properties) =>
        properties.reduce(
          (total, property) => total + (parseFloat(frameStyle[property]) || 0),
          0,
        );
      const extraWidth =
        frameStyle.boxSizing === "border-box"
          ? decoration(
              "borderLeftWidth",
              "borderRightWidth",
              "paddingLeft",
              "paddingRight",
            )
          : 0;
      const extraHeight =
        frameStyle.boxSizing === "border-box"
          ? decoration(
              "borderTopWidth",
              "borderBottomWidth",
              "paddingTop",
              "paddingBottom",
            )
          : 0;

      if (needsWidth) {
        writeOwnedProperty(
          el,
          "width",
          `${Math.ceil(contentWidth + extraWidth)}px`,
        );
        writeOwnedProperty(el, "max-width", "none");
      }
      if (needsHeight) {
        writeOwnedProperty(
          el,
          "height",
          `${Math.ceil(contentHeight + extraHeight)}px`,
        );
        writeOwnedProperty(el, "max-height", "none");
      }

      count += 1;
    }

    return {
      count,
      blocked,
      restore() {
        if (context) decideScrollOwnership(context);
        rollback();
        restoreScroll();
      },
    };
  }

  function isScrollableStyle(style) {
    const values = [style.overflow, style.overflowX, style.overflowY];
    return values.some(
      (value) => value === "auto" || value === "scroll" || value === "overlay",
    );
  }

  function isDocumentScroller(el) {
    return (
      el === document.scrollingElement ||
      el === document.documentElement ||
      el === document.body
    );
  }

  function discoverElement(context, node) {
    if (!context) return;
    context.discoveredElements ||= new WeakSet();
    if (context.discoveredElements.has(node)) return;
    if ((context.discoveredElementCount || 0) >= P.MAX_DISCOVERED_ELEMENTS)
      throw P.fault("RESOURCE_LIMIT");
    reserveMetadata(context, 128);
    context.discoveredElements.add(node);
    context.discoveredElementCount = (context.discoveredElementCount || 0) + 1;
  }
  function* allElements(root, context = state) {
    const stack = [],
      seen = new WeakSet();
    let visited = 0,
      temporary = 0;
    const push = (node) => {
      if (!node) return;
      if (stack.length >= P.MAX_DISCOVERED_ELEMENTS)
        throw P.fault("RESOURCE_LIMIT");
      if (context) reserveMetadata(context, 32);
      temporary += 32;
      stack.push(node);
    };
    try {
      push(root);
      while (stack.length) {
        const node = stack.pop();
        temporary -= 32;
        if (context) context.metadataBytes -= 32;
        if (!node || node.nodeType !== 1) continue;
        if (seen.has(node)) throw P.fault("RESOURCE_LIMIT");
        seen.add(node);
        if (++visited > P.MAX_DISCOVERED_ELEMENTS)
          throw P.fault("RESOURCE_LIMIT");
        discoverElement(context, node);
        yield node;
        for (
          let child = node.lastElementChild;
          child;
          child = child.previousElementSibling
        )
          push(child);
        if (node.shadowRoot?.mode === "open")
          for (
            let child = node.shadowRoot.lastElementChild;
            child;
            child = child.previousElementSibling
          )
            push(child);
      }
    } finally {
      if (context) context.metadataBytes -= temporary;
      stack.length = 0;
    }
  }

  function borderRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }
  function targetRect(rect, logicalX, logicalY, viewport) {
    return {
      x0: logicalX + rect.left - viewport.sourceLeft,
      y0: logicalY + rect.top - viewport.sourceTop,
      x1: logicalX + rect.right - viewport.sourceLeft,
      y1: logicalY + rect.bottom - viewport.sourceTop,
    };
  }
  function measureSuppressionFootprint(element, context) {
    const bound = borderRect(element);
    let hasDescendants = false,
      textRects = 0;
    if (
      element.ownerDocument !== document ||
      !(bound.width > 0 && bound.height > 0)
    )
      return {
        eligible: false,
        footprint: null,
        reason: "unqualified-viewport",
      };
    for (const node of allElements(element, context)) {
      const css = computed(node),
        rect = borderRect(node);
      if (
        cssValue(css, "display") === "none" ||
        cssValue(css, "visibility") === "hidden"
      )
        continue;
      if (
        (node !== element &&
          ["fixed", "sticky"].includes(cssValue(css, "position"))) ||
        [
          "transform",
          "translate",
          "rotate",
          "scale",
          "perspective",
          "filter",
          "backdrop-filter",
          "box-shadow",
          "text-shadow",
          "clip-path",
          "mask-image",
        ].some((name) => cssValue(css, name) !== "none") ||
        !["1", "normal"].includes(cssValue(css, "zoom")) ||
        cssValue(css, "outline-style") !== "none"
      )
        return { eligible: false, footprint: null, reason: "unbounded-paint" };
      for (const pseudo of ["::before", "::after", "::marker"]) {
        const content = cssValue(computed(node, pseudo), "content");
        if (
          !["none", "normal"].includes(content) ||
          (pseudo === "::marker" && cssValue(css, "display") === "list-item")
        )
          return {
            eligible: false,
            footprint: null,
            reason: "generated-paint",
          };
      }
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        (rect.left < bound.left ||
          rect.top < bound.top ||
          rect.right > bound.right ||
          rect.bottom > bound.bottom)
      )
        return {
          eligible: false,
          footprint: null,
          reason: "overflowing-descendant",
        };
      if (node.tagName?.includes("-") && !node.shadowRoot)
        return {
          eligible: false,
          footprint: null,
          reason: "inaccessible-subtree",
        };
      if (node.tagName === "SLOT")
        return {
          eligible: false,
          footprint: null,
          reason: "indeterminate-slot",
        };
      {
        let children = 0;
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (++children > P.MAX_DISCOVERED_ELEMENTS)
            throw P.fault("RESOURCE_LIMIT");
          discoverElement(context, child);
          if (child.nodeType === 3 && child.length > 0) {
            hasDescendants = true;
            if (!node.ownerDocument.createRange)
              return {
                eligible: false,
                footprint: null,
                reason: "unverified-text-layout",
              };
            reserveMetadata(context, 64);
            let range, rects, lease;
            try {
              range = node.ownerDocument.createRange();
              range.selectNodeContents(child);
              rects = range.getClientRects();
              const observed = chargeObservedAllocation(
                context,
                32 + 16 * rects.length,
              );
              lease = observed.lease;
              if (
                !observed.fits ||
                textRects + rects.length > P.MAX_DISCOVERED_ELEMENTS
              )
                throw P.fault("RESOURCE_LIMIT");
              textRects += rects.length;
              for (let index = 0; index < rects.length; index++) {
                const r = rects[index];
                if (
                  r.width > 0 &&
                  r.height > 0 &&
                  (r.left < bound.left ||
                    r.top < bound.top ||
                    r.right > bound.right ||
                    r.bottom > bound.bottom)
                )
                  return {
                    eligible: false,
                    footprint: null,
                    reason: "overflowing-text",
                  };
              }
            } finally {
              rects = null;
              range?.detach?.();
              range = null;
              releaseObservedAllocation(context, lease);
              context.metadataBytes -= 64;
            }
          }
        }
      }
      if (node !== element) hasDescendants = true;
    }
    const css = computed(element);
    if (
      hasDescendants &&
      (!["hidden", "clip"].includes(cssValue(css, "overflow-x")) ||
        !["hidden", "clip"].includes(cssValue(css, "overflow-y")) ||
        mappingProperties
          .filter((name) => name.startsWith("border-"))
          .some(
            (name) => !/^0(?:px|%)?(?: 0(?:px|%)?)*$/.test(cssValue(css, name)),
          ))
    )
      return { eligible: false, footprint: null, reason: "ink-not-clipped" };
    return {
      eligible: true,
      footprint: bound,
      reason: "bounded-border-subtree",
    };
  }
  function temporaryNaturalRule(element, context) {
    const doc = element.ownerDocument,
      root = element.getRootNode(),
      style = doc.createElement("style"),
      token = crypto.randomUUID(),
      previous = element.getAttribute("data-cfp-natural");
    element.setAttribute("data-cfp-natural", token);
    style.setAttribute("data-cfp-capture-style", context.planId);
    style.textContent = `[data-cfp-natural="${token}"] { position:relative!important; inset:auto!important; }`;
    (root.nodeType === 9
      ? root.head || root.documentElement
      : root
    ).appendChild(style);
    return () => {
      style.remove();
      if (
        element.ownerDocument === doc &&
        element.getAttribute("data-cfp-natural") === token
      ) {
        if (previous === null) element.removeAttribute("data-cfp-natural");
        else element.setAttribute("data-cfp-natural", previous);
      }
    };
  }
  async function snapshotVisibleElements() {
    const context = state,
      cleanup = [],
      candidates = [];
    if (!context) return;
    context.occluders ||= new Map();
    const viewport = measureViewport(context),
      scroll = readLogicalScroll(context);
    try {
      for (const element of allElements(document.documentElement)) {
        if (!(element instanceof HTMLElement)) continue;
        const anchor = classifyCaptureAnchor(element, context);
        if (["ordinary", "nonviewport-fixed"].includes(anchor.kind)) continue;
        if (candidates.length >= P.MAX_DISCOVERED_ELEMENTS)
          throw P.fault("RESOURCE_LIMIT");
        if (anchor.kind === "sticky")
          cleanup.push(temporaryNaturalRule(element, context));
        candidates.push({ element, anchor });
      }
      for (const { element, anchor } of candidates) {
        const natural = borderRect(element),
          footprint = measureSuppressionFootprint(element, context);
        reserveMetadata(context, 256);
        context.occluders.set(element, {
          element,
          document: element.ownerDocument,
          kind: anchor.kind,
          naturalBorderRect: targetRect(
            natural,
            scroll.logicalX,
            scroll.logicalY,
            viewport,
          ),
          suppressionFootprint: footprint.eligible
            ? targetRect(
                footprint.footprint,
                scroll.logicalX,
                scroll.logicalY,
                viewport,
              )
            : null,
          eligible:
            footprint.eligible &&
            ["viewport-fixed", "sticky"].includes(anchor.kind),
          naturalAccepted: [],
          firstSequence: 0,
          knownNatural: true,
        });
      }
    } finally {
      for (const remove of cleanup.reverse()) remove();
    }
    if (cleanup.length) {
      await settle();
      checkOwner(context);
    }
  }
  function quantizedFootprint(context, rect) {
    const rx = context.bitmapWidth / context.prep.windowWidth,
      ry = context.bitmapHeight / context.prep.windowHeight;
    return {
      x0: Math.max(0, Math.floor(rect.x0 * rx)),
      y0: Math.max(0, Math.floor(rect.y0 * ry)),
      x1: Math.min(
        Math.floor(context.prep.targetWidth * rx),
        Math.ceil(rect.x1 * rx),
      ),
      y1: Math.min(
        Math.floor(context.prep.targetHeight * ry),
        Math.ceil(rect.y1 * ry),
      ),
    };
  }
  function suppressViewportAnchoredElements(spec) {
    const context = state;
    assertMappingUnchanged(context);
    context.occluders ||= new Map();
    let visited = 0;
    for (const element of allElements(document.documentElement)) {
      if (++visited > P.MAX_DISCOVERED_ELEMENTS)
        throw P.fault("RESOURCE_LIMIT");
      if (!(element instanceof HTMLElement)) continue;
      const anchor = classifyCaptureAnchor(element, context);
      if (["ordinary", "nonviewport-fixed"].includes(anchor.kind)) continue;
      const rect = borderRect(element);
      if (rect.width <= 0 || rect.height <= 0) continue;
      let record = context.occluders.get(element);
      if (!record) {
        const measured = measureSuppressionFootprint(element, context);
        record = {
          element,
          document: element.ownerDocument,
          kind: anchor.kind,
          naturalBorderRect: targetRect(
            rect,
            spec.logicalX,
            spec.logicalY,
            spec,
          ),
          suppressionFootprint: measured.eligible
            ? targetRect(measured.footprint, spec.logicalX, spec.logicalY, spec)
            : null,
          eligible: measured.eligible,
          naturalAccepted: [],
          firstSequence: spec.sequence,
          knownNatural: false,
        };
        context.occluders.set(element, record);
        reserveMetadata(context, 256);
      }
      if (
        record.document !== element.ownerDocument ||
        record.kind !== anchor.kind
      )
        throw P.fault("GEOMETRY_CHANGED");
      const measured = measureSuppressionFootprint(element, context);
      if (
        record.eligible !==
          (measured.eligible &&
            ["viewport-fixed", "sticky"].includes(anchor.kind)) ||
        (record.eligible &&
          (measured.footprint.width !==
            record.naturalBorderRect.x1 - record.naturalBorderRect.x0 ||
            measured.footprint.height !==
              record.naturalBorderRect.y1 - record.naturalBorderRect.y0))
      )
        throw P.fault("GEOMETRY_CHANGED");
      const current = measured.eligible
          ? targetRect(measured.footprint, spec.logicalX, spec.logicalY, spec)
          : null,
        natural = record.naturalBorderRect,
        naturalPosition =
          record.knownNatural &&
          !!current &&
          ["x0", "y0", "x1", "y1"].every(
            (key) => Math.abs(current[key] - natural[key]) <= 0.5,
          );
      context.provisionalCandidates.set(element, {
        record,
        naturalPosition,
        rect: current,
      });
      if (spec.sequence === 0) continue;
      const novel = P.novelFrameRect(
        context.plan,
        spec,
        context.bitmapWidth,
        context.bitmapHeight,
      );
      if (!novel) continue;
      const required = {
        x0: novel.dx,
        y0: novel.dy,
        x1: novel.dx + novel.sw,
        y1: novel.dy + novel.sh,
      };
      if (!record.eligible || !record.suppressionFootprint)
        throw P.fault("UNSUPPORTED_OCCLUSION");
      const footprint = quantizedFootprint(
          context,
          record.suppressionFootprint,
        ),
        represented = !uncoveredIntersection(
          footprint,
          footprint,
          record.naturalAccepted,
        );
      if (
        represented &&
        ["viewport-fixed", "sticky"].includes(record.kind) &&
        (record.kind !== "viewport-fixed" || record.firstSequence === 0) &&
        !context.hidden.has(element)
      ) {
        assertMappingUnchanged(context);
        const again = classifyCaptureAnchor(element, context),
          bounded = measureSuppressionFootprint(element, context);
        if (again.kind !== record.kind || !bounded.eligible)
          throw P.fault("GEOMETRY_CHANGED");
        hideElement(element);
      }
      if (
        Number(computed(element).opacity) !== 0 &&
        !(record.kind === "sticky" && naturalPosition)
      ) {
        const currentPixels = quantizedFootprint(context, current);
        if (
          uncoveredIntersection(
            currentPixels,
            required,
            context.acceptedPixelRects || [],
          )
        )
          throw P.fault("UNSUPPORTED_OCCLUSION");
      }
    }
    context.lastPosition = spec;
  }
  function uncoveredIntersection(a, b, covered) {
    let pieces = [],
      held = 0;
    const context = state;
    const push = (list, r) => {
      if (r.x1 <= r.x0 || r.y1 <= r.y0) return;
      if (list.length >= P.MAX_CAPTURE_FRAMES * 4)
        throw P.fault("RESOURCE_LIMIT");
      if (context) reserveMetadata(context, 32);
      held += 32;
      list.push(r);
    };
    try {
      push(pieces, {
        x0: Math.max(a.x0, b.x0),
        y0: Math.max(a.y0, b.y0),
        x1: Math.min(a.x1, b.x1),
        y1: Math.min(a.y1, b.y1),
      });
      for (const c of covered) {
        const next = [];
        for (const r of pieces) {
          const x0 = Math.max(r.x0, c.x0),
            y0 = Math.max(r.y0, c.y0),
            x1 = Math.min(r.x1, c.x1),
            y1 = Math.min(r.y1, c.y1);
          if (x1 <= x0 || y1 <= y0) {
            push(next, r);
            continue;
          }
          push(next, { ...r, y1: y0 });
          push(next, { ...r, y0: y1 });
          push(next, { x0: r.x0, x1: x0, y0, y1 });
          push(next, { x0: x1, x1: r.x1, y0, y1 });
        }
        const released = 32 * pieces.length;
        held -= released;
        if (context) context.metadataBytes -= released;
        pieces = next;
        if (!pieces.length) return false;
      }
      return pieces.length > 0;
    } finally {
      if (context) context.metadataBytes -= held;
      pieces.length = 0;
    }
  }
  function hideElement(el) {
    if (state.hidden.has(el)) return;
    // A removable rule preserves page inline values and active CSS transitions.
    reserveMetadata(state, 256);
    const root = el.getRootNode(),
      doc = el.ownerDocument,
      style = doc.createElement("style");
    const token = `cfp-${crypto.randomUUID()}`,
      previous = el.getAttribute("data-cfp-occluder");
    el.setAttribute("data-cfp-occluder", token);
    style.setAttribute("data-cfp-capture-style", state.planId);
    style.textContent = `[data-cfp-occluder="${token}"] { opacity:0!important; }`;
    (root.nodeType === 9
      ? root.head || root.documentElement
      : root
    ).appendChild(style);
    state.ownedStyles.push(style);
    state.hidden.set(el, { doc, token, previous });
  }

  function neutralizeFixedBackgrounds() {
    let visited = 0;
    for (const el of allElements(document.documentElement)) {
      if (++visited > 12000) break;
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.backgroundAttachment !== "fixed") continue;

      state.changedStyles.push({
        el,
        property: "background-attachment",
        value: el.style.getPropertyValue("background-attachment"),
        priority: el.style.getPropertyPriority("background-attachment"),
      });
      writeOwnedProperty(el, "background-attachment", "scroll");
    }
  }

  function registerOwnedScroll(
    context,
    node,
    doc,
    extra = () => true,
    read = () => ({ left: node.scrollLeft, top: node.scrollTop }),
    write = (left, top) => {
      node.scrollLeft = left;
      node.scrollTop = top;
    },
  ) {
    const existing = context.scrollRecords?.find(
      (record) => record.node === node && record.document === doc,
    );
    if (existing) return existing;
    reserveMetadata(context, 64);
    const originalRoot = node.getRootNode?.();
    const record = {
      node,
      document: doc,
      read,
      write,
      matches: () =>
        node.ownerDocument === doc &&
        (!originalRoot || node.getRootNode?.() === originalRoot) &&
        extra(),
      original: read(),
      lastOwned: read(),
      restoreOwnedScroll: null,
      restoreResult: null,
    };
    (context.scrollRecords ||= []).push(record);
    (context.scrollRollback ||= []).push(() => restoreOwnedScroll(record));
    return record;
  }
  function writeOwnedScroll(context, node, left, top) {
    node.scrollLeft = left;
    node.scrollTop = top;
    const record = context.scrollRecords?.find(
      (record) => record.node === node,
    );
    if (record) record.lastOwned = record.read();
  }
  function decideScrollOwnership(context) {
    for (const record of context.scrollRecords || []) {
      record.restoreResult = null;
      if (!record.matches()) {
        record.restoreOwnedScroll = false;
        record.restoreResult = "DOCUMENT_REPLACED";
        continue;
      }
      const current = record.read();
      record.restoreOwnedScroll =
        Math.abs(current.left - record.lastOwned.left) <= 0.5 &&
        Math.abs(current.top - record.lastOwned.top) <= 0.5;
      if (!record.restoreOwnedScroll)
        record.restoreResult = "PAGE_SCROLL_CHANGED";
    }
  }
  function restoreOwnedScroll(record) {
    if (record.restoreOwnedScroll === null) {
      const current = record.read();
      record.restoreOwnedScroll =
        record.matches() &&
        Math.abs(current.left - record.lastOwned.left) <= 0.5 &&
        Math.abs(current.top - record.lastOwned.top) <= 0.5;
    }
    if (!record.restoreOwnedScroll) return;
    if (!record.matches()) {
      record.restoreResult = "DOCUMENT_REPLACED";
      return;
    }
    record.write(record.original.left, record.original.top);
    record.lastOwned = record.read();
    record.restoreResult = "RESTORED";
  }
  function ownedClampSnapshot() {
    return (state?.scrollRecords || []).filter((record) => {
      if (!record.matches()) return false;
      const value = record.read();
      return (
        Math.abs(value.left - record.lastOwned.left) <= 0.5 &&
        Math.abs(value.top - record.lastOwned.top) <= 0.5
      );
    });
  }
  function noteRestoration(context, code) {
    if (!context) return;
    const summary = (context.restoreReport ||= {
      status: "acknowledged",
      restoredCount: 0,
      preservedPageChanges: 0,
      failedCount: 0,
      codes: [],
    });
    if (code === "RESTORED") {
      summary.restoredCount++;
      return;
    }
    if (code === "NOT_OWNED") return;
    if (code === "PAGE_STYLE_CHANGED" || code === "PAGE_SCROLL_CHANGED")
      summary.preservedPageChanges++;
    else {
      summary.status = "partial";
      summary.failedCount++;
    }
    if (!summary.codes.includes(code)) summary.codes.push(code);
  }
  async function restore(old = state) {
    if (!old)
      return {
        status: "acknowledged",
        restoredCount: 0,
        preservedPageChanges: 0,
        failedCount: 0,
        codes: [],
      };
    if (old.cancelled)
      return (
        old.restoreSummary || {
          status: "unverified",
          restoredCount: 0,
          preservedPageChanges: 0,
          failedCount: 0,
          codes: ["PORT_DISCONNECTED"],
        }
      );
    old.cancelled = true;
    old.owner.cancelled = true;
    // Decide native scroll ownership synchronously before any geometry collapse.
    for (const record of old.scrollRecords || [])
      try {
        decideScrollOwnership({ scrollRecords: [record] });
      } catch {
        record.restoreOwnedScroll = false;
        record.restoreResult = "SCROLL_RESTORE_FAILED";
      }
    if (state === old) state = null;
    const summary = (old.restoreReport ||= {
      status: "acknowledged",
      restoredCount: 0,
      preservedPageChanges: 0,
      failedCount: 0,
      codes: [],
    });
    old.restoreSummary = summary;
    const attempt = (fn, code = "STYLE_RESTORE_FAILED", count = true) => {
      try {
        fn();
        if (count) noteRestoration(old, "RESTORED");
      } catch {
        noteRestoration(old, code);
      }
    };
    for (const remove of old.listeners) attempt(remove);
    old.listeners.length = 0;
    for (const observer of old.observers) attempt(() => observer.disconnect());
    old.observers.length = 0;
    for (const style of old.ownedStyles)
      attempt(() => style.remove(), "STYLE_REMOVE_FAILED");
    old.ownedStyles.length = 0;
    for (const [el, saved] of old.hidden)
      attempt(
        () => {
          if (el.ownerDocument !== saved.doc) {
            noteRestoration(old, "DOCUMENT_REPLACED");
            return;
          }
          if (el.getAttribute("data-cfp-occluder") !== saved.token) {
            noteRestoration(old, "PAGE_STYLE_CHANGED");
            return;
          }
          if (saved.previous === null) el.removeAttribute("data-cfp-occluder");
          else el.setAttribute("data-cfp-occluder", saved.previous);
          noteRestoration(old, "RESTORED");
        },
        "STYLE_RESTORE_FAILED",
        false,
      );
    old.hidden.clear();
    for (const item of old.changedStyles)
      attempt(
        () =>
          restoreProperty(item.el, item.property, item.value, item.priority),
        "STYLE_RESTORE_FAILED",
        false,
      );
    old.changedStyles.length = 0;
    for (const undo of old.rollback.reverse())
      attempt(undo, "STYLE_RESTORE_FAILED", false);
    old.rollback.length = 0;
    for (const undo of old.scrollRollback.reverse())
      attempt(undo, "SCROLL_RESTORE_FAILED", false);
    old.scrollRollback.length = 0;
    for (const record of old.scrollRecords || [])
      noteRestoration(old, record.restoreResult || "SCROLL_RESTORE_FAILED");
    old.mappingSignature = null;
    old.expandedFrames = [];
    old.scrollRecords = [];
    old.tracked = null;
    old.provisionalCandidates?.clear();
    old.acceptedRects = [];
    old.acceptedPixelRects = [];
    old.occluders?.clear();
    summary.codes.sort();
    return summary;
  }

  const ownedWrites = new WeakMap();
  function writeOwnedProperty(el, property, value, priority = "important") {
    let records = ownedWrites.get(el);
    if (!records) {
      records = new Map();
      ownedWrites.set(el, records);
    }
    if (!records.has(property)) {
      const previousValue = el.style.getPropertyValue(property),
        previousPriority = el.style.getPropertyPriority(property);
      if (state)
        reserveMetadata(
          state,
          64 +
            new TextEncoder().encode(
              property + previousValue + previousPriority + value + priority,
            ).length,
        );
      records.set(property, {
        context: state,
        root: el.getRootNode?.(),
        document: el.ownerDocument,
        previousValue,
        previousPriority,
      });
    }
    const clamps = ownedClampSnapshot();
    el.style.setProperty(property, value, priority);
    for (const scrollRecord of clamps)
      scrollRecord.lastOwned = scrollRecord.read();
    const record = records.get(property);
    record.writtenValue = el.style.getPropertyValue(property);
    record.writtenPriority = el.style.getPropertyPriority(property);
  }
  function restoreProperty(el, property, value, priority) {
    const records = ownedWrites.get(el),
      record = records?.get(property);
    if (!record) return "NOT_OWNED";
    records.delete(property);
    let code = "RESTORED";
    if (el.ownerDocument !== record.document) code = "DOCUMENT_REPLACED";
    else if (record.root && el.getRootNode?.() !== record.root)
      code = "NODE_REPLACED";
    else if (
      el.style.getPropertyValue(property) !== record.writtenValue ||
      el.style.getPropertyPriority(property) !== record.writtenPriority
    )
      code = "PAGE_STYLE_CHANGED";
    else
      try {
        if (record.previousValue)
          el.style.setProperty(
            property,
            record.previousValue,
            record.previousPriority || "",
          );
        else el.style.removeProperty(property);
      } catch {
        code = "STYLE_RESTORE_FAILED";
      }
    noteRestoration(record.context, code);
    return code;
  }

  async function settle() {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(timer);
          resolve();
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
})();
