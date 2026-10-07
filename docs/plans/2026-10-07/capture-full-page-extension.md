# Capture Full Page: mechanical implementation contract

Repository: OhOkThisIsFine/capture-full-page-extension
Pinned baseline: ee790c62eb9b8e1d14587d8921dc8184e59aefc8
Contract date: 2026-10-06
Source version: 5.3.0
Purpose: make the seven delivered work packages implementable without another design pass.

## Scope, evidence and readiness

This is a separate implementation contract. The delivered seven-package plan is unchanged. This contract inspected the complete pinned content script, worker, compositor, manifests, popup, build/publish scripts, workflows, existing tests, fixtures and release guides. It also checked the official platform references linked below. No product tests, captures, extension changes, builds, installations, CI changes, repository writes, store operations or user-computer work were performed. The only local writes are this report and read-only source-evidence copies. Statements about existing tests describe their source, not a new passing run.

The installed extension, live store versions, private-access settings, protected environments, branch/tag protections and release-account configuration remain unknown. Source 5.3.0 is not evidence of any of those states. Chrome 116 and Firefox 126 are source/API compatibility floors, not a recommendation to use security-obsolete browsers. Use a current security-supported desktop browser for normal execution. Any floor-version qualification below is an isolated, offline/synthetic compatibility exercise.

Retain these product decisions:
- Ordinary supported captures automatically initiate one PNG download using saveAs:false and conflictAction:"uniquify".
- No extension-added preview approval, Save button, chooser, telemetry, broad host permission, storage permission, persistent pixel cache, disk-backed encoder or new split-incognito architecture.
- Keep Chrome service worker plus offscreen document, and Firefox shared nonpersistent background-document compositor.
- Bound capture to a frozen page/target boundary. Do not chase infinite growth.
- Scope unsupported/private/mapping failures to the affected branch. A private-path qualification failure must not disable ordinary captures.
- Live pages are sampled over time. Geometry checks cannot make arbitrary DOM, video, canvas, scripted animation or away-and-back mutations atomic. Do not advertise temporal atomicity.

Readiness terms:
- Mechanical-ready: source choices, helper contracts, edits and oracles are specified. Implementation still must pass its listed tests.
- Needs-source-resolution: a specifically named source fact remains unresolved. Do only that named lookup; do not redesign surrounding work.
- Execution-or-owner-gated: source code can be prepared, but a listed isolated qualification or owner-controlled setting is needed before enabling/releasing that branch.

Package grades:
1. Mechanical-ready for traversal, geometry guards, CSS-controlled motion preservation and baseline-preserving live-motion handling. Runtime gate Q1 applies to supported pixel/animation cases.
2. Mechanical-ready for child-viewport iframe sizing and validated preserve-layout fallback. Runtime gate Q2 applies to expansion/mapping classes, not unrelated pages.
3. Source-contract revised for one-stream IDAT encoding, cumulative cancellation and phase-peak/pending-disposal accounting after CD1–CD6; the bounded independent CD1–CD6 source-contract recheck passed. Q3 remains execution-gated; numerical budgets are unmeasured policy, not browser-RSS proof.
4. Execution-or-owner-gated for browser-private delivery and real background-loss recovery. One-shot invocation, armed-output cleanup, exact envelopes and expiry/tombstone ownership passed the bounded independent CD1–CD6 source recheck. No persistent recovery is selected.
5. Mechanical-ready for status, sender validation and offscreen serialization. Actual browser close/start fault significance is unproven; Q5 tests recovery without asserting an existing harmful race.
6. Mechanical-ready for harness/fixture edits; packaged-browser, signed-update and supported-baseline evidence are execution-or-owner-gated.
7. Mechanical-ready for immediate test-chain correction, deterministic archive code and release graph; toolchain runtime qualification, generated lock resolution and external protections are execution-or-owner-gated. The exact choices below remove design discretion; do not fabricate missing lock integrities or a qualified runtime image.

There is no whole-roadmap prerequisite. Each package can land with its local regressions. Publishing a release requires the relevant packaged-browser evidence for the changed paths. A failed optional/private branch does not prevent a safe ordinary-capture release if that branch is explicitly disabled and the limitation is accurately documented.

## Pinned source map

All following locations refer to this exact commit, including new-file instructions whose insertion anchors are these old locations.

- [S1: content.js, ownership/prepare](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/content.js#L13-L278): serialized port commands, owner rollback, strategy preparation.
- [S2: content.js, traversal/metrics](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/content.js#L280-L410): advance, verticalGeometry, currentPosition, getViewportMetrics.
- [S3: content.js, detector/unlock](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/content.js#L413-L589).
- [S4: content.js, capture styles/iframes](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/content.js#L591-L743).
- [S5: content.js, discovery/hiding/restore](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/content.js#L754-L921).
- [S6: worker, entry/operation](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/service-worker.js#L1-L127).
- [S7: worker, full capture/download](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/service-worker.js#L129-L274).
- [S8: worker, RPC/capture retry](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/service-worker.js#L276-L378).
- [S9: worker, compositor/lifecycle](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/service-worker.js#L380-L476).
- [S10: offscreen.js, dispatch/session/frame](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/offscreen.js#L1-L173).
- [S11: offscreen.js, tiles/finish/coverage](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/offscreen.js#L175-L341).
- [S12: offscreen.js, cleanup/encoding](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/offscreen.js#L343-L487).
- [S13: offscreen.js, retained URL/shared route](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/offscreen.js#L490-L517).
- [S14: Chrome manifest](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/manifest.json#L1-L32), [Firefox manifest](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/manifest.firefox.json#L1-L44), [offscreen.html](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/offscreen.html#L1-L5).
- [S15: popup.js](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/popup.js#L1-L21), [popup.html](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/popup.html#L9-L17), [popup.css](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/popup.css#L53-L63).
- [S16: existing VM tests](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/tests/reliability.test.cjs#L1-L175).
- [S17: browser layout tests](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/tests/browser-layout.cjs#L1-L96), [PNG tests](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/tests/browser-png.cjs#L1-L58).
- [S18: test limitations/manual checks](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/tests/README.md#L5-L101).
- [S19: build.py](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/scripts/build.py#L13-L142).
- [S20: build workflow](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/.github/workflows/build-extension.yml#L1-L49), [publisher workflow](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/.github/workflows/publish-stores.yml#L1-L192).
- [S21: Chrome publishing script](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/scripts/publish_chrome.sh#L1-L87).
- [S22: existing app-shell fixture](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/tests/fixtures/app-shell.html#L7-L66), [shrinking-scroller fixture](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/ee790c62eb9b8e1d14587d8921dc8184e59aefc8/tests/fixtures/shrinking-scroller.html#L7-L41).

## Shared implementation seam, owned by package 1

Add one dependency-free classic script, capture-protocol.js, containing frozen constants and pure validation/traversal helpers under globalThis.__cfpProtocol. This is a shared helper inside the existing three-context architecture, not a bundler, RPC framework, service or new execution context.

Required public helper signatures:
- makeTraversal(prep) -> {planId, width, height, viewportWidth, viewportHeight, maxX, maxY, estimatedFrames}
- nextFrameSpec(plan, previousAcceptedSpec|null) -> FrameSpec|null
- assertFiniteGeometry(value, fieldName, {positive=false, maximum}) -> number
- validateSnapshot(plan, spec, snapshot) -> {ok, code, retryable}
- frameRect(prep, position, bitmapWidth, bitmapHeight) -> {sx, sy, sw, sh, dx, dy}
- errorResult(code, message) -> {ok:false, code, error:message}

makeTraversal consumes prep.planId, created once by content preparation, and recomputes all dimensions/steps independently; it does not mint a different planId in each context. Protocol version is the integer 1. Operation/session/plan/document/intent/request tokens are distinct crypto.randomUUID() values. Token strings use the bounded UUID-shaped contract; requestId is a fresh UUID for compositor calls. All numeric inputs must be finite; frame/row/column indices and download IDs are nonnegative safe integers, including zero; sizes are strictly positive.

### Exact compositor envelopes and authority (CD3 integration)

Replace the blanket requirement that all messages have operation/session IDs with these two classes:

- Operation/output request: {target:"cfp-offscreen",type,protocolVersion:1,requestId,operationId,sessionId,owner,...payload}. owner is the immutable creator-owner of that capture/output. The valid response echoes target, type, protocolVersion, requestId, operationId, sessionId and owner, then {ok:true,...result} or {ok:false,code,error}. Frame success also echoes acceptedSequence. Finish and every download-arm/bind/update/release require intentId, echoed in their response.
- Context request: {target:"cfp-offscreen",type:"status"|"download-list",protocolVersion:1,requestId,requesterOwner}. The response echoes those fields and returns {ok,contextId,lifecycleGeneration,...result}. Do not mint fake operation/session identities to query an idle compositor. Every list entry carries its immutable creator-owner, operationId, sessionId and intentId.
- Context notifications: idle uses {target:"cfp-worker",type:"offscreen-idle",protocolVersion:1,requestId,requesterOwner,contextId,lifecycleGeneration,idle:true}; reconciliation uses the same context identity with type:"download-reconcile-needed", intentIds:[boundedExactIntentIds] and reason:"periodic"|"expiry". Worker responses echo the context envelope plus {ok:true,queued:true}; they acknowledge scheduling, not completed search. The compositor uses the latest authenticated worker requesterOwner previously recorded by status/download-list/start. If no worker has been registered, do not send an unsolicited idle notification. The worker validates the offscreen sender and matching context/generation before requesting closure; an old requesterOwner notification can trigger a fresh status query but never directly close a current context.
- A malformed request cannot supply a valid identity to echo. Return only {target:"cfp-offscreen",type:"protocol-error",protocolVersion:1,requestId:validatedRequestIdOrNull,ok:false,code:"INVALID_ENVELOPE",error:sanitizedText}; allocate/mutate nothing. A caller rejects this as failure, never as another operation's response.

Payload inventory, used identically by Chrome runtime and Firefox direct routing:
- start: {prep,captureContext:{targetBrowser,tabId,windowId,incognito},deadlines:{operationExpiresAt,captureExpiresAt,encodeBudgetMs},budget:{operationEnvelopeBytes,maxOutputBytes,observedLedgerRevision}}. The absolute finite deadlines have already been capped by the worker's cumulative policy. The compositor recalculates available capacity; stale admission evidence cannot authorize overcommit.
- frame: {spec,preSnapshot,postSnapshot,dataUrl}; expected identity and accepted sequence belong to the current session.
- finish: {intentId}; the same UUID was minted once by the worker before invoking finish. Success returns {intentId,url,width,height,byteLength,revision,sourceState:"encoded"} plus the full echoed envelope.
- abort: {reason, intentId?}; cancels the exact active capture session; it can discard its exact unarmed encoded output, but never armed/bound/uncertain output.
- download-arm: {intentId,url,byteLength,targetBrowser,tabId,windowId,incognito}. These values must match the already encoded ledger entry and the trusted capture's immutable context. Success returns current revision and source/initiation states.
- download-bind: {intentId,downloadId,expectedRevision,basis:"api-result"|"exact-item",item?}. api-result is the single observed native invocation's valid result; exact-item includes a validated matching DownloadItem. An existing different ID is never replaced.
- download-update: {intentId,expectedRevision,item:{id,url,incognito,byExtensionId?,state,paused,canResume?}}. Apply only exact matching evidence to a still-matching revision; conflict returns REVISION_CHANGED for re-read/reconciliation, not a blind overwrite.
- download-release: {intentId,expectedRevision,reason:"DISCARDED_UNARMED"|"CANCELLED_BEFORE_INITIATION"|"DOWNLOAD_COMPLETE"|"DOWNLOAD_INTERRUPTED_FINAL"|"SOURCE_EXPIRED"}. Ledger preconditions in package 4 govern each reason. The command never accepts an arbitrary raw URL for revocation.
- status: returns idle, retainedUrlCount/Bytes, pendingDisposalBytes, ledgerRevision and lifecycleGeneration, plus worker-only owned status references. Public popup state is a separately sanitized worker projection.
- download-list: returns the bounded ledger/tombstone entries with revision and exact identities for authenticated worker reconciliation, never to page/popup consumers.

callCompositor(scope,type,payload) is the single production request constructor and response checker. scope is a live local capture operation, an exact returned output record for recovery, or the current worker context. Replace S9's start-only owner insertion. Reject mismatched request/protocol/type/operation/session/owner/intent fields before consuming a URL or changing accepted counters. Context calls verify requesterOwner and the returned context/generation. A returned output record authorizes exact reconciliation, not ownership of an old active capture or proof that an old invocation never happened.

Runtime sender authentication is independent of claimed owner values. The Firefox shared route exposes an explicit trusted-background entry function which invokes the same payload/identity validator; do not invent permissive sender objects or bypass validation in the direct route. Production popup code has no access to this entry function and receives only sanitized worker state. Tests may exercise the actual trusted entry in their own VM/page-evaluation harness; they may not relax the production runtime sender allowlist.

At compositor entry, frame/finish synchronously claim a per-session busy token before the first await. A second frame or finish receives SESSION_BUSY without mutation. Abort bypasses the busy token. Finally clears only the same token. After every await and immediately before accepted-frame increment or savedTiles insertion, recheck the live session object, immutable identity and cancellation. source.disposed additionally blocks a late scanline pull/decode/enqueue. Successful disposal of the completed scanline source is not session cancellation: at output insertion validate the live session, deadline and successful encodedBlobPendingHandoff lease instead of requiring an already-consumed source to remain undisposed. Never treat a claimed owner on a non-start message as authority to replace the current owner.

Content port schema remains port-local rather than using compositor request UUIDs: request {id,method,protocolVersion:1,operationId,sessionId,owner,payload}; response {replyTo:id,protocolVersion:1,operationId,sessionId,owner,result} or the same identity plus {code,error}. id is a positive per-port safe-integer sequence. createPortRPC checks all bound identity fields before settling. close sets its closed flag before removing listeners/timers and settles pending exactly once. A synchronous port.postMessage throw uses the same settlePending helper, removing the timer/map entry immediately. A stale/wrong-identity reply cannot settle another request.

Load-order edits are part of the same atomic patch:
1. Chrome service-worker.js conditionally imports capture-protocol.js at startup using importScripts before listener registration. A Firefox background document already has the global and must not execute importScripts.
2. Chrome offscreen.html loads capture-protocol.js, then offscreen.js.
3. Firefox manifest.background.scripts becomes exactly ["capture-protocol.js", "offscreen.js", "service-worker.js"].
4. Worker injection changes files:["content.js"] to files:["capture-protocol.js","content.js"]. Each helper installation is idempotent for protocol 1.
5. scripts/build.py COMMON_FILES adds capture-protocol.js. Its Firefox order validation changes to the exact list above.
6. Existing VM and browser source harnesses read/evaluate the helper before content/compositor scripts. Do not create a separate test implementation of production math.
7. Workflow syntax checks include capture-protocol.js.

Runtime permissions, Chrome minimum_chrome_version:"116", Gecko ID and source version remain unchanged in packages 1–6. No npm/runtime dependency is added by the helper. If protocol load fails, fail that operation visibly before mutation rather than silently reverting to unbound frames.

## Package 1: live geometry, ordered frames and visible-content preservation

### Existing behavior and precise edits

S2 currentPosition reads state.currentX/currentY cached after the last commanded scroll; it is not a live pre/post capture snapshot. S7 sends those cached coordinates directly to addFrame. S10 initializes scale only on the first bitmap. S11 getTile can create a new active tile for an index already saved, and lastDestY records a maximum without rejecting backwards input. Fix these facts; do not describe them as a reproduced corrupt screenshot.

Replace the S7 frame loop with an authoritative worker traversal. Preserve row-major order and the existing overlap values: horizontal 30 CSS px; first vertical overlap min(300, floor(H/2)+1); later vertical overlap min(190, floor(H/2)+1); positive stride max(1,H-overlap). Set stickyCrop to zero in the new supported path once genuine occluders have been handled as below; do not discard an arbitrary 150-pixel strip. Keep overlap for edge coverage. The last column/row clamps to max(0,frozenSize-viewportSize), never past it. Deduplicate a clamped last position. There is one initial frame at (0,0), then ascending X, then the next Y with X reset to zero. Traversal coordinates never derive from an unexpected observed scroll.

FrameSpec fields: planId, sequence, row, column, logicalX, logicalY, sourceLeft, sourceTop, clientWidth, clientHeight, stickyCrop:0. makeTraversal calculates estimatedFrames with the same lazy stepping algorithm, stopping at MAX_CAPTURE_FRAMES+1; it must not allocate a potentially huge grid. nextFrameSpec is the sole production source of traversal math. Content and compositor consume it; neither invents its own next row.

Refactor content advance into moveTo(context,spec); keep a small advance wrapper for existing direct harnesses only until they are migrated, and then remove that wrapper. RPC methods become prepare, position, snapshot, restore, cancel. position receives the exact FrameSpec and session identity. It validates the frozen plan, scrolls to that commanded position, waits with the existing bounded settle mechanism, handles verified fixed/sticky occluders, and returns a live snapshot. snapshot never scrolls.

Snapshot fields:
- documentNonce fixed for this injected document; owner/session/plan IDs
- frame sequence and current geometryGeneration
- live nativeScrollLeft/nativeScrollTop; normalized logicalX/logicalY
- live innerWidth/innerHeight, layout-viewport width/height, target scroll extents
- live sourceLeft/sourceTop/clientWidth/clientHeight
- devicePixelRatio and visualViewport scale/offsets when available
- scrollEpoch and geometryEpoch counters
- warning codes only, never page text

Install passive scroll listeners on the selected scroller/window, resize listeners on window and visualViewport, and a ResizeObserver on the scroller and document viewport root. Counters increment on observed events; snapshot also compares live metrics against the prepared signature synchronously, so it does not rely on observer delivery alone. Ignore only extension-owned command movements before the pre-snapshot is taken; any delivered scroll event between pre/post snapshots invalidates that acquisition. Detecting every away-and-back mutation is impossible; the tests must state whether their injected event was observable.

Measurement helpers in content.js:
- measureDocument(doc) -> {scroller, viewportWidth, viewportHeight, scrollWidth, scrollHeight, direction}; use document.scrollingElement when non-null, with a window-scroll route if quirks mode supplies no scrollingElement.
- measureViewport(context) -> {sourceLeft,sourceTop,clientWidth,clientHeight}; standards viewport dimensions come from documentElement.clientWidth/clientHeight, quirks dimensions from body.clientWidth/clientHeight, with finite positive window fallbacks.
- readLogicalScroll(context) -> {nativeX,nativeY,logicalX,logicalY}; writeLogicalScroll(context,x,y) -> void.
- In supported horizontal-tb RTL negative-scroll coordinates, logical X is rawScrollLeft+(scrollWidth-clientWidth); writing is logicalX-(scrollWidth-clientWidth). LTR uses rawScrollLeft. Use the current physical scroll range for this translation so later growth cannot shift the output coordinate origin silently; if the RTL range changes after freezing, abort the operation with GEOMETRY_CHANGED.
- Reject unsupported writing modes, transformed capture targets/ancestors and nontrivial pinch-zoom mapping only for those targets. Browser page zoom is allowed when stable and actual decoded bitmap dimensions agree. Preserve original native scroll values for rollback, not normalized values.
- [CSSOM View](https://drafts.csswg.org/cssom-view/#dom-element-clientwidth) defines the standards/quirks viewport distinction. The runtime fixture Q1 verifies the selected supported mappings rather than adding an untested legacy RTL normalization branch.

Worker acquisition algorithm, in this exact order:
1. Check operation cancellation/deadline and original active tab/window.
2. Send position(spec) for the intended frame; require document/session/plan identity and stable frozen viewport.
3. Request snapshot(spec) immediately before capture. Validate it against the commanded spec, not only against another snapshot.
4. Acquire through the single throttled captureVisible attempt gate. Every actual captureVisibleTab invocation is separated from the previous invocation start by at least 560 ms, including retries and failed attempts. Remove the separate post-advance delay so there is one authority for throttling.
5. Check original active tab/window again; request the post-snapshot.
6. Require pre and post each to match the intended token/coordinates and frozen crop/viewport; require unchanged geometryGeneration, documentNonce, epochs, DPR and visualViewport fields. Coordinate tolerance is <=0.5 CSS px, while integer dimensions and generation/identity values match exactly. If a nominally allowed offset would map to different device-pixel placement after scale is known, reject that frame.
7. On a scroll-only mismatch, discard the data URL without calling the compositor, reposition to the same spec and retry at most twice (three acquisition attempts total for the spec). A resize, document replacement, crop/scale change or changed frozen physical mapping is nonretryable. Capture API transient errors get at most five calls, each through the same throttle, within the cumulative deadline; they do not increment accepted-frame counts.
8. Send the validated frame once, carrying spec, pre/post snapshots, owner and the exact data URL. A compositor RPC timeout is ambiguous; cancel/abort this operation rather than replaying a frame whose acceptance is unknown.
9. Advance acceptedCount and the authoritative previousAcceptedSpec only after a matching compositor acknowledgment. No failed or rejected capture increments acceptedCount.

Compositor edits at S10/S11:
- Add validateFrameEnvelope(session,message) before fetch/decode. Require matching owner, IDs, expected next sequence and spec. Both snapshots must validate against the frozen prep and spec.
- Store firstBitmapWidth/firstBitmapHeight when initializing geometry. Every later decoded bitmap must match both exactly; do not reuse old ratio on a differently sized bitmap.
- Reject non-PNG data URLs, lengths above Q3 frame-input budget and nonfinite/out-of-bounds geometry before expensive work.
- Retain the existing rounding convention as the initial implementation: source offsets and CSS widths/heights rounded at actual ratio, logical destination rounded, output dimensions floored. frameRect centralizes this convention. Reject a crop that extends outside the decoded bitmap instead of clamping a negative source origin into a plausible image. Right/bottom output clipping is allowed only against the frozen output edge.
- Add lastAcceptedSpec and finalizedThroughIndex=-1. Enforce row-major sequence before any canvas mutation.
- finalizeTilesBefore may finalize only indices strictly below floor(nextAcceptedDestY/tileHeight), after the preceding horizontal sweep has completed. Validate that tile's full coverage before convertToBlob. Update finalizedThroughIndex monotonically only after successful finalization.
- getTile throws FINALIZED_REGION_REVISIT whenever index<=finalizedThroughIndex or savedTiles.has(index). Never overwrite savedTiles for an existing index. A failed finalize or draw cancels the session; do not continue with partially mutated coverage.
- finish requires all planned frames accepted, all expected tile indices present and validateTileCoverage passing. Keep the existing coverage validator as an independent final check, not an excuse to accept stale geometry.
- Close every decoded bitmap in finally, including one whose decode resolves after cancellation.

### Motion, occlusion and restoration choices

At S4 installCaptureStyles replace animation:none with animation-play-state:paused!important for elements and ::before/::after. Remove transition:none; canceling a transition jumps its visible state. Retain scroll-behavior:auto and scroll-snap-type:none. Add equivalent owned style elements to discovered open shadow roots and accessible same-origin documents, using each root's ownerDocument. Each exact style node is retained and removed on rollback. Do not alter page style sheets.

Do not call CSSAnimation.pause(), play(), cancel(), finish() or commitStyles(). The [CSS Animations specification](https://drafts.csswg.org/css-animations-2/#animations) explains why successful play/pause calls can override later CSS play-state control. Script-controlled CSS effects may ignore the rule. This contract deliberately leaves scripted Animation and CSSTransition objects untouched, including already-paused, pending and finished effects. Classify them for a bounded LIVE_MOTION warning only. No new strict-motion mode is introduced. Unrelated or offscreen scripted animation does not fail ordinary capture. A running effect affecting actual captured geometry is handled by the same snapshot invalidation rule; pixel-only motion remains a documented temporal limitation.

Add discoverCaptureRoots(context,budget), installPauseStyle(root,context), classifyLiveEffects(root,visibleRect) and restoreOwnedStyles(context). Deduplicate roots with WeakSet, effects with WeakSet, and style records by identity. Include pseudo-element CSS effects in getAnimations({subtree:true}) where the platform exposes them; use accessible shadow-root discovery rather than assuming document.getAnimations covers every root. Never await animation.finished. New open roots/documents discovered before a frame receive the same owned rule within the shared discovery budget. Closed shadows and inaccessible frame internals remain uncontrolled.

At S5 remove the motion-only anchored-element heuristic for ordinary descendants entirely. A recycled virtual row is not sticky merely because its viewport position stays constant. Only computed position:fixed or position:sticky candidates may be suppressed, and never the capture target or an ancestor containing it. A sticky candidate is suppressed after it has been represented at its natural captured position, not before its first representation. For a fixed candidate, retain its first-frame visible appearance, then suppress repeat appearances using an owned opacity:0!important rule and verify its computed visibility. Keep its layout space. Do not set animation:none or transition-duration:0. If an active transition prevents the owned opacity rule from taking effect, preserve the page state, mark that affected candidate unresolved and refuse a frame only when its repeated occlusion blocks the required captured strip. Do not globally reject unrelated motion.

A hard limitation remains: an overlay may cover content even in the original viewport. This is not solved by a geometric coverage rectangle. The acceptance fixture includes normal-flow sticky headers and fixed headers with a reserved layout gap. Define the supported first-viewport image as the pixels visible in that viewport; do not promise to reveal content already covered at those same output coordinates. For subsequent frames, intersect every unresolved known occluder's source rectangle with the frame's newly required output strip (subtract the already accepted coverage rectangles). A nonempty intersection returns UNSUPPORTED_OCCLUSION with no PNG. This geometric rule is the production guard; it does not inspect or infer semantic fixture markers. Fixture markers below an original header must still appear at their correct coordinates. Do not silently declare a pixel rectangle complete merely because an opaque overlay was drawn. General arbitrary-overlay recovery is not selected.

Own style changes with {node,document,property,previousValue,previousPriority,writtenValue,writtenPriority}. Restore only while node.ownerDocument is still the same and current inline value/priority still equal the written pair; preserve subsequent page changes. Prefer removable selector/style rules for pause/opacity so page-owned inline style is never rewritten. Existing expansion and background-attachment writes must use the same compare-before-restore convention. Remove observers/listeners and owned style nodes on all exits. Keep rollback synchronous through its actual mutations; return a restoration summary with acknowledged/partial/failed fields instead of returning true after swallowed failures.

### Ordered patch and tests

Order: shared helper/load-order patch; live measurement and position/snapshot RPC; worker acceptance/throttle; compositor ordering/bitmap checks; CSS/occluder changes; restoration ownership; tests/docs. Do not land only the worker half of protocol 1.

Existing targets to retain and extend:
- node --test tests/*.test.cjs, specifically the existing short-viewport/rounded-coverage test at S16 L45–58, actual compositor/horizontal-columns test L126–144, old-preparation ownership test L30–44, late decode/owner recovery test L94–110 and aborted tile test L117–124.
- node tests/browser-layout.cjs and node tests/browser-png.cjs are existing optional direct-function targets; update their helper injection and position calls. They still do not establish activeTab or downloads.

Add tests/frame-contract.test.cjs using actual worker/compositor dispatchers from package 6's reusable harness as soon as available; a package-local minimal dispatcher harness may land first and is then reused, not duplicated. Required named cases: "pre/post equal at wrong command is rejected"; "backwards after finalized tile is rejected without recreating it"; "jump forward never finalizes missing coverage"; "second bitmap scale change closes bitmap and rejects"; "rejected snapshots do not advance accepted sequence"; "capture API and geometry retries share throttle"; "stale document nonce rejects"; "transport timeout never replays accepted frame". Inject controlled snapshot/bitmap gates; count drawImage, convertToBlob, acceptedCount, URL creation and capture invocation times.

Add tests/fixtures/frame-coordinates.html: deterministic opaque 2D canvas at a specified document size, color(x,y)=[x%251,y%251,(floor(x/251)+floor(y/251))%251,255], with separate unique boundary sentinels. For direct browser harnesses render the canvas 1:1 at scale 1; later fractional cases use expected physical-coordinate mapping and sample interior marker pixels, not anti-aliased text. Add standards/quirks and LTR/RTL variants.

Add tests/fixtures/animation-states.html with:
- CSS running, CSS paused, completed fill-forwards, pseudo-element and open-shadow animations
- a CSS animation already controlled with WAAPI, a scripted Animation, a transition and a scroll-triggered effect
- controls changing animation-play-state after restore
- creation/removal/replacement of effects and roots while capture is in progress
- fixed/sticky headers of 80 and 350 px, a fixed header with reserved gap, and an explicitly unsupported covering overlay
- delayed image/font layout change gates

Q1 isolated gate: use each exact candidate browser with synthetic pages only, compare decoded marker coordinates and before/after inline values, owned-node count, original scroll and CSS control behavior after success, disconnect and prepare failure. Allowed outcomes for invalid geometry/unsupported occlusion are a visible typed failure and zero download/URL. For unaffected scripted effects, capture continues with LIVE_MOTION, no .play/.pause calls and no fabricated static-state assertion. Chrome 116 compatibility runs must not use ReadableStream async iteration, scheduler.yield or hasDocument. Failure in a specific mapping/effect case disables only that unsupported branch and gets a documented limitation.

Rollback: revert protocol consumers, manifest/load-order/build changes and helper together. If only motion logic fails Q1, roll back that narrow motion patch, not the geometry guards. Do not restore the stale-geometry acceptance path as a fallback. Release blocked only for the specific enabled path whose oracle fails.

## Package 2: iframe viewport sizing and nested-scroller strategy

### Source decisions and exact helpers

At S4 L689–703, needsWidth/needsHeight compare child content with el.clientWidth/clientHeight; those outer values include iframe padding and can conceal child-viewport overflow. Keep the existing border-box decoration addition, but compare against the actual child viewport first.

Add in content.js:
- measureFrame(frame, expectedDocument) -> {document,root,viewportWidth,viewportHeight,requiredWidth,requiredHeight,paddingX,paddingY,borderX,borderY,boxSizing}
- expandedFrameCssSize(measurement) -> {width,height}
- expandFrame(frame,context,budget) -> Promise<{changed,document,stable,warning}>
- validateExposedTarget(target,frozen,context) -> {ok,reason,bounds}
- prepareStrategy(owner,{strategy:"auto"|"preserve",targetElement?}) -> Promise<Prep>
- restoreStrategy(context) -> synchronous restoration summary, shared by restore

measureFrame uses frame.contentWindow.innerWidth/innerHeight and the child document viewport helper from package 1, not el.clientWidth/clientHeight. Required dimensions are max(child scroll extents, child viewport, 1); the iframe's outer padding is not child content. On content-box, CSS width/height equals ceil(required child viewport). On border-box, add both paddings and borders to that number. Set max-width/max-height:none only for changed axes. Record owned property writes before applying any change. Ignore inaccessible child DOM and return a viewport-only warning; do not inject into cross-origin frames.

Run at most three read/write/settle/remeasure passes per same-origin frame, each within package 3's preparation deadline. All needed geometry reads for a pass precede its writes. After each settle require:
1. The same frame element and child Document identity.
2. Actual child viewport >= frozen required child extents on both axes, within 0.5 CSS px.
3. Responsive reflow has stabilized: two consecutive measurement signatures agree within 0.5 CSS px; later signatures may increase the required initial-preparation bound only within the three-pass/resource limit.
4. Target/ancestor clipping and transformed geometry remain supported.
5. Updated output size/frame estimate still fits the resource budget.

If the child navigates, cancel that frame's expansion, restore owned outer iframe styles where still owned, and do not change the replacement child document's scroll. If a frame cannot reach stability in three passes, restore it and return IFRAME_VIEWPORT_ONLY in the capture warnings; do not label its offscreen contents complete. If its unstable geometry changes the enclosing capture boundary after freezing, fail that operation. Nested-frame recursion is not added.

### Nested strategy selection, without mixed geometries

Keep auto expansion for ordinary static app shells. Replace S1 L145–182 growth-percentage thresholds: document growth alone is not evidence that the target's content is exposed.

After the existing target/ancestor unlock:
- The selected target's expanded client/scroll dimensions and visible content bounds must cover its pre-expansion frozen width/height.
- Walk the target's ancestor chain and require no remaining overflow clip/hidden/scroll boundary that cuts the needed expanded rectangle. Any transform, perspective, non-unit CSS zoom, clip-path, mask or layout/paint containment affecting the mapping makes this expansion unqualified.
- For candidate virtual lists, inspect rendered leaf bounds rather than a large empty spacer box: text-bearing leaf/replaced elements determine the occupied envelope; absolute/translated/recycled rows or a resize that leaves occupied content confined to the original viewport select preserve-layout. A canvas/spacer envelope is not proof of semantic row completeness. Do not claim this structural check detects every virtualizer.
- The expanded target's right/bottom content bounds must fit inside the document's reachable frozen output. Clamp only to the original finite target extent plus measured shell bounds, not arbitrary subsequent lazy growth.
- Static app-shell acceptance remains governed by the numbered-row/edge-marker fixture, not a guessed document-growth percentage.

If expansion is unqualified, synchronously restore all expansion/style/iframe/scroll changes for that attempt, detach its observers and discard its Prep. Only then prepare the same originally selected target with strategy:"preserve". Normally no compositor exists before strategy selection, so nothing needs aborting. If late expansion validation fails after a compositor was started but before completion, abort and await that session's disposal, restore the page, then begin a new sessionId/planId/document-preparation context. There is at most one automatic strategy switch per user operation. Never add preserve-layout frames to the expansion session.

In preserve-layout:
- Do not expand the target, its ancestors or its iframes.
- Freeze its original scrollWidth/scrollHeight. Scroll only that target with the package 1 logical-coordinate adapter.
- Use the content viewport rectangle at rect.left+clientLeft, rect.top+clientTop with clientWidth/clientHeight. Require this rectangle wholly inside the layout viewport, all relevant ancestor clip rectangles, and finite positive dimensions.
- Reject partly-offscreen/clipped/transformed targets with UNSUPPORTED_TARGET_MAPPING before capture. Do not silently crop away a clipped grid column.
- Handle only genuine fixed/sticky occluders; ordinary target descendants are never hidden based on stationary geometry. Recycled and recreated row nodes remain visible.
- Two settled layout samples 120 ms apart must agree on the target viewport and requested offset, within the existing one-second RAF fallback and cumulative preparation/position deadline. Do not wait for arbitrary application-network quiescence.
- Newly rendered rows can change identity during intentional scrolling. That is expected. Geometry remains frozen; content identity is established by fixture oracles, not a production promise to understand arbitrary application row IDs.
- Return captureScope:"target-only" and the bounded warning TARGET_ONLY_SCOPE. Status says "Capturing the scrolling area only." Do not add a confirmation dialog.

Add these exact fixture variants:
1. tests/fixtures/iframe-padding.html: 300×200 CSS iframe, 40 px padding on all sides, 8 px borders, child content 350×250 with magenta last row and cyan last column. Test content-box and border-box separately. Expected CSS expanded sizes are 350×250 content-box and 446×346 border-box; actual child viewport is at least 350×250. Count and locate sentinels after independent PNG decode. The asymmetric case uses padding left/right 40/20, top/bottom 10/30 and borders left/right 3/7, top/bottom 5/9; expected decoration sums are 70 and 54.
2. Same fixture with responsive reflow stabilizing on pass 2, one oscillating beyond pass 3, and a child navigation during settle. The oscillating case returns viewport-only or a typed enclosing-geometry failure, never a claimed complete child capture.
3. tests/fixtures/virtual-scroller.html, parameterized mode: scroll-only rendered range, ResizeObserver-rendered range, recycled nodes and recreated nodes. Render exactly 100 logical rows of height 40, fixed colors/IDs and right-edge markers, in a 600×320 viewport over a 900×4000 target. Keep an actual rendered window plus explicit spacer; render after a known asynchronous gate. The oracle requires each row identity once in its correct Y band and both far edges.
4. tests/fixtures/clipped-grid.html: same finite grid inside a clipping ancestor and a separately transformed target. Both must fail before URL creation until a mapping implementation is explicitly qualified.
5. Existing app-shell.html retains all 36 row markers, sidebar/header, wide-grid right edge, supported iframe content and open-shadow marker. Existing shrinking-scroller.html must fail clearly or have complete original coverage; shrinking may not cause an endless loop or invented blank regions.

Tests/edits: extend S16 iframe test L146–164 with padding and actual child viewport fields; preserve child-identity rollback tests L166–175. Extend S17 /frames cases and source-restoration comparison. Add node --test tests/nested-strategies.test.cjs for strategy transition order, one switch maximum, separate compositor sessions and recycled-node non-hiding. Run the existing full dependency-free target as well.

Q2 gate: isolated real Chrome/Firefox synthetic fixture runs for only iframe/nested mapping. If the child viewport differs from the formula, stop enabling that sizing class and retain viewport-only output warning; do not choose an untested alternate padding formula. If a virtualizer fixture loses/duplicates rows, keep preserve-layout unqualified for that class and report unsupported output, without removing ordinary app-shell support. Preparation, frame collection and cancellation must restore original native offsets/styles in success and failure cases.

Version/build/lock: no new runtime dependencies or permissions. The only load-order/build changes are package 1's helper. Update README.txt L40–62 and tests/README.md with target-only and inaccessible-frame limitations; do not assert universal virtualization support. Roll back iframe sizing and nested strategy patches separately, but never roll back child-document identity guards or reinstate motion-only row hiding to make a fixture pass.

## Package 3: cumulative budgets, cancellation and one-stream PNG output

### Revision status and source seam

CD1–CD6 source-review corrections are incorporated below and in package 4/shared/direct-caller seams; their bounded independent source recheck passed. This does not certify implementation or runtime acceptance. Q3/Q4 and all proposed runtime oracles remain unrun. The selected architecture is unchanged: one active capture, one existing compositor authority, one zlib stream, bounded IDAT chunks and ordinary automatic downloads.

S8 has separate transport timeouts; S10 renewSession extends lifetime on every operation; S12 collects the entire compressed output with Response.arrayBuffer. The old worker finally revokes an output until a download ID returns, while the old compositor abort unconditionally revokes session output (S7 L237–269; S10 L40–43). Replace those cleanup semantics, not merely add a ledger around them.

### Budgets and single-capture admission (CD4)

Keep the previously selected policy constants in capture-protocol.js:
- MAX_CAPTURE_FRAMES=20000; CAPTURE_INTERVAL_MS=560.
- MAX_PREPARE_MS=15000; MAX_CAPTURE_MS=600000; MAX_ENCODE_MS=300000; MAX_OPERATION_MS=900000.
- MAX_DISCOVERED_ELEMENTS=50000 per preparation; MAX_CAPTURE_ROOTS=128; MAX_DISCOVERED_EFFECTS=2000; per-frame recheck <=12000 candidate elements/128 roots; DOM_BATCH_SIZE=256 with clearable setTimeout(0) yields.
- IDAT_PAYLOAD_BYTES=1048576; MAX_IDAT_CHUNKS=128; MAX_ENCODED_BYTES=128*1024*1024 including all PNG overhead.
- MAX_FRAME_DATA_URL_CHARS=48*1024*1024; MAX_FRAME_BITMAP_BYTES=64*1024*1024.
- MAX_ACTIVE_CANVAS_BYTES=96*1024*1024; MAX_SAVED_TILE_BYTES=128*1024*1024.
- MAX_RETAINED_URLS=4; MAX_RETAINED_URL_BYTES=256*1024*1024; MAX_ACCOUNTED_BYTES=512*1024*1024.
- Existing MAX_TILE_HEIGHT=8192, MAX_TILE_PIXELS=8*1024*1024 and MAX_OUTPUT_PIXELS=200*1024*1024 remain geometry ceilings. Byte/deadline admission can reject smaller high-entropy/slow captures.

These are unmeasured initial policy, not guarantees about browser RSS or support for every 200-megapixel page. Do not silently lower image quality, omit pixels or evict an owned pending source to meet them.

Admission, without a distributed allocator:
1. Set activeCapture synchronously before any await. Verify tab/private-context eligibility. Ensure/query the existing compositor before executeScript/prepare, so retained-output count/bytes and pending-disposal allocations are checked before page mutation.
2. Admission reserves one future URL slot, the chosen maximum output allowance (128 MiB), and at least 128 MiB of operation capacity. Require live URL count+one<=4, retained URL bytes+maxOutputBytes<=256 MiB, and remaining accounted capacity>=128 MiB. The 128 MiB minimum is not an assertion that eventual peak is only 128 MiB.
3. Derive operationEnvelopeBytes=MAX_ACCOUNTED_BYTES-retainedOutputBytes-pendingDisposalBytes. The worker uses this single-operation envelope for its controlled allocations/held messages. Start carries this value and observedLedgerRevision; the compositor independently rechecks its own current totals and rejects stale overcommit. A status/prepare interval cannot bypass this second check.
4. Within that envelope, compute the whole phase peak before each controllable allocation and enforce each category ceiling. Policy reservations become live charges; do not double-count an unchanged reservation forever and do not debit a still-referenced object merely because it moved out of a map.
5. The worker also tracks pendingWorkerPixelProducers (capture acquisition or message continuations that can still retain/produce a controlled pixel string). startCapture refuses a new pixel operation while that set is nonempty, even if cancellation already settled the foreground state; a late observer drops its owned references before removing the entry. This is the existing single-capture guard extended through actual producer settlement, not a distributed allocator. A pending download-initiation Promise is not a pixel producer and does not block recapture after encoding/transfer cleanup. The compositor remains the owner of saved tiles, output ledger and pending native disposal records. There is no multi-context reservation service, no storage and no new allocator protocol. For cross-context frame transfer use the conservative two-string phase allowance below; do not assume shared string backing even in Firefox.
6. A cancelled session can leave pending-disposal allocations under the same compositor authority after sessions.delete. Those allocations count against future admission until their actual continuations settle. Removing the active lock/map is not evidence of memory release.

Minimum phase charges, with backing allocation identity preventing double debit/credit:
- Capture/transfer: 2*dataUrl.length for the worker string plus 2*dataUrl.length for the compositor string while outstanding. At the 48 Mi-character limit these two strings alone cost 192 MiB. Bound the small envelope to 64 KiB and check the known base64 string/envelope bound against Chrome's separate 64 MiB serialized-message maximum without serializing another giant copy. Browser-native transport temporaries remain outside observable ownership. Drop request/message and worker dataUrl references in explicit finally paths; do not leave them captured in late-result closures.
- Frame ingestion/draw: received PNG Blob size, decoded frame bitmap 4*w*h, existing active tile canvases, newly allocated tile canvas. The frame phase includes any still-held two-string allowance. Native decode may allocate before dimensions are returned; inspect returned sizes immediately and dispose an oversized result, without claiming the precheck prevented that native allocation.
- Tile finalization: the tile canvas remains charged during convertToBlob; add the returned Blob before clearing the canvas and releasing its charge. All saved tile Blobs count until every owning map/local reference is dropped.
- Scanline decoding: saved tile Blob plus any local retained reference, decoded tile bitmap until close, scratch canvas 4*w*tileHeight, getImageData backing buffer, filtered scanline output and a conservative queue/in-flight scanline allowance. highWaterMark:1 describes the source queue only, not all buffers in the pipeline.
- Compression collection: 1 MiB staging allocation, the entire returned compressor Uint8Array's backing ArrayBuffer, all formed PNG chunks and PNG fixed headers. A subarray keeps its full backing buffer charged once. An arbitrarily large native compressor value can exceed the planned allowance; fail/dispose on observing it and report that native allocation occurred.
- Finalization: reserve existing encoded parts plus an additional Blob of encodedBytes at construction, because Blob may copy. Drop encoder-owned parts/staging references while holding the returned Blob and its encodedBlobPendingHandoff lease on the still-live session. Only finish's atomic URL/ledger insertion transfers that same lease to retained output; encoder success cleanup cannot transfer or debit it early. Retained output counts its Blob storage, not just the URL string.
- Cancellation: an awaited createImageBitmap/convertToBlob/read/pipe continuation keeps its input/known output allowance as pending disposal until it settles and releases objects. Prompt cancellation acknowledgment does not mean native work is interruptible or finished. A late result is charged/checked and immediately disposed, exactly once.

Use local helpers reserveBytes(session,category,backingId,amount), releaseBytes(session,category,backingId) and moveToPendingDisposal(session,lease) within the existing compositor; same-object release/transfer is idempotent and cannot make totals negative. Worker frame handling follows the agreed phase envelope and explicitly clears both raw request references and its dataUrl before completing its cleanup. If a still-pending worker-side continuation can retain a controlled pixel representation, keep its conservative allowance in that operation's pending-disposal accounting and keep the pendingWorkerPixelProducers guard set instead of admitting a new capture on a fictional zero. No peer is asked to infer physical GC or string sharing.

Discovery/geometry preflight still uses current viewport/DPR and finite candidate extents, then actual compositor bitmap ratio. The theoretical minimum capture time estimatedFrames*560 must fit remaining capture/operation time. Geometry-read batches precede style-write batches; cancellation is checked after each batch/yield. Exhausted discovery cannot become an unbounded scan or silently complete unverifiable geometry.

### Cumulative cancellation and ownership boundary (CD1)

Worker operation fields: operationId, sessionId, owner, intentId, phase, startedAt, operationDeadline, phaseDeadline, cancelReason, cancellationAcknowledged, frameAttempts, acceptedFrames, restoration, initiationAttempted:false. Mint intentId once before finish, retain it through cleanup, and never create a second intent to retry an ambiguous result. Active-context elapsed time uses performance.now; cross-context deadlines/expiry use capped finite wall-clock timestamps. Retry/renewal never restarts a cumulative deadline.

Helpers:
- cancelOperation(operation,reason) -> {acknowledged,phase}
- cancelContext(context,reason) -> restoration summary
- cancelSession(session,reason) -> void
- throwIfCancelledOrExpired(context,phase) -> void
- abortableSleep(ms,context) -> Promise<void>
- disposeResources(context) -> void, idempotent

Keep typed reasons USER_CANCELLED, TAB_CHANGED, NAVIGATED, PREPARE_TIMEOUT, CAPTURE_TIMEOUT, ENCODE_TIMEOUT, OPERATION_TIMEOUT, RESOURCE_LIMIT and TRANSPORT_FAILED. Do not infer a timeout from DOMException.name; own clearable timers supply the reason.

Content cancel bypasses the serialized command queue, marks its owner cancelled and synchronously runs rollback. Late prepare/position continuations checkOwner before further mutation. Disconnect uses the same path. Restore returns actual recorded acknowledgment/partial/failure state.

Compositor abort bypasses any frame/finish busy slot and disposes only the exact active capture. It may release an exact unarmed encoded entry for that session. Delete S10's unconditional revokeSessionUrl(sessionId): abort must never implicitly revoke an armed, bound or uncertain source. Recheck identity/cancellation after every await and before map/URL insertion.

Finish receives the full validated envelope with intentId. Atomically with URL creation, insert an encoded output ledger entry carrying creator-owner, operation/session/intent/context identity, dimensions, byteLength, createdAt/expiresAt and revision. Return that identity, intentId, revision and URL together. There is no finished output outside the ledger. S10 renewSession is capped at the original deadline. S11 checks cancellation after encode and immediately before insertion.

A finish transport timeout is not permission to replay finish/frame. Abort that exact session. A late unarmed encoded output can be removed by exact abort or DISCARDED_UNARMED release; a cancelled/settled worker must never consume a late finish response to start a download.

The synchronous invocation boundary is:
1. Verify the exact finish response and ledger-arm acknowledgment, cancellation/deadline and live local creator operation.
2. With no intervening await, set phase="initiating", set initiationAttempted=true, then invoke the selected native Promise-form download(options) exactly once.
3. No missing ID, rejection, timeout or later cancellation resets initiationAttempted. Package 4 observes the one returned promise with a bounded foreground wait and a late handler.

Cancellation before step 2, including after arming, may use download-release reason CANCELLED_BEFORE_INITIATION only while the same live creator worker can prove its own initiationAttempted===false. The worker's sole constructor verifies local operation-object ownership and owner===compositorOwner; a replacement worker's returned ledger record cannot supply that proof. The compositor additionally requires exact identity/revision and a noninitiated encoded/armed entry. This is an assertion by the trusted creator's local control flow, not a claim that arbitrary message fields prove browser noninvocation.

Rewrite worker finally at S7 L255–269:
- Restore/close content RPC, cancel/abort remaining capture work and drop worker pixel/request references.
- Remove downloadOwnsUrl:boolean, the per-capture listener and the rule finishedUrl&&!downloadOwnsUrl -> revoke.
- Release only an exact known unarmed encoded output or a proven same-creator never-invoked armed output using the release reasons above.
- If invocation was attempted or its history is unknown, request reconciliation and leave source lifetime under the compositor ledger. Tab-change/navigation cancellation after invocation cannot report "cancelled, no file saved" or send the pre-initiation release reason.
- A lost arm acknowledgment while this same worker never invoked can be followed by an exact, current-revision pre-initiation release; re-read on revision conflict, never assume arm failed. If cleanup evidence/transport remains unavailable, retain source to its bounded expiry with uncertainty.
- Clear foreground activeCapture after bounded cleanup/initialization observation; late download handlers refer only to the original intent and cannot restart capture or replace newer tab status. Native pending-disposal charges remain truthful.

### Exact scanline/compressor/IDAT algorithm (CD5)

Keep one CompressionStream("deflate") per output. Its zlib-wrapped stream spans consecutive IDAT chunks; never use deflate-raw or compress tiles independently. References: [Compression Standard](https://compression.spec.whatwg.org/#supported-formats), [PNG compression](https://www.w3.org/TR/png-3/#10Compression).

Replace S12's whole-output arrayBuffer with:
- makeScanlineSource(session) -> {stream,dispose}
- collectIdatChunks(readable,session) -> Promise<{parts,encodedBytes,chunkCount}>
- encodePngFromTiles(session) -> Promise<Blob>
- encodePngChunk(type,payload) -> Uint8Array, retaining testable crc32

makeScanlineSource has explicit disposed:false, loadedTileIndex:null, row:0, scratchCanvas:null, scratchContext:null and pending acquisition state. Bitmap presence is not a loaded-tile sentinel after the bitmap is closed. Walk integer tile indices from savedTiles directly, without copying entries into a retaining array.

For each new tile:
1. Check session/live identity/source not disposed, acquire its Blob and track the local reference.
2. Await createImageBitmap in a try/finally acquisition guard. Immediately after await check both session cancellation and source.disposed before assigning anything.
3. A late decoded bitmap closes immediately. Allocation/getContext/draw failures also close the bitmap even if source state was never fully installed.
4. Draw to one scratch canvas; close bitmap immediately after successful draw. Mark loadedTileIndex and row=0. Delete the savedTiles entry and release its Blob charge only after all local Blob references are cleared.
5. Each pull reads <=16 rows, charges getImageData and filtered output, prepends PNG filter byte 0 per RGBA row and enqueues at most one source-queue chunk with highWaterMark:1. Keep the conservative in-flight pipeline allowance.
6. After final tile row, clear scratch dimensions/context/loadedTileIndex before loading the next tile. End only after all expected rows.
7. dispose first sets disposed=true, then clears synchronous references and marks pending work for late disposal. pull catch calls dispose and errors the source; cancel and encoder finally call the same idempotent function. Do not assume a rejected pull invokes cancel.

Create exactly one compressor, then concurrently:
- retain pipePromise=source.stream.pipeTo(compressor.writable,{signal:sessionPipelineSignal});
- consume compressor.readable using one getReader/read loop, never ReadableStream async iteration.
Attach rejection handling immediately. A source/pipe/read/deadline failure calls one failEncoding(error) helper: record the first failure, mark source unusable, abort the shared signal, dispose the source and request reader cancellation with its rejection observed. Do not await pipePromise before reading output, which could deadlock under backpressure. Successful encoding requires readable done and pipePromise fulfilled before final Blob construction. The cumulative encoding deadline also races the foreground orchestration; after failure use the bounded cleanup below rather than hanging on a native read. Late pipe/read results only dispose and cannot settle the operation twice.

collectIdatChunks handles any returned native chunk size. Charge the entire underlying buffer while splitting it into 1 MiB payloads, preserving its reference/charge across yields until every byte is consumed. An empty Uint8Array is skipped, not interpreted as stream completion. After each emitted IDAT, yield with cancellation-aware setTimeout(0); do not discard the unconsumed remainder on a yield. Form each independent PNG chunk with big-endian payload length and CRC(type+payload). Copy final partial staging data into a right-sized chunk and drop staging.

The fixed structure is signature(8)+IHDR(25)+IEND(12), hence:
encodedBytes = 45 + sum(IDAT payload byte lengths) + 12*IDAT chunk count.
Check this at every append and before Blob construction. 128 full 1 MiB payload chunks deliberately exceed the 128 MiB whole-PNG budget; MAX_IDAT_CHUNKS does not waive the byte limit. IHDR is 8-bit RGBA with compression/filter/interlace 0. IDATs are contiguous; IEND is final. Empty image input fails.

Separate successful encoder disposal, finish handoff and cancellation/failure disposal:

- Successful encoding: after readable completion and fulfilled pipePromise, recheck session identity/cancellation/deadline and construct the final Blob with both encoded parts and possible Blob copy charged. Dispose only encoder-owned resources: completed scanline scratch/source state, parts, staging, completed reader/pipe references and timers. Do not cancel/remove/mark unusable the capture session or abort its cancellation signal merely because encoding completed. Return the Blob while retaining its exact charge as session.encodedBlobPendingHandoff, a lease bound to that Blob and the still-live session identity. Dropping encoder buffers must not debit this lease. No one-tile passthrough optimization is selected.
- Finish handoff: immediately recheck live session identity, cancellation and deadline, and require the returned Blob to match the successful encodedBlobPendingHandoff lease. In one synchronous handoff with no await, create its URL, insert the exact encoded ledger entry, and transfer that same lease from the session to the ledger. Clear the session's pending-handoff slot and local Blob reference. Only afterward may capture-session cleanup remove capture state; it must not release/debit the transferred output lease. There is no earlier transfer simply because encodePngFromTiles returned.
- Handoff failure: if URL creation or ledger insertion fails, remove only any exact newly inserted entry from this attempted handoff, revoke any URL newly created by it, clear local/pending Blob references and release that pending lease exactly once. No orphan URL/entry/charge and no change to older outputs is permitted.
- Cancellation between successful encoding and finish insertion: drop/release the pending Blob once, perform cancellation cleanup and create no URL. A completed scanline source's disposed flag alone is not this cancellation; source.disposed prevents late pull/decode/enqueue but does not invalidate a successful Blob.
- Cancellation or source/sink/read/allocation/CRC/Blob failure: mark the capture session unusable, abort the shared pipeline signal, call reader.cancel with rejection observed, and call source.dispose. Retain truthful pending-native-disposal charges. This failure path, not successful encoder-only disposal, invalidates the session.
- Do not call readable.cancel while its reader owns the lock or separately abort the locked compressor writable. Observe pipePromise and reader cancellation immediately. Release the reader lock after the read/cancel operation settles where required; if settlement exceeds the 2000 ms cleanup wait, attach late finally/rejection handlers to perform release/disposal. Do not claim a pending read lock was released while the platform forbids it.
- Failure cleanup wait remains capped at 2000 ms with an owned clearable timer. A timeout settles foreground cleanup once but keeps pending-disposal charges/late handlers; late results only dispose and cannot create an output URL.
- Erroring pull, already-aborted signal and rejecting cancel use that failure path with zero unhandled rejections. Successful cleanup of a fulfilled pipeline neither enters failEncoding nor aborts the live session.

Native compressor/decoder/GPU memory and transport temporaries remain outside fully observable JS accounting. No counter or final Blob proves a hard process-memory ceiling.

### Tests, negative oracles and Q3

Preserve S16 cancelled finish L59–70, late decode L94–110, cancelled tile L117–124 and known IEND CRC L112–115 after the exact schema/helper migrations listed after package 4.

Add/extend tests/png-stream.test.cjs:
- R1 handoff oracle (unexecuted): complete the real encoder normally and execute its success cleanup; assert the capture session remains live/not cancelled, its cancellation signal is not aborted, the completed scanline source may be disposed, and the pending returned Blob remains charged. Let finish hand off: exactly one owned URL/ledger entry appears and the same lease transfers with no double debit. Hold the interval after encoder success/cleanup and before finish insertion, cancel, then release: zero URL and one pending-lease release. Inject URL creation failure and ledger insertion failure (including an exact partial insertion): no orphan URL/entry/charge, any newly created URL is revoked once, and older outputs remain unchanged. Existing late-decode/read-failure/cleanup-timeout cases remain required. Any narrowly substituted encoder fixture must obey the same registered pending-Blob-lease return contract as the real encoder; an uncharged bare Blob is not a successful encoder result.
- Parse signature/chunks independently, validate every CRC with a separate bitwise implementation, IHDR, IDAT contiguity, final IEND, exact inflated scanline length/filter bytes and expected pixels.
- Concatenate IDAT payloads as idatBytes and call zlib.inflateSync(idatBytes,{info:true,maxOutputLength:expectedScanlineBytes+1}); require result.buffer.length===expectedScanlineBytes and result.engine.bytesWritten===idatBytes.length. The pinned [Node 22.23.3 implementation](https://github.com/nodejs/node/blob/v22.23.3/lib/zlib.js#L408-L489) sets bytesWritten from actual consumed input, and its [Options documentation](https://github.com/nodejs/node/blob/v22.23.3/doc/api/zlib.md#L831-L840) defines info:true. Validate this source-selected mechanism on the selected Node toolchain using two mandatory negative fixtures: append a valid independent empty zlib stream, and append arbitrary trailing bytes. Both must reject. If the selected engine consumption field does not distinguish these, stop that oracle seam and resolve the pinned Node API/source before asserting one-stream compliance. Do not use an unsupported newer reject-trailing-garbage option.
- Real-PNG evidence uses a real zlib stream. Arbitrary compressor-value tests at 0/1/N-1/N/N+1/multiple-N sizes test packing only, not PNG validity.
- Hold decode after dispose, fail draw before state assignment, reject compressor read/cancel, hold pipe completion, cancel a >2-IDAT native chunk after its first emitted chunk, exercise partial final staging, Blob throw, already-aborted signal and cleanup timeout followed by late completion.
- Each late bitmap/canvas/reader/Blob closes/releases once, zero URL appears, no per-tile second zlib stream sneaks through, and recapture is admitted only if the true remaining envelope fits.
- Track independent allocation backing IDs/bytes across every yield, including both outstanding JSON strings, Blob conversion overlap, ArrayBuffer subviews, final parts+Blob overlap and pending native disposal. Assert accounting never falls below controlled live representations and never debits negative.
- Hold frame decode/tile conversion/Blob construction while cancellation and recapture occur; one URL slot/output allowance remains reserved and retained sources are not evicted.
- Hold downloads.download after its sole invocation, cancel/run finally and require the source remain. Then deliver ID and matching complete item; release once. Pre-invocation cancellation variants require zero invocation and eventual one source release.
- Keep capture throttling/cumulative-deadline/budget arithmetic tests from the original contract.

Fixtures remain tests/fixtures/encoding-entropy.html (solid/coordinate/xorshift32 seed 0x6d2b79f5) and large-dom.html (49,999/50,001 elements; root/effect budget cases). No real user pixels.

Q3 remains isolated current Chrome/Firefox plus an offline/synthetic Chrome 116 compatibility probe if retaining the floor. Sample process-group RSS <=100 ms with inspectors closed; record baseline/peak, elapsed, category/pending-disposal totals and cancellation latency. Initial thresholds remain <=1 GiB additional peak, acknowledgment <=2 s in a runnable context, no accumulating owned resources after actual settlements, and <=32 MiB additional accounted retention after five captures/30 s idle. Cancellation acknowledgment alone is not a release measurement. OS RSS may remain allocated after GC; do not equate that alone with a live leak. Failure blocks only the affected enabled resource envelope, not ordinary small capture.

No new runtime library/API floor/permission. Roll back encoder independently if its oracle fails, while keeping safe post-finish cancellation, armed-output ownership and explicit resource accounting. Do not claim lower memory before Q3 passes.

## Package 4: one-shot native download, private context and source ownership

### Browser selection and branch-local preflight (CD2/CD6)

Keep getBrowserTarget() synchronous, derived from the real manifest: exact Gecko ID/background.scripts identifies Firefox; background.service_worker/offscreen-capable build identifies Chrome. Namespace presence is not classification; Chrome supplies browser on newer versions. hasSharedCompositor is routing evidence only.

Add getDownloadApi(target): verified Chrome -> chrome.downloads; verified Firefox -> browser.downloads. Register onCreated/onChanged on that selected API at top level before any await. All download, search and event operations use that same selected API. Promise-form download is documented for Chrome before floor 116 and for Firefox's browser API: [Chrome API](https://developer.chrome.com/docs/extensions/reference/api/downloads), [Firefox API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download).

Resolve the actual tab with tabs.get; require tab.incognito to be boolean. Missing/unverified context returns CAPTURE_CONTEXT_UNVERIFIED before injection, never Boolean(undefined)==false. For private tabs call the selected target's extension.isAllowedIncognitoAccess() Promise API before executeScript/prepare. False -> PRIVATE_ACCESS_DENIED. Missing/rejected API -> PRIVATE_ACCESS_UNVERIFIED for that private branch. No ordinary-context fallback.

makeDownloadOptions({target,tab,url,filename}) returns exactly these own keys:
- Chrome normal: {url,filename,saveAs:false,conflictAction:"uniquify"}. No incognito/cookieStoreId key.
- Firefox normal: common keys plus incognito:false.
- Firefox private: common keys plus incognito:true.
- Chrome private: PRIVATE_CAPTURE_UNVERIFIED before mutation until Q4 verifies the selected spanning path. After qualification, its option keys are still the Chrome common keys; no Firefox option is introduced.

Firefox's private flag selects private-session download-manager visibility, not isolation between two separate private windows. tabId/windowId remain capture/status ownership fields, not nonexistent native download routing options. No cookieStoreId/cookies permission, split mode or persistent storage is selected.

Ordinary supported capture remains available and automatically invokes a download once. An OS/browser security/global save-location setting may impose its own prompt; do not change it or introduce an extension chooser to force a passing result.

### Exactly one invocation and bounded foreground settlement (CD2)

Add local worker helpers:
- invokeDownloadOnce(operation,options) -> Promise or captured synchronous failure; it calls getDownloadApi(target).download(options) exactly once, synchronously before returning.
- observeDownloadInitiation(operation,promiseOrFailure) -> Promise<{kind,downloadId?,code?}>.
- releaseNeverInitiatedOutput(operation,entry) -> Promise<result>, with creator-local proof from package 3.
- reconcileOwnedDownloads({reason,operationId?}) -> Promise<summary>.

invokeDownloadOnce refuses if operation.initiationAttempted is already true. The helper itself performs the final cancellation/identity check, sets phase="initiating" and initiationAttempted=true, then makes the sole native Promise-form invocation in the same synchronous turn. No callback argument, feature-probe invocation, Promise-to-callback fallback or second call after undefined/rejection/timeout/replacement is permitted. A synchronous throw counts as the one attempt.

observeDownloadInitiation bounds the foreground wait by min(15000 ms,remaining operation deadline), with a settle-once guard and owned timer cleared on every settlement. A valid returned ID is any nonnegative safe integer, including 0. Rejection/synchronous throw records DOWNLOAD_START_FAILED; malformed/undefined non-Promise/ID records DOWNLOAD_START_INVALID; deadline records DOWNLOAD_START_UNCERTAIN. These are API-observation results, not permission to redownload or proof no saving occurred.

Attach fulfillment and rejection handlers immediately, including after a foreground timeout. Late valid IDs bind/reconcile only the exact original intent/immutable creator/context, through revision checks. They cannot restart capture, invoke download again or replace a newer tab's state. Late rejection is observed and recorded, never unhandled. If the worker is gone, only the surviving compositor's normal exact reconciliation remains; no hidden retry service is added.

An explicit API rejection is retained as apiOutcome:failed, but reconcile any already-observed exact item before choosing public status. If the native call and observed item disagree, verified completion may still show Saved for that same intent while diagnostics record the initiation anomaly. Ambiguity retains the armed source to bounded expiry. Do not classify free-form browser error messages into replay/revocation decisions.

This bounded initiation wait releases the foreground capture lock after normal bounded capture cleanup, so an unresolved download promise alone cannot block ordinary recapture forever. Late handlers remain scoped to their old output, not activeCapture.

### In-memory ledger with independent source and download state (CD1/CD6)

One ledger remains in the existing compositor context. Entry fields:
{intentId,operationId,sessionId,owner,targetBrowser,tabId,windowId,incognito,url,byteLength,createdAt,expiresAt,revision,sourceState,initiationState,downloadId,downloadState,paused,canResume,apiOutcome,outcomeCode}.
IDs, creator owner, capture context and source URL are immutable. revision is a nonnegative integer incremented for each accepted mutation. downloadId starts null and may bind once; the same ID is idempotent, a different ID is rejected.

Separate state axes:
- sourceState: encoded -> armed -> released|expired. Bound/uncertain/paused downloads keep sourceState armed until actual release. released/expired is irreversible.
- initiationState: not-armed -> armed-unknown -> id-known|uncertain|api-failed. The worker alone knows its synchronous initiationAttempted flag before an ID/observation; the compositor's armed-unknown does not prove invocation occurred.
- downloadState: unknown|in_progress|paused|interrupted-resumable|interrupted-final|complete.
- apiOutcome: pending|valid-id|failed|invalid|timed-out, recording the native observation separately.

Finish inserts encoded state atomically with output URL creation and returns full identity, intentId and revision. download-arm validates the exact encoded entry/context/bytes and advances to armed-unknown before invocation. A lost arm acknowledgment is uncertain delivery, not permission to retry download or assume an unowned URL.

Package 3's abort never releases armed output. download-release rules:
- DISCARDED_UNARMED only if sourceState==encoded. Used by cancelled/failed capture or a consumer that finished reading an output it never armed; it is not a test-only permission.
- CANCELLED_BEFORE_INITIATION only from the original still-current worker's owned local operation whose initiationAttempted is false. The callCompositor/releaseNeverInitiatedOutput constructor enforces this local proof; a recovery record cannot be converted to a new false-flag operation. Compositor also checks immutable identity, revision, encoded/armed state, downloadId===null and downloadState==unknown; contradictory download evidence prevents this release. Losing the proof means retain/reconcile, not revoke.
- DOWNLOAD_COMPLETE only after exact owned item evidence says complete.
- DOWNLOAD_INTERRUPTED_FINAL only after exact owned item evidence says interrupted and canResume===false.
- SOURCE_EXPIRED is the existing compositor's fixed lifetime policy, not a guessed download failure.

Pre-invocation release on REVISION_CHANGED first re-reads the exact entry and revalidates the same creator-local proof. If transport/evidence stays ambiguous, stop the release attempt and let bounded expiry own cleanup. Raw URL.revokeObjectURL is private to this ledger. Replace revokeOffscreenUrl(url) and all raw revoke callers with exact-intent commands. No downloaded file is deleted and downloads.cancel is not used as speculative cleanup.

### Event matching and lossless reconciliation scheduling (CD2)

Use one matchOwnedItem(entry,item) predicate for onCreated, onChanged-triggered searches, startup/replacement and late-ID paths:
1. Match exact item.url to the uniquely minted owned blob URL (not finalUrl, filename, title or time).
2. Require item.incognito to be boolean and equal the trusted entry context. Missing private-context evidence is uncertainty, never ordinary-by-default.
3. If item.byExtensionId exists, it must equal runtime.id. If absent, it is not affirmative evidence of a different owner and does not by itself reject a valid ordinary route.
4. If bound, item.id must equal the immutable ID. If unbound, exactly one matching item may bind. Multiple matching intents/items are ambiguity.

Search uses selectedApi.search({id}) when bound; otherwise selectedApi.search({url:entry.url,limit:2}), followed by exact filtering. Two exact results are sufficient to report ambiguity; do not choose the newest or ask for only one. A query API may use pattern semantics internally; the exact postfilter remains mandatory. Zero results, missing context, denial or conflicting ownership remain uncertain. A missing item after initiation never authorizes another download.

onCreated can bind an armed exact entry before the invocation Promise resolves. onChanged marks the corresponding ID/intent dirty and schedules reconciliation; never revoke based only on delta.state. After binding, reconcile immediately to catch early completion. A lost bind acknowledgment is re-read/reconciled idempotently, not another invocation.

reconcileOwnedDownloads uses one in-flight promise plus dirty flag/set, not just a shared promise:
- Every relevant event while a pass is in flight marks another pass required.
- Capture each entry's revision before search. After await, discard/re-read if identity, ID, source/download state or revision changed.
- Complete is an established terminal download fact and cannot be overwritten by an older in_progress search. Newer bound IDs cannot be erased by older no-ID results.
- Process dirty entries again after the current pass; finally clears only its own promise. If work arrived at settlement, schedule the next pass rather than losing that event.
- Searches have a bounded 15000 ms observer timeout (also capped by remaining foreground deadline if invoked in foreground). A late result uses the same captured revision and can only apply if still current. Foreground waiters settle once; late rejections are observed.
- Busy/event storms do not extend source expiry. Pending tombstone reconciliation may update outcome, but cannot recreate output storage.

### Fixed expiry and tombstones (CD6)

Source lifetime is 10 minutes from createdAt, never renewed by polls/retries/pauses. Use an owned fixed expiry timer. Start one bounded final reconciliation up to 2000 ms before expiresAt; this request is best effort. At expiry, or the first runnable turn afterward, release the source even if search never returns. Mark sourceState=expired/outcomeCode=SOURCE_EXPIRED, remove Blob storage/URL ownership, clear expiry/poll/cleanup timers for that source, and reject late attempts to resurrect it. A suspended browser does not guarantee exact wall-clock firing.

Expiry does not prove download failure: the browser may already have copied its bytes. Keep a bounded internal tombstone in the same existing 20-terminal-record budget, <=1 KiB each, containing exact intent/operation/creator identity, immutable downloadId if known, revoked URL comparison string, incognito/context and latest outcome/revision. It retains no PNG bytes. Its public projection excludes URL/tokens. If a URL/record would exceed the bound, evict/drop recoverability explicitly rather than weakening the bound.

A late exact complete DownloadItem can update the original tombstone to downloadState=complete and public Saved without changing sourceState or recreating the URL. It cannot replace newer tab status. Once that tombstone is evicted, or the entire background is lost, report earlier outcome unknown/unavailable rather than infer ownership.

Normal retained-source policy:
- complete -> release source once, public Saved.
- in_progress/paused/interrupted with canResume===true -> retain source until terminal evidence or fixed expiry.
- interrupted with canResume===false -> release source once, public failure.
- missing/unknown canResume or ambiguous item -> retain until expiry, public uncertainty.
- exhausted output slot/byte policy -> reject a new capture before page mutation; never evict a pending source to admit it.

Chrome offscreen can retain the ledger when only its worker is replaced, and it only uses runtime APIs. While sourceState armed, owned timers may request reconciliation every 30 s and at the final 2-second boundary through the validated context notification schema; stop at release/expiry. BLOBS has no reason-specific auto-timeout, but that is not durable storage or a promise against context loss. Firefox unload destroys its nonpersistent background, metadata and document-owned blob URLs together. On later entry, earlier outcome is unavailable; do not persist pixels, add storage permission or redownload.

### CD1–CD6 regression oracles and Q4

Add/extend tests/download-ownership.test.cjs through real production listener/entry registration:
- Exact own-property options matrix, native API selection despite browser namespace on Chrome, trusted tab incognito missing/false/true, private-access false/missing/rejected. Denied/unverified private branches cause zero script injection. Ordinary captures stay available.
- Native Promise resolve(0), rejection, synchronous throw, indefinite Promise, undefined return from an intentionally wrong fake; one call per intent, no callback fallback, bounded foreground lock and settle-once waiters.
- onCreated before ID resolution, complete before bind, complete arriving during a held old search, dirty-event follow-up, lost bind acknowledgment, duplicate event and late old ID after a newer capture.
- Cancel/tab-switch after synchronous invocation while Promise held: finally does not revoke source or claim no file saved. Later exact ID/complete releases once. Before-invocation cancellation (before arm acknowledgment and after acknowledgment) gives zero native calls and one eventual source release.
- Worker replacement after arm plus initially empty search: no retry invocation. Replacement cannot assert CANCELLED_BEFORE_INITIATION for the old entry.
- Exact URL/context/optional byExtensionId matching; missing optional owner field alone does not disable ordinary delivery; mismatch, duplicate matches and failed searches stay uncertain.
- Paused/resumable/final interruption, absent canResume, four retained outputs blocking fifth before prepare, actual terminal release allowing another bounded capture.
- Stalled final search cannot delay expiry; late complete after expiry updates only original tombstone and never recreates source; tombstone eviction/background loss makes recovery unavailable.
- Firefox two-private-window status remains operation/tab-scoped while native manager visibility is private-session-wide.
- Chrome worker-only loss preserves ledger; whole Firefox background loss removes it. No automatic capture/download duplication.

Q4 remains an isolated packaged-extension gate:
1. Actual normal/private windows, toolbar/menu gestures, captureVisibleTab and native download managers.
2. Trusted private access allowed/denied, permanent-private Firefox and last-private-window closure.
3. Inspect DownloadItem.incognito, manager visibility and exact one-PNG behavior; no extension-added chooser. Do not promise per-private-window isolation.
4. Observe actual paused/resumable blob-backed behavior if supported, Chrome worker-only loss and Firefox whole-background loss.
5. If blob resumption cannot be produced, distinguish the unit state-machine oracle from unrun real resumption evidence.
6. Chrome spanning-private success is required before enabling only that private branch. Failure retains upfront unsupported private status and does not remove ordinary Chrome delivery.
7. If exact blob URL/context is not available in a platform result, recovery for that route is unverified; retain uncertainty rather than matching filenames/times.

No new permissions, storage, browser minimum or dependency. Adapter stays in service-worker.js. Rollback must preserve armed-output ownership and one-shot invocation; never fall back to the old ephemeral listener/ID-gated finally revoke. In-memory protocol mismatch is handled by explicit uncertainty and bounded old-context cleanup, not by guessing migration/retry.

### Exact direct caller/test migration inventory (CD3)

The schema patch and every caller below are one integration unit, even if the product algorithms land in smaller commits. Old-shaped fixtures are rejection cases, not compatibility paths.

1. service-worker.js start/frame/finish at pinned L157/L192/L227; abortOffscreenSession L429; revokeOffscreenUrl L438; close/status L467; finally L255–269; all new startup/list/event/late-result calls use callCompositor's typed scope and response checking. Replace raw URL release with exact intent. The same invocation helper supplies Promise-form API fakes and production selection.
2. offscreen.js runtime listener L9–19 and handle L22–51 validate envelopes; finish(sessionId) becomes finish(validatedEnvelope,liveSession). createSession(prep,owner) receives complete operation/context/deadline/budget identity from start, not fabricated IDs. Both old idle notifications L79–81/L283–287 use the context notification schema and worker sender validation. __cfpCompositorHandle at L517 becomes the trusted-background entry invoking the same payload validator; do not call the raw unvalidated handler.
3. tests/reliability.test.cjs compositor helper L25–28 loads capture-protocol first and provides runtime.id/getURL, crypto UUIDs, tracked timers, distinct object URLs and selected API Promise fakes. Expose encodePngChunk rather than removed pngChunk. Keep known IEND bytes 0000000049454e44ae426082 at L112–115 under the new helper name.
4. Every reliability handle call at L66–68, L97–109, L118–122 and L133–141 gets valid envelopes, bounded distinct UUID identities and a valid image/png data URL. "old"/"done"/"fixture", owners "A"/"B", dataUrl:"fixture", missing data URLs and universal blob:test are invalid. The direct createSession({})/manual session-map insertion at L60–63 is replaced by a valid start through the production entry. Narrow encoder substitution for late-finish cases may remain, with valid nonempty Blob/metadata; separate tests execute the real encoder.
5. tests/browser-png.cjs L5–6 injects protocol before content/compositor. compose L18–25, repeated status L32, cancellation L43–54 and stored finish continuations use complete envelopes/intent identity. Generate stable per-test UUIDs and pass response-bound identities into each call. After reading a never-armed output, record read completion locally and release with production DISCARDED_UNARMED; do not invent a native download-complete event or a test-only production release permission. The harness remains direct-functions/CDP. Production runtime sender validation is not weakened for page-evaluated test calls.
6. Content port requests/replies at content.js L18–41 and createPortRPC worker L276–340 migrate bound identity and close/postMessage-throw settlement per the shared schema. Direct content fixture wrappers in reliability L6–23, browser-layout L7–9 and browser-png L6 supply a test-owned operation/owner and use the already selected prepare/position/snapshot/restore contracts. Geometry/strategy logic is unchanged by this identity migration.
7. Popup start/cancel/status responses are bound to requested/current operation/context before render; no output URL, intent token or raw ledger record reaches popup text. The status-specific expiry/late-complete projection follows CD6, without revising other UI design.
8. Add old-envelope rejection tests, held-first-frame plus concurrent duplicate frame/finish -> one acceptance, abort-bypasses-busy, wrong request/owner/intent reply cannot settle a newer call, and Chrome-runtime versus Firefox-trusted-entry normalized-result parity. None allocates/draws on an invalid envelope.

## Package 5: truthful nonmodal status and lifecycle recovery

### Operation state and visible behavior

At S15 popup.js closes after initialization and loses later failure visibility; context-menu errors are only caught/logged at S6. Replace this with one worker-owned state model and an accessible popup. Do not put a status overlay in the captured page.

Add helpers in service-worker.js:
- getOperationKey(tabId,incognito) -> string
- setOperationState(operation,nextPhase,details={}) -> sanitized snapshot
- getOperationState({tabId,windowId,incognito}) -> sanitized snapshot
- cancelRequestedOperation({operationId,tabId,incognito}) -> cancellation acknowledgment
- renderActionStatus(snapshot) -> Promise<void>
- validateExtensionSender(sender,{kind}) -> boolean
- recoverOperationStatus(contextIdentity) -> Promise<snapshot>

State phases and exact visible strings:
- preparing: "Preparing capture"
- capturing: "Capturing • N frames" where N is acceptedFrames, never acquisition attempts or an invented percent
- encoding: "Encoding PNG"
- initiating/saving: "Saving PNG"
- paused/resumable: "Download paused" / "Download interrupted; resumption may be available"
- saved: "Saved" only after exact owned DownloadItem.state=="complete"
- cancelled: "Capture cancelled", followed separately by restoration status
- failed: sanitized typed error text
- uncertain: "The earlier download result could not be verified"
- expired: "Screenshot source expired; resumption may no longer work", only while no exact complete fact is known. Source expiry and download outcome are independent; a later verified completion changes this operation to Saved without recreating the source.

Keep one latest operation per tab/context plus the existing shared budget of 20 terminal records, each at most 1 KiB. Package 4's private internal tombstone can retain a revoked blob-URL comparison key/ID/context inside that same budget, with no PNG bytes; its public status/diagnostic projection excludes URLs and tokens. An older completion updates only its original record and cannot replace the tab's newer operationId, badge or popup status. Diagnostics never retain page title, page URL/text, screenshot, blob URL or stack trace. Allowed diagnostic fields remain extension version, browser target, error code, phase, dimensions, accepted/attempted frame counts, elapsed rounded duration, restoration result and resource counts. LIVE_MOTION, IFRAME_VIEWPORT_ONLY and TARGET_ONLY_SCOPE are warnings, not generic failures.

Popup edits:
1. Keep existing capture button and status role="status"/aria-live="polite".
2. Add a button id="cancel", type="button", hidden outside preparing/capturing/encoding.
3. On open, query active tab/window and capture-status. Refresh while open every 500 ms with one in-flight query maximum; stop timer on unload.
4. Capture click disables duplicate starts, sends capture-active-tab and then shows state. Do not automatically close the popup. The popup can close naturally, and reopening queries the same operation.
5. Cancel sends exact operationId/tab/context from the current status. A stale popup cancel cannot cancel a newer operation.
6. Status text remains selectable and readable; use normal foreground color for neutral progress and an error class only for actual failure. Retain keyboard focus indicators and do not focus-steal on every poll.
7. No modal alert, additional Save step, confirmation screen or on-page progress UI.

Set tab-scoped action badge/title, never a global badge: PREP, CAP, PNG, SAVE, DONE, ERR or ? with text titles matching the sanitized status. Badge number may show accepted frames only if it fits; do not truncate into a fake percentage. Clear/reset only for that tab's same operationId. A context-menu failure reaches the badge/title and reopenable popup even if no popup was originally opened.

Status and restoration are separate:
- restore-acknowledged: content responded that all owned mutations were restored or deliberately left because the page changed them.
- restore-partial/failed: one or more owned cleanups failed, with bounded reason codes.
- restore-unverified: page disconnected/navigated before acknowledgment.
"Cancelled" never implies "page restored". After download initiation, cancelling remaining capture cleanup cannot overwrite that intent’s Saving/uncertain/complete outcome or imply no file was saved. If the document is gone, say restoration could not be verified in that document; do not send writes into its replacement.

Recover verified status from package 4's surviving metadata. If none exists after a worker/background restart, return a neutral no-active-operation state with "Earlier results may be unavailable after restart." Do not manufacture an interrupted operation merely because a new worker started, or claim no file was saved.

### Sender and input validation

Worker popup commands require sender.id==chrome.runtime.id, sender.tab absent, and sender.url equal to chrome.runtime.getURL("popup.html"). Context-menu starts arrive from the registered context-menu event with its actual tab, not an arbitrary message-supplied tab. Validate tab ID, window ID and incognito against chrome.tabs.get before action. Query status only for the active tab resolved by the worker from the popup's current window; ignore an unverified caller-supplied incognito flag.

Content onConnect requires matching extension sender ID where provided, a bounded cfp:<sessionId> name and the top-frame injection route. One active owner remains at a time. Every command must match that port's session/owner, protocol version and bounded payload shape. Do not accept page postMessage as a capture control channel.

Compositor runtime dispatcher requires sender.id==runtime.id and no content-script tab sender. Validate the browser's observed worker/background sender URL according to Q5: Chrome service-worker.js, Firefox generated background document, or a platform-documented absent worker URL. Missing IDs never pass. Direct Firefox calls are from the same background worker code and still go through envelope/owner validation. Reject arbitrary popup-origin compositor commands even though the popup is same-extension; the popup may only use worker status/cancel/start commands. Unknown sender representations stop that transport branch with a recorded test failure, not a permissive accept-all fallback.

Only data:image/png;base64, captures with bounded length may enter frame decoding. Decode failure and bitmap mismatch return typed errors. Finished URLs must exist in the compositor-owned ledger; a worker may not download a caller-supplied blob/http URL. Revoke requires exact owned intent/session identity. Never use startsWith("blob:") alone as ownership proof.

Retain callback-based runtime listeners and literal return true for async sendResponse. Do not make them async functions whose return behavior changes cross-browser. The context-envelope offscreen-idle and download-reconcile-needed notifications use the same exact offscreen sender allowlist; reconciliation acknowledgment means queued, not complete. These callback response listeners are distinct from package 4's selected native Promise-form downloads API.

### Offscreen close/start serialization, with an honest evidence boundary

At S9 ensureOffscreen tracks only creation; closeOffscreenIfIdle does not retain a closing promise. Introduce let offscreenClosing=null in the same worker, not a new lifecycle service.

ensureOffscreen():
1. Return immediately for verified Firefox shared compositor.
2. If offscreenClosing exists, await its settlement, then clear only the same promise; record failure but continue to query actual contexts.
3. If offscreenCreation exists, await it.
4. Query runtime.getContexts using the exact offscreen.html URL.
5. If absent, create once through offscreenCreation; finally clears only that creation promise. Requery after a rejected ambiguous create before deciding whether to retry. At most one create retry after an actual absent-context result.

closeOffscreenIfIdle():
1. Return for shared Firefox, active operation, pending creation/closure, any ledger-held URL, busy compositor operation or pending-disposal allocation. status.idle requires all of those compositor work/resource sets to be empty, not merely sessions.size===0.
2. Set offscreenClosing synchronously to the complete query/status/recheck/close promise before its first await, so a new ensure cannot miss the pending closure.
3. Query contexts, ask the compositor for idle and generation, then recheck activeCapture, creation and the same idle generation immediately before close.
4. If a new operation appeared, skip close. A new operation's ensure waits for this promise and then verifies actual context state.
5. Finally clear only the same offscreenClosing promise on resolve or reject. A rejected close cannot leave a permanent lock.
6. Keep runtime.getContexts. Do not replace it with offscreen.hasDocument, which the [official API reference](https://developer.chrome.com/docs/extensions/reference/api/offscreen#method-hasDocument) places at Chrome 150.

This is defensive serialization. The pinned source alone does not establish a user-visible harmful close/start race; Chromium implementation evidence in the delivered plan is counterevidence to a strong failure claim. Model an adversarial schedule to prove the new code is coherent, then use actual browsers to establish whether any observed issue exists.

Tests:
- tests/worker-orchestration.test.cjs covers popup close/reopen, concurrent duplicate starts, context-menu initialization/runtime failure, stale status/cancel replies, old completion after a newer operation, private status isolation and each sender validation negative.
- tests/offscreen-lifecycle.test.cjs uses actual registered worker entry points: hold getContexts/status/close at each await, start a new capture, then release; assert no frame is sent to an absent compositor and the next capture is usable. Inject rejected close/create/status and worker replacement.
- Keep all S16 restoration ownership tests. Add compare-before-restore cases where the page replaces a property while capture is suspended.
- Q5 in isolated Chrome tests rapid recapture with actual context creation/closure and inspectors closed. Record browser traces/state without asserting an existing bug if no failure reproduces. Firefox tests only the shared route; it must never call chrome.offscreen.
- Actual sender.url/id shapes are recorded from the test extension in normal/private contexts without logging user pages. If expected shape differs, stop only that branch, inspect the official/platform evidence, and make an explicit reviewed allowlist adjustment.

Version/build/lock: no permissions, browser minimum change or new dependencies. Popup CSS remains local. Roll back status UI independently from lifecycle serialization; preserve cancellation ownership and error visibility. Removing a bad badge change must not revert the user to console-only context-menu failures.

## Package 6: production-worker tests and packaged-browser evidence

### Existing targets, accurately characterized

Existing node --test tests/*.test.cjs runs one dependency-free file, reliability.test.cjs. Its VM helpers expose private content/compositor functions and stub onConnect/onMessage registration (S16 L6–28). It does not execute service-worker.js.

Existing browser-layout.cjs evaluates content.js with a runtime registration shim and controlled settle; browser-png.cjs evaluates content.js/offscreen.js and uses Playwright page.screenshot. Both explicitly say actual activeTab/captureVisibleTab, worker lifetime and downloads are untested (S17/S18). Keep those suites; do not relabel them as full extension tests.

Add tests/helpers/extension-harness.cjs:
- createExtensionHarness({target,clock,tab,contexts}) -> {dispatchPopup,dispatchContextMenu,dispatchTabActivated,dispatchNavigation,dispatchDownloadCreated,dispatchDownloadChanged,disconnectContent,replaceWorker,destroyBackground,resources,calls,settle}
- load the exact production capture-protocol.js, content.js, service-worker.js and offscreen.js source in the appropriate VM contexts.
- Record callbacks passed to runtime.onMessage/onConnect, contextMenus.onClicked, tabs.onActivated and the selected target's downloads listeners; dispatch through them. Download fakes implement the exact one-shot native Promise form, including ID 0, held fulfillment/rejection and intentionally invalid undefined-return negatives; they never authorize callback fallback.
- Port endpoints post messages asynchronously, have real disconnect ordering, track listeners and allow controlled response loss/delay. Literal return true behavior is asserted.
- Mock only browser/DOM primitives, timers, screenshot data acquisition and allocations. Do not stub captureFullPage, createPortRPC, callCompositor, startCapture, state transitions or the new acceptance/ownership helpers.
- Unique object URLs include a monotonic fixture ID. Resource tracker observes create/revoke, bitmap close, canvas release, timers and download calls.
- Chrome uses separate worker/offscreen contexts plus runtime transport. Firefox loads helper -> offscreen -> worker into one shared background context.
- replaceWorker destroys only the worker and re-registers top-level handlers without erasing the Chrome offscreen ledger. destroyBackground erases Firefox worker/compositor together.
- Use fake monotonic/wall clocks with explicit tick/flush, never real long sleeps in node tests.

Packages 1–5 own their regression cases, using this helper. Package 6 supplies infrastructure and broader integration cases; it is not a prerequisite for writing every earlier fix. If an earlier package introduced a minimal helper, move/extend it here without duplicating its orchestration implementation.

New full-worker cases:
- Both successful entry points, prep failure before initialization, capture API rejection, tab switch, navigation/disconnect, compositor transport timeout and late response.
- Content command timeout while mutation is suspended; cancel bypasses queue, rollback precedes new owner, late continuation cannot reapply styles.
- Rejected snapshot/bitmap, finalized tile revisit, missing coverage, zero frames and no progress.
- Cancellation at prepare/acquisition/decode/tile-finalize/compression/CRC/finish/armed/pre-initiation boundaries.
- Early download completion, no-ID uncertainty, paused/resumable ownership, expiry, private mismatch and new operation isolation.
- Surviving offscreen with lost worker; shared Firefox whole-background loss; close rejection/rapid recapture.
- Sender/payload validation, nonfinite geometry, oversized data URLs, unknown ownership and no unauthorized downloads.

### Real PNG fixtures and exact oracles

Extend browser-png.cjs without changing production MAX_TILE_HEIGHT/MAX_TILE_PIXELS:
1. width=400, height=16385, actual ratioX=ratioY=1. Expected tile boundaries 8192 and 16384; third tile has one row. Use viewport 400×900 or taller, preserving <100 frames. Verify all coordinate colors and boundary rows 8191/8192/8193/16383/16384. Explicitly assert the measured scale before expecting those tile boundaries.
2. width=4096, height=4097, actual scale 1. Adaptive tileHeight=floor(8388608/4096)=2048. Use viewport 1200×1200 to force horizontal sweeps; expected boundaries 2048 and 4096 and last row 4096. With existing overlap strides this remains below the 100-frame guard.
3. fractional effective scales 1.25 and 2, including nonmultiple target widths/heights and final partial columns/rows. Derive expected output dimensions from the measured screenshot ratio, not an assumed deviceScaleFactor. Keep independent coordinate-edge expectations.
4. Drop one required frame/rectangle deliberately: finish fails coverage, creates no URL, then a fresh capture passes.
5. Cancel mid-stream after at least one IDAT chunk rather than only after an entire encode; assert no URL, disposal and clean recapture.
6. Preserve existing all-colored-rows tests at heights 100/180/190/191, repeated-pixel equality, iframe sentinels and post-encode cancellation.

Replace the hard-coded count<100 guard only if a new legitimate fixture's computed plan exceeds it: derive harness limit=min(MAX_CAPTURE_FRAMES,estimatedFrames+2) and assert completion by estimatedFrames; do not loosen it into an arbitrary unbounded test. Retain explicit fixture size/frame bounds in each test.

Independent decoder:
- pngjs decodes the delivered bytes.
- tests/helpers/png-oracle.cjs parses signature/chunk boundaries, validates all CRCs with its own straightforward bitwise CRC implementation (not production crc32), checks IDAT contiguity/final IEND, concatenates/inflates via Node zlib info:true and verifies exact scanline length/filter bytes/RGBA. It also verifies result.engine.bytesWritten===idatBytes.length after zlib.inflateSync(idatBytes,{info:true,maxOutputLength:expectedScanlineBytes+1}), using the pinned Node 22.23.3 consumed-input implementation identified in package 3. Mandatory appended-empty-zlib-stream and appended-arbitrary-bytes negatives must both reject; ordinary successful inflation alone is insufficient. If consumption reporting cannot enforce this on the selected toolchain, that oracle seam remains source-resolution-gated without substituting unsupported newer options.
- Structural CRC/decompression success alone does not prove pixels. Compare coordinate colors at every row and the required columns/boundaries; compare complete pixels where scale=1 and the fixture is opaque/non-antialiased.
- Never count only global magenta/cyan totals when location matters; require each marker at the right output coordinate.
- Output reports state their source route ("direct-functions/CDP" or "packaged-extension/real-captureVisibleTab") so those evidentiary levels cannot be confused.

### Packaged-browser test target and manual portion

Add tests/packaged-browser.cjs and tests/packaged-browser-checklist.md. The script serves only repository synthetic fixtures, verifies the package/inventory hash, creates an isolated fresh profile, records browser details, observes downloads and independently checks saved PNGs. Browser-specific launch/driving support is allowed, but tests requiring genuine extension toolbar/context-menu gestures are explicitly manual when the supported automation APIs cannot generate those gestures. A manual check is an evidence field, not a skipped test reported as pass.

Inputs:
--target chrome|firefox
--package path/to/approved.zip or approved signed XPI
--inventory path/to/build-manifest.json
--report path/to/qa.json
Environment CFP_CHROMIUM_EXECUTABLE or CFP_FIREFOX_EXECUTABLE selects an already provisioned exact browser; the script never points at a personal profile.

Sequence:
1. Validate archive/inventory, extract to a fresh owned directory and verify load order/manifest.
2. Start isolated desktop browser with normal throttling/security settings, inspectors closed and no unsafe extension debugging flags.
3. Install/load only that extracted candidate under the authorized test workflow.
4. Exercise toolbar button and page context menu through actual user gestures. Do not substitute programmatic popup opening for activeTab.
5. Run the selected fixture matrix, verify saved bytes and restoration, then close the test profile.
6. Check restricted pages, denied file access, explicitly enabled file access, normal/private access, same-window tab switch, unrelated-window tab switch, navigation, minimize/restore and recapture after failure. Test each supported branch separately.
7. Exercise browser restart and extension update using signed/store-distributed packages where required. Temporary Firefox add-on loading is not proof of signed install/update compatibility.

QA schema:
{schemaVersion:1, repository, commit, target, manifestVersion, packageSha256, inventorySha256, browser:{name,version,channel}, os:{name,version,arch}, display:{scale,dpr,zoom}, sourceRoute, checks:[{id,status:"pass"|"fail"|"unrun"|"unsupported",evidence}], startedAt,finishedAt, reviewer, limitations}.
Fail/unrun required checks block that target's publication. Unsupported entries are allowed only for a feature explicitly disabled/documented in that candidate, not for a required ordinary download path. Record hashes of saved fixture PNGs and decoded-oracle results. Never include real page data or credentials in QA artifacts.

Minimum feature floor versus supported baseline:
- Keep manifest Chrome 116 as an API floor until an intentional support-policy change; qualify syntax/APIs there in an isolated synthetic environment. Do not ask normal users to install it.
- Firefox 126 is the activeTab capture API floor. [Mozilla's signing-root guidance](https://support.mozilla.org/en-US/kb/root-certificate-expiration) makes standard Firefox 128+ relevant to signed add-on continuity; it is not a current support promise.
- Do not change Gecko strict_min_version to 140 merely because data-consent metadata exists.
- The owner must choose the maintained current desktop Chrome/Firefox release/ESR scope after exact signed install/update evidence. If not decided, publish only an accurately stated tested-current-browser scope and keep legacy-floor support unclaimed. This is a support-policy decision, not a reason to block node harness work.

Dependency/build edits:
- Add development-only package.json/package-lock.json in package 7, with exact playwright 1.63.0, pngjs 7.0.0 and web-ext 10.7.0. No library is packaged into the extension.
- Preserve PLAYWRIGHT_MODULE/PNGJS_MODULE overrides for existing local tooling. Normal CI uses the locked dependencies.
- Add CFP_EXTENSION_ROOT for existing browser-layout/browser-png suites so product source is read from the verified extracted package while fixtures/helpers remain in the checked-out tests directory. The default remains repository root.
- Tests/helpers files are outside scripts/build.py's payload allowlist.
- Runtime provisioning and genuine browser interaction remain execution-gated under the user's permissions; this contract did not run/install anything.

Q6 gate: the package-local node harness must first pass. Then run direct-function pixel tests on the extracted candidate, followed by the real packaged-browser matrix for the changed supported paths. Any unavailable gesture, browser, signing or update route is reported unrun, with only that evidence claim blocked. Do not add broad permissions or unsafe flags to bypass it.

Rollback: keep existing dependency-free tests working even if optional browser provisioning fails. Revert a broken harness change independently of product fixes, but publication cannot mark its missing required evidence as pass. A supported download path must be tested through the real package before its release claim is made.

## Package 7: verified deterministic packages and publisher trust

### Immediate independent patch

At S20 publisher build L65–83, insert node --test tests/*.test.cjs after syntax checks and before packaging. Add bash -n scripts/publish_chrome.sh there, matching the ordinary build workflow. Make github-release/publish-firefox/publish-chrome depend on this tested build. This narrow patch can land before any runtime package. A syntax-valid failing regression must stop every applicable publisher path.

The existing ordinary build workflow already runs node tests; the publisher workflow does not. Ordinary PRs do not meet the current store-job conditions. This contract does not claim an existing secret leak or PR-triggered store publication.

### Exact tooling and version changes

Add package.json with name:"capture-full-page-extension-dev", version:"0.0.0", private:true, no install lifecycle scripts, engines.node:"22.23.3", packageManager:"npm@10.9.9", and exact devDependencies:
- web-ext:"10.7.0"
- playwright:"1.63.0"
- pngjs:"7.0.0"

Source basis: [web-ext 10.7.0 package](https://github.com/mozilla/web-ext/blob/3c26c884e237282c072113483eda0eaddabb64f7/package.json) declares Node >=20; [Playwright v1.63.0](https://github.com/microsoft/playwright/releases/tag/v1.63.0) resolves to 1b025d7e20a026371cd5f98ba0cdce48892737c8; [pngjs package source](https://github.com/pngjs/pngjs/blob/main/package.json) reports 7.0.0 and Node >=14.19.0. The pngjs v7.0.0 Git ref lookup returned 404, so do not invent that tag's provenance. The official npm registry version/integrity must be captured by the lock-generation step. [Node's release archive](https://nodejs.org/en/download/archive/v22) identifies Node 22.23.3 with npm 10.9.9. These are selected development-tool versions, not executed compatibility evidence.

In an authorized implementation environment, generate package-lock.json with the selected Node/npm using npm install --package-lock-only --ignore-scripts --no-audit --no-fund. Commit lockfileVersion 3 and exact registry resolutions/integrities for the whole tree; fail if an engine conflict, missing integrity, git dependency or unapproved non-registry host appears. Review the diff before npm ci. CI runs npm ci --ignore-scripts --no-audit --no-fund without store secrets. Invoke ./node_modules/.bin/web-ext directly; never npx web-ext@latest. Browser installation, if needed for QA, is a separate credential-free authorized provisioning step, not an implicit npm lifecycle script. No package lock was generated in this read-only task.

Pin both workflow action references to these exact upstream tag resolutions observed during this research:
- actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 (v6)
- actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 (v5)
- actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 (v4)
- actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 (v4)
- actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0 (v5)

These pin actual observed commits; they are not a full security audit of vendors. Review the action metadata/runtime requirement in the implementation PR and run a credential-free compatibility job. If the hosted runner no longer supports an embedded action runtime, stop and pin a reviewed supported replacement explicitly; do not silently fall back to a mutable tag.

Add .node-version containing 22.23.3 and .python-version containing 3.13.15. [Python 3.13.15](https://www.python.org/downloads/release/python-31315/) is a selected official interpreter release. Add scripts/release-toolchain.json with schemaVersion:1, python:"3.13.15", zlibCompile:"1.3.2", zlibRuntime:"1.3.2", node:"22.23.3", npm:"10.9.9", zipCompression:"deflate", zipLevel:9. [zlib's official site](https://zlib.net/) identifies release 1.3.2 and source hashes. Do not assume setup-python's binary on ubuntu-24.04 is linked to that zlib. Q7a below is an explicit isolated runtime qualification; until it passes, reproducible-release packaging remains blocked, while the immediate test-chain patch is independent.

Set runs-on:ubuntu-24.04 instead of ubuntu-latest. Exact Python/zlib versions plus normalized ZIP fields are the artifact byte contract; runner-image identity is recorded in provenance. If the setup binary does not meet the zlib profile, the owner must provision an approved runtime with that profile, or approve a reviewed profile change and rebuild/requalify every hash. This contract does not invent a container digest or download/install one.

Do not bump runtime versions for intermediate unreleased packages. The selected combined candidate is 5.4.0: change manifest.json.version and manifest.firefox.json.version together and update README.txt heading/build examples at release preparation. The version/tag must be v5.4.0 and larger than the observed published store versions. If 5.4.0 already exists or live-store version cannot be checked, stop the publication/version reservation step and ask the release owner; do not overwrite or guess a new number. Installed/store state is still unknown.

### Deterministic allowlisted archive algorithm

Edit scripts/build.py rather than adding another packager. Add:
- validate_source_file(root,relative_path) -> Path
- collect_payload(target) -> list[{archive_path,bytes,sha256,size}]
- write_deterministic_zip(entries,archive) -> {sha256,size}
- validate_archive(archive,target,inventory) -> extracted inventory
- write_build_manifest(commit,version,targets,toolchain) -> Path

collect_payload uses only COMMON_FILES + TARGETS[target].extra + the selected manifest remapped to manifest.json. Include capture-protocol.js from package 1. Lexically sort archive paths. Reject duplicates, empty names, absolute paths, backslashes, "."/".." components, symlinks (lstat, not is_file alone), nonregular files and resolved paths outside repository root. Read bytes once, hash those bytes and use the same bytes for ZIP output. The build must not discover extra files by rglob.

write_deterministic_zip uses ZipInfo for each exact path:
- date_time=(1980,1,1,0,0,0)
- create_system=3
- external_attr=(stat.S_IFREG|0o644)<<16
- internal_attr=0, extra=b"", comment=b""
- ZIP_DEFLATED, compresslevel=9, no encryption, no directory entries
- fixed archive comment empty
- fixed Python/zlib toolchain; checked before release-mode output

Use writestr with the captured bytes. All current payload paths are ASCII; if a new non-ASCII path is ever added, explicitly standardize the UTF-8 flag rather than relying on platform defaults. No timestamps from source files, process timezone, ownership or current wall time enter the ZIP.

Use a new empty per-build staging directory under dist and refuse symlinked/non-owned dist paths. Do not publish by dist/*.zip glob; enumerate exactly the two versioned ZIP paths returned by the build. Remove only this build's safely owned stale target directories or fail on unexpected files. Do not let an old version ZIP become a release asset.

Create dist/build-manifest.json outside both ZIPs:
{schemaVersion:1,repository,commit,version,toolchain,targets:{chrome|firefox:{manifestSha256,zipFilename,zipSha256,zipBytes,files:[{path,size,sha256,mode:"0644"}]}}}.
Commit is an exact 40-hex value verified against the checked-out commit. Do not embed current-time build metadata into the ZIP or a self-referential ZIP hash inside the ZIP. Provenance may record timestamps outside the deterministic payload.

validate_archive extracts only after validating entry paths/types/count/sizes and total uncompressed budget. Require its complete file set, bytes and metadata to match the inventory. Require canonical manifest JSON structure and all referenced icon/popup/background assets. Assert exact permissions:
Chrome contextMenus, activeTab, scripting, downloads, offscreen;
Firefox contextMenus, activeTab, scripting, downloads.
No host_permissions, externally_connectable, storage or added content script injection grants. Assert Chrome service_worker and offscreen script order; Firefox helper/offscreen/worker order; exact Gecko ID/data-collection declaration. Reject duplicate ZIP names, links, unexpected extras and manifest substitution.

### Build once, test those bytes, publish those bytes

Refactor publish-stores.yml into this dependency graph:
1. validate-ref (read-only): resolve exact commit/version, approved ancestry and event target.
2. build-test (read-only, no store secrets): checkout exact SHA with persist-credentials:false; toolchain/lock preflight; syntax; dependency-free tests; package once; validate/extract; web-ext lint verified Firefox directory; produce inventories/hash outputs; upload exactly the two ZIPs and manifest.
3. packaged-qa (read-only, no store secrets): download exact artifact ID from build-test, explicitly verify per-ZIP hashes against build-test job outputs, extract/validate, run applicable direct-function/package-local suites against CFP_EXTENSION_ROOT. Write machine evidence tied to commit/manifest/ZIP hash.
4. manual-qa (protected environment capture-release-qa): require the owner to complete the real-gesture/signed-install checklist against those exact downloaded ZIPs and review the displayed hashes. Before approval the job summary lists package IDs/hashes and all unrun checks.
5. Implement packaged-qa and manual-qa as independently named target jobs (packaged-qa-chrome, packaged-qa-firefox, manual-qa-chrome, manual-qa-firefox), not one matrix whose aggregate failure blocks the unrelated target. publish-firefox and publish-chrome depend only on their own target QA plus shared validate-ref/build-test. github-release attaches only the explicitly approved target assets. All download the existing artifact, verify its bytes again and do not rebuild source.

Concrete manual approval handoff, without inventing a new service:
- Configure the protected capture-release-qa environment with required reviewer(s) and no self-approval where supported. Owner configuration must be verified; merely naming an environment in YAML is not protection.
- Use target-specific protected QA environments capture-release-qa-chrome and capture-release-qa-firefox implementing the capture-release-qa policy above. In each, environment variable CAPTURE_QA_APPROVAL_JSON contains the package 6 QA schema plus buildRunId, artifactId and the exact target package hashes for this run. The reviewer uploads/links the full report in its evidence fields and sets this bounded nonsecret approval record before approving the job.
- The job parses this value as data from an environment variable, never shell-evaluates it. Require exact repository/commit/version/run/artifact/hash matches and all mandatory checks pass. Reject missing, malformed, stale, fail or unrun required evidence.
- Write the accepted record and its SHA-256 to the run artifacts and job outputs. Downstream jobs compare both build and QA hashes. The record is human-reviewed evidence, not a machine claim that gestures occurred.
- This external reviewer/variable setup is an owner gate. No credentials or approval configuration were read or changed by this contract.

Reference checks:
- Tags: peel annotated tags to commit; require exact v<manifest version>; require the commit is an ancestor of the fetched reviewed master ref. Verify release tag protection/approved creation outside the source-only contract.
- Manual: require an explicit release_commit 40-hex input and release_tag input, both resolving to the same commit/version; apply the same reviewed-branch ancestry check. build-only may run on a nonrelease ref without privileged jobs.
- Pin checkout to that resolved SHA. Fetch refs with persist-credentials:false; use only the read token for needed authenticated reads. Ref names from inputs must not become unquoted shell commands.
- PRs run unprivileged checks only; no protected environment approval/store secrets/write job. Keep target conditions explicitly constrained to push tags or workflow_dispatch. The string inputs.target alone cannot activate a job on another event.

Default workflow permissions: contents:read. Only github-release grants contents:write. Store jobs do not inherit global write authority. Scope AMO/CWS secrets to the specific sign/upload step, after all installs and byte checks. Use protected environments capture-firefox-publish and capture-chrome-publish for those secrets. Credential-free dependency installation and a clean checkout do not remove the need to trust same-runner code; be explicit about that boundary.

Chrome publish preserves manual-only condition: workflow_dispatch and target in chrome/both. A tag must not publish Chrome. Firefox may remain tag-triggered after the above protected QA/publish gates; a tag initiates a gated release, not an unconditional claim of live availability.

Chrome upload uses exactly the verified ZIP. Firefox web-ext sign operates on the verified extracted inventory from that ZIP, never a freshly rebuilt directory. Verify the directory again immediately before sign. Signing adds Mozilla-managed bytes; retain the input ZIP/inventory hashes, web-ext version, AMO response/version, signed-output hash and signed-file inventory as provenance. Do not assert a signed XPI hash equals the input ZIP hash.

[download-artifact v5 source](https://github.com/actions/download-artifact/blob/634f93cb2916e3fdff6788551b99b062d0335ce0/src/download-artifact.ts) warns rather than failing when its digestMismatch result is true. Therefore explicit SHA-256 checks against trusted build outputs and the reviewed QA record are mandatory. A manifest copied alongside a substituted artifact is not sufficient if no independently bound expected digest is compared.

### Store serialization, release conflicts and logs

Set concurrency groups per exact store item, cancel-in-progress:false. Chrome group uses CWS publisher/item identity; Firefox uses the fixed Gecko ID. If that identity is missing, fail configuration preflight, not a shared catchall group. GitHub-release uses repository+version group. CI concurrency does not control dashboard uploads; the release owner must coordinate a publishing freeze for the same item during the gated upload. If someone uploads concurrently, stop on ambiguity and recheck item/version; never repeat an uncertain upload automatically.

At S21:
- Keep set -euo pipefail and validate the exact supplied ZIP hash/manifest/version through a required sidecar/expected-hash argument before requesting an OAuth token.
- Do not enable shell tracing. Add GitHub ::add-mask:: for the derived ACCESS_TOKEN immediately after parsing it; never print token JSON.
- Replace full response dumps with allowlisted status/code/version/item fields. On error, sanitize provider messages before printing; avoid --fail-with-body leaking a raw response into logs.
- Check item identity and version fields where the API returns them before submitting publication. Item-wide fetchStatus is not an upload receipt and cannot prove remote hash identity.
- Keep bounded poll count and distinguish upload accepted, processing, review submission, approved/live and installed update.
- A lost/ambiguous response is an uncertain release state requiring verification, not automatic duplicate upload/submission.

At github-release S20 L101–105, remove --clobber. If a release asset with the same name exists, download its bytes read-only and compare hash. Equal bytes are an idempotent no-op; unequal bytes fail RELEASE_VERSION_CONFLICT. If release exists but a required asset is absent, upload only the verified absent asset. Never overwrite same-version bytes.

Update store/CHROME_WEB_STORE.md L72–76 to state manual-only Chrome submission. Update store/AUTOMATION_SETUP.md L16–27 and L111–115 for tests, build-once artifacts, protected QA and separate submission/live stages. Keep AMO_LICENSE owner-selected; do not pick a software license. Update README.txt's reproducibility claim only after Q7 proves it. Privacy policy remains accurate local-only processing; do not add telemetry to improve QA.

### Package-local preflights, tests and stop branches

Q7a tooling qualification, before enabling reproducible-release builds:
- In a credential-free isolated runner, print and record exact Python, zlib compile/runtime, Node/npm and action runtime compatibility.
- Require scripts/release-toolchain.json match. If it differs, stop packaging/release; keep the independent publisher test-chain correction. Provisioning or changing this profile is a separately authorized executor/owner task.
- Generate/review package-lock.json as specified; npm ci --ignore-scripts must resolve it unchanged. If web-ext lint/sign CLI syntax differs, inspect only that pinned version's command source/help in the authorized environment and update the exact invocation, not a mutable latest fallback.
- This gate is not a claim that the selected hosted binary already has zlib 1.3.2.

Add tests/build_contract_test.py, runnable with python -m unittest discover -s tests -p '*_test.py':
- Build in two clean copied checkouts of the same commit with deliberately different mtimes, timezone/umask and source permission bits; compare complete ZIP SHA-256 and per-entry metadata.
- Verify deterministic ZIP member order, timestamps, mode, compression and exact inventory.
- Inject symlink/out-of-root/nonregular payload, duplicate entry, bad manifest/load order, unauthorized permission, unexpected archive member and stale ZIP. All fail before publish.
- Version mismatch/tag mismatch/wrong SHA/unapproved ancestry fail independently of JS syntax.
- Tamper one byte of ZIP or inventory and assert explicit downstream verification fails.

Add tests/publish-gates.test.cjs and tests/helpers/publisher-fixtures/:
- Parse or inspect the workflow graph and run nonpublishing substitutes for gh/curl/web-ext. Substitutes record calls and return fixture JSON; they must not have store credentials or network endpoints.
- A syntax-valid failing node regression blocks build/package/upload/sign/release.
- Wrong tag, manual ref not on reviewed ancestry, missing/stale QA record, wrong target/manifest/hash, substituted artifact and unrun required QA all yield zero privileged calls.
- Approved exact candidate passes the nonpublishing path with each target's exact input hash once.
- Tag event yields no Chrome upload; manual chrome/both does; PR (fork and same-repository) yields neither store action.
- Existing identical release asset is no-op; conflicting bytes fail, never clobber.
- Concurrent same-item submissions serialize without cancelling an in-progress publish.
- Redaction fixtures seed fake credentials/tokens into provider errors; captured logs contain none.
- Early/ambiguous upload processing/status with wrong item/version stops before publish; item-wide success is never labeled remote-byte proof.

Run node --test tests/*.test.cjs plus Python build-contract tests in both unprivileged build chains. Run shell syntax checks. A real publish is not part of these tests.

Q7b release enablement requires owner-verified protections/environments, correct store item/license/credentials, supported target QA and no concurrent dashboard change. If any are unknown, stop only publication; verified source changes, node tests and nonpublishing packages can still be completed. No store operation or live/installed claim is authorized by this document.

Rollback: first disable affected privileged job conditions or keep protected approval pending. Roll back build/verification changes as one artifact-contract revision only with a new version or a rebuilt/requalified candidate; never mix old QA with new bytes. Already submitted store versions cannot be assumed retractable or rolled back by Git revert. Preserve existing published assets, logs and provenance. An owner-directed store rollback is a separate operation.

## Sequencing, bounded independent assignments and completion

Recommended implementation order:
1. P7 immediate dependency-chain test gate can proceed independently.
2. P1 shared helper/protocol + focused production-dispatcher harness.
3. P2 iframe sizing and nested strategy, with separate commits for the two classes.
4. P3 encoder and cancellation in separate commits joined by the same disposal contract.
5. P4 normal/private adapter and ownership ledger; Chrome-private remains disabled until Q4 qualifies it.
6. P5 status/recovery and separately offscreen serialization.
7. P6 broaden the reusable harness and exact-package real-browser evidence.
8. P7 deterministic artifact/release graph and gated owner enablement.

Parallel work is safe only at these seams:
- Frame/traversal reviewer: P1 protocol, row order, rounded rectangles, finalization and occlusion. Must not redesign download/storage.
- Iframe/nested reviewer: P2 formula, clipping, strategy rollback and virtualized-row fixtures. Must not change frame/encoder math independently.
- Encoder/resource reviewer: P3 stream, disposal and accounting. Must preserve P1 token checks and P4 output transfer.
- Download reviewer: P4 target identity, armed/uncertain state, exact matching, resumability and private qualification. Must not add split/storage.
- Status/lifecycle reviewer: P5 sender allowlist, stale operation UI, restoration and closure scheduling. No claim of reproduced Chrome race without evidence.
- Harness reviewer: P6 dispatcher fidelity, real-gesture distinction, independent PNG oracle and evidence schema.
- Publisher reviewer: P7 trust graph, locked tools, deterministic bytes and owner gates. Must not claim remote hash proof or installed updates.

These are individual bounded follow-up tasks; no one reviewer is asked to certify the entire repository or portfolio. Shared interfaces are fixed above. If a reviewer finds an interface contradiction, report the exact two clauses and proposed smallest correction; do not silently choose another architecture.

Completion checklist per package:
- Exact files and protocol/version/load-order changes committed together where required.
- Existing named tests retained, new focused oracle tests implemented and run in an authorized environment.
- Package-local runtime gates recorded pass/fail/unrun/unsupported honestly.
- No source/test report makes installed/store, private-path, memory-bound or atomic-capture claims it has not established.
- Rollback preserves ownership, restores the page where verifiable and never deletes a saved file.
- Each published candidate has source commit, manifest version, inventory, ZIP SHA-256, exact browser/OS/scale and applicable QA evidence.
- Submitted, reviewed/live and installed-updated remain separate milestones.

No blocker in this document authorizes bypassing permissions or doing the deferred runtime/store work now. The remaining execution/owner gates are explicit: Q1 supported geometry/motion/occlusion; Q2 child/target mapping; Q3 measured resource envelope; Q4 private/recovery behavior; Q5 actual sender/lifecycle behavior; Q6 real gestures and signed/current-browser support; Q7a exact build runtime/lock; Q7b external release authority. There is no unbounded "research more" task and no requirement to qualify the whole roadmap before a narrowly scoped source fix can proceed.
