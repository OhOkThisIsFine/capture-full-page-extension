# Automatic updates for the two unpacked Brave extensions

Source checkpoint only: no scheduler is installed and actual Brave marker-read/self-reload is unrun.
The owner approved updates while Brave remains open, including forced extension reload during work.
The earlier manual launcher is a reusable Git-safety component, not the completed automatic setup.

The prepared per-user task checks every15minutes and at logon using the existing interactive user,
limited privileges and existing Git/GitHub authentication. It does not save a password, elevate,
change execution/browser policy, control Brave, refresh tabs or add a native host. Interactive
credential prompts are disabled for the run; missing existing access causes a recorded skip.

Only `C:\Code\capture-full-page-extension` and `C:\Code\reddit-autoblocker` are eligible. Each must
remain an ordinary clean root checkout on `master`, with the expected raw/effective HTTPS origin,
no local edits/untracked conflicts/hidden index flags, and fast-forward ancestry. The selected exact
owner-master SHA must have successful push CI with the pinned reviewed workflow blob. Changed CI
definitions require separate review and updating that pin. A different commit without a strictly
newer manifest version is skipped; arbitrary same-version commits do not become automatic releases.

The updater stages each candidate in a new detached task-owned snapshot and verifies all raw Git
blobs before changing the loaded folder. The selected tree must not track the reserved local marker.
Before live mutation, the exact marker belonging to the current HEAD/version is atomically reserved
under an ignored unique filename, retaining its bytes. Foreign, stale or changed markers are preserved
and cause a skip. Completed B cannot authorize a reload during later checkout C.
Git hooks, checkout filters, replacements, inherited squash,
recursive submodules and maintenance are disabled/refused. The loaded folder is fast-forwarded,
HEAD/status and every tracked file are read back, then `local-update-state.json` is published LAST
with an atomic same-directory file rename/replace. Failed/partial updates never publish a newer
completion marker. Retained snapshots are bounded by a128MiB staging budget; no automatic deletion
or cleanup of existing worktrees occurs. Both scheduler IgnoreNew and a process mutex prevent
overlapping automatic promotions. A partial failure is preserved/reported, not reset or rolled back.

This is the approved minimal marker-last guard against reloading a half-written checkout, not an
atomic multi-file Git transaction or an idle/quiescence protocol. Work already executing during the
checkout can be interrupted, as the owner explicitly accepted. The watcher does not initiate reload
on a preparing/partial file set: only the later validated completion marker can qualify a new version.

Capture5.3.1 and Reddit0.3.1 add only the narrow `alarms` permission. Their workers recreate/ensure
a1-minute alarm at startup, fetch only their own marker with no-store/nonce and a5-second abort,
and compare its strict release version with the loaded runtime manifest. A strictly newer valid
marker triggers `chrome.runtime.reload()` immediately, without checking idle state. Missing, invalid,
same-version or older markers do nothing. A fresh own on-disk manifest must match the marker version,
then a fresh marker read must still match the completed bytes. A leftover marker after manual rollback
cannot cause repeated reloads across worker recreation. There is no in-memory marker baseline and no new storage,
host access, telemetry or remotely fetched executable code. Existing Reddit content tabs are not
refreshed/reinjected automatically; they can receive new content code on their next normal navigation.

After independent source review and successful exact-head CI, the authorized installation command
from a clean reviewed Capture source checkout is:

```powershell
powershell.exe -NoProfile -File scripts\install-automatic-updater.ps1 -ReviewedCommit <exact-reviewed-source-SHA>
```

The installer refuses existing task-name conflicts or a nonempty/unrecognized install directory.
Before any helper import/copy, the standalone installer rejects hidden index flags and verifies all
three scripts against exact reviewed raw Git blob bytes. It never dot-sources updater code. A converted
CRLF checkout is refused, not normalized; use the reviewed exact-byte task checkout.
It copies only the two verified Git-blob updater scripts to `%LOCALAPPDATA%\OwnerExtensionUpdater`, verifies
their hashes, registers the limited interactive task and checks its actual target/principal/settings.
No installation was run at this checkpoint. Logs are `last-run.json`; registration receipts are
`installation.json`, explicitly with browserReloadObserved=false until actual native evidence exists.

One unavoidable bootstrap: once both watcher releases are on disk, the owner clicks **Reload once
for each extension** in Brave. Thereafter tested version-bumped releases can trigger self-reload.
Supported tool access cannot currently inspect/control Brave extension management; no denied-page
workaround is used. Actual Brave local-marker read and self-reload must be observed before declaring
automatic activation working. Source tests, source publication, task registration and browser activation
are separate evidence. No store publication is required for this unpacked-folder route.
