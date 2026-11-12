import { describe, expect, it } from "bun:test";

import snapshot from "../../fixtures/schema-snapshot.json";
import { describeSchema } from "../../helpers/describe-schema";
import { getEditorSchema } from "../../helpers/editor-schema";

describe("schema snapshot", () => {
  it("matches the committed schema snapshot (§3 schema evolution rule)", async () => {
    const current = describeSchema(getEditorSchema());
    if (process.env.UPDATE_SCHEMA_SNAPSHOT === "1") {
      await Bun.write(
        "tests/fixtures/schema-snapshot.json",
        `${JSON.stringify(current, null, 2)}\n`,
      );
      throw new Error(
        "Snapshot rewritten: check the diff against spec §3 (add only; no new attrs on existing types; never loosen content or marks)",
      );
    }
    expect(current).toEqual(snapshot);
  });
});
