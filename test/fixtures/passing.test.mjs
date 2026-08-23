import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("math", () => {
  test("adds numbers", () => {
    assert.equal(2 + 2, 4);
  });
});
