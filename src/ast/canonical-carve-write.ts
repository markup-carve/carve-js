import type { Document } from '../ast.js'
import { promoteBlockImages } from '../heading/heading-ids.js'
import { parseDocument } from '../parse/parse-document.js'
import type { ParseOptions } from '../parse.js'
import { renderCarve, renderCarveFromParsedSource, renderedReadsBack, writtenReadsBackAs, type CarveRenderOptions } from '../render-carve.js'
import { transparentLineStream } from '../parse/block/transparent-lines.js'
import { losingFootnoteLines } from '../parse/losing-footnote-lines.js'

/** A removed layout boundary can change ownership of later source lines. */
function hasUnrepresentedAuthoredLine(document: Document, source: string, written: string,
  stream = transparentLineStream(source)): boolean {
  if (!stream || source.includes('\0')) return false
  const represented = new Set<number>()
  const leaves = new Set([
    'paragraph', 'heading', 'code_block', 'raw_block', 'image', 'table',
    'thematic_break', 'comment', 'abbreviation_def', 'link_reference_definition',
    'citation_definition', 'directive', 'line_block',
  ])
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const part of value) visit(part)
    } else if (value !== null && typeof value === 'object') {
      const node = value as Record<string, unknown>
      const pos = node.pos as { startLine: number; endLine: number } | undefined
      if (pos && leaves.has(String(node.type))) {
        for (let line = pos.startLine; line <= pos.endLine; line++) represented.add(line)
      }
      for (const [key, part] of Object.entries(node)) {
        if (key !== 'pos' && key !== 'attrs') visit(part)
      }
    }
  }
  visit(document.children)
  visit(document.footnoteDefs)
  for (const pos of Object.values(document.footnoteDefPos ?? {})) {
    for (let line = pos.startLine; line <= pos.endLine; line++) represented.add(line)
  }
  for (const line of losingFootnoteLines(document)) represented.add(line)
  const erased = new Set(stream.erased)
  // A consumed `+` leaves no node (CARVE-P11-040), so its bare line has nothing to represent it.
  return stream.original.some((line, index) => !erased.has(index) && line.trim() !== '' &&
    !represented.has(index + 1) && !written.includes(line.trim()) && !/^[ \t]*\+[ \t]*$/.test(line))
}

function withPromotedImages(document: Document): Document {
  promoteBlockImages(document.children, true)
  for (const body of Object.values(document.footnoteDefs ?? {})) promoteBlockImages(body, true)
  return document
}

export function canonicalCarveWrite(
  source: string,
  opts: ParseOptions & CarveRenderOptions = {},
  /** Must return true whenever it changes the parsed tree. */
  transform?: (document: Document) => boolean,
  parsedSourceHint?: string,
): string {
  const document = parseDocument(source, opts)
  const transformed = transform?.(document) === true
  withPromotedImages(document)
  // Figures can be promoted after parsing, and empty references can gain a
  // runtime resolution bit. Extensions can also change the default parse.
  const canReuseSource = parsedSourceHint === source && !transformed &&
    !source.includes('![') && !source.includes('[]') && !opts.extensions?.length
  const render = (options: ParseOptions & CarveRenderOptions): string => canReuseSource
    ? renderCarveFromParsedSource(document, source, options)
    : renderCarve(document, options)
  // An erased line is written canonically wherever that keeps the tree; its
  // authored spelling is the fallback (PART 11 §2, carve#5012).
  const stream = !transformed && !opts.extensions?.length ? transparentLineStream(source) : null
  if (stream) {
    const canonicalOpts = { ...opts, canonicalTransparentLines: true }
    const candidate = render(canonicalOpts)
    // A canonical form is a fixpoint; an authored line it cannot settle keeps the authored spelling.
    if (writtenReadsBackAs(source, candidate) && !hasUnrepresentedAuthoredLine(document, source, candidate, stream ?? undefined) &&
        renderCarve(withPromotedImages(parseDocument(candidate, opts)), canonicalOpts) === candidate)
      return candidate
  }
  const written = render(opts)
  // The parser used to leave `%%` stand-ins from `+` as layout boundaries.
  // With transparent lines, a formatter candidate must prove its readback;
  // preserve the authored spelling when no canonical candidate does.
  if (!transformed && !opts.extensions?.length &&
      (source.includes('%%') || source.includes(']:') || source.includes('+')) &&
      !renderedReadsBack(document, written)) {
    const normalized = source.replace(/\r\n?/g, '\n')
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`
  }
  // A leaf swallowed after layout erasure has no AST spelling to write. Keep
  // its authored source instead of silently deleting a line (PART 11 §1).
  if (!transformed && !opts.extensions?.length && hasUnrepresentedAuthoredLine(document, source, written)) {
    const normalized = source.replace(/\r\n?/g, '\n')
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`
  }
  return written
}
