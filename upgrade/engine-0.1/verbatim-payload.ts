/**
 * The encoding of a verbatim payload - a code fence's or raw block's `content`.
 *
 * Code and raw blocks hold literal payload text: every payload line
 * carries its own break, so `""`, `"\n"`, `"a\n"` and `"a\n\n"` are four
 * different payloads, and only a payload whose last line reaches the end of a
 * source with no final break omits that break. Nothing is added back on the way
 * out - `<pre><code>` holds the value as it stands.
 */

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

/** Matching raw output excludes the final line separator, preserving blank payloads. */
export function rawSource(content: string): string {
  return content.endsWith('\n') && !/^\n+$/.test(content) ? content.slice(0, -1) : content
}
