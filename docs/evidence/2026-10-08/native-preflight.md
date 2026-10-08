# Measured nested viewport and read-only native preflight

The nested source fix is committed at `f9af09fd7e75f82e15b0e4f202db451a4e7071c2`.
The coordinator now requires actual `window.innerWidth/innerHeight` observations with CSS width
exactly2048px and integer height1..320px before accepting the nested geometry/PNG evidence.
The checklist and served fixture index state the exact setup. Missing/narrower/wider/taller or
unmeasured setups reject; a coupled coordinator test rejects a1024px observation, and removing
that production gate makes the negative-control copy fail. Shipping detector/code is unchanged.
160/160 isolated exact-source tests pass, zero failures/skips/cancels;30 QA tests plus130 existing.

## Candidate and executor observations

Selected machine: E-DESK-5060. Read-only native receipts show Windows 11 Pro 10.0.26300 x64,
interactive process/Explorer session1 and two reported2194x1234 screen bounds, working height1186.
These are Windows-reported monitor metrics, not an observed Chrome CSS viewport or DPR.
Windows UIAutomationClient/Types assemblies load, but no windows were enumerated, screenshots
captured or input sent. Current tool inventory exposes terminal/file/process APIs and no general
GUI input/screenshot tool. Parent capability task `01a1191b-f752-7472-a7df-48b11edc6021`
subsequently confirmed native computer APIs are disabled and no callable Windows node_repl runtime
exists. Assembly availability is not a supported input/screenshot route. E-Desk is connected according
to the parent catalog; the stale DesktopCommander offline record is not machine connectivity truth.
The pilot is blocked on supported native GUI capability. No portable browser installation/launch or
custom UIAutomation helper is authorized to bypass the disabled APIs; an existing Brave extension
does not establish portable Chrome control.

Installed signed Chrome 154.0.8037.98 and Firefox 147.0.4 differ from approved pins. Chrome executable
SHA256 6849d2982038de9f9489a7b3858f3b785b7fec06a842c93c517281d21995c8ca; Firefox SHA256
6cd3bf5fa9ddb95aa256b71cadd580b40d03590b23963d0b6396953416e66542. Both signatures validate to their
vendors. Neither was launched. Existing WSL2 Ubuntu is stopped; its release/GUI is unverified and
it was not started. The initial approved contract is Ubuntu 24.04 x64 with Chrome 155.0.8059.39 Linux
and Firefox 157.0.1, so current Windows/installed-browser equivalence is not assumed.

Original successful reviewed-source CI run 37705317312, head e625f8c3b602356e1b0564f191d1140f21b5f4bc,
artifact 11519217814 (`capture-full-page-packages`), provides unchanged5.3.0 development packages:

| Target | Original ZIP SHA256 | Bytes |
| --- | --- | --- |
| Chrome | e32b101339dd35144a11973b8a572878135d114c18ea2d07558d498acb8b3cd4 |62411|
| Firefox |7e50b8269d5fc754b2fb84a493b8fbee29da620f231f089259901c941224794c|62272|

Every allowed member equals the exact raw pinned Git blob bytes; no package was rewritten.
The first comparison to a locally extracted archive failed because local core.autocrlf produces
CRLF working-tree archive bytes while the CI package/raw Git blobs are LF. That failed comparison
is retained separately; raw `git cat-file blob` byte comparison passes without normalization or
weakened assertions. GitHub reports outer artifact digest ad3401ee59f28545a0b89c4cf911a8bf97ab3cd6d9b479d4ac8085753c1196aa;
that outer ZIP digest was not independently verified locally. Original inner package hashes were.
Actual private/preserve source capability literals are false for both targets.

These ZIPs have noncanonical dates and no canonical approved production inventory/toolchain.
The strict production ZIP gate rejects them. They cannot enter completed PreSubmitQa; no build
inventory, approval identity or releaseQualified claim was fabricated. A separately reviewed
focused native observation of the exact development candidate does not require the entire
roadmap, but must stay separate from full production qualification.

## Smallest first-run proposal (not launched)

1. Review and explicitly approve a Windows 11 build26300 / official Chrome-for-Testing 155.0.8059.39
   Win64 pilot, or establish the exact approved supported Linux route on this executor. Google
   [official availability](https://googlechromelabs.github.io/chrome-for-testing/) currently lists
   [that exact Win64 archive](https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/win64/chrome-win64.zip).
   Provision only a fresh task-owned portable directory after approval: verify original download
   provenance, PE version/signature status and executable SHA, inspect lifecycle, no installer,
   daily-profile update, global tooling/security change or persistent grants. No browser binary
   has been downloaded during this preflight.
2. Bind the original observed Chrome ZIP hash above and CI provenance to this limited pilot;
   inspect/extract exact allowed member bytes into a fresh owned candidate directory. Keep full
   production admission blocked until real canonical inventory/toolchain exists. Use separate
   incomplete pilot observations, never a completed PreSubmitQa packet or invented provenance.
3. Create only after review a fresh `native-pilot-<review-id>` root with candidate/profile/downloads/
   evidence. Bind the loopback fixture server to127.0.0.1 ephemeral port, routes allowlisted. Launch
   the exact approved portable executable with only `--user-data-dir=<owned-profile>`,
   `--no-first-run`, `--no-default-browser-check`, and fixture URL. No headless/debugging/load-extension
   or security-altering flags. Ordinary Chrome UI loads only that verified owned unpacked candidate.
   Record actual ID/version and existing native save-prompt state. Set download directory only in
   this fresh profile if included in the approved scope; do not silently change save-prompt settings.
4. First case only: `nested-static-shell`, one real toolbar capture. Set and measure exactly2048x320
   CSS viewport through ordinary UI; retain actual viewport, pre-expansion320px document, expanded
  1088px and restored320px observations. Predeclare the measured physical owned webview viewport and observed DPR before the gesture.
   The shipped compositor uses floor(2048*rX) by floor(1088*rY), where native bitmap rX=width/2048
   and rY=height/320; DPR alone is not assumed to be bitmap geometry. With confirmed1.75 axes and
   physical3584x560 viewport, expected PNG is3584x1904. Retain independent physical-window
   calibration evidence; if that calibration is unavailable, leave exact dimension qualification
   unverified rather than guessing. Independently decode saved pixels,
   all coordinate markers and complete lower content. This case does not claim8192/adaptive seam,
   worker replacement, private/preserve, Firefox, full RSS envelope or complete checklist coverage.
5. Observe genuine UI separately from file appearance. Require exactlyone stable owned PNG;
   capture bound900000ms and final native-initiation observation minimum15000ms inside independent
   overall deadline. Fail on duplicate/unattributed output or wrong geometry; do not delete evidence
   to pass. Close only the owned browser window through ordinary UI, verify exact owned child exit,
   retain profile/downloads/evidence and actual restoration observations. Stop at persistent grants
   or unexpected security prompts. No user's existing extension/profile or unrelated process changes.

This exact proposal is checkpointed, not executable in the current capability state. The immediate
blocker is a supported native GUI input/screenshot route on the connected selected machine.
Runtime/platform/pilot-candidate and provisioning scope still need parent review after that capability
is available. Do not install/launch a portable browser, implement a custom UIAutomation workaround,
or transfer execution to evade the disabled native APIs. No further speculative harness expansion
is needed to report this capability block.

## Exact evidence commands

[Machine-readable receipts](native-preflight.json) bind original artifact/source/OS observations
and current source/control logs. Retained commands include `Get-CimInstance Win32_OperatingSystem`,
Get-Item VersionInfo / Get-AuthenticodeSignature / Get-FileHash on the two standard installed
browser executables, System.Windows.Forms.Screen metadata, `wsl --list --verbose`, read-only
UIAutomation assembly loading, `gh api .../actions/runs/37705317312/artifacts`, and
`gh run download 37705317312 --name capture-full-page-packages --dir <fresh-owned-evidence-dir>`.
No installed profile/preferences or stopped distro contents were read/modified.

Source validation from the exact extracted archive:

```text
node --require ../../p7-evidence/isolation.cjs --test --test-isolation=none --test-timeout=15000 tests/*.test.cjs
```

The deliberate missing-viewport-gate copy runs the same guard with `tests/packaged-browser.test.cjs`;
its one expected failure demonstrates the production admission check is coupled to acceptance.
Read-only package inspection uses `zipfile` and credential-free `git cat-file blob <exact-head>:<member>`.
A task-local inspection script's first relative module import failed; the path was corrected and
strict real-package admission then reported blocked (not passed). Failed experiments remain retained.

Microsoft documents [UI Automation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview)
as the supported Windows accessibility/automated-test API. Assembly availability here is
an assembly availability observation. It does not establish a supported interaction route in this
environment or authorize a workaround for disabled native computer APIs. Native GUI capture,
downloads, pixel/geometry/restoration/cleanup qualification remain not run.
