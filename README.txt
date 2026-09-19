Capture Full Page v5.2.0

PURPOSE
Capture a complete webpage as one PNG from either:
- the right-click context menu -> Capture full page
- the extension popup -> Capture full page

WHAT CHANGED IN 5.2
- Captures are serialized globally so multiple tabs cannot compete for
  captureVisibleTab's rate limit or compositor memory.
- Every viewport capture is bound to the tab that started the operation.
  Switching to another tab in the same window cancels the capture rather than
  stitching pixels from the wrong tab.
- Scroll advancement now detects zero-progress/clamped scrolling and fails
  cleanly instead of looping forever. A maximum-frame guard and RPC timeout
  provide additional protection.
- Failed captures explicitly abort compositor sessions and release canvases.
  The offscreen document closes when there are no sessions or download blobs.
- The compositor validates output coverage. Missing regions now fail the
  capture instead of being silently replaced with white pixels.
- Tile height is chosen from a memory budget instead of always allocating
  8192-row canvases. Extremely large outputs are rejected before exhausting
  browser memory.
- The webpage is restored immediately after the final viewport is captured,
  before PNG compression/download work.
- Unexpected content-script disconnects trigger restoration as well.
- Capture styles are installed inside open shadow roots so transitions,
  animations, smooth scrolling, and scroll snapping are frozen consistently.
- Same-origin scrolling iframes are temporarily expanded so their full contents
  can participate in the page capture.
- The popup now reports initialization failures before it closes.

APP-SHELL / NESTED-SCROLLER CAPTURE
For large nested scrolling regions (Google Calendar-style apps), the extension
first tries to temporarily expand/unlock the scroller in place and then capture
the full document. This preserves surrounding headers, sidebars, and toolbars.

If expansion does not work, it falls back to nested-scroller capture.

The capture boundary is frozen before scrolling, so new lazy/infinite content
is not chased indefinitely.

SAFETY LIMITS
- Only one capture runs at a time.
- Switching tabs in the capture window cancels the capture.
- Captures stop after 20,000 viewport frames.
- Output is limited to 200 megapixels.
- Individual compositor canvases are capped by an 8-megapixel tile budget.

IFRAME LIMITATION
Same-origin scrolling iframes can be expanded. Cross-origin iframe internals are
isolated by the browser and remain viewport-only unless the extension is granted
host access to those frame origins. The extension deliberately does not request
broad <all_urls> access just to bypass that boundary.

INSTALL
1. Open chrome://extensions
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository/directory.
5. Reload the extension after code changes.

DOWNLOAD PROMPT
The extension uses saveAs:false. Chrome's global setting
"Ask where to save each file before downloading" must also be off for a fully
automatic download.

REGRESSION FIXTURES
See tests/README.md and tests/fixtures/.
