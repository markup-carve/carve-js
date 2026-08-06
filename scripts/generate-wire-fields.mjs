#!/usr/bin/env node
/*
 * Generate src/wire-fields.ts from the pinned resources/ast-schema.json.
 *
 * PART 12 §11 makes an ingest refuse a property the schema does not name, which
 * needs the set of named properties AT RUNTIME - and the schema is a dev-time
 * file, not something the published package ships. So the map is generated and
 * committed, with a test that regenerates it and compares: one source of truth
 * (the schema), one artifact, and a diff the moment the two drift.
 *
 * Writing the list by hand would be the schema expressed a second time in code,
 * which is exactly the shape that rots - the reason this is a script.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function wireFieldsSource(schema) {
  const defs = schema.$defs ?? {};
  /** type name -> sorted property names */
  const byType = new Map();
  for (const def of Object.values(defs)) {
    const type = def?.properties?.type?.const;
    if (typeof type !== "string") continue;
    if (def.additionalProperties !== false) {
      throw new Error(
        `${type} is not closed in the schema; section 11 has nothing to check against`,
      );
    }
    byType.set(type, Object.keys(def.properties).sort());
  }
  // The two objects that hang off a node without carrying a `type` of their
  // own. They are closed in the schema too, and they are where a stray key is
  // most likely to be smuggled in, since every node kind can carry them.
  const helpers = new Map();
  for (const name of ["attrs", "pos"]) {
    const def = defs[name];
    if (def?.additionalProperties !== false) {
      throw new Error(
        `${name} is not closed in the schema; section 11 has nothing to check against`,
      );
    }
    helpers.set(name, Object.keys(def.properties).sort());
  }
  /*
   * Field names that hold NODES somewhere in the schema (PART 12 section 12(c)).
   *
   * Derived rather than listed, and derived as a SET OF NAMES rather than
   * per-type, because the two readings differ and the union is the safe one:
   * `content` holds nodes on `inline_extension` and a verbatim string on
   * `code_block`, `title` holds nodes on `admonition` and a string on `link`.
   * A walker that descends a name only where some type puts nodes there is
   * correct either way - a string is not an object, so descending into one
   * finds nothing.
   *
   * `attrs.keyValues` can never appear here: its values are strings. That is
   * load-bearing, not incidental. Attribute names are ordinary identifiers, so
   * `{type=widget}` puts an object literally shaped {"type":"widget"} in the
   * tree, and a walker that treated it as a node would refuse a document this
   * engine's own parser produced - which section 9(a) forbids.
   */
  const nodeFields = new Set();
  const holdsNode = (schemaNode) => {
    if (Array.isArray(schemaNode)) return schemaNode.some(holdsNode);
    if (schemaNode === null || typeof schemaNode !== "object") return false;
    for (const [key, value] of Object.entries(schemaNode)) {
      if (key === "$ref" && typeof value === "string") {
        const target = value.replace("#/$defs/", "");
        if (target === "attrs" || target === "pos") continue;
        return true;
      }
      if (holdsNode(value)) return true;
    }
    return false;
  };
  for (const def of Object.values(defs)) {
    for (const [name, property] of Object.entries(def?.properties ?? {})) {
      if (holdsNode(property)) nodeFields.add(name);
    }
  }
  /*
   * WHAT EACH NODE POSITION HOLDS, spelled `<owning type>.<field>` (PART 12
   * section 12(c)).
   *
   * Section 12(c) refuses a node whose `type` the schema does not name, and a
   * missing or non-string `type` is that case - so the walk requires a string
   * `type` at every position where a NODE is what the schema puts. `NODE_FIELDS`
   * alone cannot answer that, because one field name means different things in
   * different places, and the differences all matter:
   *
   *   "nodes"   an ARRAY of nodes; each ELEMENT must carry a string `type`.
   *   "node"    a SINGLE node, e.g. `figure.target`; the object itself must.
   *   "records" an array of PLAIN RECORDS the schema gives no `type` at all -
   *             only `citation_group.items` today. Requiring one there would
   *             refuse a tree this engine's own parser produced, which section
   *             9(a) forbids.
   *
   * `attrs` and `pos` are the other two typeless objects and cannot appear here
   * at all: neither name reaches `NODE_FIELDS`, because `holdsNode` skips those
   * two refs outright.
   *
   * The "nodes" case is deliberately about the ELEMENTS and not the container.
   * A non-array sitting where an array belongs - `children: {}` - is the
   * wrong-TYPE class, which markup-carve/carve#881 leaves unruled and this
   * engine deliberately degrades to an empty document rather than deciding by
   * accident.
   *
   * Derived, not listed, for the same reason the rest of this file is. A hand
   * written table is the schema expressed a second time, and this one would be
   * silently wrong the day a second plain record is added.
   */
  const plainRecords = new Set(
    Object.entries(defs)
      .filter(
        ([name, def]) =>
          name !== "attrs" &&
          name !== "pos" &&
          def?.type === "object" &&
          def?.properties !== undefined &&
          def.properties.type === undefined,
      )
      .map(([name]) => name),
  );
  const refsPlainRecord = (schemaNode) => {
    if (Array.isArray(schemaNode)) return schemaNode.some(refsPlainRecord);
    if (schemaNode === null || typeof schemaNode !== "object") return false;
    for (const [key, value] of Object.entries(schemaNode)) {
      if (key === "$ref" && typeof value === "string") {
        if (plainRecords.has(value.replace("#/$defs/", ""))) return true;
        continue;
      }
      if (refsPlainRecord(value)) return true;
    }
    return false;
  };
  const positionKind = new Map();
  for (const def of Object.values(defs)) {
    const owner = def?.properties?.type?.const;
    if (typeof owner !== "string") continue;
    for (const [name, property] of Object.entries(def.properties)) {
      if (!holdsNode(property)) continue;
      const kind = refsPlainRecord(property)
        ? "records"
        : property.type === "array"
          ? "nodes"
          : "node";
      positionKind.set(`${owner}.${name}`, kind);
    }
  }

  const entry = ([name, fields]) =>
    `  ${JSON.stringify(name)}: [${fields.map((f) => JSON.stringify(f)).join(", ")}],`;
  const header = [
    "// GENERATED by scripts/generate-wire-fields.mjs from resources/ast-schema.json.",
    "// Do not edit: run `node scripts/generate-wire-fields.mjs` instead.",
    "//",
    "// PART 12 section 11 - a property the schema does not name is refused on",
    "// ingest - needs the named set at runtime, and the schema is not shipped",
    "// with the package.",
    "",
    "/** Properties the schema names for each node type. */",
    "export const WIRE_FIELDS: Readonly<Record<string, readonly string[]>> = {",
  ].join("\n");
  const middle = [
    "}",
    "",
    "/** Properties the schema names for the objects that hang off a node. */",
    "export const WIRE_HELPER_FIELDS: Readonly<Record<string, readonly string[]>> = {",
  ].join("\n");
  const sorted = (m) =>
    [...m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(entry)
      .join("\n");
  const tail = [
    "}",
    "",
    "/**",
    " * Field names that hold NODES, so section 12(c)'s unknown-type check knows",
    " * where a node can be. A union across types: `content` holds nodes on",
    " * `inline_extension` and a string on `code_block`, and descending a name into",
    " * a string finds nothing, so the union is safe in both directions.",
    " *",
    " * `keyValues` is absent, and that is the point: its values are strings, and an",
    " * attribute may legally be named `type`, so `{type=widget}` puts an object",
    " * shaped {\"type\":\"widget\"} in the tree.",
    " */",
    "export const NODE_FIELDS: readonly string[] = [",
  ].join("\n");
  const list = [...nodeFields]
    .sort()
    .map((name) => `  ${JSON.stringify(name)},`)
    .join("\n");
  const kindDoc = [
    "]",
    "",
    "/**",
    " * What the schema puts at each node position, keyed `<owning type>.<field>`,",
    " * so section 12(c)'s string-`type` requirement lands where a NODE belongs and",
    " * nowhere else.",
    " *",
    ' * - `"nodes"` - an array of nodes; each ELEMENT carries a string `type`. About',
    " *   the elements, not the container: a non-array sitting where the array",
    " *   belongs is the unruled wrong-TYPE class, not this clause's business.",
    ' * - `"node"` - a single node, e.g. `figure.target`; the object itself carries',
    " *   one.",
    ' * - `"records"` - an array of plain records the schema gives no `type` at all.',
    " *   Only `citation_group.items` today: a citation item is",
    " *   `{key, suppressAuthor, prefix?, locator?, suffix?}`.",
    " *",
    " * The owning type is part of the key because one field name means different",
    " * things in different places: `items` holds nodes on `list` and plain records",
    " * on `citation_group`.",
    " */",
    "export const NODE_POSITION_KIND: Readonly<Record<string, 'nodes' | 'node' | 'records'>> = {",
  ].join("\n");
  const kindList = [...positionKind.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, kind]) => `  ${JSON.stringify(name)}: ${JSON.stringify(kind)},`)
    .join("\n");
  return `${header}\n${sorted(byType)}\n${middle}\n${sorted(helpers)}\n${tail}\n${list}\n${kindDoc}\n${kindList}\n}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const schema = JSON.parse(
    readFileSync(resolve(root, "spec/resources/ast-schema.json"), "utf8"),
  );
  writeFileSync(resolve(root, "src/wire-fields.ts"), wireFieldsSource(schema));
  console.log("src/wire-fields.ts written from spec/resources/ast-schema.json");
}
