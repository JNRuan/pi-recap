import { completeSimple } from "@earendil-works/pi-ai/compat";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions
} from "@earendil-works/pi-ai";
import assert from "node:assert/strict";
import type { RecapConfig } from "../src/config";
import {
  buildRecapSystemPrompt,
  defaultCompletion,
  generateRecapText,
  preflightRecap,
  type PreflightDeps,
  type RecapTrigger,
  type SimpleCompletionFn
} from "../src/generate";

const BASE_CONFIG: RecapConfig = {
  recapModel: { provider: "test", id: "model" },
  thinkingLevel: "low",
  autoRecapEnabled: true,
  idleDelaySeconds: 300,
  wordLimit: 100,
  recentMessageLimit: 20
};

function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: "model",
    name: "Test Model",
    api: "test-api",
    provider: "test",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10_000,
    maxTokens: 1_000,
    ...overrides
  };
}

function makeResponse(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test-api",
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

interface Notification {
  message: string;
  type: "info" | "warning" | "error";
}

function makePreflightHarness(options: {
  model?: Model<Api>;
  auth?: Awaited<ReturnType<PreflightDeps["registry"]["getApiKeyAndHeaders"]>>;
  saveConfig?: (config: RecapConfig) => void;
}) {
  const notifications: Notification[] = [];
  let refreshCount = 0;
  let authCount = 0;
  let refreshed = false;
  const deps: PreflightDeps = {
    registry: {
      refresh: () => {
        return Promise.resolve().then(() => {
          refreshCount++;
          refreshed = true;
        });
      },
      find: () => (refreshed ? options.model : undefined),
      getApiKeyAndHeaders: () => {
        authCount++;
        return Promise.resolve(options.auth ?? { ok: true, apiKey: "key" });
      }
    },
    notify: (message, type) => {
      notifications.push({ message, type });
    },
    saveConfig: options.saveConfig ?? (() => undefined)
  };

  return {
    deps,
    notifications,
    refreshCount: () => refreshCount,
    authCount: () => authCount
  };
}

for (const trigger of ["manual", "auto", "startup", "compaction"] as const) {
  const harness = makePreflightHarness({ model: makeModel() });
  const result = await preflightRecap({ ...BASE_CONFIG, recapModel: null }, trigger, harness.deps);
  assert.deepEqual(result, { ok: false });
  assert.equal(harness.refreshCount(), 0);
  assert.equal(harness.authCount(), 0);
  assert.deepEqual(
    harness.notifications,
    trigger === "manual"
      ? [
          {
            message:
              "Recap: no Recap Model configured. Run /recap settings or /recap model provider/model.",
            type: "warning"
          }
        ]
      : []
  );
}

for (const trigger of ["manual", "auto"] as const) {
  const harness = makePreflightHarness({});
  const result = await preflightRecap(BASE_CONFIG, trigger, harness.deps);
  assert.deepEqual(result, { ok: false });
  assert.equal(harness.refreshCount(), 1);
  assert.equal(harness.authCount(), 0);
  assert.deepEqual(harness.notifications, [
    { message: "Recap: test/model is not currently available.", type: "warning" }
  ]);
}

for (const trigger of ["manual", "auto"] as const) {
  const harness = makePreflightHarness({
    model: makeModel(),
    auth: { ok: false, error: "authentication failed" }
  });
  const result = await preflightRecap(BASE_CONFIG, trigger, harness.deps);
  assert.deepEqual(result, { ok: false });
  assert.equal(harness.authCount(), 1);
  assert.deepEqual(harness.notifications, [
    { message: "Recap: authentication failed", type: "warning" }
  ]);
}

const persistedConfig = {
  ...BASE_CONFIG,
  thinkingLevel: "max" as const
};
let saveCount = 0;
const clampHarness = makePreflightHarness({
  model: makeModel({ thinkingLevelMap: { max: null, xhigh: "xhigh" } }),
  saveConfig: (config) => {
    saveCount++;
    Object.assign(persistedConfig, config);
  }
});
const firstClamp = await preflightRecap(persistedConfig, "auto", clampHarness.deps);
assert.equal(firstClamp.ok && firstClamp.effectiveLevel, "xhigh");
assert.equal(persistedConfig.thinkingLevel, "xhigh");
assert.equal(saveCount, 1);
assert.deepEqual(clampHarness.notifications, [
  {
    message: "Recap: Recap Thinking Level clamped to xhigh for test/model.",
    type: "info"
  }
]);
clampHarness.notifications.length = 0;
const secondClamp = await preflightRecap(persistedConfig, "auto", clampHarness.deps);
assert.equal(secondClamp.ok && secondClamp.effectiveLevel, "xhigh");
assert.equal(saveCount, 1);
assert.deepEqual(clampHarness.notifications, []);

const saveErrorHarness = makePreflightHarness({
  model: makeModel({ reasoning: false }),
  saveConfig: () => {
    throw new Error("disk full");
  }
});
const afterSaveError = await preflightRecap(
  { ...BASE_CONFIG, thinkingLevel: "high" },
  "manual",
  saveErrorHarness.deps
);
assert.ok(afterSaveError.ok);
assert.equal(afterSaveError.effectiveLevel, "off");
assert.deepEqual(saveErrorHarness.notifications, [
  {
    message: "Recap: could not save the effective Recap Thinking Level: disk full",
    type: "error"
  }
]);
let postSaveErrorCompletionCount = 0;
const postSaveErrorText = await generateRecapText(
  {
    conversationText: "Continue after the persistence error",
    wordLimit: BASE_CONFIG.wordLimit,
    model: afterSaveError.model,
    auth: afterSaveError.auth,
    effectiveLevel: afterSaveError.effectiveLevel
  },
  {
    completion: () => {
      postSaveErrorCompletionCount++;
      return Promise.resolve(makeResponse("generation continued"));
    }
  }
);
assert.equal(postSaveErrorCompletionCount, 1);
assert.equal(postSaveErrorText, "generation continued");

assert.equal(defaultCompletion, completeSimple);

interface CapturedCompletion {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions | undefined;
}

const captured: CapturedCompletion[] = [];
const capturingCompletion: SimpleCompletionFn = (model, context, options) => {
  captured.push({ model, context, options });
  return Promise.resolve(makeResponse("raw recap"));
};
const auth = {
  ok: true as const,
  apiKey: "secret-key",
  headers: { "x-test": "header" },
  env: { TEST_REGION: "region" }
};
const generationModel = makeModel();

for (const effectiveLevel of ["off", "high"] as const) {
  const result = await generateRecapText(
    {
      conversationText: "User: continue the task",
      wordLimit: 73,
      model: generationModel,
      auth,
      effectiveLevel
    },
    { completion: capturingCompletion }
  );
  assert.equal(result, "raw recap");
}

assert.equal(captured.length, 2);
for (const call of captured) {
  assert.equal(call.model, generationModel);
  assert.equal(call.context.systemPrompt, buildRecapSystemPrompt(73));
  assert.deepEqual(call.context.messages, [
    {
      role: "user",
      content: [{ type: "text", text: "User: continue the task" }],
      timestamp: call.context.messages[0]?.timestamp
    }
  ]);
  assert.ok(call.options);
  assert.equal(call.options.apiKey, "secret-key");
  assert.deepEqual(call.options.headers, { "x-test": "header" });
  assert.deepEqual(call.options.env, { TEST_REGION: "region" });
}
assert.equal(Object.hasOwn(captured[0]?.options ?? {}, "reasoning"), false);
assert.equal(captured[1]?.options?.reasoning, "high");

const triggers: readonly RecapTrigger[] = ["manual", "auto", "startup", "compaction"];
assert.equal(triggers.length, 4);

console.log("test-gates: passed");
