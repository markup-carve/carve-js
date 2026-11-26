import { htmlTokens } from './compare.ts'

interface Result { html: string; applied: string[] }

function insideDescription(tokens: readonly string[], close: number): boolean {
  const open = tokens.lastIndexOf('<dd>', close)
  return open >= 0 && tokens.indexOf('</dd>', open) > close
}

/** C2-B-059, C2-B-222: an unclosed 0.2 fence gains one final line feed. */
export function explainDescriptionPlusFenceEof(input: string, output: string, old: string, next: string): Result {
  const unchanged = { html: old, applied: [] }
  if (input.endsWith('\n') || output.includes('\n+\n')) return unchanged
  const lines = input.split('\n')
  const marker = lines.findIndex((line, at) => at > 1 && line === '+' && lines[at - 1]?.trimStart().startsWith(': '))
  if (marker < 0 || lines[marker + 1]?.trim() !== '```') return unchanged
  if (lines.slice(marker + 2).some((line) => line.trimStart().startsWith('```')
    || line.trimStart().startsWith('~~~'))) return unchanged
  const before = htmlTokens(old)
  const after = htmlTokens(next)
  const close = before.lastIndexOf('</code>')
  const targetClose = after.lastIndexOf('</code>')
  if (close < 1 || targetClose < 1 || before[close + 1] !== '</pre>' || after[targetClose + 1] !== '</pre>') {
    return unchanged
  }
  if (!insideDescription(before, close) || !insideDescription(after, targetClose)) return unchanged
  const code = before[close - 1]
  if (code === undefined || after[targetClose - 1] !== code + '\n') return unchanged
  before[close - 1] = code + '\n'
  return { html: before.join(''), applied: ['U-204'] }
}
