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
    toolCalls.push(`Tool ${block.name} was called with args ${JSON.stringify(args)}`);
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
const RECENT_BUDGET_TOKENS = 6_000;

export function buildRecentConversationText(entries: SessionEntry[]): string {
  const budgetChars = RECENT_BUDGET_TOKENS * APPROX_CHARS_PER_TOKEN;
  const kept: SessionEntry[] = [];
  let used = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const slice = buildConversationText([entry]);
    if (slice.length === 0) continue;
    used += slice.length;
    kept.unshift(entry);
    if (used >= budgetChars) break;
  }

  return buildConversationText(kept);
}
