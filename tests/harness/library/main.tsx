/**
 * The library harness page: the shared files sidebar, list views, Quick
 * Open and Move to… on a `MemoryDocumentIndex`, with a stand-in tab row and
 * document so F6 has regions to cycle. Query parameters:
 * - `dir=rtl`: a right-to-left interface;
 * - `theme=dark`;
 * - `seed=empty`: a library with no documents;
 * - `seed=1000` (any number): that many generated documents in `f-big`,
 *   with tags, snippets and dates, for the list speed targets;
 * - `trash=1`: start with a few documents and a folder in Trash.
 * Below 720 px the sidebar is an overlay, as UX §4.5 asks of the shell.
 * `window.__library` exposes the index to the Playwright spec.
 */
import "./harness.css";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import {
  type LibraryPlace,
  LibraryProvider,
  useLibrary,
} from "@/components/library/library-context";
import { LibraryList, placeTitle } from "@/components/library/library-list";
import { LibrarySidebar } from "@/components/library/library-sidebar";
import {
  announce,
  dismissNotice,
  getNotice,
  subscribeNotice,
} from "@/lib/announce";
import { FlaskConicalIcon, PanelLeftIcon } from "@/lib/icons";
import { isQuickOpenKey, type OpenTarget } from "@/lib/library/library-keys";
import { entryTitle } from "@/lib/library/tree-rows";
import type {
  DocumentEntry,
  FolderEntry,
  TagEntry,
} from "@/lib/platform/document-index";
import { cycleRegion, trackRegionFocus } from "@/lib/region-focus";
import { isMac } from "@/lib/shortcuts";
import { MemoryDocumentIndex } from "@/tests/helpers/memory-document-index";

import { LinksHarness } from "./links-view";

const params = new URLSearchParams(location.search);
const NARROW = 720;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

const FOLDERS: FolderEntry[] = [
  { id: "f-work", name: "Work", parentId: null, createdAt: 1 },
  { id: "f-q4", name: "Q4", parentId: "f-work", createdAt: 1 },
  { id: "f-drafts", name: "Drafts", parentId: "f-q4", createdAt: 1 },
  { id: "f-old", name: "Old", parentId: "f-drafts", createdAt: 1 },
  { id: "f-personal", name: "Personal", parentId: null, createdAt: 1 },
  { id: "f-archive", name: "Archive", parentId: null, createdAt: 1 },
];

const TAGS: TagEntry[] = [
  { id: "t-finance", name: "finance", color: null },
  { id: "t-planning", name: "planning", color: null },
  { id: "t-plans", name: "plans", color: null },
  { id: "t-travel", name: "سفر", color: null },
];

const DOCS: DocumentEntry[] = [
  {
    id: "d-plan",
    title: "Q4 plan",
    createdAt: 1,
    folderId: "f-q4",
    pinKey: "p000001",
    openedAt: now - HOUR,
    modifiedAt: now - HOUR,
    tagIds: ["t-planning", "t-finance"],
    snippet:
      "Goals for the quarter: ship the desktop beta, hire two engineers and close the books by the 20th.",
  },
  {
    id: "d-retro",
    title: "Q4 retro notes",
    createdAt: 2,
    folderId: "f-q4",
    openedAt: now - 3 * HOUR,
    modifiedAt: now - DAY - HOUR,
    tagIds: ["t-plans"],
    snippet: "What went well, what didn't, and what we try next time.",
  },
  {
    id: "d-hiring",
    title: "Hiring plan",
    createdAt: 3,
    folderId: "f-work",
    modifiedAt: now - 3 * DAY,
    tagIds: ["t-plans"],
    snippet: "Two engineers and a designer before March.",
  },
  {
    id: "d-budget",
    title: "Budget 2026",
    createdAt: 4,
    pinKey: "p000002",
    openedAt: now - 5 * HOUR,
    modifiedAt: now - 2 * HOUR,
    tagIds: ["t-finance"],
    snippet: "Spending by team, with the travel line split out.",
  },
  {
    id: "d-cafe",
    title: "Café menu",
    createdAt: 5,
    folderId: "f-personal",
    modifiedAt: now - 20 * DAY,
  },
  {
    id: "d-fa",
    title: "گزارش سالانه ۱۴۰۳",
    createdAt: 6,
    modifiedAt: now - 40 * DAY,
    tagIds: ["t-travel"],
    snippet: "خلاصهٔ کارهای سال و برنامهٔ سفرهای کاری.",
  },
  {
    id: "d-ar",
    title: "كتاب الطبخ",
    createdAt: 7,
    folderId: "f-personal",
    modifiedAt: now - 90 * DAY,
  },
  {
    id: "d-meeting",
    title: "Meeting notes",
    createdAt: 8,
    openedAt: now - 2 * HOUR,
    modifiedAt: now - 2 * HOUR,
    snippet: "Agenda, decisions and owners from Monday's sync.",
  },
  { id: "d-untitled", title: "", createdAt: 9, modifiedAt: now - 5 * DAY },
  {
    id: "d-ideas",
    title: "Draft ideas",
    createdAt: 10,
    folderId: "f-drafts",
    modifiedAt: now - 8 * DAY,
  },
  {
    id: "d-outline",
    title: "Old outline",
    createdAt: 11,
    folderId: "f-old",
    modifiedAt: now - 400 * DAY,
  },
];

const WORDS = [
  "plan",
  "notes",
  "budget",
  "draft",
  "review",
  "report",
  "ideas",
  "meeting",
  "roadmap",
  "summary",
  "گزارش",
  "Café",
];

/** `count` generated documents in folder `f-big` (the speed targets). */
function generated(count: number): DocumentEntry[] {
  const docs: DocumentEntry[] = [];
  for (let n = 0; n < count; n++) {
    const word = WORDS[n % WORDS.length];
    const modifiedAt = now - ((n * 7919) % (400 * 24)) * HOUR;
    docs.push({
      id: `g-${n}`,
      title: `${word} ${n}`,
      createdAt: modifiedAt - DAY,
      folderId: "f-big",
      modifiedAt,
      openedAt: n % 3 === 0 ? modifiedAt + HOUR : undefined,
      tagIds: n % 4 === 0 ? [TAGS[n % TAGS.length].id] : undefined,
      snippet: `Generated document ${n}: ${WORDS.join(" ")}.`,
    });
  }
  return docs;
}

function seedOptions() {
  const seed = params.get("seed");
  if (seed === "empty") return {};
  const big = Number(seed);
  if (Number.isFinite(big) && big > 0) {
    return {
      items: [...DOCS, ...generated(big)],
      folders: [
        ...FOLDERS,
        { id: "f-big", name: "Big", parentId: null, createdAt: 1 },
      ],
      tags: TAGS,
    };
  }
  return { items: DOCS, folders: FOLDERS, tags: TAGS };
}

const index = new MemoryDocumentIndex(seedOptions());
if (params.get("trash") === "1") {
  void index.trash(["d-untitled", "d-cafe"]).then(() => {
    void index.trashFolder("f-old");
  });
}
(window as unknown as { __library: MemoryDocumentIndex }).__library = index;
/** The speed spec asserts the targets only on a production build. */
(window as unknown as { __harnessProd: boolean }).__harnessProd =
  process.env.NODE_ENV === "production";

document.documentElement.dir = params.get("dir") === "rtl" ? "rtl" : "ltr";
document.documentElement.classList.toggle(
  "dark",
  params.get("theme") === "dark",
);

type View =
  | { kind: "doc"; id: string }
  | { kind: "place"; place: LibraryPlace; focus: boolean }
  | { kind: "none" };

function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => window.innerWidth < NARROW,
  );
}

function Pill() {
  const notice = useSyncExternalStore(subscribeNotice, getNotice, getNotice);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => dismissNotice(notice.id),
      notice.action ? 5000 : 2500,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="h-pill" data-testid="pill">
      <span>{notice.text}</span>
      {notice.action ? (
        <button
          type="button"
          onClick={() => {
            notice.action?.run();
            dismissNotice(notice.id);
          }}
        >
          {notice.action.label}
        </button>
      ) : null}
    </div>
  );
}

function Main({ view }: { view: View }) {
  const { snapshot } = useLibrary();
  if (view.kind === "doc") {
    const doc = snapshot.items.find((entry) => entry.id === view.id);
    if (!doc) {
      return (
        <p className="h-muted" dir="auto">
          This document is in Trash.
        </p>
      );
    }
    return (
      <article className="h-doc">
        <input
          key={doc.id}
          className="h-title"
          data-testid="doc-title"
          aria-label="Title"
          placeholder="Untitled"
          dir="auto"
          defaultValue={doc.title}
          onChange={(event) => index.rename(doc.id, event.target.value)}
        />
        <div
          className="h-body"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Document"
          tabIndex={0}
        >
          A stand-in for the editor.
        </div>
      </article>
    );
  }
  if (view.kind === "place") {
    return (
      <div
        className="h-list"
        data-testid="place"
        data-title={placeTitle(view.place, snapshot)}
      >
        <LibraryList place={view.place} autoFocus={view.focus} />
      </div>
    );
  }
  return (
    <p className="h-muted" dir="auto">
      Open a document from the sidebar.
    </p>
  );
}

function Shell({
  view,
  tabs,
  narrow,
  sidebarOpen,
  setSidebarOpen,
  lastOpen,
}: {
  view: View;
  tabs: string[];
  narrow: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  lastOpen: string;
}) {
  const { actions, snapshot } = useLibrary();
  useEffect(() => {
    const stop = trackRegionFocus(document.body);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F6") {
        event.preventDefault();
        const label = cycleRegion(document.body, event.shiftKey);
        if (label) announce(label);
      } else if (isQuickOpenKey(event, isMac())) {
        event.preventDefault();
        actions.openQuickOpen();
      } else if (event.key === "Escape" && narrow && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stop();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [actions, narrow, sidebarOpen, setSidebarOpen]);

  const showSidebar = !narrow || sidebarOpen;
  return (
    <div className="h-app" data-narrow={narrow ? "" : undefined}>
      <div
        className="h-tabs"
        role="toolbar"
        data-region=""
        aria-label="Open documents"
      >
        {narrow ? (
          <button
            type="button"
            className="h-toggle"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <PanelLeftIcon aria-hidden="true" />
          </button>
        ) : null}
        {tabs.map((id) => {
          const doc = snapshot.items.find((entry) => entry.id === id);
          return (
            <button
              key={id}
              type="button"
              className="h-tab"
              aria-current={
                view.kind === "doc" && view.id === id ? "page" : undefined
              }
              onClick={() => actions.open(id)}
            >
              <bdi dir="auto">{doc ? entryTitle(doc) : "In Trash"}</bdi>
            </button>
          );
        })}
        <output className="h-last" data-testid="last-open">
          {lastOpen}
        </output>
      </div>
      <div className="h-body-row">
        {showSidebar ? (
          <div className="h-sidebar" data-overlay={narrow ? "" : undefined}>
            <LibrarySidebar
              currentPlace={view.kind === "place" ? view.place : null}
              header={
                <button type="button" className="lib-item">
                  <FlaskConicalIcon aria-hidden="true" />
                  <span className="lib-label">Playground</span>
                </button>
              }
            />
          </div>
        ) : null}
        <main className="h-main" data-region="" aria-label="Document">
          <Main view={view} />
        </main>
      </div>
      <Pill />
    </div>
  );
}

function Harness() {
  const narrow = useNarrow();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "none" });
  const [tabs, setTabs] = useState<string[]>([]);
  const [lastOpen, setLastOpen] = useState("");

  const onOpenDocument = useCallback(
    (id: string, target: OpenTarget) => {
      setLastOpen(`${id} ${target}`);
      setTabs((current) => (current.includes(id) ? current : [...current, id]));
      if (target !== "current") return;
      setView({ kind: "doc", id });
      if (narrow) setSidebarOpen(false);
      // After an open, focus goes to the editor (UX §8.2): the title of a
      // new document, else the body.
      requestAnimationFrame(() => {
        const title = document.querySelector<HTMLInputElement>(
          '[data-testid="doc-title"]',
        );
        if (title && !title.value) title.focus();
        else document.querySelector<HTMLElement>(".h-body")?.focus();
      });
    },
    [narrow],
  );
  const onOpenPlace = useCallback(
    (place: LibraryPlace, target: OpenTarget) => {
      setLastOpen(
        `${place.kind}${"id" in place ? `:${place.id}` : ""} ${target}`,
      );
      if (target !== "current") return;
      // The host decides focus: a list opened from the keyboard takes it.
      const focus = document.activeElement?.matches(":focus-visible") ?? false;
      setView({ kind: "place", place, focus });
      // The overlay closes after an open (UX §4.5).
      if (narrow) setSidebarOpen(false);
    },
    [narrow],
  );

  return (
    <LibraryProvider
      index={index}
      onOpenDocument={onOpenDocument}
      onOpenPlace={onOpenPlace}
      activeDocumentId={view.kind === "doc" ? view.id : null}
    >
      <Shell
        view={view}
        tabs={tabs}
        narrow={narrow}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        lastOpen={lastOpen}
      />
    </LibraryProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    params.get("view") === "links" ? <LinksHarness /> : <Harness />,
  );
}
