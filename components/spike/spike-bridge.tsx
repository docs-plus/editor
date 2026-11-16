"use client";

import { useEffect } from "react";

/** Spike S1 only: bridges desktop menu intents to the editor. */
interface SpikeBridgeApi {
  onMenuIntent(listener: (intent: string) => void): () => void;
  setHistory(canUndo: boolean, canRedo: boolean): void;
}

declare global {
  interface Window {
    tinydocySpike?: SpikeBridgeApi;
    __spikeIntentCount?: Record<string, number>;
  }
}

export function SpikeBridge() {
  useEffect(() => {
    const bridge = window.tinydocySpike;
    if (!bridge) return;
    window.__spikeIntentCount = {};
    const off = bridge.onMenuIntent((intent) => {
      const counts = window.__spikeIntentCount ?? {};
      counts[intent] = (counts[intent] ?? 0) + 1;
      window.__spikeIntentCount = counts;
      const editor = window.__tiptap_editor;
      if (!editor) return;
      const chain = editor.chain().focus();
      if (intent === "undo") chain.undo().run();
      else if (intent === "redo") chain.redo().run();
      else if (intent === "bold") chain.toggleBold().run();
    });
    let detach: (() => void) | undefined;
    const timer = setInterval(() => {
      const editor = window.__tiptap_editor;
      if (!editor) return;
      clearInterval(timer);
      const report = () =>
        bridge.setHistory(editor.can().undo(), editor.can().redo());
      editor.on("transaction", report);
      report();
      detach = () => editor.off("transaction", report);
    }, 250);
    return () => {
      off();
      clearInterval(timer);
      detach?.();
    };
  }, []);
  return null;
}
