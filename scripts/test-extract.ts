import assert from "node:assert/strict";
import { buildRecentConversationText } from "../src/conversation";

interface FakeEntry {
  type: string;
  message?: {
    role: string;
    content: { type: string; text: string }[];
  };
  summary?: string;
}

// Case 1: 50 turns of plain user/assistant, last 20 visible messages survive
const case1: FakeEntry[] = [];
for (let i = 0; i < 50; i++) {
  case1.push({
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text: `Question number ${i + 1}` }]
    }
  });
  case1.push({
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Answer to question number ${i + 1}. Here is a lot of padding to make this entry longer. `.repeat(
            5
          )
        }
      ]
    }
  });
}

const result1 = buildRecentConversationText(case1);
const recentMessages = result1.split("\n\n");
assert.equal(recentMessages.length, 20);
assert.equal(recentMessages[0], "User: Question number 41");
assert.equal(recentMessages[1]?.startsWith("Assistant: Answer to question number 41."), true);
assert.equal(recentMessages.at(-2), "User: Question number 50");
assert.equal(recentMessages.at(-1)?.startsWith("Assistant: Answer to question number 50."), true);
assert.equal(result1.includes("User: Question number 40"), false);

// Case 2: CompactionEntry followed by 3 messages
const case2: FakeEntry[] = [
  {
    type: "compaction",
    summary: "Earlier the user asked about setting up TypeScript and ESLint for a project."
  },
  {
    type: "message",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "Now let's add Prettier to the project as well."
        }
      ]
    }
  },
  {
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Sure, I'll add Prettier configuration."
        }
      ]
    }
  },
  {
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text: "Also configure it to use 90 char width." }]
    }
  }
];

const result2 = buildRecentConversationText(case2);
assert.equal(
  result2,
  [
    "Earlier (compacted): Earlier the user asked about setting up TypeScript and ESLint for a project.",
    "User: Now let's add Prettier to the project as well.",
    "Assistant: Sure, I'll add Prettier configuration.",
    "User: Also configure it to use 90 char width."
  ].join("\n\n")
);

// Case 3: Single oversized message is kept because recency is message-count based
const oversizedText = "X".repeat(30_000);
const case3: FakeEntry[] = [
  {
    type: "message",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: oversizedText
        }
      ]
    }
  }
];

const result3 = buildRecentConversationText(case3);
assert.equal(result3, `User: ${oversizedText}`);
assert.equal(result3.length, 30_006);

console.log("test-extract: passed");
