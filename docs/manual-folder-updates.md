# Update the two unpacked Brave extension folders

This one-shot helper is a review candidate, not installed. After independent review, keep
`scripts/update-loaded-folders.cmd` beside `scripts/update-loaded-folders.ps1` in an approved
location. Double-click the `.cmd` to run once. It uses existing Git authentication, creates no
service/task/credentials, changes no persistent Git or PowerShell policy, and does not control Brave.
If PowerShell policy refuses it, stop rather than bypass the policy.

The exact default owner-approved targets are:

| Existing loaded folder | Reviewed master commit | Disk version |
| --- | --- | --- |
| `C:\Code\capture-full-page-extension` | `a6326a67fd40f6ea60c3dcbb9bb2324b18caa813` | 5.3.0 |
| `C:\Code\reddit-autoblocker` | `eb50f95b197d239c7ed562e27721b505363de1a4` | 0.3.0 |

Capture was already fast-forwarded to this exact commit during the authorized update; Reddit was
left unchanged. Both checkouts were clean afterward. These are disk observations, not Brave's
active version. No browser reload, install, profile inspection or permission change occurred.

The helper verifies ordinary exact repository roots, expected raw/effective HTTPS origins, `master`,
all local edits/untracked files and Git operations. It refuses changed remote master, divergent/ahead
history, manifest identity-key changes, submodules and checkout filter/encoding attributes. Both candidates are preflighted before
either tree changes. A subsequent failure can leave the first repo successfully updated: there is no
automatic rollback. Stop other editors/Git operations during the short run; it is not a filesystem lock.
Only fast-forward merges are allowed. Nothing resets, stashes, cleans, forces, builds, tests or installs
repository code. Hooks, filters, fsmonitor and automatic maintenance are disabled per Git command.
Existing ignored files and extension storage are not deleted; conflicting ignored/untracked files cause
Git's ordinary merge refusal. Temporary cleanup removes only the helper's newly created empty hooks
directory. Origin authentication may use the user's existing Git credential helper.

For later updates, first choose and review exact owner `master` commits. Run the reviewed script with
explicit `-CaptureCommit <40-character SHA> -RedditCommit <40-character SHA>` arguments. It deliberately
does not execute an arbitrary latest release or repository update script. Defaults become stale and
refuse if either remote advances. Review/installing a refreshed helper is a separate action.

After success, **click Reload for the relevant extension in `brave://extensions`, then reload affected
tabs**. Loading the same folder preserves its location; the helper does not remove/re-add extensions,
change their identity or touch Brave storage. Browser activation and actual functionality remain
unverified until that user action and an ordinary-use check.
