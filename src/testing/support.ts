import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { THINKING_LEVELS, type RecapConfig, type StoredThinkingLevel } from "../settings/config";

export const DEFAULT_RECAP_CONFIG: RecapConfig = {
  recapModel: null,
  thinkingLevel: "low",
  autoRecapEnabled: true,
  idleDelaySeconds: 300,
  wordLimit: 100,
  recentMessageLimit: 20
};

export interface Notice {
  message: string;
  type: "info" | "warning" | "error";
}

export type FakeRegistryAuth =
  | {
      ok: true;
      apiKey?: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    }
  | { ok: false; error: string };

export class FakeRegistry {
  models: Model<Api>[];
  auth: FakeRegistryAuth = { ok: true, apiKey: "test-key" };
  refreshCount = 0;
  refreshImplementation: (() => Promise<void>) | null = null;

  constructor(models: readonly Model<Api>[] = []) {
    this.models = [...models];
  }

  refresh(): Promise<void> {
    this.refreshCount++;
    return this.refreshImplementation?.() ?? Promise.resolve();
  }

  find(provider: string, id: string): Model<Api> | undefined {
    return this.models.find((model) => model.provider === provider && model.id === id);
  }

  getAvailable(): Model<Api>[] {
    return [...this.models];
  }

  getApiKeyAndHeaders(): Promise<FakeRegistryAuth> {
    return Promise.resolve(this.auth);
  }
}

export function makeModel(
  overrides: Partial<Model<Api>> = {},
  supportedThinkingLevels: readonly StoredThinkingLevel[] = THINKING_LEVELS
): Model<Api> {
  return {
    id: "model",
    name: "Test Model",
    api: "openai-responses",
    provider: "test",
    baseUrl: "https://example.invalid",
    reasoning: supportedThinkingLevels.some((level) => level !== "off"),
    thinkingLevelMap: Object.fromEntries(
      THINKING_LEVELS.map((level) => [
        level,
        supportedThinkingLevels.includes(level) ? level : null
      ])
    ),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 8_000,
    ...overrides
  };
}

export function makeResponse(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "test",
    model: "model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: 0
  };
}
