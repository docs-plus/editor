import type { Page } from "@playwright/test";

type StoredRecord = { key: string; name: string };

/** Offline copy records in this browser (never creates the DB). */
export function storedRecords(page: Page): Promise<StoredRecord[]> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((db) => db.name === "tinydocy-offline")) return [];
    return new Promise<StoredRecord[]>((resolve, reject) => {
      const req = indexedDB.open("tinydocy-offline");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("docs")) return resolve([]);
        const all = db.transaction("docs").objectStore("docs").getAll();
        all.onsuccess = () =>
          resolve(
            (all.result as StoredRecord[]).map(({ key, name }) => ({
              key,
              name,
            })),
          );
        all.onerror = () => reject(all.error);
      };
    });
  });
}

/** Document names with an offline copy in this browser. */
export async function storedCopies(page: Page): Promise<string[]> {
  return (await storedRecords(page)).map((record) => record.name);
}
