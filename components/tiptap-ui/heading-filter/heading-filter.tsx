"use client";

import type { KeyboardEvent } from "react";

import type { UseHeadingFilterReturn } from "@/components/tiptap-ui/heading-filter/use-heading-filter";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { CloseIcon, FilterIcon, SearchIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

import "@/components/tiptap-ui/heading-filter/heading-filter.scss";

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
    if (e.key === "Enter") {
      e.preventDefault();
      commitFilter();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeBar();
    }
  };

  if (!isBarOpen && !hasActiveFilters) return null;

  return (
    <div className="filter-panel-anchor">
      <div
        className={cn("filter-panel", !isBarOpen && "filter-panel--collapsed")}
        role="search"
        aria-label="Document filter"
      >
        {isBarOpen && (
          <div className="filter-panel-row">
            <SearchIcon className="filter-panel-icon" />
            <input
              ref={inputRef}
              type="text"
              className="filter-panel-input"
              placeholder="Find in document..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Filter term"
            />
            <span
              role="status"
              className="filter-panel-count"
              aria-live="polite"
              aria-label={`${filterState.matchedSectionIds.size} of ${filterState.totalSections} sections match`}
            >
              {filterState.matchedSectionIds.size}/{filterState.totalSections}
            </span>
            <button
              type="button"
              className="filter-panel-close"
              onClick={closeBar}
              aria-label="Close filter"
            >
              <CloseIcon />
            </button>
          </div>
        )}

        {hasActiveFilters && (
          <div className="filter-panel-tags">
            {filterState.slugs.map((slug) => (
              <span key={slug} className="filter-chip">
                {slug}
                <button
                  type="button"
                  className="filter-chip-remove"
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
                "filter-panel-mode",
                filterState.mode === "and" && "filter-panel-mode--active",
              )}
              onClick={() => setMode(filterState.mode === "or" ? "and" : "or")}
              aria-label={`Filter mode: ${filterState.mode === "or" ? "match any" : "match all"}`}
              aria-pressed={filterState.mode === "and"}
            >
              {filterState.mode === "or" ? "ANY" : "ALL"}
            </button>
            <button
              type="button"
              className="filter-panel-clear"
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
