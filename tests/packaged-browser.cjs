"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  cp = require("node:child_process"),
  crypto = require("node:crypto");
const Q = require("../scripts/qa-contract.cjs"),
  V = require("../scripts/verify-qa-candidate.cjs"),
  F = require("./helpers/native-fixtures.cjs"),
  { decodePng } = require("./helpers/png-oracle.cjs");
const POLL_MS = 250,
  ATTEMPT_MS = 900000,
  FINAL_OBSERVATION_MS = 15000;
const sessions = new WeakMap();
function inside(root, file) {
  const relative = path.relative(root, path.resolve(file));
  Q.requireThat(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "Path escapes owned run",
  );
  return path.resolve(file);
}
const noLinks = V.checkNoLinks;
function ownedFile(root, ref) {
  Q.text(ref, 512);
  Q.requireThat(
    !ref.includes("\\") &&
      !ref.includes(":") &&
      !ref.split("/").some((p) => !p || p === "." || p === ".."),
    "Unsafe evidence reference",
  );
  const file = inside(root, path.join(root, ref));
  noLinks(file);
  return { file, bytes: V.ordinaryFile(file, 8 * 1024 * 1024) };
}
function evidenceRefs(root, refs) {
  Q.evidence(refs);
  return refs.map((ref) => {
    const { bytes } = ownedFile(root, ref);
    Q.requireThat(bytes.length > 0, "Empty manual evidence");
    return `${ref}#sha256:${Q.digest(bytes)}`;
  });
}
function stateOf(session) {
  const state = sessions.get(session);
  Q.requireThat(state, "Unowned coordinator state");
  return state;
}
function writeReport(state, report, canonical = false) {
  const output = state.reportPath;
  noLinks(path.dirname(output));
  if (fs.existsSync(output))
    Q.requireThat(
      fs.lstatSync(output).isFile() && !fs.lstatSync(output).isSymbolicLink(),
      "Report target changed",
    );
  const temporary = inside(state.root, output + ".tmp-" + crypto.randomUUID());
  fs.writeFileSync(
    temporary,
    canonical ? Q.canonical(report) : JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  fs.renameSync(temporary, output);
}
function partial(session, reason) {
  const s = stateOf(session),
    report = {
      kind: "packaged-native-partial",
      qualification: "blocked",
      runId: s.runId,
      stage: "pre-submit",
      candidate: {
        repository: s.expected.repository,
        commit: s.expected.commit,
        target: s.expected.target,
        version: s.expected.version,
        packageSha256: s.expected.packageSha256,
        inventorySha256: s.expected.inventorySha256,
      },
      installedObservation: s.installedObservation,
      browserObservation: s.browserIdentity,
      checks: Q.requiredChecks(s.selector).map((r) => ({
        id: r.id,
        status: "unrun",
        evidence: [],
      })),
      reason,
      fixtures: s.fixtures.map(
        ({ id, title, route, sourceSha256, result }) => ({
          id,
          title,
          route,
          sourceSha256,
          result,
        }),
      ),
      nativeChildExited: s.childExited,
      artifactsRetained: true,
    };
  writeReport(s, report);
  return report;
}
function prepareRun(options) {
  Q.requireThat(
    options.stage === "pre-submit",
    "This bounded runner implements pre-submit only; post-distribution requires its reviewed signed/provider coordinator",
  );
  Q.requireThat(
    !options.signedPackage && !options.expectedDistribution,
    "Distribution/signed inputs rejected for pre-submit",
  );
  const expected = Q.validateExpected(options.expected);
  Q.requireThat(
    options.target === expected.target &&
      options.expectedBrowserVersion === expected.browser.version,
    "Target/browser pin mismatch",
  );
  const candidate = V.verifyCandidate({
    packagePath: options.packagePath,
    inventoryPath: options.inventoryPath,
    expected,
    expectedPackageSha256: options.expectedPackageSha256,
    expectedInventorySha256: options.expectedInventorySha256,
  });
  const root = path.resolve(options.evidenceDir);
  noLinks(root);
  Q.requireThat(
    !fs.existsSync(root),
    "Evidence directory must be fresh; personal/resumed profiles rejected",
  );
  Q.requireThat(
    path.dirname(path.resolve(options.reportPath)) === root &&
      path.extname(options.reportPath) === ".json",
    "Report must be an owned root JSON",
  );
  fs.mkdirSync(root);
  const candidateRoot = path.join(root, "candidate");
  try {
    V.extractVerified(candidate, candidateRoot);
  } catch (e) {
    fs.writeFileSync(
      path.join(root, "verification-failed.json"),
      JSON.stringify({
        kind: "candidate-verification-failed",
        code: e.code || "QA_INVALID",
        nativeStarted: false,
        artifactsRetained: true,
      }) + "\n",
    );
    throw e;
  }
  const runId = crypto.randomUUID(),
    profile = path.join(root, "profile"),
    downloads = path.join(root, "downloads");
  fs.mkdirSync(profile);
  fs.mkdirSync(downloads);
  fs.mkdirSync(path.join(root, "evidence"));
  const selector = {
    stage: "pre-submit",
    target: expected.target,
    capabilities: expected.capabilities,
    firstPublication: expected.firstPublication,
  };
  const session = Object.freeze({
    runId,
    evidenceDir: root,
    candidateRoot,
    profile,
    downloads,
  });
  const state = {
    root,
    runId,
    expected,
    candidate,
    reportPath: path.resolve(options.reportPath),
    profile,
    downloads,
    selector,
    fixtures: F.fixtures({
      preserveVirtualizer: expected.capabilities.preserveVirtualizer,
    }),
    installedObservation: null,
    browserIdentity: null,
    child: null,
    childExited: false,
    launched: false,
    startedAt: null,
    attemptJournal: [],
    activeAttempt: null,
    launchError: null,
    downloadsSeen: new Map(),
    stableFiles: [],
    partialFiles: [],
    lastPollAt: 0,
    closed: false,
  };
  sessions.set(session, state);
  fs.writeFileSync(
    path.join(root, ".cfp-qa-owned.json"),
    Q.canonical({
      schemaVersion: 1,
      runId,
      stage: "pre-submit",
      target: expected.target,
      packageSha256: expected.packageSha256,
      profile: "profile",
      downloads: "downloads",
    }),
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(root, "reviewer-template.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        runId,
        packageSha256: expected.packageSha256,
        browser: null,
        extension: null,
        downloadsPreference: null,
        display: null,
        cleanup: null,
        checks: Q.requiredChecks(selector).map((r) => ({
          id: r.id,
          status: "unrun",
          evidence: [],
        })),
        attempts: [],
        reviewer: null,
        limitations: [],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  partial(
    session,
    "Native browser launch, manual loading, gestures, download observations and cleanup remain unrun.",
  );
  return session;
}
function cleanEnvironment() {
  const env = {};
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "PATH",
    "Path",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}
function inspectBrowser(executable, target, expected) {
  noLinks(executable);
  const bytes = V.ordinaryFile(executable, 512 * 1024 * 1024);
  Q.requireThat(
    Q.digest(bytes) === expected.executableSha256,
    "Browser executable digest mismatch",
  );
  let output;
  if (process.platform === "win32") {
    const powershell = path.join(
        process.env.SystemRoot,
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      quoted = path.resolve(executable).replace(/'/g, "''");
    const run = cp.spawnSync(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Item -LiteralPath '${quoted}').VersionInfo.ProductVersion`,
      ],
      {
        env: cleanEnvironment(),
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      },
    );
    Q.requireThat(run.status === 0, "Browser version metadata unavailable");
    output = run.stdout;
  } else {
    const run = cp.spawnSync(executable, ["--version"], {
      env: cleanEnvironment(),
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    Q.requireThat(run.status === 0, "Browser version unavailable");
    output = run.stdout;
  }
  const observed = output?.match(
    /\b[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?\b/,
  )?.[0];
  Q.requireThat(
    observed === expected.version,
    "Browser version mismatch; no launch",
  );
  return {
    name: target === "chrome" ? "Chrome" : "Firefox",
    version: observed,
    channel: expected.channel,
    executableSha256: Q.digest(bytes),
  };
}
async function launchBrowser(session, executable) {
  const s = stateOf(session);
  Q.requireThat(!s.launched && !s.closed, "Run already launched/closed");
  Q.requireThat(
    s.candidate.inventory.releaseQualified,
    "Development artifact cannot enter completed release QA",
  );
  s.browserIdentity = inspectBrowser(
    executable,
    s.expected.target,
    s.expected.browser,
  );
  const routeMap = F.routes(s.fixtures),
    server = http.createServer((req, res) =>
      F.handleRequest(routeMap, req, res),
    );
  s.server = server;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const args =
    s.expected.target === "chrome"
      ? [
          `--user-data-dir=${s.profile}`,
          "--no-first-run",
          "--no-default-browser-check",
          url,
        ]
      : ["--no-remote", "--profile", s.profile, url];
  s.startedAt = new Date().toISOString();
  try {
    s.child = cp.spawn(executable, args, {
      env: cleanEnvironment(),
      stdio: "ignore",
      windowsHide: false,
    });
    s.launched = true;
    s.child.once("exit", (code, signal) => {
      s.childExited = true;
      s.childExit = { code, signal };
    });
    s.child.once("error", () => {
      s.launchError = Error("Owned browser launch failed");
      s.childExited = true;
      partial(session, "Owned browser launch failed; no qualification.");
    });
  } catch (e) {
    server.close();
    throw e;
  }
  partial(
    session,
    "Browser launched in owned profile; manual native observations incomplete.",
  );
  return {
    url,
    profile: s.profile,
    downloads: s.downloads,
    candidateRoot: session.candidateRoot,
    reviewerEvidence: path.join(s.root, "reviewer.json"),
  };
}
function pollDownloads(session, now = Date.now()) {
  const s = stateOf(session);
  noLinks(s.downloads);
  Q.requireThat(
    now >= s.lastPollAt,
    "Clock moved backward during download observation",
  );
  if (now - s.lastPollAt < POLL_MS) return s.stableFiles;
  s.lastPollAt = now;
  const names = fs.readdirSync(s.downloads);
  Q.requireThat(
    names.length <= 128,
    "Download directory observation budget exceeded",
  );
  const stable = [],
    partials = [];
  for (const name of names) {
    Q.requireThat(
      Buffer.byteLength(name) <= 240 &&
        !name.includes("/") &&
        !name.includes("\\"),
      "Unsafe download name",
    );
    const file = inside(s.root, path.join(s.downloads, name));
    noLinks(file);
    const stat = fs.lstatSync(file);
    Q.requireThat(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128 * 1024 * 1024,
      "Invalid native download entry",
    );
    if (/\.(?:crdownload|part|partial|tmp)$/i.test(name)) {
      partials.push(name);
      continue;
    }
    Q.requireThat(
      name.endsWith(".png"),
      "Unexpected finished native download file",
    );
    const previous = s.downloadsSeen.get(name),
      signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const observation =
      previous?.signature === signature
        ? { ...previous, stable: previous.stable + 1 }
        : { signature, stable: 1, firstSeenAt: previous?.firstSeenAt || now };
    s.downloadsSeen.set(name, observation);
    if (observation.stable >= 2 && stat.size > 0) {
      const bytes = V.ordinaryFile(file, 128 * 1024 * 1024);
      stable.push({
        name,
        file,
        firstSeenAt: observation.firstSeenAt,
        sha256: Q.digest(bytes),
        png: decodePng(bytes),
      });
    }
  }
  s.stableFiles = stable;
  s.partialFiles = partials;
  return stable;
}
function observeAttempt(session, raw, now = performance.now()) {
  const s = stateOf(session),
    a = Q.parse(raw);
  Q.record(a, [
    "schemaVersion",
    "runId",
    "sequence",
    "fixtureId",
    "gesture",
    "startedAt",
    "state",
    "result",
    "evidence",
  ]);
  Q.requireThat(
    s.launched &&
      a.schemaVersion === 1 &&
      a.runId === s.runId &&
      Number.isSafeInteger(a.sequence) &&
      a.sequence >= 1 &&
      a.sequence <= 64 &&
      s.fixtures.some((f) => f.id === a.fixtureId),
    "Unbound native attempt intent",
  );
  Q.requireThat(
    ["toolbar", "context-menu-top", "context-menu-iframe", "cancel"].includes(
      a.gesture,
    ) &&
      ["running", "finished"].includes(a.state) &&
      Number.isFinite(Date.parse(a.startedAt)),
    "Invalid native attempt intent",
  );
  Q.utc(a.startedAt);
  Q.requireThat(
    Date.parse(a.startedAt) >= Date.parse(s.startedAt),
    "Attempt intent predates native run",
  );
  let active = s.activeAttempt;
  if (!active || a.sequence !== active.sequence) {
    Q.requireThat(
      a.sequence === s.attemptJournal.length + 1 &&
        (!active || active.completed),
      "Attempt sequence overlaps/replays",
    );
    active = {
      sequence: a.sequence,
      fixtureId: a.fixtureId,
      gesture: a.gesture,
      startedAt: a.startedAt,
      deadline: now + ATTEMPT_MS,
      finishedIntentAt: null,
      completed: false,
    };
    s.activeAttempt = active;
    s.attemptJournal.push(active);
  }
  Q.requireThat(
    active.fixtureId === a.fixtureId &&
      active.gesture === a.gesture &&
      active.startedAt === a.startedAt,
    "Attempt identity changed",
  );
  if (active.completed) {
    Q.requireThat(
      a.state === "finished" && a.result === active.result,
      "Completed native observation changed",
    );
    return { ...active };
  }
  Q.requireThat(
    now <= active.deadline + FINAL_OBSERVATION_MS,
    "Native attempt timeout; deadline cannot renew",
  );
  if (a.state === "finished") {
    Q.requireThat(
      ["success", "pre-initiation-failure"].includes(a.result),
      "Invalid native completion observation",
    );
    evidenceRefs(s.root, a.evidence);
    active.finishedIntentAt ??= now;
    Q.requireThat(
      now <= active.finishedIntentAt + FINAL_OBSERVATION_MS + POLL_MS,
      "Final native-initiation observation timeout",
    );
    const fixture = s.fixtures.find((f) => f.id === a.fixtureId),
      matches = s.stableFiles.filter(
        (f) =>
          F.filenamePattern(fixture).test(f.name) &&
          f.firstSeenAt >= Date.parse(a.startedAt),
      );
    Q.requireThat(
      matches.length <= (a.result === "success" ? 1 : 0),
      "Duplicate/unexpected native output",
    );
    if (
      matches.length === (a.result === "success" ? 1 : 0) &&
      s.partialFiles.length === 0 &&
      now >= active.finishedIntentAt + FINAL_OBSERVATION_MS
    ) {
      active.completed = true;
      active.result = a.result;
    }
  } else
    Q.requireThat(
      a.result === null && !active.completed,
      "Running attempt cannot assert output/renew a completed attempt",
    );
  return { ...active };
}
function validateReviewer(session, raw) {
  const s = stateOf(session),
    r = Q.parse(raw);
  Q.record(r, [
    "schemaVersion",
    "runId",
    "packageSha256",
    "browser",
    "extension",
    "downloadsPreference",
    "display",
    "cleanup",
    "checks",
    "attempts",
    "reviewer",
    "limitations",
  ]);
  Q.requireThat(
    s.launched &&
      s.browserIdentity &&
      r.schemaVersion === 1 &&
      r.runId === s.runId &&
      r.packageSha256 === s.expected.packageSha256,
    "Missing native launch/run identity",
  );
  Q.browser(r.browser);
  Q.requireThat(
    Q.canonical(r.browser).equals(Q.canonical(s.browserIdentity)),
    "Wrong observed native browser",
  );
  Q.record(r.extension, ["id", "version", "sourceRoute", "evidence"]);
  Q.text(
    r.extension.id,
    160,
    s.expected.target === "chrome"
      ? /^[a-p]{32}$/
      : /^capture-full-page@ohokthisisfine\.github$/,
  );
  Q.requireThat(
    r.extension.version === s.expected.version &&
      r.extension.sourceRoute === "native-extension-detail",
    "Manifest/provider expectations are not native installation observation",
  );
  evidenceRefs(s.root, r.extension.evidence);
  Q.record(r.downloadsPreference, [
    "askWhereToSave",
    "sourceRoute",
    "evidence",
  ]);
  Q.requireThat(
    typeof r.downloadsPreference.askWhereToSave === "boolean" &&
      r.downloadsPreference.sourceRoute === "native-preferences-observation",
    "Missing native save preference observation",
  );
  evidenceRefs(s.root, r.downloadsPreference.evidence);
  Q.record(r.cleanup, ["browserClosed", "sourceRoute", "evidence"]);
  Q.requireThat(
    r.cleanup.browserClosed === true &&
      r.cleanup.sourceRoute === "native-owned-window-closed" &&
      s.childExited,
    "Owned browser cleanup not observed",
  );
  evidenceRefs(s.root, r.cleanup.evidence);
  Q.requireThat(
    Array.isArray(r.limitations) && r.limitations.length <= 8,
    "Invalid limitations",
  );
  Q.validateChecks(r.checks, Q.requiredChecks(s.selector), r.limitations);
  for (const c of r.checks) evidenceRefs(s.root, c.evidence);
  Q.requireThat(
    Array.isArray(r.attempts) &&
      r.attempts.length > 0 &&
      r.attempts.length <= 64,
    "Missing/bounded native gesture attempts",
  );
  Q.requireThat(
    s.attemptJournal.length === r.attempts.length &&
      s.attemptJournal.every((a) => a.completed),
    "Missing observed per-attempt native timeline",
  );
  const assigned = new Set(),
    gestures = new Set(),
    fixtureIds = new Set();
  let prior = Date.parse(s.startedAt);
  for (const [attemptIndex, attempt] of r.attempts.entries()) {
    const journal = s.attemptJournal[attemptIndex];
    Q.requireThat(
      journal.fixtureId === attempt.fixtureId &&
        journal.gesture === attempt.gesture &&
        journal.startedAt === attempt.startedAt &&
        journal.result === attempt.result,
      "Reviewer attempt changed observed timeline",
    );
    Q.record(attempt, [
      "fixtureId",
      "gesture",
      "startedAt",
      "finishedAt",
      "result",
      "evidence",
    ]);
    Q.requireThat(
      ["toolbar", "context-menu-top", "context-menu-iframe", "cancel"].includes(
        attempt.gesture,
      ),
      "Not a genuine declared UI gesture",
    );
    evidenceRefs(s.root, attempt.evidence);
    Q.utc(attempt.startedAt);
    Q.utc(attempt.finishedAt);
    const start = Date.parse(attempt.startedAt),
      finish = Date.parse(attempt.finishedAt);
    Q.requireThat(
      Number.isFinite(start) &&
        Number.isFinite(finish) &&
        start >= prior &&
        finish >= start &&
        finish - start <= ATTEMPT_MS &&
        finish <= Date.now(),
      "Overlapping/out-of-bound native attempt",
    );
    prior = finish;
    const fixture = s.fixtures.find((f) => f.id === attempt.fixtureId);
    Q.requireThat(
      fixture && ["success", "pre-initiation-failure"].includes(attempt.result),
      "Unknown fixture/result",
    );
    const matches = s.stableFiles.filter(
      (file) =>
        F.filenamePattern(fixture).test(file.name) &&
        file.firstSeenAt >= start &&
        file.firstSeenAt <= finish + FINAL_OBSERVATION_MS &&
        !assigned.has(file.name),
    );
    Q.requireThat(
      matches.length === (attempt.result === "success" ? 1 : 0),
      "Exactly-one/zero native download oracle failed",
    );
    for (const item of matches) {
      const oracle = F.verifyPixels(item.png, fixture);
      item.oracle = oracle;
      assigned.add(item.name);
      fixtureIds.add(fixture.id);
    }
    gestures.add(`${attempt.gesture}:${attempt.result}`);
  }
  Q.requireThat(
    s.partialFiles.length === 0 && assigned.size === s.stableFiles.length,
    "Pending/unattributed/duplicate native download",
  );
  for (const required of [
    "toolbar:success",
    "context-menu-top:success",
    "context-menu-iframe:success",
    "cancel:pre-initiation-failure",
  ])
    Q.requireThat(gestures.has(required), "Mandatory native gesture missing");
  if (s.expected.capabilities.preserveVirtualizer)
    for (const mode of [
      "scroll-only",
      "resize-observer",
      "recycled",
      "recreated",
    ])
      Q.requireThat(
        fixtureIds.has("virtual-" + mode),
        "Enabled preserve finite mode missing",
      );
  for (const required of [
    "coordinate-grid",
    "short-viewports",
    "fractional-scale",
    "tile-boundary-8192",
    "tile-boundary-adaptive",
    "nested-static-shell",
    "iframe-padding",
  ])
    Q.requireThat(
      fixtureIds.has(required),
      "Mandatory native PNG fixture missing",
    );
  s.installedObservation = {
    id: r.extension.id,
    version: r.extension.version,
    sourceRoute: r.extension.sourceRoute,
    evidence: evidenceRefs(s.root, r.extension.evidence),
  };
  return r;
}
function completeRun(session, raw) {
  const s = stateOf(session),
    r = validateReviewer(session, raw);
  const q = {
    schemaVersion: 1,
    repository: s.expected.repository,
    commit: s.expected.commit,
    target: s.expected.target,
    extensionVersion: s.expected.version,
    manifestFormatVersion: 3,
    packageSha256: s.expected.packageSha256,
    inventorySha256: s.expected.inventorySha256,
    buildRunId: s.expected.buildRunId,
    artifactId: s.expected.artifactId,
    stage: "pre-submit",
    rulesBinding: Q.binding(s.selector),
    rulesBindingSha256: s.expected.rulesBindingSha256,
    browser: s.browserIdentity,
    os: { name: os.platform(), version: os.release(), arch: os.arch() },
    display: r.display,
    sourceRoute: "packaged-extension/real-captureVisibleTab",
    checks: r.checks.map((c) => ({
      ...c,
      evidence: evidenceRefs(s.root, c.evidence),
    })),
    startedAt: s.startedAt,
    finishedAt: new Date().toISOString(),
    reviewer: r.reviewer,
    limitations: r.limitations,
  };
  const validated = Q.validateQaRecord(q, s.expected);
  fs.writeFileSync(
    path.join(s.root, "native-oracles.json"),
    Q.canonical({
      runId: s.runId,
      packageSha256: s.expected.packageSha256,
      fixtures: s.fixtures.map((f) => ({
        id: f.id,
        sourceSha256: f.sourceSha256,
      })),
      downloads: s.stableFiles.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        oracle: f.oracle,
      })),
      installedObservation: s.installedObservation,
      childExit: s.childExit,
      qaSha256: Q.digest(Q.canonical(validated)),
    }),
    { flag: "wx" },
  );
  writeReport(s, validated, true);
  s.closed = true;
  s.server?.close();
  return validated;
}
function checkpointAndClose(session, reason) {
  const s = stateOf(session);
  partial(session, reason);
  s.server?.close();
  if (s.child && !s.childExited) s.child.kill("SIGTERM");
  s.closed = true;
}
function parseArgs(args) {
  const values = {},
    booleans = new Set(["--launch"]),
    allowed = new Set([
      "--target",
      "--package",
      "--inventory",
      "--report",
      "--stage",
      "--expected-package-sha256",
      "--expected-inventory-sha256",
      "--expected-browser-version",
      "--evidence-dir",
      "--expected",
      "--expected-review-sha256",
      "--launch",
    ]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    Q.requireThat(
      allowed.has(key) && !Object.hasOwn(values, key),
      "Unknown/duplicate CLI flag",
    );
    if (booleans.has(key)) values[key] = true;
    else {
      Q.requireThat(
        i + 1 < args.length && !args[i + 1].startsWith("--"),
        "Missing CLI value",
      );
      values[key] = args[++i];
    }
  }
  for (const key of [...allowed].filter((k) => !booleans.has(k)))
    Q.requireThat(Object.hasOwn(values, key), `Required ${key}`);
  return values;
}
async function main(args) {
  const a = parseArgs(args),
    expectedBytes = V.ordinaryFile(a["--expected"], 32768);
  Q.requireThat(
    Q.digest(expectedBytes) === Q.hash(a["--expected-review-sha256"]),
    "Independent trusted-review digest mismatch",
  );
  const expected = Q.validateExpected(expectedBytes),
    session = prepareRun({
      stage: a["--stage"],
      target: a["--target"],
      packagePath: a["--package"],
      inventoryPath: a["--inventory"],
      reportPath: a["--report"],
      evidenceDir: a["--evidence-dir"],
      expected,
      expectedPackageSha256: a["--expected-package-sha256"],
      expectedInventorySha256: a["--expected-inventory-sha256"],
      expectedBrowserVersion: a["--expected-browser-version"],
    });
  if (!a["--launch"]) {
    console.log(
      "BLOCKED: owned candidate preparation only; native loading/gestures/evidence unrun.",
    );
    return 2;
  }
  const s = stateOf(session),
    executable =
      process.env[
        s.expected.target === "chrome"
          ? "CFP_CHROMIUM_EXECUTABLE"
          : "CFP_FIREFOX_EXECUTABLE"
      ];
  Q.requireThat(executable, "Exact provisioned browser executable required");
  let aborted = false;
  const abort = () => {
    aborted = true;
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const instructions = await launchBrowser(session, executable);
    console.log(
      JSON.stringify({ kind: "manual-native-instructions", ...instructions }),
    );
    const deadline = Date.now() + ATTEMPT_MS * 64 + FINAL_OBSERVATION_MS;
    while (Date.now() < deadline && !aborted) {
      if (s.launchError) throw s.launchError;
      pollDownloads(session);
      const intentPath = path.join(s.root, "current-attempt.json");
      if (fs.existsSync(intentPath))
        observeAttempt(session, V.ordinaryFile(intentPath, 32768));
      else
        Q.requireThat(
          Date.now() - Date.parse(s.startedAt) <= ATTEMPT_MS,
          "Manual first-attempt admission timeout",
        );
      if (s.activeAttempt && !s.activeAttempt.completed)
        Q.requireThat(
          performance.now() <= s.activeAttempt.deadline + FINAL_OBSERVATION_MS,
          "Native attempt timeout",
        );
      const reviewerPath = path.join(s.root, "reviewer.json");
      if (fs.existsSync(reviewerPath)) {
        const reviewer = V.ordinaryFile(reviewerPath, 32768);
        const parsed = Q.parse(reviewer);
        if (parsed.checks?.some((c) => c.status === "fail")) {
          checkpointAndClose(
            session,
            "Reviewer recorded failed native check; not qualified.",
          );
          return 1;
        }
        if (
          !parsed.checks?.some(
            (c) =>
              c.status === "unrun" &&
              Q.requiredChecks(s.selector).find((r) => r.id === c.id)?.gate !==
                "claim-only",
          ) &&
          s.childExited &&
          s.partialFiles.length === 0
        ) {
          completeRun(session, reviewer);
          return 0;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    checkpointAndClose(
      session,
      "Manual native run cancelled/timed out with incomplete observations.",
    );
    return 2;
  } catch (e) {
    checkpointAndClose(
      session,
      "Native validation failed; retained owned evidence, no qualification.",
    );
    throw e;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
if (require.main === module)
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      console.error(e.code || "QA_INVALID", e.message);
      process.exitCode = 1;
    });
module.exports = {
  POLL_MS,
  ATTEMPT_MS,
  FINAL_OBSERVATION_MS,
  prepareRun,
  partial,
  pollDownloads,
  observeAttempt,
  validateReviewer,
  completeRun,
  launchBrowser,
  checkpointAndClose,
  parseArgs,
  inside,
  noLinks,
  evidenceRefs,
  cleanEnvironment,
  inspectBrowser,
};
