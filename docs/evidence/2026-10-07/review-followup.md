# P1 review follow-up evidence (historical checkpoint)

Superseded by [residual review](residual-review.md) for later source repairs.

Shipping source: `dad1e654ac2c60959298c25535f34ed262bea794`. Final test-only repairs:
`0d0073a0430cd0692f44bc85770cd18b227a9281`. Every shipping package byte is identical
through that commit. The JSON records source/package/receipt hashes and exact commands.

The follow-up fixes retained frame inputs, recovery ordering and expiry status, bounded
setup/cancellation and DOM scanning, escaping border-image eligibility, disabled-preserve
read-only exposure rejection, resource accounting and CSS shorthand rollback ownership.
Newer page-owned style/scroll changes remain preserved. Output/download ownership remains.

- **Passed:** 122/122 isolated source tests, zero failures/skips/cancellations; repeated from
  the exact Git archive used for packaging. Final test-only timer correction also passes.
- **Passed:** all seven exact-source mutation controls detect their injected faults.
- **Passed:** 26 tracked JS/CJS syntax checks and both 5.3.0 source package builds; complete
  member whitelist and ZIP/source/extracted byte equality.
- **Passed, source diagnostics only:** Chrome154 rendering of extracted package source:
  seven restoration/preservation checks, four all-row PNG bands plus repeat equality,
  three suppression-marker fixtures, rounded/masked and child-rotation guards, eight
  traversal sizes, strict zero-write opaque-shell rejection and before/after-unlock cancel
  restoration. Unchanged fixtures require zero preserved page changes/failed restores.

These use synthetic runtime and CDP screenshots in fresh isolated profiles, not an
installed extension. They do not qualify activeTab/captureVisibleTab/native downloads,
real sender/lifecycle replacement, memory limits or Firefox. The isolation guard blocks
external Node network and browser routes, strips browser credentials, uses loopback-only
fixtures and closes/removes only owned processes/profiles.

Failed experiments and prior CI scheduling failures are retained locally and summarized
in the JSON. No assertions were weakened. The native async-snapshot fixture now awaits
production rejection; the DOM-cancel fixture holds the first actual owned task boundary
and verifies cancellation clears it.

**Not run:** Q1/LP1, Q3 process-group RSS, Q4-normal native Chrome/Firefox downloads, Q5
native lifecycle/senders, Q6 current pinned manual browser table, Firefox native paths and
Q7a locked release/install receipts. Private/preserve remain disabled. The missing packaged-browser coordinator and QA contract validator are concrete local
implementation/evidence gaps. The selected Windows executor's currently callable tool
catalog exposes shell/file/terminal APIs but no general desktop GUI click/screenshot API
in this turn. This does not prove absence of manual human access or GUI tools in another
workspace. Existing signed Chrome154/Firefox147 differ from canonical pins. The proposed
local route is detailed in [qualification route](native-qualification-route.md); it needs
an implemented coordinator/validator, exact approved runtime and supported GUI control
or a human reviewer in task-owned isolated profiles. Product execution must not move to
another workspace to evade restrictions.

[PR11](https://github.com/OhOkThisIsFine/capture-full-page-extension/pull/11) stays draft
for parent-coordinated independent review and native gates. No merge, extension install,
daily profile change, deployment or store submission occurred. Source publication and
package creation do not establish installed or deployed working behavior.
