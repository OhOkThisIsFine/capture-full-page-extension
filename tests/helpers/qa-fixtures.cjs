"use strict";
// Synthetic schema/package fixtures only. These are not native or CI approval receipts.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  zlib = require("node:zlib"),
  Q = require("../../scripts/qa-contract.cjs"),
  V = require("../../scripts/verify-qa-candidate.cjs");
const ROOT = path.resolve(__dirname, "../..");
const TOOLCHAIN = {
  schemaVersion: 1,
  python: "3.13.16",
  zlibCompile: "1.3.2",
  zlibRuntime: "1.3.2",
  node: "22.23.3",
  npm: "10.9.9",
  zipCompression: "deflate",
  zipLevel: 9,
};
const defaults = {
  privateCapture: false,
  preserveVirtualizer: false,
  fileAccess: false,
  resourceAccountingChanged: true,
  downloadOwnershipChanged: true,
  workerLossClaim: false,
  resumeClaim: false,
};
function checksum(bytes) {
  let state = 0xffffffff;
  for (const value of bytes) {
    state ^= value;
    for (let i = 0; i < 8; i++)
      state = state & 1 ? (state >>> 1) ^ 0xedb88320 : state >>> 1;
  }
  return (state ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path),
      data = entry.bytes,
      compressed = zlib.deflateRawSync(data, { level: 9 }),
      crc = checksum(data),
      local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(3 * 256 + 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
function qa(expected) {
  const selector = {
    stage: "pre-submit",
    target: expected.target,
    capabilities: expected.capabilities,
    firstPublication: expected.firstPublication,
  };
  return {
    schemaVersion: 1,
    repository: expected.repository,
    commit: expected.commit,
    target: expected.target,
    extensionVersion: expected.version,
    manifestFormatVersion: 3,
    packageSha256: expected.packageSha256,
    inventorySha256: expected.inventorySha256,
    buildRunId: expected.buildRunId,
    artifactId: expected.artifactId,
    stage: "pre-submit",
    rulesBinding: Q.binding(selector),
    rulesBindingSha256: expected.rulesBindingSha256,
    browser: { ...expected.browser },
    os: { name: "synthetic-os", version: "1.0", arch: "synthetic" },
    display: { scale: 1, dpr: 1, zoom: 1 },
    sourceRoute: "packaged-extension/real-captureVisibleTab",
    checks: Q.requiredChecks(selector).map((r) => ({
      id: r.id,
      status: r.allowedStatuses[0],
      evidence: ["synthetic evidence: " + r.id],
    })),
    startedAt: "2026-10-07T00:00:00.000Z",
    finishedAt: "2026-10-07T00:00:01.000Z",
    reviewer: "Synthetic unit fixture, not native reviewer",
    limitations: [],
  };
}
function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-native-qa-test-")),
    target = options.target || "chrome",
    caps = { ...defaults, ...options.capabilities };
  const files = [
    ...V.COMMON,
    "manifest.json",
    ...(target === "chrome"
      ? ["offscreen.html", "offscreen.js"]
      : ["offscreen.js"]),
  ]
    .sort()
    .map((name) => ({
      path: name,
      bytes: fs.readFileSync(
        path.join(
          ROOT,
          name === "manifest.json" && target === "firefox"
            ? "manifest.firefox.json"
            : name,
        ),
      ),
    }));
  const version = JSON.parse(files.find((f) => f.path === "manifest.json").bytes).version;
  const source = files.find((f) => f.path === "capture-protocol.js");
  if (options.actualCapabilities) {
    const re = new RegExp(
      `(${target}: Object.freeze\\(\\{[\\s\\S]*?privateCapture: )false`,
    );
    source.bytes = Buffer.from(
      source.bytes
        .toString()
        .replace(
          re,
          (_, head) => head + String(options.actualCapabilities.privateCapture),
        ),
    );
    const rp = new RegExp(
      `(${target}: Object.freeze\\(\\{[\\s\\S]*?preserveVirtualizer: )false`,
    );
    source.bytes = Buffer.from(
      source.bytes
        .toString()
        .replace(
          rp,
          (_, head) =>
            head + String(options.actualCapabilities.preserveVirtualizer),
        ),
    );
  }
  if (options.modify) options.modify(files);
  const archive = zip(files),
    packagePath = path.join(dir, `capture-full-page-${target}-${version}.zip`);
  fs.writeFileSync(packagePath, archive);
  const manifest = files.find((f) => f.path === "manifest.json");
  const inventory = {
    schemaVersion: 1,
    repository: "synthetic/qa-fixture",
    commit: "1".repeat(40),
    version,
    releaseQualified: options.releaseQualified ?? true,
    toolchain: { ...TOOLCHAIN },
    targets: {
      [target]: {
        manifestSha256: Q.digest(manifest.bytes),
        zipFilename: path.basename(packagePath),
        zipSha256: Q.digest(archive),
        zipBytes: archive.length,
        qualifiedCapabilities: options.inventoryCapabilities || {
          privateCapture: caps.privateCapture,
          preserveVirtualizer: caps.preserveVirtualizer,
        },
        files: files.map((f) => ({
          path: f.path,
          size: f.bytes.length,
          sha256: Q.digest(f.bytes),
          mode: "0644",
        })),
      },
    },
  };
  const inventoryPath = path.join(dir, "build-manifest.json");
  fs.writeFileSync(inventoryPath, Q.canonical(inventory));
  const fakeExe = path.join(dir, "synthetic-browser-not-executable.txt");
  fs.writeFileSync(fakeExe, "Synthetic metadata fixture; never execute.");
  const expected = {
    repository: inventory.repository,
    commit: inventory.commit,
    target,
    version: inventory.version,
    packageSha256: Q.digest(archive),
    inventorySha256: Q.digest(fs.readFileSync(inventoryPath)),
    buildRunId: "1",
    artifactId: "2",
    capabilities: caps,
    firstPublication: false,
    rulesBindingSha256: Q.bindingDigest({
      stage: "pre-submit",
      target,
      capabilities: caps,
      firstPublication: false,
    }),
    browser: {
      name: target === "chrome" ? "Chrome" : "Firefox",
      version: target === "chrome" ? "155.0.8059.39" : "157.0.1",
      channel: "synthetic-unit-fixture",
      executableSha256: Q.digest(fs.readFileSync(fakeExe)),
    },
  };
  const expectedPath = path.join(dir, "trusted-review-fixture.json");
  fs.writeFileSync(expectedPath, Q.canonical(expected));
  return {
    dir,
    target,
    caps,
    files,
    archive,
    packagePath,
    inventoryPath,
    inventory,
    expected,
    expectedPath,
    fakeExe,
    options(rootName = "qa-run") {
      const root = path.join(dir, rootName);
      return {
        stage: "pre-submit",
        target,
        expected,
        packagePath,
        inventoryPath,
        evidenceDir: root,
        reportPath: path.join(root, "qa.json"),
        expectedPackageSha256: expected.packageSha256,
        expectedInventorySha256: expected.inventorySha256,
        expectedBrowserVersion: expected.browser.version,
      };
    },
    dispose() {
      const absolute = path.resolve(dir);
      if (
        !absolute.startsWith(
          path.resolve(os.tmpdir()) + path.sep + "cfp-native-qa-test-",
        )
      )
        throw Error("Unsafe fixture cleanup");
      fs.rmSync(absolute, { recursive: true, force: true });
    },
  };
}
function png(width = 2, height = 2, opts = {}) {
  const bytes = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color = opts.pixel ? opts.pixel(x, y) : [30, 40, 50, 255];
      Buffer.from(color).copy(bytes, y * (width * 4 + 1) + 1 + x * 4);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const compressed = Buffer.concat([
    zlib.deflateSync(bytes),
    opts.trailing || Buffer.alloc(0),
  ]);
  const chunk = (type, data) => {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    data.copy(b, 8);
    b.writeUInt32BE(checksum(b.subarray(4, b.length - 4)), b.length - 4);
    return b;
  };
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
module.exports = { fixture, qa, png, zip, checksum, defaults, TOOLCHAIN };
