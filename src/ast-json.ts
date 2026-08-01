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

  children.push(...doc.children)

  for (const [label, body] of Object.entries(doc.footnoteDefs ?? {})) {
    const node: FootnoteDefNode = { type: 'footnote', label, children: body }
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
export function fromAstJson(json: AstJsonDocument): Document {
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
          footnoteDefs[label] = node.children
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
    children.push(child as BlockNode)
  }

  const doc: Document = { type: 'document', children }
  if (frontmatter !== undefined) doc.frontmatter = frontmatter
  if (Object.keys(footnoteDefs).length > 0) doc.footnoteDefs = footnoteDefs
  if (Object.keys(footnoteDefPos).length > 0) doc.footnoteDefPos = footnoteDefPos
  if (json.srcByteLength !== undefined) doc.srcByteLength = json.srcByteLength
  return doc
}
