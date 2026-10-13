"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const capture = true;
const root = capture ? path.join(__dirname, "..") : __dirname;
const worker = capture ? "service-worker.js" : "background.js";
const source = fs.readFileSync(path.join(root, worker), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const tick = () => new Promise(resolve => setImmediate(resolve));
function event(onAdd = () => {}) {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { onAdd(); listeners.push(listener); },
    async emit(...args) { await Promise.all(listeners.map(listener => listener(...args))); }
  };
}
function harness({ existing, alarms = true } = {}) {
  const calls = { alarmGet: [], alarmCreate: [], alarmListeners: 0, urls: [], manifests: 0,
    reload: 0, fetch: [], abortControllers: 0, timers: [], clears: [], menus: [] };
  const onAlarm = event(() => { calls.alarmListeners++; });
  const nextVersion = capture ? "5.3.2" : "0.3.2";
  const marker = { schemaVersion: 1, commit: "a".repeat(40), releaseVersion: nextVersion };
  const runtime = {
    id: "retirement-fixture", lastError: null,
    getURL(value) { calls.urls.push(value); return "chrome-extension://retirement-fixture/" + value; },
    getManifest() { calls.manifests++; return manifest; },
    reload() { calls.reload++; },
    getContexts: async () => [],
    onInstalled: event(), onStartup: event(), onMessage: event()
  };
  const chrome = {
    runtime,
    contextMenus: {
      removeAll(callback) { callback(); },
      create(item, callback) { calls.menus.push(item); callback?.(); },
      update(_id, _item, callback) { callback?.(); },
      onClicked: event()
    },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(),
      onAttached: event(), onDetached: event(), sendMessage: async () => ({ ok: true }) },
    downloads: { download: async () => 0, search: async () => [],
      onCreated: event(), onChanged: event() },
    storage: { onChanged: event(), local: { get: async defaults => defaults, set: async () => {} },
      session: { get: async defaults => defaults, set: async () => {} } }
  };
  if (alarms) chrome.alarms = {
    get: async name => { calls.alarmGet.push(name); return existing; },
    create: async (...args) => { calls.alarmCreate.push(args); },
    onAlarm
  };
  const context = vm.createContext({
    chrome, console, crypto: { randomUUID }, performance, URL, TextEncoder,
    AbortController: class extends AbortController {
      constructor() { super(); calls.abortControllers++; }
    },
    setTimeout(callback, delay) { calls.timers.push({ callback, delay }); return calls.timers.length; },
    clearTimeout(value) { calls.clears.push(value); },
    async fetch(url) {
      calls.fetch.push(url);
      if (!url.startsWith("chrome-extension://retirement-fixture/"))
        throw Error("External network forbidden in retirement fixture");
      return { ok: true, text: async () => JSON.stringify(
        url.includes("/manifest.json?") ? { ...manifest, version: nextVersion } : marker) };
    }
  });
  context.importScripts = (...files) => {
    for (const file of files)
      vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  };
  vm.runInContext(source, context, { filename: worker });
  return { calls, chrome, onAlarm };
}
function assertRetired(h) {
  assert.deepEqual(h.calls.alarmGet, [], "no retired-alarm lookup");
  assert.deepEqual(h.calls.alarmCreate, [], "no retired-alarm creation");
  assert.equal(h.calls.alarmListeners, 0, "no updater alarm listener");
  assert.deepEqual(h.calls.urls.filter(value => ["local-update-state.json", "manifest.json"].includes(value)),
    [], "no updater file URLs; ordinary application URLs remain allowed");
  assert.deepEqual(h.calls.fetch, [], "no marker or disk-manifest polling");
  assert.equal(h.calls.reload, 0, "no extension self-reload");
  assert.equal(h.calls.abortControllers, 0, "no polling controller");
  assert.deepEqual(h.calls.timers, [], "no polling timeout");
}
async function assertNormalInitialization(h) {
  assert.equal(h.chrome.runtime.onMessage.listeners.length, 1);
  assert.equal(h.chrome.runtime.onInstalled.listeners.length, 1);
  assert.equal(h.chrome.contextMenus.onClicked.listeners.length, 1);
  assert.equal(h.chrome.tabs.onActivated.listeners.length, 1);
  assert.equal(h.chrome.tabs.onUpdated.listeners.length, 1);
  if (capture) {
    assert.equal(h.chrome.runtime.onStartup.listeners.length, 1);
    await h.chrome.runtime.onStartup.emit();
    assert.equal(h.chrome.downloads.onCreated.listeners.length, 1);
    assert.equal(h.chrome.downloads.onChanged.listeners.length, 1);
  } else {
    assert.equal(h.chrome.storage.onChanged.listeners.length, 1);
    await h.chrome.runtime.onInstalled.emit();
  }
  assert.equal(h.calls.menus.at(-1).id, capture ? "capture-full-page" : "ban-post-author");
}
for (const existing of [undefined, { name: "owner-folder-update-v1", periodInMinutes: 1 }]) {
  test(`complete worker stays retired with ${existing ? "existing" : "absent"} legacy alarm across starts`, async () => {
    for (let restart = 0; restart < 3; restart++) {
      const h = harness({ existing });
      await tick();
      assertRetired(h);
      await h.onAlarm.emit({ name: "owner-folder-update-v1" });
      await tick();
      assertRetired(h);
      await assertNormalInitialization(h);
      assertRetired(h);
    }
  });
}
test("worker initializes normally without the alarms API", async () => {
  const h = harness({ alarms: false });
  await tick();
  await assertNormalInitialization(h);
  assertRetired(h);
});
test("manifest and shipped scripts contain no local updater route", () => {
  assert.ok(!manifest.permissions.includes("alarms"));
  const shipped = capture
    ? ["service-worker.js", "capture-protocol.js", "content.js", "offscreen.js", "popup.js"]
    : ["background.js", "content.js", "popup.js", "rules.js"];
  for (const file of shipped) {
    const bytes = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(bytes, /owner-folder-update|local-update-state|\.alarms\b|runtime\.reload\s*\(/, file);
  }
  if (capture) {
    for (const file of ["scripts/install-automatic-updater.ps1", "scripts/automatic-folder-updater.ps1",
      "tests/automatic-updater.test.ps1", "tests/installer.test.ps1"])
      assert.equal(fs.existsSync(path.join(root, file)), false, file);
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/build-extension.yml"), "utf8");
    assert.doesNotMatch(workflow, /automatic-updater\.test\.ps1/);
    assert.match(workflow, /folder-updater\.test\.ps1/);
  }
});
