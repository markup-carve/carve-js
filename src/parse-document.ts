import type { Document } from './ast.js'
import { promoteCitationDefinitions } from './citations.js'
import { promoteBlockImages } from './heading-ids.js'
import { parse as parseImpl, type ParseOptions } from './parse.js'

/** The public `parse()`: the parser plus its representation passes. */
export function parseDocument(source: string, opts: ParseOptions = {}): Document {
  const doc = parseImpl(source, opts)
  promoteBlockImages(doc.children, true)
  if (doc.footnoteDefs) {
    for (const body of Object.values(doc.footnoteDefs)) promoteBlockImages(body, true)
  }
  // A `[@key]: entry` line is a `citation_definition`, not a paragraph holding
  // its own unrecognized source (PART 12 §18). Here rather than in the
  // citations extension's `afterParse` hook because THIS is the stage that
  // matters: `parse` is what `toAstJson` serializes and what §3a makes
  // pre-resolve, and `parse` does not call that hook - so a fix living there
  // would look right through the extension and leave the published tree
  // carrying the paragraph (carve#1276). Representation, not resolution, the
  // same standing as `promoteBlockImages` above: no rendered output moves on
  // any target.
  doc.children = promoteCitationDefinitions(doc.children)
  return doc
}
