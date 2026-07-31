import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { buildRecentConversationText } from "./conversation";

interface FakeEntry {
  type: string;
  message?: {
    role: string;
    content: { type: string; text: string }[];
  };
  summary?: string;
}

describe("recent conversation extraction", () => {
  test("keeps the last 20 visible messages", () => {
    const entries: FakeEntry[] = [];
    for (let index = 0; index < 50; index++) {
      entries.push({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `Question number ${index + 1}` }]
        }
      });
      entries.push({
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Answer to question number ${index + 1}. Here is a lot of padding to make this entry longer. `.repeat(
                5
              )
            }
          ]
        }
      });
    }

    const result = buildRecentConversationText(entries);
    const recentMessages = result.split("\n\n");
    assert.equal(recentMessages.length, 20);
    assert.equal(recentMessages[0], "User: Question number 41");
    assert.equal(recentMessages[1]?.startsWith("Assistant: Answer to question number 41."), true);
    assert.equal(recentMessages.at(-2), "User: Question number 50");
    assert.equal(
      recentMessages.at(-1)?.startsWith("Assistant: Answer to question number 50."),
      true
    );
    assert.equal(result.includes("User: Question number 40"), false);
  });

  test("includes the latest compaction summary before recent messages", () => {
    const entries: FakeEntry[] = [
      {
        type: "compaction",
        summary: "Earlier the user asked about setting up TypeScript and ESLint for a project."
      },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Now let's add Prettier to the project as well." }]
        }
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Sure, I'll add Prettier configuration." }]
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

    assert.equal(
      buildRecentConversationText(entries),
      [
        "Earlier (compacted): Earlier the user asked about setting up TypeScript and ESLint for a project.",
        "User: Now let's add Prettier to the project as well.",
        "Assistant: Sure, I'll add Prettier configuration.",
        "User: Also configure it to use 90 char width."
      ].join("\n\n")
    );
  });

  test("keeps one oversized recent message", () => {
    const oversizedText = "X".repeat(30_000);
    const entries: FakeEntry[] = [
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: oversizedText }]
        }
      }
    ];

    const result = buildRecentConversationText(entries);
    assert.equal(result, `User: ${oversizedText}`);
    assert.equal(result.length, 30_006);
  });
});
