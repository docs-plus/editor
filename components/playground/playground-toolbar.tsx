"use client";

import { useCurrentEditor } from "@tiptap/react";
import { useState } from "react";
import { scenarios } from "@/components/playground/playground-scenarios";
import {
  ChevronDownIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
} from "@/components/tiptap-icons";
import "@/components/playground/playground-toolbar.scss";

export function PlaygroundToolbar() {
  const { editor } = useCurrentEditor();
  const [activeId, setActiveId] = useState(scenarios[0]?.id ?? "");
  const [open, setOpen] = useState(false);

  const active = scenarios.find((s) => s.id === activeId) ?? scenarios[0];

  function handleSelect(id: string) {
    setActiveId(id);
    setOpen(false);
    const scenario = scenarios.find((s) => s.id === id);
    if (scenario && editor) {
      editor.commands.setContent(scenario.generate());
    }
  }

  function handleRegenerate() {
    if (active && editor) {
      editor.commands.setContent(active.generate());
    }
  }

  return (
    <div className="pg-bar">
      <div className="pg-bar-left">
        <FlaskConicalIcon size={14} className="pg-bar-icon" />

        {scenarios.length > 1 ? (
          <div className="pg-bar-dropdown">
            <button
              type="button"
              className="pg-bar-trigger"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="listbox"
            >
              <span className="pg-bar-label">{active?.label}</span>
              <ChevronDownIcon size={12} className="pg-bar-chevron" />
            </button>

            {open && (
              <>
                <div
                  className="pg-bar-backdrop"
                  onClick={() => setOpen(false)}
                  onKeyDown={() => {}}
                  role="none"
                />
                <div className="pg-bar-menu" role="listbox">
                  {scenarios.map((s) => (
                    <div
                      key={s.id}
                      role="option"
                      aria-selected={s.id === activeId}
                      className={`pg-bar-option ${s.id === activeId ? "pg-bar-option--active" : ""}`}
                      onClick={() => handleSelect(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSelect(s.id);
                      }}
                      tabIndex={0}
                    >
                      {s.label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="pg-bar-label">{active?.label}</span>
        )}
      </div>

      <button
        type="button"
        className="pg-bar-action"
        onClick={handleRegenerate}
        aria-label="Regenerate content"
        title="Regenerate content"
      >
        <RefreshCwIcon size={13} />
      </button>
    </div>
  );
}
