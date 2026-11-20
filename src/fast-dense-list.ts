// A direct HTML writer for the stateless tight dash-list subset. Every uncertain spelling
// returns undefined so the full 0.2 pipeline decides it.

interface Item { depth: number; html: string }

function letterOrDigit(code: number): boolean {
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122
}

function markedText(text: string, at: number): { html: string; end: number } | undefined {
  const code = text.charCodeAt(at)
  if (code !== 42 && code !== 96) return undefined
  const end = text.indexOf(text[at]!, at + 1)
  if (end <= at + 1 || !letterOrDigit(text.charCodeAt(at + 1)) ||
    !letterOrDigit(text.charCodeAt(end - 1))) return undefined
  // A delimiter next to a word can bind differently in the full inline grammar.
  if (at > 0 && letterOrDigit(text.charCodeAt(at - 1)) ||
    end + 1 < text.length && letterOrDigit(text.charCodeAt(end + 1))) return undefined
  for (let pos = at + 1; pos < end; pos++) {
    const inner = text.charCodeAt(pos)
    if (!letterOrDigit(inner) && inner !== 32) return undefined
  }
  const tag = code === 42 ? 'strong' : 'code'
  return { html: `<${tag}>${text.slice(at + 1, end)}</${tag}>`, end: end + 1 }
}

/** Only unambiguous ASCII text, strong and code spans are written here. */
function inline(text: string): string | undefined {
  let html = ''
  for (let at = 0; at < text.length;) {
    const code = text.charCodeAt(at)
    if (letterOrDigit(code) || code === 32) {
      html += text[at]!
      at++
      continue
    }
    const marked = markedText(text, at)
    if (marked === undefined) return undefined
    html += marked.html
    at = marked.end
  }
  return html
}

function writeItems(items: readonly Item[], at: number, depth: number): { html: string; next: number } {
  const pad = '  '.repeat(depth * 2)
  let html = `${pad}<ul>`
  while (at < items.length && items[at]!.depth === depth) {
    html += `\n${pad}  <li>${items[at]!.html}`
    at++
    if (items[at]?.depth === depth + 1) {
      const nested = writeItems(items, at, depth + 1)
      html += `\n${nested.html}\n${pad}  </li>`
      at = nested.next
    } else html += '</li>'
  }
  return { html: `${html}\n${pad}</ul>`, next: at }
}

/** The common dense list shape, with no blank lines, attributes, extensions or resolution. */
export function denseListHtml(source: string): string | undefined {
  if (!source.startsWith('- ')) return undefined
  const items: Item[] = []
  let at = 0
  let previous = 0
  while (at < source.length) {
    let end = source.indexOf('\n', at)
    if (end < 0) end = source.length
    let mark = at
    while (source.charCodeAt(mark) === 32) mark++
    const columns = mark - at
    if ((columns & 1) !== 0 || columns > 128 || columns > previous + 2 ||
      source.slice(mark, mark + 2) !== '- ' || mark + 2 >= end) return undefined
    const body = source.slice(mark + 2, end)
    if (body.startsWith(' ') || body.endsWith(' ')) return undefined
    const html = inline(body)
    if (html === undefined) return undefined
    items.push({ depth: columns / 2, html })
    previous = columns
    at = end + 1
  }
  const result = writeItems(items, 0, 0)
  return result.next === items.length ? result.html : undefined
}
