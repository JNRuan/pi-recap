import type { SettingsManager } from "@earendil-works/pi-coding-agent";

export const DEFAULTS = {
  provider: undefined as string | undefined,
  model: undefined as string | undefined,
  effort: "low" as string,
  intervalMs: 300_000 as number,
  wordLimit: 50 as number
};

export interface RecapConfig {
  provider: string | undefined;
  model: string | undefined;
  effort: string;
  intervalMs: number;
  wordLimit: number;
}

const VALID_EFFORTS = new Set(["low", "medium", "high"]);

export function validatePiRecapSettings(raw: unknown): Partial<RecapConfig> {
  if (!raw || typeof raw !== "object") return {};

  const obj = raw as Record<string, unknown>;
  const result: Partial<RecapConfig> = {};

  if (typeof obj.provider === "string") {
    result.provider = obj.provider;
  }
  if (typeof obj.model === "string") {
    result.model = obj.model;
  }
  if (typeof obj.effort === "string" && VALID_EFFORTS.has(obj.effort)) {
    result.effort = obj.effort;
  }
  if (typeof obj.intervalMs === "number" && obj.intervalMs >= 0) {
    result.intervalMs = obj.intervalMs;
  }
  if (typeof obj.wordLimit === "number" && Number.isInteger(obj.wordLimit) && obj.wordLimit > 0) {
    result.wordLimit = obj.wordLimit;
  }

  return result;
}

export function loadSettingsPiRecap(sm: SettingsManager): Partial<RecapConfig> {
  const global = sm.getGlobalSettings();
  const project = sm.getProjectSettings();
  const merged = { ...global, ...project } as Record<string, unknown>;
  const raw = merged.piRecap;
  return validatePiRecapSettings(raw);
}

export function parseRecapArgs(
  raw: string
): { ok: true; overrides: Partial<RecapConfig> } | { ok: false; error: string } {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: true, overrides: {} };

  const overrides: Record<string, unknown> = {};
  let hasProvider = false;
  let hasModel = false;

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) return { ok: false, error: `Invalid format: ${token}` };

    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);

    switch (key) {
      case "provider":
        overrides.provider = value;
        hasProvider = true;
        break;
      case "model":
        overrides.model = value;
        hasModel = true;
        break;
      case "effort":
        if (!VALID_EFFORTS.has(value)) {
          return {
            ok: false,
            error: `Invalid effort: ${value}. Must be low, medium, or high.`
          };
        }
        overrides.effort = value;
        break;
      case "interval":
        overrides.intervalMs = Number(value);
        break;
      case "wordLimit":
        overrides.wordLimit = Number(value);
        break;
      default:
        return { ok: false, error: `Unknown key: ${key}` };
    }
  }

  if (hasProvider !== hasModel) {
    return {
      ok: false,
      error: "provider and model must be set together"
    };
  }

  return { ok: true, overrides };
}

export function resolveConfig(
  ctx: {
    model: { provider: string; id: string } | undefined;
  },
  settings: Partial<RecapConfig>,
  overrides: Partial<RecapConfig>
): RecapConfig {
  return {
    provider: overrides.provider ?? settings.provider ?? DEFAULTS.provider,
    model: overrides.model ?? settings.model ?? DEFAULTS.model,
    effort: overrides.effort ?? settings.effort ?? DEFAULTS.effort,
    intervalMs: overrides.intervalMs ?? settings.intervalMs ?? DEFAULTS.intervalMs,
    wordLimit: overrides.wordLimit ?? settings.wordLimit ?? DEFAULTS.wordLimit
  };
}
