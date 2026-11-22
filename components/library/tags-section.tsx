"use client";

/**
 * The sidebar's Tags section (details spec §3, D7; UX §4.5): after the
 * Library tree, collapsed by default, no counts, hidden while there are no
 * tags. A tag opens the list of its documents; F2 or the row menu renames
 * it everywhere, and a name another tag has asks to merge them.
 */
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";

import { ChevronRightIcon, TagIcon } from "@/lib/icons";
import { isContextMenuKey, openTarget } from "@/lib/library/library-keys";
import { cleanTagName, TAG_NAME_MAX } from "@/lib/library/tag-rules";
import { nameCollator } from "@/lib/library/tree-rows";
import type { TagEntry } from "@/lib/platform/document-index";
import { isMac } from "@/lib/shortcuts";

import { EntryMenu, type MenuAnchor } from "./item-menu";
import { type LibraryPlace, useLibrary } from "./library-context";

function focusTagRow(id: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`[data-tag-row="${CSS.escape(id)}"]`)
      ?.focus();
  });
}

function TagRenameField({ tag }: { tag: TagEntry }) {
  const { actions } = useLibrary();
  const [value, setValue] = useState(tag.name);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    actions.stopTagRename();
    if (commit && cleanTagName(value)) actions.renameTag(tag.id, value);
    focusTagRow(tag.id);
  };

  return (
    <span className="lib-rename">
      <input
        ref={input}
        className="lib-rename-input"
        value={value}
        dir="auto"
        aria-label="Tag name"
        maxLength={TAG_NAME_MAX}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    </span>
  );
}

function TagRow({ tag, current }: { tag: TagEntry; current: boolean }) {
  const { actions, renamingTag } = useLibrary();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const place: LibraryPlace = { kind: "tag", id: tag.id };

  if (renamingTag === tag.id) {
    return (
      <li className="lib-item lib-item-sub">
        <TagIcon aria-hidden="true" />
        <TagRenameField tag={tag} />
      </li>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "F2") {
      event.preventDefault();
      actions.startTagRename(tag.id);
    } else if (isContextMenuKey(event)) {
      event.preventDefault();
      setMenu(event.currentTarget);
    }
  };
  return (
    <li>
      <button
        type="button"
        className="lib-item lib-item-sub"
        data-tag-row={tag.id}
        aria-current={current ? "page" : undefined}
        title={tag.name}
        onClick={(event) =>
          actions.openPlace(place, openTarget(event, isMac()))
        }
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={onKeyDown}
      >
        <TagIcon aria-hidden="true" />
        <span className="lib-label">
          <bdi dir="auto">{tag.name}</bdi>
        </span>
      </button>
      {menu ? (
        <EntryMenu
          anchor={menu}
          entries={[
            {
              id: "open",
              label: "Show Documents",
              run: () => actions.openPlace(place),
            },
            {
              id: "rename",
              label: "Rename…",
              shortcut: "F2",
              run: () => actions.startTagRename(tag.id),
            },
          ]}
          movesFocus={(entry) => entry.id === "rename"}
          onClose={(keepFocus) => {
            setMenu(null);
            if (!keepFocus) focusTagRow(tag.id);
          }}
        />
      ) : null}
    </li>
  );
}

export function TagsSection({
  currentPlace,
}: {
  currentPlace: LibraryPlace | null;
}) {
  const { snapshot, tagsOpen, actions } = useLibrary();
  if (snapshot.tags.length === 0) return null;
  const tags = [...snapshot.tags].sort((a, b) =>
    nameCollator.compare(a.name, b.name),
  );
  return (
    <>
      <div className="lib-sep" role="separator" />
      <button
        type="button"
        className="lib-item lib-section-toggle"
        aria-expanded={tagsOpen}
        aria-controls="lib-tags"
        onClick={() => actions.toggleTags()}
      >
        <span className="lib-chevron" aria-hidden="true">
          <ChevronRightIcon />
        </span>
        <span className="lib-label">Tags</span>
      </button>
      {tagsOpen ? (
        <ul id="lib-tags" className="lib-sub" aria-label="Tags">
          {tags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              current={
                currentPlace?.kind === "tag" && currentPlace.id === tag.id
              }
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
