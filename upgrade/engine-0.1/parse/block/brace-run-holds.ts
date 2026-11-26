import { isBlankLine, type Lexer } from '../parse-lexer.js'
import { FOOTNOTE_BODY_COLUMN, quotePrefixDepth, sourceQuotePrefixEnd } from './parse-block-boundaries.js'
import { sourceQuoteLocalColumn } from '../list/parse-item-core.js'

// List, quote and note markers before a run hold no `{%` of their own.
const RE_RUN_MARKERS = /^[ \t]*(?:(?:>|(?:[-*+]|\d+[.)])[ \t]+(?:\[[^\]]\][ \t]+)?|\[\^[^\]]+\]:[ \t]+)[ \t]*)*/
const RE_NOTE_HEAD_BEFORE_RUN = /\[\^[^\]]+\]:[ \t]+$/

export interface BraceRunHolds {
  /** Registers line `index` as an opener when `text` starts a block `{%` run that closes validly ahead. */
  open(index: number, text: string): void
  holds(index: number): boolean
  /** `text` with a held line's run text replaced by a plain word, its own quote prefixes kept. */
  mask(index: number, text: string): string
  /** `mask` for 1-based source line `number`, for a collector that keeps line numbers only. */
  maskLine(number: number, text: string): string
}

/**
 * The lines a valid block `{%` run holds, found by looking ahead from its opener at
 * authored source columns (CARVE-P2-035). Lazy trackers read a held line as plain
 * text, so a fence-shaped one opens no fence before the closer arrives.
 */
export function braceRunHolds(lexer: Lexer): BraceRunHolds {
  // The document's lines before the ownership walk moved any of them.
  const root = lexer.documentRoot ?? lexer
  const authored = root.authoredRootLines ?? root.rootLines ?? root.authoredLines ?? root.lines
  const source = (index: number): string => authored[lexer.lineNumber(index) - 1] ?? lexer.lineAt(index) ?? ''
  let first = -1
  let through = -1
  let firstLine = 0
  let throughLine = 0
  let depth = 0
  const maskAt = (number: number, text: string): string => {
    if (number <= firstLine || number > throughLine) return text
    let offset = 0
    for (let keep = depth - (quotePrefixDepth(authored[number - 1] ?? text) - quotePrefixDepth(text)); keep > 0; keep--) {
      const end = sourceQuotePrefixEnd(text, offset)
      if (end < 0) break
      offset = end
    }
    while (text[offset] === ' ' || text[offset] === '\t') offset++
    const rest = text.slice(offset)
    const close = number === throughLine ? rest.indexOf('%}') : -1
    return text.slice(0, offset) + (close < 0 ? 'x' : 'x ' + rest.slice(close))
  }
  return {
    open(index, text) {
      if (index <= through || !text.includes('{%')) return
      const run = text.replace(RE_RUN_MARKERS, '')
      if (!run.startsWith('{%') || run.includes('%}', 2)) return
      const opener = source(index)
      const brace = opener.indexOf('{%')
      if (brace < 0) return
      const openerDepth = quotePrefixDepth(opener)
      let start = 0
      for (let level = 0; level < openerDepth; level++) start = Math.max(start, sourceQuotePrefixEnd(opener, start))
      // A run behind a note head is measured from that note's body column (CARVE-P2-035).
      const head = RE_NOTE_HEAD_BEFORE_RUN.exec(opener.slice(start, brace))
      const end = head === null ? brace : start + head.index
      // Quote content is measured in its own columns (PART 9 §24 C5).
      let column = 0
      for (let k = start; k < end; k++) column += opener[k] === '\t' ? 4 - column % 4 : 1
      if (head !== null) column += FOOTNOTE_BODY_COLUMN
      for (let k = index + 1; k < lexer.lineCount; k++) {
        const line = source(k)
        // A line missing one of the opener's quote levels is a lazy line, which a run does not take (carve#5830).
        const at = sourceQuoteLocalColumn(line, openerDepth)
        if (isBlankLine(line.replace(/^[ \t>]*/, '')) || at === Infinity || at <= column) return
        if (line.includes('%}')) {
          first = index
          through = k
          firstLine = lexer.lineNumber(index)
          throughLine = lexer.lineNumber(k)
          depth = openerDepth
          return
        }
      }
    },
    holds: (index) => index > first && index <= through,
    mask: (index, text) => maskAt(lexer.lineNumber(index), text),
    maskLine: maskAt,
  }
}
