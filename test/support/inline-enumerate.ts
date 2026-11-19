// Enumerates every content of up to `length` inline tokens over a small alphabet.
import { checkInlines } from './inline-checks.ts'

/** Each opener and closer, a word, a space, a line ending, a backslash, each brace form opener, quotes and a pipe. */
export const INLINE_TOKENS = [
  'a', ' ', '\n', '\\', '*', '/', '`', '[', ']', '(/u)', '![', '^[', '[^', ':n[', '{.c}', '{', '}',
  '{*', '*}', '{/', '/}', '{-', '-}', '{=', '=}', '{%', '%}', '{#', '#}', '%%', '<a:b>', '<', '@', '-', '"', "'", '|',
] as const

/**
 * The tokens of the writer gates: the inline tokens, an escaped backtick, an escaped delimiter of
 * each kind and a code span, which the escapes of the writer must keep apart from what stands beside them.
 */
export const WRITER_TOKENS: readonly string[] = [...INLINE_TOKENS, '\\`', ...[...'*/_~=^,+-'].map((mark) => `\\${mark}`), '`a`']

export interface InlineEnumerationResult {
  contents: number
  failures: string[]
}

const MAX_REPORTED = 20

/** Checks every content of exactly `length` tokens. A content is its tokens glued, behind the word `x`. */
export function enumerateContents(length: number): InlineEnumerationResult {
  const result: InlineEnumerationResult = { contents: 0, failures: [] }
  const choice = new Array<number>(length).fill(0)
  const parts = new Array<string>(length).fill('')
  for (;;) {
    for (let at = 0; at < length; at++) parts[at] = INLINE_TOKENS[choice[at]!]!
    // The leading word keeps the first token from being read as a block marker.
    const src = `x${parts.join('')}`
    result.contents++
    let failure: string | null
    try {
      failure = checkInlines(src)
    } catch (error) {
      failure = `threw ${String(error)}`
    }
    if (failure !== null && result.failures.length < MAX_REPORTED) result.failures.push(`${JSON.stringify(src)}: ${failure}`)
    let at = length - 1
    while (at >= 0 && choice[at] === INLINE_TOKENS.length - 1) choice[at--] = 0
    if (at < 0) return result
    choice[at]!++
  }
}
