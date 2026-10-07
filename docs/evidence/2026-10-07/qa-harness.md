Historical initial source checkpoint. The independently reviewed boundary, fixture, GUI environment and timing cases are superseded by [QA review fixes](qa-review-fixes.md).

# Bounded pre-submit QA harness source evidence

This source deliverable resolves the missing local validator, unsigned-candidate verifier,
packaged GUI coordinator, independent PNG oracle and fixed checklist. The coordinator opens
only an explicitly requested, independently identified browser in a fresh owned profile. It
requires separate actual UI observations, a nonrenewable attempt timeline, stable one/zero
native outputs, independent pixels, exact rule/candidate bindings and owned-window cleanup.
Default preparation writes a blocked partial report with null installed/browser observations.
Helpers remain outside the shipping allowlist; shipping source files are unchanged from
`0da8512bc743807ab3eba27ee1416e670b17cbd9`. ZIP identity is not inferred from equal payloads.

The [machine-readable evidence](qa-harness.json) binds the exact final source/test commit and
local receipt hashes. Source test execution used Node26.7.0 on the selected Windows executor;
this does not qualify the canonical Node22.23.3 release toolchain or an approved native runtime.

Passed:

- 155/155 tests from the exact Git archive, zero failures/skips/cancellations: the existing
  130 production-dispatcher tests plus 25 QA contract/coordinator tests. Commands below.
- Both synthetic package formats; all 128 capability combinations per target; exact candidate,
  browser and policy identity; unknown/duplicate/missing rows, attribution, source-route and
  capability negatives; path/junction safety, owned retention and cleanup.
- Independent PNG CRC/geometry/stream-tail validation, all coordinate markers and four finite
  virtual-mode row/edge oracles; stable-file and duplicate-output negatives. Synthetic positive
  completion verifies exact report-byte hashing after every required gate. Its metadata and
  process doubles explicitly identify a synthetic fixture; it is not a native receipt.
- Five exact-archive mutations detected: omitted attribution, bypassed actual candidate
  capability comparison, ignored compressed PNG tails, missing actual child-exit cleanup and
  removed final observation delay. Each deliberate bad copy exits 1. These are successful
  negative controls, not green product tests with weakened assertions.
- Actual preparation CLI under isolation, using explicitly synthetic inputs: exit2, all 36
  selected checks unrun, null browser/installed observations, no launch, retained owned artifacts.
- New CJS syntax checks, `git diff --check`, and exact shipping-payload comparison.

Exact commands (repository directory unless stated):

```text
node --require ../p7-evidence/isolation.cjs --test --test-isolation=none --test-timeout=15000 tests/qa-contract.test.cjs tests/packaged-browser.test.cjs
node --check <each of the nine new script/helper/test CJS files>
git diff --check
git diff --exit-code 0da8512bc743807ab3eba27ee1416e670b17cbd9 -- capture-protocol.js content.js service-worker.js offscreen.js offscreen.html popup.js popup.html popup.css manifest.json manifest.firefox.json icons scripts/build.py
git archive --format=tar --output=../integration-evidence/qa-harness-source-final.tar HEAD
tar -xf ../integration-evidence/qa-harness-source-final.tar -C ../integration-evidence/qa-harness-exact-final
node ../integration-evidence/qa-harness-negative-controls-final.cjs
```

In the extracted exact source directory:

```text
node --require ../../p7-evidence/isolation.cjs --test --test-isolation=none --test-timeout=15000 tests/*.test.cjs
```

The full CLI flags/types and real GUI procedure are in
[tests README](../../../tests/README.md) and
[packaged checklist](../../../tests/packaged-browser-checklist.md).
Local `integration-evidence/qa-harness-cli-input.json` preserves the exact synthetic default
CLI argv; it is never presented as approved package/build/native provenance.

Failed and corrected experiments remain retained: the initial focused test passed8/failed1
because the verifier conflated action16/32/48 icons with general16/32/48/128 icons. The corrected
exact shape passes both formats. The first mutation orchestration stopped at a newline-sensitive
cleanup anchor; a fresh copy with a regex anchor detected all five controls. No denied action
was bypassed and no native assertion was weakened.

Not run: real extension loading, toolbar/context-menu/cancel/popup gestures, captureVisibleTab,
activeTab, native downloads, real worker/offscreen replacement, process-group RSS, Firefox native,
signed installation/update, merge, deployment or store submission. No installed extension/daily
profile/global tooling/persistent permission changed. The separate native run still needs the
canonical inventory/toolchain producer and actual approved build/artifact provenance, exact
supported OS/browser, genuine GUI evidence and independent review. Parent coordinates those
and merge/release. No special external coordinator is required; this committed local runner
provides the bounded source coordination surface.
