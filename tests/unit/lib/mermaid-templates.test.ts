import { describe, expect, it } from "bun:test";

import {
  isMermaidTemplateId,
  lastMermaidTemplate,
  MERMAID_TEMPLATE_CHOICE,
  MERMAID_TEMPLATES,
  rememberMermaidTemplate,
  usedMermaidTemplate,
} from "@/lib/mermaid-templates";
import { forgetChoices } from "@/lib/remembered-choice";

const KEYWORDS: Record<string, string> = {
  flowchart: "flowchart",
  sequence: "sequenceDiagram",
  state: "stateDiagram-v2",
  mindmap: "mindmap",
  pie: "pie",
};

describe("mermaid templates", () => {
  it("has five unique ids in order", () => {
    expect(MERMAID_TEMPLATES.map((t) => t.id)).toEqual([
      "flowchart",
      "sequence",
      "state",
      "mindmap",
      "pie",
    ]);
  });

  it("starts each source with its diagram keyword and stays small", () => {
    for (const template of MERMAID_TEMPLATES) {
      expect(template.source.startsWith(KEYWORDS[template.id])).toBe(true);
      expect(template.source.length).toBeLessThan(1000);
    }
  });

  it("rejects unknown ids so a tampered choice falls back", () => {
    expect(isMermaidTemplateId("evil")).toBe(false);
    expect(isMermaidTemplateId("pie")).toBe(true);
    expect(MERMAID_TEMPLATE_CHOICE.validate("evil")).toBe(false);
    expect(MERMAID_TEMPLATE_CHOICE.fallback).toBe("flowchart");
  });

  it("remembers the last template in the page", () => {
    rememberMermaidTemplate("sequence");
    expect(lastMermaidTemplate()).toBe("sequence");
  });

  it("reports a used template only after a real use (no Last used on a fresh profile)", () => {
    forgetChoices();
    expect(usedMermaidTemplate()).toBeNull();
    expect(lastMermaidTemplate()).toBe("flowchart");
    rememberMermaidTemplate("pie");
    expect(usedMermaidTemplate()).toBe("pie");
    forgetChoices();
    expect(usedMermaidTemplate()).toBeNull();
  });
});
