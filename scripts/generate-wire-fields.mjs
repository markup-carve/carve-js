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
  // PART 9 §21a is implemented ahead of the spec-corpus pin by design: its
  // corpus cases are not merged yet, and this change must not move the
  // submodule. Mirror only the already-normative optional wire field so the
  // generated validator can accept trees produced by this engine. Delete this
  // compatibility overlay once the pinned schema contains the property.
  schema = structuredClone(schema);
  const defOf = (type) =>
    Object.values(schema.$defs ?? {}).find(
      (def) => def?.properties?.type?.const === type,
    );
  const commentDef = defOf("comment");
  if (commentDef && commentDef.properties.delimited === undefined) {
    commentDef.properties.delimited = { type: "boolean" };
  }
  // PART 12 §8's `definition_list.loose`, the same arrangement one property
  // later. The field is already NORMATIVE - spec `cfb8d7bf`
  // (markup-carve/carve#1634) added it, and this engine's parser, HTML renderer
  // and writer already implement the L7 rule it publishes
  // (markup-carve/carve-js#1404, #1407) - but the pin still names a schema
  // without it, so an ingest would refuse a tree this engine's own encoder
  // produced, which section 9(a) forbids.
  //
  // MIRRORED EXACTLY, `const: true` and all, so the generated artifact is
  // byte-identical to what the real schema produces once the pin reaches it and
  // this overlay is deleted. A `{type: "boolean"}` stand-in would be easier to
  // write and would make the deletion a behavior change: `valueKind` reads a
  // bare `const` as no kind at all, so the stand-in would publish a value check
  // the schema does not ask for.
  const definitionListDef = defOf("definition_list");
  if (definitionListDef && definitionListDef.properties.loose === undefined) {
    definitionListDef.properties.loose = { const: true };
  }
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
   * THE CLOSED RECORDS THE SCHEMA NESTS UNDER A NODE, and WHERE each one sits.
   *
   * These are the objects that hang off a node without carrying a `type` of
   * their own, so nothing keyed by `type` reaches them - and they are where a
   * stray key is most likely to be smuggled in, since a caller writing one is
   * usually writing it by hand.
   *
   * DERIVED, not named. `attrs` and `pos` were listed here literally, which was
   * a complete description of the wire for exactly as long as they were the only
   * two: `table.rowGroups` arrived through the schema (markup-carve/carve#1186)
   * and was emitted as `"object"` and nothing more, so `rowGroups: {}` and
   * `rowGroups: {junk: -5}` both decoded, survived into the tree and were
   * published again on the way out - this engine vouching for a payload it never
   * looked at (markup-carve/carve-js#1055). A hand-written list of the schema's
   * nested records is the schema expressed a second time, and this is the shape
   * that rots.
   *
   * TWO SPELLINGS reach a record, and both are read here:
   *
   *   a `$ref` to a closed `$def` the schema gives no `type` - `attrs` and
   *   `pos`. Its RECORD NAME is the def name, which is also how the errors have
   *   always spelled those two.
   *
   *   an INLINE `{"type": "object", "additionalProperties": false}` under a
   *   property - `table.rowGroups`, and `table.rowGroups.bodies`'s items inside
   *   it. It has no def name, so its record name is its dotted POSITION, which
   *   is also why the map below is keyed by owner and field rather than by name:
   *   an inline record is only findable through the position that holds it.
   *
   * The walk is TRANSITIVE - a record's own properties are searched again - and
   * that is not decoration. `rowGroups.bodies` is a list of closed records and
   * each carries an `attrs`, so a pass that closed only the outer object would
   * leave the same hole one level down.
   *
   * A NODE POSITION IS NOT THIS WALK'S BUSINESS, which is what `holdsNode`
   * settles. Claiming a node position here as well would give two producers to
   * one validation rule.
   *
   * `attrs.keyValues` is deliberately not one of these either. Its
   * `additionalProperties` is a SCHEMA rather than `false` - an open map of
   * string values, since an attribute may be named anything - so there is no
   * closed record to emit. That its values are unchecked as strings is a
   * separate and much narrower question.
   */
  const isPlainRecordDef = (def) =>
    def?.type === "object" &&
    def.properties !== undefined &&
    def.properties.type === undefined;
  const isInlineRecord = (property) =>
    property?.type === "object" &&
    property.properties !== undefined &&
    property.additionalProperties === false;
  /** The record a property holds, if it holds one, and whether as an array. */
  const recordAt = (owner, field, property) => {
    const one = property?.type === "array" ? property.items : property;
    const array = property?.type === "array";
    if (typeof one?.$ref === "string") {
      const name = one.$ref.replace("#/$defs/", "");
      if (!isPlainRecordDef(defs[name])) return null;
      if (defs[name].additionalProperties !== false) {
        throw new Error(
          `${name} is not closed in the schema; section 11 has nothing to check against`,
        );
      }
      return { record: name, def: defs[name], array };
    }
    if (!isInlineRecord(one)) return null;
    return { record: `${owner}.${field}`, def: one, array };
  };
  const records = new Map();
  const nestedAt = new Map();
  const walkRecords = (owner, properties) => {
    for (const [field, property] of Object.entries(properties)) {
      if (holdsNode(property)) continue;
      const found = recordAt(owner, field, property);
      if (found === null) continue;
      nestedAt.set(`${owner}.${field}`, {
        record: found.record,
        array: found.array,
      });
      if (records.has(found.record)) continue;
      records.set(found.record, found.def);
      walkRecords(found.record, found.def.properties);
    }
  };
  for (const def of Object.values(defs)) {
    const type = def?.properties?.type?.const;
    if (typeof type !== "string") continue;
    walkRecords(type, def.properties);
  }
  const recordFields = new Map(
    [...records.entries()].map(([name, def]) => [
      name,
      Object.keys(def.properties).sort(),
    ]),
  );
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
          name !== "attrs" && name !== "pos" && isPlainRecordDef(def),
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

  /*
   * WHAT THE SCHEMA REQUIRES, and WHAT SHAPE it gives each value (PART 12
   * section 12(d), markup-carve/carve#881).
   *
   * (d) is one clause rather than a row per field, and that is deliberate:
   * ruling them one at a time is what produced the state it replaces. The
   * schema is the list, it already describes every row that diverged, and those
   * rows were only ever divergent because nothing consulted it. So this is
   * derived from the schema for the same reason WIRE_FIELDS is - a hand-written
   * table would be the schema expressed a second time, and would be silently
   * wrong the day a field is added.
   *
   * The KINDS are the subset of JSON Schema this walk can answer without
   * re-implementing a validator, which is every shape the schema actually uses:
   * a scalar with an optional minimum, an enum, an array of strings, an array
   * of nodes or records, and a single node. Anything else is left alone rather
   * than guessed at.
   *
   * `srcByteLength` is where the two halves of (a) and (d) meet: (a) is about
   * the field being PRESENT, (d) about its TYPE and SIGN. A value that is
   * present and merely WRONG - a number that does not match the source - stays
   * accepted, because it is derivable and nothing in the tree depends on it.
   */
  const valueKind = (property) => {
    if (property === null || typeof property !== "object") return undefined;
    // A `const` pins ONE legal value, so it is checked before `type` and `enum`:
    // it is strictly stronger than either, and it is the whole constraint the
    // schema writes for these properties - they carry a `const` and a
    // `description` and nothing else. Read as no kind at all, every one of them
    // decoded unchecked and was published again (markup-carve/carve-js#1418).
    //
    // The kind carries the value as JSON so the decoder can compare against it
    // without a second table: `const:true` and `const:"integral"` are the two
    // spellings the schema uses, and JSON keeps them apart from each other and
    // from a string that merely reads like one.
    //
    // `type` never reaches here - `collect` skips it, because §12(c) rules on a
    // node's type with its own error and two producers of one rule is the
    // hazard the generator already calls out.
    if (property.const !== undefined) {
      return `const:${JSON.stringify(property.const)}`;
    }
    if (Array.isArray(property.enum)) {
      return `enum:${property.enum.map(String).join("\u0000")}`;
    }
    if (property.type === "string") return "string";
    if (property.type === "boolean") return "boolean";
    if (property.type === "integer") {
      if (property.minimum === 0) return "integer>=0";
      if (property.minimum === 1) return "integer>=1";
      return "integer";
    }
    if (property.type === "object") return "object";
    if (property.type === "array") {
      const items = property.items;
      if (items?.type === "string") return "string[]";
      return "array";
    }
    if (typeof property.$ref === "string") {
      const target = property.$ref.replace("#/$defs/", "");
      // A ref to a PLAIN RECORD is an object, not a node: the schema gives it no
      // `type`, so requiring one there would refuse a tree this engine's own
      // parser produced (section 9(a)). `WIRE_NESTED_RECORDS` is what says which
      // record, and checks its contents.
      if (isPlainRecordDef(defs[target])) return "object";
      return "node";
    }
    return undefined;
  };
  const required = new Map();
  const kinds = new Map();
  const collect = (name, def) => {
    if (!def || typeof def !== "object" || !def.properties) return;
    required.set(name, [...(def.required ?? [])].sort());
    const perProperty = {};
    for (const [property, shape] of Object.entries(def.properties)) {
      // `type` is settled by section 12(c) and its own error, so it is not
      // restated here - two producers of one rule is the hazard, not the gap.
      if (property === "type") continue;
      const kind = valueKind(shape);
      if (kind !== undefined) perProperty[property] = kind;
    }
    kinds.set(name, perProperty);
  };
  for (const def of Object.values(defs)) {
    const type = def?.properties?.type?.const;
    if (typeof type === "string") collect(type, def);
  }
  for (const [name, def] of records) collect(name, def);

  /*
   * WHICH NODE TYPES EACH POSITION ADMITS, spelled `<owning type>.<field>`
   * (PART 12 section 12(d)).
   *
   * `NODE_POSITION_KIND` above says a position holds NODES; this says WHICH.
   * Checking only the container leaves the schema half-consulted: a `paragraph`
   * sitting in another paragraph's `children` is a block where the schema names
   * `inlineNode`, and it was accepted at decode and then threw
   * `renderHtml: unknown inline paragraph` - an untyped renderer crash for a
   * document the decoder had passed, which section 9(b) forbids. Raised by codex
   * review on the change that added the validator.
   *
   * Three spellings reach a node, and all three are read here: a `$ref` to the
   * `blockNode` / `inlineNode` union, whose members are its `type` enum; a
   * `oneOf` of concrete node refs, which is how `figure.target` names the five
   * blocks a caption can carry; and a direct `$ref` to one concrete node.
   *
   * A `"records"` position cannot appear here and needs no guard against it,
   * which was worth measuring rather than assuming: a plain record is one the
   * schema gives no `type`, so `membersOf` finds no members and returns null,
   * and the position is skipped for that reason. An explicit
   * `kind === "records"` skip was written here first and REMOVED - the generated
   * artifact was byte-identical with and without it, which makes it a check that
   * cannot fail (markup-carve/carve#755), and this file has one rule per fact.
   */
  const membersOf = (schemaNode) => {
    if (schemaNode === null || typeof schemaNode !== "object") return null;
    if (typeof schemaNode.$ref === "string") {
      const target = defs[schemaNode.$ref.replace("#/$defs/", "")];
      if (!target) return null;
      const asEnum = target.properties?.type?.enum;
      if (Array.isArray(asEnum)) return asEnum;
      const asConst = target.properties?.type?.const;
      return typeof asConst === "string" ? [asConst] : null;
    }
    for (const key of ["oneOf", "anyOf"]) {
      if (!Array.isArray(schemaNode[key])) continue;
      const all = schemaNode[key].map(membersOf);
      if (all.some((m) => m === null)) return null;
      return all.flat();
    }
    if (schemaNode.type === "array") return membersOf(schemaNode.items);
    return null;
  };
  const positionTypes = new Map();
  for (const def of Object.values(defs)) {
    const owner = def?.properties?.type?.const;
    if (typeof owner !== "string") continue;
    for (const [name, property] of Object.entries(def.properties)) {
      if (!holdsNode(property)) continue;
      const members = membersOf(property);
      if (members === null) continue;
      positionTypes.set(`${owner}.${name}`, [...new Set(members)].sort());
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
    "/**",
    " * Properties the schema names for each CLOSED RECORD it nests under a node.",
    " *",
    " * A record is an object the schema gives no `type`, so nothing keyed by type",
    " * reaches it. Named by its `$defs` key where it has one - `attrs`, `pos` -",
    " * and by its dotted POSITION where the schema writes it inline and it has no",
    " * other name: `table.rowGroups`, `table.rowGroups.bodies`.",
    " *",
    " * Positions claimed by the node walk are absent from this map.",
    " */",
    "export const WIRE_RECORD_FIELDS: Readonly<Record<string, readonly string[]>> = {",
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
    " *",
    " * The owning type is part of the key because one field name means different",
    " * things in different places.",
    " */",
    "export const NODE_POSITION_KIND: Readonly<Record<string, 'nodes' | 'node' | 'records'>> = {",
  ].join("\n");
  const kindList = [...positionKind.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, kind]) => `  ${JSON.stringify(name)}: ${JSON.stringify(kind)},`)
    .join("\n");
  const schemaDoc = [
    "}",
    "",
    "/**",
    " * What the schema REQUIRES of each type, and of the two typeless objects that",
    " * hang off a node (PART 12 section 12(d)).",
    " *",
    " * (d) validates the WHOLE payload against the schema at DECODE - types and",
    " * required fields together - refused with the same typed error (a), (b) and",
    " * (c) already require. Not a fourth list of leniency points: the schema is the",
    " * list, and the rows that diverged across engines were only ever divergent",
    " * because nothing consulted it.",
    " */",
    "export const WIRE_REQUIRED: Readonly<Record<string, readonly string[]>> = {",
  ].join("\n");
  const requiredList = [...required.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(entry)
    .join("\n");
  const kindsDoc = [
    "}",
    "",
    "/**",
    " * The VALUE SHAPE the schema gives each property, keyed by owning type.",
    " *",
    " * The kinds are the subset of JSON Schema the schema actually uses, so the",
    " * walk answers (d) without re-implementing a validator: `string`, `boolean`,",
    " * `integer` with an optional minimum, `enum:` with NUL-separated members,",
    " * `string[]`, `array`, `object`, and `node` for a single nested node.",
    " *",
    " * `type` is absent on purpose - section 12(c) settles it and carries its own",
    " * error, and two producers of one rule is the hazard rather than the gap.",
    " */",
    "export const WIRE_VALUE_KINDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {",
  ].join("\n");
  const kindsList = [...kinds.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([name, perProperty]) =>
        `  ${JSON.stringify(name)}: { ${Object.entries(perProperty)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
          .join(", ")} },`,
    )
    .join("\n");
  const typesDoc = [
    "}",
    "",
    "/**",
    " * Which node TYPES each position admits, keyed `<owning type>.<field>`.",
    " *",
    " * `NODE_POSITION_KIND` says a position holds nodes; this says which. Without",
    " * it the schema is half-consulted: a `paragraph` in another paragraph's",
    " * `children` is a block where the schema names `inlineNode`, and it decoded",
    " * cleanly and then threw an untyped error from inside the renderer.",
    " *",
    " * Positions whose kind is `records` are absent on purpose because their",
    " * elements have no node type.",
    " */",
    "export const NODE_POSITION_TYPES: Readonly<Record<string, readonly string[]>> = {",
  ].join("\n");
  const typesList = [...positionTypes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(entry)
    .join("\n");
  const nestedDoc = [
    "}",
    "",
    "/**",
    " * WHERE each closed record sits, grouped by the node type or record that",
    " * OWNS the position, so the decoder can descend into one without knowing its",
    " * name in advance.",
    " *",
    " * Keyed by owner rather than by record name because an INLINE record has no",
    " * name of its own - `table.rowGroups` is findable only through the position",
    " * that holds it - and because a field name does not identify a record on its",
    " * own: `bodies` means one thing under `table.rowGroups` and would mean",
    " * another anywhere else the schema spells it.",
    " *",
    " * An owner may itself be a record: `table.rowGroups` owns `bodies`, whose",
    " * groups own an `attrs`. That nesting is the reason this is a map of maps",
    " * rather than a flat list of two names - a pass that closed only what hangs",
    " * off a NODE would leave `rowGroups.bodies` open, which is the reported",
    " * defect surviving its own fix.",
    " */",
    "export const WIRE_NESTED_RECORDS: Readonly<",
    "  Record<string, Readonly<Record<string, { record: string; array: boolean }>>>",
    "> = {",
  ].join("\n");
  const byOwner = new Map();
  for (const [position, nested] of nestedAt) {
    const cut = position.lastIndexOf(".");
    const owner = position.slice(0, cut);
    const field = position.slice(cut + 1);
    if (!byOwner.has(owner)) byOwner.set(owner, new Map());
    byOwner.get(owner).set(field, nested);
  }
  const nestedList = [...byOwner.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([owner, fields]) =>
        `  ${JSON.stringify(owner)}: { ${[...fields.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(
            ([field, nested]) =>
              `${JSON.stringify(field)}: { record: ${JSON.stringify(nested.record)}, array: ${nested.array} }`,
          )
          .join(", ")} },`,
    )
    .join("\n");
  return `${header}\n${sorted(byType)}\n${middle}\n${sorted(recordFields)}\n${tail}\n${list}\n${kindDoc}\n${kindList}\n${schemaDoc}\n${requiredList}\n${kindsDoc}\n${kindsList}\n${typesDoc}\n${typesList}\n${nestedDoc}\n${nestedList}\n}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const schema = JSON.parse(
    readFileSync(resolve(root, "spec/resources/ast-schema.json"), "utf8"),
  );
  writeFileSync(resolve(root, "src/wire-fields.ts"), wireFieldsSource(schema));
  console.log("src/wire-fields.ts written from spec/resources/ast-schema.json");
}
