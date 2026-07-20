import { VERSION } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isVersionAtLeast, REQUIRED_PI_VERSION } from "../src/config";

const PI_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui"
] as const;

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed));
  return parsed as Record<string, unknown>;
}

const projectPackage = readJsonObject(join(projectRoot, "package.json"));
const peerDependencies = projectPackage.peerDependencies;
assert.ok(
  typeof peerDependencies === "object" &&
    peerDependencies !== null &&
    !Array.isArray(peerDependencies)
);

for (const packageName of PI_PACKAGES) {
  assert.equal(
    (peerDependencies as Record<string, unknown>)[packageName],
    ">=0.80.10",
    `${packageName} peer range must enforce the baseline`
  );

  const installedPackage = readJsonObject(
    join(projectRoot, "node_modules", ...packageName.split("/"), "package.json")
  );
  const installedVersion = installedPackage.version;
  assert.equal(typeof installedVersion, "string");
  if (typeof installedVersion !== "string") {
    throw new TypeError(`${packageName} package version must be a string`);
  }
  assert.ok(
    isVersionAtLeast(installedVersion, REQUIRED_PI_VERSION),
    `${packageName} ${installedVersion} is below ${REQUIRED_PI_VERSION}`
  );
}

assert.equal(isVersionAtLeast("0.80.9", REQUIRED_PI_VERSION), false);
assert.equal(isVersionAtLeast("0.80.10", REQUIRED_PI_VERSION), true);
assert.equal(isVersionAtLeast("0.81.0", REQUIRED_PI_VERSION), true);
assert.equal(isVersionAtLeast("1.0.0", REQUIRED_PI_VERSION), true);
assert.equal(isVersionAtLeast("0.80.10-beta.1", REQUIRED_PI_VERSION), true);
assert.equal(isVersionAtLeast("0.80.9-beta.1", REQUIRED_PI_VERSION), false);
assert.equal(isVersionAtLeast("0.80", REQUIRED_PI_VERSION), false);
assert.equal(isVersionAtLeast("0.80.10.0", REQUIRED_PI_VERSION), true);
assert.equal(isVersionAtLeast("0.80.10.1", REQUIRED_PI_VERSION), true);
assert.equal(isVersionAtLeast(VERSION, REQUIRED_PI_VERSION), true);

console.log("test-baseline: passed");
