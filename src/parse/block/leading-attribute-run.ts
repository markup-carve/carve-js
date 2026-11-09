import type { ParseOptions } from '../../parse.js'
import { isValidAttrPayload } from '../../extension/attribute-parser.js'
import { isBlankLine } from '../parse-lexer.js'
import { probeBlockAttributes } from '../parse-prepass-core.js'
import { subLexer } from './parse-block-scan-core.js'

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
    const run = probeBlockAttributes(subLexer(lines, options, 0))
    if (run === null) break
    count += run.count
  }
  return count
}
