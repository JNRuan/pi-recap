interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface EntryMessage {
  role?: string;
  content?: unknown;
}

interface SessionEntry {
  type: string;
  message?: EntryMessage;
  summary?: string;
  customType?: string;
}

const extractTextParts = (content: unknown): string[] => {
  if (typeof content === "string") {
    return [content];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const block = part as ContentBlock;
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
  }

  return textParts;
};

const extractToolCallLines = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  const toolCalls: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const block = part as ContentBlock;
    if (block.type !== "toolCall" || typeof block.name !== "string") {
      continue;
    }

    const args = block.arguments ?? {};
    const safe = redactToolArgs(args);
    const serialized = JSON.stringify(safe);
    if (serialized.length > MAX_ARGS_SERIALIZED) {
      const keys = typeof safe === "object" && safe !== null ? Object.keys(safe).length : 0;
      toolCalls.push(
        `Tool ${block.name} called with args { ${keys} keys, ${serialized.length} chars omitted }`
      );
    } else {
      toolCalls.push(`Tool ${block.name} called with args ${serialized}`);
    }
  }

  return toolCalls;
};

const buildConversationText = (entries: SessionEntry[]): string => {
  const sections: string[] = [];

  for (const entry of entries) {
    if (entry.type === "compaction" && typeof entry.summary === "string") {
      sections.push(`Earlier (compacted): ${entry.summary.trim()}`);
      continue;
    }

    if (entry.type === "custom" && entry.customType === "pi-recap") {
      continue;
    }

    if (entry.type !== "message" || !entry.message?.role) {
      continue;
    }

    const role = entry.message.role;
    const isUser = role === "user";
    const isAssistant = role === "assistant";

    if (!isUser && !isAssistant) {
      continue;
    }

    const entryLines: string[] = [];
    const textParts = extractTextParts(entry.message.content);
    if (textParts.length > 0) {
      const roleLabel = isUser ? "User" : "Assistant";
      const messageText = textParts.join("\n").trim();
      if (messageText.length > 0) {
        entryLines.push(`${roleLabel}: ${messageText}`);
      }
    }

    if (isAssistant) {
      entryLines.push(...extractToolCallLines(entry.message.content));
    }

    if (entryLines.length > 0) {
      sections.push(entryLines.join("\n"));
    }
  }

  return sections.join("\n\n");
};

const APPROX_CHARS_PER_TOKEN = 4;
const RECENT_BUDGET_TOKENS = 10_000;

const SECRET_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /apikey/i,
  /authorization/i,
  /auth/i,
  /bearer/i,
  /cookie/i,
  /session/i,
  /private[_-]?key/i,
  /credential/i,
  /passphrase/i
];

const MAX_STRING_LENGTH = 500;
const MAX_ARGS_SERIALIZED = 2000;
const MAX_REDACT_DEPTH = 4;

function redactToolArgs(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return "[max depth exceeded]";

  if (Array.isArray(value)) {
    return value.map((v) => redactToolArgs(v, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const isSecret = SECRET_KEY_PATTERNS.some((p) => p.test(key));
      if (isSecret) {
        result[key] = "[redacted]";
      } else {
        result[key] = redactToolArgs(obj[key], depth + 1);
      }
    }
    return result;
  }

  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return (
      value.slice(0, MAX_STRING_LENGTH) +
      `\u2026[truncated ${value.length - MAX_STRING_LENGTH} chars]`
    );
  }

  return value;
}

export function buildRecentConversationText(entries: SessionEntry[]): string {
  const budgetChars = RECENT_BUDGET_TOKENS * APPROX_CHARS_PER_TOKEN;
  const slices: string[] = [];
  let used = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const slice = buildConversationText([entry]);
    if (slice.length === 0) continue;

    const remaining = budgetChars - used;
    if (slice.length <= remaining) {
      used += slice.length;
      slices.unshift(slice);
    } else {
      // Tail-truncation: keep the tail, drop the head
      const truncated = "[…truncated for recap budget…]\n" + slice.slice(slice.length - remaining);
      slices.unshift(truncated);
      break;
    }
  }

  return slices.join("\n\n");
}
