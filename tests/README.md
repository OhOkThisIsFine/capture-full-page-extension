# Capture regression fixtures

These fixtures exercise the capture paths that have historically been fragile.

## Automated reliability checks

Run `node --test tests/*.test.cjs`. The dependency-free VM harness executes the
repository's content and compositor functions with controlled layout and
asynchronous browser primitives. It covers interrupted nested preparation,
old continuations after replacement sessions, iframe scroll restoration and
navigation, short viewport coverage across columns and fractional bitmap scales,
cancelled tile/finish operations, owner recovery preserving completed URLs, and
a known PNG chunk CRC. The build workflow runs these checks.

These tests model layout and verify coverage; they do not establish browser
pixel fidelity, sticky-header appearance, general iframe completeness,
real worker termination behavior, or peak encoding memory. Real Chrome and
Firefox fixture QA remains required. No browser extension was installed for
the initial repair batch. The small CRC change removes one temporary chunk allocation;
it does not establish a safe peak-memory budget.

## Optional isolated browser QA

`node tests/browser-layout.cjs` uses existing Playwright and a temporary Chromium
profile. It loads the unpacked source only in that temporary profile, serves
synthetic pages on loopback, and exercises production content functions against
real DOM layout. Runtime registration and settle waits use explicit test seams.
It checks short viewport traversal, interruption before/after nested unlocking,
old preparation released after a new session, and iframe box-model sizing and
scroll restoration. Tested on Chromium 148.0.7778.96.

`node tests/browser-png.cjs` uses existing Playwright and pngjs in temporary
headless browser profiles. It evaluates the production content/compositor
functions with runtime registration and settle seams, feeds actual browser
screenshots into the compositor, and independently decodes PNGs. It checks all
colored rows at viewport heights 100, 180, 190 and 191, repeated capture equality,
both iframe edge sentinels, scroll restoration, and cancellation after a real
encode. Tested on Chrome 154.0.8037.98. Border-box frames with 8px borders now
expose the complete frozen 500x600 content viewport in this fixture.

Set `PLAYWRIGHT_MODULE`, `PNGJS_MODULE` (PNG suite only), and
`CFP_CHROMIUM_EXECUTABLE` to already-installed tooling when normal module/browser
resolution is unavailable. Optional `CFP_QA_REPORT` writes the layout report;
`CFP_QA_OUTPUT` chooses the PNG/report output directory. Profiles are deleted
after each run. These optional suites do not install dependencies or touch a
personal browser profile, and are not part of the dependency-free CI command.

These checks do not establish the user-action/activeTab grant, captureVisibleTab,
browser-managed downloads, real worker termination, render-wait timing, Firefox
behavior, sticky-header fidelity, arbitrary responsive iframe completeness or
peak memory. In the permitted headless extension probe,
`Extensions.triggerAction` returned `Method not allowed`; opening the popup
programmatically did not grant activeTab and capture correctly rejected access.
No unsafe extension-debugging flags or permission overrides were used. Bundled
Chromium's screenshot API timed out; installed Chrome produced the verified
fixture PNGs through the production compositor harness.

## Run

Serve the repository over HTTP, for example:

```
python -m http.server 8000
```

Then open the fixture pages under `http://localhost:8000/tests/fixtures/` with
the unpacked extension loaded.

## Expected checks

### app-shell.html
A successful PNG should contain:
- the top application header and left sidebar
- every numbered row in the large nested scroller
- the full horizontal width of the wide grid
- the sticky strip only once rather than repeated down the image
- the complete same-origin `srcdoc` iframe
- the open-shadow-root test block with animation frozen during capture

The page should return to its original scroll positions and layout immediately
after the last viewport is captured.

### shrinking-scroller.html
The fixture deliberately removes content while the primary scroller is moving.
The extension should either finish with complete coverage or abort with a clear
scroll-progress/coverage error. It must not loop indefinitely and must not
download a PNG with fabricated white regions.

## Manual lifecycle checks

1. Start a long capture, then switch to another tab in the same window. The
   original capture must cancel; pixels from the newly active tab must never be
   stitched into the output.
2. While one capture is running, try to start another. The popup should report
   that a capture is already running.
3. After a forced failure, start another capture. It should work normally,
   demonstrating that the compositor session and global capture lock were
   released.
4. Repeat a large capture several times and inspect the extension service worker
   and offscreen document. The offscreen document should disappear after the
   download blob is revoked and no capture remains.

## Independent publisher test chain

The publisher workflow runs the dependency-free regression suite and Bash syntax
check before packaging. All three publisher jobs retain `needs: build` with
normal success gating. `publisher-gate.test.cjs` reads those production commands
and dependencies, then runs the commands in a disposable directory with a
syntax-valid failing regression and credential-free packaging/publisher process
fakes. A passing control proves the recording fakes are reachable. The negative
fixtures require zero packaging and privileged calls.

This source/command fixture does not execute GitHub Actions, contact stores,
qualify the locked release toolchain, install an extension, or establish native
browser capture behavior. It requires Bash (Git Bash on Windows, or set
`CFP_BASH_EXECUTABLE`). The intentionally failing fixture ends in `.cjs` rather
than `.test.cjs` so the ordinary test glob does not collect it directly.


## Draft protocol geometry checkpoint (not release qualification)

The integration branch migrates Prep/Snapshot/TraversalPlan geometry records,
strict numeric/UUID/accessor checks, helper load order, top-frame targeting,
first-writer rectangles and content accept-frame acknowledgments together.
`protocol-geometry.test.cjs` exercises these production helpers/dispatchers with
synthetic primitives, including independent per-pixel write ownership, ACK loss,
physical growth/shrinkage, separate complete data-URL/decoded bitmap limits, and
five total capture calls per spec across retries. All source tests remain
credential-free. No direct-browser or native-extension result is inferred.

The next draft checkpoint adds strict compositor request/response schemas,
creator-local/recovery/context scope brands, a recovery-before-mutation barrier,
verified Firefox reverse callbacks, permanent source-loss/content-port bindings,
and a single Promise-form download invocation. The exact-intent output ledger
retains ambiguous/paused sources, reconciles native item evidence, and releases
storage only on allowed terminal evidence or fixed expiry. No raw URL release
command remains. Private capability literals remain false and private or
unverified tab context is rejected before injection.

The encoder uses one deflate stream, bounded IDAT staging, an explicit scanline
source and a charged Blob handoff. Allocation guards retain pending native input
leases until settlement. `download-ownership.test.cjs` uses registered production
dispatchers with synthetic APIs, checks allocation failures independently of
session maps, parses PNG chunks/CRCs and tests consumed zlib input with mandatory
trailing-data negatives. Arbitrary compressor-value fixtures test packing only.
The external run guard used in this task denies real network/provider access and
uncontrolled child processes before imports; publisher children are allowed only
in disposable fixtures with explicit credential-free environments.

This checkpoint remains incomplete. G1-G5 composed mapping, whole-subtree
occlusion and pre-collapse scroll restoration, R2 element-local effect discovery,
P5 public status/popup/cancellation UI, and the full P3 allocation/native-failure
and deadline matrix still need implementation or verification. Source tests do
not prove native peak memory, pixel attribution, native downloads, installed
behavior or background replacement. Historical optional-browser statements above
are not qualification evidence for this draft. Real Q1/Q3/Q4-normal/Q5/Q6 and the
separate Q7a toolchain gates remain unrun. Do not merge, tag, install, activate or
release this branch from synthetic tests.

## Coordinated geometry, resources and status candidate

The dependency-free suite also checks descriptor-first protocol access, element-local
animation enumeration and returned-sequence accounting, composed mapping identity,
whole-subtree suppression footprints, entry-time scroll ownership, encoder failure
cleanup, stale popup replies and exact operation-bound cancellation. Source-pixel
oracles run the real dispatcher/compositor/encoder with controlled bitmap/canvas
primitives and independently decode every output pixel, including fractional scales,
nonzero source crops, multiple tiles and zero-novel rows. These controlled primitives
are not browser memory or installed-extension qualification.

`node tests/browser-geometry.cjs` uses the same disposable synthetic browser harness
as the optional PNG checks. It independently decodes native screenshot output for a
layout-viewport fixed header, a transformed containing-block fixed descendant and a
wide sticky header. It checks lower-marker document coordinates and hides the wide
header only after its natural horizontal fragments are accepted. Supply the same
Playwright/pngjs/executable variables and task-owned `CFP_QA_OUTPUT` directory.
It evaluates source without installing an extension; it does not test native
captureVisibleTab, downloads, user grants, real worker replacement or Firefox.

## Source-only packaged QA harness

The shared [QA contract](../scripts/qa-contract.cjs), [candidate verifier](../scripts/verify-qa-candidate.cjs)
and [packaged runner](packaged-browser.cjs) are source deliverables. The synthetic tests use
explicit browser/process doubles and cannot qualify installation, native APIs or distribution.
The [native checklist](packaged-browser-checklist.md) gives the separately reviewed GUI procedure.
Run the dependency-free source tests with `node --test tests/*.test.cjs` under an appropriate
credential/network isolation guard. Both package formats, all 128 capability combinations,
invalid evidence, capability mismatches, cleanup, PNG tails and stable/duplicate output are tested.

Preparation CLI (placeholders are required real reviewed inputs, not qualification metadata):

```text
node tests/packaged-browser.cjs --stage pre-submit --target chrome --package <original.zip> --inventory <build-manifest.json> --expected <protected-reviewed-input.json> --expected-review-sha256 <independent-sha256> --expected-package-sha256 <independent-sha256> --expected-inventory-sha256 <independent-sha256> --expected-browser-version <exact-version> --evidence-dir <new-owned-directory> --report <new-owned-directory/qa.json>
```

This default exits 2 and creates a partial report with every check unrun and no installed
observation. `--launch`, used only in the separate approved native run, requires
`CFP_CHROMIUM_EXECUTABLE` or `CFP_FIREFOX_EXECUTABLE` to identify the exact provisioned GUI binary.
The binary digest/version is checked before launch. No headless/debugging/load-extension flags
are accepted. Inputs and evidence reject symlink/junction paths. The approved canonical release
inventory is mandatory; the existing development builder is not silently promoted to that role.

Protected reviewed input has exactly: `repository`, `commit`, `target`, `version`,
`packageSha256`, `inventorySha256`, `buildRunId`, `artifactId`, `capabilities`, `firstPublication`,
`rulesBindingSha256`, and `browser`. Browser has `name`, `version`, `channel`, `executableSha256`.
Capabilities has all seven booleans exported by `qa-contract.cjs.CAPABILITIES`. The first two
are checked against the actual hashed candidate protocol in a bounded pure VM; this VM executes
trusted reviewed source and is not a security sandbox for arbitrary code. Change/claim flags
come from the independently reviewed diff/scope, never reviewer overrides. The rule digest is
`bindingDigest({stage:'pre-submit',target,capabilities,firstPublication})`. JSON cannot prove its
own approval origin: preserve the protected review input and independent SHA through the review
boundary. Build/artifact IDs are actual positive decimal strings, never fixture IDs or guesses.

For each genuine native attempt write owned `current-attempt.json` with exactly `schemaVersion:1`,
`runId`, next integer `sequence` (1..64), `fixtureId`, `gesture` (`toolbar`, `context-menu-top`,
`context-menu-iframe`, `cancel`), UTC `startedAt`, `state` (`running`/`finished`), `result` (null
while running, then `success`/`pre-initiation-failure`) and evidence paths when finished.
The coordinator measures its own nonrenewable deadline; editing timestamps cannot reset it.

Copy the owned reviewer template to `reviewer.json`. Populate exactly its existing fields:
`schemaVersion`, `runId`, `packageSha256`, `browser`, `extension`, `downloadsPreference`, `display`,
`cleanup`, `checks`, `attempts`, `reviewer`, `limitations`. Extension is observed `id`, `version`,
`sourceRoute:'native-extension-detail'`, `evidence`. Downloads preference is actual `askWhereToSave`,
`sourceRoute:'native-preferences-observation'`, `evidence`. Display is observed `scale`, `dpr`, `zoom`.
Cleanup is `browserClosed:true`, `sourceRoute:'native-owned-window-closed'`, `evidence` after closing
the owned windows. Each check is exactly `id`, `status`, `evidence`. Each attempt is `fixtureId`,
`gesture`, UTC `startedAt`/`finishedAt`, `result`, `evidence`, matching the coordinator journal.
Evidence paths are relative forward-slash paths under the owned directory, nonempty ordinary
files <=8MiB; refs are hashed in the final report. Reviewer<=160 bytes, <=8 limitations, <=8 refs
per row, completed QA<=32768 UTF-8 bytes. Claim-only unrun requires an explicit `<checkId>:`
limitation and evidence. Required unrun never qualifies. Metadata/file presence alone proves
neither genuine gestures nor cleanup. A human reviewer supplies those observations for review.

Exit 0 requires completed exact shared validation, native timeline, pixel/download oracles and
owned browser exit/cleanup. Exit 1 means failed/invalid evidence; exit 2 means blocked/unrun.
The final canonical report's exact byte hash is bound in `native-oracles.json`. Failed/unrun
artifacts remain intact. Post-distribution/signed/provider receipts are rejected here; the shared
rule table reserves those IDs but this bounded runner/record validator supports pre-submit only.
