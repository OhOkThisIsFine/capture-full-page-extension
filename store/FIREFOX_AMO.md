# Firefox Add-ons (AMO) submission

## Compatibility

The Firefox package uses Manifest V3 with a Firefox background document:

```json
"background": {
  "scripts": ["offscreen.js", "service-worker.js"]
}
```

Firefox does not use Chromium's `offscreen` permission. The compositor runs directly in the background document.

The manifest sets Firefox 126 as the minimum version because current Firefox supports `tabs.captureVisibleTab()` with the temporary `activeTab` permission from Firefox 126 onward, avoiding an `<all_urls>` host permission.

The fixed add-on ID is:

```
capture-full-page@ohokthisisfine.github
```

Change it only **before the first AMO submission** if a different permanent ID is preferred. Once the first release is submitted, keep the ID stable.

## Listing copy

**Name:** Capture Full Page

**Summary:**
Capture complete webpages as PNG files, including long pages and nested scrolling web apps.

**Description:**

Capture Full Page saves an entire webpage as a single PNG. It handles ordinary long pages as well as app-style pages where the main content lives inside a nested scrolling region.

Invoke it from the extension button or the right-click **Capture full page** command. The extension performs the capture locally, restores temporary page changes, and saves the PNG through Firefox's download system.

No account, analytics, telemetry, advertising, tracking, remote services, or remote executable code are used.

## Firefox data-collection declaration

The manifest declares:

```json
"data_collection_permissions": {
  "required": ["none"]
}
```

This is intentional: page content is processed locally to provide the requested screenshot and is not collected or transmitted outside the extension.

## Reviewer notes

Suggested notes for AMO reviewers:

> Capture Full Page is a local screenshot utility. It requests activeTab only after an explicit user action, injects content.js to measure/scroll the page, captures visible viewports, and assembles the PNG locally. Firefox loads offscreen.js and service-worker.js as background scripts; offscreen.js contains the local compositor. The extension makes no network requests, includes no analytics or remote code, and transmits no user data.

## GitHub automation

Firefox can be submitted from the first public version onward by GitHub Actions. Current `web-ext sign --channel=listed` can create the AMO listing when the required metadata and API credentials are supplied.

See `store/AUTOMATION_SETUP.md` for the required AMO secrets and license variable.

## Package

Run:

```
python scripts/build.py --target firefox
```

Upload the generated `dist/capture-full-page-firefox-<version>.zip` to AMO, or load `dist/firefox/manifest.json` temporarily from `about:debugging` for testing.

## AMO listing checklist

- Upload the Firefox ZIP.
- Resolve any AMO validator findings.
- Enter the summary and description above.
- Select an appropriate category (use **Other** if no closer category is offered).
- Choose the license under which the extension will be distributed. The repository intentionally does not choose one on your behalf.
- Add a support contact/site.
- Confirm no payment or external service is required.
- Data collection is declared as **none**.
- A privacy policy is not required by AMO when nothing is transmitted, but the same public policy can be linked for clarity.
