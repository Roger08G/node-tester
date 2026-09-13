import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Read the public version manifest, never accept a mutable dist-tag as proof.
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const directory = process.argv[3] ?? "release";
const tarballs = readdirSync(directory).filter((file) => file.endsWith(".tgz"));
if (tarballs.length !== 1) throw new Error("Expected exactly one npm tarball.");
const integrity = `sha512-${createHash("sha512")
  .update(readFileSync(join(directory, tarballs[0])))
  .digest("base64")}`;
const url = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`;
const verify = process.argv[2] === "--verify";
const attempts = verify ? 30 : 3;
let published = false;
for (let attempt = 0; attempt < attempts; attempt += 1) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) {
    const remote = await response.json();
    if (
      remote.name !== manifest.name ||
      remote.version !== manifest.version ||
      remote.dist?.integrity !== integrity
    ) {
      throw new Error(
        "Published npm identity/integrity differs from the release tarball. Do not replace the release or republish this version.",
      );
    }
    if (
      remote.dist?.attestations?.provenance?.predicateType !==
      "https://slsa.dev/provenance/v1"
    ) {
      if (verify && attempt + 1 < attempts) {
        await delay(10_000);
        continue;
      }
      throw new Error(
        "Published npm package has no expected provenance attestation.",
      );
    }
    published = true;
    break;
  }
  if (response.status !== 404)
    throw new Error(`Registry verification failed: HTTP ${response.status}.`);
  if (attempt + 1 < attempts) await delay(10_000);
}
if (verify && !published)
  throw new Error(
    "npm has not exposed the published package; retry verification later.",
  );
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`);
process.stdout.write(
  published
    ? `Verified npm ${manifest.name}@${manifest.version}, SHA-512 integrity and provenance.\n`
    : "Version not yet published.\n",
);
