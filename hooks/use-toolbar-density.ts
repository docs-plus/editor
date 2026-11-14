"use client";

import { useSyncExternalStore } from "react";

import {
  readChoice,
  subscribeChoices,
  TOOLBAR_DENSITY_CHOICE,
  type ToolbarDensity,
} from "@/lib/remembered-choice";

const readDensity = (): ToolbarDensity =>
  readChoice(TOOLBAR_DENSITY_CHOICE).last;
const serverDensity = (): ToolbarDensity => "full";

/**
 * The remembered toolbar density (A15). Unlike `useRememberedChoice`, it
 * reads storage on the first client render: the editor never hydrates
 * (`ssr: false`), and a "ready" effect would paint the full row for a
 * frame before collapsing it. The constant server snapshot keeps it
 * hydration-safe if that ever changes. Re-renders only when the value does.
 */
export function useToolbarDensity(): ToolbarDensity {
  return useSyncExternalStore(subscribeChoices, readDensity, serverDensity);
}
