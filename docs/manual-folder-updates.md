# Manually update the two existing unpacked extension folders

Automatic local updating was canceled; earlier automatic-updater approvals are superseded. The retained `scripts/update-loaded-folders.ps1` and adjacent `.cmd` wrapper are one-shot manual tools. Their source presence does not authorize updating loaded folders, installing helpers, or controlling Brave.

The tool intentionally targets **both** `C:\Code\capture-full-page-extension` and `C:\Code\reddit-autoblocker`. Select and review both exact owner `master` commits, and obtain authorization for both targets before a manual run. A Capture-only request must not implicitly update Reddit. There are no executable default targets: no arguments, either omitted SHA, malformed SHA, or uppercase SHA refuses before Git, temporary-directory creation, or checkout access. `-DefineOnly` imports functions without running an update.

From a separately approved helper location, an explicit run has this form; replace both placeholders with reviewed lowercase 40-hex commits:

```powershell
powershell.exe -NoProfile -File scripts\update-loaded-folders.ps1 -CaptureCommit <reviewed-Capture-SHA> -RedditCommit <reviewed-Reddit-SHA>
```

The adjacent `.cmd` wrapper forwards the same arguments. A no-argument double-click refuses. If PowerShell policy refuses execution, stop rather than bypass it. Do not automatically select latest master, download refreshed helpers, or schedule the tool.

The helper verifies ordinary exact roots, expected raw/effective HTTPS origins, `master`, clean tracked/untracked state, hidden index flags, and Git operations. It refuses changed remote master, divergent/ahead history, manifest identity-key changes, submodules, and checkout filter/encoding attributes. The chosen target must still equal remote master: a changed remote requires review, not replacement with an unreviewed commit.

Both candidates are preflighted before either tree changes. A subsequent failure can leave the first folder successfully updated; no automatic rollback is attempted. Stop other editors/Git operations during the run; the tool is not a filesystem lock. Every Git call uses `--no-replace-objects`, preserving existing replacement refs while preventing substitution of the pinned graph, manifest, or checkout. Inherited `branch.master.mergeOptions` is cleared per command; merges explicitly disable squash and allow only fast-forward updates.

Nothing resets, stashes, cleans, forces, builds, tests, or installs repository code. Hooks, filters, fsmonitor, and automatic maintenance are disabled per Git command. The helper creates no service, task, or credentials and changes no persistent Git or PowerShell policy. Existing ignored files and extension storage are preserved; conflicting ignored/untracked files cause ordinary merge refusal. Temporary cleanup removes only the newly created empty hooks directory. Git authentication may use the existing credential helper.

After a separately authorized successful disk update, open `brave://extensions` and click **Reload** for each relevant already-installed extension, then refresh affected tabs and verify ordinary functionality. Keep the same folder and extension identity. Disk updates alone do not establish the active browser version. This documentation/source retirement did not perform a local update, browser reload, or native smoke test.

## Historical observations

The former 5.3.0/0.3.0 target commits and machine/disk observations are retained in [the 2026-10-08 evidence](evidence/2026-10-08/folder-updater.md). Those pins are historical, not executable defaults or current approvals. Historical automatic repair evidence remains [here](evidence/2026-10-08/automatic-review-fixes.md). See [the retirement notice](automatic-folder-updates.md) and [reviewed retirement plan](plans/2026-10-13/updater-retirement-plan.md).
