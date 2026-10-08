# Loaded-folder update and one-shot helper evidence

Owner-authorized disk update on E-DESK-5060:

- `C:\Code\capture-full-page-extension`: clean `master`, raw/effective origin both
  `https://github.com/OhOkThisIsFine/capture-full-page-extension.git`. Updated by fast-forward
  from `3f509f2fb1a8686b69633fa1b0659ff6779d46e3` to exact independently reviewed merged
  `a6326a67fd40f6ea60c3dcbb9bb2324b18caa813`; manifest version 5.1.0 to 5.3.0.
- `C:\Code\reddit-autoblocker`: unchanged clean `master` at
  `eb50f95b197d239c7ed562e27721b505363de1a4`, version 0.3.0.
- Applicable AGENTS instructions were read first. Capture has none; Reddit documents root-folder
  unpacked loading and no build step. No browser profile, storage, settings, reload, live capture,
  Reddit action, extension installation or launcher installation occurred.

Exact update commands ran from the Capture loaded folder. `$target` was
`a6326a67fd40f6ea60c3dcbb9bb2324b18caa813`; `$hookRoot` was the verified empty task-owned
`C:\Users\ethan\Documents\Codex\2026-10-06\task-6\integration-evidence\empty-update-hooks`:

```powershell
$gitOptions = @('-c',('core.hooksPath='+$hookRoot),'-c','core.fsmonitor=false',
  '-c','submodule.recurse=false','-c','merge.autoStash=false',
  '-c','filter.lfs.process=','-c','filter.lfs.smudge=','-c','filter.lfs.required=false')
git config --get remote.origin.url
git remote get-url origin
git ls-remote origin refs/heads/master
git @gitOptions fetch --no-recurse-submodules origin refs/heads/master:refs/remotes/origin/master
git rev-parse refs/remotes/origin/master
git @gitOptions merge-base --is-ancestor HEAD $target
git @gitOptions status --porcelain=v1 --untracked-files=all
git ls-tree -r --name-only $target
git @gitOptions merge --ff-only --no-edit --no-autostash $target
git rev-parse HEAD
git @gitOptions status --porcelain=v1 --untracked-files=all
```

Passed: exact origin/remote target, clean pre/post checks, ancestor exit0, no target .gitattributes
or .gitmodules, successful fast-forward and exact final HEAD/version. Disk receipts are retained
at task-owned `integration-evidence/folder-update-disk-receipt.json`.

The review helper adds `--no-overwrite-ignore`, disables every configured checkout filter,
hooks/fsmonitor/maintenance per command, rejects target filter/encoding attributes/submodules
and manifest identity-key changes, and validates both chosen master candidates before applying.
No arbitrary latest release, repository scripts, background service, scheduled task, new credential,
policy bypass, reset/force/stash/clean or recursive deletion is used. It has not been installed or
run against the real loaded repositories; independent review is required before installation.

Validation from the separate `capture-updater` review worktree:

```powershell
powershell.exe -NoProfile -File tests\folder-updater.test.ps1
git diff --check
```

Historical initial component: **passed 17 safety cases**, real disposable synthetic Git histories with remote observations/fetch
explicitly replaced; no network or browser. Cases cover actual fast-forward/version, disabled real
post-merge hook, preserved dirty/untracked files, divergence, raw and rewritten origin mismatch,
stale pin, remote drift during fetch, in-progress Git operation, wrong branch, invalid pin,
HEAD drift, late local edit, remote filter attribute, remote gitlink, preserved ignored-file collision
and identity-key change. PowerShell parser reports zero source syntax errors.

Final retained log: `integration-evidence/folder-updater-tests-final.log`, SHA256
`31007b96a5c55b119fb26cd6fa5039421136f7ae67d291d20a60b49bc73fc1ca`.
Final fixture root: `C:\Users\ethan\AppData\Local\Temp\folder-updater-test-020c3a8eb43941478a33a9d500556933`.
Earlier synthetic experiments failed because multiple Git PATH matches were combined and a gitlink
fixture was not clean; executable selection and fixture setup were corrected. The final assertions
remain intact. Product source files were not modified by this helper branch; product/native tests
were not rerun for this tooling-only change. Browser activation/functionality is not run.

## Independent review repairs

Every helper Git invocation now uses `--no-replace-objects`, including graph, tree, manifest and
checkout operations. Existing replacement refs are preserved. Production Git options clear
`branch.master.mergeOptions` per command; merge additionally specifies `--no-squash`.

Final exact updated source: **19 safety cases passed**, same command above, no network/browser.
The new real Git fixture substitutes a pinned commit with an acyclic same-parent commit whose
manifest is99.0.0; ordinary Git proves substitution active. The helper still verifies/checks out
the original2.0.0 tree and exact pinned HEAD, leaving the replacement ref intact. The suite also
demonstrates actual inherited `--squash` writing/staging files without changing HEAD in a separate
disposable fixture. It then exercises actual `Start-FolderUpdate`, substituting only the internal
two-repository plan provider and remote observations/fetch with synthetic fixtures. All production
Git option construction, filter enumeration, temporary empty hooks lifecycle, manifest verification
and both actual merges run. Both clean final HEADs/versions are correct despite squash/replacement
settings; persistent local merge configuration remains unchanged.

Final log `integration-evidence/folder-updater-review-fixes-tests.log`, SHA256
`fe85df0bba44e6913adc41539be94d6856a2aa026bd935a9d20867a9272e40b7`.
Final fixture root `C:\Users\ethan\AppData\Local\Temp\folder-updater-test-f3bae0b6c5544359a1fbad2ab2fa4a42`.
Two exact test-file controls reintroduce the defects in retained task-owned copies: omitted
replacement flag fails with "Pinned manifest was substituted by replacement ref"; omitted production
merge-options clearing fails with "Missing production Git option: branch.master.mergeOptions=".
Both controls exit1 as expected; actual source remains green. Earlier test-only lifecycle observation
ran after its temporary hooks directory had been removed, and a persistent-config check initially
read the intentional per-command override. Test observation was restricted to the active lifecycle
and Git `config --local --get` now verifies persistent configuration; assertions were retained.

The owner subsequently approved a scheduled closed-Brave updater. This manual component has not
been installed and does not itself satisfy fully automatic updating. Scheduling/activation require
a separately reviewed implementation that addresses launch-during-write, not just a process check.
