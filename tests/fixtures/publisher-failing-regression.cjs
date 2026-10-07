// Intentionally failing, syntax-valid fixture. Not part of the default *.test.cjs suite.
const { test } = require("node:test");
const assert = require("node:assert/strict");
test("publisher gate rejects a failing regression", () => assert.equal(1, 2));
