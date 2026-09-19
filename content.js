(() => {
  if (window.__cfpFireStyleInstalled) return;
  window.__cfpFireStyleInstalled = true;

  const STICKY_CROP = 150;
  const FIRST_VERTICAL_OVERLAP = 300;
  const VERTICAL_OVERLAP = 190;
  const HORIZONTAL_OVERLAP = 30;

  let state = null;

  chrome.runtime.onConnect.addListener(port => {
    if (!port.name.startsWith("cfp:")) return;

    const onMessage = async message => {
      if (!message || message.id == null || !message.method) return;
      try {
        let result;
        switch (message.method) {
          case "prepare":
            result = await prepare();
            break;
          case "advance":
            result = await advance();
            break;
          case "restore":
            result = await restore();
            break;
          default:
            throw new Error(`Unknown capture command: ${message.method}`);
        }
        port.postMessage({ replyTo: message.id, result });
      } catch (error) {
        port.postMessage({
          replyTo: message.id,
          error: String(error?.message || error)
        });
      }
    };

    port.onMessage.addListener(onMessage);
  });

  async function prepare() {
    if (state) await restore();

    const documentScroller = document.scrollingElement || document.documentElement;
    const documentOriginal = {
      left: documentScroller.scrollLeft,
      top: documentScroller.scrollTop
    };

    const initialDocumentWidth = Math.max(
      documentScroller.scrollWidth,
      documentScroller.clientWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
      1
    );
    const initialDocumentHeight = Math.max(
      documentScroller.scrollHeight,
      documentScroller.clientHeight,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      1
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
        top: scroller.scrollTop
      };
      const frozenNested = {
        scrollWidth: Math.max(scroller.scrollWidth, scroller.clientWidth, 1),
        scrollHeight: Math.max(scroller.scrollHeight, scroller.clientHeight, 1),
        clientWidth: Math.max(scroller.clientWidth, 1),
        clientHeight: Math.max(scroller.clientHeight, 1)
      };

      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      await settle();

      const unlock = unlockScrollableElement(scroller, frozenNested);
      await settle();

      const expandedDocumentWidth = Math.max(
        documentScroller.scrollWidth,
        document.documentElement.scrollWidth,
        document.body?.scrollWidth || 0,
        documentScroller.clientWidth,
        1
      );
      const expandedDocumentHeight = Math.max(
        documentScroller.scrollHeight,
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
        documentScroller.clientHeight,
        1
      );

      const expectedExtraY = Math.max(0, frozenNested.scrollHeight - frozenNested.clientHeight);
      const expectedExtraX = Math.max(0, frozenNested.scrollWidth - frozenNested.clientWidth);
      const growthY = Math.max(0, expandedDocumentHeight - initialDocumentHeight);
      const growthX = Math.max(0, expandedDocumentWidth - initialDocumentWidth);

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
          frozenNested
        };

        scroller = documentScroller;
        isDocument = true;

        // Allow a little layout slack, but never adopt arbitrary later growth.
        var frozenTargetHeight = Math.max(
          initialDocumentHeight,
          Math.min(expandedDocumentHeight, expectedHeight + 192)
        );
        var frozenTargetWidth = Math.max(
          initialDocumentWidth,
          Math.min(expandedDocumentWidth, expectedWidth + 64)
        );
      } else {
        unlock.restore();
        scroller.scrollLeft = nestedOriginal.left;
        scroller.scrollTop = nestedOriginal.top;
        await settle();

        var frozenTargetWidth = Math.max(scroller.scrollWidth, scroller.clientWidth, 1);
        var frozenTargetHeight = Math.max(scroller.scrollHeight, scroller.clientHeight, 1);
      }
    } else {
      var frozenTargetWidth = Math.max(scroller.scrollWidth, scroller.clientWidth, 1);
      var frozenTargetHeight = Math.max(scroller.scrollHeight, scroller.clientHeight, 1);
    }

    const originalScrollLeft = scroller.scrollLeft;
    const originalScrollTop = scroller.scrollTop;

    const captureStyle = document.createElement("style");
    captureStyle.id = "__cfp_capture_style__";
    captureStyle.textContent = `
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
        scroll-snap-type: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(captureStyle);

    state = {
      scroller,
      isDocument,
      captureStyle,
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
      frameIndex: 0
    };

    neutralizeFixedBackgrounds();

    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    await settle();

    state.currentX = scroller.scrollLeft;
    state.currentY = scroller.scrollTop;
    snapshotVisibleElements();

    return {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      targetWidth: state.targetWidth,
      targetHeight: state.targetHeight,
      scrollerType: nestedExpansion ? "expanded-nested" : (isDocument ? "document" : "element"),
      position: currentPosition(false)
    };
  }

  async function advance() {
    if (!state) throw new Error("Capture has not been initialized.");

    const { scroller } = state;
    const viewport = getViewportMetrics();
    const maxX = Math.max(0, state.targetWidth - viewport.clientWidth);
    const maxY = Math.max(0, state.targetHeight - viewport.clientHeight);

    if (state.currentX < maxX - 0.5) {
      const stepX = Math.max(1, viewport.clientWidth - HORIZONTAL_OVERLAP);
      const desiredX = Math.min(maxX, state.currentX + stepX);
      const beforeWidth = scroller.scrollWidth;

      scroller.scrollLeft = desiredX;
      await settle();

      const actualX = scroller.scrollLeft;
      const afterWidth = scroller.scrollWidth;
      if (afterWidth < beforeWidth && actualX < desiredX) {
        state.logicalOffsetX += beforeWidth - afterWidth;
      }

      const deltaX = actualX - state.currentX;
      state.currentX = actualX;
      suppressViewportAnchoredElements(true);
      state.frameIndex += 1;

      return { done: false, position: currentPosition(false) };
    }

    if (state.currentY >= maxY - 0.5) {
      return { done: true };
    }

    const first = state.firstVerticalMove;
    let stepY = viewport.clientHeight - (first ? FIRST_VERTICAL_OVERLAP : VERTICAL_OVERLAP);
    if (stepY <= 0) {
      stepY = Math.max(1, viewport.clientHeight - (first ? STICKY_CROP : 40));
    }

    const desiredY = Math.min(maxY, state.currentY + stepY);
    const beforeHeight = scroller.scrollHeight;

    scroller.scrollLeft = 0;
    scroller.scrollTop = desiredY;
    await settle();

    const actualX = scroller.scrollLeft;
    const actualY = scroller.scrollTop;
    const afterHeight = scroller.scrollHeight;

    if (afterHeight < beforeHeight && actualY < desiredY) {
      state.logicalOffsetY += beforeHeight - afterHeight;
    }

    state.currentX = actualX;
    state.currentY = actualY;
    state.firstVerticalMove = false;

    suppressViewportAnchoredElements(false);
    state.frameIndex += 1;

    return { done: false, position: currentPosition(true) };
  }

  function currentPosition(afterVerticalMove) {
    const viewport = getViewportMetrics();
    return {
      scrollX: state.currentX,
      scrollY: state.currentY,
      logicalX: state.currentX + state.logicalOffsetX,
      logicalY: state.currentY + state.logicalOffsetY,
      sourceLeft: viewport.sourceLeft,
      sourceTop: viewport.sourceTop,
      clientWidth: viewport.clientWidth,
      clientHeight: viewport.clientHeight,
      stickyCrop: state.currentY > 0 || afterVerticalMove ? STICKY_CROP : 0
    };
  }

  function getViewportMetrics() {
    const { scroller, isDocument } = state;
    if (isDocument) {
      const root = document.documentElement;
      return {
        sourceLeft: 0,
        sourceTop: 0,
        clientWidth: root.clientWidth || window.innerWidth,
        clientHeight: root.clientHeight || window.innerHeight
      };
    }

    const rect = scroller.getBoundingClientRect();
    return {
      sourceLeft: rect.left + scroller.clientLeft,
      sourceTop: rect.top + scroller.clientTop,
      clientWidth: scroller.clientWidth,
      clientHeight: scroller.clientHeight
    };
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
      if (el.scrollWidth <= el.clientWidth + 4 && el.scrollHeight <= el.clientHeight + 4) continue;

      const style = getComputedStyle(el);
      if (!isScrollableStyle(style)) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) continue;
      if (rect.width > window.innerWidth + 4 || rect.height > window.innerHeight + 60) continue;

      const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const coverage = (visibleWidth * visibleHeight) / viewportArea;
      const widthFrac = visibleWidth / Math.max(1, window.innerWidth);
      const heightFrac = visibleHeight / Math.max(1, window.innerHeight);

      if (widthFrac < 0.5 || heightFrac < 0.55) continue;
      if (docScrollable && coverage < 0.65 && el.scrollHeight < docScroller.scrollHeight * 0.75) continue;

      const overflowGain = Math.log2(1 + Math.max(
        el.scrollHeight / Math.max(1, el.clientHeight),
        el.scrollWidth / Math.max(1, el.clientWidth)
      ));
      const score = coverage * 10 + widthFrac * 2 + heightFrac * 3 + overflowGain;

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
  function unlockScrollableElement(target, frozen) {
    const saved = new Map();

    function save(el) {
      if (saved.has(el)) return;
      const props = [
        "overflow", "overflow-x", "overflow-y",
        "height", "min-height", "max-height",
        "flex-shrink", "flex-basis", "align-self",
        "position", "top", "bottom", "left", "right"
      ];
      const values = {};
      for (const prop of props) {
        values[prop] = {
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop)
        };
      }
      saved.set(el, values);
    }

    function set(el, prop, value) {
      save(el);
      el.style.setProperty(prop, value, "important");
    }

    let el = target;
    while (el && el instanceof HTMLElement) {
      save(el);
      const cs = getComputedStyle(el);

      for (const prop of ["overflow", "overflow-x", "overflow-y"]) {
        const cssName = prop;
        const jsValue =
          prop === "overflow" ? cs.overflow :
          prop === "overflow-x" ? cs.overflowX :
          cs.overflowY;
        if (["auto", "scroll", "hidden", "clip", "overlay"].includes(jsValue)) {
          set(el, cssName, "visible");
        }
      }

      if (cs.maxHeight !== "none") set(el, "max-height", "none");

      if (el === target) {
        // For absolutely-positioned virtual content, "height:auto" can collapse.
        // Force the exact pre-capture scroll height instead.
        set(el, "height", `${Math.ceil(frozen.scrollHeight)}px`);
        set(el, "min-height", `${Math.min(Math.ceil(frozen.scrollHeight), 1000000)}px`);
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

      const parent = el.parentElement;
      if (parent) {
        const parentDisplay = getComputedStyle(parent).display;
        if (parentDisplay === "flex" || parentDisplay === "inline-flex") {
          set(el, "flex-shrink", "0");
          if (cs.flexBasis !== "auto") set(el, "flex-basis", "auto");
          if (cs.alignSelf === "stretch") set(el, "align-self", "flex-start");
        } else if (parentDisplay === "grid" || parentDisplay === "inline-grid") {
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
      el = el.parentElement;
    }

    return {
      restore() {
        const entries = [...saved.entries()].reverse();
        for (const [node, props] of entries) {
          if (!node?.style) continue;
          for (const [prop, savedValue] of Object.entries(props)) {
            if (savedValue.value) {
              node.style.setProperty(prop, savedValue.value, savedValue.priority || "");
            } else {
              node.style.removeProperty(prop);
            }
          }
        }
        saved.clear();
      }
    };
  }

  function isScrollableStyle(style) {
    const values = [style.overflow, style.overflowX, style.overflowY];
    return values.some(value => value === "auto" || value === "scroll" || value === "overlay");
  }

  function isDocumentScroller(el) {
    return el === document.scrollingElement || el === document.documentElement || el === document.body;
  }

  function* allElements(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!(node instanceof Element)) continue;
      yield node;

      if (node.shadowRoot) {
        const shadowChildren = Array.from(node.shadowRoot.children);
        for (let i = shadowChildren.length - 1; i >= 0; i -= 1) stack.push(shadowChildren[i]);
      }

      const children = Array.from(node.children);
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  }

  function snapshotVisibleElements() {
    if (!state) return;
    const { scroller } = state;
    for (const el of allElements(document.documentElement)) {
      if (!(el instanceof HTMLElement) || el === scroller) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < -window.innerHeight || rect.top > window.innerHeight * 2) continue;
      state.tracked.set(el, {
        left: rect.left,
        top: rect.top,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop
      });
    }
  }

  function suppressViewportAnchoredElements(horizontal) {
    if (!state) return;
    const { scroller, isDocument } = state;
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    let visited = 0;

    for (const el of allElements(document.documentElement)) {
      if (++visited > 12000) break;
      if (!(el instanceof HTMLElement) || el === scroller) continue;
      if (state.hidden.has(el)) continue;

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      if (style.position === "fixed" && rect.width * rect.height < viewportArea * 0.6) {
        hideElement(el);
        continue;
      }

      const prev = state.tracked.get(el);
      state.tracked.set(el, {
        left: rect.left,
        top: rect.top,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop
      });

      if (!prev) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.width * rect.height > viewportArea * 0.35) continue;

      const scrollDx = scroller.scrollLeft - prev.scrollLeft;
      const scrollDy = scroller.scrollTop - prev.scrollTop;
      const movedX = rect.left - prev.left;
      const movedY = rect.top - prev.top;

      const anchored = horizontal
        ? Math.abs(scrollDx) > 5 && Math.abs(movedX) < Math.abs(scrollDx) / 2
        : Math.abs(scrollDy) > 5 && Math.abs(movedY) < Math.abs(scrollDy) / 2;

      if (!anchored) continue;

      if (!isDocument) {
        if (el.contains(scroller)) continue;
        if (scroller.contains(el) && rect.width * rect.height > viewportArea * 0.25) continue;
      }

      if (hasHiddenAncestor(el)) continue;
      hideElement(el);
    }
  }

  function hasHiddenAncestor(el) {
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return true;
      p = p.parentElement;
    }
    return false;
  }

  function hideElement(el) {
    if (state.hidden.has(el)) return;
    state.hidden.set(el, {
      opacity: el.style.getPropertyValue("opacity"),
      opacityPriority: el.style.getPropertyPriority("opacity"),
      animation: el.style.getPropertyValue("animation"),
      animationPriority: el.style.getPropertyPriority("animation"),
      transitionDuration: el.style.getPropertyValue("transition-duration"),
      transitionPriority: el.style.getPropertyPriority("transition-duration")
    });
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("animation", "none", "important");
    el.style.setProperty("transition-duration", "0s", "important");
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
        priority: el.style.getPropertyPriority("background-attachment")
      });
      el.style.setProperty("background-attachment", "scroll", "important");
    }
  }

  async function restore() {
    if (!state) return true;
    const old = state;
    state = null;

    for (const [el, saved] of old.hidden) {
      restoreProperty(el, "opacity", saved.opacity, saved.opacityPriority);
      restoreProperty(el, "animation", saved.animation, saved.animationPriority);
      restoreProperty(el, "transition-duration", saved.transitionDuration, saved.transitionPriority);
    }

    for (const item of old.changedStyles) {
      restoreProperty(item.el, item.property, item.value, item.priority);
    }

    old.captureStyle?.remove();

    if (old.nestedExpansion) {
      // Collapse the app back to its original layout first, then restore both
      // the inner scroller and document positions.
      old.nestedExpansion.restoreStyles();
      old.nestedExpansion.element.scrollLeft = old.nestedExpansion.original.left;
      old.nestedExpansion.element.scrollTop = old.nestedExpansion.original.top;
      old.documentScroller.scrollLeft = old.documentOriginal.left;
      old.documentScroller.scrollTop = old.documentOriginal.top;
    } else {
      old.scroller.scrollLeft = old.originalScrollLeft;
      old.scroller.scrollTop = old.originalScrollTop;
    }

    await settle();
    return true;
  }

  function restoreProperty(el, property, value, priority) {
    if (!el?.style) return;
    if (value) el.style.setProperty(property, value, priority || "");
    else el.style.removeProperty(property);
  }

  async function settle() {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 120));
  }
})();
