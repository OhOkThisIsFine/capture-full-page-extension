# Capture regression fixtures

These fixtures exercise the capture paths that have historically been fragile.

## Automated reliability checks

Run `node --test tests/*.test.cjs`. The dependency-free VM harness executes the
repository's content and compositor functions with controlled layout and
asynchronous browser primitives. It covers interrupted nested preparation,
old continuations after replacement sessions, iframe scroll restoration and
navigation, short viewport coverage across columns and fractional bitmap scales,
cancelled tile/finish operations, owner recovery preserving completed URLs, and
a known PNG chunk CRC. The build workflow runs these checks.

These tests model layout and verify coverage; they do not establish browser
pixel fidelity, sticky-header appearance, general iframe completeness,
real worker termination behavior, or peak encoding memory. Real Chrome and
Firefox fixture QA remains required. No browser extension was installed for
the initial repair batch. The small CRC change removes one temporary chunk allocation;
it does not establish a safe peak-memory budget.

## Optional isolated browser QA

`node tests/browser-layout.cjs` uses existing Playwright and a temporary Chromium
profile. It loads the unpacked source only in that temporary profile, serves
synthetic pages on loopback, and exercises production content functions against
real DOM layout. Runtime registration and settle waits use explicit test seams.
It checks short viewport traversal, interruption before/after nested unlocking,
old preparation released after a new session, and iframe box-model sizing and
scroll restoration. Tested on Chromium 148.0.7778.96.

`node tests/browser-png.cjs` uses existing Playwright and pngjs in temporary
headless browser profiles. It evaluates the production content/compositor
functions with runtime registration and settle seams, feeds actual browser
screenshots into the compositor, and independently decodes PNGs. It checks all
colored rows at viewport heights 100, 180, 190 and 191, repeated capture equality,
both iframe edge sentinels, scroll restoration, and cancellation after a real
encode. Tested on Chrome 154.0.8037.98. Border-box frames with 8px borders now
expose the complete frozen 500x600 content viewport in this fixture.

Set `PLAYWRIGHT_MODULE`, `PNGJS_MODULE` (PNG suite only), and
`CFP_CHROMIUM_EXECUTABLE` to already-installed tooling when normal module/browser
resolution is unavailable. Optional `CFP_QA_REPORT` writes the layout report;
`CFP_QA_OUTPUT` chooses the PNG/report output directory. Profiles are deleted
after each run. These optional suites do not install dependencies or touch a
personal browser profile, and are not part of the dependency-free CI command.

These checks do not establish the user-action/activeTab grant, captureVisibleTab,
browser-managed downloads, real worker termination, render-wait timing, Firefox
behavior, sticky-header fidelity, arbitrary responsive iframe completeness or
peak memory. In the permitted headless extension probe,
`Extensions.triggerAction` returned `Method not allowed`; opening the popup
programmatically did not grant activeTab and capture correctly rejected access.
No unsafe extension-debugging flags or permission overrides were used. Bundled
Chromium's screenshot API timed out; installed Chrome produced the verified
fixture PNGs through the production compositor harness.

## Run

Serve the repository over HTTP, for example:

```
python -m http.server 8000
```

Then open the fixture pages under `http://localhost:8000/tests/fixtures/` with
the unpacked extension loaded.

## Expected checks

### app-shell.html
A successful PNG should contain:
- the top application header and left sidebar
- every numbered row in the large nested scroller
- the full horizontal width of the wide grid
- the sticky strip only once rather than repeated down the image
- the complete same-origin `srcdoc` iframe
- the open-shadow-root test block with animation frozen during capture

The page should return to its original scroll positions and layout immediately
after the last viewport is captured.

### shrinking-scroller.html
The fixture deliberately removes content while the primary scroller is moving.
The extension should either finish with complete coverage or abort with a clear
scroll-progress/coverage error. It must not loop indefinitely and must not
download a PNG with fabricated white regions.

## Manual lifecycle checks

1. Start a long capture, then switch to another tab in the same window. The
   original capture must cancel; pixels from the newly active tab must never be
   stitched into the output.
2. While one capture is running, try to start another. The popup should report
   that a capture is already running.
3. After a forced failure, start another capture. It should work normally,
   demonstrating that the compositor session and global capture lock were
   released.
4. Repeat a large capture several times and inspect the extension service worker
   and offscreen document. The offscreen document should disappear after the
   download blob is revoked and no capture remains.
