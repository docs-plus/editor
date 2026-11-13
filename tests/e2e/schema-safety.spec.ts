import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { type Browser, expect, type Page, test } from "@playwright/test";
import * as Y from "yjs";

import { type SpawnedHocus, spawnHocus } from "@/tests/helpers/spawn-hocus";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";
import { storedCopies, storedRecords } from "./helpers/offline-store";

const FIELD = "default";
const OUTDATED_COPY =
  "A newer TinyDocy is available. Reload to keep editing; your changes on this device are kept.";

// CSP `connect-src` pins the default collab host; this spec talks to its own.
test.use({ bypassCSP: true });
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

let hocus: SpawnedHocus;

test.beforeAll(async () => {
  hocus = await spawnHocus({ HOCUS_MIN_CLIENT_SCHEMA: "2" });
});

test.afterAll(async () => {
  await hocus.stop();
});

function newDocId(): string {
  return `schema-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Points the page at the spawned server, optionally pretending to be an older bundle. */
async function pointAtSpawnedServer(
  page: Page,
  schema?: string,
): Promise<void> {
  await page.addInitScript(
    ({ url, schema }) => {
      const w = window as Window & {
        __HOCUS_URL?: string;
        __HOCUS_SCHEMA?: string;
      };
      w.__HOCUS_URL = url;
      if (schema !== undefined) w.__HOCUS_SCHEMA = schema;
    },
    { url: hocus.url, schema },
  );
}

async function openEditor(browser: Browser, docId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await pointAtSpawnedServer(page);
  const editor = new EditorPage(page);
  await editor.goto(docId);
  await editor.waitForSync();
  return { context, page, editor };
}

/** A raw provider on the spawned server, as a current (schema 2) client. */
async function connect(docId: string) {
  const doc = new Y.Doc();
  // A refused attacker must not retry.
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `${hocus.url}/?schema=2`,
    maxAttempts: 1,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: docId,
    document: doc,
  });
  const synced = new Promise<void>((resolve) =>
    provider.on("synced", () => resolve()),
  );
  provider.attach();
  await synced;
  return {
    doc,
    provider,
    fragment: doc.getXmlFragment(FIELD),
    disconnect() {
      provider.destroy();
      websocketProvider.destroy();
    },
  };
}

/** The document as the server has it, read through a fresh connection. */
async function readServer(docId: string): Promise<string> {
  const client = await connect(docId);
  const xml = client.fragment.toString();
  client.disconnect();
  return xml;
}

/**
 * The editor after a repair: first block is the title, it is editable, no
 * notice. `gone`/`arrived` prove the attack reached the page first (until
 * the repair the editor is frozen on its old content, which also starts with
 * a title).
 */
function repairedState(
  page: Page,
  { gone, arrived }: { gone?: string; arrived?: string },
) {
  return page.evaluate(
    ({ gone, arrived }) => {
      const tiptap = document.querySelector(".tiptap");
      const text = tiptap?.textContent ?? "";
      return {
        seen:
          (gone === undefined || !text.includes(gone)) &&
          (arrived === undefined || text.includes(arrived)),
        first: tiptap?.firstElementChild?.tagName,
        editable: tiptap?.getAttribute("contenteditable"),
        notices: document.querySelectorAll(".document-size-notice").length,
      };
    },
    { gone, arrived },
  );
}

const REPAIRED = { seen: true, first: "H1", editable: "true", notices: 0 };

async function expectEditableWithoutNotice(page: Page): Promise<void> {
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator(".document-size-notice")).toHaveCount(0);
}

function flushDeviceCopies(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
}

test("outdated client keeps its copy, is read-only, changes nothing", async ({
  browser,
}) => {
  const docId = newDocId();
  const { context, page } = await openEditor(browser, docId);
  await typeInNewParagraphAtEnd(page, "Copy on this device");
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("Copy on this device");
  await flushDeviceCopies(page);
  await expect.poll(() => storedCopies(page)).toContain(docId);
  const before = await readServer(docId);

  const old = await context.newPage();
  await pointAtSpawnedServer(old, "1");
  await new EditorPage(old).goto(docId);

  await expect(old.locator(".document-size-notice")).toContainText(
    OUTDATED_COPY,
    {
      timeout: 15_000,
    },
  );
  await expect(old.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(old.locator(".tiptap")).toContainText("Copy on this device");
  await old.locator(".tiptap").click({ force: true });
  await old.keyboard.type("must not appear");
  await expect(old.locator(".tiptap")).not.toContainText("must not appear");
  expect(await storedCopies(old)).toContain(docId);
  expect(await readServer(docId)).toBe(before);

  const loaded = old.waitForEvent("load");
  await old.getByRole("button", { name: "Reload" }).click();
  await loaded;

  await context.close();
});

test("a refused client with no device copy shows the banner", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await pointAtSpawnedServer(page, "1");
  await new EditorPage(page).goto(newDocId(), { waitForEditor: false });
  await expect(page.locator(".document-size-notice")).toContainText(
    OUTDATED_COPY,
    {
      timeout: 10_000,
    },
  );
  await context.close();
});

test("an unknown name is refused at ingress", async ({ browser }) => {
  const docId = newDocId();
  const { context, page } = await openEditor(browser, docId);
  await typeInNewParagraphAtEnd(page, "before attack");
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("before attack");

  const attacker = await connect(docId);
  const closed = new Promise<string>((resolve) =>
    attacker.provider.on("close", ({ event }: { event: CloseEvent }) =>
      resolve(event.reason),
    ),
  );
  attacker.fragment.insert(0, [new Y.XmlElement("zzz")]);
  expect(await closed).toBe("schema_rejected");
  attacker.disconnect();

  await page.waitForTimeout(1000);
  await expectEditableWithoutNotice(page);
  expect(await readServer(docId)).not.toContain("<zzz");
  await context.close();
});

test("a delete-all is repaired, not frozen", async ({ browser }) => {
  const docId = newDocId();
  const { context, page } = await openEditor(browser, docId);
  await typeInNewParagraphAtEnd(page, "before wipe");
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("before wipe");

  const attacker = await connect(docId);
  attacker.fragment.delete(0, attacker.fragment.length);
  attacker.disconnect();

  await expect
    .poll(() => repairedState(page, { gone: "before wipe" }), {
      timeout: 3000,
    })
    .toEqual(REPAIRED);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("after repair");
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("after repair");
  await context.close();
});

test("a paragraph before the title is repaired", async ({ browser }) => {
  const docId = newDocId();
  const { context, page } = await openEditor(browser, docId);
  await typeInNewParagraphAtEnd(page, "body text");
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("body text");

  const attacker = await connect(docId);
  const intruder = new Y.XmlElement("paragraph");
  intruder.insert(0, [new Y.XmlText("intruder")]);
  attacker.fragment.insert(0, [intruder]);
  attacker.disconnect();

  await expect
    .poll(() => repairedState(page, { arrived: "intruder" }), {
      timeout: 3000,
    })
    .toEqual(REPAIRED);
  await context.close();
});

test("a top-level hard break is fitted, not frozen", async ({ browser }) => {
  const docId = newDocId();
  const { context, page } = await openEditor(browser, docId);
  await typeInNewParagraphAtEnd(page, "body text");
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("body text");

  // A known name in the wrong place: allowed at ingress, so the client heals it.
  const attacker = await connect(docId);
  attacker.fragment.insert(1, [new Y.XmlElement("hardBreak")]);
  attacker.disconnect();

  await expect
    .poll(() => readServer(docId), { timeout: 5000 })
    .toContain("</heading><paragraph><hardbreak></hardbreak></paragraph>");
  await expect
    .poll(() => repairedState(page, { arrived: "body text" }), {
      timeout: 3000,
    })
    .toEqual(REPAIRED);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("after fit");
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("after fit");
  await context.close();
});

test("a pre-N device copy migrates through real IndexedDB", async ({
  browser,
}) => {
  const docId = newDocId();
  // Built by hand: the editor schema's modules import SCSS, which the
  // Playwright runtime cannot load.
  const legacyDoc = new Y.Doc();
  const title = new Y.XmlElement("heading");
  // y-tiptap stores the number; the Yjs typings only allow strings.
  title.setAttribute("level", 1 as unknown as string);
  title.insert(0, [new Y.XmlText("Legacy copy")]);
  legacyDoc.getXmlFragment(FIELD).insert(0, [title]);
  const update = Array.from(Y.encodeStateAsUpdate(legacyDoc));
  const host = new URL(hocus.url).host;
  const legacyKey = `1:${host}:${docId}`;
  const currentKey = `1:${host}~s2:${docId}`;

  const context = await browser.newContext();
  const page = await context.newPage();
  await pointAtSpawnedServer(page);
  await page.goto("/privacy");
  await page.evaluate(
    async ({ key, name, update }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("tinydocy-offline", 1);
        req.onupgradeneeded = () =>
          req.result.createObjectStore("docs", { keyPath: "key" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("docs", "readwrite");
        tx.objectStore("docs").put({
          key,
          name,
          update: new Uint8Array(update),
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { key: legacyKey, name: docId, update },
  );
  expect(await readServer(docId)).not.toContain("Legacy copy");

  await new EditorPage(page).goto(docId);
  await expect(page.locator(".tiptap")).toContainText("Legacy copy", {
    timeout: 15_000,
  });
  await flushDeviceCopies(page);
  await expect
    .poll(
      async () =>
        (await storedRecords(page))
          .filter((record) => record.name === docId)
          .map((record) => record.key),
      { timeout: 15_000 },
    )
    .toEqual([currentKey]);
  await expect
    .poll(() => readServer(docId), { timeout: 15_000 })
    .toContain("Legacy copy");
  await context.close();
});

test("no guardrail rejection volume from any of it", () => {
  expect(hocus.logs()).not.toContain("ws_guardrail_rejected");
});
