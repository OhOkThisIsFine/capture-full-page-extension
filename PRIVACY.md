# Capture Full Page Privacy Policy

**Effective date:** September 19, 2026

Capture Full Page creates full-page screenshots only when the user explicitly invokes the extension from its toolbar popup or context menu.

## Data the extension accesses

To create a screenshot, the extension temporarily accesses the contents and layout of the active webpage, captures visible page pixels while scrolling, and reads the active tab's title and URL to create a useful local filename.

This information can include website content and information contained in the active page. The extension accesses it only as necessary to perform the user-requested screenshot operation.

## How data is used

Page information is used only to:

- measure and temporarily adjust page layout for full-page capture;
- capture and assemble screenshot tiles;
- create the downloaded PNG; and
- create the PNG filename from the active page title and hostname.

The extension may temporarily scroll the page, disable animations, or adjust scrolling containers during capture. It restores the page afterward.

## Data transmission and sharing

Capture Full Page does **not** transmit page content, screenshots, browsing information, URLs, titles, or other user data to the developer or to third parties.

The extension has:

- no analytics or telemetry;
- no advertising or tracking;
- no account system;
- no developer-operated server;
- no sale of user data; and
- no remotely hosted executable code.

All screenshot processing occurs locally in the browser.

## Storage and retention

Screenshot data is held temporarily in browser memory while the PNG is being assembled. Temporary object URLs are revoked after use. The completed PNG is saved to the user's device through the browser's download system.

The extension does not maintain a database of browsing history, screenshots, or page content. The browser or operating system may independently retain normal download history or the downloaded file according to the user's own settings.

## Permissions

- **activeTab** — grants temporary access to the page only after the user invokes the extension.
- **scripting** — injects the capture script into the active page.
- **downloads** — saves the completed PNG to the user's device.
- **contextMenus** — provides the "Capture full page" right-click command.
- **offscreen** (Chromium only) — provides a browser-managed document used locally to assemble and encode screenshot tiles.

## Chrome Web Store Limited Use

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes

If the extension's data practices change, this policy will be updated before the changed behavior is released.

## Contact

For privacy or support questions, use the developer support contact shown on the extension's Chrome Web Store or Firefox Add-ons listing.
