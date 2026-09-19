# Store publishing automation

The repository can publish releases to GitHub, Firefox Add-ons (AMO), and the Chrome Web Store from GitHub Actions.

## Release behavior

Pushing a tag matching `v*` runs `.github/workflows/publish-stores.yml`.

For example, after bumping both manifests to 5.4.0:

```
git tag v5.4.0
git push origin v5.4.0
```

The workflow:

1. verifies that the tag matches `manifest.json`;
2. runs JavaScript syntax checks;
3. builds the Chrome and Firefox packages;
4. runs Mozilla's current `web-ext lint`;
5. creates/updates the matching GitHub Release and attaches both ZIPs;
6. submits the Firefox package to AMO; and
7. uploads and submits the Chrome package for review/publication.

The workflow can also be run manually from GitHub Actions with `build-only`, `chrome`, `firefox`, or `both`.

## One-time GitHub configuration

Open:

**Repository → Settings → Secrets and variables → Actions**

### Firefox secrets

Create these repository secrets:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

Get them from the AMO API credentials page while logged into the Mozilla account that will own the extension.

Create this repository variable:

- `AMO_LICENSE`

This must be one of AMO's accepted license identifiers. This repository deliberately does not choose the software-distribution license for you. For example, Mozilla's documentation uses `MPL-2.0` in its sample metadata.

Current `web-ext` can create the first public AMO listing as part of `web-ext sign --channel=listed`, so no manual initial package upload is required once the API credentials and license variable exist.

### Chrome Web Store secrets

Create these repository secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

Create these repository variables:

- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`

The OAuth client/refresh token must have the Chrome Web Store scope:

```
https://www.googleapis.com/auth/chromewebstore
```

The publishing script uses the current Chrome Web Store API v2.

## One-time Chrome dashboard setup

Chrome Web Store API v2 cannot create a new store item. Before GitHub can publish Chrome releases:

1. Register/verify the Chrome Web Store developer account and enable 2-step verification.
2. Create the extension item once in the Chrome Web Store Developer Dashboard.
3. Fill out the Store Listing and Privacy tabs.
4. Configure the item's visibility/distribution.
5. Put its extension ID and your publisher ID into the GitHub repository variables above.
6. Configure the Chrome Web Store API OAuth credentials and add them as repository secrets.

After that, GitHub can upload future versions and submit them for review/publication automatically.

## Privacy policy hosting

`.github/workflows/publish-privacy-pages.yml` deploys `docs/privacy.html` to GitHub Pages.

One-time GitHub setting:

**Repository → Settings → Pages → Source → GitHub Actions**

After the first successful deployment, use the workflow's deployment URL as the Chrome Web Store privacy-policy URL. For the normal GitHub.com Pages hostname this is expected to be:

```
https://ohokthisisfine.github.io/capture-full-page-extension/
```

If GitHub Pages is unavailable for this private repository under the account's GitHub plan, move only the privacy-policy page to a public Pages-capable repository or another public HTTPS host; the extension code itself can remain private.

## Manual publication

From **Actions → Publish extension stores → Run workflow**, choose:

- `build-only` to validate/package without publishing;
- `firefox` to submit only to AMO;
- `chrome` to submit only to Chrome;
- `both` to submit to both.

## Safety

Chrome publication uses `blockOnWarnings: true`, so Chrome Web Store warnings stop automatic publication rather than being ignored.

Firefox uses `--approval-timeout 0`; the GitHub job submits the version and exits without waiting for a potentially long human review.
