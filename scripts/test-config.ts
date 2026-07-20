import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNormalizedPiRecap,
  loadRecapConfig,
  type RecapConfig,
  resolveRecapConfig,
  saveRecapConfig,
  THINKING_LEVELS
} from "../src/config";

const DEFAULT_CONFIG: RecapConfig = {
  recapModel: null,
  thinkingLevel: "low",
  autoRecapEnabled: true,
  idleDelaySeconds: 300,
  wordLimit: 100,
  recentMessageLimit: 20
};

assert.deepEqual(resolveRecapConfig(undefined), DEFAULT_CONFIG);

for (const thinkingLevel of THINKING_LEVELS) {
  assert.equal(resolveRecapConfig({ thinkingLevel }).thinkingLevel, thinkingLevel);
}
assert.equal(resolveRecapConfig({ thinkingLevel: "turbo" }).thinkingLevel, "low");
assert.equal(resolveRecapConfig({ effort: "high" }).thinkingLevel, "low");

assert.deepEqual(
  resolveRecapConfig({
    recapModel: { provider: " anthropic ", id: " claude-sonnet " },
    provider: "legacy",
    model: "legacy-model"
  }).recapModel,
  { provider: "anthropic", id: "claude-sonnet" }
);
assert.equal(
  resolveRecapConfig({ recapModel: null, provider: "legacy", model: "legacy-model" }).recapModel,
  null
);
assert.equal(
  resolveRecapConfig({
    recapModel: { provider: "", id: "invalid" },
    provider: "legacy",
    model: "legacy-model"
  }).recapModel,
  null
);
assert.deepEqual(resolveRecapConfig({ provider: " openrouter ", model: " model/id " }).recapModel, {
  provider: "openrouter",
  id: "model/id"
});
assert.equal(resolveRecapConfig({ provider: "openrouter" }).recapModel, null);
assert.equal(resolveRecapConfig({ provider: "", model: "model" }).recapModel, null);

assert.equal(
  resolveRecapConfig({ autoRecapEnabled: false, intervalSeconds: 600 }).autoRecapEnabled,
  false
);
assert.equal(
  resolveRecapConfig({ autoRecapEnabled: true, intervalSeconds: 0 }).autoRecapEnabled,
  true
);
assert.equal(
  resolveRecapConfig({ autoRecapEnabled: "yes", intervalSeconds: 0 }).autoRecapEnabled,
  false
);
assert.equal(resolveRecapConfig({ intervalSeconds: 600 }).autoRecapEnabled, true);
assert.equal(resolveRecapConfig({ intervalSeconds: -1 }).autoRecapEnabled, true);
assert.equal(resolveRecapConfig({}).autoRecapEnabled, true);

assert.equal(
  resolveRecapConfig({ idleDelaySeconds: 45, intervalSeconds: 600 }).idleDelaySeconds,
  45
);
assert.equal(
  resolveRecapConfig({ idleDelaySeconds: 0, intervalSeconds: 600 }).idleDelaySeconds,
  600
);
assert.equal(
  resolveRecapConfig({ idleDelaySeconds: -1, intervalSeconds: 0 }).idleDelaySeconds,
  300
);
assert.equal(resolveRecapConfig({ intervalSeconds: 0 }).idleDelaySeconds, 300);
assert.equal(resolveRecapConfig({ intervalSeconds: 600 }).idleDelaySeconds, 600);
assert.equal(
  resolveRecapConfig({ intervalSeconds: Number.MAX_SAFE_INTEGER + 1 }).idleDelaySeconds,
  300
);

assert.deepEqual(resolveRecapConfig({ intervalSeconds: 0 }), {
  ...DEFAULT_CONFIG,
  autoRecapEnabled: false
});
assert.deepEqual(
  resolveRecapConfig({ autoRecapEnabled: false, idleDelaySeconds: 900, intervalSeconds: 60 }),
  { ...DEFAULT_CONFIG, autoRecapEnabled: false, idleDelaySeconds: 900 }
);
assert.deepEqual(resolveRecapConfig({ autoRecapEnabled: false, intervalSeconds: 600 }), {
  ...DEFAULT_CONFIG,
  autoRecapEnabled: false,
  idleDelaySeconds: 600
});

assert.equal(resolveRecapConfig({ wordLimit: 75 }).wordLimit, 75);
assert.equal(resolveRecapConfig({ wordLimit: 0 }).wordLimit, 100);
assert.equal(resolveRecapConfig({ recentMessageLimit: 40 }).recentMessageLimit, 40);
assert.equal(resolveRecapConfig({ recentMessageLimit: 1.5 }).recentMessageLimit, 20);

const normalized = buildNormalizedPiRecap({
  recapModel: { provider: "openrouter", id: "deepseek/deepseek-chat-v3" },
  thinkingLevel: "max",
  autoRecapEnabled: false,
  idleDelaySeconds: 450,
  wordLimit: 125,
  recentMessageLimit: 35
});
assert.deepEqual(Object.keys(normalized).sort(), [
  "autoRecapEnabled",
  "idleDelaySeconds",
  "recapModel",
  "recentMessageLimit",
  "thinkingLevel",
  "wordLimit"
]);
for (const obsoleteKey of ["provider", "model", "effort", "intervalSeconds"]) {
  assert.equal(Object.hasOwn(normalized, obsoleteKey), false);
}

let projectSettingsRead = false;
const settingsSource = {
  getGlobalSettings: () => ({
    piRecap: { recapModel: null, thinkingLevel: "high", autoRecapEnabled: false }
  }),
  getProjectSettings: () => {
    projectSettingsRead = true;
    return {
      piRecap: {
        recapModel: { provider: "project", id: "ignored" },
        thinkingLevel: "max",
        autoRecapEnabled: true
      }
    };
  }
};
assert.deepEqual(loadRecapConfig(settingsSource), {
  ...DEFAULT_CONFIG,
  thinkingLevel: "high",
  autoRecapEnabled: false
});
assert.equal(projectSettingsRead, false);

const agentDir = mkdtempSync(join(tmpdir(), "pi-recap-config-"));
try {
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        theme: "dark",
        nested: { preserved: true },
        piRecap: {
          provider: "legacy",
          model: "old",
          effort: "high",
          intervalSeconds: 20,
          unknown: "remove"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const savedConfig: RecapConfig = {
    recapModel: null,
    thinkingLevel: "minimal",
    autoRecapEnabled: false,
    idleDelaySeconds: 720,
    wordLimit: 80,
    recentMessageLimit: 12
  };
  saveRecapConfig(savedConfig, agentDir);

  const saved: unknown = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(saved, {
    theme: "dark",
    nested: { preserved: true },
    piRecap: buildNormalizedPiRecap(savedConfig)
  });
  assert.deepEqual(loadRecapConfig({ getGlobalSettings: () => saved }), savedConfig);
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}

const freshAgentDir = mkdtempSync(join(tmpdir(), "pi-recap-config-fresh-"));
try {
  saveRecapConfig(DEFAULT_CONFIG, freshAgentDir);
  const saved: unknown = JSON.parse(readFileSync(join(freshAgentDir, "settings.json"), "utf8"));
  assert.deepEqual(saved, { piRecap: buildNormalizedPiRecap(DEFAULT_CONFIG) });
} finally {
  rmSync(freshAgentDir, { recursive: true, force: true });
}

for (const [name, original] of [
  ["invalid-json", "{ definitely not JSON\n"],
  ["array-root", "[1, 2, 3]\n"]
] as const) {
  const corruptAgentDir = mkdtempSync(join(tmpdir(), `pi-recap-config-${name}-`));
  const settingsPath = join(corruptAgentDir, "settings.json");
  try {
    writeFileSync(settingsPath, original, "utf8");
    assert.throws(() => {
      saveRecapConfig(DEFAULT_CONFIG, corruptAgentDir);
    }, /pi-recap: refusing to overwrite/);
    assert.equal(readFileSync(settingsPath, "utf8"), original);
  } finally {
    rmSync(corruptAgentDir, { recursive: true, force: true });
  }
}

const renameFailureAgentDir = mkdtempSync(join(tmpdir(), "pi-recap-config-rename-failure-"));
const originalRenameSync = fs.renameSync;
try {
  writeFileSync(join(renameFailureAgentDir, "settings.json"), "{}\n", "utf8");
  fs.renameSync = () => {
    throw new Error("rename failed");
  };

  assert.throws(() => {
    saveRecapConfig(DEFAULT_CONFIG, renameFailureAgentDir);
  }, /rename failed/);
  assert.deepEqual(
    readdirSync(renameFailureAgentDir).filter((name) => name.endsWith(".tmp")),
    []
  );
} finally {
  fs.renameSync = originalRenameSync;
  rmSync(renameFailureAgentDir, { recursive: true, force: true });
}

console.log("test-config: passed");
