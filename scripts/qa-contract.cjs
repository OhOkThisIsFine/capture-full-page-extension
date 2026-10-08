"use strict";
const crypto = require("node:crypto");
const CAPABILITIES = [
  "privateCapture",
  "preserveVirtualizer",
  "fileAccess",
  "resourceAccountingChanged",
  "downloadOwnershipChanged",
  "workerLossClaim",
  "resumeClaim",
];
const BASE =
  "entry-toolbar entry-context-menu-top entry-context-menu-iframe filename-auto-uniquify exactly-one-download no-extension-save-prompt short-viewports two-axis-coordinate-grid tile-boundary-8192 tile-boundary-adaptive fractional-scale iframe-padding nested-static-shell restoration-success restoration-cancel popup-reopen duplicate-start same-window-tab-change unrelated-window-tab-change navigation-disconnect restricted-page file-access-denied recapture-after-failure sender-shapes source-tab-attribution source-document-attribution rendered-coordinate-attribution".split(
    " ",
  );
const POST =
  "provider-listed-item-identity provider-version-live signed-install browser-restart toolbar-after-update context-menu-after-update exactly-one-download-after-update".split(
    " ",
  );
const STATUSES = ["pass", "fail", "unrun", "unsupported", "not-applicable"];
const QA_FIELDS = [
  "schemaVersion",
  "repository",
  "commit",
  "target",
  "extensionVersion",
  "manifestFormatVersion",
  "packageSha256",
  "inventorySha256",
  "buildRunId",
  "artifactId",
  "stage",
  "rulesBinding",
  "rulesBindingSha256",
  "browser",
  "os",
  "display",
  "sourceRoute",
  "checks",
  "startedAt",
  "finishedAt",
  "reviewer",
  "limitations",
];
const EXPECTED_FIELDS = [
  "repository",
  "commit",
  "target",
  "version",
  "packageSha256",
  "inventorySha256",
  "buildRunId",
  "artifactId",
  "capabilities",
  "firstPublication",
  "rulesBindingSha256",
  "browser",
];
function fail(message) {
  const e = new Error(message);
  e.code = "QA_INVALID";
  throw e;
}
function requireThat(value, message) {
  if (!value) fail(message);
}
function record(value, keys) {
  requireThat(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    "Expected own plain record",
  );
  const actual = Reflect.ownKeys(value);
  requireThat(
    actual.length === keys.length &&
      actual.every((k) => typeof k === "string" && keys.includes(k)),
    "Unknown or missing record field",
  );
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    requireThat(
      d && Object.hasOwn(d, "value") && d.enumerable,
      "Accessor/non-enumerable field rejected",
    );
  }
  return value;
}
function text(value, limit, pattern = null) {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      Buffer.byteLength(value) <= limit &&
      !/[\x00-\x1f\x7f]/.test(value) &&
      (!pattern || pattern.test(value)),
    "Invalid bounded text",
  );
  return value;
}
function canonical(value) {
  let count = 0;
  function visit(v, depth) {
    requireThat(++count <= 12000 && depth <= 32, "Data depth/size exceeded");
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number") {
      requireThat(Number.isFinite(v), "Nonfinite number");
      return v;
    }
    if (Array.isArray(v)) {
      requireThat(
        v.length <= 1024 && Reflect.ownKeys(v).length === v.length + 1,
        "Invalid bounded array",
      );
      const out = [];
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        requireThat(d && Object.hasOwn(d, "value"), "Sparse/accessor array");
        out.push(visit(d.value, depth + 1));
      }
      return out;
    }
    requireThat(
      v &&
        typeof v === "object" &&
        [Object.prototype, null].includes(Object.getPrototypeOf(v)),
      "Non-data value",
    );
    const keys = Reflect.ownKeys(v);
    requireThat(
      keys.length <= 128 && keys.every((k) => typeof k === "string"),
      "Invalid data keys",
    );
    const out = Object.create(null);
    for (const key of keys.sort()) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      requireThat(
        d && Object.hasOwn(d, "value") && d.enumerable,
        "Accessor rejected",
      );
      out[key] = visit(d.value, depth + 1);
    }
    return out;
  }
  return Buffer.from(JSON.stringify(visit(value, 0)) + "\n");
}
function parse(raw, limit = 32768) {
  if (Buffer.isBuffer(raw) || typeof raw === "string") {
    const bytes = Buffer.from(raw);
    requireThat(bytes.length <= limit, "JSON byte bound exceeded");
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("Invalid UTF-8 JSON");
    }
  }
  requireThat(canonical(raw).length <= limit, "JSON byte bound exceeded");
  return raw;
}
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const hash = (value) => text(value, 64, /^[a-f0-9]{64}$/);
const version = (value) =>
  text(
    value,
    32,
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?$/,
  );
function capabilities(value) {
  record(value, CAPABILITIES);
  for (const k of CAPABILITIES)
    requireThat(typeof value[k] === "boolean", "Missing boolean capability");
  return value;
}
function requiredChecks({
  stage,
  target,
  capabilities: caps,
  firstPublication,
}) {
  capabilities(caps);
  requireThat(
    ["pre-submit", "post-distribution"].includes(stage) &&
      ["chrome", "firefox"].includes(target) &&
      typeof firstPublication === "boolean",
    "Invalid rule selector",
  );
  const rows = [];
  const add = (id, statuses = ["pass"], gate = "required") =>
    rows.push({
      id,
      allowedStatuses: [...statuses].sort(),
      gate,
      evidenceRequired: true,
    });
  if (stage === "post-distribution") {
    POST.forEach((id) => add(id));
    add(
      "signed-update-from-observed-prior-version",
      firstPublication ? ["not-applicable"] : ["pass"],
    );
  } else {
    BASE.forEach((id) => add(id));
    add(
      target === "chrome"
        ? "offscreen-lifecycle-Chrome"
        : "shared-background-Firefox",
    );
    (caps.privateCapture
      ? ["private-allowed", "private-denied"]
      : ["private-disabled"]
    ).forEach((id) => add(id));
    add(
      caps.preserveVirtualizer ? "preserve-virtualizer" : "preserve-disabled",
    );
    add("file-access-allowed", caps.fileAccess ? ["pass"] : ["not-applicable"]);
    for (const id of ["q3-resource-envelope", "q3-late-disposal"])
      add(
        id,
        caps.resourceAccountingChanged ? ["pass"] : ["pass", "not-applicable"],
      );
    add(
      "q4-armed-source-lifetime",
      caps.downloadOwnershipChanged ? ["pass"] : ["pass", "not-applicable"],
    );
    for (const [id, claim] of [
      ["q4-worker-loss", caps.workerLossClaim],
      ["q4-paused-resume", caps.resumeClaim],
    ])
      add(
        id,
        claim ? ["pass"] : ["pass", "unrun"],
        claim ? "required" : "claim-only",
      );
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function binding(selector) {
  const { stage, target, capabilities: caps, firstPublication } = selector;
  return {
    schemaVersion: 1,
    stage,
    target,
    capabilities: { ...capabilities(caps) },
    firstPublication,
    rules: requiredChecks(selector),
  };
}
function bindingDigest(selector) {
  return digest(canonical(binding(selector)));
}
function browser(value) {
  record(value, ["name", "version", "channel", "executableSha256"]);
  text(value.name, 32);
  version(value.version);
  text(value.channel, 32);
  hash(value.executableSha256);
  return value;
}
function validateExpected(value) {
  value = parse(value);
  record(value, EXPECTED_FIELDS);
  text(value.repository, 160, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  text(value.commit, 40, /^[a-f0-9]{40}$/);
  requireThat(["chrome", "firefox"].includes(value.target), "Invalid target");
  version(value.version);
  hash(value.packageSha256);
  hash(value.inventorySha256);
  for (const k of ["buildRunId", "artifactId"])
    text(value[k], 32, /^[1-9][0-9]*$/);
  capabilities(value.capabilities);
  requireThat(
    typeof value.firstPublication === "boolean",
    "Missing first publication binding",
  );
  hash(value.rulesBindingSha256);
  browser(value.browser);
  requireThat(
    value.browser.name === (value.target === "chrome" ? "Chrome" : "Firefox"),
    "Wrong browser target",
  );
  requireThat(
    bindingDigest({
      stage: "pre-submit",
      target: value.target,
      capabilities: value.capabilities,
      firstPublication: value.firstPublication,
    }) === value.rulesBindingSha256,
    "Independent rules binding mismatch",
  );
  return value;
}
function evidence(value) {
  requireThat(
    Array.isArray(value) && value.length > 0 && value.length <= 8,
    "Missing/bounded native evidence",
  );
  for (const ref of value) text(ref, 512);
}
function validateChecks(checks, rules, limitations = []) {
  requireThat(
    Array.isArray(checks) && checks.length === rules.length,
    "Missing/extra check row",
  );
  const seen = new Set();
  for (const check of checks) {
    record(check, ["id", "status", "evidence"]);
    text(check.id, 96);
    requireThat(!seen.has(check.id), "Duplicate check row");
    seen.add(check.id);
    const rule = rules.find((r) => r.id === check.id);
    requireThat(
      rule &&
        STATUSES.includes(check.status) &&
        rule.allowedStatuses.includes(check.status),
      "Unqualified/unknown check status",
    );
    if (rule.evidenceRequired) evidence(check.evidence);
    if (check.status === "unrun")
      requireThat(
        rule.gate === "claim-only" &&
          limitations.some(
            (v) =>
              typeof v === "string" &&
              v.startsWith(check.id + ":") &&
              v.length > check.id.length + 2,
          ),
        "Unrun claim needs explicit limitation",
      );
  }
}
function utc(value) {
  text(value, 32, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  requireThat(
    Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() ===
        value.replace(/Z$/, ".000Z").replace(/\.(\d{3})\.000Z$/, ".$1Z"),
    "Invalid UTC timestamp",
  );
}
const validRecords = new WeakSet();
function validateQaRecord(raw, expected) {
  expected = validateExpected(expected);
  const q = parse(raw);
  record(q, QA_FIELDS);
  requireThat(
    q.schemaVersion === 1 &&
      q.manifestFormatVersion === 3 &&
      q.stage === "pre-submit",
    "Not completed pre-submit QA",
  );
  for (const [qkey, ekey] of [
    ["repository", "repository"],
    ["commit", "commit"],
    ["target", "target"],
    ["extensionVersion", "version"],
    ["packageSha256", "packageSha256"],
    ["inventorySha256", "inventorySha256"],
    ["buildRunId", "buildRunId"],
    ["artifactId", "artifactId"],
    ["rulesBindingSha256", "rulesBindingSha256"],
  ])
    requireThat(
      q[qkey] === expected[ekey],
      "Candidate/build/independent binding mismatch",
    );
  const selector = {
    stage: q.stage,
    target: q.target,
    capabilities: expected.capabilities,
    firstPublication: expected.firstPublication,
  };
  requireThat(
    canonical(q.rulesBinding).equals(canonical(binding(selector))) &&
      digest(canonical(q.rulesBinding)) === q.rulesBindingSha256,
    "Current rules/capability digest mismatch",
  );
  browser(q.browser);
  requireThat(
    canonical(q.browser).equals(canonical(expected.browser)),
    "Observed browser identity mismatch",
  );
  record(q.os, ["name", "version", "arch"]);
  for (const k of ["name", "version", "arch"]) text(q.os[k], 96);
  record(q.display, ["scale", "dpr", "zoom"]);
  for (const k of ["scale", "dpr", "zoom"])
    requireThat(
      Number.isFinite(q.display[k]) &&
        q.display[k] >= 0.1 &&
        q.display[k] <= 16,
      "Invalid display observation",
    );
  requireThat(
    q.sourceRoute === "packaged-extension/real-captureVisibleTab",
    "Source-only route cannot qualify",
  );
  utc(q.startedAt);
  utc(q.finishedAt);
  requireThat(
    Date.parse(q.finishedAt) >= Date.parse(q.startedAt),
    "Reversed QA timestamps",
  );
  text(q.reviewer, 160);
  requireThat(
    Array.isArray(q.limitations) && q.limitations.length <= 8,
    "Invalid limitations",
  );
  for (const v of q.limitations) text(v, 512);
  validateChecks(q.checks, requiredChecks(selector), q.limitations);
  const validated = JSON.parse(canonical(q));
  const freeze = (value) => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(validated);
  validRecords.add(validated);
  return validated;
}
module.exports = {
  CAPABILITIES,
  STATUSES,
  record,
  text,
  requireThat,
  parse,
  canonical,
  digest,
  hash,
  version,
  capabilities,
  requiredChecks,
  binding,
  bindingDigest,
  browser,
  evidence,
  validateExpected,
  validateChecks,
  utc,
  validateQaRecord,
  isValidatedQa: (q) => validRecords.has(q),
};
