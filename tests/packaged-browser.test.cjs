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
    assert.equal(
      R.observeAttempt(
        t.session,
        serialize(),
        100 + R.FINAL_OBSERVATION_MS + 5000,
      ).completed,
      false,
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
      R.observeAttempt(t.session, raw(), R.FINAL_OBSERVATION_MS + 5000)
        .completed,
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
test("synthetic complete run binds exact report bytes and decoded PNGs after every mandatory gate", async () =>
  withBrowser(async (t) => {
    const { qa } = require("./helpers/qa-fixtures.cjs"),
      evidence = "evidence/synthetic-observation.txt";
    fs.writeFileSync(
      path.join(t.session.evidenceDir, evidence),
      "Synthetic unit fixture only: no actual browser, gesture or qualification.",
    );
    const timestamp = new Date().toISOString(),
      wall = Date.now(),
      attempts = [];
    let sequence = 0;
    for (const f of F.fixtures().filter((f) => f.result === "success")) {
      sequence++;
      const gesture =
        f.id === "iframe-padding"
          ? "context-menu-iframe"
          : sequence === 2
            ? "context-menu-top"
            : "toolbar";
      const name = `2026-10-07_00-00-00_127.0.0.1_CFP QA ${f.id}.png`,
        ratio = f.id.startsWith("tile-boundary-") ? 1 : 0.125,
        width = f.width * ratio,
        height = Math.floor(f.height * ratio);
      const image = png(width, height, {
        pixel(x, y) {
          const gx = x / ratio - f.offsetX,
            gy = y / ratio - f.offsetY;
          return gx >= 0 && gy >= 0 && gx < f.gridWidth && gy < f.gridHeight
            ? F.color(Math.floor(gx / 128), Math.floor(gy / 128))
            : [255, 255, 255, 255];
        },
      });
      fs.writeFileSync(path.join(t.session.downloads, name), image);
      R.pollDownloads(t.session, wall + (sequence - 1) * 500);
      R.pollDownloads(t.session, wall + (sequence - 1) * 500 + 250);
      const intent = {
          schemaVersion: 1,
          runId: t.session.runId,
          sequence,
          fixtureId: f.id,
          gesture,
          startedAt: timestamp,
          state: "finished",
          result: "success",
          evidence: [evidence],
        },
        serialize = () => Buffer.from(JSON.stringify(intent)),
        clock = sequence * 20000;
      assert.equal(
        R.observeAttempt(t.session, serialize(), clock).completed,
        false,
      );
      assert.equal(
        R.observeAttempt(t.session, serialize(), clock + R.FINAL_OBSERVATION_MS)
          .completed,
        true,
      );
      attempts.push({
        fixtureId: f.id,
        gesture,
        startedAt: timestamp,
        finishedAt: timestamp,
        result: "success",
        evidence: [evidence],
      });
    }
    sequence++;
    const cancel = {
        schemaVersion: 1,
        runId: t.session.runId,
        sequence,
        fixtureId: "preserve-required",
        gesture: "cancel",
        startedAt: timestamp,
        state: "finished",
        result: "pre-initiation-failure",
        evidence: [evidence],
      },
      raw = Buffer.from(JSON.stringify(cancel));
    R.observeAttempt(t.session, raw, sequence * 20000);
    assert.equal(
      R.observeAttempt(
        t.session,
        raw,
        sequence * 20000 + R.FINAL_OBSERVATION_MS,
      ).completed,
      true,
    );
    attempts.push({
      fixtureId: cancel.fixtureId,
      gesture: "cancel",
      startedAt: timestamp,
      finishedAt: timestamp,
      result: cancel.result,
      evidence: [evidence],
    });
    const reviewer = {
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
        askWhereToSave: true,
        sourceRoute: "native-preferences-observation",
        evidence: [evidence],
      },
      display: { scale: 1, dpr: 0.125, zoom: 1 },
      cleanup: {
        browserClosed: true,
        sourceRoute: "native-owned-window-closed",
        evidence: [evidence],
      },
      checks: qa(t.f.expected).checks.map((c) => ({
        ...c,
        evidence: [evidence],
      })),
      attempts,
      reviewer: "Synthetic unit fixture; not a native qualification reviewer",
      limitations: [],
    };
    t.child.emit("exit", 0, null);
    assert.throws(
      () => R.completeRun(t.session, Buffer.from(JSON.stringify(reviewer))),
      /ENOENT/,
    );
    fs.writeFileSync(
      path.join(
        t.session.evidenceDir,
        "evidence/nested-static-shell-geometry.json",
      ),
      JSON.stringify({
        runId: t.session.runId,
        sourceRoute: "native-page-geometry-observation",
        viewport: { width: 2048, height: 320 },
        before: { width: 2048, height: 320 },
        expanded: { width: 2048, height: 1088 },
        restored: { width: 2048, height: 320 },
        evidence: [evidence],
      }),
    );
    const geometryPath = path.join(
        t.session.evidenceDir,
        "evidence/nested-static-shell-geometry.json",
      ),
      validGeometry = fs.readFileSync(geometryPath),
      wrongSetup = JSON.parse(validGeometry);
    wrongSetup.viewport.width = 1024;
    fs.writeFileSync(geometryPath, JSON.stringify(wrongSetup));
    assert.throws(
      () => R.completeRun(t.session, Buffer.from(JSON.stringify(reviewer))),
      /CSS viewport/,
    );
    fs.writeFileSync(geometryPath, validGeometry);
    const validated = R.completeRun(
      t.session,
      Buffer.from(JSON.stringify(reviewer)),
    );
    assert.equal(Q.isValidatedQa(validated), true);
    assert.equal(validated.repository, "synthetic/qa-fixture");
    const bytes = fs.readFileSync(t.f.options().reportPath),
      oracles = JSON.parse(
        fs.readFileSync(
          path.join(t.session.evidenceDir, "native-oracles.json"),
        ),
      );
    assert.equal(
      oracles.nestedGeometryObservation.sha256,
      Q.digest(
        fs.readFileSync(
          path.join(
            t.session.evidenceDir,
            "evidence/nested-static-shell-geometry.json",
          ),
        ),
      ),
    );
    assert.deepEqual(oracles.nestedGeometryObservation.viewport, {
      width: 2048,
      height: 320,
    });
    assert.deepEqual(oracles.nestedGeometryObservation.expanded, {
      width: 2048,
      height: 1088,
    });
    assert.equal(oracles.qaSha256, Q.digest(bytes));
    assert.deepEqual(bytes, Q.canonical(validated));
    assert.equal(oracles.downloads.length, 7);
    assert.ok(oracles.downloads.every((f) => f.oracle.passed));
    assert.ok(fs.existsSync(t.session.profile));
    assert.equal(t.killed, 0);
  }));
test("named tile cases reject reduced scale and corrupt seam rows on both sides of each actual boundary", () => {
  for (const id of ["tile-boundary-8192", "tile-boundary-adaptive"]) {
    const f = F.fixtures().find((f) => f.id === id),
      seam = id.endsWith("8192") ? 8192 : 2048,
      good = {
        width: f.width,
        height: f.height,
        pixel(x, y) {
          return F.color(Math.floor(x / 128), Math.floor(y / 128));
        },
      };
    assert.equal(F.verifyPixels(good, f).seamSamples, 3 * f.width);
    assert.throws(
      () =>
        F.verifyPixels(
          { ...good, width: f.width / 8, height: f.height / 8 },
          f,
        ),
      /exact production boundary/,
    );
    for (const row of [seam - 1, seam, seam + 1])
      for (const x of [0, 127, 128, f.width - 1])
        assert.throws(
          () =>
            F.verifyPixels(
              {
                ...good,
                pixel(px, py) {
                  return px === x && py === row
                    ? [0, 0, 0, 255]
                    : good.pixel(px, py);
                },
              },
              f,
            ),
          /seam/,
        );
  }
});
test("Linux GUI environment accepts verified local session bindings and rejects remote unsafe or foreign bindings", () => {
  const uid = 1000,
    make = (kind, owner = uid, mode = 0o700) => ({
      uid: owner,
      mode,
      size: 100,
      isSymbolicLink: () => false,
      isDirectory: () => kind === "directory",
      isSocket: () => kind === "socket",
      isFile: () => kind === "file",
    }),
    files = {
      "/run/user/1000": make("directory"),
      "/run/user/1000/wayland-0": make("socket"),
      "/tmp/.X11-unix/X0": make("socket", 0),
      "/run/user/1000/Xauthority": make("file", uid, 0o600),
    },
    stat = (p) => {
      assert.ok(files[p], p);
      return files[p];
    },
    source = {
      DISPLAY: ":0",
      XAUTHORITY: "/run/user/1000/Xauthority",
      XDG_RUNTIME_DIR: "/run/user/1000",
      WAYLAND_DISPLAY: "wayland-0",
      GITHUB_TOKEN: "synthetic-secret",
      DBUS_SESSION_BUS_ADDRESS: "not inherited",
    };
  assert.deepEqual(R.verifiedDisplayEnvironment(source, { uid, stat }), {
    DISPLAY: ":0",
    XAUTHORITY: source.XAUTHORITY,
    XDG_RUNTIME_DIR: source.XDG_RUNTIME_DIR,
    WAYLAND_DISPLAY: "wayland-0",
  });
  for (const patch of [
    { DISPLAY: "example.com:0" },
    { WAYLAND_DISPLAY: "../socket" },
    { DISPLAY: "", XAUTHORITY: source.XAUTHORITY },
  ])
    assert.throws(() =>
      R.verifiedDisplayEnvironment({ ...source, ...patch }, { uid, stat }),
    );
  files["/run/user/1000"].mode = 0o777;
  assert.throws(
    () => R.verifiedDisplayEnvironment(source, { uid, stat }),
    /runtime/,
  );
  files["/run/user/1000"].mode = 0o700;
  files[source.XAUTHORITY].uid = 2000;
  assert.throws(
    () => R.verifiedDisplayEnvironment(source, { uid, stat }),
    /authority/,
  );
});
test("nested fixture begins at natural shell height and grows after static expansion without a preset final document height", () => {
  const f = F.fixtures().find((f) => f.id === "nested-static-shell");
  assert.deepEqual(f.initialGeometry, { width: 2048, height: 320 });
  assert.deepEqual(f.expandedGeometry, { width: 2048, height: 1088 });
  assert.ok(f.html.includes("html,body{width:2048px}"));
  assert.ok(f.html.includes("height:256px;width:2048px;overflow:auto"));
  assert.ok(!f.html.includes("html,body{width:2048px;height:1088px}"));
});
test("CRC-valid actual PNG seam and edge corruptions preserve all former cell-center samples but fail the tile oracle", () => {
  for (const id of ["tile-boundary-8192", "tile-boundary-adaptive"]) {
    const f = F.fixtures().find((f) => f.id === id),
      seam = id.endsWith("8192") ? 8192 : 2048;
    for (const kind of ["row", "edge"]) {
      const image = P.decodePng(
        png(f.width, f.height, {
          pixel(x, y) {
            return (
              kind === "row" ? y === seam : x === f.width - 1 && y === seam - 1
            )
              ? [0, 0, 0, 255]
              : F.color(Math.floor(x / 128), Math.floor(y / 128));
          },
        }),
      );
      for (let y = 0; y < f.height; y += 128)
        for (let x = 0; x < f.width; x += 128) {
          const py = Math.floor(y + Math.min(64, (f.height - y) / 2));
          assert.deepEqual(
            image.pixel(x + 64, py),
            F.color(x / 128, Math.floor(y / 128)),
          );
        }
      assert.throws(() => F.verifyPixels(image, f), /seam/);
    }
  }
});
test("nested measured setup rejects narrower wider tall missing or unmeasured CSS viewport before native acceptance", () => {
  const f = F.fixtures().find((f) => f.id === "nested-static-shell");
  assert.deepEqual(f.viewportConstraints, { width: 2048, maxHeight: 320 });
  for (const height of [1, 256, 320])
    assert.deepEqual(F.verifyViewportSetup(f, { width: 2048, height }), {
      width: 2048,
      height,
    });
  for (const setup of [
    { width: 1024, height: 256 },
    { width: 2043, height: 256 },
    { width: 2047, height: 256 },
    { width: 2049, height: 256 },
    { width: 4096, height: 256 },
    { width: 2048, height: 321 },
    { width: 2048, height: 0 },
    { width: 2048, height: 256.5 },
    { width: "2048", height: 256 },
    { height: 256 },
    { width: 2048, height: 256, source: "expected" },
    null,
  ])
    assert.throws(() => F.verifyViewportSetup(f, setup));
});
