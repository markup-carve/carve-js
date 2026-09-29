/**
 * The encoding of a verbatim payload - a code fence's or raw block's `content`.
 *
 * `join('\n')` collapses a payload of no lines and a payload of one blank line
 * to the same empty string, and the two are different documents: the first
 * contributes nothing, while every blank line between the delimiters is
 * payload. PART 9 section 28 forbids the two encoding alike, and the AST schema
 * closes `code_block` to new properties, so the count lives in `content`
 * itself - an all-blank payload is written as one newline per line. The raw
 * block has read it this way since markup-carve/carve#2574; this is the same
 * distinction for the code fence (carve-js#2342).
 */

/** Whether `content` encodes a payload of nothing but blank lines. */
const allBlank = (content: string): boolean => /^\n+$/.test(content)

/** The `content` for a verbatim payload's collected `lines`. */
export function verbatimContent(lines: readonly string[]): string {
  return lines.length > 0 && lines.every((line) => line === '')
    ? '\n'.repeat(lines.length)
    : lines.join('\n')
}

/**
 * Whether `content` already ends its last payload line, so a writer owes no
 * separator before the closing delimiter. True for a payload of no lines and
 * for an all-blank one, whose newlines ARE its lines.
 */
export const payloadTerminated = (content: string): boolean => content === '' || allBlank(content)

/** The payload lines `content` stands for. Inverse of `verbatimContent`. */
export function verbatimLines(content: string): string[] {
  if (content === '') return []
  if (allBlank(content)) return Array.from({ length: content.length }, () => '')

  return content.split('\n')
}

/**
 * A code payload as verbatim text, every line newline-terminated.
 *
 * This is what `<pre><code>` holds and what every plain-text target writes: a
 * payload of no lines is no characters, and one of N blank lines is N newlines.
 */
export function codePayloadText(content: string): string {
  return content === '' || allBlank(content) ? content : `${content}\n`
}

/**
 * The `content` a code element's verbatim TEXT stands for. Inverse of
 * `codePayloadText`, and what an HTML import needs: the newline before
 * `</code>` terminates the last payload line rather than adding one, so a
 * `<pre><code>` holding a single newline is one blank line and not none.
 */
export function codePayloadContent(text: string): string {
  if (text === '') return ''

  return verbatimContent((text.endsWith('\n') ? text.slice(0, -1) : text).split('\n'))
}
