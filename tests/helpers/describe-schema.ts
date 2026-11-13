import type { Schema } from "@tiptap/pm/model";

interface NodeDescription {
  content: string;
  group: string;
  marks: string;
  inline: boolean;
  atom: boolean;
  attrs: string[];
}

interface MarkDescription {
  attrs: string[];
  inclusive: boolean;
  excludes: string;
}

export interface SchemaDescription {
  nodes: Record<string, NodeDescription>;
  marks: Record<string, MarkDescription>;
}

const sortedKeys = (attrs: object) => Object.keys(attrs).sort();

function sortedEntries<T>(items: Record<string, T>) {
  return Object.keys(items)
    .sort()
    .map((name) => [name, items[name]] as const);
}

/** Stable, order-independent summary of a schema's structure for snapshot tests. */
export function describeSchema(schema: Schema): SchemaDescription {
  return {
    nodes: Object.fromEntries(
      sortedEntries(schema.nodes).map(([name, type]) => [
        name,
        {
          content: type.spec.content ?? "",
          group: type.spec.group ?? "",
          marks: type.spec.marks ?? "_",
          inline: type.isInline,
          atom: type.isAtom,
          attrs: sortedKeys(type.spec.attrs ?? {}),
        },
      ]),
    ),
    marks: Object.fromEntries(
      sortedEntries(schema.marks).map(([name, type]) => [
        name,
        {
          attrs: sortedKeys(type.spec.attrs ?? {}),
          inclusive: type.spec.inclusive ?? true,
          excludes: type.spec.excludes ?? "_",
        },
      ]),
    ),
  };
}
