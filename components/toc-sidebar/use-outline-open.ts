"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  OUTLINE_OPEN_CHOICE,
  readChoice,
  rememberChoice,
} from "@/lib/remembered-choice";

export type SetOutlineOpen = (
  next: boolean | ((open: boolean) => boolean),
) => void;

/**
 * M6: the outline's open state, remembered under `tinydocy-ui` (Forget
 * keeps it). Starts open on the server and the first client render, then
 * reads storage in an effect, so hydration always matches. The setter is
 * the shell's one memory writer for this slot (contract §6, exception 1)
 * and keeps the pinned `setOutlineOpen` signature (contract §5.2).
 */
export function useOutlineOpen(): [boolean, SetOutlineOpen] {
  const [open, setOpen] = useState(OUTLINE_OPEN_CHOICE.fallback);
  const openRef = useRef(open);

  useEffect(() => {
    const stored = readChoice(OUTLINE_OPEN_CHOICE).last;
    openRef.current = stored;
    setOpen(stored);
  }, []);

  const setOutlineOpen = useCallback<SetOutlineOpen>((next) => {
    const value = typeof next === "function" ? next(openRef.current) : next;
    openRef.current = value;
    setOpen(value);
    rememberChoice(OUTLINE_OPEN_CHOICE, value);
  }, []);

  return [open, setOutlineOpen];
}
