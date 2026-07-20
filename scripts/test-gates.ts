import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
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
import {
  DEFAULT_RECAP_CONFIG,
  FakeRegistry,
  makeModel,
  makeResponse,
  type Notice
} from "./test-support";

const BASE_CONFIG: RecapConfig = {
  ...DEFAULT_RECAP_CONFIG,
  recapModel: { provider: "test", id: "model" }
};

function makePreflightHarness(options: {
  model?: Model<Api>;
  auth?: Awaited<ReturnType<PreflightDeps["registry"]["getApiKeyAndHeaders"]>>;
  refreshImplementation?: () => Promise<void>;
  refreshTimeoutMs?: number;
}) {
  const notifications: Notice[] = [];
  let authCount = 0;
  const registry = new FakeRegistry(options.model === undefined ? [] : [options.model]);
  registry.refreshImplementation = options.refreshImplementation ?? null;
  if (options.auth !== undefined) registry.auth = options.auth;
  const deps: PreflightDeps = {
    registry: {
      refresh: () => registry.refresh(),
      find: (provider, id) => registry.find(provider, id),
      getApiKeyAndHeaders: () => {
        authCount++;
        return registry.getApiKeyAndHeaders();
      }
    },
    notify: (message, type) => {
      notifications.push({ message, type });
    },
    refreshTimeoutMs: options.refreshTimeoutMs
  };

  return {
    deps,
    notifications,
    refreshCount: () => registry.refreshCount,
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
const clampHarness = makePreflightHarness({
  model: makeModel({ thinkingLevelMap: { max: null, xhigh: "xhigh" } })
});
const firstClamp = await preflightRecap(persistedConfig, "auto", clampHarness.deps);
assert.equal(firstClamp.ok && firstClamp.effectiveLevel, "xhigh");
assert.equal(firstClamp.ok && firstClamp.levelClamped, true);
assert.equal(persistedConfig.thinkingLevel, "max");
assert.deepEqual(clampHarness.notifications, []);

const settledClamp = await preflightRecap(
  { ...persistedConfig, thinkingLevel: "xhigh" },
  "auto",
  clampHarness.deps
);
assert.equal(settledClamp.ok && settledClamp.levelClamped, false);

const timeoutHarness = makePreflightHarness({
  model: makeModel(),
  refreshImplementation: () => new Promise<void>(() => undefined),
  refreshTimeoutMs: 1
});
const afterRefreshTimeout = await preflightRecap(BASE_CONFIG, "manual", timeoutHarness.deps);
assert.ok(afterRefreshTimeout.ok);
assert.deepEqual(timeoutHarness.notifications, [
  {
    message: "Recap: model availability refresh timed out; using cached model information.",
    type: "warning"
  }
]);

const rejectedRefreshHarness = makePreflightHarness({
  model: makeModel(),
  refreshImplementation: () => Promise.reject(new Error("provider offline"))
});
const afterRefreshRejection = await preflightRecap(
  BASE_CONFIG,
  "manual",
  rejectedRefreshHarness.deps
);
assert.ok(afterRefreshRejection.ok);
assert.deepEqual(rejectedRefreshHarness.notifications, [
  {
    message:
      "Recap: model availability refresh failed (provider offline); using cached model information.",
    type: "warning"
  }
]);

const reasoningDisabledHarness = makePreflightHarness({
  model: makeModel({ reasoning: false })
});
const reasoningDisabled = await preflightRecap(
  { ...BASE_CONFIG, thinkingLevel: "high" },
  "manual",
  reasoningDisabledHarness.deps
);
assert.equal(reasoningDisabled.ok && reasoningDisabled.effectiveLevel, "off");

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
  assert.equal(call.options.timeoutMs, 60_000);
  assert.equal(call.options.maxRetries, 2);
}
assert.equal(Object.hasOwn(captured[0]?.options ?? {}, "reasoning"), false);
assert.equal(captured[1]?.options?.reasoning, "high");

const triggers: readonly RecapTrigger[] = ["manual", "auto", "startup", "compaction"];
assert.equal(triggers.length, 4);

console.log("test-gates: passed");
