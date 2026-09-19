# Capture regression fixtures

These fixtures exercise the capture paths that have historically been fragile.

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
