import { isBlankLine, type Lexer } from '../parse-lexer.js'
import { quotePrefixDepth, sourceColumn, sourceQuotePrefixEnd } from './parse-block-boundaries.js'

// List, quote and note markers before a run hold no `{%` of their own.
const RE_RUN_MARKERS = /^[ \t]*(?:(?:>|(?:[-*+]|\d+[.)])[ \t]+(?:\[[^\]]\][ \t]+)?|\[\^[^\]]+\]:[ \t]+)[ \t]*)*/

export interface BraceRunHolds {
  /** Registers line `index` as an opener when `text` starts a block `{%` run that closes validly ahead. */
  open(index: number, text: string): void
  holds(index: number): boolean
  /** `text` with a held line's run text replaced by a plain word, its own quote prefixes kept. */
  mask(index: number, text: string): string
}

/**
 * The lines a valid block `{%` run holds, found by looking ahead from its opener at
 * authored source columns (CARVE-P2-035). Lazy trackers read a held line as plain
 * text, so a fence-shaped one opens no fence before the closer arrives.
 */
export function braceRunHolds(lexer: Lexer): BraceRunHolds {
  const authored = lexer.authoredRootLines ?? lexer.rootLines ?? lexer.authoredLines ?? lexer.lines
  const source = (index: number): string => authored[lexer.lineNumber(index) - 1] ?? lexer.lineAt(index) ?? ''
  let first = -1
  let through = -1
  let depth = 0
  return {
    open(index, text) {
      if (index <= through || !text.includes('{%')) return
      const run = text.replace(RE_RUN_MARKERS, '')
      if (!run.startsWith('{%') || run.includes('%}', 2)) return
      const opener = source(index)
      const brace = opener.indexOf('{%')
      if (brace < 0) return
      let column = 0
      for (let k = 0; k < brace; k++) column += opener[k] === '\t' ? 4 - column % 4 : 1
      const openerDepth = quotePrefixDepth(opener)
      for (let k = index + 1; k < lexer.lineCount; k++) {
        const line = source(k)
        // A line missing one of the opener's quote levels is a lazy line, which a run does not take (carve#5830).
        const at = sourceColumn(line, openerDepth)
        if (isBlankLine(line.replace(/^[ \t>]*/, '')) || at === Infinity || at <= column) return
        if (line.includes('%}')) {
          first = index
          through = k
          depth = openerDepth
          return
        }
      }
    },
    holds: (index) => index > first && index <= through,
    mask(index, text) {
      if (index <= first || index > through) return text
      let offset = 0
      for (let keep = depth - (quotePrefixDepth(source(index)) - quotePrefixDepth(text)); keep > 0; keep--) {
        const end = sourceQuotePrefixEnd(text, offset)
        if (end < 0) break
        offset = end
      }
      while (text[offset] === ' ' || text[offset] === '\t') offset++
      const rest = text.slice(offset)
      const close = index === through ? rest.indexOf('%}') : -1
      return text.slice(0, offset) + (close < 0 ? 'x' : 'x ' + rest.slice(close))
    },
  }
}
