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

/**
 * A quoted run: its opening quote through the first unescaped matching one.
 * PART 4's `quoted_value` has both spellings, and each excludes only its own
 * quote, the backslash and the newline -- so a `}}` between the quotes belongs
 * to the run rather than closing the directive (spec I1, carve#2000).
 */
const DQUOTED_RUN = String.raw`"(?:\\.|[^"\\\n])*?"`
const SQUOTED_RUN = String.raw`'(?:\\.|[^'\\\n])*?'`

/**
 * The option slot up to the closer, stepping OVER whole quoted runs.
 *
 * The two lookaheads are the exact negation of the runs beside them, so at any
 * position either a run starts -- and only a run alternative is viable -- or
 * none does, and only the single-character one is. No position is reachable
 * two ways, so the lazy scan never backtracks across the alternation. Matching
 * a run to its closing quote and only then hunting for the closer is the shape
 * that does (carve-grammars#413); this one measures flat per byte.
 */
const QUOTE_AWARE_OPTIONS = String.raw`(?:${DQUOTED_RUN}|${SQUOTED_RUN}|(?!${DQUOTED_RUN})(?!${SQUOTED_RUN})[^\n])*?`

const OPEN = String.raw`\{\{\s+`
const PATH = String.raw`(?:"((?:\\.|[^"\\])*)"|\u201c([^\u201d]*)\u201d|([^#@}\s"\u201c]+))`
const SECTION = String.raw`((?:\s+#[A-Za-z_][\w-]*)?)`
const CLOSE = String.raw`\s+\}\}`
const body = (options: string): string => `${OPEN}${PATH}${SECTION}(${options})${CLOSE}`

const QUOTE_AWARE_BODY = body(QUOTE_AWARE_OPTIONS)
/**
 * The fallback reading, tried only where the quote-aware one finds no closer
 * at all: an UNTERMINATED quote opens no run, so it must not pair with a quote
 * that lies PAST the closer and leave the whole token unrecognized. Section 19
 * forbids exactly one outcome -- literal text with no diagnostic -- and that
 * is what dropping this branch would produce for `{{ a @k:"x }} said "hi"`.
 */
const FIRST_PAIR_BODY = body(String.raw`.*?`)

export const DIRECTIVE_SCAN_RE = new RegExp(`(?:${QUOTE_AWARE_BODY})|(?:${FIRST_PAIR_BODY})`, 'g')
export const DIRECTIVE_FULL_RE = new RegExp(`^(?:${QUOTE_AWARE_BODY})$`)
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
  if (path === '') return null
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
 * True when a candidate token has the SHAPE of a directive: it opens with
 * "{{", closes with "}}", and carries a non-empty path token. Section and
 * option validity are deliberately NOT considered -- those are expansion-time
 * diagnostics, not recognition criteria.
 */
export function isDirectiveShape(raw: string): boolean {
  const m = DIRECTIVE_FULL_RE.exec(raw)
  if (!m) return false
  const path = m[1] !== undefined ? unescapeQuotedPath(m[1]) : m[2] ?? m[3]!
  return path !== ''
}

/**
 * Locate the SHAPE-well-formed directive spans inside a reassembled inline
 * run, in source order.
 *
 * The bar is deliberately lower than {@link parseDirective}: the serializer
 * uses this to decide what to emit verbatim, and escaping a directive that is
 * merely mis-OPTIONED ("{{ a.crv @bogus:1 }}") would turn a fixable typo into
 * permanent literal text -- destroying the very warning that explains it. A
 * run that is not shape-well-formed ("{{ oops", "{{ }}") is not reported and
 * keeps being treated as ordinary text.
 */
export function findDirectives(text: string): { start: number; end: number; raw: string }[] {
  const re = new RegExp(DIRECTIVE_SCAN_RE.source, 'g')
  const spans: { start: number; end: number; raw: string }[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0]
    if (!isDirectiveShape(raw)) continue
    spans.push({ start: m.index, end: m.index + raw.length, raw })
  }
  return spans
}
