const assert = require("node:assert/strict");
const { test } = require("node:test");

test("runs CommonJS", () => {
  assert.equal(module.exports !== undefined, true);
});
