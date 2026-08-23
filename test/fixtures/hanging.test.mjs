import { test } from "node:test";

test("never settles", async (context) => {
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {}, 1_000);
    context.signal.addEventListener(
      "abort",
      () => {
        clearInterval(timer);
        reject(context.signal.reason);
      },
      { once: true },
    );
  });
});
