"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const worker = fs.existsSync(path.join(__dirname, "background.js"))
  ? path.join(__dirname, "background.js") : path.join(__dirname, "..", "service-worker.js");
const source = fs.readFileSync(worker, "utf8");
const watcher = source.match(/\/\/ owner-folder-update:begin[\s\S]*?\/\/ owner-folder-update:end/)[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const marker = version => ({ schemaVersion: 1, commit: "a".repeat(40), releaseVersion: version });
function harness({ version = "5.3.0", body = marker("5.3.1"), existing, ok = true, reloadThrows = false } = {}) {
  const calls = { fetch: [], creates: [], reload: 0, listeners: [], timers: [], clears: [] };
  const state = { body, ok, pending: null };
  const chrome = {
    runtime: { getURL: value => "chrome-extension://synthetic/" + value, getManifest: () => ({ version }),
      reload() { calls.reload++; if (reloadThrows) throw Error("synthetic reload refusal"); } },
    alarms: { get: async () => existing, create: async (...args) => calls.creates.push(args),
      onAlarm: { addListener: listener => calls.listeners.push(listener) } }
  };
  vm.runInNewContext(watcher, { chrome, AbortController, Date, setTimeout(callback) { calls.timers.push(callback); return calls.timers.length; },
    clearTimeout: value => calls.clears.push(value), async fetch(url, options) {
      calls.fetch.push({ url, options });
      if (state.pending) await state.pending;
      return { ok: state.ok, text: async () => typeof state.body === "string" ? state.body : JSON.stringify(state.body) };
    } });
  return { calls, state, alarm(name = "owner-folder-update-v1") { for (const listener of calls.listeners) listener({ name }); } };
}
test("own marker reloads newer release without reading idle state or making provider requests", async () => {
  const h = harness(); await tick();
  assert.equal(h.calls.reload, 1);
  assert.equal(h.calls.creates[0][0], "owner-folder-update-v1");
  assert.equal(h.calls.creates[0][1].periodInMinutes, 1);
  assert.match(h.calls.fetch[0].url, /^chrome-extension:\/\/synthetic\/local-update-state\.json\?check=\d+$/);
  assert.equal(h.calls.fetch[0].options.cache, "no-store");
  assert.equal(h.calls.fetch[0].options.credentials, "omit");
  h.alarm(); await tick(); assert.equal(h.calls.reload, 1);
});
test("suspended/recreated worker ensures alarm and compares loaded manifest, never a marker baseline", async () => {
  const h = harness({ ok: false, existing: { periodInMinutes: 1 } }); await tick();
  assert.equal(h.calls.creates.length, 0); assert.equal(h.calls.reload, 0);
  h.state.ok = true; h.alarm(); await tick(); assert.equal(h.calls.reload, 1);
  const recreated = harness({ version: "5.3.1", body: marker("5.3.1") }); await tick();
  assert.equal(recreated.calls.reload, 0);
});
test("malformed, partial, oversized, same, older and unknown markers do not reload", async () => {
  for (const body of ["{", "x".repeat(1025), null, [], {}, marker("5.3.0"), marker("5.2.99"), marker("5.3.00"), marker("65536"),
    marker("0.0"), { ...marker("5.3.1"), extra: true }, { ...marker("5.3.1"), schemaVersion: 2 }, { ...marker("5.3.1"), commit: "bad" }]) {
    const h = harness({ body }); await tick(); assert.equal(h.calls.reload, 0, JSON.stringify(body));
  }
});
test("version ordering compares numeric components with zero padding", async () => {
  for (const [current, next, expected] of [["1.2.9", "1.2.10", 1], ["1.2.10", "1.2.9", 0], ["1.2", "1.2.0.0", 0], ["0.3.0", "0.3.1", 1]]) {
    const h = harness({ version: current, body: marker(next) }); await tick(); assert.equal(h.calls.reload, expected);
  }
});
test("unrelated alarms are ignored and failed reload can retry", async () => {
  const h = harness({ reloadThrows: true }); await tick(); assert.equal(h.calls.reload, 1);
  h.alarm("unrelated"); await tick(); assert.equal(h.calls.reload, 1);
  h.alarm(); await tick(); assert.equal(h.calls.reload, 2);
});
test("pending marker read is bounded and overlapping alarms cannot duplicate it", async () => {
  const h = harness({ body: marker("5.3.0") }); await tick();
  h.state.body = marker("5.3.1");
  let resolve; h.state.pending = new Promise(done => { resolve = done; });
  h.alarm(); h.alarm(); await tick(); assert.equal(h.calls.fetch.length, 2);
  h.calls.timers.at(-1)(); assert.equal(h.calls.fetch.at(-1).options.signal.aborted, true);
  resolve(); await tick(); assert.equal(h.calls.reload, 0);
});
test("source integration is the actual worker and timer permission is explicitly declared", () => {
  assert.ok(source.indexOf("owner-folder-update:begin") < source.indexOf("owner-folder-update:end"));
  const manifestPath = path.join(path.dirname(worker), "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(!manifest.permissions.includes("nativeMessaging"));
});
