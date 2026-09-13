import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const requested = Number(process.argv[2] ?? 5);
if (!Number.isSafeInteger(requested) || requested < 1 || requested > 100) {
  throw new Error("Iterations must be an integer between 1 and 100.");
}

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixture.test.mjs", import.meta.url));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function sample(args) {
  const started = performance.now();
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.status !== 0)
    throw new Error(
      child.stderr || child.stdout || `Process exited with ${child.status}`,
    );
  return performance.now() - started;
}

function median(values) {
  const ordered = values.toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

sample(["--test", fixture]);
sample([cli, fixture, "--no-color"]);

const native = [];
const nodeTester = [];
for (let index = 0; index < requested; index += 1) {
  // Alternate order so a consistently warm/cold second process does not favor
  // one runner throughout the benchmark.
  if (index % 2 === 0) {
    native.push(sample(["--test", fixture]));
    nodeTester.push(sample([cli, fixture, "--no-color"]));
  } else {
    nodeTester.push(sample([cli, fixture, "--no-color"]));
    native.push(sample(["--test", fixture]));
  }
}

const nativeMedian = median(native);
const nodeTesterMedian = median(nodeTester);
process.stdout.write(
  `${JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      iterations: requested,
      testsPerIteration: 500,
      nativeNodeMedianMs: Number(nativeMedian.toFixed(2)),
      nodeTesterMedianMs: Number(nodeTesterMedian.toFixed(2)),
      overheadRatio: Number((nodeTesterMedian / nativeMedian).toFixed(3)),
    },
    null,
    2,
  )}\n`,
);
