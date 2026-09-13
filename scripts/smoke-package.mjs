import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const tarball = resolve(process.argv[2] ?? "");
if (!tarball.endsWith(".tgz")) throw new Error("Supply an npm tarball.");
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "node-tester-package-"));
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: temporary,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
try {
  // tar extraction does not run lifecycle scripts or require development tools.
  // GNU tar in Git Bash treats a drive letter in -f as a remote host. A local
  // basename in the temporary cwd works with GNU tar and Windows/BSD tar.
  copyFileSync(tarball, join(temporary, "artifact.tgz"));
  run("tar", ["-xzf", "artifact.tgz"]);
  const cli = join(temporary, "package", "dist", "cli.js");
  assert.equal(
    run(process.execPath, [cli, "--version"]).trim(),
    manifest.version,
  );
  const report = run(process.execPath, [
    cli,
    join(root, "test", "fixtures", "passing.test.mjs"),
    "--no-color",
  ]);
  assert.match(report, /1 tests \| 1 passed/u);
  assert.equal(
    readFileSync(join(temporary, "package", "assets", "test.png")).equals(
      readFileSync(join(root, "assets", "test.png")),
    ),
    true,
  );
  process.stdout.write(
    `Installed tarball smoke test passed on ${process.platform}-${process.arch}.\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
