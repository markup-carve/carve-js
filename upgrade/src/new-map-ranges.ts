import { makeContext } from './context.ts'

/** The construct spans promised by the new report rows on their shortest source examples. */
const MARKS: Record<string, [string, string]> = {
  'U-378': ['[^f]:', 'tail'], 'U-379': ['%% note', 'more'], 'U-380': ['[%% hidden]', '[%% hidden]'],
  'U-381': ['[/i/]', '[/i/]'], 'U-382': ['%% c', 'text'], 'U-383': ['%%%', '```'],
  'U-384': ['%% c', 'text'], 'U-385': ['%% c', '```'], 'U-386': ['>     :::', '```'],
  'U-387': [': para', '- li'], 'U-388': ['^[', ']'], 'U-389': ['={', '}'],
  'U-391': ['%%%', 'tail'], 'U-394': ['> %%%', '> %%%'],
  'U-395': ['{%', '%}'],
}

function addedReportRange(input: string, id: string): { startOffset: number; endOffset: number } | undefined {
  const mark = id === 'U-428' ? 'stray' : '%%'
  const startOffset = input.indexOf(mark)
  if (startOffset < 0) return undefined
  if (id === 'U-428') return { startOffset, endOffset: startOffset + mark.length }
  const end = input.indexOf(id === 'U-393' ? '\n' : ']', startOffset)
  return { startOffset, endOffset: end < 0 ? input.length : end + (id === 'U-426' ? 1 : 0) }
}

export function newMapRange(input: string, id: string): { startOffset: number; endOffset: number } | undefined {
  if (id === 'U-393' || id === 'U-426' || id === 'U-428') return addedReportRange(input, id)
  const marks = MARKS[id]
  if (marks === undefined) return undefined
  const start = input.indexOf(marks[0])
  const afterStart = id === 'U-394' ? marks[0].length : 0
  const end = start < 0 ? -1 : id === 'U-388' ? input.lastIndexOf(']') : input.indexOf(marks[1], start + afterStart)
  if (end < 0) return undefined
  return { startOffset: start, endOffset: end + marks[1].length }
}

interface ReplayChoice { id: string; when: (input: string, old: string, next: string) => boolean; pattern: RegExp }
interface ReplayRange { id: string; range: { startOffset: number; endOffset: number } }

const CHOICES: readonly ReplayChoice[] = [
    { id: 'U-378', when: (input, old, next) => old.includes('<dd></dd>') && next.includes('<dd') && input.includes('[^'),
      pattern: /\[\^[^\n]+\n(?:[ \t]+[^\n]*\n)?[^\n]*/u },
    { id: 'U-379', when: (input, old, next) => old.includes('<dt>') && next.includes('<dt') && input.includes('%%'),
      pattern: /%%[^\n]*\n[^\n]+/u },
    { id: 'U-381', when: (_input, old, next) => old.includes('class="div-label"><') && next.includes('class="div-label"'),
      pattern: /\[(?:\/[^\]\n]+\/|`[^\]\n]+`)\]/u },
    { id: 'U-382', when: (_input, old, next) => old.includes('<div class="inner">') && next.includes('class="inner"'),
      pattern: /%%[^\n]*\n[ \t]*[^\n]+/u },
    { id: 'U-382',
      when: (input, old, next) => input.includes('- :::') && old.includes('</ul>') && next.includes('<p'),
      pattern: /%{3,}[^\n]*\n(?:[^\n]*\n)?[ \t]*[^\n]+/u },
    { id: 'U-383', when: (input, old, next) => old.includes('<pre>') && next.includes('<pre') && input.includes('%%%'),
      pattern: /%%%[\s\S]*?```/u },
    { id: 'U-386', when: (input, old, next) => old.includes('<pre>') && next.includes('<pre') && input.includes('::: |'),
      pattern: /:::[^\n]*\n[^\n]*```/u },
    { id: 'U-389', when: (_input, old, next) => old.includes('<u>') && next.includes('={_'),
      pattern: /=\{_[^\n]*_\}/u },
    { id: 'U-393', when: (_input, old, next) => old.includes('{~') && next.includes('<s'),
      pattern: /\{~[^\n]*~\}/u },
]

const OPENER_COMMENT = /(?:\^|:[A-Za-z][\w-]*)?\[(%%[^\]\n]*\]?)/gu
const LINE_COMMENT = /(?:^|[ \t]|\\ )(%%[^\n]*)/gmu

const LITERAL = new Set(['code', 'code_block', 'raw_block', 'raw_inline', 'math', 'literal_inline', 'frontmatter'])

/** The offsets of the input that 0.1 read as literal text, where `%%` is no comment. */
function literalMask(input: string): Uint8Array {
  const mask = new Uint8Array(input.length)
  for (const { node } of makeContext(input).visits) {
    if (LITERAL.has(node.type) && node.pos !== undefined) mask.fill(1, node.pos.startOffset, node.pos.endOffset)
  }
  return mask
}

/** The frame openers before `at` on its line that no closer before `at` ends. */
function openFrames(line: string): number {
  let open = 0
  for (const char of line) {
    if (char === '[' || char === '{') open++
    else if ((char === ']' || char === '}') && open > 0) open--
  }
  return open
}

/**
 * U-426: `%%` directly after a bracket opener is text in 0.2 (C2-I-023). U-393: a line comment
 * inside an open frame takes the closer later on its line (C2-I-024).
 */
function commentFrameRange(input: string): ReplayRange | null {
  const literal = literalMask(input)
  for (const match of input.matchAll(OPENER_COMMENT)) {
    const startOffset = match.index + match[0].length - match[1]!.length
    if (literal[startOffset] === 1) continue
    return { id: 'U-426', range: { startOffset, endOffset: match.index + match[0].length } }
  }
  for (const match of input.matchAll(LINE_COMMENT)) {
    const startOffset = match.index + match[0].length - match[1]!.length
    if (literal[startOffset] === 1) continue
    const lineStart = input.lastIndexOf('\n', startOffset - 1) + 1
    if (openFrames(input.slice(lineStart, startOffset)) === 0 || !/[\]}]/u.test(match[1]!)) continue
    return { id: 'U-393', range: { startOffset, endOffset: match.index + match[0].length } }
  }
  return null
}

/** Finds a source construct when a longer document reaches one of the replay causes. */
export function replayMapRange(input: string, old: string, next: string): ReplayRange | null {
  for (const choice of CHOICES) {
    if (!choice.when(input, old, next)) continue
    const match = choice.pattern.exec(input)
    if (match?.index === undefined) continue
    return { id: choice.id, range: { startOffset: match.index, endOffset: match.index + match[0].length } }
  }
  return input.includes('%%') ? commentFrameRange(input) : null
}
