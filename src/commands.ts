import { THINKING_LEVELS, type RecapModelRef, type StoredThinkingLevel } from "./config";

export type RecapCommand =
  | { kind: "refresh" }
  | { kind: "settings" }
  | { kind: "config" }
  | { kind: "auto"; enabled: boolean }
  | { kind: "model"; model: RecapModelRef | null }
  | { kind: "thinking"; level: StoredThinkingLevel }
  | { kind: "delay"; seconds: number }
  | { kind: "messages"; count: number }
  | { kind: "words"; count: number }
  | { kind: "usage"; message: string }
  | { kind: "unknown"; message: string };

const AVAILABLE_SUBCOMMANDS = "settings, auto, model, thinking, delay, messages, words, config";

const USAGE = {
  auto: "Usage: /recap auto on|off",
  model: "Usage: /recap model provider/model|none",
  thinking: "Usage: /recap thinking off|minimal|low|medium|high|xhigh|max",
  delay: "Usage: /recap delay <seconds>",
  messages: "Usage: /recap messages <count>",
  words: "Usage: /recap words <count>"
} as const;

const LEGACY_HINTS: Readonly<Record<string, string>> = {
  on: ' Use "/recap auto on" instead.',
  off: ' Use "/recap auto off" instead.',
  interval: ' Use "/recap delay <seconds>" instead.',
  recent: ' Use "/recap messages <count>" instead.'
};

function usage(message: string): RecapCommand {
  return { kind: "usage", message };
}

function unknown(head: string): RecapCommand {
  const base = `Recap: unknown subcommand "${head}". Available: ${AVAILABLE_SUBCOMMANDS}.`;
  return { kind: "unknown", message: base + (LEGACY_HINTS[head] ?? "") };
}

function isThinkingLevel(value: string): value is StoredThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

export function parseModelArg(raw: string): RecapModelRef | null {
  const trimmed = raw.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) return null;

  const provider = trimmed.slice(0, slashIndex).trim();
  const id = trimmed.slice(slashIndex + 1).trim();
  return provider.length > 0 && id.length > 0 ? { provider, id } : null;
}

export function parsePositiveSafeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function parseRecapCommand(args: string): RecapCommand {
  const trimmed = args.trim();
  if (trimmed.length === 0) return { kind: "refresh" };

  const separatorIndex = trimmed.search(/\s/);
  const head = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
  const value = separatorIndex === -1 ? "" : trimmed.slice(separatorIndex).trim();

  if (head === "settings" && value.length === 0) return { kind: "settings" };
  if (head === "config" && value.length === 0) return { kind: "config" };

  if (head === "auto") {
    if (value === "on") return { kind: "auto", enabled: true };
    if (value === "off") return { kind: "auto", enabled: false };
    return usage(USAGE.auto);
  }

  if (head === "model") {
    if (value === "none") return { kind: "model", model: null };
    const model = parseModelArg(value);
    return model === null ? usage(USAGE.model) : { kind: "model", model };
  }

  if (head === "thinking") {
    return isThinkingLevel(value) ? { kind: "thinking", level: value } : usage(USAGE.thinking);
  }

  if (head === "delay") {
    const seconds = parsePositiveSafeInt(value);
    return seconds === null ? usage(USAGE.delay) : { kind: "delay", seconds };
  }

  if (head === "messages") {
    const count = parsePositiveSafeInt(value);
    return count === null ? usage(USAGE.messages) : { kind: "messages", count };
  }

  if (head === "words") {
    const count = parsePositiveSafeInt(value);
    return count === null ? usage(USAGE.words) : { kind: "words", count };
  }

  return unknown(head);
}
