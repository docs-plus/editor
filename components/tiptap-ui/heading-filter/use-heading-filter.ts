"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HeadingFilterCallbackState } from "@/components/tiptap-node/heading-node/heading-filter-plugin";
import { updateFilterUrl } from "@/components/tiptap-node/heading-node/helpers/filter-url";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

const DEBOUNCE_MS = 250;

interface UseHeadingFilterOptions {
  editor?: Editor | null;
  filterState: HeadingFilterCallbackState;
}

export interface UseHeadingFilterReturn {
  isBarOpen: boolean;
  openBar: () => void;
  closeBar: () => void;
  toggleBar: () => void;

  query: string;
  setQuery: (q: string) => void;

  filterState: HeadingFilterCallbackState;
  hasActiveFilters: boolean;

  commitFilter: () => void;
  removeFilter: (slug: string) => void;
  clearAllFilters: () => void;
  setMode: (mode: "or" | "and") => void;

  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function useHeadingFilter({
  editor: providedEditor,
  filterState,
}: UseHeadingFilterOptions): UseHeadingFilterReturn {
  const { editor } = useTiptapEditor(providedEditor);
  const [isBarOpen, setIsBarOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        editor?.commands.filterPreview(q);
      }, DEBOUNCE_MS);
    },
    [editor],
  );

  const openBar = useCallback(() => {
    setIsBarOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeBar = useCallback(() => {
    setIsBarOpen(false);
    editor?.commands.filterPreview("");
    setQueryState("");
    editor?.commands.focus();
  }, [editor]);

  const toggleBar = useCallback(() => {
    if (isBarOpen) {
      closeBar();
    } else {
      openBar();
    }
  }, [isBarOpen, openBar, closeBar]);

  const commitFilter = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    editor?.commands.commitFilter(trimmed);
    setQueryState("");
  }, [editor, query]);

  const removeFilter = useCallback(
    (slug: string) => {
      editor?.commands.removeFilter(slug);
    },
    [editor],
  );

  const clearAllFilters = useCallback(() => {
    editor?.commands.clearFilter();
    setQueryState("");
    updateFilterUrl([], "or");
  }, [editor]);

  const setMode = useCallback(
    (mode: "or" | "and") => {
      editor?.commands.setFilterMode(mode);
    },
    [editor],
  );

  useEffect(() => {
    updateFilterUrl(filterState.slugs, filterState.mode);
  }, [filterState.slugs, filterState.mode]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      updateFilterUrl([], "or");
    };
  }, []);

  const hasActiveFilters = filterState.slugs.length > 0;

  return {
    isBarOpen,
    openBar,
    closeBar,
    toggleBar,
    query,
    setQuery,
    filterState,
    hasActiveFilters,
    commitFilter,
    removeFilter,
    clearAllFilters,
    setMode,
    inputRef,
  };
}
