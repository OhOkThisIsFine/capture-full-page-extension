"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  Q = require("../scripts/qa-contract.cjs"),
  V = require("../scripts/verify-qa-candidate.cjs"),
  { fixture, qa, defaults } = require("./helpers/qa-fixtures.cjs");
const clone = (x) => JSON.parse(JSON.stringify(x));
test("QA production rule table exhaustively binds capability/stage/target combinations", () => {
  for (const target of ["chrome", "firefox"])
    for (let mask = 0; mask < 128; mask++) {
      const caps = Object.fromEntries(
        Q.CAPABILITIES.map((k, i) => [k, Boolean(mask & (1 << i))]),
      );
      const rules = Q.requiredChecks({
        stage: "pre-submit",
        target,
        capabilities: caps,
        firstPublication: false,
      });
      const ids = rules.map((r) => r.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(ids, [...ids].sort());
      assert.ok(ids.includes("exactly-one-download"));
      for (const id of [
        "source-tab-attribution",
        "source-document-attribution",
        "rendered-coordinate-attribution",
      ])
        assert.deepEqual(rules.find((r) => r.id === id).allowedStatuses, [
          "pass",
        ]);
      assert.equal(ids.includes("private-disabled"), !caps.privateCapture);
      assert.equal(ids.includes("private-allowed"), caps.privateCapture);
      assert.equal(
        ids.includes("preserve-disabled"),
        !caps.preserveVirtualizer,
      );
      assert.equal(
        rules.find((r) => r.id === "file-access-allowed").allowedStatuses[0],
        caps.fileAccess ? "pass" : "not-applicable",
      );
      assert.equal(
        rules.find((r) => r.id === "q4-worker-loss").gate,
        caps.workerLossClaim ? "required" : "claim-only",
      );
    }
  for (const firstPublication of [false, true]) {
    const rules = Q.requiredChecks({
      stage: "post-distribution",
      target: "firefox",
      capabilities: defaults,
      firstPublication,
    });
    assert.deepEqual(
      rules.find((r) => r.id === "signed-update-from-observed-prior-version")
        .allowedStatuses,
      firstPublication ? ["not-applicable"] : ["pass"],
    );
  }
});
test("valid synthetic pre-submit record is deeply immutable and canonical order-independent", () => {
  const f = fixture();
  try {
    const q = qa(f.expected),
      valid = Q.validateQaRecord(q, f.expected);
    assert.equal(Q.isValidatedQa(valid), true);
    assert.equal(Q.isValidatedQa(q), false);
    assert.throws(() => {
      valid.checks[0].status = "unrun";
    }, TypeError);
    const reverse = Object.fromEntries(
      Object.entries(q.rulesBinding).reverse(),
    );
    assert.equal(Q.digest(Q.canonical(reverse)), q.rulesBindingSha256);
  } finally {
    f.dispose();
  }
});
test("QA rejects unknown duplicate missing rows and unsupported ordinary/attribution statuses", () => {
  const f = fixture();
  try {
    for (const mutate of [
      (q) => q.checks.pop(),
      (q) => q.checks.push(clone(q.checks[0])),
      (q) => (q.checks[0].id = "unknown"),
      (q) => (q.checks[1].id = q.checks[0].id),
      (q) =>
        (q.checks.find((c) => c.id === "exactly-one-download").status =
          "unsupported"),
      (q) =>
        (q.checks.find((c) => c.id === "source-tab-attribution").status =
          "unrun"),
      (q) =>
        (q.checks.find((c) => c.id === "private-disabled").status =
          "not-applicable"),
      (q) => (q.checks[0].evidence = []),
    ]) {
      const q = qa(f.expected);
      mutate(q);
      assert.throws(() => Q.validateQaRecord(q, f.expected));
    }
  } finally {
    f.dispose();
  }
});
test("QA independent identities capabilities rules and native source route cannot be self-overridden", () => {
  const f = fixture();
  try {
    for (const mutate of [
      (q) => (q.commit = "2".repeat(40)),
      (q) => (q.packageSha256 = "2".repeat(64)),
      (q) => (q.buildRunId = 1),
      (q) => (q.artifactId = "0"),
      (q) => (q.target = "firefox"),
      (q) => (q.extensionVersion = "9.0.0"),
      (q) => (q.rulesBinding.capabilities.privateCapture = true),
      (q) => q.rulesBinding.rules.pop(),
      (q) => (q.rulesBindingSha256 = "0".repeat(64)),
      (q) => (q.browser.version = "154.0.0.0"),
      (q) => (q.browser.executableSha256 = "f".repeat(64)),
      (q) => (q.sourceRoute = "source-evaluation/CDP"),
      (q) => (q.stage = "post-distribution"),
      (q) => (q.extra = true),
      (q) => (q.finishedAt = "2026-02-30T00:00:00Z"),
      (q) => (q.display.zoom = Infinity),
    ]) {
      const q = qa(f.expected);
      mutate(q);
      assert.throws(() => Q.validateQaRecord(q, f.expected));
    }
    const q = qa(f.expected);
    Object.defineProperty(q, "reviewer", {
      get() {
        throw Error("must not read accessor");
      },
      enumerable: true,
    });
    assert.throws(() => Q.validateQaRecord(q, f.expected), /Accessor/);
  } finally {
    f.dispose();
  }
});
test("false/true private preserve and authorized file capability tables enforce exact required evidence", () => {
  for (const privateCapture of [false, true])
    for (const preserveVirtualizer of [false, true])
      for (const fileAccess of [false, true]) {
        const f = fixture({
          capabilities: { privateCapture, preserveVirtualizer, fileAccess },
        });
        try {
          const q = qa(f.expected);
          Q.validateQaRecord(q, f.expected);
          const row = q.checks.find(
            (c) =>
              c.id ===
              (privateCapture ? "private-allowed" : "private-disabled"),
          );
          row.status = "unsupported";
          assert.throws(() => Q.validateQaRecord(q, f.expected));
        } finally {
          f.dispose();
        }
      }
});
test("changed resource/download paths never accept unchanged-diff exceptions; claim-only unrun needs row-specific limitation", () => {
  for (const changed of [false, true]) {
    const f = fixture({
      capabilities: {
        resourceAccountingChanged: changed,
        downloadOwnershipChanged: changed,
      },
    });
    try {
      const q = qa(f.expected);
      for (const id of [
        "q3-resource-envelope",
        "q3-late-disposal",
        "q4-armed-source-lifetime",
      ])
        q.checks.find((c) => c.id === id).status = "not-applicable";
      if (changed) assert.throws(() => Q.validateQaRecord(q, f.expected));
      else Q.validateQaRecord(q, f.expected);
    } finally {
      f.dispose();
    }
  }
  const f = fixture();
  try {
    const q = qa(f.expected);
    q.checks.find((c) => c.id === "q4-worker-loss").status = "unrun";
    q.limitations = ["generic unavailable injection"];
    assert.throws(() => Q.validateQaRecord(q, f.expected));
    q.limitations = [
      "q4-worker-loss: native injection unavailable; no worker-loss claim",
    ];
    Q.validateQaRecord(q, f.expected);
    const claimed = clone(f.expected);
    claimed.capabilities.workerLossClaim = true;
    claimed.rulesBindingSha256 = Q.bindingDigest({
      stage: "pre-submit",
      target: claimed.target,
      capabilities: claimed.capabilities,
      firstPublication: false,
    });
    assert.throws(() => Q.validateQaRecord(q, claimed));
  } finally {
    f.dispose();
  }
});
test("QA bound rejects oversized non-data and falsely pre-submit distribution/verified fields", () => {
  const f = fixture();
  try {
    const q = qa(f.expected);
    q.limitations = ["x".repeat(32769)];
    assert.throws(() => Q.validateQaRecord(q, f.expected));
    q.limitations = [];
    q.installed = { id: "expected", version: f.expected.version };
    assert.throws(() => Q.validateQaRecord(q, f.expected));
    delete q.installed;
    q.verified = true;
    assert.throws(() => Q.validateQaRecord(q, f.expected));
    assert.throws(() =>
      Q.requiredChecks({
        stage: "pre-submit",
        target: "chrome",
        capabilities: { privateCapture: false },
        firstPublication: false,
      }),
    );
  } finally {
    f.dispose();
  }
});
test("unsigned production candidate verifier accepts complete synthetic Chrome/Firefox inventory only", () => {
  for (const target of ["chrome", "firefox"]) {
    const f = fixture({ target });
    try {
      const c = V.verifyCandidate({
        ...f,
        expected: f.expected,
        expectedPackageSha256: f.expected.packageSha256,
        expectedInventorySha256: f.expected.inventorySha256,
      });
      assert.equal(c.files.size, f.files.length);
      assert.equal(c.inventory.releaseQualified, true);
    } finally {
      f.dispose();
    }
  }
});
test("candidate tampering stale inventory metadata path permission and load-order failures reject", () => {
  const bad = [
    (files) => {
      const m = files.find((f) => f.path === "manifest.json"),
        v = JSON.parse(m.bytes);
      v.permissions.push("storage");
      m.bytes = Buffer.from(JSON.stringify(v));
    },
    (files) => files.push({ path: "unlisted.js", bytes: Buffer.from("bad") }),
    (files) => files.push({ ...files[0] }),
    (files) => {
      files[0].path = "../escape";
    },
    (files) => {
      files.find((f) => f.path === "offscreen.html").bytes = Buffer.from(
        '<script src="offscreen.js"></script>',
      );
    },
  ];
  for (const modify of bad) {
    const f = fixture({ modify });
    try {
      assert.throws(() =>
        V.verifyCandidate({
          ...f,
          expectedPackageSha256: f.expected.packageSha256,
          expectedInventorySha256: f.expected.inventorySha256,
        }),
      );
    } finally {
      f.dispose();
    }
  }
  const f = fixture();
  try {
    const opts = {
      ...f,
      expectedPackageSha256: f.expected.packageSha256,
      expectedInventorySha256: f.expected.inventorySha256,
    };
    const archive = fs.readFileSync(f.packagePath);
    archive[40] ^= 1;
    fs.writeFileSync(f.packagePath, archive);
    assert.throws(() => V.verifyCandidate(opts), /tampered/);
    fs.writeFileSync(f.packagePath, f.archive);
    fs.appendFileSync(f.inventoryPath, " ");
    assert.throws(() => V.verifyCandidate(opts), /tampered/);
  } finally {
    f.dispose();
  }
});
test("documented checklist fixed IDs exactly match the shared pre-submit union", () => {
  const rules = new Set();
  for (const target of ["chrome", "firefox"])
    for (let mask = 0; mask < 128; mask++) {
      const capabilities = Object.fromEntries(
        Q.CAPABILITIES.map((k, i) => [k, Boolean(mask & (1 << i))]),
      );
      for (const rule of Q.requiredChecks({
        stage: "pre-submit",
        target,
        capabilities,
        firstPublication: false,
      }))
        rules.add(rule.id);
    }
  const doc = fs.readFileSync(
      require("node:path").join(__dirname, "packaged-browser-checklist.md"),
      "utf8",
    ),
    ids = [...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(ids, [...rules].sort());
  assert.equal(new Set(ids).size, ids.length);
});
