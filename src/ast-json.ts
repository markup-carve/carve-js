/**
 * Serialize a parsed document to the PART 12 exchange shape.
 *
 * The runtime `Document` keeps two pieces of document-level content on the
 * ROOT: `frontmatter`, and `footnoteDefs` keyed by label. PART 12 §7 requires
 * the serialized root to carry exactly `type`, `children` and `srcByteLength`,
 * with both of those as block nodes in the tree, because a root FIELD cannot
 * carry the `pos` §4 requires of every node - and a footnote body or a
 * frontmatter block is source an editor navigates to (carve#411).
 *
 * The runtime shape is deliberately left alone. Renderers, extensions and the
 * profile filter read `footnoteDefs` from the root in some 39 places, and
 * downstream consumers (carve-lsp, pandoc-carve) read it too, so reshaping the
 * in-memory tree would be a breaking change made to serve a wire format.
 * PART 12 §1 anticipates exactly this: an implementation whose internals differ
 * "MAPS on the way out; it does not export its internals".
 *
 * The two wire node types are declared HERE rather than added to `BlockNode`.
 * Widening that union would force every exhaustive switch in every renderer to
 * handle nodes the renderers never see, since neither type exists in a parsed
 * tree - they are produced only by this function.
 *
 * Consumers that need conformant JSON must call this rather than stringifying
 * `parse()` directly.
 */

import type { BlockNode, Document, Position } from './ast.js'
import { MAX_NESTING_DEPTH } from './parse.js'
import { numberCaptionsIn } from './heading-ids.js'
import {
  entriesFromWire,
  entriesToWire,
  isRuntimeEntry,
  type DefinitionEntryNode,
} from './definition-list-wire.js'
import {
  NODE_FIELDS,
  NODE_POSITION_KIND,
  WIRE_FIELDS,
  WIRE_HELPER_FIELDS,
} from './wire-fields.js'

/** Frontmatter as a block node (PART 12 §7): raw text plus its fence token. */
export interface FrontmatterNode {
  type: 'frontmatter'
  /** The fence's info word, or `'yaml'` when it carries none. */
  format: string
  /** The text between the fences, verbatim. Never parsed. */
  content: string
  pos?: Position
}

/** A footnote definition as a block node (PART 12 §7). */
export interface FootnoteDefNode {
  type: 'footnote'
  /**
   * The label as written, without `[^` and `]:`.
   *
   * `label`, not `id`, per PART 12 §7: PART 9 §16 calls it a label throughout,
   * and `id` collides with the attribute of that name. This engine and
   * carve-php both shipped `id` first - matching `footnote_ref.id` - and the
   * spec settled it the other way when the node moved into the tree (carve#418).
   *
   * {@link fromAstJson} still ACCEPTS `id` on input, because trees written by
   * the earlier spelling exist and a stored document cannot be recalled.
   */
  label: string
  children: BlockNode[]
  pos?: Position
}

export type AstJsonBlock = BlockNode | FrontmatterNode | FootnoteDefNode

/**
 * The document root, per PART 12 §7: three fields, nothing else.
 *
 * All three are REQUIRED, matching `resources/ast-schema.json`. `srcByteLength`
 * was optional here while §12 makes `fromAstJson` refuse a root without it, so
 * a TypeScript consumer could build a value the compiler accepted and the
 * decoder rejected - the mismatch this type exists to prevent.
 */
export interface AstJsonDocument {
  type: 'document'
  children: AstJsonBlock[]
  srcByteLength: number
}

/**
 * Fields that hold child nodes, in the order a walk should follow them.
 *
 * Listed rather than discovered, because two fields that look like child lists
 * are not: a citation group's `items` and a definition list's `items` hold
 * plain objects in the runtime tree, and walking them as nodes would rewrite
 * data that is not one.
 */
const CHILD_FIELDS = ['children', 'items', 'rows', 'cells', 'inline', 'content', 'caption', 'title'] as const

/**
 * Rewrite definition lists into their wire shape, everywhere in a subtree, and
 * drop the runtime-only fields above.
 *
 * Structurally shared: a branch with nothing to rewrite comes back as the SAME
 * object, so `toAstJson` still leaves the runtime document untouched and a
 * large document does not pay for a deep copy it does not need.
 */
function definitionListsToWire<T>(node: T): T {
  if (Array.isArray(node)) {
    let changed = false
    const mapped = node.map((child) => {
      const next = definitionListsToWire(child)
      if (next !== child) changed = true
      return next
    })
    return (changed ? mapped : node) as T
  }
  if (typeof node !== 'object' || node === null) return node

  const record = node as Record<string, unknown>
  let out: Record<string, unknown> | undefined

  if (record['type'] === 'definition_list' && Array.isArray(record['items'])) {
    const items = record['items']
    if (items.every(isRuntimeEntry)) {
      out = { ...record, items: entriesToWire(items) as unknown as DefinitionEntryNode[] }
    }
  }

  for (const field of CHILD_FIELDS) {
    const value = (out ?? record)[field]
    if (value === undefined) continue
    // A definition list's own `items` was just rewritten; walking it again
    // would descend into wire nodes as if they were runtime ones.
    if (field === 'items' && (out ?? record)['type'] === 'definition_list') {
      const mapped = definitionListsToWire(value)
      if (mapped !== value) out = { ...(out ?? record), [field]: mapped }
      continue
    }
    const mapped = definitionListsToWire(value)
    if (mapped !== value) out = { ...(out ?? record), [field]: mapped }
  }

  const target = (out ?? record)['target']
  if (target !== undefined) {
    const mapped = definitionListsToWire(target)
    if (mapped !== target) out = { ...(out ?? record), target: mapped }
  }

  // A resolved crossref carries the target heading's inline content for the
  // renderers, and PART 12 §3a keeps it OFF the wire: the heading is in the
  // same document, so a consumer reads the text from there rather than from a
  // copy in every reference. `target` and `href` - the authored construct and
  // its resolution - are what the node publishes.
  if ((out ?? record)['type'] === 'heading_ref' && (out ?? record)['resolvedText'] !== undefined) {
    const { resolvedText: _resolvedText, ...rest } = out ?? record
    out = rest
  }

  // A footnote reference's `refId` is a RENDERING convention - `fnref1`, the
  // anchor an endnotes section links back to - not a resolution result. The
  // schema declared it and no engine ever produced one, so carve#762 removed
  // it, and `additionalProperties: false` now makes a tree carrying it invalid.
  //
  // This engine never wrote one. It ECHOED one: the wire record is copied
  // wholesale, so a `refId` that arrived on a payload came straight back out,
  // and a document read and re-published here became one the format rejects
  // (carve-js#707). The runtime field stays - `renderHtml` assigns it to build
  // the backlinks - it just does not cross the wire in either direction.
  if (
    ((out ?? record)['type'] === 'footnote_ref' ||
      (out ?? record)['type'] === 'inline_footnote') &&
    (out ?? record)['refId'] !== undefined
  ) {
    const { refId: _refId, ...rest } = out ?? record
    out = rest
  }

  // Same shape, same answer (carve#793). `escapedLeadingCaret` records that a
  // text node's leading `^` came from `\^`, which keeps the image above it
  // from being promoted to a figure - a fact the parser needs and the WIRE
  // already carries, since an `escaped_text` node holding `"^"` sits
  // immediately before the flagged node. carve-rs and carve-php publish
  // neither, and a field one engine publishes alone is one no consumer can
  // rely on. Internal from here; stripped at the boundary like `refId`.
  if ((out ?? record)['type'] === 'text' && (out ?? record)['escapedLeadingCaret'] !== undefined) {
    const { escapedLeadingCaret: _flag, ...rest } = out ?? record
    out = rest
  }

  return (out ?? record) as T
}

/** The inverse: wire entries back to the runtime `{terms, definitions}` form. */
function definitionListsFromWire<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((child) => definitionListsFromWire(child)) as unknown as T
  }
  if (typeof node !== 'object' || node === null) return node

  const record = { ...(node as Record<string, unknown>) }

  if (record['type'] === 'definition_list' && Array.isArray(record['items'])) {
    // A payload already in the runtime form decodes unchanged: older stored
    // trees carry it, and this engine produced them.
    record['items'] = record['items'].every(isRuntimeEntry)
      ? record['items']
      : entriesFromWire(record['items'])
    return record as T
  }

  for (const field of CHILD_FIELDS) {
    if (record[field] !== undefined) record[field] = definitionListsFromWire(record[field])
  }
  if (record['target'] !== undefined) record['target'] = definitionListsFromWire(record['target'])

  // Not read either, so an ingested reference does not arrive already carrying a
  // backlink anchor from whoever wrote the payload. `renderHtml` assigns
  // `refId` itself from the number, and an inherited one would be the previous
  // document's numbering rather than this one's (carve-js#707).
  if (
    (record['type'] === 'footnote_ref' || record['type'] === 'inline_footnote') &&
    record['refId'] !== undefined
  ) {
    delete record['refId']
  }

  return record as T
}

/** The definition kinds §7 COLLECTS, which is what §7 then orders. */
const COLLECTED_DEFINITION_TYPES = new Set([
  'link_reference_definition',
  'footnote',
])

/**
 * PART 12 §7: "Definitions appear in DOCUMENT ORDER by source position."
 *
 * Collection moves a definition to the document and §4 keeps the `pos` it was
 * written at, so the published order has to follow that `pos` rather than the
 * machinery that did the collecting. This engine appended link definitions in
 * the parser and footnotes here, so a link definition preceded a footnote
 * whatever the author wrote, and `pos` ran backwards between two siblings.
 *
 * Only the COLLECTED kinds move. An `abbreviation_def` is not collected out of
 * the document - §7 refuses that specifically, since hoisting it would empty
 * the line rather than relocate visible output - so it already sits at its
 * source position and is left where it is.
 *
 * The sort is confined to the slots the collected definitions already occupy,
 * so no other child changes index. It is stable, which keeps two definitions
 * that report the same offset in the order they were collected.
 */
function orderCollectedDefinitions(children: AstJsonBlock[]): void {
  const slots: number[] = []
  for (let i = 0; i < children.length; i++) {
    if (COLLECTED_DEFINITION_TYPES.has(children[i]!.type)) slots.push(i)
  }
  if (slots.length < 2) return
  const ordered = slots
    .map((i) => children[i]!)
    .sort((a, b) => (a.pos?.startOffset ?? 0) - (b.pos?.startOffset ?? 0))
  for (let k = 0; k < slots.length; k++) children[slots[k]!] = ordered[k]!
}

/**
 * Map a document onto the exchange shape.
 *
 * Frontmatter becomes the FIRST child, which is where it was written. Footnote
 * definitions become `footnote` children of the DOCUMENT, matching PART 9 §16:
 * a definition is document-level metadata lifted out of whatever container held
 * it, so it belongs to the document rather than to that container.
 */
export function toAstJson(doc: Document): AstJsonDocument {
  const children: AstJsonBlock[] = []

  if (doc.frontmatter !== undefined) {
    const node: FrontmatterNode = {
      type: 'frontmatter',
      format: doc.frontmatter.format,
      content: doc.frontmatter.content,
    }
    // §4 wants a position on every node but the root. These two are SYNTHESIZED
    // here from data the parser kept on the root, so unless the parser recorded
    // a span there is none to give - and they were the only content in a
    // serialized document that could not be navigated to (carve-js#480).
    if (doc.frontmatter.pos !== undefined) node.pos = doc.frontmatter.pos
    children.push(node)
  }

  children.push(...definitionListsToWire(doc.children))

  for (const [label, body] of Object.entries(doc.footnoteDefs ?? {})) {
    const node: FootnoteDefNode = {
      type: 'footnote',
      label,
      children: definitionListsToWire(body),
    }
    const pos = doc.footnoteDefPos?.[label]
    if (pos !== undefined) node.pos = pos
    children.push(node)
  }

  orderCollectedDefinitions(children)

  // ALWAYS emitted, even when the runtime document has no length to report.
  // `srcByteLength` is `required` in the schema, so a root without it is not a
  // Carve AST - and `parse` is not the only way a `Document` gets built: an
  // editor, a language server or an extension can hand one over, and this
  // encoder used to publish an invalid tree for exactly those. §12 then refused
  // this engine's OWN output, which §9(a) forbids.
  //
  // 0 is the honest answer to "how much source was this" for a tree that came
  // from no source, and §12 explicitly does not check the value. carve-php took
  // the same route for the same reason (carve-php#917).
  const out: AstJsonDocument = { type: 'document', children, srcByteLength: doc.srcByteLength ?? 0 }
  return out
}

/**
 * The inverse of {@link toAstJson}: an exchange-shape document to the runtime
 * `Document` this engine's renderers, extensions and profile filter expect.
 *
 * PART 12 §6 requires `parse(x)` serialized and deserialized to equal
 * `parse(x)`, and a format with only one direction cannot be checked against
 * that at all - the round trip is the rule that catches a serializer quietly
 * dropping a field, one document before a consumer does.
 *
 * Input is treated as DATA, not as a trusted tree: a `footnote` child missing
 * its label, or a `frontmatter` child carrying something other than strings, is
 * left alone rather than adopted, so a malformed document degrades to "an
 * unrecognized node" instead of throwing halfway through a conversion.
 */
/**
 * Thrown when an ingested AST nests deeper than the reader will follow.
 *
 * A typed error rather than whatever the runtime does on its own: without this
 * a deep payload walked until the JS call stack ran out and surfaced a
 * `RangeError`, at a depth that varies by engine and by how much stack the
 * caller had already used (carve-js#498).
 */
export class AstJsonDepthError extends Error {
  constructor(readonly depth: number) {
    super(
      `AST nests ${depth} levels, deeper than the reader's cap of ${MAX_AST_JSON_DEPTH}`,
    )
    this.name = 'AstJsonDepthError'
  }
}

/**
 * Thrown when the payload's root is not a `document`.
 *
 * PART 12 §9 closes with the reason: "The root type is not a leniency point:
 * §7 fixes it at `document`, and the schema pins it as a `const`. An ingest
 * accepting some other root (`doc`, say, which is ProseMirror's) will half-read
 * a foreign format rather than reject it."
 *
 * This reader used to write `type: 'document'` into the tree it returned no
 * matter what arrived, so a ProseMirror payload - the clause's own example -
 * was accepted AND had the evidence normalized away: the caller got a valid
 * Carve document back and no way to learn its input had not been one.
 */
export class AstJsonRootError extends Error {
  constructor(readonly found: unknown) {
    super(
      `AST root type ${JSON.stringify(found)} is not "document"; the root is fixed by PART 12 §7`,
    )
    this.name = 'AstJsonRootError'
  }
}

/**
 * Thrown when the root omits one of the three fields PART 12 §7 fixes.
 *
 * §12(a): "A ROOT MISSING ANY OF THE THREE FIELDS. Not defaulted, not inferred.
 * A reader that supplies `children: []` for a payload that carried no
 * `children` has turned a truncated document into an empty one and reported
 * success."
 *
 * This reader used to do exactly that - a missing `children` fell through to
 * `Array.isArray(json.children) ? json.children : []` and produced an empty
 * document, and a missing `srcByteLength` was simply left off the result. Both
 * handed the caller a valid-looking Carve document with no way to learn the
 * input had not been one, which is the same objection `AstJsonRootError` above
 * makes to accepting a foreign root type.
 */
export class AstJsonRootFieldError extends Error {
  constructor(readonly field: string) {
    super(
      `AST root is missing ${JSON.stringify(field)}; PART 12 §7 fixes the root at ` +
        '"type", "children" and "srcByteLength", and §12 refuses a root without one',
    )
    this.name = 'AstJsonRootFieldError'
  }
}

/**
 * Thrown when a node's `type` is a name the schema does not have.
 *
 * §12(c) puts this refusal AT DECODE rather than in a renderer. This engine
 * used to accept the node and throw `renderHtml: unknown block ...` one step
 * later, which reads to a caller as a rendering problem for what is really a
 * payload problem - and never arrives at all for a formatter, a linter, a
 * language server or an indexer that holds the tree and never renders it.
 *
 * The walk follows NODE POSITIONS (`NODE_FIELDS`, derived from the schema) and
 * deliberately never enters `attrs.keyValues`: attribute names are ordinary
 * identifiers, so `[x](/u){type=widget}` puts an object literally shaped
 * `{"type":"widget"}` in the tree, and refusing that would refuse a document
 * this engine's own parser just produced - which §9(a) forbids.
 */
export class AstJsonUnknownNodeTypeError extends Error {
  constructor(
    readonly nodeType: string,
    readonly path: string,
  ) {
    super(
      `AST node at ${path === '' ? 'the root' : path} has type ${JSON.stringify(nodeType)}, ` +
        'which the schema does not name (PART 12 §12)',
    )
    this.name = 'AstJsonUnknownNodeTypeError'
  }
}

/**
 * Thrown when a node in a node position has no usable `type` at all - the key is
 * absent, or it is present carrying something that is not a string.
 *
 * The SAME clause as the error above, §12(c), and separated from it only because
 * that one's `nodeType` is typed `string` and there is no string to report here.
 * A `type` of `7` or `null` or `{}` names no schema type just as surely as
 * `"wat"` does, so the refusal belongs at decode for the same reason:
 *
 *     (c) A NODE WHOSE `type` THE SCHEMA DOES NOT NAME, AT DECODE. Not in a
 *     renderer, one step later.
 *
 * This engine used to carry such a node all the way into `renderHtml`, which
 * reported `unknown block undefined` - a RENDERING problem for what is a payload
 * problem, and one that never arrives at all for a caller that holds the tree
 * without rendering it: `carve fmt --from-json`, a linter, a language server, an
 * indexer. carve-rs and carve-php both refuse at decode
 * (markup-carve/carve#881).
 *
 * The reported value is `typeof`-and-JSON rather than the raw value, because the
 * raw value is what produced `[object Object]` in the old message.
 */
export class AstJsonNodeTypeError extends Error {
  constructor(
    readonly found: unknown,
    readonly path: string,
  ) {
    const described =
      found === undefined ? 'no "type"' : `a "type" of ${JSON.stringify(found) ?? typeof found}`
    super(
      `AST node at ${path === '' ? 'the root' : path} has ${described}; ` +
        'every node carries a string "type" the schema names (PART 12 §12)',
    )
    this.name = 'AstJsonNodeTypeError'
  }
}

/**
 * Thrown when a node carries a property the schema does not name.
 *
 * PART 12 §11: "An ingest MUST REFUSE it with AN ERROR OF ITS OWN -- a typed,
 * documented failure naming the offending property and the PATH it appeared at,
 * so a caller can find it in a tree it did not write. Not a silent drop, and
 * not a pass-through."
 *
 * The pass-through was this engine's behavior, and it failed on its own
 * contract rather than on taste: the codec copied a wire record wholesale, so
 * re-serializing echoed the property back and the OUTPUT stopped validating
 * against a schema that closes every node with `additionalProperties: false`.
 * Measured before the fix, 29 of 31 injected properties survived a round trip
 * (carve-js#709).
 */
export class AstJsonUnknownFieldError extends Error {
  constructor(
    readonly property: string,
    readonly path: string,
    readonly nodeType: string,
  ) {
    super(
      `AST node ${nodeType} at ${path} carries ${JSON.stringify(property)}, which the schema does not name (PART 12 §11)`,
    )
    this.name = 'AstJsonUnknownFieldError'
  }
}

/**
 * A property this engine READS that the schema does not name.
 *
 * §11 refuses what an ingest cannot understand; this one it understands
 * exactly. `label` is the spec spelling for a footnote definition's label, and
 * `id` is what this engine and carve-php published before PART 12 §7 settled
 * it - trees written then are stored, and the decoder already maps the old
 * spelling onto the new field. Refusing them would not protect a caller from a
 * half-read tree, it would take away the only reader that reads them whole.
 *
 * Deliberately ONE entry rather than an escape hatch: a legacy alias qualifies
 * only when the decoder demonstrably maps it onto a named field.
 */
const LEGACY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  footnote: ['id'],
}

function refuseUnknownFields(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => refuseUnknownFields(item, `${path}[${index}]`))
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  const type = record.type
  // A node kind the schema does not name at all is NOT this error's business:
  // the decoder turns an unusable kind away on its own terms, and reporting a
  // field on a type nobody names would send the caller after the wrong thing.
  const known = typeof type === 'string' ? WIRE_FIELDS[type] : undefined
  if (known !== undefined) {
    const allowed = new Set([...known, ...(LEGACY_ALIASES[type as string] ?? [])])
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) throw new AstJsonUnknownFieldError(key, path, type as string)
    }
    // The two objects that hang off a node without a `type` of their own. They
    // are closed in the schema too, and every node kind can carry them, which
    // makes them the easiest place to smuggle a key past a type-keyed check.
    for (const helper of Object.keys(WIRE_HELPER_FIELDS)) {
      const value = record[helper]
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const allowedHelper = new Set(WIRE_HELPER_FIELDS[helper])
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!allowedHelper.has(key)) {
          throw new AstJsonUnknownFieldError(key, `${path}.${helper}`, helper)
        }
      }
    }
  }
  for (const [key, value] of Object.entries(record)) {
    refuseUnknownFields(value, path === '' ? key : `${path}.${key}`)
  }
}

/**
 * A node position where a LEGACY payload carries a record with no `type`.
 *
 * The same shape of exception as `LEGACY_ALIASES` above, and it earns its place
 * the same way: the decoder demonstrably reads the old form. A definition list
 * used to be published as `items: [{terms, definitions}]` - a grouping record,
 * not a node - and `definitionListsFromWire` still maps it, because trees
 * written then are stored and a stored document cannot be recalled.
 *
 * Deliberately ONE entry and hand written rather than generated: the schema
 * describes the CURRENT form, where `definition_list.items` holds
 * `definition_term` and `definition_description` nodes, and it is right to. This
 * records that the decoder accepts more than the schema describes at exactly one
 * position, which is a fact about this engine's history rather than about the
 * format.
 */
const LEGACY_TYPELESS_POSITIONS: ReadonlySet<string> = new Set(['definition_list.items'])

/**
 * The node-bearing fields of those legacy records, which the schema does not
 * name and `NODE_FIELDS` therefore cannot know about.
 *
 * A legacy definition entry keeps its content under `terms` and `definitions`,
 * both arrays OF ARRAYS of nodes. Without this the walk reached the entry record
 * and stopped, so every node inside a stored definition list was unchecked -
 * including against the string-type half of §12(c) that was already
 * implemented: `{"type":"wat"}` under `terms` decoded and then failed in the
 * renderer as `unknown inline wat`, which is the arrival point the clause rules
 * out.
 *
 * Applied only where the record carries no `type` of its own. On a typed node
 * these names are properties the schema does not name, and §11 refuses them
 * before this could matter.
 */
const LEGACY_RECORD_FIELDS: readonly string[] = ['terms', 'definitions']

/**
 * Refuse, at decode, a node whose `type` the schema does not name (PART 12
 * §12(c)) - whether the name is unknown, absent, or not a string at all.
 *
 * @param requireType whether THIS value sits where a node must be. It is decided
 *   by the caller from `NODE_POSITION_KIND`, because one field name means
 *   different things in different places: `items` holds nodes on `list` and
 *   plain `citation` records on `citation_group`.
 */
function refuseUnknownNodeTypes(node: unknown, path: string, requireType: boolean): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => refuseUnknownNodeTypes(item, `${path}[${index}]`, requireType))
    return
  }
  // A `null` or a string in a node position is NOT this check's business: it is
  // part of the wrong-type class markup-carve/carve#881 leaves unruled, and
  // refusing it here would decide that question by accident.
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  const type = record.type
  if (typeof type !== 'string') {
    // §12(c). A missing `type`, or one carrying a number, `null`, an array, an
    // object or a boolean, names no schema type - so it is refused HERE and not
    // by the renderer two steps later.
    if (requireType) throw new AstJsonNodeTypeError(type, path)
  } else if (WIRE_FIELDS[type] === undefined) {
    throw new AstJsonUnknownNodeTypeError(type, path)
  }
  // Only node-bearing fields, never every key: `attrs.keyValues` is a
  // string-to-string map whose keys are ordinary attribute identifiers, so a
  // blanket walk finds `{"type":"widget"}` there and refuses a document the
  // parser produced.
  const fields =
    typeof type === 'string' ? NODE_FIELDS : [...NODE_FIELDS, ...LEGACY_RECORD_FIELDS]
  for (const field of fields) {
    const value = record[field]
    if (value === undefined) continue
    const position = typeof type === 'string' ? `${type}.${field}` : undefined
    // A record with no `type` of its own is one the schema gives none - a
    // citation item today - and its own array fields hold real nodes, so the
    // requirement comes back on for them.
    const kind =
      position === undefined
        ? 'nodes'
        : LEGACY_TYPELESS_POSITIONS.has(position)
          ? 'records'
          : NODE_POSITION_KIND[position]
    refuseUnknownNodeTypes(
      value,
      path === '' ? field : `${path}.${field}`,
      // `nodes` is about the ELEMENTS: a non-array where the array belongs is
      // the unruled wrong-type class, and `children: {}` still degrades to an
      // empty document rather than being decided here.
      kind === 'node' ? true : kind === 'nodes' ? Array.isArray(value) : false,
    )
  }
}

/**
 * Deepest node nesting `fromAstJson` will ingest.
 *
 * PART 12 §9 states the contract as a property, not a number: ingest MUST
 * accept anything this engine's own parser can produce at `MAX_NESTING_DEPTH`,
 * and MUST refuse deeper input with an error of its own rather than a
 * `RangeError` at whatever depth the JS stack happens to give out.
 *
 * Counted in NODES, and the number is DERIVED from the worst per-level cost of
 * the encoding, never restated from the parser's cap. The parser counts
 * CONTAINER nesting; a container costs a different number of nodes depending on
 * which container it is:
 *
 * - a div or blockquote is one node per level
 * - a LIST is two - the list and its item
 *
 * Measured at the parser's cap of 200: div ladder 202 nodes, blockquote chain
 * 202, table under a deep chain 201, and a LIST LADDER 402. A cap derived as
 * "the parser's number plus a small margin" therefore rejects a document the
 * parser just produced - which is how carve-rs#389 happened, and what the first
 * draft of this constant (`MAX_NESTING_DEPTH + 8`) did to a 200-deep list.
 *
 * So: three nodes per level, which covers the two-node list with room for a
 * container that costs more, plus a constant for the innermost leaf. That
 * lands far below the depth where the decoder's own recursion gives out
 * (measured: 1500 levels decode, 2000 raise a RangeError), so the typed error
 * always wins the race against the stack.
 */
export const MAX_AST_JSON_DEPTH = MAX_NESTING_DEPTH * 3 + 32

/**
 * Deepest WALK the reader will follow, arrays counted.
 *
 * Node depth alone does not bound the walk. An array is a child list rather
 * than a level of its own, which is the right way to count NODES - but a
 * payload of nothing but nested arrays then measures zero nodes, passes the cap
 * above, and the conversion walk recurses over it until the stack gives out. So
 * `[[[[ ... ]]]]` still raised a `RangeError`, the exact failure
 * `AstJsonDepthError` was added to replace.
 *
 * Every level counts here: one array plus one node per level is the worst an
 * honest payload does, so twice the node cap clears anything the encoder emits,
 * and the constant keeps this off the boundary.
 */
export const MAX_AST_JSON_WALK = MAX_AST_JSON_DEPTH * 2 + 32

/** The child-bearing fields, `target` included, each named exactly once. */
const DEPTH_WALK_FIELDS = [...new Set<string>([...CHILD_FIELDS, 'target'])]

/**
 * Node depth of a payload, measured with an EXPLICIT STACK.
 *
 * Deliberately not recursive: this exists to reject input too deep to recurse
 * over, so measuring it by recursion would overflow on exactly the payload it
 * is meant to refuse. Stops as soon as the cap is exceeded rather than walking
 * a whole hostile tree.
 */
function astJsonDepth(
  root: unknown,
  limit: number,
  walkLimit: number,
): { nodes: number; walk: number } {
  let deepest = 0
  let deepestWalk = 0
  const stack: Array<{ node: unknown; depth: number; walk: number }> = [
    { node: root, depth: 0, walk: 0 },
  ]

  while (stack.length > 0) {
    const { node, depth, walk } = stack.pop()!
    if (depth > deepest) deepest = depth
    if (walk > deepestWalk) deepestWalk = walk
    // Either bound is enough to refuse the payload, and stopping at the first
    // one keeps a hostile tree from being walked in full.
    if (deepest > limit || deepestWalk > walkLimit) return { nodes: deepest, walk: deepestWalk }

    if (Array.isArray(node)) {
      // An array is a child LIST, not a level of its own - the nodes in it are.
      // It IS a level of the walk, though: the conversion recurses through it.
      for (const child of node) stack.push({ node: child, depth, walk: walk + 1 })
      continue
    }
    if (typeof node !== 'object' || node === null) continue

    const record = node as Record<string, unknown>
    // `items` is already in CHILD_FIELDS: pushing it again doubled the work for
    // every level of a nested list, so measuring a 30-deep list took minutes and
    // a 40-deep one never finished. The fields are walked ONCE each.
    for (const field of DEPTH_WALK_FIELDS) {
      if (record[field] !== undefined)
        stack.push({ node: record[field], depth: depth + 1, walk: walk + 1 })
    }
  }

  return { nodes: deepest, walk: deepestWalk }
}

export function fromAstJson(json: AstJsonDocument): Document {
  // A STRING is the mistake the name invites - `fromAstJson` reads as "from AST
  // JSON", carve-php spells the same entry point `decodeJson`, and carve-rs's
  // CLI flag is `--from-json`; all three of those take text. This one takes the
  // parsed tree. Without this arm the string falls through to the root check and
  // is reported as `AST root type undefined is not "document"`, which sends the
  // caller looking at their document instead of at their call (carve-js#703).
  if (typeof json === 'string') {
    throw new TypeError(
      'fromAstJson takes a parsed AST object, not a JSON string; call JSON.parse first',
    )
  }
  // Checked BEFORE the depth walk: a foreign payload should be turned away for
  // being foreign, not for however deep it happens to be.
  if (json?.type !== 'document') throw new AstJsonRootError(json?.type)
  // PART 12 §12(a), and before the depth walk for the same reason the root type
  // is: a payload that is not this format should be turned away for that, not
  // for however deep it happens to be. `in` rather than a value test - (a) is
  // about the field being PRESENT, and the value of `srcByteLength` is
  // explicitly not this clause's business.
  for (const field of ['children', 'srcByteLength'] as const) {
    if (!(field in json)) throw new AstJsonRootFieldError(field)
  }

  const { nodes, walk } = astJsonDepth(json, MAX_AST_JSON_DEPTH, MAX_AST_JSON_WALK)
  if (nodes > MAX_AST_JSON_DEPTH) throw new AstJsonDepthError(nodes)
  if (walk > MAX_AST_JSON_WALK) throw new AstJsonDepthError(walk)

  // AFTER the depth bound, so a payload built to blow the stack is turned away
  // by the cheap check rather than by a full walk of itself (PART 12 §9).
  refuseUnknownNodeTypes(json, '', true)
  refuseUnknownFields(json, '')

  const children: BlockNode[] = []
  const footnoteDefs: Record<string, BlockNode[]> = {}
  const footnoteDefPos: Record<string, Position> = {}
  let frontmatter: Document['frontmatter']

  // A root whose `children` is not an array is not iterable, and this is the
  // entry point for a file someone was handed. An empty document is the honest
  // reading of "no children I can walk"; throwing here would turn malformed
  // input into a stack trace at the CLI.
  for (const child of Array.isArray(json.children) ? json.children : []) {
    if (child?.type === 'frontmatter' && frontmatter === undefined) {
      const node = child as FrontmatterNode
      if (typeof node.format === 'string' && typeof node.content === 'string') {
        frontmatter = { format: node.format, content: node.content }
        // §6 makes the round trip identity, so the span has to come back too -
        // it is on the node here and on the root in the runtime document.
        if (node.pos !== undefined) frontmatter.pos = node.pos
        continue
      }
    }
    if (child?.type === 'footnote') {
      // `label` is the spec spelling; `id` is what this engine and carve-php
      // published before PART 12 §7 settled it, and those trees are stored.
      const node = child as FootnoteDefNode & { id?: string }
      const label = typeof node.label === 'string' ? node.label : node.id
      // `children` has to be an array to be a definition BODY. Adopting a
      // string here puts it where every renderer iterates footnote bodies
      // without checking, so the failure would surface as a crash inside the
      // renderer for a document the decoder had already accepted.
      if (typeof label === 'string' && Array.isArray(node.children)) {
        if (footnoteDefs[label] === undefined) {
          footnoteDefs[label] = definitionListsFromWire(node.children)
          if (node.pos !== undefined) footnoteDefPos[label] = node.pos
        }
        continue
      }
      // Unusable as a definition, and `footnote` is a type no renderer has a
      // case for - a definition renders where its REFERENCE appears, never in
      // place. Keeping it would trade a decoder error for a renderer crash, so
      // it is dropped and a reference to it reads as unresolved, which is what
      // a missing definition already means.
      continue
    }
    children.push(definitionListsFromWire(child) as BlockNode)
  }

  const doc: Document = { type: 'document', children }
  if (frontmatter !== undefined) doc.frontmatter = frontmatter
  if (Object.keys(footnoteDefs).length > 0) doc.footnoteDefs = footnoteDefs
  if (Object.keys(footnoteDefPos).length > 0) doc.footnoteDefPos = footnoteDefPos
  if (json.srcByteLength !== undefined) doc.srcByteLength = json.srcByteLength

  // RE-DERIVED, not adopted. `number` is a resolution result PART 12 §5
  // serializes, and the payload's value describes the document the payload was
  // made from - not this one. An editor that deletes a footnote definition and
  // hands the tree back leaves a reference whose definition is gone, and copying
  // its number republished the number of a footnote that is not in the document,
  // while this engine's own renderer showed the reference as literal `[^a]`
  // (carve#758).
  //
  // The same argument the profile filter already makes, from the other
  // direction: `footnote-numbering.ts` clears a number it cannot justify because
  // "the profile filter can take a definition away AFTER the document was
  // numbered". Deserializing an edited tree is the other way for that to happen,
  // and it lands in the same place. carve-php recomputes here too.
  //
  // CLEARS, NEVER ASSIGNS. Running the full numbering pass here breaks §6: the
  // round trip is `parse(x)` serialized and deserialized, and `parse()` alone
  // does no numbering - resolution does - so a tree that legitimately carries no
  // numbers would come back carrying them. What this must not do is keep a
  // number it can no longer justify; inventing one is a different act entirely.
  //
  // An inline footnote carries its own body, so it cannot lose a definition and
  // is left alone. Only a reference can be orphaned.
  clearUnbackedFootnoteNumbers(doc, footnoteDefs)
  renumberCaptionsIfPublished(doc)

  return doc
}

/**
 * Re-derive `caption_number.n` when the payload published numbers at all.
 *
 * The other PART 12 §5 result on this path, and the worse one: a stale footnote
 * number contradicted the renderer, a stale caption number is what the renderer
 * PRINTS. Delete the first of two numbered figures from a published tree and the
 * survivor still rendered `Figure 2` - for the only figure in the document,
 * where a fresh parse gives `Figure 1` (carve#758).
 *
 * CONDITIONAL, for the same §6 reason the footnote pass clears rather than
 * assigns: `parse()` alone does no numbering in this engine, so its serialized
 * tree carries no `n`, and assigning here unconditionally would make the round
 * trip add numbers that were never there. A payload that published numbers is
 * one whose numbers have to describe THIS document; a payload that published
 * none is pre-resolve and stays that way.
 *
 * carve-rs runs its pass unconditionally instead, and is right to: numbering
 * happens during `parse` there, so an ingested tree numbered the same way agrees
 * with a parsed one.
 */
function renumberCaptionsIfPublished(doc: Document): void {
  const bodies = doc.footnoteDefs ? Object.values(doc.footnoteDefs) : []
  if (!hasPublishedCaptionNumber(doc.children) && !bodies.some(hasPublishedCaptionNumber)) return

  const counters = new Map<string, number>()
  numberCaptionsIn(doc.children, counters)
  for (const body of bodies) numberCaptionsIn(body, counters)
}

/** Whether any `caption_number` in `blocks` arrived carrying a number. */
function hasPublishedCaptionNumber(blocks: unknown): boolean {
  const stack: unknown[] = [blocks]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item)
      continue
    }
    if (cur === null || typeof cur !== 'object') continue
    const node = cur as { type?: string; n?: number }
    if (node.type === 'caption_number' && node.n !== undefined) return true
    for (const value of Object.values(cur)) {
      if (value !== null && typeof value === 'object') stack.push(value)
    }
  }

  return false
}

/**
 * Drop `number` from any footnote REFERENCE whose definition is not in `defs`.
 *
 * Iterative, so a tree deeper than any renderer's ceiling - this reader accepts
 * up to MAX_AST_JSON_DEPTH, which is higher - is walked rather than refused. A
 * recursive version would also have to answer which depth bound applies, and the
 * two count different units (JSON structural levels against render levels), which
 * is the comparison §25 warns against making.
 */
function clearUnbackedFootnoteNumbers(
  doc: Document,
  defs: Record<string, BlockNode[]>,
): void {
  const stack: unknown[] = [doc.children, Object.values(defs)]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item)
      continue
    }
    if (cur === null || typeof cur !== 'object') continue
    const node = cur as { type?: string; id?: string; number?: number }
    if (node.type === 'footnote_ref' && node.number !== undefined) {
      if (node.id === undefined || defs[node.id] === undefined) delete node.number
    }
    for (const value of Object.values(cur)) {
      if (value !== null && typeof value === 'object') stack.push(value)
    }
  }
}
