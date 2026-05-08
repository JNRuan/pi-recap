import { buildRecentConversationText } from "../src/conversation";

interface FakeEntry {
  type: string;
  message?: {
    role: string;
    content: { type: string; text: string }[];
  };
  summary?: string;
}

// Case 1: 50 turns of plain user/assistant → recent-only survives
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

console.log("=== CASE 1: 50 turns (recent-only) ===");
const result1 = buildRecentConversationText(case1);
console.log(result1);
console.log(`\nLength: ${result1.length} chars`);

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

console.log("\n\n=== CASE 2: Compaction + recent messages ===");
const result2 = buildRecentConversationText(case2);
console.log(result2);

// Case 3: Single oversized message → kept on its own, exceeds budget
const case3: FakeEntry[] = [
  {
    type: "message",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "X".repeat(30_000)
        }
      ]
    }
  }
];

console.log("\n\n=== CASE 3: Oversized single message ===");
const result3 = buildRecentConversationText(case3);
console.log(result3);
console.log(`\nLength: ${result3.length} chars (exceeds 24000 budget)`);
