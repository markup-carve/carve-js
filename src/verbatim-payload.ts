/**
 * The encoding of a verbatim payload - a code fence's or raw block's `content`.
 *
 * A CODE BLOCK holds literal payload text (CARVE-P12-064): every payload line
 * carries its own break, so `""`, `"\n"`, `"a\n"` and `"a\n\n"` are four
 * different payloads, and only a payload whose last line reaches the end of a
 * source with no final break omits that break. Nothing is added back on the way
 * out - `<pre><code>` holds the value as it stands.
 *
 * A RAW BLOCK keeps the older encoding, where the last line's break is implied
 * and an all-blank payload is written as one newline per line: `join('\n')`
 * alone collapses a payload of no lines and one of a single blank line to the
 * same empty string, and PART 9 section 28 forbids the two encoding alike.
 */

/** Whether `content` encodes a raw payload of nothing but blank lines. */
const allBlank = (content: string): boolean => /^\n+$/.test(content)

/** The `content` for a RAW block's collected `lines`. */
export function verbatimContent(lines: readonly string[]): string {
  return lines.length > 0 && lines.every((line) => line === '')
    ? '\n'.repeat(lines.length)
    : lines.join('\n')
}

/**
 * Whether a RAW `content` already ends its last payload line, so a writer owes
 * no separator before the closing delimiter.
 */
export const payloadTerminated = (content: string): boolean => content === '' || allBlank(content)

/** The payload lines a RAW `content` stands for. Inverse of `verbatimContent`. */
export function verbatimLines(content: string): string[] {
  if (content === '') return []
  if (allBlank(content)) return Array.from({ length: content.length }, () => '')

  return content.split('\n')
}

/**
 * The `content` for a CODE fence's collected `lines`.
 *
 * `terminated` is false only where the source ran out before the last payload
 * line's break, which is the one shape whose literal text ends mid-line.
 */
export function codeContent(lines: readonly string[], terminated: boolean): string {
  if (lines.length === 0) return ''

  return `${lines.join('\n')}${terminated ? '\n' : ''}`
}

/** Whether a CODE `content` ends its last payload line. */
export const codeTerminated = (content: string): boolean => content === '' || content.endsWith('\n')

/** The payload lines a CODE `content` stands for. Inverse of `codeContent`. */
export function codeLines(content: string): string[] {
  if (content === '') return []

  return (content.endsWith('\n') ? content.slice(0, -1) : content).split('\n')
}

/**
 * A CODE payload as SOURCE TEXT for a renderer that re-reads it - a diagram
 * body, a math expression, an SVG document. The payload's own final break
 * terminates its last line rather than adding a blank one, so it comes off
 * before the text is handed on.
 */
export function codeSource(content: string): string {
  return content.endsWith('\n') ? content.slice(0, -1) : content
}
