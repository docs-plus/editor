/**
 * Document schema migrations (desktop architecture §5.1, D-A5): pure Yjs
 * forward edits that bring a stored document up to {@link DOC_SCHEMA}.
 *
 * - **On open**, `local-session` runs them after hydrate and before the
 *   editor binds (y-prosemirror deletes runs whose marks the schema doesn't
 *   know, `lib/yjs-mark-migration.ts`). The composition root passes
 *   `DOC_SCHEMA` and `DOC_MIGRATIONS`; local-session runs each step in its
 *   own `MIGRATION_ORIGIN` transaction, outside undo, and appends it as
 *   origin `migration` with `schemaTo`, which the storage engine writes to
 *   `docs.schema` in the same transaction.
 * - **At import** (P2.8), the same functions run on `.tinydoc` and web
 *   downloads.
 *
 * The list starts empty: schema 0 is today's documents. Each entry raises
 * `DOC_SCHEMA` by one. A document whose schema is above `DOC_SCHEMA` was
 * written by a newer app and opens read-only (`doc_too_new`).
 */
import type * as Y from "yjs";

export type DocMigration = {
  /** The schema this step produces: the previous step's `to` plus one. */
  to: number;
  /** Edits `doc` in place. Runs inside the caller's transaction. */
  migrate(doc: Y.Doc): void;
};

export const DOC_MIGRATIONS: readonly DocMigration[] = [];

/** The schema documents written by this build are at. */
export const DOC_SCHEMA: number = DOC_MIGRATIONS.at(-1)?.to ?? 0;

export type MigrationPlan =
  | { kind: "current" }
  | { kind: "too_new" }
  | { kind: "migrate"; steps: readonly DocMigration[]; schemaTo: number };

/** What opening a document stored at `schema` needs. */
export function planDocMigrations(
  schema: number,
  migrations: readonly DocMigration[] = DOC_MIGRATIONS,
): MigrationPlan {
  const current = migrations.at(-1)?.to ?? 0;
  if (!Number.isInteger(schema) || schema < 0)
    throw new RangeError(`bad document schema ${schema}`);
  if (schema > current) return { kind: "too_new" };
  if (schema === current) return { kind: "current" };
  const steps = migrations.filter((step) => step.to > schema);
  steps.forEach((step, i) => {
    if (step.to !== schema + i + 1)
      throw new RangeError(`migration to ${step.to} is out of order`);
  });
  return { kind: "migrate", steps, schemaTo: current };
}

/**
 * Runs the steps a plan lists in one transaction under `origin`, so they
 * produce one update. For import, where a file migrates all or nothing;
 * the open hook in local-session runs one transaction per step instead.
 * Returns the schema reached, or null when there was nothing to do.
 */
export function runDocMigrations(
  doc: Y.Doc,
  plan: MigrationPlan,
  origin: unknown,
): number | null {
  if (plan.kind !== "migrate") return null;
  doc.transact(() => {
    for (const step of plan.steps) step.migrate(doc);
  }, origin);
  return plan.schemaTo;
}
