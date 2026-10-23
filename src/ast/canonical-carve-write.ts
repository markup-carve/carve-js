import type { Document } from '../ast.js'
import { promoteBlockImages } from '../heading/heading-ids.js'
import { parseDocument } from '../parse/parse-document.js'
import type { ParseOptions } from '../parse.js'
import { renderCarve, renderCarveFromParsedSource, type CarveRenderOptions } from '../render-carve.js'

export function canonicalCarveWrite(
  source: string,
  opts: ParseOptions & CarveRenderOptions = {},
  /** Must return true whenever it changes the parsed tree. */
  transform?: (document: Document) => boolean,
  parsedSourceHint?: string,
): string {
  const document = parseDocument(source, opts)
  const transformed = transform?.(document) === true
  promoteBlockImages(document.children, true)
  if (document.footnoteDefs) {
    for (const body of Object.values(document.footnoteDefs)) promoteBlockImages(body, true)
  }
  // Figures can be promoted after parsing, and empty references can gain a
  // runtime resolution bit. Extensions can also change the default parse.
  const canReuseSource = parsedSourceHint === source && !transformed &&
    !source.includes('![') && !source.includes('[]') && !opts.extensions?.length
  return canReuseSource
    ? renderCarveFromParsedSource(document, source, opts)
    : renderCarve(document, opts)
}
