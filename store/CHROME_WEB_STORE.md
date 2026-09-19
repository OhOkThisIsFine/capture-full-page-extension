# Chrome Web Store submission

## Listing copy

**Name:** Capture Full Page

**Short description:**
Capture complete webpages as PNG files, including long pages and nested scrolling web apps.

**Single purpose:**
Create a complete PNG screenshot of the webpage the user explicitly asks to capture.

**Detailed description:**

Capture Full Page saves an entire webpage as a single PNG, including pages that extend beyond the visible viewport and web apps whose main content lives inside a nested scrolling region.

Use either the extension button or the right-click **Capture full page** command. The extension scrolls through the active page, assembles the captured viewports locally, restores the page, and downloads the PNG.

For complex app-style layouts, Capture Full Page can temporarily expand nested scrolling content while preserving surrounding headers, sidebars, and toolbars.

**Privacy disclosure:** When you invoke Capture Full Page, the extension temporarily reads and adjusts the active page and captures its visible pixels to create the requested screenshot. The page content, screenshot, active URL, and page title are processed locally and are not transmitted to the developer or any third party.

No account, analytics, telemetry, ads, tracking, or remote code.

## Permission justifications

**activeTab**
Needed to access only the active page after the user explicitly clicks the extension or context-menu command. This avoids broad persistent host permissions.

**scripting**
Needed to inject the capture logic that measures the page, scrolls it, handles nested scrolling containers, and restores temporary layout changes.

**downloads**
Needed to save the completed PNG to the user's device.

**contextMenus**
Needed to expose the user-invoked right-click "Capture full page" command.

**offscreen**
Needed only on Chromium to assemble captured viewport tiles and encode the PNG in a browser-managed offscreen document.

## Privacy Practices dashboard

The extension handles sensitive data because screenshots/page capture count as handling website content even when processing is local.

Recommended disclosures, matching the actual code:

- Website content: **Yes — processed locally only**
- Web browsing activity / active page URL: **Yes — current hostname/title are used locally to name the file**
- Personally identifiable information: **No separate collection**
- Health information: **No separate collection**
- Financial/payment information: **No separate collection**
- Authentication information: **No separate collection**
- Personal communications: **No separate collection**
- Location: **No separate collection**
- Data sold to third parties: **No**
- Data transferred to third parties: **No**
- Personalized advertising: **No**
- Human access to user data: **No**

Certify the Chrome Web Store Limited Use statements.

## Privacy policy

A public URL is required in the Developer Dashboard. The repository contains:

- `PRIVACY.md`
- `docs/privacy.html`

Host `docs/privacy.html` at a public HTTPS URL before submission and enter that URL in the privacy policy field.

## GitHub automation

After the one-time Chrome Web Store item, listing/privacy setup, OAuth credentials, and GitHub variables are configured, tagged releases publish automatically through `.github/workflows/publish-stores.yml` using the Chrome Web Store API v2.

See `store/AUTOMATION_SETUP.md` for the exact secrets and variables.

## Package

Run:

```
python scripts/build.py --target chrome
```

Upload the generated `dist/capture-full-page-chrome-<version>.zip`.

## Final dashboard checklist

- Developer account has 2-step verification enabled.
- Store listing has at least one screenshot.
- Icon and description are present.
- Single-purpose statement is entered.
- Every requested permission has a justification.
- Privacy Practices disclosures match the policy and code.
- Public privacy-policy HTTPS URL is entered.
- Distribution settings are selected.
