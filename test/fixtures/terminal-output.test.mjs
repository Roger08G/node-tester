import { test } from "node:test";

test("safe name\u001b]52;c;ignored\u0007\r\nforged line", () => {
  process.stdout.write("stdout\u001b[2J\rcontent\u0007\n");
  throw new Error("unsafe\u001b]0;title\u0007 error");
});
