import assert from "node:assert/strict";
import { test } from "node:test";

test("passes", () => {
  assert.equal("node".toUpperCase(), "NODE");
});

test("fails", () => {
  assert.equal(1, 2);
});

test.skip("is skipped", () => {});
test.todo("is planned");
