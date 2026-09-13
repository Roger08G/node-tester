process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(
    `${JSON.stringify({ type: "ready", protocol_version: 1, node_version: process.versions.node })}\n`,
  );
});
