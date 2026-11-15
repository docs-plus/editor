import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import {
  canMapDecorations,
  computeSection,
  filterSections,
  findAllSections,
  matchSections,
} from "@/extensions/shared";

import type { HeadingFilterFoldAdapter } from "./heading-filter";

export type HeadingFilterMeta =
  | { type: "preview"; query: string }
  | { type: "commit"; slug: string }
  | { type: "remove"; slug: string }
  | { type: "clear" }
  | { type: "setMode"; mode: "or" | "and" }
  | { type: "apply"; slugs: string[]; mode: "or" | "and" };

export interface HeadingFilterState {
  slugs: string[];
  mode: "or" | "and";
  previewQuery: string;
  matchedSectionIds: Set<string>;
  totalSections: number;
  decos: DecorationSet;
}

export interface HeadingFilterCallbackState {
  matchedSectionIds: Set<string>;
  totalSections: number;
  slugs: string[];
  mode: "or" | "and";
}

export interface HeadingFilterPluginOptions {
  onFilterChange?: (state: HeadingFilterCallbackState) => void;
  foldAdapter?: HeadingFilterFoldAdapter;
}

export const headingFilterPluginKey = new PluginKey<HeadingFilterState>(
  "headingFilter",
);

/**
 * How long after an edit that re-matched the sections (a heading renamed,
 * added or moved, often by a collaborator) the folds follow, as often as
 * the outline rebuilds.
 */
export const FILTER_REFOLD_MS = 250;

/** The sections a filter folds away: every one it does not match. */
const unmatchedSections = (doc: PMNode, matched: Set<string>) =>
  findAllSections(doc).filter((s) => !matched.has(s.id));

function buildFilterDecorations(
  doc: PMNode,
  state: Omit<HeadingFilterState, "decos">,
): DecorationSet {
  const { slugs, previewQuery } = state;

  if (slugs.length === 0 && previewQuery.length === 0)
    return DecorationSet.empty;

  const decorations: Decoration[] = [];

  const allQueries = [...slugs];
  if (previewQuery.length > 0) allQueries.push(previewQuery);

  const seenRanges = new Set<string>();

  for (const query of allQueries) {
    const sectionMatches = matchSections(doc, query);
    for (const sm of sectionMatches) {
      for (const m of sm.matches) {
        const key = `${m.from}:${m.to}`;
        if (seenRanges.has(key)) continue;
        seenRanges.add(key);

        decorations.push(
          Decoration.inline(m.from, m.to, {
            class: "heading-filter-highlight",
          }),
        );
      }
    }
  }

  return decorations.length > 0
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}

function computeNewState(
  base: Omit<
    HeadingFilterState,
    "decos" | "matchedSectionIds" | "totalSections"
  >,
  doc: PMNode,
): HeadingFilterState {
  const sections = findAllSections(doc);
  const totalSections = sections.length;

  let matchedSectionIds: Set<string>;
  if (base.previewQuery.length > 0) {
    const previewMatches = matchSections(doc, base.previewQuery);
    matchedSectionIds = new Set(previewMatches.map((sm) => sm.section.id));
  } else if (base.slugs.length > 0) {
    const { matchedIds } = filterSections(doc, base.slugs, base.mode);
    matchedSectionIds = matchedIds;
  } else {
    matchedSectionIds = new Set(sections.map((s) => s.id));
  }

  const full = { ...base, matchedSectionIds, totalSections };
  return { ...full, decos: buildFilterDecorations(doc, full) };
}

function applyMeta(
  meta: HeadingFilterMeta,
  prev: HeadingFilterState,
  doc: PMNode,
): HeadingFilterState {
  switch (meta.type) {
    case "preview":
      return computeNewState(
        { slugs: prev.slugs, mode: prev.mode, previewQuery: meta.query },
        doc,
      );

    case "commit": {
      const slug = meta.slug.trim().toLowerCase();
      if (!slug || prev.slugs.includes(slug)) return prev;
      return computeNewState(
        {
          slugs: [...prev.slugs, slug],
          mode: prev.mode,
          previewQuery: "",
        },
        doc,
      );
    }

    case "remove": {
      const filtered = prev.slugs.filter((s) => s !== meta.slug);
      if (filtered.length === prev.slugs.length) return prev;
      return computeNewState(
        { slugs: filtered, mode: prev.mode, previewQuery: prev.previewQuery },
        doc,
      );
    }

    case "clear":
      return computeNewState({ slugs: [], mode: "or", previewQuery: "" }, doc);

    case "setMode":
      if (meta.mode === prev.mode) return prev;
      return computeNewState(
        { slugs: prev.slugs, mode: meta.mode, previewQuery: prev.previewQuery },
        doc,
      );

    case "apply":
      return computeNewState(
        { slugs: meta.slugs, mode: meta.mode, previewQuery: "" },
        doc,
      );
  }
}

export function createHeadingFilterPlugin(
  options: HeadingFilterPluginOptions,
): Plugin<HeadingFilterState> {
  let prevSlugs: string[] = [];
  let prevMode: "or" | "and" = "or";
  let prevMatchedIds: Set<string> = new Set();
  let savedFoldIds: Set<string> | null = null;
  // The sections this filter last folded away (or left open for the caret).
  let filterFolds = new Set<string>();

  return new Plugin<HeadingFilterState>({
    key: headingFilterPluginKey,

    state: {
      init(_, { doc }): HeadingFilterState {
        const sections = findAllSections(doc);
        return {
          slugs: [],
          mode: "or",
          previewQuery: "",
          matchedSectionIds: new Set(sections.map((s) => s.id)),
          totalSections: sections.length,
          decos: DecorationSet.empty,
        };
      },

      apply(tr, prev): HeadingFilterState {
        const meta = tr.getMeta(headingFilterPluginKey) as
          | HeadingFilterMeta
          | undefined;

        if (meta) {
          return applyMeta(meta, prev, tr.doc);
        }

        if (!tr.docChanged) return prev;

        const isActive = prev.slugs.length > 0 || prev.previewQuery.length > 0;

        if (canMapDecorations(tr, tr.before)) {
          if (!isActive) return prev;
          return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) };
        }

        if (!isActive) {
          const sections = findAllSections(tr.doc);
          return {
            ...prev,
            matchedSectionIds: new Set(sections.map((s) => s.id)),
            totalSections: sections.length,
          };
        }

        return computeNewState(
          {
            slugs: prev.slugs,
            mode: prev.mode,
            previewQuery: prev.previewQuery,
          },
          tr.doc,
        );
      },
    },

    props: {
      decorations(state) {
        return (
          headingFilterPluginKey.getState(state)?.decos ?? DecorationSet.empty
        );
      },
    },

    view(view) {
      let refoldTimer: ReturnType<typeof setTimeout> | undefined;

      // Moves only the folds whose section changed sides since the filter
      // last folded, so the reader's own folds and unfolds stay; a section
      // holding the caret is never folded under it.
      const refold = () => {
        refoldTimer = undefined;
        const filter = headingFilterPluginKey.getState(view.state);
        const adapter = options.foldAdapter;
        if (!adapter || !filter?.slugs.length || filter.previewQuery) return;

        const { doc, selection } = view.state;
        const folds = new Set(adapter.getFoldedIds(view.state));
        const before = filterFolds;
        let changed = false;
        filterFolds = new Set();
        for (const { id, pos, level } of unmatchedSections(
          doc,
          filter.matchedSectionIds,
        )) {
          filterFolds.add(id);
          if (
            before.has(id) ||
            folds.has(id) ||
            (selection.head >= pos &&
              selection.head < computeSection(doc, pos, level).to)
          )
            continue;
          folds.add(id);
          changed = true;
        }
        for (const id of before) {
          if (!filterFolds.has(id) && folds.delete(id)) changed = true;
        }
        if (changed)
          view.dispatch(adapter.setTemporaryFolds(view.state.tr, folds));
      };

      return {
        update(view) {
          const current = headingFilterPluginKey.getState(view.state);
          if (!current) return;

          if (
            current.slugs.length === 0 &&
            prevSlugs.length === 0 &&
            !current.previewQuery
          ) {
            return;
          }

          const slugsChanged =
            current.slugs.length !== prevSlugs.length ||
            current.slugs.some((s, i) => s !== prevSlugs[i]);

          const modeChanged = current.mode !== prevMode;

          let matchedIdsChanged =
            current.matchedSectionIds.size !== prevMatchedIds.size;
          if (!matchedIdsChanged) {
            for (const id of current.matchedSectionIds) {
              if (!prevMatchedIds.has(id)) {
                matchedIdsChanged = true;
                break;
              }
            }
          }

          if (slugsChanged || modeChanged || matchedIdsChanged) {
            options.onFilterChange?.({
              matchedSectionIds: current.matchedSectionIds,
              totalSections: current.totalSections,
              slugs: current.slugs,
              mode: current.mode,
            });
          }

          const hadFilters = prevSlugs.length > 0;
          const hasFilters = current.slugs.length > 0;

          // A new set means the state re-matched the sections: a heading's
          // text or the structure changed (a mapped edit keeps the set).
          const rematched = current.matchedSectionIds !== prevMatchedIds;
          if (slugsChanged) prevSlugs = [...current.slugs];
          if (modeChanged) prevMode = current.mode;
          prevMatchedIds = current.matchedSectionIds;

          // After a change of words or mode too: by then the folds below
          // match, so it finds nothing to move.
          if (hasFilters && rematched) {
            refoldTimer ??= setTimeout(refold, FILTER_REFOLD_MS);
          }

          if (options.foldAdapter && (slugsChanged || modeChanged)) {
            try {
              if (!hadFilters && hasFilters) {
                savedFoldIds = new Set(
                  options.foldAdapter.getFoldedIds(view.state),
                );
              }

              if (hasFilters) {
                filterFolds = new Set(
                  unmatchedSections(
                    view.state.doc,
                    current.matchedSectionIds,
                  ).map((s) => s.id),
                );

                const tr = options.foldAdapter.setTemporaryFolds(
                  view.state.tr,
                  filterFolds,
                );
                view.dispatch(tr);
              } else if (hadFilters && !hasFilters) {
                const tr = options.foldAdapter.restoreFolds(
                  view.state.tr,
                  savedFoldIds ?? new Set<string>(),
                );
                view.dispatch(tr);
                savedFoldIds = null;
              }
            } catch {
              /* adapter error — degrade gracefully */
            }
          }

          if (
            options.foldAdapter &&
            slugsChanged &&
            hasFilters &&
            current.matchedSectionIds.size > 0
          ) {
            const { doc, selection } = view.state;
            const cursorPos = selection.$head.pos;
            let cursorInFolded = false;
            let offset = 0;

            for (let i = 0; i < doc.content.childCount; i++) {
              const child = doc.content.child(i);
              offset += child.nodeSize;

              if (i === 0) continue;
              if (child.type.name !== "heading") continue;

              const tocId = child.attrs["data-toc-id"] as string;
              if (!tocId || current.matchedSectionIds.has(tocId)) continue;

              if (cursorPos >= offset - child.nodeSize && cursorPos < offset) {
                cursorInFolded = true;
                break;
              }
            }

            if (cursorInFolded) {
              const $pos = doc.resolve(1);
              const tr = view.state.tr.setSelection(TextSelection.near($pos));
              view.dispatch(tr.scrollIntoView());
            }
          }
        },

        destroy() {
          clearTimeout(refoldTimer);
          prevSlugs = [];
          prevMode = "or";
          prevMatchedIds = new Set();
          savedFoldIds = null;
        },
      };
    },
  });
}
