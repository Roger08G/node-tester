"use strict";

const [major, minor] = process.versions.node.split(".").map(Number);
if (
  process.release.name !== "node" ||
  major < 22 ||
  (major === 22 && minor < 13) ||
  !["x64", "arm64"].includes(process.arch)
) {
  process.stderr.write(
    "Node Tester requires Node.js >=22.13.0, x64 or ARM64.\n",
  );
  process.exitCode = 2;
}
