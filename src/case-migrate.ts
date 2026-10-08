import { codepointToUtf16Map, lintCarve } from './lint.js'
import { parse, buildBracketMap } from './parse.js'
import { caseOnlyKey, normalizeHeadingRefLabel, type AsciiHeadingIdMode } from './heading-ids.js'
import { normalizeRefLabel } from './label-key.js'
import { unescapeAttrValue } from './attribute-parser.js'

interface Edit {
  start: number
  end: number
  text: string
}

/**
 * `carve fmt --migrate` for CARVE-P9R-010: respell a `</#id>` or reference
 * label that misses its target only by case, when exactly one target matches
 * it case-insensitively. Several candidates leave the reference to lint.
 * Pass the heading-id options the document renders with, so a reference is
 * judged against the ids that render actually produces.
 */
export function migrateCaseOnlyReferences(
  source: string,
  opts: { asciiHeadingIds?: AsciiHeadingIdMode; lowercaseHeadingIds?: boolean } = {},
): string {
  const edits: Edit[] = []
  for (const warning of lintCarve(source, opts)) {
    const variants = warning.data?.['caseVariants']
    if (!Array.isArray(variants) || variants.length !== 1) continue
    const wanted = variants[0] as string
    const written = source.slice(warning.start, warning.end)
    const edit =
      warning.rule === 'broken-crossref'
        ? crossrefEdit(written, warning.data?.['target'], wanted)
        : warning.rule === 'unresolved-reference-link' && !written.startsWith('!')
          ? referenceEdit(written, warning.data?.['label'], wanted)
          : undefined
    if (edit !== undefined) edits.push({ start: warning.start, end: warning.end, text: edit })
  }
  edits.push(...imageEdits(source))
  let out = source
  let limit = Infinity
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    // A reference nested in another's text: keep the outer span intact.
    if (edit.end > limit) continue
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
    limit = edit.start
  }
  return out
}

function crossrefEdit(written: string, target: unknown, wanted: string): string | undefined {
  return written === `</#${String(target)}>` ? `</#${wanted}>` : undefined
}

function referenceEdit(written: string, label: unknown, wanted: string): string | undefined {
  if (typeof label !== 'string') return undefined
  if (written === `[${label}][]`) {
    // The collapsed label IS the link text, so it is only respelled when that
    // text is plain: a label carrying markup is left for the author.
    if (caseOnlyKey(normalizeHeadingRefLabel(label)) !== caseOnlyKey(wanted.normalize('NFC'))) return undefined
    return `[${wanted}][]`
  }
  const suffix = `][${label}]`
  if (!written.endsWith(suffix) || caseOnlyKey(normalizeRefLabel(label)) !== caseOnlyKey(wanted)) return undefined
  return `${written.slice(0, written.length - suffix.length)}][${wanted}]`
}

/**
 * Unresolved reference images, respelled here rather than from their lint
 * finding so use-site attributes after the bracket carry over: an image
 * resolves against link definitions only, so only their labels are candidates.
 */
function imageEdits(source: string): Edit[] {
  const doc = parse(source, { positions: true })
  const labels = new Map<string, Set<string>>()
  const images: Record<string, unknown>[] = []
  walk(doc, (node) => {
    if (node.type === 'link_reference_definition' && typeof node.label === 'string') {
      const label = normalizeRefLabel(node.label)
      const key = caseOnlyKey(label)
      if (!labels.has(key)) labels.set(key, new Set())
      labels.get(key)!.add(label)
    } else if (node.type === 'image' && typeof node.ref === 'string' && !node.src) {
      images.push(node)
    }
  })
  const utf16At = codepointToUtf16Map(source)
  const toUtf16 = (offset: number): number => (utf16At ? (utf16At[offset] ?? source.length) : offset)
  const edits: Edit[] = []
  for (const image of images) {
    const pos = image.pos as { startOffset?: number; endOffset?: number } | undefined
    if (pos?.startOffset === undefined || pos.endOffset === undefined) continue
    const label = image.ref as string
    // A multiline label misses for a reason other than case.
    if (/[\r\n]/.test(label)) continue
    const written = normalizeRefLabel(label)
    const variants = [...(labels.get(caseOnlyKey(written)) ?? [])].filter((v) => v !== written)
    if (variants.length !== 1) continue
    const start = toUtf16(pos.startOffset)
    const end = toUtf16(pos.endOffset)
    const text = imageReferenceEdit(source.slice(start, end), label, String(image.alt ?? ''), variants[0]!)
    if (text !== undefined) edits.push({ start, end, text })
  }
  return edits
}

function imageReferenceEdit(written: string, label: string, alt: string, wanted: string): string | undefined {
  const close = buildBracketMap(written)(1)
  if (close === undefined || !written.startsWith('![')) return undefined
  const rawAlt = written.slice(2, close)
  if (unescapeAttrValue(rawAlt) !== alt) return undefined
  const collapsed = `![${rawAlt}][]`
  const explicit = `![${rawAlt}][${label}]`
  const head = written.startsWith(collapsed) ? collapsed : written.startsWith(explicit) ? explicit : undefined
  if (head === undefined) return undefined
  const attrs = written.slice(head.length)
  if (attrs !== '' && !attrs.startsWith('{')) return undefined
  if (head === collapsed) {
    return label === rawAlt && caseOnlyKey(normalizeRefLabel(label)) === caseOnlyKey(wanted) ? `![${wanted}][]${attrs}` : undefined
  }
  return `![${rawAlt}][${wanted}]${attrs}`
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  if (typeof node.type === 'string') visit(node)
  for (const [key, child] of Object.entries(node)) if (key !== 'pos') walk(child, visit)
}
