import assert from "node:assert/strict";
import { test } from "node:test";

test("receives forwarded arguments", () => {
  assert.ok(process.argv.includes("--fixture-value"));
});
