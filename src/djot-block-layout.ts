import { isDjotEscaped, maskDjotCodeAndDestinations, maskDjotFences, djotInlineBoundaries } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { backtickRunEnds } from './backtick-run-index.js'

/** Preserve Djot paragraph boundaries and container columns in Carve. */
export function djotBlockLayout(source: string, rows: readonly boolean[]): string {
  const lines = source.split('\n')
  const mask = maskDjotCodeAndDestinations(source).split('\n')
  const fences = maskDjotFences(source).split('\n')
  const divs: {
    width: number
    prefix: string
    itemColumn?: number
    depth: number
  }[] = []
  const lists: {
    column: number
    content: number
    target: number
    kind: string
    bullet: string
    loose: boolean
    start: number
    continuation: boolean
  }[] = []
  const out: string[] = []
  let paragraph = false,
    blank = true,
    depth = 0
  let headingMarker = ''
  let definitionIndent = -1
  for (let n = 0; n < lines.length; n++) {
    const original = lines[n]!,
      masked = mask[n]!
    const quote = /^(?:[ \t]*>[ ]?)*/.exec(original)![0]
    const quoteDepth = (quote.match(/>/g) ?? []).length
    const raw = original.slice(quote.length),
      view = masked.slice(quote.length)
    const indent = /^[ \t]*/.exec(raw)![0].length
    const text = raw.slice(indent),
      visible = view.slice(indent)
    if (text === '') {
      out.push(original)
      paragraph = false
      headingMarker = ''
      blank = true
      continue
    }
    if (/^:[ \t]+\S/.test(visible) && (blank || definitionIndent >= 0)) definitionIndent = indent
    else if (definitionIndent >= 0 && blank && indent <= definitionIndent) definitionIndent = -1
    if (definitionIndent >= 0) {
      out.push(original)
      headingMarker = ''
      paragraph = true
      blank = false
      continue
    }
    const blockIndent = quoteDepth > depth ? /^[ \t]*/.exec(original)![0].length : indent
    const blockStart =
      quoteDepth > depth ||
      rows[n] ||
      fences[n] !== original ||
      /^(?:#{1,6}(?:[ \t]|$)|:{3,}|\|)/.test(visible) ||
      /^(?:[*-][ \t]*){3,}$/.test(visible)
    const item =
      /^(?:([-*+])|((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)))[ \t]+\S/.exec(
        visible,
      )
    // A new block can end lazy continuation outside a quote or list item.
    if (quoteDepth < depth && (blockStart || item)) {
      paragraph = false
      headingMarker = ''
      lists.length = 0
      depth = quoteDepth
    }
    while (divs.at(-1)?.itemColumn !== undefined) {
      const owned = divs.at(-1)!
      if (
        quoteDepth >= owned.depth &&
        !(quoteDepth === owned.depth && indent < owned.itemColumn! && (item || blockStart || blank))
      )
        break
      divs.pop()
      let before = out.length
      while (before > 0 && out[before - 1]!.trim() === '') before--
      out.splice(before, 0, owned.prefix + ':'.repeat(owned.width))
      paragraph = false
    }
    if (blockStart) {
      // A block outside the nested item's content column belongs to its parent.
      while (
        lists.length &&
        (blockIndent <= lists.at(-1)!.column ||
          (lists.length > 1 && blockIndent < lists.at(-1)!.column + lists.at(-1)!.content))
      ) {
        lists.pop()
        paragraph = false
        headingMarker = ''
        if (lists.length) lists.at(-1)!.loose = true
      }
      if (blank) for (const list of lists) if (blockIndent > list.column) list.loose = true
    }
    if (
      quoteDepth > depth &&
      lists.length &&
      blockIndent >= lists.at(-1)!.column + lists.at(-1)!.content &&
      !paragraph
    ) {
      out.push(original)
      blank = false
      continue
    }
    if (fences[n] !== original || rows[n]) {
      out.push(original)
      paragraph = false
      headingMarker = ''
      blank = false
      continue
    }
    if (view.trim() === '') {
      out.push(original)
      paragraph = !headingMarker && !/^(?:(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)?\[[^\]\n]+\]:/.test(text)
      blank = false
      continue
    }
    if (paragraph && quoteDepth > depth) {
      let held = '',
        rest = original
      for (let level = 0; level < depth; level++) {
        const marker = /^[ \t]*>[ ]?/.exec(rest)
        if (!marker) break
        held += marker[0]
        rest = rest.slice(marker[0].length)
      }
      const prefix = /^[ \t]*/.exec(rest)![0]
      out.push(held + prefix + '\\' + rest.slice(prefix.length))
      blank = false
      continue
    }
    if (quoteDepth !== depth && !paragraph) {
      lists.length = 0
      depth = quoteDepth
    }
    const div = /^(:{3,})(?:[ \t]+.*)?$/.exec(visible)
    const top = divs.at(-1)
    if (div && /^:{3,}[ \t]*$/.test(text) && top && (div[1]!.length >= top.width || paragraph)) {
      if (div[1]!.length >= top.width) {
        dropOrphanAttributeLine(out)
        let closed = divs.pop()!
        out.push(closed.prefix + ':'.repeat(closed.width))
        while (divs.length && divs.at(-1)!.width !== closed.width && div[1]!.length >= divs.at(-1)!.width) {
          closed = divs.pop()!
          out.push(closed.prefix + ':'.repeat(closed.width))
        }
        paragraph = false
        headingMarker = ''
        blank = true
      } else {
        out.push(quote + ' '.repeat(indent) + '\\' + text)
        paragraph = true
        blank = false
      }
      continue
    }
    const rule = /^(?:[*-][ \t]*){3,}$/.test(visible)
    if (item && !rule) {
      const previousList = lists.at(-1)
      const endsNestedList = previousList && indent < previousList.column
      while (lists.length && indent < lists.at(-1)!.column) {
        lists.pop()
        paragraph = false
        headingMarker = ''
      }
      const parent = lists.at(-1)
      if (parent && blank && indent === parent.column && endsNestedList && !parent.loose) {
        while (out.at(-1)?.trim() === '') out.pop()
        if (!parent.continuation && out[previousList.start - 1]?.trim() === '') out.splice(previousList.start - 1, 1)
      } else if (parent && blank && indent === parent.column) parent.loose = true
      if (((parent && indent > parent.column) || !parent) && paragraph && !blank) {
        const target = parent?.target !== undefined ? parent.target + parent.content : indent
        const literal = item[1] ? '\\' + text : parent ? text.replace(/[.)]/, '\\$&') : text
        out.push(quote + ' '.repeat(target) + literal)
        if (parent) parent.continuation = true
        blank = false
        continue
      }
      const kind = item[1] ?? item[2]!.replace(/[0-9A-Za-z]+/, '1')
      let context = parent
      const nested = parent && indent > parent.column
      if (!parent || nested) {
        context = {
          column: indent,
          content: item[0].length - 1,
          target: nested ? parent.target + parent.content : 0,
          kind,
          bullet: item[1] === '*' ? '*' : '-',
          loose: false,
          start: out.length,
          continuation: false,
        }
        lists.push(context)
      } else if (kind !== parent.kind) {
        if (out.at(-1)?.trim() !== '') out.push(quote.trimEnd())
        parent.kind = kind
        parent.bullet = parent.bullet === '-' ? '*' : '-'
      }
      if (parent && !nested && parent.loose && parent.continuation && out.at(-1)?.trim() !== '')
        out.push(quote.trimEnd())
      const written = item[1] ? context!.bullet + text.slice(1) : text
      context!.continuation = false
      headingMarker = ''
      out.push(quote + ' '.repeat(context!.target) + written)
      const body = text.slice(item[0].length - 1)
      const itemHeading = /^(#{1,6})(?:[ \t]+|$)/.exec(body)
      headingMarker = itemHeading?.[1] ?? ''
      const itemDiv = /^(:{3,})(?:[ \t]+.*)?$/.exec(body)
      if (itemDiv)
        divs.push({
          width: itemDiv[1]!.length,
          prefix: quote + ' '.repeat(context!.target + context!.content),
          itemColumn: context!.column + context!.content,
          depth: quoteDepth,
        })
      paragraph = !itemDiv && !itemHeading && !body.startsWith('>')
      blank = !!itemDiv
      continue
    }
    if (div && !paragraph) {
      const parent = lists.at(-1)
      divs.push({
        width: div[1]!.length,
        prefix: quote + ' '.repeat(indent),
        depth: quoteDepth,
        ...(parent && indent >= parent.column + parent.content ? { itemColumn: parent.column + parent.content } : {}),
      })
      out.push(original)
      paragraph = false
      headingMarker = ''
      blank = true
      continue
    }
    const attrs = visible.startsWith('{') ? readAttributes(raw, indent) : undefined
    const attributeLine = attrs?.end === raw.length
    const outsideColumn = blank && !parentContains(lists, indent) && !attributeLine ? lists[0]?.column : undefined
    if (outsideColumn !== undefined) lists.length = 0
    const heading = /^(#{1,6})(?:[ \t]+|$)/.exec(visible)
    const reference = /^\[[^\]\n]*\]:/.test(visible)
    const row = rows[n] ?? false
    if (row) {
      out.push(original)
      paragraph = false
      blank = false
      continue
    }
    const block =
      (heading && heading[1] !== headingMarker) ||
      div ||
      (rule && (!visible.includes('*') || !visible.includes('-'))) ||
      visible.startsWith('>') ||
      visible.startsWith('|')
    if ((block && (!heading || heading[1] !== headingMarker)) || attributeLine || reference) headingMarker = ''
    if (blank && !block && !attributeLine && !reference) {
      for (const list of lists) if (indent > list.column) list.loose = true
    }
    if (paragraph && block) {
      out.push(quote + ' '.repeat(indent) + '\\' + text)
      blank = false
      continue
    }
    if (!paragraph && /^\|`+\|$/.test(text) && !row) {
      while (out[0] === '') out.shift()
      out.push(quote + ' '.repeat(indent) + '\\' + text)
      paragraph = true
      blank = false
      continue
    }
    if (heading) headingMarker = heading[1]!
    if (heading && !lists.length) {
      out.push(
        quote +
          heading[1] +
          (text.slice(heading[1]!.length).trim() ? ' ' + text.slice(heading[1]!.length).trimStart() : ''),
      )
    } else if (rule && !lists.length && !paragraph) out.push(quote + '***')
    else {
      const parent = lists.at(-1)
      if (parent && indent > parent.column)
        out.push(
          quote +
            ' '.repeat(parent.target + parent.content + Math.max(0, indent - parent.column - parent.content)) +
            text,
        )
      else out.push(outsideColumn === undefined ? original : quote + ' '.repeat(Math.max(0, indent - outsideColumn)) + text)
    }
    // Masked code ends a paragraph only when it is a block fence.
    const fence = /^[`~]{3,}/.test(text) && visible.trim() === ''
    paragraph = !(
      heading ||
      headingMarker ||
      rule ||
      attributeLine ||
      reference ||
      row ||
      fence ||
      /^:[ \t]/.test(visible) ||
      quoteDepth > depth
    )
    if (!paragraph && quoteDepth > depth) depth = quoteDepth
    if (blank && !item && !parentContains(lists, indent) && !attributeLine) lists.length = 0
    blank = false
  }
  const newline = out.at(-1) === ''
  if (divs.length && newline) out.pop()
  if (divs.length) dropOrphanAttributeLine(out)
  while (divs.length) {
    const div = divs.pop()!
    if (!div.prefix.includes('>')) out.push(div.prefix + ':'.repeat(div.width))
  }
  if (newline && out.at(-1) !== '') out.push('')
  return out.join('\n')
}

/** Djot attaches an attribute line with no block after it to nothing, so drop it. */
function dropOrphanAttributeLine(out: string[]): void {
  const last = out.at(-1)?.trimEnd()
  if (last === undefined) return
  const at = last.search(/\S/)
  if (at < 0 || last[at] !== '{') return
  const attrs = readAttributes(last, at)
  if (attrs && attrs.end === last.length) out.pop()
}

function parentContains(lists: { column: number; content: number }[], indent: number): boolean {
  return lists.some((list) => indent >= list.column + list.content)
}

/** Normalize inline forms that have no delimiter conversion rule. */
export function djotInlineLayout(source: string): string {
  const comments = new Map<number, number>()
  const mask = maskDjotCodeAndDestinations(source, true, true, true, undefined, [], {
    onComment: (start, end) => comments.set(start, end),
  })
  const quotes: Record<string, string> = {
    "{'": '‘',
    "'}": '’',
    '{"': '“',
    '"}': '”',
  }
  let output = ''
  for (let i = 0; i < source.length; i++) {
    const commentEnd = comments.get(i)
    if (commentEnd !== undefined && source[commentEnd - 2] !== '%' && source.slice(i + 2, commentEnd).includes('{')) {
      output += '{%%}'
      i = commentEnd - 1
      continue
    }
    if (mask[i] !== source[i] || isDjotEscaped(source, i)) {
      output += source[i]
      continue
    }
    if (source[i] === '<') {
      const angle = /^<([^<>\s]+)>/.exec(source.slice(i))
      if (angle && /[^:]@|[A-Za-z]:/.test(angle[1]!)) {
        output += angle[0]
        i += angle[0].length - 1
        continue
      }
    }
    if (source[i] === '{') {
      const attrs = readAttributes(source, i)
      if (attrs) {
        output += source.slice(i, attrs.end)
        i = attrs.end - 1
        continue
      }
    }
    if (source.startsWith('{}', i)) {
      if (mask[i - 1] === ']' && !isDjotEscaped(source, i - 1)) {
        // Empty attributes turn bracketed text into a span.
        output += '{}'
        i++
        continue
      }
      let end = i + 2
      while (source.startsWith('{}', end)) end += 2
      if (/[_*]/.test(source[i - 1] ?? '') && source[i - 1] === source[end]) {
        // Keep the boundary until emphasis pairing can write separate forced spans.
        output += source.slice(i, end)
        i = end - 1
        continue
      }
      if (source[i - 1] === '\n' || i === 0) {
        if (source[i + 2] === '\n') i++
      }
      i++
      continue
    }
    const quote = quotes[source.slice(i, i + 2)]
    if (quote) {
      output += quote
      i++
      continue
    }
    if (source[i] === '\\' && /[ \t]$/.test(output) && /^[ \t]*\n/.test(source.slice(i + 1)) && !/^[ \t>]*:{3,}[ \t]+$/.test(source.slice(source.lastIndexOf('\n', i - 1) + 1, i))) {
      let end = output.length
      while (end > 0 && /[ \t]/.test(output[end - 1]!) && !isDjotEscaped(output, end - 1)) end--
      output = output.slice(0, end) + '\\'
      while (/[ \t]/.test(source[i + 1] ?? '')) i++
      continue
    }
    output += source[i]
  }
  return output
}

/** Pad closed code spans for Carve's one-space trimming rule. */
export function djotCodePadding(source: string): string {
  const mask = maskDjotCodeAndDestinations(source, false, false, false, undefined, [], { destinations: true, code: false })
  const ends = backtickRunEnds(mask)
  if (!ends) return source
  const breaks = Array.from(source.matchAll(/\n[ \t]*(?:>[ \t]*)*\n/g), match => match.index!)
  if (source.includes('\n')) {
    for (const at of djotInlineBoundaries(source, mask, true))
      if (at > 0 && at < source.length && source[at - 1] === '\n' && source[at] !== '|') breaks.push(at - 1)
    breaks.sort((a, b) => a - b)
  }
  let paragraph = 0
  let output = '',
    copied = 0
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\\') {
      at++
      continue
    }
    if (mask[at] !== source[at]) continue
    if (source[at] !== '`') continue
    let width = 1
    while (source[at + width] === '`') width++
    const end = ends[at]!
    while ((breaks[paragraph] ?? source.length) <= at) paragraph++
    const paragraphEnd = breaks[paragraph] ?? source.length
    if (end < 0 || end > paragraphEnd) {
      at = paragraphEnd - 1
      continue
    }
    const content = source
      .slice(at + width, end - width)
      .replace(/^ `/, '`')
      .replace(/` $/, '`')
    const pad =
      content.startsWith('`') ||
      content.endsWith('`') ||
      (content.startsWith(' ') && content.endsWith(' ') && content.trim())
        ? ' '
        : ''
    output += source.slice(copied, at + width) + pad + content + pad + source.slice(end - width, end)
    copied = end
    at = end - 1
  }
  return output + source.slice(copied)
}
