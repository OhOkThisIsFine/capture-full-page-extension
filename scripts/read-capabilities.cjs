"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
function readCapabilities(root, target) {
  if (!["chrome", "firefox"].includes(target))
    throw Error("Expected chrome or firefox");
  const file = path.join(root, "capture-protocol.js");
  if (
    !fs.lstatSync(file).isFile() ||
    fs.lstatSync(file).isSymbolicLink() ||
    fs.statSync(file).size > 1024 * 1024
  )
    throw Error("Invalid capability source");
  const context = vm.createContext({
    TextEncoder,
    console: Object.freeze({ log() {} }),
  });
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { timeout: 1000 });
  const result = vm.runInContext(
    `__cfpProtocol.getQualifiedCapabilities(${JSON.stringify(target)})`,
    context,
    { timeout: 1000 },
  );
  if (
    typeof result.privateCapture !== "boolean" ||
    typeof result.preserveVirtualizer !== "boolean"
  )
    throw Error("Invalid candidate capabilities");
  return {
    privateCapture: result.privateCapture,
    preserveVirtualizer: result.preserveVirtualizer,
  };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--root" || args[2] !== "--target")
      throw Error("Usage: --root <verified-root> --target chrome|firefox");
    process.stdout.write(
      JSON.stringify(readCapabilities(path.resolve(args[1]), args[3])) + "\n",
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { readCapabilities };
