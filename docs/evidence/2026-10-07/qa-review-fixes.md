# Independent QA harness review repairs

This follow-up supersedes the initial155-test harness checkpoint for the reviewed cases.
Final source/test commit: `7076ae5b8fea3b7111758b80ec545bb516662dc5`.
Shipping product files remain identical to `0da8512bc743807ab3eba27ee1416e670b17cbd9`.
No real browser was launched or installed in this follow-up.

The named tile oracle now requires exactly1024x8300 and4096x2200 at scale1. The actual
production8Mi-pixel/max8192-row policy yields seams8192 and2048 respectively. Every pixel
across seam-1, seam and seam+1 is checked, including both horizontal edges. CRC-valid PNG
mutations corrupt seam rows or an edge while preserving every former128px center sample;
all are rejected. Reduced-scale images cannot qualify either named production boundary.
The synthetic positive coordinator control now uses full-scale tile images. Its process,
UI and geometry observations explicitly remain synthetic fixtures, not native receipts.

The nested fixture no longer sets final document height before expanding its256px scroller.
At CSS viewport height<=320px it begins320px tall and grows to1088px after static expansion.
A future native run must retain actual pre/expanded/restored geometry observations and evidence
in `evidence/nested-static-shell-geometry.json`. Expected fixture declarations and synthetic
PNGs cannot establish native DOM behavior. The coordinator rejects missing/mismatched geometry
and binds the exact validated JSON bytes and referenced evidence hashes in native-oracles.

Linux GUI launch retains only verified local DISPLAY/XAUTHORITY and/or WAYLAND_DISPLAY /
XDG_RUNTIME_DIR. Verification checks local socket type/owner, current-user authority file bounds
and write modes, and current-user0700 runtime directory. Remote displays, unsafe modes, foreign
owners and linked leaf bindings reject. Broad environment, provider credentials and session-bus
bindings remain excluded. Actual Linux GUI session connection is not run or inferred here.

The final observation interval is a minimum15000ms inside the independent nonrenewable overall
attempt deadline. Completion no longer requires one exact15000–15250ms polling window. A tick
delayed by5000ms can complete; an original overall deadline cannot renew. Tests cover both.

Passed: 159/159 isolated source tests from exact Git archive bytes, zero failures/skips/cancels;
29 contract/coordinator tests and the existing130 dispatcher tests. Four deliberate exact-source
review-defect mutations must exit1: omitted seam samples, restored bad preset nested height,
removed X authority owner check, and reintroduced narrow final tick. Machine receipts and their
hashes are in [qa-review-fixes.json](qa-review-fixes.json).

Exact final commands:

```text
git archive --format=tar --output=../integration-evidence/qa-review-final-source.tar HEAD
tar -xf ../integration-evidence/qa-review-final-source.tar -C ../integration-evidence/qa-review-final-exact
```

In that exact extracted directory:

```text
node --require ../../p7-evidence/isolation.cjs --test --test-isolation=none --test-timeout=15000 tests/*.test.cjs
```

In the repository:

```text
node --require ../p7-evidence/isolation.cjs --test --test-isolation=none --test-timeout=15000 tests/qa-contract.test.cjs tests/packaged-browser.test.cjs
node ../integration-evidence/qa-review-final-controls.cjs
node --check tests/helpers/native-fixtures.cjs
node --check tests/packaged-browser.cjs
node --check tests/packaged-browser.test.cjs
git diff --check
git diff --exit-code 0da8512bc743807ab3eba27ee1416e670b17cbd9 -- capture-protocol.js content.js service-worker.js offscreen.js offscreen.html popup.js popup.html popup.css manifest.json manifest.firefox.json icons scripts/build.py
```

Failed/corrected: an initial task-local edit script had a quote syntax error and left source
unchanged; new regression checks were red against that old source. The corrected edit script
and all final checks pass. A trailing documentation blank line found by diff-check was removed.
Earlier failures and logs remain retained. No assertion was weakened to produce green.

Not run: browser launch, extension/profile install, real UI gestures, native capture/downloads,
actual DOM expansion/restoration, real process-group RSS, signed installation, merge/deployment
or stores. Exact canonical package/inventory/toolchain provenance, approved OS/browser runtime,
genuine native GUI observations and independent review remain separate gates coordinated by parent.
