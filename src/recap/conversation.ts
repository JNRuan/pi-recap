interface ContentBlock {
  type?: string;
  text?: string;
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

interface ConversationSlice {
  text: string;
  countsAsMessage: boolean;
}

const buildConversationSlice = (entry: SessionEntry): ConversationSlice | null => {
  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return {
      text: `Earlier (compacted): ${entry.summary.trim()}`,
      countsAsMessage: false
    };
  }

  if (entry.type === "custom" && entry.customType === "pi-recap") {
    return null;
  }

  if (entry.type !== "message" || !entry.message?.role) {
    return null;
  }

  const role = entry.message.role;
  const isUser = role === "user";
  const isAssistant = role === "assistant";

  if (!isUser && !isAssistant) {
    return null;
  }

  const textParts = extractTextParts(entry.message.content);
  if (textParts.length === 0) {
    return null;
  }

  const messageText = textParts.join("\n").trim();
  if (messageText.length === 0) {
    return null;
  }

  const roleLabel = isUser ? "User" : "Assistant";
  return {
    text: `${roleLabel}: ${messageText}`,
    countsAsMessage: true
  };
};

export function buildRecentConversationText(
  entries: SessionEntry[],
  recentMessageLimit = 20
): string {
  const messageLimit = Math.max(1, Math.floor(recentMessageLimit));
  const slices: string[] = [];
  let messageCount = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    if (messageCount >= messageLimit) break;

    const slice = buildConversationSlice(entries[i]);
    if (!slice) continue;

    slices.unshift(slice.text);
    if (slice.countsAsMessage) {
      messageCount++;
    }
  }

  return slices.join("\n\n");
}
