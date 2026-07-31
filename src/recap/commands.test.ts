import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parseModelArg, parsePositiveSafeInt, parseRecapCommand } from "./commands";
import { THINKING_LEVELS } from "../settings/config";

describe("recap commands", () => {
  test("parses valid commands", () => {
    assert.deepEqual(parseRecapCommand(""), { kind: "refresh" });
    assert.deepEqual(parseRecapCommand("settings"), { kind: "settings" });
    assert.deepEqual(parseRecapCommand(" config "), { kind: "config" });
    assert.deepEqual(parseRecapCommand("auto on"), { kind: "auto", enabled: true });
    assert.deepEqual(parseRecapCommand("auto off"), { kind: "auto", enabled: false });
    assert.deepEqual(parseRecapCommand("model none"), { kind: "model", model: null });
    assert.deepEqual(parseRecapCommand("model anthropic/claude-sonnet"), {
      kind: "model",
      model: { provider: "anthropic", id: "claude-sonnet" }
    });
    assert.deepEqual(parseRecapCommand("model openrouter/deepseek/deepseek-chat-v3"), {
      kind: "model",
      model: { provider: "openrouter", id: "deepseek/deepseek-chat-v3" }
    });
    for (const level of THINKING_LEVELS) {
      assert.deepEqual(parseRecapCommand(`thinking ${level}`), { kind: "thinking", level });
    }
    assert.deepEqual(parseRecapCommand("delay 300"), { kind: "delay", seconds: 300 });
    assert.deepEqual(parseRecapCommand("messages 20"), { kind: "messages", count: 20 });
    assert.deepEqual(parseRecapCommand("words 100"), { kind: "words", count: 100 });
  });

  test("parses model references", () => {
    assert.deepEqual(parseModelArg(" openrouter / deepseek/deepseek-chat-v3 "), {
      provider: "openrouter",
      id: "deepseek/deepseek-chat-v3"
    });
    assert.equal(parseModelArg(""), null);
    assert.equal(parseModelArg("provider"), null);
    assert.equal(parseModelArg("/model"), null);
    assert.equal(parseModelArg("provider/   "), null);
  });

  test("accepts only positive safe integers", () => {
    assert.equal(parsePositiveSafeInt(" 42 "), 42);
    for (const invalid of ["", " ", "0", "-1", "+1", "1.5", "1e3", "junk", "9007199254740992"]) {
      assert.equal(parsePositiveSafeInt(invalid), null);
    }
  });

  test("returns usage for invalid arguments", () => {
    const usageCases = [
      ["auto", "Usage: /recap auto on|off"],
      ["auto maybe", "Usage: /recap auto on|off"],
      ["model", "Usage: /recap model provider/model|none"],
      ["model /", "Usage: /recap model provider/model|none"],
      ["thinking", "Usage: /recap thinking off|minimal|low|medium|high|xhigh|max"],
      ["thinking turbo", "Usage: /recap thinking off|minimal|low|medium|high|xhigh|max"],
      ["delay", "Usage: /recap delay <seconds>"],
      ["delay 0", "Usage: /recap delay <seconds>"],
      ["messages", "Usage: /recap messages <count>"],
      ["messages 9007199254740992", "Usage: /recap messages <count>"],
      ["words", "Usage: /recap words <count>"],
      ["words -1", "Usage: /recap words <count>"]
    ] as const;

    for (const [input, message] of usageCases) {
      assert.deepEqual(parseRecapCommand(input), { kind: "usage", message });
    }
  });

  test("reports unknown and legacy subcommands", () => {
    const unknownBase =
      'Recap: unknown subcommand "garbage". Available: settings, auto, model, thinking, delay, messages, words, config.';
    assert.deepEqual(parseRecapCommand("garbage"), { kind: "unknown", message: unknownBase });

    const legacyCases = [
      ["on", ' Use "/recap auto on" instead.'],
      ["off", ' Use "/recap auto off" instead.'],
      ["interval", ' Use "/recap delay <seconds>" instead.'],
      ["recent", ' Use "/recap messages <count>" instead.']
    ] as const;

    for (const [head, hint] of legacyCases) {
      assert.deepEqual(parseRecapCommand(head), {
        kind: "unknown",
        message: `Recap: unknown subcommand "${head}". Available: settings, auto, model, thinking, delay, messages, words, config.${hint}`
      });
    }
  });
});
