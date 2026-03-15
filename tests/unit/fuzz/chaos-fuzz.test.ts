import { describe, it } from "vitest";
import {
  assertFirstNodeIsH1,
  assertValidSchema,
} from "@/tests/helpers/assert-invariants";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

describe("chaos fuzz: malformed inputs", () => {
  it("survives 5000 chaotic operations without crashing", () => {
    for (let i = 0; i < 500; i++) {
      const editor = createTestEditor();

      for (let op = 0; op < 10; op++) {
        const action = Math.floor(Math.random() * 6);

        try {
          switch (action) {
            case 0: {
              // Insert random string including special chars
              const chars = "abc123!@#$%^&*()_+<>\"'`~\n\t\r\0";
              const len = Math.floor(Math.random() * 50) + 1;
              let text = "";
              for (let c = 0; c < len; c++) {
                text += chars[Math.floor(Math.random() * chars.length)];
              }
              editor.commands.insertContent(text);
              break;
            }
            case 1: {
              // Insert emoji/unicode
              const emojis = [
                "😀",
                "🎉",
                "🔥",
                "💯",
                "🚀",
                "\u200B",
                "\uFEFF",
                "\u00A0",
              ];
              const emoji = emojis[Math.floor(Math.random() * emojis.length)];
              editor.commands.insertContent(emoji);
              break;
            }
            case 2: {
              // Select all + delete
              editor.commands.selectAll();
              editor.commands.deleteSelection();
              break;
            }
            case 3: {
              // Insert very long text
              const longText = "A".repeat(
                Math.floor(Math.random() * 5000) + 1000,
              );
              editor.commands.insertContent(longText);
              break;
            }
            case 4: {
              // Rapid sequential transactions
              for (let r = 0; r < 5; r++) {
                editor.commands.insertContent("x");
              }
              break;
            }
            case 5: {
              // Insert content as JSON with random structure
              editor.commands.insertContent({
                type: "paragraph",
                content: [{ type: "text", text: `chaos-${i}-${op}` }],
              });
              break;
            }
          }
        } catch {
          // Errors are fine — we just need to not crash
        }

        // Must ALWAYS hold: first node is H1, schema is valid
        assertFirstNodeIsH1(editor.state.doc);
        assertValidSchema(editor.state.doc);
      }

      editor.destroy();
    }
  }, 60000);
});
