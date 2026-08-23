import assert from "node:assert/strict";
import { test } from "node:test";

for (let index = 0; index < 500; index += 1) {
  test(`case ${index}`, () => {
    assert.equal(index + 1, Number(`${index + 1}`));
  });
}
