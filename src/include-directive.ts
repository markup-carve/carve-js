/**
 * Recognition of processor-level `{{ ... }}` include directives (spec I1).
 *
 * Kept separate from {@link ./includes.js} so consumers that only need to
 * RECOGNIZE a directive -- notably the Carve serializer, which must emit one
 * verbatim rather than escape it -- do not pull in the expander's file-system
 * imports.
 */

export interface Directive {
  raw: string
  path: string
  section?: string
  lines?: { start: number; end: number }
  /** Literal signed offset, or "auto" to derive it from the include site. */
  shift: number | 'auto'
}

export const DIRECTIVE_SCAN_RE =
  /\{\{\s+(?:"((?:\\.|[^"\\])*)"|\u201c([^\u201d]*)\u201d|([^#@}\s"\u201c]+))((?:\s+#[A-Za-z_][\w-]*)?)(.*?)\s+\}\}/g
export const DIRECTIVE_FULL_RE =
  /^\{\{\s+(?:"((?:\\.|[^"\\])*)"|\u201c([^\u201d]*)\u201d|([^#@}\s"\u201c]+))((?:\s+#[A-Za-z_][\w-]*)?)(.*?)\s+\}\}$/
const OPTION_RE = /^@([A-Za-z_][\w-]*):([^#@}\s]+)$/
/** Loose directive shape: one whole-paragraph token, valid options or not. */
export const DIRECTIVE_SHAPE_RE = /^\{\{[^{}]*\}\}$/

function unescapeQuotedPath(path: string): string {
  return path.replace(/\\(["\\])/g, '$1')
}

/**
 * Parse one candidate directive token. Returns null when the token is not a
 * well-formed directive per spec I1 -- a bad shape, or an unrecognized or
 * malformed option -- in which case it stays ordinary text.
 */
export function parseDirective(raw: string, onInvalidOption?: (part: string) => void): Directive | null {
  const m = DIRECTIVE_FULL_RE.exec(raw)
  if (!m) return null
  const path = m[1] !== undefined ? unescapeQuotedPath(m[1]) : m[2] ?? m[3]!
  const sectionPart = m[4]?.trim()
  const section = sectionPart ? sectionPart.slice(1) : undefined
  let lines: Directive['lines']
  let shift: number | 'auto' = 0
  const rest = m[5]?.trim()
  if (rest) {
    for (const part of rest.split(/\s+/)) {
      const opt = OPTION_RE.exec(part)
      const invalid = (): null => {
        // Spec I1: an unrecognized (or malformed) option makes the directive
        // unresolvable - Warning + literal, never silent.
        if (part.startsWith('@')) onInvalidOption?.(part)
        return null
      }
      if (!opt) return invalid()
      const [, key, value] = opt
      if (key === 'lines') {
        const lm = /^([1-9]\d*)-([1-9]\d*)$/.exec(value!)
        if (!lm) return invalid()
        lines = { start: Number(lm[1]), end: Number(lm[2]) }
        if (lines.end < lines.start) return invalid()
      } else if (key === 'shift') {
        // Spec I8: a signed integer or the literal "auto", never both forms.
        if (value === 'auto') shift = 'auto'
        else if (!/^[+-]?\d+$/.test(value!)) return invalid()
        else shift = Number(value)
      } else {
        return invalid()
      }
    }
  }
  const directive: Directive = { raw, path, shift }
  if (section !== undefined) directive.section = section
  if (lines !== undefined) directive.lines = lines
  return directive
}

/**
 * Locate the WELL-FORMED directive spans inside a reassembled inline run, in
 * source order. A candidate that fails {@link parseDirective} is not reported,
 * so it keeps being treated as ordinary text.
 */
export function findDirectives(text: string): { start: number; end: number; raw: string }[] {
  const re = new RegExp(DIRECTIVE_SCAN_RE.source, 'g')
  const spans: { start: number; end: number; raw: string }[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0]
    if (parseDirective(raw) === null) continue
    spans.push({ start: m.index, end: m.index + raw.length, raw })
  }
  return spans
}
