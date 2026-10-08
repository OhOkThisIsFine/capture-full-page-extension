# Automatic updater review repairs

Source bases: Capture `bff0f1f34263c5e5dbdf8fa3ce54a5ce5c730cca`, Reddit
`591e56aff6a6ce6b60c4482490586b0f82cad9ba`. The follow-up is limited to the four reviewed findings.
No installation, task registration, loaded-folder change, native browser action, profile change,
provider request or new permission occurred. The previously approved narrow alarms permission
and forced-reload policy are unchanged; no idle protocol is introduced.

- Before live C mutation, reserve the exact completed B marker whose commit/version matches the
  current checkout. Atomic rename retains its bytes in the existing ignored temporary namespace.
  Foreign/stale/malformed metadata causes a skip, preserving local data. Changed reservation bytes
  are restored without overwrite where possible and mutation is refused.
- Reject `local-update-state.json` in the selected target tree before bootstrap or live mutation,
  even when the current checkout contains no marker. Current-index checks remain too.
- Both worker watchers fetch their own disk manifest without caching and require its version to
  equal the completed marker. Re-read the exact marker after manifest inspection, so reservation
  also invalidates an earlier in-flight B response. Same/older versions and rollback mismatches
  cannot trigger reload across repeated worker starts. Force behavior remains without idle wait.
- The installer is standalone: no helper dot-source before verification. Reject hidden index flags
  and compare all three scripts with reviewed raw Git blob bytes before any copy/import. Copies
  come from verified bytes, not a potentially changed local file. Converted bytes are refused.

Passed commands from the review worktrees:

```powershell
powershell.exe -NoProfile -File tests\automatic-updater.test.ps1
node --require ../p7-evidence/isolation.cjs --test --test-isolation=none --test-timeout=15000 tests/*.test.cjs
npm.cmd run check
git diff --check
```

The Reddit check reuses existing `C:\Code\reddit-autoblocker\node_modules` through process-local
NODE_PATH/PATH, restored afterward. No dependencies were installed. Capture passes **169/169**
isolated source tests, zero failures/skips/cancellations. Reddit syntax/lint/existing mock suites
and **9 actual-source watcher cases** pass. PowerShell passes **19 Git-safety cases,18 automatic
promotion cases and2 installer cases**. All Git histories/remote observations/CI/task APIs are
synthetic; real task API calls0 and imported helper executions0 in the installer regression.

The actual automatic entry point's B-to-C fixture observes absence of B at the first live mutation,
then verifies preserved B bytes and only complete C publication. Additional fixtures preserve a
foreign marker and reject a clean bootstrap target tracking the reserved marker. Both hidden-index
flags (`assume-unchanged`, `skip-worktree`) demonstrably hide edits from ordinary status; installation
still refuses before helper execution or task APIs. The exact-blob byte guard is also exercised
directly against those altered helpers. Both watchers run repeated rollback and in-flight marker
reservation cases using their actual source, not copied implementations.

Retained final logs in the task-owned integration-evidence folder:

| File | SHA256 |
| --- | --- |
| automatic-review-fixes-tests-final.log | 73c34995c92566ed07b35b1511cac2596b362390a58648f1ae4f2cb0906b68ea |
| automatic-review-capture-source-final.log | 2584578c8eab038cc9ce98b33443afcf78c23bd98d1e814c6d385211c9781894 |
| automatic-review-reddit-check-final.log | 3a1a197742aef116249c80cb95c4ebc3c9d186dc1057221ff82d7eaa5cf26ea1 |

Final synthetic fixture root:
`C:\Users\ethan\AppData\Local\Temp\folder-updater-test-3081e8d058684e988533147356640715`.
An initial installer fixture exposed a .NET async void-result leaking into returned blob bytes;
the void result is now suppressed. An imported test's `exit1` initially failed to propagate to its
caller; imported failures now throw, and the complete final suite succeeds with the assertions intact.
Those earlier failures are historical experiments, not passed results. No assertions were weakened.

Approved workflow blobs are unchanged (Capture `a90b1f2f02feca9750239dda2a64d6f6dcc7dcbb`,
Reddit `fb813a06a138cb874b37ef6e77746b9b4ad04c0a`); no pin refresh is required. Independent follow-up
review still precedes installation. One owner Reload per extension after deployment remains the
bootstrap; actual Brave marker-read/self-reload remains unrun.

Windows CI run 37723202276 at Capture 43b2bf70627e64cf4c4c24d57c932dc77015ad2f failed the positive installer fixture: the host checkout supplied CRLF bytes, while synthetic Git's inherited autocrlf setting committed LF bytes. The fixture now sets core.autocrlf=false in its disposable repository so it commits the exact supplied bytes. Production exact-blob verification remains unchanged and refuses converted source bytes. Standalone verification after the fixture correction passed: `powershell.exe -NoProfile -File tests\installer.test.ps1` (19 Git-safety cases and 2 installer cases), retained in `automatic-installer-exact-byte-final.log`. The failed CI run is not a passed result; the follow-up commit requires its own CI verification.
