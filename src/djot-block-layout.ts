import { isDjotEscaped, maskDjotCodeAndDestinations, maskDjotFences, djotInlineBoundaries } from './djot-migrate.js'
import { trimNonNbsp, trimStartNonNbsp } from './trim-non-nbsp.js'
import { readAttributes } from './djot-word-attributes.js'
import { rejectedCommentStartsBlock } from './djot-attributes.js'
import { backtickRunEnds } from './backtick-run-index.js'

function compactDjotListPrefix(text: string): string {
  if (!text.includes('0') && !text.includes('(')) return text
  const parts: string[] = []
  let at = 0
  while (at < text.length) {
    const indent = /^[ \t]*/.exec(text.slice(at))![0]
    parts.push(indent)
    at += indent.length
    const quote = /^>(?:[ \t]|$)/.exec(text.slice(at))
    if (quote) { parts.push(quote[0]); at += quote[0].length; continue }
    const item = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.exec(text.slice(at))
    if (!item) break
    parts.push(item[0].replace(/^(\(?)0+(?=[0-9])/, '$1').replace(/^\(([^)]+)\)/, '$1.'))
    at += item[0].length
    if (/^[-*+]/.test(item[0])) {
      const task = /^\[[ xX]\][ \t]+/.exec(text.slice(at))
      if (task) { parts.push(task[0]); at += task[0].length }
    }
  }
  parts.push(text.slice(at))
  return parts.join('')
}

/** Preserve Djot paragraph boundaries and container columns in Carve. */
export function djotBlockLayout(source: string, rows: readonly boolean[]): string {
  const hasDefinitionSyntax = source.includes('[^') || /(?:^|\n)(?:[ \t]*>(?:[ \t]|$))*[ \t]*:[ \t]/.test(source)
  const lines = source.split('\n')
  const maskedSource = maskDjotCodeAndDestinations(source)
  const mask = maskedSource.split('\n')
  const divClosers = new Map<number, number[]>()
  if (source.includes(':::')) djotInlineBoundaries(source, maskedSource, true, divClosers)
  let lineOffset = 0
  const lineOffsets = lines.map(line => { const at = lineOffset; lineOffset += line.length + 1; return at })
  const fences = maskDjotFences(source).split('\n')
  const divs: {
    width: number
    prefix: string
    itemColumn?: number
    depth: number
    start: number
  }[] = []
  const lists: {
    depth: number
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
  let embeddedListOwner: { depth: number; column: number; content: number } | undefined
  let opaqueQuoteOwner: { depth: number; column: number; content: number } | undefined
  let quoteBoundary = ''
  let headingMarker = ''
  let definitionIndent = -1
  for (let n = 0; n < lines.length; n++) {
    const original = lines[n]!,
      masked = mask[n]!
    const quote = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(original)![0]
    const quoteDepth = (quote.match(/>/g) ?? []).length
    if (quoteDepth > 0 && masked[quote.indexOf('>')] !== '>' && fences[n] === original) {
      out.push(original)
      blank = false
      continue
    }
    const quoteForCarve = (): string => {
      if (!quoteDepth || definitionIndent >= 0 || hasDefinitionSyntax || fences[n] !== original || masked[quote.indexOf('>')] !== '>') return quote
      const owner = lists.at(-1)
      const contexts: { depth: number; column: number; content: number; target: number }[] = []
      if (owner) contexts.push(owner)
      if (embeddedListOwner) contexts.push({ ...embeddedListOwner, target: 0 })
      if (opaqueQuoteOwner) contexts.push({ ...opaqueQuoteOwner, target: opaqueQuoteOwner.column })
      const firstOwned = Math.min(...contexts.map(value => value!.depth))
      const lastOwned = Math.max(...contexts.map(value => value!.depth))
      const parts: string[] = []
      for (let level = 0; level < quoteDepth; level++) {
        const held = contexts.find(value => value!.depth === level && (quoteColumns[level] ?? 0) > value!.column)
        const column = held ? held.target + held.content : level > firstOwned && level < lastOwned ? (quoteColumns[level] ?? 0) : 0
        parts.push(' '.repeat(column), '>')
        if (level + 1 < quoteDepth || !quote.endsWith('>')) parts.push(' ')
      }
      return parts.join('')
    }
    let nativeRemainder = original.slice(quote.length)
    const originalForCarve = (): string => quoteForCarve() + nativeRemainder
    const raw = original.slice(quote.length),
      view = masked.slice(quote.length)
    const indent = /^[ \t]*/.exec(raw)![0].length
    const text = raw.slice(indent),
      visible = view.slice(indent)
    const quoteColumns = quoteDepth > 0 ? indentColumnsAfterQuotes(original, quoteDepth) : []
    if (opaqueQuoteOwner && text && (quoteDepth < opaqueQuoteOwner.depth || (quoteDepth === opaqueQuoteOwner.depth ? indent : quoteColumns[opaqueQuoteOwner.depth] ?? 0) < opaqueQuoteOwner.column + 1)) opaqueQuoteOwner = undefined
    const blockIndent = quoteDepth > depth ? (quoteColumns[depth] ?? indent) : indent
    const ordinaryQuoteList = lists.at(-1)
    const quoteList = embeddedListOwner && embeddedListOwner.depth < quoteDepth && (!ordinaryQuoteList || embeddedListOwner.depth > ordinaryQuoteList.depth) ? embeddedListOwner : ordinaryQuoteList
    const outsideQuoteItem = quoteList && quoteDepth > quoteList.depth && (quoteColumns[quoteList.depth] ?? indent) < quoteList.column + 1
    if (text === '') {
      if (outsideQuoteItem) {
        while (lists.length && quoteDepth > lists.at(-1)!.depth && (quoteColumns[lists.at(-1)!.depth] ?? indent) < lists.at(-1)!.column + 1) lists.pop()
        if (embeddedListOwner && quoteDepth > embeddedListOwner.depth && (quoteColumns[embeddedListOwner.depth] ?? indent) < embeddedListOwner.column + 1) embeddedListOwner = undefined
        depth = quoteDepth
        quoteBoundary = quoteForCarve().trimEnd()
      }
      if (paragraph && quoteDepth > depth && !outsideQuoteItem) {
        const markerAt = closedQuoteBoundary(quote, depth).length - 1
        out.push(original.slice(0, markerAt) + '\\' + original.slice(markerAt))
        blank = false
        continue
      }
      out.push(originalForCarve())
      paragraph = false
      headingMarker = ''
      blank = true
      continue
    }
    if (/^:[ \t]+\S/.test(visible) && (blank || definitionIndent >= 0)) definitionIndent = indent
    else if (definitionIndent >= 0 && blank && indent <= definitionIndent) definitionIndent = -1
    if (definitionIndent >= 0 && indent <= definitionIndent && rejectedCommentStartsBlock(visible)) {
      out.push(quote + ' '.repeat(indent))
      definitionIndent = -1
      paragraph = false
      blank = true
    }
    if (definitionIndent >= 0) {
      out.push(originalForCarve())
      headingMarker = ''
      paragraph = true
      blank = false
      continue
    }
    const blockStart =
      outsideQuoteItem || (quoteDepth > depth && !paragraph) ||
      rows[n] ||
      fences[n] !== original ||
      /^(?:#{1,6}(?:[ \t]|$)|:{3,}|\|)/.test(visible) ||
      /^(?:[*-][ \t]*){3,}$/.test(visible)
    const item =
      /^(?:([-*+])|((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)))[ \t]+[^ \t]/.exec(
        visible,
      )
    if (outsideQuoteItem) {
      paragraph = false
      quoteBoundary = quoteForCarve().trimEnd()
    }
    if (embeddedListOwner && quoteDepth > embeddedListOwner.depth && quoteDepth >= depth && (quoteColumns[embeddedListOwner.depth] ?? indent) < embeddedListOwner.column + 1) embeddedListOwner = undefined
    // A new block can end lazy continuation outside a quote or list item.
    if (quoteDepth < depth && (blockStart || item || rejectedCommentStartsBlock(visible))) {
      while (lists.length && lists.at(-1)!.depth > quoteDepth) lists.pop()
      if (embeddedListOwner && embeddedListOwner.depth > quoteDepth) embeddedListOwner = undefined
      const owner = lists.at(-1)
      if (item && !blank && paragraph && (!owner || owner.depth !== quoteDepth || indent > owner.column)) out.push(closedQuoteBoundary(quoteBoundary, quoteDepth))
      else if (rejectedCommentStartsBlock(visible) && !blank) out.push(quote.trimEnd())
      paragraph = false
      headingMarker = ''
      depth = quoteDepth
      quoteBoundary = quoteForCarve().trimEnd()
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
        ((quoteDepth > lists.at(-1)!.depth ? (quoteColumns[lists.at(-1)!.depth] ?? indent) : blockIndent) <= lists.at(-1)!.column ||
          (lists.length > 1 && (quoteDepth > lists.at(-1)!.depth ? (quoteColumns[lists.at(-1)!.depth] ?? indent) : blockIndent) < lists.at(-1)!.column + 1))
      ) {
        lists.pop()
        paragraph = false
        headingMarker = ''
        if (lists.length) lists.at(-1)!.loose = true
      }
      if (blank) for (const list of lists) if (blockIndent > list.column) list.loose = true
      if (!lists.length) embeddedListOwner = undefined
    }
    const quoteOwner = lists.at(-1)
    if (
      quoteOwner && quoteDepth >= depth && quoteDepth > quoteOwner.depth &&
      (quoteColumns[quoteOwner.depth] ?? indent) >= quoteOwner.column + 1 &&
      (!paragraph || quoteDepth === depth)
    ) {
      quoteBoundary = quoteForCarve().trimEnd()
      depth = quoteDepth
      if (item && (!paragraph || (embeddedListOwner?.depth === quoteDepth && indent <= embeddedListOwner.column))) {
        nativeRemainder = raw.slice(0, indent) + compactDjotListPrefix(text)
        embeddedListOwner = { depth: quoteDepth, column: indent, content: compactDjotListPrefix(item[0].slice(0, -1)).length }
      }
      out.push(originalForCarve())
      paragraph = !(rows[n] || fences[n] !== original || /^(?:#{1,6}(?:[ \t]|$)|:{3,})/.test(visible) || /^(?:[*-][ \t]*){3,}$/.test(visible) || /^\[[^\]\n]*\]:/.test(visible) || (!paragraph && visible.startsWith('{') && readAttributes(visible, 0)?.end === visible.length))
      blank = false
      continue
    }
    if (fences[n] !== original || rows[n]) {
      if (rows[n] && item) {
        nativeRemainder = raw.slice(0, indent) + compactDjotListPrefix(text)
        opaqueQuoteOwner = { depth: quoteDepth, column: indent, content: compactDjotListPrefix(item[0].slice(0, -1)).length }
      }
      out.push(originalForCarve())
      paragraph = false
      headingMarker = ''
      blank = false
      continue
    }
    if (paragraph && quoteDepth > depth) {
      const markerAt = closedQuoteBoundary(quote, depth).length - 1
      out.push(original.slice(0, markerAt) + '\\' + original.slice(markerAt))
      blank = false
      continue
    }
    if (quoteDepth > depth && !paragraph) {
      lists.length = 0
      embeddedListOwner = undefined
      depth = quoteDepth
      quoteBoundary = quoteForCarve().trimEnd()
    } else if (quoteDepth < depth && !paragraph) {
      while (lists.length && lists.at(-1)!.depth > quoteDepth) lists.pop()
      if (embeddedListOwner && embeddedListOwner.depth > quoteDepth) embeddedListOwner = undefined
      depth = quoteDepth
      quoteBoundary = quoteForCarve().trimEnd()
    }
    if (view.trim() === '') {
      out.push(originalForCarve())
      paragraph = !headingMarker && !/^(?:(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)?\[[^\]\n]+\]:/.test(text)
      blank = false
      continue
    }
    const div = /^(:{3,})(?:[ \t]+.*)?$/.exec(visible)
    const top = divs.at(-1)
    const closeStarts = divClosers.get(lineOffsets[n]!)
    if (div && top && closeStarts !== undefined) {
      dropOrphanAttributeLine(out)
      let matched = 0
      const outerStart = closeStarts.at(-1)!
      while (divs.length && divs.at(-1)!.start >= outerStart) {
        const closed = divs.pop()!
        while ((closeStarts[matched] ?? -1) > closed.start) matched++
        if (closed.start === closeStarts[matched]) {
          out.push(closed.prefix + ':'.repeat(closed.width))
          matched++
        }
      }
      paragraph = false
      headingMarker = ''
      blank = true
      continue
    }
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
        out.push(quoteForCarve() + ' '.repeat(indent) + '\\' + text)
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
        out.push(quoteForCarve() + ' '.repeat(target) + literal)
        if (parent) parent.continuation = true
        blank = false
        continue
      }
      const kind = item[1] ?? item[2]!.replace(/[0-9A-Za-z]+/, '1')
      let context = parent
      const nested = parent && indent > parent.column
      if (!parent || nested) {
        context = {
          depth: quoteDepth,
          column: indent,
          content: compactDjotListPrefix(item[0].slice(0, -1)).length,
          target: nested ? parent.target + parent.content : 0,
          kind,
          bullet: item[1] === '*' ? '*' : '-',
          loose: false,
          start: out.length,
          continuation: false,
        }
        lists.push(context)
      } else if (kind !== parent.kind) {
        if (out.at(-1)?.trim() !== '') out.push(quoteForCarve().trimEnd())
        parent.kind = kind
        parent.bullet = parent.bullet === '-' ? '*' : '-'
      }
      if (parent && !nested && parent.loose && parent.continuation && out.at(-1)?.trim() !== '')
        out.push(quoteForCarve().trimEnd())
      const compact = compactDjotListPrefix(text)
      const written = item[1] ? context!.bullet + compact.slice(1) : compact
      context!.continuation = false
      headingMarker = ''
      out.push(quoteForCarve() + ' '.repeat(context!.target) + written)
      const body = text.slice(item[0].length - 1)
      const itemHeading = /^(#{1,6})(?:[ \t]+|$)/.exec(body)
      headingMarker = itemHeading?.[1] ?? ''
      const itemDiv = /^(:{3,})(?:[ \t]+.*)?$/.exec(body)
      if (itemDiv)
        divs.push({
          width: itemDiv[1]!.length,
          prefix: quoteForCarve() + ' '.repeat(context!.target + context!.content),
          itemColumn: context!.column + 1,
          depth: quoteDepth,
          start: lineOffsets[n]!,
        })
      const task = body.startsWith('[') ? /^\[[ xX]\][ \t]+/.exec(body) : null
      const itemBody = task ? body.slice(task[0].length) : body
      const itemQuote = itemBody.startsWith('>') ? itemQuotePrefix(itemBody) : undefined
      embeddedListOwner = itemQuote?.owner ? { ...itemQuote.owner, depth: quoteDepth + itemQuote.owner.depth } : undefined
      if (itemQuote?.depth) {
        depth = quoteDepth + (itemQuote.body ? itemQuote.depth : 0)
        quoteBoundary = (quoteForCarve() + ' '.repeat(context!.target + context!.content) + itemQuote.prefix).trimEnd()
      }
      const quoteBody = itemQuote?.body ?? ''
      paragraph = !itemDiv && !itemHeading && !(itemQuote?.depth && (quoteBody === '' || /^\[[^\]\n]*\]:/.test(quoteBody) || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|(?:[*-][ \t]*){3,}$)/.test(quoteBody)))
      blank = !!itemDiv
      continue
    }
    if (div && !paragraph) {
      const parent = lists.at(-1)
      divs.push({
        width: div[1]!.length,
        prefix: quoteForCarve() + ' '.repeat(indent),
        depth: quoteDepth,
        start: lineOffsets[n]!,
        ...(parent && indent > parent.column ? { itemColumn: parent.column + 1 } : {}),
      })
      out.push(originalForCarve())
      paragraph = false
      headingMarker = ''
      blank = true
      continue
    }
    const attrs = visible.startsWith('{') ? readAttributes(raw, indent) : undefined
    const attributeLine = attrs?.end === raw.length
    const outsideColumn = blank && !parentContains(lists, indent) && !attributeLine ? lists[0]?.column : undefined
    if (outsideColumn !== undefined) { lists.length = 0; embeddedListOwner = undefined }
    const heading = /^(#{1,6})(?:[ \t]+|$)/.exec(visible)
    if (rejectedCommentStartsBlock(visible)) {
      const outsideList = lists.length > 0 && indent <= lists[0]!.column
      if (headingMarker || outsideList) out.push(quote + ' '.repeat(indent))
      if (outsideList) { lists.length = 0; paragraph = false; blank = true }
      headingMarker = ''
    }
    const reference = /^\[[^\]\n]*\]:/.test(visible)
    const row = rows[n] ?? false
    if (row) {
      out.push(originalForCarve())
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
      out.push(quoteForCarve() + ' '.repeat(indent) + '\\' + text)
      blank = false
      continue
    }
    if (!paragraph && /^\|`+\|$/.test(text) && !row) {
      while (out[0] === '') out.shift()
      out.push(quoteForCarve() + ' '.repeat(indent) + '\\' + text)
      paragraph = true
      blank = false
      continue
    }
    if (heading) headingMarker = heading[1]!
    if (heading && !lists.length) {
      out.push(
        quoteForCarve() +
          heading[1] +
          // Carve whitespace does not include a vertical tab or a form feed, so
          // `String.prototype.trim` would eat heading content (carve-js#2681).
          (trimNonNbsp(text.slice(heading[1]!.length)) ? ' ' + trimStartNonNbsp(text.slice(heading[1]!.length)) : ''),
      )
    } else if (rule && !lists.length && !paragraph) out.push(quoteForCarve() + '***')
    else {
      const parent = lists.at(-1)
      if (parent && indent > parent.column)
        out.push(
          quoteForCarve() +
            ' '.repeat(parent.target + parent.content + Math.max(0, indent - parent.column - parent.content)) +
            text,
        )
      else out.push(outsideColumn === undefined ? originalForCarve() : quoteForCarve() + ' '.repeat(Math.max(0, indent - outsideColumn)) + text)
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
    if (blank && !item && !parentContains(lists, indent) && !attributeLine) { lists.length = 0; embeddedListOwner = undefined }
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
  return lists.some((list) => indent > list.column)
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

function indentColumnsAfterQuotes(line: string, depth: number): number[] {
  let at = 0
  const columns: number[] = []
  for (let level = 0; level <= depth; level++) {
    const start = at
    while (line[at] === ' ' || line[at] === '\t') at++
    columns.push(at - start)
    if (level < depth) {
      at++
      if (line[at] === ' ' || line[at] === '\t') at++
    }
  }
  return columns
}

function itemQuotePrefix(body: string): { depth: number; prefix: string; body: string; owner?: { depth: number; column: number; content: number } } {
  let rest = body, depth = 0, prefix = ''
  let owner: { depth: number; column: number; content: number } | undefined
  while (true) {
    const quote = /^(?:>(?:[ \t]+|$))+/.exec(rest)
    if (!quote) break
    depth += (quote[0].match(/>/g) ?? []).length
    prefix += quote[0]
    rest = rest.slice(quote[0].length)
    const item = /^((?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)(?:\[[ xX]\][ \t]+)?(?=[^ \t])/.exec(rest)
    if (!item) break
    let end = quote[0].length
    while (end > 0 && (quote[0][end - 1] === ' ' || quote[0][end - 1] === '\t')) end--
    owner = { depth, column: Math.max(0, quote[0].length - end - 1), content: compactDjotListPrefix(item[1]!).length }
    if (!/^>(?:[ \t]|$)/.test(rest.slice(item[0].length))) break
    prefix += ' '.repeat(compactDjotListPrefix(item[1]!).length)
    rest = rest.slice(item[0].length)
  }
  return { depth, prefix, body: rest, ...(owner ? { owner } : {}) }
}

function closedQuoteBoundary(prefix: string, retainedDepth: number): string {
  let at = -1
  for (let level = 0; level <= retainedDepth; level++) {
    const next = prefix.indexOf('>', at + 1)
    if (next < 0) return prefix
    at = next
  }
  return prefix.slice(0, at + 1)
}

export function hasDjotCodeLayoutCandidates(source: string): boolean {
  return source.includes('\\|') || (source.includes('`') && /(?:^|\n)[ \t]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+(?:\[[ xX]\][ \t]+)?|\[\^[^\]\n]+\]:[ \t]*)*>/.test(source)) ||
    (source.includes('```') && /(?:^|\n)(?:[ \t]*>(?:[ \t]|$))*[ \t]+`{3,}/.test(source))
}
