import { after, describe, test } from "node:test";

describe("suite with failing cleanup", () => {
  after(() => {
    throw new Error("suite cleanup failed");
  });
  test("passes before cleanup", () => {});
});
