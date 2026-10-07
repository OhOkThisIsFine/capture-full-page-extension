# Packaged browser pre-submit checklist

This checklist describes a future native qualification run. Source tests never complete it.
The gate uses `scripts/qa-contract.cjs.requiredChecks`; the table below is its generated
pre-submit union, not a second implementation. The owned `reviewer-template.json` contains
exactly the rows selected by the independently reviewed capability binding. Every selected
row must occur once, have its allowed status and reference genuine retained evidence.
A required unrun row blocks (exit 2); failed or invalid evidence fails (exit 1).

## Admission and ownership

Obtain the original approved unsigned production ZIP and exact build inventory, independent
SHA256s, actual CI build run/artifact IDs as positive decimal strings, reviewed source commit,
capability/change/claim policy and browser executable identity. Do not invent missing IDs or
mark development packages release-qualified. The current `build.py` does not produce this
canonical inventory/release-toolchain receipt; that producer integration is a separate gate.
The verifier rejects noncanonical or expanded-permission packages rather than adapting them.

Bind the approved OS and exact official browser outside this JSON check: the canonical initial
runtime is Ubuntu 24.04 x64, Chrome 155.0.8059.39 (Linux) / Firefox 157.0.1. Windows equivalence
requires explicit reviewed qualification. Existing Windows Chrome154/Firefox147 are not those
pins. Never transfer execution to another machine to bypass a restriction.

Prepare a new evidence directory with the documented CLI. Default preparation writes a
blocked partial report and exits 2. Only a separately reviewed run uses `--launch`. This opens
a GUI with a new owned profile; it never loads an extension automatically, resizes the browser,
changes native preferences or drives privileged APIs. Stop at any persistent permission prompt.

Use Chrome's ordinary `chrome://extensions` Developer mode / Load unpacked for the verified
owned candidate, or Firefox `about:debugging` / Load Temporary Add-on. Record the observed
extension ID/version and browser detail screenshots. Temporary Firefox loading does not prove
signed installation. Record the existing Downloads “ask where to save” state. Configure the
owned downloads directory only when that action is authorized for the isolated profile; do
not change the save-prompt preference automatically. Never touch a daily profile or its extension.

## Actual gestures, pixels and cleanup

Serve only the runner's explicit synthetic loopback fixture routes. Before each capture write
`current-attempt.json` with the next sequence and then perform the declared ordinary UI gesture.
This intent marker is not gesture proof: retain separate screenshots/recordings and notes of
actual toolbar, top-page context menu, iframe context menu, popup reopen and cancellation.
Update the marker to finished only after observing the native outcome. Each attempt has a
nonrenewable 900000ms bound. The runner observes final native initiation for at least 15000ms within the independent overall attempt deadline. Success requires exactly one stable PNG; pre-initiation failure zero.
Partial files, duplicate or unattributed outputs block completion. Do not remove them to pass.

Set viewport dimensions through ordinary UI and record CSS viewport, display scale, DPR and
zoom. Width/height must fit each fixture. For `tile-boundary-8192`, use scale 1 and width no
larger than 1024 CSS px, with height below 8192. The adaptive fixture is 4096x2200 and crosses
the production 8Mi-pixel/2048-row tile at scale 1. Capture all seven coordinate/static/iframe
fixtures successfully, including fractional scale with recorded noninteger DPR or zoom; retain
native pixel receipts. The independent decoder checks dimensions, coordinate cell colors and,
when preservation is enabled, all 100 row identities and both horizontal edges in all four
finite virtual modes. File names map declared attempts only; they do not prove production
source/download ownership. Q3/Q4 and attribution evidence must observe the real native path.

Preserve-disabled evidence must show upfront zero DOM/style/scroll/screenshot/download effects
and late automatic detection restoring earlier expansion without preservation/capture/download.
Private-disabled evidence must show zero injection/mutation/download. Do not enable denied
private/file access or claim worker loss/resume from unrun rows. For native resource accounting,
record process-group RSS at <=100ms intervals, repeated captures, cancellation and 30s idle.
Use real offscreen/background lifecycle observations, not a source-only mock, for target rows.

Finish `reviewer.json`, close only the owned browser windows through ordinary UI and retain
cleanup evidence. The coordinator requires both that observation and its child's actual exit.
It cannot infer restoration from closing a process. Cancellation/failure writes a partial
checkpoint and terminates only the child it launched; it retains profile, downloads and evidence.
No recursive cleanup, process-name kill, store submission, signed-install or distribution step
is part of this runner. Retain the full owned directory for independent review.

## Fixed IDs (generated from the shared rule table)

| Check ID | Selection / allowed exception |
| --- | --- |
| `duplicate-start` | Always required: pass with native evidence |
| `entry-context-menu-iframe` | Always required: pass with native evidence |
| `entry-context-menu-top` | Always required: pass with native evidence |
| `entry-toolbar` | Always required: pass with native evidence |
| `exactly-one-download` | Always required: pass with native evidence |
| `file-access-allowed` | fileAccess true: pass; false: not-applicable with denied-access/no-claim evidence |
| `file-access-denied` | Always required: pass with native evidence |
| `filename-auto-uniquify` | Always required: pass with native evidence |
| `fractional-scale` | Always required: pass with native evidence |
| `iframe-padding` | Always required: pass with native evidence |
| `navigation-disconnect` | Always required: pass with native evidence |
| `nested-static-shell` | Always required: pass with native evidence |
| `no-extension-save-prompt` | Always required: pass with native evidence |
| `offscreen-lifecycle-Chrome` | Chrome: pass |
| `popup-reopen` | Always required: pass with native evidence |
| `preserve-disabled` | preserveVirtualizer false: pass |
| `preserve-virtualizer` | preserveVirtualizer true: pass |
| `private-allowed` | privateCapture true: pass |
| `private-denied` | privateCapture true: pass |
| `private-disabled` | privateCapture false: pass |
| `q3-late-disposal` | resourceAccountingChanged true: pass; false: pass or not-applicable with trusted unchanged-diff evidence |
| `q3-resource-envelope` | resourceAccountingChanged true: pass; false: pass or not-applicable with trusted unchanged-diff evidence |
| `q4-armed-source-lifetime` | downloadOwnershipChanged true: pass; false: pass or not-applicable with trusted unchanged-diff evidence |
| `q4-paused-resume` | Corresponding claim true: required pass; false: pass or claim-only unrun with row-specific limitation/evidence |
| `q4-worker-loss` | Corresponding claim true: required pass; false: pass or claim-only unrun with row-specific limitation/evidence |
| `recapture-after-failure` | Always required: pass with native evidence |
| `rendered-coordinate-attribution` | Always required: pass with native evidence |
| `restoration-cancel` | Always required: pass with native evidence |
| `restoration-success` | Always required: pass with native evidence |
| `restricted-page` | Always required: pass with native evidence |
| `same-window-tab-change` | Always required: pass with native evidence |
| `sender-shapes` | Always required: pass with native evidence |
| `shared-background-Firefox` | Firefox: pass |
| `short-viewports` | Always required: pass with native evidence |
| `source-document-attribution` | Always required: pass with native evidence |
| `source-tab-attribution` | Always required: pass with native evidence |
| `tile-boundary-8192` | Always required: pass with native evidence |
| `tile-boundary-adaptive` | Always required: pass with native evidence |
| `two-axis-coordinate-grid` | Always required: pass with native evidence |
| `unrelated-window-tab-change` | Always required: pass with native evidence |

## Independent review corrections

Named tile cases now require exact scale1 PNG dimensions: 1024x8300 crosses8192;
4096x2200 crosses the actual8Mi-pixel2048-row adaptive tile. The oracle checks every
pixel across seam-1/seam/seam+1, including both horizontal edges. A reduced-scale
fixture cannot qualify either named boundary. Synthetic complete-run tiles use scale1.

The nested static fixture now starts at natural document320px height and expands to1088px;
it no longer presets the final height before expansion. A native completion additionally
requires `evidence/nested-static-shell-geometry.json` with exact `runId`,
`sourceRoute:'native-page-geometry-observation'`, `before:{width:2048,height:320}`,
`expanded:{width:2048,height:1088}`, `restored:{width:2048,height:320}`, and genuine evidence
paths. Observe and record these through ordinary native page inspection during the run;
expected fixture declarations and synthetic PNGs do not prove actual DOM growth/restoration.

On Linux the GUI child preserves only verified local DISPLAY/XAUTHORITY and/or
WAYLAND_DISPLAY/XDG_RUNTIME_DIR bindings. Local X socket must exist and belong to current
user/root; authority must be a bounded regular current-user file without group/world write.
Wayland requires current-user0700 runtime directory and current-user socket. Remote displays,
foreign owners, unsafe modes and linked leaf bindings fail before browser launch. No general
session bus, provider secret or broad environment is inherited. Native GUI connection remains
unrun in this source-only follow-up.

