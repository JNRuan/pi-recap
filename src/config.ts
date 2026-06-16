import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export interface RecapConfig {
  provider: string;
  model: string;
  effort: string;
  intervalSeconds: number;
  wordLimit: number;
  recentMessageLimit: number;
}

export const DEFAULTS: RecapConfig = {
  provider: "",
  model: "",
  effort: "low",
  intervalSeconds: 300,
  wordLimit: 100,
  recentMessageLimit: 20
};

const VALID_EFFORTS = new Set(["low", "medium", "high"]);

export function validatePiRecapSettings(raw: unknown): Partial<RecapConfig> {
  if (!raw || typeof raw !== "object") return {};

  const obj = raw as Record<string, unknown>;
  const result: Partial<RecapConfig> = {};

  if (typeof obj.provider === "string") {
    result.provider = obj.provider.trim();
  }
  if (typeof obj.model === "string") {
    result.model = obj.model.trim();
  }
  if (typeof obj.effort === "string" && VALID_EFFORTS.has(obj.effort)) {
    result.effort = obj.effort;
  }
  if (
    typeof obj.intervalSeconds === "number" &&
    Number.isInteger(obj.intervalSeconds) &&
    obj.intervalSeconds >= 0
  ) {
    result.intervalSeconds = obj.intervalSeconds;
  }
  if (typeof obj.wordLimit === "number" && Number.isInteger(obj.wordLimit) && obj.wordLimit > 0) {
    result.wordLimit = obj.wordLimit;
  }
  if (
    typeof obj.recentMessageLimit === "number" &&
    Number.isInteger(obj.recentMessageLimit) &&
    obj.recentMessageLimit > 0
  ) {
    result.recentMessageLimit = obj.recentMessageLimit;
  }

  return result;
}

export function loadSettingsPiRecap(sm: SettingsManager): Partial<RecapConfig> {
  const globalRaw = (sm.getGlobalSettings() as Record<string, unknown>).piRecap;
  const projectRaw = (sm.getProjectSettings() as Record<string, unknown>).piRecap;
  const globalCfg = validatePiRecapSettings(globalRaw);
  const projectCfg = validatePiRecapSettings(projectRaw);
  return { ...globalCfg, ...projectCfg };
}

export function parseRecapModel(raw: string): { provider: string; model: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf("/");
  if (slash === -1 || slash === 0 || slash === trimmed.length - 1) return null;

  // Reject multiple slashes — must be exactly provider/model
  if (trimmed.includes("/", slash + 1)) return null;

  const provider = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  if (!provider || !model) return null;

  return { provider, model };
}

export function parseRecapIntervalSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const seconds = Number(trimmed);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function saveRecapSettings(patch: Partial<RecapConfig>): void {
  const configPath = join(getAgentDir(), "settings.json");

  let settings: Record<string, unknown> = {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`pi-recap: refusing to overwrite ${configPath} — ${errorMessage(err)}`);
    }
    // ENOENT → start from {}
  }

  const existingRaw = settings.piRecap;
  const existing: Record<string, unknown> =
    typeof existingRaw === "object" && existingRaw !== null && !Array.isArray(existingRaw)
      ? (existingRaw as Record<string, unknown>)
      : {};
  settings.piRecap = { ...existing, ...patch };

  const tmpPath = `${configPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  renameSync(tmpPath, configPath);
}

export function resolveConfig(
  settings: Partial<RecapConfig>,
  overrides: Partial<RecapConfig>
): RecapConfig {
  return {
    provider: overrides.provider ?? settings.provider ?? DEFAULTS.provider,
    model: overrides.model ?? settings.model ?? DEFAULTS.model,
    effort: overrides.effort ?? settings.effort ?? DEFAULTS.effort,
    intervalSeconds:
      overrides.intervalSeconds ?? settings.intervalSeconds ?? DEFAULTS.intervalSeconds,
    wordLimit: overrides.wordLimit ?? settings.wordLimit ?? DEFAULTS.wordLimit,
    recentMessageLimit:
      overrides.recentMessageLimit ?? settings.recentMessageLimit ?? DEFAULTS.recentMessageLimit
  };
}
