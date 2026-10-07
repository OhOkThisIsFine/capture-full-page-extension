"use strict";
// All browser/process observations below are synthetic unit doubles, never native receipts.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  cp = require("node:child_process"),
  http = require("node:http"),
  { EventEmitter } = require("node:events");
const R = require("./packaged-browser.cjs"),
  F = require("./helpers/native-fixtures.cjs"),
  P = require("./helpers/png-oracle.cjs"),
  Q = require("../scripts/qa-contract.cjs"),
  { fixture, png } = require("./helpers/qa-fixtures.cjs");
function withFixture(fn, options) {
  const f = fixture(options);
  try {
    return fn(f);
  } finally {
    f.dispose();
  }
}
async function withBrowser(fn, options) {
  const f = fixture(options),
    oldSync = cp.spawnSync,
    oldSpawn = cp.spawn,
    oldServer = http.createServer;
  const child = new EventEmitter();
  let killed = 0,
    closed = 0,
    launch;
  child.kill = (signal) => {
    assert.equal(signal, "SIGTERM");
    killed++;
    return true;
  };
  cp.spawnSync = () => ({ status: 0, stdout: f.expected.browser.version });
  cp.spawn = (exe, args, opts) => {
    launch = { exe, args, opts };
    return child;
  };
  http.createServer = () => {
    const server = new EventEmitter();
    server.listen = (port, host, done) => {
      assert.equal(port, 0);
      assert.equal(host, "127.0.0.1");
      done();
    };
    server.address = () => ({ port: 45678 });
    server.close = () => {
      closed++;
    };
    return server;
  };
  try {
    const session = R.prepareRun(f.options());
    await R.launchBrowser(session, f.fakeExe);
    return await fn({
      f,
      session,
      child,
      get launch() {
        return launch;
      },
      get killed() {
        return killed;
      },
      get closed() {
        return closed;
      },
    });
  } finally {
    cp.spawnSync = oldSync;
    cp.spawn = oldSpawn;
    http.createServer = oldServer;
    f.dispose();
  }
}
test("owned preparation records only blocked unrun state and never an installed observation", () =>
  withFixture((f) => {
    const s = R.prepareRun(f.options());
    const report = JSON.parse(fs.readFileSync(f.options().reportPath));
    assert.equal(report.qualification, "blocked");
    assert.equal(report.installedObservation, null);
    assert.equal(report.browserObservation, null);
    assert.ok(report.checks.every((c) => c.status === "unrun"));
    assert.ok(fs.existsSync(s.profile));
    assert.ok(fs.existsSync(s.downloads));
    assert.throws(() => R.completeRun(s, Buffer.from("{}")));
    R.checkpointAndClose(s, "synthetic cancelled");
    assert.ok(fs.existsSync(s.profile));
  }));
test("actual capability mismatch blocks before profile creation; matching candidate capabilities are read from payload", () => {
  withFixture(
    (f) => {
      assert.throws(
        () => R.prepareRun(f.options()),
        /Actual candidate capability mismatch/,
      );
      assert.equal(
        fs.existsSync(path.join(f.options().evidenceDir, "profile")),
        false,
      );
    },
    {
      actualCapabilities: { privateCapture: true, preserveVirtualizer: false },
    },
  );
  withFixture(
    (f) => {
      const s = R.prepareRun(f.options());
      assert.ok(fs.existsSync(s.profile));
    },
    {
      actualCapabilities: { privateCapture: true, preserveVirtualizer: true },
      capabilities: { privateCapture: true, preserveVirtualizer: true },
    },
  );
});
test("fresh ownership rejects reuse escaped reports symlinks and unsupported distribution stage", () =>
  withFixture((f) => {
    R.prepareRun(f.options());
    assert.throws(() => R.prepareRun(f.options()), /fresh/);
    const escaped = f.options("escape");
    escaped.reportPath = path.join(f.dir, "outside.json");
    assert.throws(() => R.prepareRun(escaped), /owned root/);
    assert.throws(
      () => R.prepareRun({ ...f.options("post"), stage: "post-distribution" }),
      /pre-submit only/,
    );
    assert.throws(
      () => R.prepareRun({ ...f.options("signed"), signedPackage: true }),
      /signed inputs/,
    );
    const link = path.join(f.dir, "junction");
    fs.symlinkSync(f.dir, link, "junction");
    assert.throws(
      () =>
        R.prepareRun({
          ...f.options("link"),
          evidenceDir: path.join(link, "run"),
        }),
      /Symlink\/junction/,
    );
    fs.unlinkSync(link);
  }));
test("strict CLI rejects missing unknown duplicate and privileged launch flags", () => {
  for (const args of [
    [],
    ["--headless"],
    ["--load-extension", "x"],
    ["--target", "chrome", "--target", "firefox"],
    ["--launch", "--launch"],
    ["--stage"],
  ])
    assert.throws(() => R.parseArgs(args));
  assert.throws(() => R.completeRun({}, Buffer.from("{}")), /Unowned/);
});
test("independent PNG decoder rejects CRC truncation appended zlib streams and arbitrary compressed tail", () => {
  const good = png();
  assert.deepEqual(P.decodePng(good).pixel(0, 0), [30, 40, 50, 255]);
  for (const bad of [
    good.subarray(0, good.length - 12),
    Buffer.concat([good, Buffer.from("tail")]),
    png(2, 2, { trailing: zlib.deflateSync(Buffer.alloc(0)) }),
    png(2, 2, { trailing: Buffer.from("arbitrary") }),
  ])
    assert.throws(() => P.decodePng(bad));
  const crc = Buffer.from(good);
  crc[45] ^= 1;
  assert.throws(() => P.decodePng(crc), /CRC/);
  assert.throws(() => P.decodePng(png(0, 2)));
});
test("native download polling requires stable observations ignores partial files and rejects corruption", () =>
  withFixture((f) => {
    const s = R.prepareRun(f.options()),
      file = path.join(s.downloads, "synthetic.png");
    fs.writeFileSync(file, png());
    fs.writeFileSync(path.join(s.downloads, "pending.crdownload"), "partial");
    assert.equal(R.pollDownloads(s, 1000).length, 0);
    assert.equal(R.pollDownloads(s, 1100).length, 0);
    assert.equal(R.pollDownloads(s, 1250).length, 1);
    assert.throws(() => R.pollDownloads(s, 1200), /backward/);
    fs.writeFileSync(file, png(2, 2, { trailing: Buffer.from("tail") }));
    R.pollDownloads(s, 1500);
    assert.throws(() => R.pollDownloads(s, 1750), /trailing/);
  }));
test("coordinate and all four virtual fixture oracles detect wrong identity and far edges", () => {
  for (const f of F.fixtures({ preserveVirtualizer: true }).filter(
    (f) => f.result === "success",
  )) {
    let calls = 0;
    const image = {
      width: f.width,
      height: f.height,
      pixel(x, y) {
        calls++;
        if (f.kind === "virtual") {
          const row = Math.floor(y / 40);
          return x === 10
            ? [30, 210, 120, 255]
            : x === 890
              ? [230, 40, 90, 255]
              : [(row * 17) % 251, (row * 29) % 251, (row * 43) % 251, 255];
        }
        return F.color(
          Math.floor((x - f.offsetX) / 128),
          Math.floor((y - f.offsetY) / 128),
        );
      },
    };
    assert.ok(F.verifyPixels(image, f).markerSamples > 0);
    assert.ok(calls > 0);
    const bad = {
      ...image,
      pixel(x, y) {
        return f.kind === "virtual" && x !== 890
          ? image.pixel(x, y)
          : [0, 0, 0, 255];
      },
    };
    assert.throws(() => F.verifyPixels(bad, f), /mismatch/);
  }
});
test("fixture HTTP handler serves only explicit local allowlist without sockets or arbitrary filesystem access", () => {
  const map = F.routes(F.fixtures());
  for (const [url, method, remote, host, expected] of [
    ["/", "GET", "127.0.0.1", "127.0.0.1:1234", 200],
    ["/", "HEAD", "127.0.0.1", "localhost:1234", 200],
    ["/../package.json", "GET", "127.0.0.1", "127.0.0.1:1234", 404],
    ["/?x=1", "GET", "127.0.0.1", "127.0.0.1:1234", 404],
    ["/", "POST", "127.0.0.1", "127.0.0.1:1234", 404],
    ["/", "GET", "192.0.2.1", "127.0.0.1:1234", 404],
    ["/", "GET", "127.0.0.1", "example.com:1234", 404],
  ]) {
    let status;
    F.handleRequest(
      map,
      { url, method, socket: { remoteAddress: remote }, headers: { host } },
      {
        writeHead(s) {
          status = s;
        },
        end() {},
      },
    );
    assert.equal(status, expected);
  }
});
test("exact browser hash and version failures precede GUI launch", () =>
  withFixture((f) => {
    assert.throws(
      () =>
        R.inspectBrowser(f.fakeExe, f.target, {
          ...f.expected.browser,
          executableSha256: "0".repeat(64),
        }),
      /digest mismatch/,
    );
    const old = cp.spawnSync;
    cp.spawnSync = () => ({ status: 0, stdout: "154.0.0.0" });
    try {
      assert.throws(
        () => R.inspectBrowser(f.fakeExe, f.target, f.expected.browser),
        /version mismatch/,
      );
    } finally {
      cp.spawnSync = old;
    }
  }));
test("GUI launcher uses only fresh owned profile arguments and closes only its child while retaining evidence", async () => {
  for (const target of ["chrome", "firefox"])
    await withBrowser(
      async (t) => {
        assert.equal(t.launch.exe, t.f.fakeExe);
        assert.deepEqual(
          t.launch.args,
          target === "chrome"
            ? [
                `--user-data-dir=${t.session.profile}`,
                "--no-first-run",
                "--no-default-browser-check",
                "http://127.0.0.1:45678/",
              ]
            : [
                "--no-remote",
                "--profile",
                t.session.profile,
                "http://127.0.0.1:45678/",
              ],
        );
        assert.equal(t.launch.opts.windowsHide, false);
        assert.equal(t.launch.opts.env.GITHUB_TOKEN, undefined);
        R.checkpointAndClose(t.session, "synthetic cancellation");
        assert.equal(t.killed, 1);
        assert.equal(t.closed, 1);
        assert.ok(fs.existsSync(t.session.profile));
        assert.equal(
          JSON.parse(fs.readFileSync(t.f.options().reportPath)).qualification,
          "blocked",
        );
      },
      { target },
    );
});
test("attempt deadline cannot renew and metadata filenames alone cannot qualify UI cleanup or output", async () =>
  withBrowser(async (t) => {
    const evidence = "evidence/synthetic-observation.txt";
    fs.writeFileSync(
      path.join(t.session.evidenceDir, evidence),
      "Synthetic unit observation, not native evidence.",
    );
    const start = new Date().toISOString();
    const intent = {
      schemaVersion: 1,
      runId: t.session.runId,
      sequence: 1,
      fixtureId: "coordinate-grid",
      gesture: "toolbar",
      startedAt: start,
      state: "running",
      result: null,
      evidence: [],
    };
    const serialize = () => Buffer.from(JSON.stringify(intent));
    R.observeAttempt(t.session, serialize(), 0);
    assert.throws(
      () =>
        R.observeAttempt(
          t.session,
          serialize(),
          R.ATTEMPT_MS + R.FINAL_OBSERVATION_MS + 1,
        ),
      /timeout/,
    );
    assert.throws(
      () =>
        R.observeAttempt(
          t.session,
          Buffer.from(JSON.stringify({ ...intent, sequence: 2 })),
          1,
        ),
      /overlaps/,
    );
    intent.state = "finished";
    intent.result = "success";
    intent.evidence = [evidence];
    assert.equal(
      R.observeAttempt(t.session, serialize(), 100).completed,
      false,
    );
    assert.throws(
      () =>
        R.observeAttempt(
          t.session,
          serialize(),
          100 + R.FINAL_OBSERVATION_MS + R.POLL_MS + 1,
        ),
      /observation timeout/,
    );
    const raw = {
      schemaVersion: 1,
      runId: t.session.runId,
      packageSha256: t.f.expected.packageSha256,
      browser: t.f.expected.browser,
      extension: {
        id: "a".repeat(32),
        version: t.f.expected.version,
        sourceRoute: "native-extension-detail",
        evidence: [evidence],
      },
      downloadsPreference: {
        askWhereToSave: false,
        sourceRoute: "native-preferences-observation",
        evidence: [evidence],
      },
      display: { scale: 1, dpr: 1, zoom: 1 },
      cleanup: {
        browserClosed: true,
        sourceRoute: "native-owned-window-closed",
        evidence: [evidence],
      },
      checks: [],
      attempts: [],
      reviewer: "synthetic unit",
      limitations: [],
    };
    assert.throws(
      () => R.validateReviewer(t.session, Buffer.from(JSON.stringify(raw))),
      /cleanup/,
    );
    t.child.emit("exit", 0, null);
    assert.throws(() =>
      R.validateReviewer(t.session, Buffer.from(JSON.stringify(raw))),
    );
    assert.throws(
      () => R.evidenceRefs(t.session.evidenceDir, ["../outside"]),
      /Unsafe/,
    );
    R.checkpointAndClose(t.session, "synthetic finished");
    assert.equal(t.killed, 0);
  }));
test("development candidate cannot enter release QA even with matching browser metadata", () =>
  withFixture(
    (f) => {
      const s = R.prepareRun(f.options());
      return assert.rejects(
        R.launchBrowser(s, f.fakeExe),
        /Development artifact/,
      );
    },
    { releaseQualified: false },
  ));

test("native final observation waits fifteen seconds and rejects duplicate or stale filename evidence", async () =>
  withBrowser(async (t) => {
    const evidence = "evidence/synthetic-observation.txt";
    fs.writeFileSync(
      path.join(t.session.evidenceDir, evidence),
      "Synthetic unit fixture only.",
    );
    const startedAt = new Date().toISOString(),
      base = {
        schemaVersion: 1,
        runId: t.session.runId,
        sequence: 1,
        fixtureId: "coordinate-grid",
        gesture: "cancel",
        startedAt,
        state: "finished",
        result: "pre-initiation-failure",
        evidence: [evidence],
      },
      raw = () => Buffer.from(JSON.stringify(base));
    assert.equal(R.observeAttempt(t.session, raw(), 0).completed, false);
    assert.equal(
      R.observeAttempt(t.session, raw(), R.FINAL_OBSERVATION_MS - 1).completed,
      false,
    );
    assert.equal(
      R.observeAttempt(t.session, raw(), R.FINAL_OBSERVATION_MS).completed,
      true,
    );
    assert.equal(
      R.observeAttempt(t.session, raw(), R.FINAL_OBSERVATION_MS + 100000)
        .completed,
      true,
    );
    assert.throws(
      () =>
        R.observeAttempt(
          t.session,
          Buffer.from(JSON.stringify({ ...base, result: "success" })),
          R.FINAL_OBSERVATION_MS + 1,
        ),
      /changed/,
    );
    R.checkpointAndClose(t.session, "synthetic cancellation");
  }));
test("duplicate stable native output rejects independent of purported manual success", async () =>
  withBrowser(async (t) => {
    const evidence = "evidence/synthetic-observation.txt";
    fs.writeFileSync(
      path.join(t.session.evidenceDir, evidence),
      "Synthetic unit fixture only.",
    );
    const startedAt = new Date().toISOString(),
      name = "2026-10-07_00-00-00_127.0.0.1_CFP QA coordinate-grid";
    for (const suffix of ["", " (1)"])
      fs.writeFileSync(
        path.join(t.session.downloads, name + suffix + ".png"),
        png(),
      );
    const now = Date.now();
    R.pollDownloads(t.session, now);
    R.pollDownloads(t.session, now + R.POLL_MS);
    const a = {
      schemaVersion: 1,
      runId: t.session.runId,
      sequence: 1,
      fixtureId: "coordinate-grid",
      gesture: "toolbar",
      startedAt,
      state: "finished",
      result: "success",
      evidence: [evidence],
    };
    assert.throws(
      () => R.observeAttempt(t.session, Buffer.from(JSON.stringify(a)), 0),
      /Duplicate/,
    );
    const f = F.fixtures().find((f) => f.id === "coordinate-grid");
    assert.ok(F.filenamePattern(f).test(name + " (1).png"));
    assert.ok(!F.filenamePattern(f).test(name + "-evil.png"));
    R.checkpointAndClose(t.session, "synthetic duplicate rejection");
  }));
