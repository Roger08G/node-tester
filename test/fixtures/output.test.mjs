import { test } from "node:test";

test("writes a large message", () => {
  process.stdout.write("x".repeat(8 * 1024));
});
