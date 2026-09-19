Capture Full Page v5.3.0

PURPOSE
Capture a complete webpage as one PNG from either:
- the right-click context menu -> Capture full page
- the extension popup -> Capture full page

BROWSER SUPPORT
- Chrome / Chromium: Manifest V3 service worker + offscreen compositor document.
- Firefox 126+: Manifest V3 background document with the same compositor loaded
  directly as a background script.

The Chrome package requests activeTab rather than broad permanent host access.
The Firefox package does the same and declares that it collects/transmits no
data outside the extension.

WHAT CHANGED IN 5.3
- Added a Firefox Manifest V3 package without the Chrome-only offscreen
  permission.
- Reused the same compositor in Firefox's background-document environment.
- Added reproducible Chrome and Firefox ZIP packaging via scripts/build.py.
- Added CI syntax checks, Firefox web-ext linting, and packaged build artifacts.
- Added a privacy policy, hostable privacy-policy page, and store submission
  guides with listing text, permission justifications, and reviewer notes.

CAPTURE ROBUSTNESS
- Captures are serialized globally so multiple tabs cannot compete for
  captureVisibleTab's rate limit or compositor memory.
- Every viewport capture is bound to the tab that started the operation.
  Switching tabs in the same window cancels the capture rather than stitching
  pixels from the wrong tab.
- Scroll advancement detects zero-progress/clamped scrolling and fails cleanly.
- Failed captures explicitly abort compositor sessions and release canvases.
- The compositor validates output coverage instead of fabricating white regions.
- Tile size and total output size are bounded.
- The webpage is restored before PNG encoding and also on unexpected disconnect.
- Capture styles are installed inside open shadow roots.
- Same-origin scrolling iframes are temporarily expanded when possible.

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
isolated by the browser and remain viewport-only in this version. Supporting
their offscreen contents would require per-frame extension injection/coordination
plus host access to those frame origins. The extension deliberately does not
request broad <all_urls> access just to bypass that boundary.

DEVELOPMENT INSTALL - CHROME
1. Open chrome://extensions
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository/directory.
5. Reload the extension after code changes.

DEVELOPMENT INSTALL - FIREFOX
1. Run: python scripts/build.py --target firefox
2. Open about:debugging#/runtime/this-firefox
3. Click Load Temporary Add-on.
4. Select dist/firefox/manifest.json.

BUILD STORE PACKAGES
Run:

  python scripts/build.py

This creates:
- dist/capture-full-page-chrome-5.3.0.zip
- dist/capture-full-page-firefox-5.3.0.zip
- dist/chrome/ and dist/firefox/ unpacked test directories

STORE SUBMISSION
- Chrome: store/CHROME_WEB_STORE.md
- Firefox: store/FIREFOX_AMO.md
- Privacy policy: PRIVACY.md
- Hostable privacy page: docs/privacy.html

AUTOMATED RELEASES
- Store automation: store/AUTOMATION_SETUP.md
- A vX.Y.Z tag builds both packages, creates a GitHub Release, and can submit
  both Firefox AMO and Chrome Web Store releases once repository credentials
  are configured.
- docs/privacy.html can be deployed automatically with GitHub Pages.

DOWNLOAD PROMPT
The extension uses saveAs:false. Chrome's global setting
"Ask where to save each file before downloading" must also be off for a fully
automatic download.

REGRESSION FIXTURES
See tests/README.md and tests/fixtures/.
