import assert from "node:assert/strict";
import { enforceWordLimit, normalizeRecapText } from "../src/generate";

assert.equal(normalizeRecapText("  Recap:   Work continues.  "), "Work continues.");
assert.equal(normalizeRecapText("\nRECAP:\n\tDone.\n"), "Done.");
assert.equal(normalizeRecapText("  Ordinary text  "), "Ordinary text");
assert.equal(normalizeRecapText("First line\nsecond\tthird"), "First line second third");
assert.equal(normalizeRecapText("first\rsecond\vthird\ffourth"), "first second third fourth");
const escaped = normalizeRecapText("\x1b[31malert\x1b[0m");
assert.equal(escaped, "alert");
assert.equal(/[\x00-\x1f\x7f-\x9f]/.test(escaped), false);
assert.equal(normalizeRecapText("\x1b]0;window title\x07alert"), "alert");
for (const control of ["\u0090", "\u009c", "\u009d", "\u009f", "\u2028", "\u2029"]) {
  assert.equal(normalizeRecapText(control), "");
}
assert.equal(normalizeRecapText("first\u2028second\u2029third"), "first second third");
assert.equal(normalizeRecapText("  "), "");

assert.equal(
  enforceWordLimit("One complete sentence. Two more words follow here.", 4),
  "One complete sentence.…"
);
assert.equal(enforceWordLimit("one two three four five", 3), "one two three…");
assert.equal(enforceWordLimit("one two three", 3), "one two three");
assert.equal(enforceWordLimit("  one two three  ", 3), "one two three");
assert.equal(enforceWordLimit("", 1), "");
assert.equal(enforceWordLimit("single", 1), "single");
assert.equal(enforceWordLimit("single overflow", 1), "single…");

const ellipsisResult = enforceWordLimit("one two three four", 3);
assert.equal(ellipsisResult.split(/\s+/).length, 3);
assert.equal(ellipsisResult.endsWith("three…"), true);

assert.equal(
  enforceWordLimit("Version 0.5.0 is ready. Extra details follow now.", 4),
  "Version 0.5.0 is ready.…"
);
assert.equal(
  enforceWordLimit("Is this complete?! Yes it is. Extra words remain.", 4),
  "Is this complete?!…"
);
assert.equal(
  enforceWordLimit("No terminators exist in this longer text", 4),
  "No terminators exist in…"
);

console.log("test-trim: passed");
