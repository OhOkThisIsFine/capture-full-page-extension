# Retire the canceled extension automatic updater

Prepared 2026-10-13. Planning only: no repository edits, pushes, task registration, local commands, computer access, or extension activation were performed.

## Decision and bounds

The owner's instruction was: “Terminal windows keep popping up on my machine. My guess is that it's the extension auto updater thing that we built. Let's just get rid of that.”

Treat automatic local updating as canceled. Prior implementation approvals are historical, not permission to restore it. Local removal remains recorded as completed; this review does not reopen that work or independently reverify the computer. The repository cleanup below closes the remaining source/documentation route to accidental revival. It does not diagnose the terminal windows afresh, reinstall anything, modify loaded folders, publish a store release, or implement unrelated extension features.

Verified master baselines:
- Capture: 924dc8aa6b487cb23d9987c10fb975d7441269e4.
- Reddit: efea95eec2f39cb09095fce7c6bd18f83b12d083.

Recheck heads before implementation; preserve unrelated newer changes.

## Why both repositories are in scope

The Windows automatic runner lives only in Capture and explicitly coordinates both loaded folders ([repository specifications](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/scripts/automatic-folder-updater.ps1#L1-L10)). Capture's installer copies the automatic/manual helpers and registers OwnerExtensionFolderUpdater for periodic/logon execution ([installer](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/scripts/install-automatic-updater.ps1#L115-L151)). Source review found no automatic invocation of that installer merely from loading an extension.

Each extension separately retains the same local-marker watcher: [Capture service-worker.js 1–67](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/service-worker.js#L1-L67) and [Reddit background.js 3–69](https://github.com/OhOkThisIsFine/reddit-autoblocker/blob/efea95eec2f39cb09095fce7c6bd18f83b12d083/background.js#L3-L69). It creates owner-folder-update-v1 every minute, fetches local-update-state.json, and calls runtime.reload after validation. This browser watcher does not itself launch Windows terminals or reinstall the scheduled task. Retire both ends of the canceled workflow, without expanding into a general Reddit review.

## Exact source changes

### Capture

1. Delete scripts/install-automatic-updater.ps1 and scripts/automatic-folder-updater.ps1 in full. Git history remains the implementation archive. Do not relocate executable copies into an active tools directory or replace them with a “repair,” startup, or self-install path.
2. Delete the complete owner-folder-update:begin through owner-folder-update:end block at service-worker.js 1–67. Preserve all following capture implementation, beginning with the capture-protocol import at line 69.
3. Remove only the "alarms" item from manifest.json permissions ([lines 7–14](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/manifest.json#L7-L14)). Preserve contextMenus, activeTab, scripting, downloads, and offscreen. Do not remove or replace the service worker.
4. Do not change Firefox permission or background declarations: [manifest.firefox.json](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/manifest.firefox.json#L6-L32) already lacks alarms and depends on the shared worker. Preserve protocol/offscreen/worker load order.
5. Delete tests/automatic-updater.test.ps1 and tests/installer.test.ps1, which exercise the deleted automatic route. Replace tests/auto-update.test.cjs with a retirement regression, preferably renamed tests/updater-retirement.test.cjs. The old test explicitly requires the watcher and alarms permission ([old assertions](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/tests/auto-update.test.cjs#L77-L83)); simply leaving it or weakening its assertions is incorrect.
6. Remove only the automatic-promotion test step at [.github/workflows/build-extension.yml 19–20](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/.github/workflows/build-extension.yml#L13-L20). Retain the Windows manual folder safety job and its tests/folder-updater.test.ps1 step. Preserve all unrelated build, publisher, release, lint, and capture tests.

### Reddit: shared-watcher cleanup only

1. Delete background.js 3–69, the exact owner-folder-update block. Preserve normal background logic after it, including rule loading, context menus, authentication, dispatch queue, retry/backoff, storage, and dry-run behavior.
2. Remove only "alarms" from [manifest.json line 7](https://github.com/OhOkThisIsFine/reddit-autoblocker/blob/efea95eec2f39cb09095fce7c6bd18f83b12d083/manifest.json#L6-L14). Preserve the identity key, storage, scripting, contextMenus, host permissions, and background registration.
3. Replace test-auto-update.js with test-updater-retirement.js; replace only its import at [test-all.js line 3](https://github.com/OhOkThisIsFine/reddit-autoblocker/blob/efea95eec2f39cb09095fce7c6bd18f83b12d083/test-all.js#L1-L11). Keep all other test imports and asynchronous suite chaining.
4. Leave the existing npm check/test workflow unchanged; it already executes the aggregate tests ([workflow](https://github.com/OhOkThisIsFine/reddit-autoblocker/blob/efea95eec2f39cb09095fce7c6bd18f83b12d083/.github/workflows/tests.yml#L16-L23)). No changes to the reviewed comment-author fallback or six-package product plans are needed.

### Alarm safety and residual state

At these baselines, alarm API references in both production workers are confined to their updater blocks; no alarms/updater references were found in the other shipped production JavaScript inspected (Capture protocol/content/offscreen/popup; Reddit content/popup/rules). Repeat that narrow inventory at implementation time. If a newer revision has a genuine unrelated alarm consumer, retain its required permission and code.

Never use alarms.clearAll, wildcard scheduled-task deletion, recursive updater-directory cleanup, or blanket browser/profile/storage deletion. Keep both repositories' .gitignore entries for /local-update-state.json and /.local-update-state.*.tmp, with a short legacy-residue comment if useful; their purpose becomes preventing old local residue from being accidentally committed. Do not read or delete actual local marker files.

Removing source listeners/permission is a source retirement, not proof that an existing browser alarm or old loaded worker disappeared. The installed/browser state remains separately unverified. Do not retain polling, introduce a new persistent cleanup task, or add a migration release solely on an assumption about alarm persistence. In a later authorized disposable-browser upgrade test, inspect legacy alarm behavior. If named cleanup proves necessary, design it to clear only owner-folder-update-v1 and preserve unrelated alarms; report any resulting permission/rollout tradeoff before expanding this bounded patch. No computer cleanup is authorized by this plan.

## Manual updating: retain the useful safety component, remove stale defaults

Keep scripts/update-loaded-folders.ps1, scripts/update-loaded-folders.cmd, and tests/folder-updater.test.ps1. These are one-shot manual tools, not scheduled automation. Keep their existing exact-origin/root checks, clean-tree refusal, no-replace-objects, disabled hooks/filter/fsmonitor/maintenance, exact remote master comparison, two-folder preflight, fast-forward-only behavior, identity-key checks, and no reset/stash/clean/rollback behavior ([implementation](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/scripts/update-loaded-folders.ps1#L32-L150)).

Change the two default commit parameters at [lines 3–4](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/scripts/update-loaded-folders.ps1#L1-L6) to unset/empty values. Do not replace them with today's heads; those would become stale again. At the beginning of Start-FolderUpdate, before Initialize-UpdateGit or any Git/filesystem operation, require both explicit reviewed lowercase 40-hex SHAs (case-sensitive pattern ^[0-9a-f]{40}$) and produce a clear refusal/help message otherwise. Keep -DefineOnly safe for test imports without prompting or executing a run. Do not make binding itself interactive or mandatory in a way that breaks -DefineOnly.

The .cmd wrapper can continue forwarding explicit arguments ([wrapper](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/scripts/update-loaded-folders.cmd#L1-L8)); a no-argument double-click must now refuse before touching either checkout. Preserve its exit status/policy behavior. Do not add automatic “latest master” selection, downloads of refreshed helpers, bypass-policy switches, or scheduling.

The existing tool intentionally targets both folders. Say that plainly; explicit use requires selecting/reviewing both targets. Do not silently make a Capture-only request update Reddit. A future single-folder redesign is separate scope.

## Documentation changes

1. Replace docs/automatic-folder-updates.md with a short retirement notice and links to the manual guide and historical Git version. Remove its active installation command and present-tense claims of owner approval ([current guide](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/docs/automatic-folder-updates.md#L3-L67)).
   Suggested notice: “Automatic local extension updating was canceled after recurring terminal windows. Earlier approvals are superseded. Do not install, register, restart, or repair this updater without a new explicit request. Updates to the already-loaded folders are manual; see manual-folder-updates.md.”
2. Retain docs/evidence/2026-10-08/folder-updater.md and automatic-review-fixes.md with their historical test counts, hashes, dates, and observations intact. Add a prominent superseded-status notice at the top: results describe the historical implementation and do not authorize installation or reinstatement. This directly qualifies [the later-approval statement](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/docs/evidence/2026-10-08/folder-updater.md#L97-L99) and [the historical repair evidence](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/docs/evidence/2026-10-08/automatic-review-fixes.md#L1-L7). Do not rewrite old results as tests of the retired version.
3. Rewrite docs/manual-folder-updates.md as the current manual-only guide. Remove the introductory recommendation to double-click a default launcher. Move its old 5.3.0/0.3.0 pin table and machine/disk observations into an explicitly historical subsection or link to the existing evidence. Explain that no default target is executable; require explicit reviewed SHAs for both folders. The existing latest-head refusal remains intentional ([current manual guidance](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/docs/manual-folder-updates.md#L3-L42)).
4. Add a concise manual-update link/status note near Capture README.txt's development-install guidance ([lines 64–75](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/README.txt#L64-L75)); add equivalent existing-folder reload guidance in Reddit README.md near installation ([lines 29–35](https://github.com/OhOkThisIsFine/reddit-autoblocker/blob/efea95eec2f39cb09095fce7c6bd18f83b12d083/README.md#L29-L35)). Do not present this as a fresh extension install.
5. Preserve store auto-publication workflows and their documentation. Those are independent of the canceled Windows local updater ([Capture release documentation](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/README.txt#L93-L99)). Do not indiscriminately remove every use of “automatic” in either project.

Current manual flow: choose and review exact target commits for the requested folder(s); update files only through a separately authorized manual operation; open brave://extensions; click Reload on the relevant already-installed extension; refresh affected tabs; verify ordinary functionality. Keep the same folder/extension identity. Updating disk files alone does not establish the active browser version.

## Verification and stopping conditions

These are proposed implementation gates, not tests executed in this planning review.

1. Static retirement checks:
   - Automatic installer/runner and their CI invocation are absent.
   - No shipped worker creates the retired alarm, reads the marker, or self-reloads through this route.
   - Both Chrome manifests omit alarms if the repeated inventory still shows no unrelated consumers; Capture Firefox permissions remain unchanged.
   - No active documentation supplies an installer command or treats historical approval as current.
   - Historical mentions and ignored legacy marker names are allowed; do not use a blanket text ban across evidence.
2. Actual-worker regression tests: run each complete worker, with fully capable updater mocks installed before loading the worker. Provide spies for alarms.get, alarms.create, alarms.onAlarm.addListener, runtime.getURL, runtime.getManifest, runtime.reload, AbortController, timers, and marker/manifest fetches. A harness lacking alarms or reload can make the old watcher return early and falsely pass; it is insufficient for the primary retirement test. Exercise both an absent alarm and an existing owner-folder-update-v1 alarm, each with a valid newer marker and matching on-disk manifest that would activate the old watcher. Across initialization, repeated simulated worker starts, and a synthetic retired-alarm event, assert zero updater alarm get/create/listener registration, zero updater marker/manifest polling, and zero runtime.reload; distinguish any independent application API use. Also run a separate reduced-permission case with no alarms API and verify normal worker initialization. Preserve independent capture/Reddit listener behavior. Do not merely test an extracted replacement snippet or absent comment marker.
3. Manual helper tests: no arguments, either omitted SHA, malformed or uppercase SHA, and direct/wrapper invocation refuse before Git, temp-directory creation, or checkout writes. -DefineOnly remains inert. Explicit valid targets retain the existing successful and refusal-path safety suite. If the early guard checks CaptureCommit and RedditCommit directly, update the retained [production-start fixture at tests/folder-updater.test.ps1 210–238](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/tests/folder-updater.test.ps1#L210-L238): explicitly assign $CaptureCommit = $first.Commit and $RedditCommit = $second.Commit in the scope read by Start-FolderUpdate before invoking it. Its existing seam only replaces Get-LoadedRepositoryPlans; that alone no longer satisfies a direct-variable guard. Preserve both production merge observations and all option/hook/replacement-ref assertions. Confirm a changed remote still refuses rather than selecting a replacement commit.
4. Capture: run the retained PowerShell manual safety suite, JavaScript syntax checks, node --test tests/*.test.cjs, python scripts/build.py, and Firefox web-ext lint exactly as applicable in the retained CI workflow. Inspect both produced packages: no watcher, no Chrome alarms permission, and all required capture/offscreen/background files intact ([build file list and invariants](https://github.com/OhOkThisIsFine/capture-full-page-extension/blob/924dc8aa6b487cb23d9987c10fb975d7441269e4/scripts/build.py#L16-L65)).
5. Reddit: run npm run check (syntax, lint, aggregate mocked tests), retaining all rules, context-menu, safety, lifecycle, and activity tests. No live Reddit requests or account writes.
6. Browser/native smoke tests, only in a separately authorized environment: manual reload of the unchanged-identity extension, Capture popup/context-menu PNG capture, and Reddit dry-run/settings/context-menu registration without performing real bans/hides. Inspect the old alarm migration case in a disposable profile if browser qualification is undertaken. Record not-run items as not run; no claim that current loaded Brave state changed.
7. Stop when the scoped source/docs patch is reviewed and its authorized validation is complete. Publication, any local update/activation, and any further terminal investigation are distinct actions; this plan itself executes none of them.

No release version bump, tag, store submission, permissions expansion, local helper installation, or scheduled task recreation is required to write/review the retirement patch. If release packaging is later requested, handle version changes consistently across both Capture manifests and report activation separately.

