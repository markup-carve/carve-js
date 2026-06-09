/*
 * Djot -> Carve migration warnings.
 *
 * Several inline delimiters mean different things in Djot and Carve, so a
 * Djot document fed to a Carve processor renders *wrong with no error*.
 * This module flags exactly those silent mis-renders so a migration is
 * mechanical and reviewable. It deliberately does NOT warn on constructs
 * that mean the same thing in both languages (e.g. `^sup^`, `$math$`,
 * `{+ins+}`/`{-del-}`), to keep the signal-to-noise high.
 *
 * Detection masks all code (fenced + inline, multi-line, mirroring
 * Carve's RE_FENCE) to spaces, then scans the whole document so a
 * delimiter pair that crosses a soft line break is still caught while
 * one crossing a blank line (paragraph break) is not.
 *
 * Known, deliberate limitation: a candidate pair whose closer sits on a
 * line that Carve would start as a new block (heading/list/quote) with
 * no intervening blank line may still be reported. This is an advisory
 * linter a human reviews; an occasional extra warning is acceptable,
 * whereas a missed real mis-render is not — so the bias is intentional.
 */

export interface MigrationWarning {
  /** 1-based line number. */
  line: number
  /** 1-based column of the offending construct. */
  column: number
  /** Stable rule id, e.g. "djot-emphasis-underline". */
  rule: string
  /** Human-readable explanation of the silent mis-render. */
  message: string
  /**
   * The Carve syntax that preserves the intended meaning. This is also the
   * exact replacement text `applyMigrationFixes` splices over [start, end):
   * the captured content is taken from the ORIGINAL source (not the
   * code-masked scan buffer), so a construct wrapping inline code stays
   * intact.
   */
  suggestion: string
  /**
   * 0-based offset of the offending construct in the line-ending-normalized
   * source (`\r\n?` -> `\n`), inclusive. Splice target start.
   */
  start: number
  /** 0-based offset in the normalized source, exclusive. Splice target end. */
  end: number
}

interface Rule {
  id: string
  /** Must be a global regex with at least one capture group for content. */
  pattern: RegExp
  /**
   * Delimiter family. Two matches that overlap are de-duplicated only
   * when they share a family (e.g. `~~x~~` must not also report the
   * inner `~x~` subscript). Genuinely nested *different* families
   * (`~~_x_~~` -> strike AND emphasis) are both real mis-renders and
   * are both kept.
   */
  family: string
  message: (m: RegExpExecArray) => string
  suggestion: (m: RegExpExecArray) => string
}

// Order matters: more specific patterns (``**``, ``~~``) are tested before
// the single-delimiter ones so a `**x**` is not also reported as `*x*`.
const RULES: Rule[] = [
  // `C(x)` = a content run that may cross soft line breaks (Carve's
  // parseInline parses emphasis across them) but never a blank line,
  // and never the delimiter char `x`.
  {
    id: 'markdown-strong-double-star',
    family: '*',
    pattern: /\*\*(?!\s)((?:(?!\n[ \t]*\n)[^*])+?)(?<!\s)\*\*/gd,
    message: () =>
      'Djot/Markdown `**strong**` is not Carve bold — Carve bold is a single `*`, so this renders with literal asterisks.',
    suggestion: (m) => `*${m[1]}*`,
  },
  {
    id: 'markdown-strikethrough-double-tilde',
    family: '~',
    pattern: /~~(?!\s)((?:(?!\n[ \t]*\n)[^~])+?)(?<!\s)~~/gd,
    message: () =>
      'Markdown `~~strikethrough~~` is not Carve — Carve strikethrough is a single `~`.',
    suggestion: (m) => `~${m[1]}~`,
  },
  {
    id: 'djot-subscript-tilde',
    family: '~',
    pattern: /~(?!\s)((?:(?!\n[ \t]*\n)[^~])+?)(?<!\s)~/gd,
    message: () =>
      'Djot subscript `~x~` renders as *strikethrough* in Carve.',
    suggestion: (m) => `,,${m[1]},,`,
  },
  {
    id: 'djot-emphasis-underscore',
    family: '_',
    pattern:
      /(?<![A-Za-z0-9_])_(?!\s)((?:(?!\n[ \t]*\n)[^_])+?)(?<!\s)_(?![A-Za-z0-9_])/gd,
    message: () =>
      'Djot emphasis `_x_` renders as *underline* in Carve.',
    suggestion: (m) => `/${m[1]}/`,
  },
  {
    id: 'djot-highlight-braces',
    family: '{',
    pattern: /\{=(?!\s)((?:(?!\n[ \t]*\n)[\s\S])+?)(?<!\s)=\}/gd,
    message: () => 'Djot highlight `{=x=}` is written `==x==` in Carve.',
    suggestion: (m) => `==${m[1]}==`,
  },
  // Block-level (line-anchored): a leading `+ content` is a bullet in
  // Djot/Markdown but NOT in Carve — `+` is the list-continuation marker, so
  // the line renders as a paragraph. A lone `+` (no content) is excluded: that
  // IS the Carve continuation marker and is intentional.
  {
    id: 'djot-plus-bullet',
    family: 'plus-bullet',
    pattern: /(?<=^[ \t]*)(\+)(?=[ \t]+\S)/gmd,
    message: () =>
      'Djot/Markdown `+` bullet is not a Carve bullet (`+` is the list-continuation marker) — this line renders as a paragraph.',
    suggestion: () => '-',
  },
  // NOTE: full Djot reference links `[text][ref]` are NOT flagged — Carve
  // resolves them identically against a `[ref]: url` definition (corpus
  // 34-reference-link), so there is no silent mis-render. Math (`$`x``)
  // and editorial `{+ +}`/`{- -}` are likewise identical and unflagged.
]

const blanks = (s: string) => s.replace(/[^\n]/g, ' ')

/**
 * Return a copy of `src` with every code character (fenced blocks and
 * inline code spans, including multi-line ones) replaced by spaces, and
 * newlines preserved so line/column positions are unchanged. Delimiter
 * collisions inside code are not real mis-renders, so the scanner simply
 * never sees them.
 */
function maskCode(src: string): string {
  // Stage 1: fenced blocks, line by line.
  const lines = src.split('\n')
  let fence: { ch: string; len: number } | null = null
  const staged = lines.map((line) => {
    if (fence) {
      // parseFence: a closer may be indented by at most 3 spaces.
      const close = line.match(/^ {0,3}([`~]{3,})[ \t]*$/)
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
        fence = null
      }
      return blanks(line)
    }
    // Mirror Carve's RE_FENCE exactly (src/parse.ts): a fence opener is
    // a >=3 run with at most a single `[A-Za-z0-9_+#.-]` info token. A
    // multiword / attribute info string (```ts title=demo) is NOT a
    // Carve fence — Carve parses it as prose, so we must not mask it.
    const open = line.match(/^(\s*)(`{3,}|~{3,})\s*([a-zA-Z0-9_+#.-]*)\s*$/)
    if (open) {
      fence = { ch: open[2]![0]!, len: open[2]!.length }
      return blanks(line)
    }
    return line
  })
  const s = staged.join('\n')

  // Stage 2: inline code spans. A run of N backticks closes at the next
  // run of exactly N backticks (Djot allows newlines inside). An
  // unmatched run is literal and left alone (no over-masking).
  const out = s.split('')
  const runLen = (i: number) => {
    let n = 0
    while (s[i + n] === '`') n++
    return n
  }
  let i = 0
  while (i < s.length) {
    if (s[i] !== '`') {
      i++
      continue
    }
    const len = runLen(i)
    let j = i + len
    let closed = -1
    while (j < s.length) {
      if (s[j] === '`' && runLen(j) === len) {
        closed = j
        break
      }
      j++
    }
    if (closed === -1) {
      i += len // unmatched, literal
      continue
    }
    for (let k = i; k < closed + len; k++) if (out[k] !== '\n') out[k] = ' '
    i = closed + len
  }

  // Stage 3: inline link / image destination + title. Carve consumes
  // `[text](dest "title")` (and the image form) as a whole; delimiters
  // inside the parenthesized part are never inline markup — notably a
  // `~` in a URL path. The bracket text IS inline-parsed, so it is left
  // visible. Lookbehind on `]` keys this to a real link/image target.
  let masked = out.join('')
  masked = masked.replace(/(?<=\])\([^()\n]*\)/g, (g) => blanks(g))
  return masked
}

/**
 * Scan Djot/Carve source and return warnings for constructs that silently
 * change meaning under Carve. Empty array means the source is free of the
 * known Djot/Carve delimiter collisions.
 */
export function djotMigrationWarnings(source: string): MigrationWarning[] {
  const out: MigrationWarning[] = []
  // Code (fenced + inline, multi-line) is masked to spaces so no rule
  // can match through or into it. Positions are preserved 1:1. The scan
  // runs over the whole text (not per line) so delimiter pairs that
  // cross a soft line break are still caught. Normalize line endings
  // first, exactly as parse() does, so results don't depend on CRLF.
  // `norm` keeps the real characters (incl. code) at the same offsets as
  // `masked`, so the captured content for a suggestion is sliced from
  // `norm` — masking only ever blanks the *content*, never the delimiters.
  const norm = source.replace(/\r\n?/g, '\n')
  const masked = maskCode(norm)

  // index -> {line, column} (both 1-based), via newline prefix sums.
  const nlAt: number[] = []
  for (let k = 0; k < masked.length; k++) if (masked[k] === '\n') nlAt.push(k)
  const posOf = (idx: number) => {
    let lo = 0
    let hi = nlAt.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nlAt[mid]! < idx) lo = mid + 1
      else hi = mid
    }
    const lineStart = lo === 0 ? 0 : nlAt[lo - 1]! + 1
    return { line: lo + 1, column: idx - lineStart + 1 }
  }

  // Accept matches in RULES order. Drop a later match only if it
  // overlaps an accepted one of the SAME delimiter family — that is a
  // re-match of the same construct (`~~x~~` must not also report the
  // inner `~x~`). A nested *different* family (`~~_x_~~` -> strike AND
  // emphasis; `**_x_**` -> strong AND emphasis) is two real, distinct
  // mis-renders, so both are kept.
  const taken: Array<[number, number, string]> = []
  const sameFamilyOverlap = (s: number, e: number, fam: string) =>
    taken.some(([ts, te, tf]) => tf === fam && s < te && ts < e)

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(masked))) {
      const start = m.index
      const end = m.index + m[0].length
      // A backslash-escaped opening delimiter is a literal in both
      // Djot and Carve (e.g. `\_x_`). Only an ODD run of backslashes
      // escapes; `\\_x_` is an escaped backslash + a live `_x_`.
      let bs = 0
      for (let k = start - 1; k >= 0 && masked[k] === '\\'; k--) bs++
      if (bs % 2 === 1) continue
      if (sameFamilyOverlap(start, end, rule.family)) continue
      taken.push([start, end, rule.family])
      const { line, column } = posOf(start)
      // Build the suggestion from the ORIGINAL captured content, not the
      // code-masked one, so `*a `code` b*` round-trips instead of losing
      // the backticked run to spaces. `m.indices` is present because every
      // pattern carries the `d` flag; group 1 always participates.
      const span = m.indices?.[1]
      const orig = span ? norm.slice(span[0], span[1]) : m[1]!
      const origM = m.slice() as RegExpExecArray
      origM[1] = orig
      out.push({
        line,
        column,
        rule: rule.id,
        message: rule.message(m),
        suggestion: rule.suggestion(origM),
        start,
        end,
      })
    }
  }

  out.sort((a, b) => a.line - b.line || a.column - b.column)
  return out
}

/** Result of {@link applyMigrationFixes}. */
export interface MigrationFixResult {
  /**
   * The fixed source. Line endings are normalized to `\n` (matching how the
   * scanner and `parse()` see the input).
   */
  output: string
  /** Warnings whose suggestion was spliced into `output`. */
  applied: MigrationWarning[]
  /**
   * Warnings left untouched because their span overlaps another warning
   * (nested different-family collisions such as `**_x_**` -> strong AND
   * emphasis). Auto-rewriting overlapping spans in one pass would corrupt
   * offsets, and re-scanning the output is unsafe (a fixed `~~x~~` -> `~x~`
   * would be re-flagged as a subscript mis-render). These are reported for
   * the caller to resolve by hand.
   */
  skipped: MigrationWarning[]
}

/**
 * Apply the auto-fixable Djot/Carve migration warnings to `source`,
 * returning the rewritten text. This is the autocorrect companion to
 * {@link djotMigrationWarnings}: each warning already carries the precise
 * span and the canonical Carve replacement, so the fix is a pure splice.
 *
 * Single, non-recursive pass: only mutually non-overlapping warnings are
 * applied (right-to-left, so earlier offsets stay valid). Overlapping
 * warnings are returned in `skipped` rather than guessed at — see
 * {@link MigrationFixResult.skipped}.
 */
export function applyMigrationFixes(source: string): MigrationFixResult {
  const warnings = djotMigrationWarnings(source)
  const overlaps = (a: MigrationWarning, b: MigrationWarning) =>
    a.start < b.end && b.start < a.end
  const applied: MigrationWarning[] = []
  const skipped: MigrationWarning[] = []
  for (const w of warnings) {
    if (warnings.some((o) => o !== w && overlaps(w, o))) skipped.push(w)
    else applied.push(w)
  }

  // Splice from the end so each replacement leaves the offsets of the
  // not-yet-applied (earlier) warnings unchanged.
  let output = source.replace(/\r\n?/g, '\n')
  for (let i = applied.length - 1; i >= 0; i--) {
    const w = applied[i]!
    output = output.slice(0, w.start) + w.suggestion + output.slice(w.end)
  }
  return { output, applied, skipped }
}

/** Format warnings as `file:line:col rule — message (use: suggestion)`. */
export function formatMigrationWarnings(
  warnings: MigrationWarning[],
  file = '<stdin>',
): string {
  return warnings
    .map(
      (w) =>
        `${file}:${w.line}:${w.column} ${w.rule} — ${w.message} (use: ${w.suggestion})`,
    )
    .join('\n')
}
