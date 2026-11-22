/** N3: the deep-link existence check claims nothing. */
import { expect, test } from "bun:test";

import { dispatch } from "@/desktop/storage/protocol";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

test("exists answers without holding the document", () => {
  const temp = createTempDir();
  const library = openTestLibrary(temp.dir, createTestHost(createClock()));
  try {
    const { id } = library.createDoc({ title: "x" });
    expect(library.exists(id)).toBe(true);
    expect(library.exists(crypto.randomUUID())).toBe(false);
    expect(library.isOpen(id)).toBe(false);
    // A window can open it right after a probe.
    expect(() => library.load(id, "w1")).not.toThrow();
    expect(
      dispatch(library, { id: 1, op: "exists", args: { docId: id } }),
    ).toEqual({ ok: true, value: true });
  } finally {
    library.shutdown();
    temp.cleanUp();
  }
});
