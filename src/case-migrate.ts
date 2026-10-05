import { lintCarve } from './lint.js'
import { caseOnlyKey, normalizeHeadingRefLabel } from './heading-ids.js'
import { normalizeRefLabel } from './label-key.js'

interface Edit {
  start: number
  end: number
  text: string
}

/**
 * `carve fmt --migrate` for CARVE-P9R-010: respell a `</#id>` or reference
 * label that misses its target only by case, when exactly one target matches
 * it case-insensitively. Several candidates leave the reference to lint.
 */
export function migrateCaseOnlyReferences(source: string): string {
  const edits: Edit[] = []
  for (const warning of lintCarve(source)) {
    const variants = warning.data?.['caseVariants']
    if (!Array.isArray(variants) || variants.length !== 1) continue
    const wanted = variants[0] as string
    const written = source.slice(warning.start, warning.end)
    const edit =
      warning.rule === 'broken-crossref'
        ? crossrefEdit(written, warning.data?.['target'], wanted)
        : warning.rule === 'unresolved-reference-link'
          ? referenceEdit(written, warning.data?.['label'], wanted)
          : undefined
    if (edit !== undefined) edits.push({ start: warning.start, end: warning.end, text: edit })
  }
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
