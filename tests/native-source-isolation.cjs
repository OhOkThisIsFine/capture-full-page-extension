"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  os = require("node:os");
for (const name of [
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:dgram",
]) {
  const mod = require(name);
  for (const key of [
    "request",
    "get",
    "connect",
    "createConnection",
    "createSocket",
  ])
    if (key in mod)
      mod[key] = () => {
        throw Error(
          "Native QA isolation denies external Node network: " +
            name +
            "." +
            key,
        );
      };
}
const net = require("node:net"),
  listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  assert.equal(args[0], 0, "Task-only ephemeral server");
  assert.equal(args[1], "127.0.0.1", "Loopback-only synthetic server");
  return listen.apply(this, args);
};
globalThis.fetch = () =>
  Promise.reject(Error("Native QA isolation denies Node fetch"));
const cp = require("node:child_process"),
  spawn = cp.spawn;
cp.spawn = function (file, args, options) {
  assert.equal(
    path.resolve(file).toLowerCase(),
    path
      .resolve("C:/Program Files/Google/Chrome/Application/chrome.exe")
      .toLowerCase(),
  );
  const profile = args
    .find((arg) => arg.startsWith("--user-data-dir="))
    ?.slice(16);
  assert.ok(
    profile &&
      path
        .resolve(profile)
        .startsWith(path.resolve(os.tmpdir()) + path.sep + "cfp-p1-synthetic-"),
  );
  assert.equal(
    args.some((arg) =>
      /load-extension|disable-web-security|no-sandbox|remote-debugging-port/.test(
        arg,
      ),
    ),
    false,
  );
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
  return spawn(file, args, { ...options, env, windowsHide: true });
};
for (const name of [
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
])
  cp[name] = () => {
    throw Error("Native QA denies unrelated subprocess");
  };
