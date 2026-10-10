import { isDjotEscaped } from './djot-inline-boundaries.js'
export { isDjotEscaped, djotContentStart, djotTableRows, djotInlineBoundaries } from './djot-inline-boundaries.js'
/*
 * Djot -> Carve migration warnings.
 *
 * Several inline delimiters mean different things in Djot and Carve, so a
 * Djot document fed to a Carve processor renders *wrong with no error*.
 * This module flags exactly those silent mis-renders so a migration is
 * mechanical and reviewable. It deliberately does NOT warn on constructs
 * that mean the same thing in both languages (e.g. `$math$`,
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

import { trimEndSpaceTab } from './trim-non-nbsp.js'
import { readAttributes } from './djot-attributes.js'
import { maskDjotOpaque, type DjotOpaqueOptions } from './djot-opaque.js'

import { parse } from './parse.js'

export interface MigrationWarning {
  /** 1-based line number. */
  line: number
  /** 1-based column of the offending construct. */
  column: number
  /** Stable rule id, e.g. "djot-emphasis-underline". */
  rule: string
  /**
   * Whether the construct produces objectively wrong Carve output
   * (`carve-breakage`) or is valid Carve that merely means something
   * different than it did in Djot/Markdown (`djot-shift`). `carve lint`
   * reports only `carve-breakage` by default — a `djot-shift` such as
   * `_x_` (underline) is intentional in hand-written Carve, so surfacing
   * it there is noise. `--from-djot` opts the shifts back in.
   */
  category: MigrationCategory
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

/**
 * `carve-breakage`: the construct mis-renders in Carve regardless of origin
 * (leaked literal delimiters, a bullet that degrades to a paragraph) — always
 * worth flagging, even in hand-written Carve.
 *
 * `djot-shift`: valid Carve whose meaning merely differs from Djot/Markdown
 * (`_x_` is underline, not emphasis). Only relevant when migrating FROM Djot,
 * so `carve lint` hides it unless `--from-djot` is given.
 */
export type MigrationCategory = 'carve-breakage' | 'djot-shift'

interface Rule {
  id: string
  category: MigrationCategory
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
  /**
   * Replacement delimiters `[left, right]` for a content-wrapping construct.
   * When set, a fix is expressed as two edits that rewrite ONLY the
   * delimiters and leave the captured content untouched — this is what lets
   * nested collisions compose (`**_x_**` -> outer `*` edits + inner `/`
   * edits never touch each other). Omitted for whole-span replacements
   * (the `+` bullet), which fix via `suggestion` as a single edit.
   */
  delims?: [string, string]
}

// Order matters: more specific patterns (``**``, ``~~``) are tested before
// the single-delimiter ones so a `**x**` is not also reported as `*x*`.
const RULES: Rule[] = [
  // `C(x)` = a content run that may cross soft line breaks (Carve's
  // parseInline parses emphasis across them) but never a blank line,
  // and never the delimiter char `x`.
  {
    id: 'markdown-strong-double-star',
    category: 'carve-breakage',
    family: '*',
    pattern: /\*\*(?!\s)((?:(?!\n[ \t]*\n)[^*])+?)(?<!\s)\*\*/dg,
    message: () =>
      'Djot/Markdown `**strong**` is not Carve bold — Carve bold is a single `*`, so this renders with literal asterisks.',
    suggestion: (m) => `*${m[1]}*`,
    delims: ['*', '*'],
  },
  {
    id: 'markdown-strikethrough-double-tilde',
    category: 'carve-breakage',
    family: '~',
    pattern: /~~(?!\s)((?:(?!\n[ \t]*\n)[^~])+?)(?<!\s)~~/dg,
    message: () => 'Markdown `~~strikethrough~~` is not Carve — Carve strikethrough is a single `~`.',
    suggestion: (m) => `~${m[1]}~`,
    delims: ['~', '~'],
  },
  {
    // Djot spells subscript braced as well as bare and means the same by each,
    // so the braced form converts too - but as ONE edit that replaces the
    // braces, not as the bare rule matching inside them. The bare rule's
    // suggestion carries its own `{`/`}`, so splicing it into a span that
    // stopped inside the source's braces produced `{{,y,}}`, rendering the
    // stray literal braces `{<sub>y</sub>}`.
    //
    // This differs from the superscript pair below, where the braced form is
    // valid Carve as-is and the right answer is to leave it alone: Djot's
    // `{~x~}` is subscript and Carve's is strikethrough, so it still has to be
    // converted.
    id: 'djot-subscript-tilde-braced',
    category: 'djot-shift',
    family: '~',
    pattern: /\{~(?!\s)((?:(?!\n[ \t]*\n)[^~])+?)(?<!\s)~\}/dg,
    message: () => 'Djot subscript `{~x~}` renders as *strikethrough* in Carve.',
    suggestion: (m) => `{,${m[1]},}`,
    delims: ['{,', ',}'],
  },
  {
    id: 'djot-subscript-tilde',
    category: 'djot-shift',
    family: '~',
    // A forced closer cannot start or terminate a bare span. ruleMatches checks
    // whether a preceding brace is an unescaped braced opener.
    pattern: /~(?!\s)((?:(?!\n[ \t]*\n)[^~])+?)(?<!\s)~(?!\})/dg,
    message: () => 'Djot subscript `~x~` renders as *strikethrough* in Carve.',
    // Forced brace form: a Djot `~x~` is often intraword (e.g. H~2~O), where a
    // bare `,x,` would be literal in Carve; `{,x,}` renders in every position.
    suggestion: (m) => `{,${m[1]},}`,
    delims: ['{,', ',}'],
  },
  {
    id: 'djot-superscript-caret',
    // Breakage: `^x^` silently drops the superscript (Carve superscript is the
    // braced `{^x^}`), so the intended markup never renders.
    category: 'carve-breakage',
    family: '^',
    // Reference labels are masked before matching. ruleMatches excludes
    // unescaped braced openers; an escaped brace or unmatched bracket
    // can precede a real superscript.
    pattern: /\^(?!\s)((?:(?!\n[ \t]*\n)[^^])+?)(?<!\s)\^(?!\})/dg,
    message: () => 'Djot superscript `^x^` is literal text in Carve — Carve superscript is the braced `{^x^}` only.',
    suggestion: (m) => `{^${m[1]}^}`,
    delims: ['{^', '^}'],
  },
  {
    id: 'djot-emphasis-underscore',
    category: 'djot-shift',
    family: '_',
    pattern:
      /(?<![A-Za-z0-9_])_(?![ \t\n\r\f])((?:(?!\n[ \t]*\n)(?:\\(?!\n[ \t]*\n)[\s\S]|[^_\\]))+?)(?<![ \t\n\r\f])_(?![A-Za-z0-9_])/dg,
    message: () => 'Djot emphasis `_x_` renders as *underline* in Carve.',
    suggestion: (m) => `/${m[1]}/`,
    delims: ['/', '/'],
  },
  {
    // The counterpart to `djot-emphasis-underscore`'s word-boundary guard.
    //
    // Djot's spec puts NO word boundary on emphasis - a `_` opens when not
    // directly followed by whitespace and closes when not directly preceded by
    // whitespace - so `snake_case_name` IS emphasis in Djot, and pandoc's Djot
    // reader renders `snake<em>case</em>name`. The converters leave it literal
    // on purpose, because the documents they exist for are full of identifiers
    // no author meant as emphasis.
    //
    // It CONVERTS, rather than being reported and left alone, because the input
    // is a DJOT document: Djot emphasizes an intraword `_` and an author who
    // wanted the literal characters had to escape them. `snake\_case\_name`
    // renders as `snake_case_name` in Djot and reaches here already escaped, so
    // an UNESCAPED `snake_case_name` in a Djot source is emphasis the author
    // saw in their own renderer and kept. Leaving it literal drops meaning the
    // source states.
    //
    // The braced form is required, not stylistic: a bare `/` is literal
    // intraword in Carve, so `snake/case/name` renders as itself and only
    // `snake{/case/}name` gives back `snake<em>case</em>name`.
    //
    // This does NOT transfer to the Markdown converter, whose flanking rules
    // leave an intraword `_` literal - there the identifier reading is correct
    // and `markdown-migrate` keeps it.
    id: 'djot-intraword-underscore',
    category: 'djot-shift',
    family: '_',
    pattern:
      /(?<=[A-Za-z0-9])_(?![ \t\n\r\f])((?:(?!\n[ \t]*\n)(?:\\(?!\n[ \t]*\n)[\s\S]|[^_\\]))+?)(?<![ \t\n\r\f])_(?=[A-Za-z0-9])/dg,
    message: () =>
      'Djot emphasizes this intraword `_x_`; the migration leaves it literal, so the emphasis is lost. Brace it as `{/x/}` if it was meant.',
    // `{/x/}`, NOT `{_x_}`: Carve's `_` is UNDERLINE, so the braced underscore
    // would render `<u>` where Djot meant `<em>` - a rule that exists to stop a
    // silent semantic change causing one. The sibling `djot-emphasis-underscore`
    // converts `_x_` to `/x/` for the same reason.
    suggestion: (m) => `{/${m[1]}/}`,
    delims: ['{/', '/}'],
  },
  {
    id: 'djot-highlight-braces',
    category: 'djot-shift',
    family: '{',
    pattern: /\{=(?!\s)((?:(?!\n[ \t]*\n)[\s\S])+?)(?<!\s)=\}/dg,
    message: () => 'Djot highlight `{=x=}` is also Carve highlight (`{=x=}`).',
    // Identity: the braced highlight form is valid Carve as-is and renders in
    // every position, so it is kept rather than reduced to a bare `=x=` (which
    // would be literal intraword).
    suggestion: (m) => `{=${m[1]}=}`,
    delims: ['{=', '=}'],
  },
  // Block-level (line-anchored): a leading `+ content` is a bullet in
  // Djot/Markdown but NOT in Carve — `+` is the list-continuation marker, so
  // the line renders as a paragraph. A lone `+` (no content) is excluded: that
  // IS the Carve continuation marker and is intentional.
  {
    id: 'djot-plus-bullet',
    category: 'carve-breakage',
    family: 'plus-bullet',
    pattern: /^[ \t]*(\+)(?=[ \t]+\S)/dgm,
    message: () =>
      'Djot/Markdown `+` bullet is not a Carve bullet (`+` is the list-continuation marker) — this line renders as a paragraph.',
    suggestion: () => '-',
  },
  // Block-level (line-anchored): Djot folds the line under a heading INTO that
  // heading — a plain line, or one carrying the same number of `#`. Carve ends
  // a heading at the newline (SINGLE-LINE HEADINGS), so the same two lines are
  // a heading plus a block, and the heading's auto-id changes with it. Valid
  // Carve either way, hence `djot-shift`: it matters only when the source came
  // from Djot. The match is the line break itself, so the fix joins the two
  // lines and keeps the Djot reading.
  // One rule, both forms, and the WHOLE run: Djot keeps folding line after line
  // until a blank line or a block opener, so `# A` / `B` / `C` is one heading.
  // Matching only the first break would "fix" it to `# A B` plus a stray
  // paragraph — a different document from either language. The match therefore
  // spans every folded line, and the fix rebuilds the heading from the original
  // source (group 1), stripping each same-count `#` marker exactly as Djot's
  // fold does; joining those raw would leave a literal `##` in the title.
  //
  // Anchored at the heading line and matching FORWARD: anchoring on the line
  // break needs a variable-length lookbehind at every newline, which made the
  // whole scan quadratic.
  //
  // A BARE same-count marker line (`#` alone, which Djot also folds) ends the
  // run here: it contributes no text, so no join reproduces the Djot reading,
  // and a wrong fix is worse than a missing one.
  //
  // The negative lookaheads below carry a second job beyond Carve's own block
  // openers: three constructs open a block in DJOT while Carve reads them as
  // prose, so Djot never folded them and a "fix" would pull a list item or a
  // definition term INTO the heading. Verified by running @djot/djot beside
  // this parser, not from memory:
  //   `(1) x` / `(a) x`  Djot's parenthesized ordered markers, incl. letters
  //                      and romans; Carve has no such marker
  //   `: x`              Djot definition list (Carve spells a term `:: x`,
  //                      which the `:{2,}` guard already covers)
  // The `+` bullet and a tab-after-bullet are covered by the `[-*+][ \t]`
  // guard, and 7-or-more hashes by the `#` guard.
  //
  // A LIFTED CONSTRUCT IS GUARDED BY THE BYTE, not by its spelling. By the time
  // this scan runs, the Djot importer has already replaced a brace run with a
  // NUL-delimited placeholder, so the `{` guard above cannot see it and the
  // comment in `# a` / `{% x` / `y %}` folded onto the heading line - and a
  // heading after it was swallowed too (carve-js#2682). djot.js ends the heading
  // at such a line and starts a new block, which is the reading this preserves.
  // Carve source carries no NUL of its own, so the byte is the whole test.
  {
    id: 'djot-heading-continuation',
    category: 'djot-shift',
    family: 'heading-continuation',
    pattern:
      /^((#{1,6})[ ]+[^\n]*\S(?:\n(?:\2[ ]+\S[^\n]*|(?![ \t]*$)(?![-*][ \t]*[-*][ \t]*[-*][-* \t]*$)(?!#)(?![>|])(?![-*+][ \t])(?!(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t])(?!:[ \t])(?!:{2,})(?!\([0-9a-zA-Z]+\)[ \t])(?![`~]{3,})(?!\^[ \t])(?!%{3,})(?!\{)(?!\x00)(?!\[[^\]\n]*\]:)[^\n]*\S))+)/dgm,
    message: () =>
      'Djot folds the line(s) below a heading INTO it (a plain line, or one with the same number of `#`); Carve ends the heading at the newline, so they are separate blocks and the heading id changes.',
    suggestion: (m) => {
      const [first, ...rest] = m[1]!.split('\n')
      const marker = new RegExp(`^#{${m[2]!.length}}[ ]+`)
      return [first, ...rest.map((l) => l.replace(marker, ''))].join(' ')
    },
  },
  // NOTE: full Djot reference links `[text][ref]` are NOT flagged — Carve
  // resolves them identically against a `[ref]: url` definition (corpus
  // 34-reference-link), so there is no silent mis-render. Math (`$`x``)
  // and editorial `{+ +}`/`{- -}` are likewise identical and unflagged.
]

const blanks = (s: string) => s.replace(/[^\n]/g, ' ')

/**
 * Codepoints before each UTF-16 index of `src`, or undefined when the two units
 * coincide - which they do for every source without an astral character, so the
 * common case allocates nothing.
 */
function codepointPrefix(src: string): Uint32Array | undefined {
  let astral = false
  for (let i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      astral = true
      break
    }
  }
  if (!astral) return undefined
  const before = new Uint32Array(src.length + 1)
  let count = 0
  for (let i = 0; i < src.length; i++) {
    before[i] = count
    const code = src.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < src.length) {
      // A surrogate pair is ONE codepoint; the low half shares the count, so an
      // index landing between the halves does not report a phantom column.
      before[i + 1] = count
      i++
    }
    count++
  }
  before[src.length] = count
  return before
}

/**
 * Return a copy of `src` with every code character (fenced blocks and
 * inline code spans, including multi-line ones) replaced by spaces, and
 * newlines preserved so line/column positions are unchanged. Delimiter
 * collisions inside code are not real mis-renders, so the scanner simply
 * never sees them.
 */
export function maskDjotFences(
  src: string,
  onFenceLine?: (line: number, replacement: string) => void,
  rowBoundaries: readonly boolean[] = [],
  strict = true,
): string {
  // Stage 1: fenced blocks, line by line.
  const lines = src.split('\n')
  const previousLines = new Map<number, string>()
  let sourceOffset = 0,
    previousLine = ''
  for (const line of lines) {
    previousLines.set(sourceOffset, previousLine)
    sourceOffset += line.length + 1
    previousLine = line
  }
  let fence: {
    ch: string
    len: number
    container: number | null
    depth: number
    target: string
    dedent: number
    normalize: boolean
  } | null = null
  let previousBlock = true,
    normalizeBoundary = true,
    previousDepth = 0
  const ancestors: { indent: number; column: number; ownerIndent: number }[][] = []
  const staged = lines.map((line, index) => {
    let content = line,
      depth = 0
    const views = [line]
    while (true) {
      const quote = /^[ \t]*>[ ]?/.exec(content)
      if (!quote) break
      content = content.slice(quote[0].length)
      depth++
      views.push(content)
    }
    let canNormalize = normalizeBoundary || rowBoundaries[index - 1] === true || depth < previousDepth
    previousDepth = depth
    if (fence && content.trim() !== '' && depth < fence.depth) fence = null
    if (
      fence &&
      fence.container !== null &&
      content.trim() !== '' &&
      /^[ \t]*/.exec(content)![0].length < fence.container &&
      depth === fence.depth
    )
      fence = null
    let nested = false,
      ownerColumn = 0,
      ownerIndent = 0
    ancestors.length = Math.min(ancestors.length, depth + 1)
    if (!fence && content.trim() !== '') {
      ancestors.length = depth + 1
      for (let level = 0; level <= depth; level++) {
        const view = views[level]!
        const stack = ancestors[level] ?? (ancestors[level] = [])
        const indent = /^[ \t]*/.exec(view)![0].length
        while (stack.length && stack[stack.length - 1]!.indent >= indent) {
          if (level === depth && stack.at(-1)!.column > 0 && indent <= stack.at(-1)!.ownerIndent) canNormalize = true
          stack.pop()
        }
        if (level === depth) {
          ownerColumn = stack.at(-1)?.column ?? 0
          ownerIndent = stack.at(-1)?.ownerIndent ?? 0
          nested = ownerColumn > 0
        }
        const marker =
          !/^(?:([*-])[ \t]*){3,}$/.test(view.trim()) &&
          /^[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+\S/.test(
            view,
          )
        const prefix =
          /^[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+/.exec(
            view,
          )?.[0] ?? ''
        const footnote =
          /^([ \t]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+)*)\[\^[^\]\n]+\]:/.exec(
            view,
          )
        const column = footnote
          ? footnote[1]!.replace(/\(([0-9A-Za-z]+)\)([ \t]+)/g, '$1.$2').length + 2
          : marker
            ? prefix.replace(/\(([0-9A-Za-z]+)\)([ \t]+)$/, '$1.$2').length
            : (stack.at(-1)?.column ?? 0)
        const owningIndent = footnote ? footnote[1]!.length : marker ? indent : (stack.at(-1)?.ownerIndent ?? 0)
        if (footnote && marker)
          stack.push({
            indent,
            column: prefix.replace(/\(([0-9A-Za-z]+)\)([ \t]+)$/, '$1.$2').length,
            ownerIndent: indent,
          })
        stack.push({ indent: footnote ? footnote[1]!.length : indent, column, ownerIndent: owningIndent })
      }
    }

    if (fence) {
      const close = /^[ \t]*([`~]{3,})[ \t]*$/.exec(content)
      if (close && depth === fence.depth && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
        if (fence.normalize)
          onFenceLine?.(index, line.slice(0, line.length - content.length) + fence.target + content.trimStart())
        normalizeBoundary = fence.normalize
        fence = null
        previousBlock = true
      } else if (fence.normalize && depth === fence.depth)
        onFenceLine?.(
          index,
          line.slice(0, line.length - content.length) +
            fence.target +
            content.slice(Math.min(fence.dedent, /^[ \t]*/.exec(content)![0].length)),
        )
      return blanks(line)
    }
    const open = trimEndSpaceTab(content).match(
      /^([ \t]*)(?:(\[\^[^\]\n]+\]:[ \t]*|(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+))?(`{3,}|~{3,})[ \t]*=?([a-zA-Z0-9_+#.-]*)$/,
    )
    if (open && !(open[2]?.startsWith(':') && !previousBlock) && (!strict || canNormalize || !!open[2])) {
      const container = open[2] ? open[1]!.length + 1 : nested ? ownerIndent + 1 : null
      const targetColumn = open[2]?.startsWith('[^')
        ? open[1]!.length + 2
        : open[2]
          ? open[1]!.length + open[2].replace(/\(([0-9A-Za-z]+)\)([ \t]+)$/, '$1.$2').length
          : nested
            ? ownerColumn
            : 0
      fence = {
        ch: open[3]![0]!,
        len: open[3]!.length,
        container,
        depth,
        target: ' '.repeat(targetColumn),
        dedent: open[1]!.length + (open[2]?.length ?? 0),
        normalize: canNormalize || !!open[2],
      }
      const nativeMarker = (open[2] ?? '').replace(/\(([0-9A-Za-z]+)\)([ \t]+)$/, '$1.$2')
      if (fence.normalize && (!open[2] || nativeMarker !== open[2]))
        onFenceLine?.(
          index,
          line.slice(0, line.length - content.length) +
            (open[2] ? open[1]! + nativeMarker : fence.target) +
            content.slice(fence.dedent),
        )
      const start = line.indexOf(open[3]!)
      return line.slice(0, start) + blanks(line.slice(start))
    }
    const attributeStart = content.length - content.trimStart().length
    const lineAttributes = content[attributeStart] === '{' ? readAttributes(content, attributeStart) : undefined
    const attributeBoundary = canNormalize && lineAttributes?.end === content.trimEnd().length
    normalizeBoundary = /^(?:[ 	]*[-*]){3,}[ 	]*$/.test(content) || /^[ 	]*\[(?!\^)[^\]]+\]:/.test(content) || content.trim() === '' || /^[ \t]*\[\^[^\]\n]+\]:[ \t]*$/.test(content) || /^[ \t]*(?:#{1,6} |:{3,})/.test(content) || attributeBoundary
    previousBlock = content.trim() === '' || /^[ \t]*(?:[-*+] |[0-9]+[.)] |:{1,2} |#{1,6} )/.test(content) || attributeBoundary
    return line
  })
  return staged.join('\n')
}

export function maskDjotCodeAndDestinations(
  src: string,
  references = true,
  unclosedCode = true,
  inlineForms = true,
  onFenceLine?: (line: number, replacement: string) => void,
  rowBoundaries: readonly boolean[] = [],
  opaqueOptions: DjotOpaqueOptions = {},
  strictFences = true,
): string {
  const previousLines = new Map<number, string>()
  let sourceOffset = 0,
    previousLine = ''
  for (const line of src.split('\n')) {
    previousLines.set(sourceOffset, previousLine)
    sourceOffset += line.length + 1
    previousLine = line
  }
  const s = maskDjotFences(src, onFenceLine, rowBoundaries, strictFences)

  // Every rewrite and loss scan shares the same opaque payload mask.
  let masked = maskDjotOpaque(s, unclosedCode, { ...(!inlineForms ? { inlineDestinations: opaqueOptions.destinations === true, autolinks: false, attributeValues: false, comments: false } : {}), ...opaqueOptions })
  if (!inlineForms) return masked

  if (references)
    masked = masked
      .replace(/^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9]+[.)])[ \t]+)?\[(?!\^)[^\]\n]*\]:[^\n]*/gm, (value, at: number) => {
        const previous = (previousLines.get(at) ?? '')?.replace(/^[ \t]*(?:>[ \t]*)*/, '').trim() ?? ''
        return previous === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{[ \t.#A-Za-z}%]|\[(?!\^)[^\]]*\]:)/.test(previous)
          ? blanks(value)
          : value
      })
      .replace(/(?<=\])\[[^\]\n]*\]/g, blanks)
  masked = masked.replace(
    /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|[0-9]+[.)])[ \t]+)?:{3,}[ \t]+([A-Za-z_][A-Za-z0-9_.-]*)/gm,
    (value: string, name: string, at: number) =>
      (previousLines.get(at) ?? '').trim() === '' || /(?:[-*+]|[0-9]+[.)])[ \t]+:{3,}/.test(value)
        ? value.slice(0, -name.length) + blanks(name)
        : value,
  )
  return masked.replace(/!\[([^\[\]\n]*)\](?=[([])/g, (value: string, label: string, at: number) =>
    isDjotEscaped(src, at) || isDjotEscaped(src, at + value.length - 1) ? value : `![${blanks(label)}]`,
  )
}

/** A single source splice: replace [start, end) with `text`. */
interface Edit {
  start: number
  end: number
  text: string
}

/** A scan result enriched with the delimiter edits that fix it. */
interface ScanHit extends MigrationWarning {
  /**
   * The edits that apply this fix. A wrapping construct yields two edits
   * (its delimiters); the `+` bullet yields one (a whole-span replacement).
   * Edits never touch the captured content, so nested hits' edits don't
   * collide.
   */
  edits: Edit[]
}

/** Project a ScanHit down to the public warning shape (drop `edits`). */
function stripHit(h: ScanHit): MigrationWarning {
  return {
    line: h.line,
    column: h.column,
    rule: h.rule,
    category: h.category,
    message: h.message,
    suggestion: h.suggestion,
    start: h.start,
    end: h.end,
  }
}

/**
 * Scan Djot/Carve source and return warnings for constructs that silently
 * change meaning under Carve. Empty array means the source is free of the
 * known Djot/Carve delimiter collisions.
 */
/**
 * Comparison counter for the same-family overlap scan, for TESTS only.
 *
 * The scan's cost is what carve-js#653's fix made near-linear, and the guard for
 * it was a wall-clock RATIO between two input sizes. That flaked on CI at 2.079
 * against a bound of 2 (carve-js#656): the two measurements are seconds apart, so
 * a runner that is busy for part of the run skews one relative to the other, and
 * no amount of interleaving or median-taking fixes that.
 *
 * Steps are deterministic. A healthy scan is O(n log n), so steps PER CONSTRUCT
 * grow like log n - a ratio of ~1.2 across a 4x input. A linear scan of the
 * growing array, which is the regression this guards, makes it O(n^2) and the
 * ratio 4. Nothing in between, and nothing that depends on the machine.
 *
 * carve-js#653 reached for the same idea from the other side, swapping a timing
 * guard for one on bytes emitted.
 */
export const migrateScanSteps = { count: 0 }

/**
 * Pair comparisons the cross-detection sweep in `applyMigrationFixes` performs,
 * for the same reason `migrateScanSteps` exists and with the same contract.
 *
 * The regression it guards is the all-pairs `hits.some(crosses)` loop this
 * sweep replaced: that is O(n^2), so its comparisons PER HIT grow like n and
 * quadruple across a 4x input. The active-list sweep's comparisons per hit stay
 * flat, because a hit is compared only against the intervals still open at its
 * own start.
 *
 * A clock cannot ask that question here. What `applyMigrationFixes` spends most
 * of its time on for a large input is the per-edit whole-string splice below,
 * which is a separate O(edits x length) cost this sweep has no bearing on - so
 * a wall-clock bound on the whole call reads mostly that, loosely, and a loose
 * bound on that dominant term would not measure this sweep.
 */
export const migrateCrossSteps = { count: 0 }

export function djotMigrationWarnings(source: string): MigrationWarning[] {
  return scanHits(source).map(stripHit)
}

/** Lines consumed by a table row after the row's own opening line. */
function tableContinuationLines(source: string): Set<number> {
  const lines = new Set<number>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    const node = value as Record<string, unknown>
    if (node.type === 'table_row') {
      const pos = node.pos as { startLine?: number; endLine?: number } | undefined
      if (pos?.startLine !== undefined && pos.endLine !== undefined) {
        for (let line = pos.startLine + 1; line <= pos.endLine; line++) lines.add(line)
      }
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(parse(source))
  return lines
}

export const migrateBracedSteps = { count: 0 }
export const migrateCandidateChecks = { count: 0 }
export const migrateBareSteps = { count: 0 }

function* ruleMatches(masked: string, rule: Rule, source: string, nativeDjotCode: boolean): Generator<RegExpExecArray> {
  const opener =
    rule.id === 'djot-subscript-tilde-braced' ? '{~' : rule.id === 'djot-highlight-braces' ? '{=' : undefined
  if (opener === undefined) {
    const candidate =
      rule.id === 'djot-subscript-tilde'
        ? '~'
        : rule.id === 'djot-superscript-caret'
          ? '^'
          : rule.id === 'djot-emphasis-underscore' || rule.id === 'djot-intraword-underscore'
            ? '_'
            : undefined
    if (candidate !== undefined) {
      let candidateMask = masked
      if (candidate === '^' && masked.includes('^')) {
        const chars = masked.split('')
        for (let at = 0; at < masked.length; at++) {
          if (masked[at] === '{' && /[.#A-Za-z]/.test(source[at + 1] ?? '') && !isDjotEscaped(source, at)) {
            const attrs = readAttributes(source, at)
            if (attrs) {
              for (let inner = at; inner < attrs.end; inner++) if (chars[inner] === '^') chars[inner] = '\x01'
              at = attrs.end - 1
              continue
            }
          }
          if (!masked.startsWith('[^', at) || isDjotEscaped(source, at)) continue
          let end = at + 2
          while (end < source.length && source[end] !== '\n' && (source[end] !== ']' || isDjotEscaped(source, end)))
            end++
          if (source[end] === ']') {
            for (let inner = at + 1; inner < end; inner++) if (chars[inner] === '^') chars[inner] = '\x01'
          }
          at = end
        }
        candidateMask = chars.join('')
      }
      const whitespace = candidate === '_' ? /[ \t\n\r\f]/ : /\s/
      const intraword = rule.id === 'djot-intraword-underscore'
      const word = intraword ? /[A-Za-z0-9]/ : /[A-Za-z0-9_]/
      for (let cursor = 0; cursor < masked.length;) {
        const start = candidateMask.indexOf(candidate, cursor)
        migrateBareSteps.count += start < 0 ? masked.length - cursor : start - cursor + 1
        if (start < 0) break
        cursor = start + 1
        if (candidate === '^' && !nativeDjotCode && source[start + 1] === '[') continue
        if (
          isDjotEscaped(source, start) ||
          (candidate !== '_' && source[start + 1] === '}') ||
          (candidate !== '_' && source[start - 1] === '{' && !isDjotEscaped(source, start - 1))
        )
          continue
        if (whitespace.test(candidateMask[start + 1] ?? '')) continue
        if (candidate === '_' && word.test(candidateMask[start - 1] ?? '') !== intraword) continue
        migrateCandidateChecks.count++
        let end = start + 1
        for (; end < candidateMask.length; end++) {
          migrateBareSteps.count++
          if (candidateMask[end] === '\n') {
            let next = end + 1
            while (source[next] === ' ' || source[next] === '\t') {
              migrateBareSteps.count++
              next++
            }
            while (source[next] === '>') {
              migrateBareSteps.count++
              next++
              while (source[next] === ' ' || source[next] === '\t') {
                migrateBareSteps.count++
                next++
              }
            }
            if (source[next] === '\n') break
          }
          if (candidateMask[end] === '\\' && candidateMask[end + 1] !== '\n') { end++; continue }
          if (candidateMask[end] === candidate && (candidate === '_' || source[end + 1] !== '}')) break
        }
        cursor = end
        if (end >= candidateMask.length || candidateMask[end] !== candidate) {
          cursor++
          continue
        }
        if (end === start + 1 || whitespace.test(candidateMask[end - 1]!)) continue
        if (candidate === '_' && word.test(candidateMask[end + 1] ?? '') !== intraword) continue
        cursor = end + 1
        yield Object.assign([candidateMask.slice(start, cursor), candidateMask.slice(start + 1, end)], {
          index: start,
          input: candidateMask,
          indices: [
            [start, cursor],
            [start + 1, end],
          ],
        }) as RegExpExecArray
      }
      return
    }
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(masked))) yield match
    return
  }
  const closer = opener[1]! + '}'
  for (let cursor = 0; cursor < masked.length;) {
    const start = masked.indexOf(opener, cursor)
    migrateBracedSteps.count += start < 0 ? masked.length - cursor : start - cursor + 2
    if (start < 0) break
    const from = start + 2
    if (isDjotEscaped(masked, start)) {
      cursor = from
      continue
    }
    let end = from
    for (; end < masked.length; end++) {
      migrateBracedSteps.count++
      if (masked.startsWith(opener, end) && !isDjotEscaped(source, end)) break
      if (masked[end] === '\n') {
        let next = end + 1
        while (source[next] === ' ' || source[next] === '\t') {
          migrateBracedSteps.count++
          next++
        }
        while (source[next] === '>') {
          migrateBracedSteps.count++
          next++
          while (source[next] === ' ' || source[next] === '\t') {
            migrateBracedSteps.count++
            next++
          }
        }
        if (source[next] === '\n') break
      }
      if (masked.startsWith(closer, end) && !isDjotEscaped(masked, end)) break
    }
    if (masked.startsWith(closer, end)) {
      cursor = end + 2
      if (end === from) continue
      const match = Object.assign([masked.slice(start, cursor), masked.slice(from, end)], {
        index: start,
        input: masked,
        indices: [
          [start, cursor],
          [from, end],
        ],
      }) as RegExpExecArray
      yield match
    } else cursor = masked.startsWith(opener, end) ? end : end + 1
  }
}

/** The full scan, carrying the fix edits used by `applyMigrationFixes`. */
function scanHits(source: string, nativeDjotCode = false): ScanHit[] {
  const out: ScanHit[] = []
  // Code (fenced + inline, multi-line) is masked to spaces so no rule
  // can match through or into it. Positions are preserved 1:1. The scan
  // runs over the whole text (not per line) so delimiter pairs that
  // cross a soft line break are still caught. Normalize line endings
  // first, exactly as parse() does, so results don't depend on CRLF.
  // `norm` keeps the real characters (incl. code) at the same offsets as
  // `masked`, so the captured content for a suggestion is sliced from
  // `norm` — masking only ever blanks the *content*, never the delimiters.
  const norm = source.replace(/\r\n?/g, '\n')
  let masked = maskDjotCodeAndDestinations(norm, true, nativeDjotCode, true, undefined, [], {}, nativeDjotCode)
  if (nativeDjotCode && norm.includes('{')) {
    const chars = masked.split('')
    for (let at = 0; at < norm.length; at++) {
      if (chars[at] !== '{' || isDjotEscaped(norm, at)) continue
      const attrs = readAttributes(norm, at)
      if (!attrs) continue
      for (let i = at; i < attrs.end; i++) if (chars[i] !== '\n') chars[i] = ' '
      at = attrs.end - 1
    }
    masked = chars.join('')
  }
  // A `+ ` line carrying a pipe is ambiguous by text alone: without a table
  // above it, it is a Djot bullet that degrades to prose in Carve; after a
  // table row, it is Carve's native continuation-row syntax. Ask the parser
  // only when that candidate shape exists, then exempt exactly the lines it
  // consumed into a table row. Row positions include continuation lines by
  // contract.
  //
  // THE PIPE NEED NOT BE THE FIRST THING AFTER THE MARKER. A continuation row
  // whose first cell carries content is spelled `+ text | more |`, and the
  // predicate used to require `+ |` - so exactly the rows that continue a
  // non-empty cell, which is the common case, kept reporting. Widening it only
  // costs a parse on a line that turns out not to be a row: the parser is
  // still what decides, and a real Djot bullet holding a pipe comes back with
  // no continuation lines and reports as before.
  const continuationLines = /^[ \t]*\+[ \t][^\n]*\|/m.test(masked) ? tableContinuationLines(norm) : new Set<number>()

  // index -> {line, column} (both 1-based), via newline prefix sums.
  const nlAt: number[] = []
  for (let k = 0; k < masked.length; k++) if (masked[k] === '\n') nlAt.push(k)
  // CODEPOINTS before each UTF-16 index of `norm`, built only when the source
  // has an astral character. `column` counts codepoints, the unit every other
  // diagnostic in this package reports and the one PART 12 §4 pins; `start` and
  // `end` stay UTF-16 because they are splice targets. Reporting UTF-16 here
  // put the column one past the construct for every emoji on the line
  // (carve-js#2240).
  //
  // Counted over `norm`, NOT `masked`: masking replaces each code UNIT with a
  // space, so a surrogate pair inside a code span becomes two codepoints and
  // the count would drift exactly where the two strings stop agreeing.
  const cpBefore = codepointPrefix(norm)
  const columnOf = (lineStart: number, idx: number) =>
    cpBefore ? cpBefore[idx]! - cpBefore[lineStart]! + 1 : idx - lineStart + 1
  const posOf = (idx: number) => {
    let lo = 0
    let hi = nlAt.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nlAt[mid]! < idx) lo = mid + 1
      else hi = mid
    }
    const lineStart = lo === 0 ? 0 : nlAt[lo - 1]! + 1
    return { line: lo + 1, column: columnOf(lineStart, idx) }
  }

  // Accept matches in RULES order. Drop a later match only if it
  // overlaps an accepted one of the SAME delimiter family — that is a
  // re-match of the same construct (`~~x~~` must not also report the
  // inner `~x~`). A nested *different* family (`~~_x_~~` -> strike AND
  // emphasis; `**_x_**` -> strong AND emphasis) is two real, distinct
  // mis-renders, so both are kept.
  // Per-family list of accepted [start, end) intervals, kept sorted by start.
  // Overlap is then a binary search (find the rightmost interval starting
  // before `e`, check it covers past `s`) instead of a linear scan of a
  // single growing array — the latter was O(n^2) on inputs with thousands of
  // same-family matches (e.g. `**a** ` repeated). Each rule yields disjoint
  // ranges in ascending order. Merge them once, so interleaved rules do not copy
  // a growing array for every insertion.
  const takenByFamily = new Map<string, Array<[number, number]>>()
  const sameFamilyOverlap = (s: number, e: number, fam: string): boolean => {
    const list = takenByFamily.get(fam)
    migrateScanSteps.count++
    if (!list || list.length === 0) return false
    // Rightmost interval with start < e.
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      migrateScanSteps.count++
      const mid = (lo + hi) >> 1
      if (list[mid]![0] < e) lo = mid + 1
      else hi = mid
    }
    // Intervals are non-overlapping within a family, so sorting by start also
    // sorts by end. The rightmost interval starting before `e` (index lo-1)
    // has the largest end among all candidates; if it does not reach past `s`,
    // none do. So a single check at lo-1 decides overlap.
    if (lo === 0) return false
    return list[lo - 1]![1] > s
  }
  const recordTaken = (added: Array<[number, number]>, fam: string): void => {
    if (added.length === 0) return
    const list = takenByFamily.get(fam)
    if (!list || list.length === 0) {
      takenByFamily.set(fam, added)
      return
    }
    const merged: Array<[number, number]> = []
    let old = 0,
      next = 0
    while (old < list.length && next < added.length) {
      migrateScanSteps.count++
      merged.push(list[old]![0] <= added[next]![0] ? list[old++]! : added[next++]!)
    }
    takenByFamily.set(fam, [...merged, ...list.slice(old), ...added.slice(next)])
  }

  for (const rule of RULES) {
    const added: Array<[number, number]> = []
    for (const m of ruleMatches(masked, rule, norm, nativeDjotCode)) {
      const markerSpan = rule.id === 'djot-plus-bullet' ? m.indices?.[1] : undefined
      const start = markerSpan?.[0] ?? m.index
      const end = markerSpan?.[1] ?? m.index + m[0].length
      // A backslash-escaped opening delimiter is a literal in both
      // Djot and Carve (e.g. `\_x_`). Only an ODD run of backslashes
      // escapes; `\\_x_` is an escaped backslash + a live `_x_`.
      let bs = 0
      for (let k = start - 1; k >= 0 && masked[k] === '\\'; k--) bs++
      if (bs % 2 === 1) continue
      if (rule.id === 'djot-plus-bullet' && continuationLines.has(posOf(start).line)) continue
      if (sameFamilyOverlap(start, end, rule.family)) continue
      added.push([start, end])
      const { line, column } = posOf(start)
      // Build the suggestion from the ORIGINAL captured content, not the
      // code-masked one, so `*a `code` b*` round-trips instead of losing
      // the backticked run to spaces. `m.indices` is present because every
      // pattern carries the `d` flag; group 1 always participates.
      const span = m.indices?.[1]
      const orig = span ? norm.slice(span[0], span[1]) : m[1]!
      const origM = m.slice() as RegExpExecArray
      origM[1] = orig
      // Fix edits. A wrapping rule rewrites only its delimiters (the slices
      // before/after the captured content), leaving content verbatim, so
      // nested fixes compose. A whole-span rule (the `+` bullet) replaces
      // its single match with the suggestion.
      const suggestion = rule.suggestion(origM)
      let edits: Edit[] =
        rule.delims && span
          ? [
              { start, end: span[0], text: rule.delims[0] },
              { start: span[1], end, text: rule.delims[1] },
            ]
          : [{ start, end, text: suggestion }]
      if (rule.id === 'djot-heading-continuation' && span) {
        edits = []
        const marker = m[2]! + ' '
        for (let at = orig.indexOf('\n'); at >= 0; at = orig.indexOf('\n', at + 1)) {
          let to = at + 1
          if (orig.startsWith(marker, to)) {
            to += marker.length
            while (orig[to] === ' ') to++
          }
          edits.push({ start: span[0] + at, end: span[0] + to, text: ' ' })
        }
      }
      out.push({
        line,
        column,
        rule: rule.id,
        category: rule.category,
        message: rule.message(m),
        suggestion,
        start,
        end,
        edits,
      })
    }
    recordTaken(added, rule.family)
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
   * Warnings left untouched because their span *crosses* another warning -
   * a partial overlap where neither span contains the other (e.g.
   * `**_x**_`, which is strong over `_x` AND emphasis over `x**`). Such
   * source is genuinely ambiguous, so it is reported for the caller to
   * resolve by hand rather than guessed at. Strictly *nested* collisions
   * (`**_x_**`) are NOT skipped - they compose and land in `applied`.
   */
  skipped: MigrationWarning[]
}

/**
 * Apply the auto-fixable Djot/Carve migration collisions to `source`,
 * returning the rewritten text. This is the autocorrect companion to
 * {@link djotMigrationWarnings}.
 *
 * Each fix is expressed as edits to its delimiters only, never its content,
 * so strictly nested collisions compose in one pass: the outer strong
 * delimiters and the inner emphasis delimiters sit at distinct offsets, so
 * `**_x_**` fixes to single-star bold wrapping a slash emphasis. Only
 * *crossing* collisions - partial overlaps where neither span contains the
 * other - are skipped, since that source is genuinely ambiguous. The scan is
 * not re-run on the output, so a fixed `~~x~~` -> `~x~` is never re-flagged
 * as a subscript.
 */
export function applyMigrationFixes(source: string, nativeDjotCode = false): MigrationFixResult {
  const hits = scanHits(source, nativeDjotCode)

  // Mark every hit that *crosses* another (partial overlap where neither span
  // contains the other). `hits` is sorted by start (line/column), so a single
  // sweep replaces the O(n^2) all-pairs scan. Two intervals a (earlier start)
  // and b cross iff start_b < end_a < end_b. Keep an "active" list of earlier
  // intervals still open past the current start (end > start_b); among those,
  // any whose end is strictly inside b (end_a < end_b) crosses b, and vice
  // versa. Equal starts can never cross (one contains the other).
  const crossed = new Set<ScanHit>()
  // Active intervals, kept sorted by end. Heap-free: ends are pruned from the
  // front as the sweep advances, and inserts are by binary position.
  const active: ScanHit[] = []
  for (const b of hits) {
    // Drop intervals that closed at or before b's start: they can't cross b.
    let drop = 0
    while (drop < active.length && active[drop]!.end <= b.start) {
      migrateCrossSteps.count++
      drop++
    }
    if (drop > 0) active.splice(0, drop)
    for (const a of active) {
      migrateCrossSteps.count++
      // a.start <= b.start (sweep order) and a.end > b.start (still active).
      // Crossing needs a.end strictly inside b and starts distinct.
      if (a.start === b.start) continue
      if (a.end < b.end) {
        crossed.add(a)
        crossed.add(b)
      }
      // a.end >= b.end means a contains b (no cross from this pair).
    }
    // Insert b keeping `active` sorted by end.
    let lo = 0
    let hi = active.length
    while (lo < hi) {
      migrateCrossSteps.count++
      const mid = (lo + hi) >> 1
      if (active[mid]!.end < b.end) lo = mid + 1
      else hi = mid
    }
    active.splice(lo, 0, b)
  }

  const applied: ScanHit[] = []
  const skipped: ScanHit[] = []
  for (const h of hits) {
    if (crossed.has(h)) skipped.push(h)
    else applied.push(h)
  }

  // Copy untouched source ranges once. Heading folds replace their line
  // prefixes only, so they compose with inline delimiter edits.
  const edits = applied.flatMap((h) => h.edits).sort((a, b) => a.start - b.start)
  const normalized = source.replace(/\r\n?/g, '\n')
  const pieces: string[] = []
  let cursor = 0
  for (const e of edits) {
    pieces.push(normalized.slice(cursor, e.start), e.text)
    cursor = e.end
  }
  pieces.push(normalized.slice(cursor))
  return {
    output: pieces.join(''),
    applied: applied.map(stripHit),
    skipped: skipped.map(stripHit),
  }
}

/** Format warnings as `file:line:col rule — message (use: suggestion)`. */
export function formatMigrationWarnings(warnings: MigrationWarning[], file = '<stdin>'): string {
  return warnings.map((w) => `${file}:${w.line}:${w.column} ${w.rule} — ${w.message} (use: ${w.suggestion})`).join('\n')
}
