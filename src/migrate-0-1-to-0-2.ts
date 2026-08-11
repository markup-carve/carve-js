/**
 * Insert the paragraph boundaries that Carve 0.1 inferred from block openers.
 *
 * Carve 0.2 classifies an opener only at block position. This source-to-source
 * migration makes the formerly implicit boundary explicit, preserving the
 * 0.1 reading while keeping a second run byte-identical.
 */
export function migrateCarve01To02(source: string): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const hadFinalEol = source.endsWith('\n')
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (hadFinalEol) lines.pop()
  const out: string[] = []
  let opaque: { char: string; width: number; comment: boolean } | undefined
  let paragraphOpen = false
  let attachment: { marker: string; contentCol: number } | undefined
  const colonWidths: number[] = []
  let quoteDepth = 0
  const isStructuralBlank = (raw: string): boolean =>
    raw.replace(/^(?:[ \t]*> ?)+/, '').trim() === ''

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!
    const quoted = /^((?:[ \t]*> ?)+)(.*)$/.exec(raw)
    const prefix = quoted?.[1] ?? ''
    const line = quoted?.[2] ?? raw.replace(/^[ \t]+/, '')
    const currentQuoteDepth = (prefix.match(/>/g) ?? []).length

    if (opaque) {
      out.push(raw)
      const run = new RegExp(`^\\${opaque.char}{${opaque.width},}[ \\t]*$`).exec(line)
      if (run && (!opaque.comment || run[0]!.trim().length === opaque.width)) opaque = undefined
      continue
    }

    if (line.trim() === '') {
      out.push(raw)
      paragraphOpen = false
      attachment = undefined
      quoteDepth = currentQuoteDepth
      continue
    }

    const fence = /^(`{3,}|~{3,})(?:[^`]*)$/.exec(line)
    const comment = /^(%{3,})/.exec(line)
    const colon = /^(:{3,})(?: +(.*))?[ \t]*$/.exec(line)
    const colonCloser = colon !== null && colon[2] === undefined && colonWidths.at(-1) === colon[1]!.length
    const fenceCloses = fence
      ? lines.slice(index + 1).some((candidate) => {
          const body = candidate.replace(/^(?:[ \t]*> ?)+/, '').replace(/^[ \t]+/, '')
          const close = new RegExp(`^\\${fence[1]![0]}{${fence[1]!.length},}[ \\t]*$`)
          return close.test(body)
        })
      : false
    const oldInterrupter =
      !colonCloser && (fenceCloses || /^(?:#{1,6} |>(?: |$)|(?:---|\*\*\*|___)[ \t]*$|\|.*\|[ \t]*$|:{2,}(?: |$)|\[[^\]]+\]: +|\[\^[^\]]+\]: +|\*\[[A-Z][^\]]*\]: +|%%|\{[^{}]+\}[ \t]*$)/.test(line))

    const previousBody = out.at(-1)?.replace(/^(?:[ \t]*> ?)+/, '').trim() ?? ''
    const previousIsContinuation = previousBody === '+' || /^(?::  |(?:[-*]|[0-9]+[.)]) +)\+$/.test(previousBody)
    const opensNestedQuote = currentQuoteDepth > quoteDepth
    if ((oldInterrupter || opensNestedQuote) && paragraphOpen && !previousIsContinuation && out.length > 0 && !isStructuralBlank(out[out.length - 1]!)) {
      // Inside an explicit quote, a marker-only quoted line is its blank. In
      // every other context an ordinary blank preserves the enclosing columns.
      const currentIndent = raw.length - raw.replace(/^[ \t]+/, '').length
      const blankPrefix = opensNestedQuote
        ? prefix.replace(/(?:[ \t]*> ?)[^>]*$/, '').trimEnd()
        : prefix.trimEnd()
      out.push(prefix === '' ? (attachment && currentIndent < attachment.contentCol ? attachment.marker : '') : blankPrefix)
    }
    out.push(raw)
    if (colonCloser) {
      colonWidths.pop()
      paragraphOpen = false
      attachment = undefined
    } else if (colon) {
      colonWidths.push(colon[1]!.length)
      paragraphOpen = false
      attachment = undefined
    } else if (fence && fenceCloses) {
      opaque = { char: fence[1]![0]!, width: fence[1]!.length, comment: false }
      paragraphOpen = false
      attachment = undefined
    } else if (comment) {
      opaque = { char: '%', width: comment[1]!.length, comment: true }
      paragraphOpen = false
      attachment = undefined
    } else if (oldInterrupter) {
      paragraphOpen = /^> +\S/.test(line)
      attachment = paragraphOpen ? { marker: '+', contentCol: 2 } : undefined
    } else {
      if (!paragraphOpen) {
        const attachable = /^(\s*)((?:[-*]|[0-9]+[.)]) +|:  |\[\^[^\]]+\]: +)\S/.exec(raw)
        attachment = attachable
          ? { marker: `${attachable[1]}+`, contentCol: attachable[1]!.length + attachable[2]!.length }
          : undefined
      }
      paragraphOpen = line.trim() !== '+'
      if (!paragraphOpen) attachment = undefined
    }
    quoteDepth = currentQuoteDepth
  }

  return out.join(eol) + (hadFinalEol ? eol : '')
}
