"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const Q = require("./qa-contract.cjs"),
  { readCapabilities } = require("./read-capabilities.cjs");
const COMMON = [
  "capture-protocol.js",
  "content.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "service-worker.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];
const MAX = 32 * 1024 * 1024;
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function checkNoLinks(file) {
  let current = path.resolve(file);
  while (true) {
    if (fs.existsSync(current))
      Q.requireThat(
        !fs.lstatSync(current).isSymbolicLink(),
        "Symlink/junction input rejected",
      );
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function ordinaryFile(file, limit) {
  checkNoLinks(file);
  const s = fs.lstatSync(file);
  Q.requireThat(
    s.isFile() && !s.isSymbolicLink() && s.size <= limit,
    "Not bounded ordinary input file",
  );
  return fs.readFileSync(file);
}
function inspectZip(bytes) {
  Q.requireThat(
    bytes.length >= 22 && bytes.length <= MAX,
    "Archive size exceeded",
  );
  const end = bytes.length - 22;
  Q.requireThat(
    bytes.readUInt32LE(end) === 0x06054b50 &&
      bytes.readUInt16LE(end + 20) === 0 &&
      bytes.readUInt16LE(end + 4) === 0 &&
      bytes.readUInt16LE(end + 6) === 0,
    "Invalid ZIP end/comment/multidisk",
  );
  const count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12),
    central = bytes.readUInt32LE(end + 16);
  Q.requireThat(
    count > 0 &&
      count <= 32 &&
      bytes.readUInt16LE(end + 8) === count &&
      central + centralSize === end,
    "Invalid ZIP64/count/central bounds",
  );
  const files = new Map();
  let cursor = central,
    total = 0,
    localEnd = 0,
    lastName = "";
  for (let index = 0; index < count; index++) {
    Q.requireThat(
      cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50,
      "Invalid central entry",
    );
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      crc = bytes.readUInt32LE(cursor + 16),
      compressed = bytes.readUInt32LE(cursor + 20),
      size = bytes.readUInt32LE(cursor + 24),
      nameLength = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32),
      attrs = bytes.readUInt32LE(cursor + 38),
      offset = bytes.readUInt32LE(cursor + 42);
    Q.requireThat(
      cursor + 46 + nameLength + extra + comment <= end &&
        flags === 0 &&
        method === 8 &&
        extra === 0 &&
        comment === 0 &&
        bytes.readUInt16LE(cursor + 34) === 0,
      "Encrypted/descriptor/extra/unsupported ZIP",
    );
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      name = nameBytes.toString("ascii");
    Q.requireThat(
      nameBytes.every((b) => b >= 32 && b <= 126) &&
        /^[A-Za-z0-9_.\/-]+$/.test(name) &&
        !name.startsWith("/") &&
        !name.split("/").some((p) => !p || p === "." || p === "..") &&
        !files.has(name),
      "Unsafe/duplicate ZIP member",
    );
    Q.requireThat(name > lastName, "Noncanonical ZIP member order");
    lastName = name;
    Q.requireThat(
      attrs >>> 16 === 0o100644 &&
        bytes.readUInt16LE(cursor + 12) === 0 &&
        bytes.readUInt16LE(cursor + 14) === 0x21 &&
        bytes.readUInt16LE(cursor + 4) >>> 8 === 3 &&
        bytes.readUInt16LE(cursor + 36) === 0,
      "Noncanonical mode/date or symlink entry",
    );
    Q.requireThat(
      size <= 16 * 1024 * 1024 &&
        (total += size) <= MAX &&
        offset === localEnd &&
        offset + 30 <= central &&
        bytes.readUInt32LE(offset) === 0x04034b50,
      "Member/local budget exceeded",
    );
    Q.requireThat(
      bytes.readUInt16LE(offset + 6) === flags &&
        bytes.readUInt16LE(offset + 8) === method &&
        bytes.readUInt16LE(offset + 10) === 0 &&
        bytes.readUInt16LE(offset + 12) === 0x21 &&
        bytes.readUInt32LE(offset + 14) === crc &&
        bytes.readUInt32LE(offset + 18) === compressed &&
        bytes.readUInt32LE(offset + 22) === size &&
        bytes.readUInt16LE(offset + 26) === nameLength &&
        bytes.readUInt16LE(offset + 28) === 0,
      "Central/local header mismatch",
    );
    const start = offset + 30 + nameLength,
      finish = start + compressed;
    Q.requireThat(
      finish <= central && bytes.subarray(offset + 30, start).equals(nameBytes),
      "Overlapping/mismatched ZIP data",
    );
    const result = zlib.inflateRawSync(bytes.subarray(start, finish), {
      info: true,
      maxOutputLength: size + 1,
    });
    Q.requireThat(
      result.buffer.length === size &&
        result.engine.bytesWritten === compressed &&
        crc32(result.buffer) === crc,
      "Member size/CRC/deflate tail mismatch",
    );
    files.set(name, {
      bytes: result.buffer,
      size,
      sha256: Q.digest(result.buffer),
      mode: "0644",
    });
    localEnd = finish;
    cursor += 46 + nameLength;
  }
  Q.requireThat(
    cursor === end && localEnd === central,
    "Unaccounted ZIP bytes",
  );
  return files;
}
function validateManifest(bytes, target, version, files) {
  const m = Q.parse(bytes, 65536);
  Q.record(m, [
    "manifest_version",
    "name",
    "version",
    "description",
    ...(target === "chrome" ? ["minimum_chrome_version"] : []),
    "permissions",
    "icons",
    "action",
    "background",
    ...(target === "firefox" ? ["browser_specific_settings"] : []),
  ]);
  Q.requireThat(
    m.manifest_version === 3 && m.version === version,
    "Wrong manifest identity",
  );
  Q.text(m.name, 160);
  Q.text(m.description, 1024);
  const allowed = [
      ...(target === "chrome" ? ["alarms"] : []),
    "activeTab",
    "contextMenus",
    "downloads",
    "scripting",
    ...(target === "chrome" ? ["offscreen"] : []),
  ];
  Q.requireThat(
    Array.isArray(m.permissions) &&
      Q.canonical([...m.permissions].sort()).equals(
        Q.canonical(allowed.sort()),
      ),
    "Unauthorized/missing permissions",
  );
  Q.record(m.icons, ["16", "32", "48", "128"]);
  for (const [key, value] of Object.entries(m.icons))
    Q.requireThat(
      value === `icons/icon${key}.png` && files.has(value),
      "Missing/foreign icon",
    );
  Q.record(m.action, ["default_title", "default_popup", "default_icon"]);
  Q.text(m.action.default_title, 160);
  Q.requireThat(
    m.action.default_popup === "popup.html" && files.has("popup.html"),
    "Foreign popup",
  );
  Q.record(m.action.default_icon, ["16", "32", "48"]);
  for (const key of ["16", "32", "48"])
    Q.requireThat(m.action.default_icon[key] === m.icons[key], "Icon mismatch");
  if (target === "chrome") {
    Q.requireThat(m.minimum_chrome_version === "116", "Changed browser floor");
    Q.record(m.background, ["service_worker"]);
    Q.requireThat(
      m.background.service_worker === "service-worker.js",
      "Worker load order",
    );
    Q.requireThat(
      /<script src="capture-protocol.js"><\/script>\s*<script src="offscreen.js"><\/script>/.test(
        files.get("offscreen.html").bytes.toString(),
      ),
      "Offscreen helper load order",
    );
  } else {
    Q.record(m.background, ["scripts"]);
    Q.requireThat(
      Q.canonical(m.background.scripts).equals(
        Q.canonical([
          "capture-protocol.js",
          "offscreen.js",
          "service-worker.js",
        ]),
      ),
      "Firefox load order",
    );
    Q.record(m.browser_specific_settings, ["gecko"]);
    const g = m.browser_specific_settings.gecko;
    Q.record(g, ["id", "strict_min_version", "data_collection_permissions"]);
    Q.requireThat(
      g.id === "capture-full-page@ohokthisisfine.github" &&
        g.strict_min_version === "126.0",
      "Firefox identity/floor mismatch",
    );
    Q.record(g.data_collection_permissions, ["required"]);
    Q.requireThat(
      Q.canonical(g.data_collection_permissions.required).equals(
        Q.canonical(["none"]),
      ),
      "Firefox data permission mismatch",
    );
  }
  Q.requireThat(
    /<script src="capture-protocol.js"><\/script>\s*<script src="popup.js"><\/script>/.test(
      files.get("popup.html").bytes.toString(),
    ),
    "Popup helper load order",
  );
  return m;
}
function verifyCandidate({
  packagePath,
  inventoryPath,
  expected,
  expectedPackageSha256,
  expectedInventorySha256,
}) {
  expected = Q.validateExpected(expected);
  Q.hash(expectedPackageSha256);
  Q.hash(expectedInventorySha256);
  Q.requireThat(
    expected.packageSha256 === expectedPackageSha256 &&
      expected.inventorySha256 === expectedInventorySha256,
    "Independent digest mismatch",
  );
  const bytes = ordinaryFile(packagePath, MAX),
    inventoryBytes = ordinaryFile(inventoryPath, 65536);
  Q.requireThat(
    Q.digest(bytes) === expectedPackageSha256 &&
      Q.digest(inventoryBytes) === expectedInventorySha256,
    "Package/inventory tampered",
  );
  const inventory = Q.parse(inventoryBytes, 65536);
  Q.record(inventory, [
    "schemaVersion",
    "repository",
    "commit",
    "version",
    "releaseQualified",
    "toolchain",
    "targets",
  ]);
  Q.requireThat(
    inventory.schemaVersion === 1 &&
      inventory.repository === expected.repository &&
      inventory.commit === expected.commit &&
      inventory.version === expected.version &&
      typeof inventory.releaseQualified === "boolean",
    "Inventory provenance mismatch",
  );
  Q.record(inventory.toolchain, [
    "schemaVersion",
    "python",
    "zlibCompile",
    "zlibRuntime",
    "node",
    "npm",
    "zipCompression",
    "zipLevel",
  ]);
  Q.requireThat(
    inventory.toolchain.schemaVersion === 1 &&
      inventory.toolchain.zipCompression === "deflate" &&
      inventory.toolchain.zipLevel === 9,
    "Unreviewed toolchain profile",
  );
  for (const k of ["python", "zlibCompile", "zlibRuntime", "node", "npm"])
    Q.version(inventory.toolchain[k]);
  if (inventory.releaseQualified) {
    for (const [k, v] of Object.entries({
      python: "3.13.16",
      zlibCompile: "1.3.2",
      zlibRuntime: "1.3.2",
      node: "22.23.3",
      npm: "10.9.9",
    }))
      Q.requireThat(
        inventory.toolchain[k] === v,
        "Release toolchain declaration mismatch",
      );
  }
  const targetKeys = Object.keys(inventory.targets);
  Q.requireThat(
    targetKeys.length > 0 &&
      targetKeys.every((k) => ["chrome", "firefox"].includes(k)) &&
      targetKeys.includes(expected.target),
    "Wrong inventory target",
  );
  Q.record(inventory.targets, targetKeys);
  const t = inventory.targets[expected.target];
  Q.record(t, [
    "manifestSha256",
    "zipFilename",
    "zipSha256",
    "zipBytes",
    "qualifiedCapabilities",
    "files",
  ]);
  Q.requireThat(
    t.zipSha256 === expectedPackageSha256 &&
      t.zipBytes === bytes.length &&
      t.zipFilename ===
        `capture-full-page-${expected.target}-${expected.version}.zip`,
    "Target archive binding mismatch",
  );
  Q.hash(t.manifestSha256);
  Q.record(t.qualifiedCapabilities, ["privateCapture", "preserveVirtualizer"]);
  const files = inspectZip(bytes),
    allowlist = [
      ...COMMON,
      "manifest.json",
      ...(expected.target === "chrome"
        ? ["offscreen.html", "offscreen.js"]
        : ["offscreen.js"]),
    ].sort();
  Q.requireThat(
    Q.canonical([...files.keys()].sort()).equals(Q.canonical(allowlist)) &&
      Array.isArray(t.files) &&
      t.files.length === allowlist.length,
    "Unexpected package member set",
  );
  const seen = new Set();
  for (const member of t.files) {
    Q.record(member, ["path", "size", "sha256", "mode"]);
    Q.requireThat(!seen.has(member.path), "Duplicate inventory member");
    seen.add(member.path);
    const actual = files.get(member.path);
    Q.requireThat(
      actual &&
        actual.size === member.size &&
        actual.sha256 === member.sha256 &&
        member.mode === "0644",
      "Inventory payload mismatch",
    );
  }
  Q.requireThat(
    files.get("manifest.json").sha256 === t.manifestSha256,
    "Manifest hash mismatch",
  );
  validateManifest(
    files.get("manifest.json").bytes,
    expected.target,
    expected.version,
    files,
  );
  return {
    expected,
    inventory,
    files,
    qualifiedCapabilities: t.qualifiedCapabilities,
  };
}
function extractVerified(candidate, destination) {
  Q.requireThat(
    !fs.existsSync(destination),
    "Extraction destination must be fresh",
  );
  fs.mkdirSync(destination);
  for (const [name, member] of candidate.files) {
    const file = path.join(destination, ...name.split("/"));
    Q.requireThat(
      file.startsWith(path.resolve(destination) + path.sep),
      "Extraction escapes destination",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, member.bytes, { flag: "wx", mode: 0o644 });
  }
  const actual = readCapabilities(destination, candidate.expected.target);
  Q.requireThat(
    Q.canonical(actual).equals(Q.canonical(candidate.qualifiedCapabilities)) &&
      actual.privateCapture ===
        candidate.expected.capabilities.privateCapture &&
      actual.preserveVirtualizer ===
        candidate.expected.capabilities.preserveVirtualizer,
    "Actual candidate capability mismatch",
  );
  return actual;
}
module.exports = {
  COMMON,
  MAX,
  crc32,
  checkNoLinks,
  ordinaryFile,
  inspectZip,
  verifyCandidate,
  extractVerified,
  validateManifest,
};
