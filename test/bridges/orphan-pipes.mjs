import { spawn } from "node:child_process";

process.stdin.resume();
process.stdin.on("end", () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: "inherit",
    windowsHide: true,
  });
  child.unref();
  const events = [
    { type: "ready", protocol_version: 1, node_version: process.versions.node },
    {
      type: "summary",
      success: true,
      duration_ms: 0,
      file: null,
      counts: {
        tests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        todo: 0,
        cancelled: 0,
        suites: 0,
      },
    },
  ];
  process.stdout.write(
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    () => process.exit(0),
  );
});
