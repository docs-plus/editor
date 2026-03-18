"use client";

import type { KeyboardEvent } from "react";

import type { UseHeadingFilterReturn } from "@/components/tiptap-ui/heading-filter/use-heading-filter";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { CloseIcon, FilterIcon, SearchIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type FilterBarProps = UseHeadingFilterReturn;

export function FilterBar({
  isBarOpen,
  query,
  setQuery,
  filterState,
  hasActiveFilters,
  commitFilter,
  removeFilter,
  clearAllFilters,
  setMode,
  closeBar,
  inputRef,
}: FilterBarProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        commitFilter();
        return;
      case "Escape":
        e.preventDefault();
        closeBar();
        return;
      default:
        return;
    }
  };
  const isAnd = filterState.mode === "and";

  if (!isBarOpen && !hasActiveFilters) return null;

  return (
    <div
      className="sticky z-9 h-0 overflow-visible pointer-events-none"
      style={{ top: "var(--tt-toolbar-height, 44px)" }}
    >
      <div
        className={cn(
          "absolute top-2 right-4 pointer-events-auto flex border border-border rounded-lg bg-background shadow-sm overflow-hidden",
          isBarOpen ? "min-w-72 max-w-96 flex-col" : "flex-row items-center",
        )}
        role="search"
        aria-label="Document filter"
      >
        {isBarOpen && (
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            <SearchIcon className="shrink-0 size-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              className="flex-1 min-w-0 h-6 border-none bg-transparent text-[0.8125rem] text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Find in document..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Filter term"
            />
            <span
              role="status"
              className="shrink-0 px-1 rounded-sm text-[0.6875rem] tabular-nums text-muted-foreground whitespace-nowrap"
              aria-live="polite"
              aria-label={`${filterState.matchedSectionIds.size} of ${filterState.totalSections} sections match`}
            >
              {filterState.matchedSectionIds.size}/{filterState.totalSections}
            </span>
            <button
              type="button"
              className="flex items-center justify-center size-5.5 shrink-0 border-none rounded bg-transparent text-muted-foreground cursor-pointer transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-3"
              onClick={closeBar}
              aria-label="Close filter"
            >
              <CloseIcon />
            </button>
          </div>
        )}

        {hasActiveFilters && (
          <div
            className={cn(
              "flex items-center gap-1 flex-wrap px-2",
              isBarOpen ? "py-1.5 border-t border-border" : "py-1",
            )}
          >
            {filterState.slugs.map((slug) => (
              <span
                key={slug}
                className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded bg-secondary text-[0.6875rem] font-medium text-secondary-foreground whitespace-nowrap"
              >
                {slug}
                <button
                  type="button"
                  className="inline-flex items-center justify-center size-3 p-0 border-none rounded-full bg-transparent text-muted-foreground cursor-pointer transition-colors hover:text-foreground [&_svg]:size-2"
                  onClick={() => removeFilter(slug)}
                  aria-label={`Remove filter: ${slug}`}
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
            <button
              type="button"
              className={cn(
                "inline-flex items-center h-5 px-1 border rounded text-[0.5625rem] font-semibold uppercase tracking-wider cursor-pointer transition-colors",
                isAnd
                  ? "text-primary border-primary"
                  : "text-muted-foreground border-border hover:text-foreground hover:border-foreground",
              )}
              onClick={() => setMode(isAnd ? "or" : "and")}
              aria-label={`Filter mode: ${isAnd ? "match all" : "match any"}`}
              aria-pressed={isAnd}
            >
              {isAnd ? "ALL" : "ANY"}
            </button>
            <button
              type="button"
              className="ml-auto inline-flex items-center h-5 px-1 border-none rounded bg-transparent text-[0.6875rem] text-muted-foreground cursor-pointer transition-colors hover:text-foreground"
              onClick={clearAllFilters}
              aria-label="Clear all filters"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface FilterToolbarButtonProps {
  onClick: () => void;
  isActive: boolean;
}

export function FilterToolbarButton({
  onClick,
  isActive,
}: FilterToolbarButtonProps) {
  return (
    <ToolbarButton
      onClick={onClick}
      tooltip="Filter document"
      shortcutKeys="mod+shift+f"
      isActive={isActive}
      aria-label="Toggle document filter"
    >
      <FilterIcon />
    </ToolbarButton>
  );
}
