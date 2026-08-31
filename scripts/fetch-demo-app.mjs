#!/usr/bin/env node
/**
 * Fetch the demo app binaries this boilerplate is verified against.
 *
 *   npm run setup            # Android (default)
 *   npm run setup -- --ios   # iOS Simulator build as well
 *
 * WHY A SCRIPT AND NOT A COMMITTED BINARY. Three reasons, in order:
 *   1. An APK is 32 MB and an app bundle more. Committing binaries makes every
 *      clone pay for every version ever built.
 *   2. saucelabs/my-demo-app-rn is ARCHIVED and publishes no LICENSE, so
 *      redistributing its binary inside this repo is not ours to do. Linking to
 *      the vendor's own release is.
 *   3. It documents where your app comes from. Replace this file's constants
 *      with your own build's - a CI artifact URL, an App Center link, an S3
 *      object - and `npm run setup` stays the one command a new machine runs.
 *
 * ⚠️ PINNED BY TAG AND VERIFIED BY DIGEST. A moving "latest" would mean a green
 * run and a red run could describe different apps, which is the one thing a
 * regression suite may never allow.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const APPS = path.join(ROOT, "apps");

const RELEASE = "v1.3.0";
const BASE = `https://github.com/saucelabs/my-demo-app-rn/releases/download/${RELEASE}`;

const TARGETS = {
  android: {
    url: `${BASE}/Android-MyDemoAppRN.1.3.0.build-244.apk`,
    file: "MyDemoAppRN.apk",
    sha256: "703fe31311b9ff16557264f23d581ad95bf9bd4cb8f2897e52cdd20b5d49a407",
  },
  ios: {
    url: `${BASE}/iOS-Simulator-MyRNDemoApp.1.3.0-162.zip`,
    file: "MyDemoAppRN.app.zip",
    // Unpinned: this one is unzipped rather than used directly, and the zip is
    // re-created by GitHub on some transfers. Verified by unzipping, not by digest.
    sha256: null,
  },
};

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function fetchTo(url, dest) {
  process.stdout.write(`  ${path.basename(dest)} ... `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log("done");
}

async function get(name) {
  const target = TARGETS[name];
  const dest = path.join(APPS, target.file);

  // Already there and correct? Say so and stop - `npm run setup` must be safe
  // to run twice, and on a slow connection re-downloading 32 MB is not free.
  if (existsSync(dest) && target.sha256 && sha256(dest) === target.sha256) {
    console.log(`  ${target.file} ... already present and verified`);
    return dest;
  }

  await fetchTo(target.url, dest);

  if (target.sha256) {
    const actual = sha256(dest);
    if (actual !== target.sha256) {
      rmSync(dest, { force: true });
      throw new Error(
        `Digest mismatch for ${target.file} - the download was deleted.\n` +
          `  expected ${target.sha256}\n  actual   ${actual}\n` +
          `Either the release was re-published, or the transfer was corrupted.`,
      );
    }
    console.log(`  ${target.file} ... sha256 verified`);
  }
  return dest;
}

const wantIOS = process.argv.includes("--ios");

mkdirSync(APPS, { recursive: true });
console.log(`Fetching demo app binaries (${RELEASE}) into apps/`);

await get("android");

if (wantIOS) {
  const zip = await get("ios");
  const { execFileSync } = await import("node:child_process");
  rmSync(path.join(APPS, "MyDemoAppRN.app"), { recursive: true, force: true });
  execFileSync("unzip", ["-q", "-o", zip, "-d", APPS]);
  rmSync(zip, { force: true });
  // The vendor's zip contains "MyRNDemoApp.app"; config/app.ts expects one name.
  const { renameSync, readdirSync } = await import("node:fs");
  const bundle = readdirSync(APPS).find((f) => f.endsWith(".app") && f !== "MyDemoAppRN.app");
  if (bundle) renameSync(path.join(APPS, bundle), path.join(APPS, "MyDemoAppRN.app"));
  console.log("  MyDemoAppRN.app ... unpacked");
}

console.log("\nReady. Next: npm run wdio:android");
