import { indentColumns, sliceColumns } from '../parse-lexer.js'
import { RE_FOOTNOTE_DEF, isBlockAttributeLine, isLinkDefLine, isListMarkerLine, lineOpensBlock } from '../parse-prepass-core.js'
import { fenceCloseRe, opensCodeFence } from './parse-quote-core.js'

/**
 * Where a block at or past `contentCol` ends the paragraph a first-block `+` pulled left of it,
 * or -1. A block read in a container at its content column ends the preceding paragraph,
 * pulled or not (CARVE-P0-011, carve#5331, carve#5349). List markers and definitions keep their
 * own rules at the callers.
 */
export function pulledParagraphBlockCut(lines: readonly string[], contentCol: number): number {
  let first = 0
  while (first < lines.length - 1 && isBlockAttributeLine(lines[first]!.trimStart())) first++
  if (first >= lines.length || lineOpensBlock(sliceColumns(lines[first]!, indentColumns(lines[first]!), true))) return -1
  let fenceRun: string | undefined
  for (let index = first + 1; index < lines.length; index++) {
    const line = lines[index]!
    const text = line.trimStart()
    if (fenceRun !== undefined) {
      if (fenceCloseRe(fenceRun).test(text)) fenceRun = undefined
      continue
    }
    if (indentColumns(line) >= contentCol && !isListMarkerLine(text) && !isLinkDefLine(text) &&
        !RE_FOOTNOTE_DEF.test(text) && (lineOpensBlock(text) || isBlockAttributeLine(text))) return index
    if (opensCodeFence(text)) fenceRun = /^(`{3,}|~{3,})/.exec(text)?.[1]
  }
  return -1
}
