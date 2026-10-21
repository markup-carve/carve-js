import type { Document } from './ast.js'
import { promoteBlockImages } from './heading-ids.js'
import { parseDocument } from './parse-document.js'
import type { ParseOptions } from './parse.js'
import { renderCarve, type CarveRenderOptions } from './render-carve.js'

export function canonicalCarveWrite(
  source: string,
  opts: ParseOptions & CarveRenderOptions = {},
  transform?: (document: Document) => void,
): string {
  const document = parseDocument(source, opts)
  transform?.(document)
  promoteBlockImages(document.children, true)
  if (document.footnoteDefs) {
    for (const body of Object.values(document.footnoteDefs)) promoteBlockImages(body, true)
  }
  return renderCarve(document, opts)
}
