import type { ParseOptions } from '../../parse.js'
import { isValidAttrPayload } from '../../extension/attribute-parser.js'
import { indentColumns, isBlankLine, Lexer, sliceColumns } from '../parse-lexer.js'
import { isBlockAttributeLine, probeBlockAttributes } from '../parse-prepass-core.js'

/** Lines of the block attribute runs at `at(0)`, wrapped runs included (PART 9 §15 A5, CARVE-P2-035). */
export function leadingAttributeRun(at: (offset: number) => string | undefined, options: ParseOptions): number {
  let count = 0
  while (at(count)?.startsWith('{')) {
    const lines: string[] = []
    for (let line = at(count); line !== undefined && !isBlankLine(line); line = at(count + lines.length)) {
      const closed = line.includes('}')
      // The same early refusal `probeBlockAttributes` makes, so a stray `{` scans one line.
      if (lines.length > 0 && !closed && !isValidAttrPayload('\n' + line + '\n')) return count
      lines.push(line)
      if (closed) break
    }
    const run = probeBlockAttributes(new Lexer(lines, options, 0))
    if (run === null) break
    count += run.count
  }
  return count
}

/** Lines of the wrapped attribute run opening at `at(0)`, read at its opener's column; 0 when there is none. */
export function wrappedAttributeLinesAt(at: (offset: number) => string | undefined, options: ParseOptions = {}): number {
  const column = indentColumns(at(0) ?? '')
  const run = leadingAttributeRun((offset) => {
    const line = at(offset)
    return line === undefined ? undefined : sliceColumns(line, column, true)
  }, options)
  return run > 1 ? run : 0
}

/** The index of the first line at or after `from` that is not part of a one-line or wrapped attribute run. */
export function afterAttributeLines(lines: readonly string[], from: number, limit = lines.length - 1): number {
  let k = from
  while (k < limit) {
    const run = wrappedAttributeLinesAt(offset => lines[k + offset]) || (isBlockAttributeLine(lines[k]!.trimStart()) ? 1 : 0)
    if (run === 0 || k + run > limit) break
    k += run
  }
  return k
}
