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
import {
  entriesFromWire,
  entriesToWire,
  isRuntimeEntry,
  type DefinitionEntryNode,
} from './definition-list-wire.js'

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

/** The document root, per PART 12 §7: three fields, nothing else. */
export interface AstJsonDocument {
  type: 'document'
  children: AstJsonBlock[]
  srcByteLength?: number
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
 * Rewrite definition lists into their wire shape, everywhere in a subtree.
 *
 * Structurally shared: a branch with no definition list in it comes back as the
 * SAME object, so `toAstJson` still leaves the runtime document untouched and
 * a large document does not pay for a deep copy it does not need.
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

  return record as T
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

  const out: AstJsonDocument = { type: 'document', children }
  if (doc.srcByteLength !== undefined) out.srcByteLength = doc.srcByteLength
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
 * Deepest node nesting `fromAstJson` will ingest.
 *
 * The same cap the parser applies (`MAX_NESTING_DEPTH`), because an AST deeper
 * than the parser can produce cannot round trip anyway: the renderers stop at
 * `MAX_RENDER_DEPTH` and silently drop everything below it.
 *
 * Counted in NODES, and DERIVED from the parser's cap by the worst per-level
 * cost of this encoding rather than restated from it - the rule PART 12 §9
 * spells out. The two numbers are in different units and the conversion factor
 * is not a constant:
 *
 *   blockquote / div chain   1 node per container level   200 -> depth 202
 *   list ladder              2 nodes per level (the list  200 -> depth 402
 *                            node and its item node)
 *
 * So the worst case is 2x, and `MAX_NESTING_DEPTH + margin` is not a bound at
 * all: at +8 this rejected a 200-deep list at 209 - an AST the same build's
 * parser had just produced, violating §9's first rule. The margin on top of 2x
 * absorbs a deeper innermost leaf, a table cell inside the last list item,
 * whose rows/cells/paragraph/text levels cost a constant rather than a factor.
 *
 * Equating the two numbers is also how carve-rs came to reject ASTs its own
 * encoder had produced (carve-rs#389), which is why the relationship is written
 * down as arithmetic instead of a measured constant that would silently stop
 * being true the moment the parser's cap moved.
 */
export const MAX_AST_JSON_DEPTH = MAX_NESTING_DEPTH * 2 + 16

/**
 * Node depth of a payload, measured with an EXPLICIT STACK.
 *
 * Deliberately not recursive: this exists to reject input too deep to recurse
 * over, so measuring it by recursion would overflow on exactly the payload it
 * is meant to refuse. Stops as soon as the cap is exceeded rather than walking
 * a whole hostile tree.
 */
function astJsonDepth(root: unknown, limit: number): number {
  let deepest = 0
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }]

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    if (depth > deepest) {
      deepest = depth
      if (deepest > limit) return deepest
    }
    if (Array.isArray(node)) {
      // An array is a child LIST, not a level of its own - the nodes in it are.
      for (const child of node) stack.push({ node: child, depth })
      continue
    }
    if (typeof node !== 'object' || node === null) continue

    const record = node as Record<string, unknown>
    for (const field of CHILD_FIELDS) {
      if (record[field] !== undefined) stack.push({ node: record[field], depth: depth + 1 })
    }
    if (record['target'] !== undefined) stack.push({ node: record['target'], depth: depth + 1 })
    if (record['items'] !== undefined) stack.push({ node: record['items'], depth: depth + 1 })
  }

  return deepest
}

export function fromAstJson(json: AstJsonDocument): Document {
  const depth = astJsonDepth(json, MAX_AST_JSON_DEPTH)
  if (depth > MAX_AST_JSON_DEPTH) throw new AstJsonDepthError(depth)

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
  return doc
}
