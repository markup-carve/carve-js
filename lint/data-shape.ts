import { divRunLength, fenceOpenerLength, headingLevel, isAttributeLine, isIncludeLine, isListMarker, isQuoteMark,
  rowClosingPipe, termMarkEnd, descriptionMarkEnd } from '../src/lines.ts'

const BARE_RUN = /^:{3,}[ \t]*$/

/**
 * The line shape of data/line-shapes.json that `body` has, read without the `requires` and `at` conditions of a shape,
 * so closers, frontmatter and continuation rows are not told apart; `text` when no other shape matches.
 */
export function shapeOf(body: string): string {
  const end = body.length
  if (end === 0) return 'blank'
  return SHAPES[body[0]!]?.(body, end) ?? 'text'
}

const SHAPES: Record<string, (body: string, end: number) => string | undefined> = {
  '#': (body, end) => (headingLevel(body, 0, end) > 0 ? 'heading' : undefined),
  '=': (body, end) => (headingLevel(body, 0, end) > 0 ? 'heading' : undefined),
  '>': (body, end) => (isQuoteMark(body, 0, end) ? 'quote' : undefined),
  '*': (body, end) => {
    if (/^\*{3,}[ \t]*$/.test(body)) return 'thematic_break'
    if (/^\*\[[a-zA-Z0-9]+\]: \S/.test(body)) return 'abbreviation_definition'
    return isListMarker(body, 0, end) ? 'bullet' : undefined
  },
  '-': (body, end) => (isListMarker(body, 0, end) ? 'bullet' : undefined),
  ':': (body, end) => {
    if (BARE_RUN.test(body)) return 'div_bare_run'
    if (divRunLength(body, 0, end) > 0) return 'div_opener'
    if (termMarkEnd(body, 0, end) >= 0) return 'term'
    return descriptionMarkEnd(body, 0, end) >= 0 ? 'description' : undefined
  },
  '{': (body, end) => {
    if (isIncludeLine(body, 0, end)) return 'include'
    return isAttributeLine(body, 0, end) ? 'attribute_line' : undefined
  },
  '|': (body, end) => (rowClosingPipe(body, 0, end) >= 0 ? 'table_row' : undefined),
  '`': (body, end) => (fenceOpenerLength(body, 0, end) > 0 ? 'code_fence_opener' : undefined),
  '^': (body) => (body.startsWith('^ ') ? 'caption' : undefined),
  '[': (body) => {
    if (/^\[\^[^\]]+\]:/.test(body)) return 'footnote_definition'
    return /^\[[^\]]+\]:/.test(body) ? 'link_definition' : undefined
  },
  '%': (body) => (body.startsWith('%%%') ? 'comment_block_opener' : body.startsWith('%%') ? 'comment_only' : undefined),
}
const ordered = (body: string, end: number): string | undefined => (isListMarker(body, 0, end) ? 'ordered' : undefined)
for (const code of '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') SHAPES[code] ??= ordered
