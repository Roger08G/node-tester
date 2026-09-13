process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write("x".repeat(256 * 1024));
  setInterval(() => {}, 1_000);
});
