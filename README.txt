Capture Full Page v5.0.0

WHAT CHANGED
- For large nested scrolling regions (Google Calendar-style apps), the extension
  now first tries to temporarily expand/unlock that scroller IN PLACE and then
  capture the whole document. This preserves surrounding headers, sidebars, and
  app chrome instead of cropping the screenshot to the inner calendar/grid.
- The unlock logic follows FireShot's strategy: relax overflow/height constraints
  through the ancestor chain and account for flex/grid/absolute/fixed layouts.
- If expansion does not work, it falls back to the previous nested-scroller mode.
- The capture boundary is still frozen before capture, so new lazy/infinite content
  is not chased.
- FireShot-style overlap/cropping, 1:1 compositing, animation freezing, anchored
  element suppression, and 8192px chunking are retained.

INSTALL
1. Unzip this archive.
2. Open chrome://extensions
3. Remove/reload the prior test version.
4. Enable Developer mode.
5. Click Load unpacked and select capture-full-page-v5-app-shell.

USE
Right-click an ordinary webpage -> Capture full page.

DOWNLOAD PROMPT
The extension uses saveAs:false. Chrome's global setting
"Ask where to save each file before downloading" must also be off for a fully
automatic download.

NOTE
Complex web apps use many different layout strategies. This version specifically
adds the app-shell-preserving path needed by pages whose main content lives inside
a large nested scroller.
