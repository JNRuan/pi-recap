import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import fs, { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StoredThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: readonly StoredThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];

export interface RecapModelRef {
  provider: string;
  id: string;
}

export interface RecapConfig {
  recapModel: RecapModelRef | null;
  thinkingLevel: StoredThinkingLevel;
  autoRecapEnabled: boolean;
  idleDelaySeconds: number;
  wordLimit: number;
  recentMessageLimit: number;
}

const DEFAULT_CONFIG: RecapConfig = {
  recapModel: null,
  thinkingLevel: "low",
  autoRecapEnabled: true,
  idleDelaySeconds: 300,
  wordLimit: 100,
  recentMessageLimit: 20
};

export const REQUIRED_PI_VERSION = "0.80.10";
export const MODEL_REGISTRY_REFRESH_TIMEOUT_MS = 15_000;

type NotificationType = "info" | "warning" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parsePositiveSafeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStoredThinkingLevel(value: unknown): value is StoredThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function parseModelRef(value: unknown): RecapModelRef | null {
  if (!isRecord(value)) return null;

  const provider = trimmedNonEmptyString(value.provider);
  const id = trimmedNonEmptyString(value.id);
  return provider !== null && id !== null ? { provider, id } : null;
}

function inferLegacyModel(value: Record<string, unknown>): RecapModelRef | null {
  const provider = trimmedNonEmptyString(value.provider);
  const id = trimmedNonEmptyString(value.model);
  return provider !== null && id !== null ? { provider, id } : null;
}

function parseVersionParts(version: unknown): number[] | null {
  if (typeof version !== "string") return null;

  const numericCore = version.split(/[+-]/, 1)[0];
  if (numericCore.length === 0) return null;

  const rawParts = numericCore.split(".");
  if (rawParts.some((part) => !/^\d+$/.test(part))) return null;

  const parts = rawParts.map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isVersionAtLeast(actual: unknown, required: string): boolean {
  const actualParts = parseVersionParts(actual);
  const requiredParts = parseVersionParts(required);
  if (actualParts === null || requiredParts === null) return false;

  const segmentCount = Math.max(actualParts.length, requiredParts.length);
  for (let index = 0; index < segmentCount; index++) {
    const actualPart = actualParts[index] ?? 0;
    const requiredPart = requiredParts[index] ?? 0;
    if (actualPart > requiredPart) return true;
    if (actualPart < requiredPart) return false;
  }

  return true;
}

export function resolveRecapConfig(rawPiRecap: unknown): RecapConfig {
  const raw = isRecord(rawPiRecap) ? rawPiRecap : {};
  const legacyInterval = isNonNegativeSafeInteger(raw.intervalSeconds) ? raw.intervalSeconds : null;

  let recapModel: RecapModelRef | null;
  if (Object.hasOwn(raw, "recapModel")) {
    recapModel = raw.recapModel === null ? null : parseModelRef(raw.recapModel);
  } else {
    recapModel = inferLegacyModel(raw);
  }

  let autoRecapEnabled = DEFAULT_CONFIG.autoRecapEnabled;
  if (typeof raw.autoRecapEnabled === "boolean") {
    autoRecapEnabled = raw.autoRecapEnabled;
  } else if (legacyInterval === 0) {
    autoRecapEnabled = false;
  } else if (legacyInterval !== null && legacyInterval > 0) {
    autoRecapEnabled = true;
  }

  let idleDelaySeconds = DEFAULT_CONFIG.idleDelaySeconds;
  if (isPositiveSafeInteger(raw.idleDelaySeconds)) {
    idleDelaySeconds = raw.idleDelaySeconds;
  } else if (legacyInterval !== null && legacyInterval > 0) {
    idleDelaySeconds = legacyInterval;
  }

  return {
    recapModel,
    thinkingLevel: isStoredThinkingLevel(raw.thinkingLevel)
      ? raw.thinkingLevel
      : DEFAULT_CONFIG.thinkingLevel,
    autoRecapEnabled,
    idleDelaySeconds,
    wordLimit: isPositiveSafeInteger(raw.wordLimit) ? raw.wordLimit : DEFAULT_CONFIG.wordLimit,
    recentMessageLimit: isPositiveSafeInteger(raw.recentMessageLimit)
      ? raw.recentMessageLimit
      : DEFAULT_CONFIG.recentMessageLimit
  };
}

export function loadRecapConfig(source: { getGlobalSettings(): unknown }): RecapConfig {
  const globalSettings = source.getGlobalSettings();
  const rawPiRecap = isRecord(globalSettings) ? globalSettings.piRecap : undefined;
  return resolveRecapConfig(rawPiRecap);
}

export function buildNormalizedPiRecap(config: RecapConfig): Record<string, unknown> {
  return {
    recapModel:
      config.recapModel === null
        ? null
        : { provider: config.recapModel.provider, id: config.recapModel.id },
    thinkingLevel: config.thinkingLevel,
    autoRecapEnabled: config.autoRecapEnabled,
    idleDelaySeconds: config.idleDelaySeconds,
    wordLimit: config.wordLimit,
    recentMessageLimit: config.recentMessageLimit
  };
}

export function modelLabel(ref: RecapModelRef | null): string {
  return ref === null ? "(none)" : `${ref.provider}/${ref.id}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function refreshModelRegistry(
  registry: { refresh(): Promise<void> },
  notify: (message: string, type: NotificationType) => void,
  timeoutMs = MODEL_REGISTRY_REFRESH_TIMEOUT_MS
): Promise<boolean> {
  const timeoutState: { handle: ReturnType<typeof setTimeout> | null } = { handle: null };
  let refreshed: boolean;
  try {
    try {
      refreshed = await Promise.race([
        registry.refresh().then(() => true),
        new Promise<false>((resolve) => {
          timeoutState.handle = setTimeout(() => {
            resolve(false);
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      notify(
        `Recap: model availability refresh failed (${errorMessage(error)}); using cached model information.`,
        "warning"
      );
      return false;
    }
  } finally {
    if (timeoutState.handle !== null) clearTimeout(timeoutState.handle);
  }

  if (!refreshed) {
    notify(
      "Recap: model availability refresh timed out; using cached model information.",
      "warning"
    );
  }
  return refreshed;
}

export function saveRecapConfig(config: RecapConfig, agentDir = getAgentDir()): void {
  const configPath = join(agentDir, "settings.json");
  const normalizedPiRecap = buildNormalizedPiRecap(config);
  const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  let settings: Record<string, unknown> = {};

  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!isRecord(parsed)) {
      throw new Error("settings root must be an object");
    }
    settings = parsed;
  } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`pi-recap: refusing to overwrite ${configPath}: ${errorMessage(error)}`);
    }
  }

  settings.piRecap = normalizedPiRecap;

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created, or cleanup may be unavailable.
    }
    throw error;
  }
}
