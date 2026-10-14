import { isDjotEscaped, maskDjotCodeAndDestinations, maskDjotFences, djotInlineBoundaries } from './djot-migrate.js'
import { trimNonNbsp, trimStartNonNbsp } from './trim-non-nbsp.js'
import { readAttributes } from './djot-word-attributes.js'
import { rejectedCommentStartsBlock } from './djot-attributes.js'
import { continuesParagraph } from './djot-attributes.js'
import { djotTableRows } from './djot-migrate.js'
import { backtickRunEnds } from './backtick-run-index.js'

function djotListKind(marker: string): string {
  const label = /[0-9A-Za-z]+/.exec(marker)?.[0]
  if (!label) return marker
  let mask = /^[0-9]+$/.test(label) ? 1 : label === label.toLowerCase() ? 2 : 8
  if (/^[ivxlcdm]+$/i.test(label)) mask = (label.length === 1 ? mask : 0) | (label === label.toLowerCase() ? 4 : 16)
  return `${mask}:${marker.replace(/[0-9A-Za-z]+/, '')}`
}

function sharedDjotListKind(prior: string | undefined, current: string): string | undefined {
  if (prior === current) return current
  const first = /^(\d+):(.*)$/.exec(prior ?? ''), second = /^(\d+):(.*)$/.exec(current)
  if (!first || !second || first[2] !== second[2]) return undefined
  const common = Number(first[1]) & Number(second[1])
  return common ? `${common}:${first[2]}` : undefined
}

function emptyDjotTaskTailEnd(text: string, allowAttributes: boolean): number | undefined {
  let at = 0
  while (at < text.length) {
    const marker = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.exec(text.slice(at))
    if (!marker) return undefined
    at += marker[0].length
    if (/^[-*+] $/.test(marker[0])) {
      const task = /^\[[ xX]\](?:[ \t]+|$)/.exec(text.slice(at))
      if (task) {
        at += task[0].length
        if (at === text.length) return at
        const attrs = readAttributes(text, at)
        if (allowAttributes && attrs && text.slice(attrs.end).trim() === '') return at
      }
    }
  }
  return undefined
}

function compactDjotListPrefix(text: string, canonicalBullets = false): string {
  if (!canonicalBullets && !text.includes('0') && !text.includes('(') && !text.includes('\t') && !text.includes('[') && !text.includes('+')) return text
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
    parts.push(item[0].replace(canonicalBullets ? /^[-*+](?=[ \t])/ : /^\+(?=[ \t])/, '-').replace(/^(\(?)0+(?=[0-9])/, '$1').replace(/^\(([^)]+)\)/, '$1.').replace(/\t/g, ' '))
    at += item[0].length
    if (/^[-*+]/.test(item[0])) {
      const task = /^\[[ xX\-_>?]\](?:[ \t]+|$)/.exec(text.slice(at))
      if (task) {
        const accepted = /^[-*+] $/.test(item[0]) && /^[ xX]$/.test(task[0][1]!)
        parts.push(accepted ? task[0].replace(/\t/g, ' ') : '\\' + task[0])
        at += task[0].length
        if (!accepted) break
      }
    }
  }
  parts.push(text.slice(at))
  return parts.join('')
}

/** Preserve Djot paragraph boundaries and container columns in Carve. */
function deepQuotedItemAttributes(source: string, hold: (attributes: string, block?: boolean) => string): string {
  if (!source.includes('{') || !source.includes('>')) return source
  const lines = source.split('\n'), maskedSource = maskDjotCodeAndDestinations(source), masks = maskedSource.split('\n')
  const tableRows = source.includes('|') ? djotTableRows(source, maskedSource) : []
  type Frame = { column: number; start: number; kind: string; attributes: { row: number; wire: string }[] }
  const frames = new Map<number, Frame[]>()
  const before = new Map<number, string[]>()
  const removed = new Set<number>()
  let offset = 0, previousDepth = 0, previousParagraph = false
  let literalDepth: number | undefined
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!, prefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    const depth = (prefix.match(/>/g) ?? []).length, body = line.slice(prefix.length), indent = /^[ \t]*/.exec(body)![0].length
    const text = body.slice(indent), visible = masks[row]!.slice(prefix.length + indent)
    const at = offset + prefix.length + indent
    offset += line.length + 1
    let openingColumn = 0
    if (depth > previousDepth) {
      let end = 0
      for (let level = 0; level < previousDepth; level++) end += /^[ \t]*>(?:[ \t]|$)/.exec(prefix.slice(end))![0].length
      openingColumn = /^[ \t]*/.exec(prefix.slice(end))![0].length
    }
    const endsItem = masks[row]![prefix.lastIndexOf('>')] === '>' && frames.get(previousDepth)?.some(owner => owner.column >= openingColumn)
    if (literalDepth !== undefined && depth <= literalDepth) literalDepth = undefined
    if (depth > previousDepth && previousParagraph && !endsItem) literalDepth ??= previousDepth
    for (const level of frames.keys()) if (level > depth) frames.delete(level)
    if (depth > previousDepth) {
      if ((endsItem || !previousParagraph) && masks[row]![prefix.lastIndexOf('>')] === '>') {
        const retained = frames.get(previousDepth)?.filter(owner => owner.column < openingColumn)
        if (retained?.length) frames.set(previousDepth, retained)
        else frames.delete(previousDepth)
      }
      const owner = frames.get(previousDepth)?.at(-1)
      if (owner) owner.attributes = []
    }
    const priorDepth = previousDepth, priorParagraph = previousParagraph
    previousDepth = depth
    previousParagraph = text !== '' && !tableRows[row] && !/^(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*$/.test(text) && !/^(?:[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|\[(?:\^)?[^\]\n]*\]:)/.test(visible) && !(visible.startsWith('{') && readAttributes(body, indent)?.end === body.trimEnd().length)
    if (literalDepth !== undefined && depth > literalDepth) continue
    if (depth < 1 || text === '') continue
    const item = /^([-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.exec(visible)
    const stack = frames.get(depth) ?? []
    const lazy = depth === priorDepth && priorParagraph && previousParagraph && !item
    while (!lazy && stack.at(-1) && stack.at(-1)!.column > indent) stack.pop()
    const frame = stack.at(-1)
    if (item) {
      if (depth === priorDepth && priorParagraph && (!frame || indent > frame.column)) {
        previousParagraph = true
        if (stack.length) frames.set(depth, stack)
        continue
      }
      const itemText = text.slice(item[0].length).replace(/^\[[ xX]\][ \t]+/, '').trimStart()
      previousParagraph = itemText !== '' && !/^(?:[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|[>|]|\[(?:\^)?[^\]\n]*\]:)/.test(itemText)
      let kind = djotListKind(item[1]!)
      if (/^[-*+]/.test(item[1]!) && /^\[[ xX]\](?:[ \t]+|$)/.test(text.slice(item[0].length))) kind += ':task'
      const same = frame && indent === frame.column ? sharedDjotListKind(frame.kind, kind) : undefined
      if (depth >= 2 && frame && same !== undefined && frame.attributes.length) {
        const wire = '{' + frame.attributes.map(attr => attr.wire.slice(1, -1)).join(' ') + '}'
        for (const attr of frame.attributes) removed.add(attr.row)
        const loose = lines.slice(Math.max(0, frame.attributes[0]!.row - 1), row).some(line => /^(?:[ \t]*>(?:[ \t]|$))*[ \t]*$/.test(line))
        before.set(row, [prefix + ' '.repeat(indent) + hold(wire), ...(loose ? [prefix.trimEnd()] : [])])
        const prefixEnds = [0]
        for (let level = 0; level < depth; level++) prefixEnds.push(prefixEnds[level]! + /^[ \t]*>(?:[ \t]|$)/.exec(prefix.slice(prefixEnds[level]))![0].length)
        for (const [ownerDepth, owners] of frames) for (const owner of owners) {
          if (!loose || ownerDepth > depth || ownerDepth === depth && owner.column !== frame.column) continue
          const ownerIndent = /^[ \t]*/.exec(prefix.slice(prefixEnds[ownerDepth]))![0].length
          if (ownerDepth < depth && ownerIndent <= owner.column) continue
          const startPrefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(lines[owner.start]!)![0]
          if (!before.has(owner.start)) before.set(owner.start, [startPrefix + ' '.repeat(owner.column) + hold('{loose}', true), startPrefix.trimEnd()])
        }
      }
      if (frame && indent > frame.column) frame.attributes = []
      if (frame && indent === frame.column) stack.pop()
      stack.push({ column: indent, start: same !== undefined ? frame!.start : row, kind: same ?? kind, attributes: [] })
      frames.set(depth, stack)
    } else if (visible.startsWith('{')) {
      const attrs = readAttributes(body, indent)
      if (depth >= 2 && !frame && !priorParagraph && attrs?.end === body.trimEnd().length) {
        lines[row] = prefix + attrs.source
        for (let next = row + 1; next < lines.length && lines[next]!.trimEnd() === prefix.trimEnd(); next++) removed.add(next)
      }
      if (depth >= 2 && frame && indent > frame.column && attrs?.end === body.trimEnd().length && !continuesParagraph(source, at)) frame.attributes.push({ row, wire: attrs.source })
      else if (frame && indent <= frame.column && !lazy) frames.delete(depth)
      else if (frame && attrs?.end !== body.trimEnd().length) frame.attributes = []
    } else if (frame) {
      frame.attributes = []
      if (indent <= frame.column && !lazy) frames.delete(depth)
    }
  }
  return lines.flatMap((line, row) => removed.has(row) ? [] : [...(before.get(row) ?? []), line]).join('\n')
}

export function djotBlockLayout(source: string, rows: readonly boolean[], isBoundary: (line: string) => boolean = () => false, noteSourceWidths: ReadonlyMap<string, number> = new Map(), emptyNote = '%%%%', holdItemAttributes?: (attributes: string, block?: boolean) => string, onLiteralQuote?: (line: number, depth: number) => void): string {
  if (holdItemAttributes) {
    const prepared = deepQuotedItemAttributes(source, holdItemAttributes)
    if (prepared !== source) { source = prepared; rows = djotTableRows(source, maskDjotCodeAndDestinations(source, false, true, false)) }
  }
  const lines = source.split('\n')
  const maskedSource = maskDjotCodeAndDestinations(source, false)
  const hasDefinitionSyntax = /(?:^|\n)(?:[ \t]*>(?:[ \t]|$))*[ \t]*:[ \t]/.test(maskedSource)
  const mask = maskedSource.split('\n')
  const divClosers = new Map<number, number[]>()
  if (source.includes(':::')) djotInlineBoundaries(source, maskedSource, true, divClosers)
  let lineOffset = 0
  const lineOffsets = lines.map(line => { const at = lineOffset; lineOffset += line.length + 1; return at })
  const fences = maskDjotFences(source).split('\n')
  let divs: {
    width: number
    prefix: string
    itemColumn?: number
    depth: number
    start: number
  }[] = []
  let lists: {
    sourcePrefix: number
    depth: number
    column: number
    content: number
    target: number
    kind: string
    bullet: string
    loose: boolean
    start: number
    continuation: boolean
    empty?: boolean
  }[] = []
  const mainOut: string[] = []
  let out = mainOut
  const returnedNoteItemAttributes: string[] = []
  let returnedNoteDestinationDepth: number | undefined
  let pendingAttributes: { owner: number; depth: number; row: number; output: string[]; attributes: string }[] = []
  let paragraph = false,
    blank = true,
    depth = 0
  type EmbeddedOwner = { depth: number; column: number; content: number; sourcePrefix?: number; sourceContent?: number; target?: number }
  let embeddedListOwner: EmbeddedOwner | undefined
  let embeddedOwners: EmbeddedOwner[] = []
  const setEmbedded = (owner: EmbeddedOwner | undefined, owners?: EmbeddedOwner[]): void => {
    embeddedListOwner = owner
    embeddedOwners = owners ?? (owner ? [owner] : [])
  }
  const trimEmbedded = (maximumDepth: number): void => {
    while (embeddedOwners.at(-1) && embeddedOwners.at(-1)!.depth > maximumDepth) embeddedOwners.pop()
    embeddedListOwner = embeddedOwners.at(-1)
  }
  type NoteOwner = { depth: number; column: number; target: number; content: number; listBase: number; parentOut: string[]; parentLists: typeof lists; parentDivs: typeof divs; parentDepth: number; parentBoundary: string; parentEmbedded: typeof embeddedListOwner; parentEmbeddedOwners: EmbeddedOwner[]; parentOpaque: typeof opaqueQuoteOwner; parentDefinition: number; placement: number | undefined; fenceColumn?: number }
  let noteOwner: NoteOwner | undefined
  const notes: NoteOwner[] = []
  const completedNotes: { body: string[]; placement: number | undefined; fenceColumn?: number }[] = []
  const endNote = (): void => {
    const ended = notes.pop()!
    for (const attribute of pendingAttributes) { attribute.output[attribute.row] = ''; returnedNoteItemAttributes.push(attribute.attributes) }
    pendingAttributes = []
    if (returnedNoteItemAttributes.length) returnedNoteDestinationDepth = Math.min(returnedNoteDestinationDepth ?? ended.depth, ended.depth)
    if (divs.length) dropOrphanAttributeLine(out)
    while (divs.length) {
      const div = divs.pop()!
      if (!div.prefix.includes('>')) out.push(div.prefix + ':'.repeat(div.width))
    }
    completedNotes.push({ body: out, placement: ended.placement })
    out = ended.parentOut
    lists = ended.parentLists
    divs = ended.parentDivs
    depth = ended.parentDepth
    quoteBoundary = ended.parentBoundary
    setEmbedded(ended.parentEmbedded, ended.parentEmbeddedOwners)
    opaqueQuoteOwner = ended.parentOpaque
    definitionIndent = ended.parentDefinition
    noteOwner = notes.at(-1)
    paragraph = false
    headingMarker = ''
  }
  let opaqueQuoteOwner: { depth: number; column: number; content: number } | undefined
  let quoteBoundary = ''
  let headingMarker = ''
  let definitionIndent = -1
  const definitionStack: number[] = []
  for (let n = 0; n < lines.length; n++) {
    const original = lines[n]!,
      masked = mask[n]!
    const physicalQuote = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(original)![0]
    const physicalQuoteDepth = (physicalQuote.match(/>/g) ?? []).length
    const quotedNoteItem: RegExpExecArray | null = !noteOwner && (blank || !paragraph || physicalQuoteDepth < depth || lists.at(-1)?.depth === physicalQuoteDepth && /^[ \t]*/.exec(original.slice(physicalQuote.length))![0].length <= lists.at(-1)!.column) && fences[n] === original ? /^([ \t]*)((?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)(>[ \t](?:[ \t]*>[ \t])*)[ \t]*(?=\[\^[^\]\n]+\]:(?:[ \t]|$))/.exec(original.slice(physicalQuote.length)) : null
    const quote: string = quotedNoteItem ? physicalQuote + quotedNoteItem[1] + quotedNoteItem[2] + quotedNoteItem[3] : physicalQuote
    const quoteDepth: number = (quote.match(/>/g) ?? []).length
    if (quoteDepth > 0 && masked[quote.indexOf('>')] !== '>' && fences[n] === original) {
      out.push(original)
      blank = false
      continue
    }
    const quoteForCarve = (): string => {
      const baseDepth = noteOwner?.depth ?? 0
      const retainedQuote = baseDepth ? quote.slice(closedQuoteBoundary(quote, baseDepth - 1).length).replace(/^[ \t]/, '') : quote
      if (!quoteDepth || definitionIndent >= 0 || hasDefinitionSyntax || fences[n] !== original || masked[quote.indexOf('>')] !== '>') return baseDepth ? retainedQuote : quote
      const owner = lists.at(-1)
      const contexts: { depth: number; column: number; content: number; target: number; sourcePrefix?: number }[] = []
      if (owner) contexts.push(owner)
      for (const candidate of embeddedOwners) {
        if (candidate.depth >= quoteDepth) break
        contexts.push({ ...candidate, target: candidate.target ?? 0 })
      }
      if (noteOwner) contexts.push(noteOwner)
      if (opaqueQuoteOwner) contexts.push({ ...opaqueQuoteOwner, target: opaqueQuoteOwner.column })
      const firstOwned = Math.min(...contexts.map(value => value!.depth))
      const lastOwned = Math.max(...contexts.map(value => value!.depth))
      const byDepth = new Map<number, typeof contexts[number]>()
      for (const candidate of contexts) if (ownerColumn(candidate) > candidate.column && (!byDepth.has(candidate.depth) || candidate.column >= byDepth.get(candidate.depth)!.column)) byDepth.set(candidate.depth, candidate)
      const parts: string[] = []
      for (let level = baseDepth; level < quoteDepth; level++) {
        const held = byDepth.get(level)
        const column = held ? held.target + held.content : level > firstOwned && level < lastOwned ? (quoteColumns[level] ?? 0) : 0
        parts.push(' '.repeat(column), '>')
        if (level + 1 < quoteDepth || !quote.endsWith('>')) parts.push(' ')
      }
      return parts.join('')
    }
    let nativeRemainder = original.slice(quote.length)
    const originalForCarve = (): string => {
      const ownedList = lists.at(-1)
      const noteColumn = ownedList && ownedList.depth === quoteDepth && indent > ownedList.column ? ownedList.target + ownedList.content : noteOwner?.content ?? 0
      return quoteForCarve() + (noteOwner && text !== '' && quoteDepth === noteOwner.depth && !noteHead ? fences[n] === original ? ' '.repeat(noteColumn) + text : nativeRemainder.slice(Math.min(indent, noteOwner.column)) : nativeRemainder)
    }
    const raw = original.slice(quote.length),
      view = masked.slice(quote.length)
    const rawIndent = /^[ \t]*/.exec(raw)![0].length
    const sourcePrefix = !quotedNoteItem && lists.at(-1)?.depth === quoteDepth ? lists.at(-1)!.sourcePrefix : quote.length
    const indent = Math.max(0, rawIndent + quote.length - sourcePrefix)
    const text = raw.slice(rawIndent),
      visible = view.slice(rawIndent)
    const quoteBases: number[] = []
    const quoteView = quotedNoteItem ? original.slice(0, physicalQuote.length + quotedNoteItem[1]!.length) + ' '.repeat(quotedNoteItem[2]!.length) + original.slice(physicalQuote.length + quotedNoteItem[1]!.length + quotedNoteItem[2]!.length) : original
    const quoteColumns = quoteDepth > 0 ? indentColumnsAfterQuotes(quoteView, quoteDepth, quoteBases) : []
    const ownerColumn = (owner: { depth: number; sourcePrefix?: number }): number => quoteDepth > owner.depth ? (quoteColumns[owner.depth] ?? rawIndent) + (owner.sourcePrefix === undefined ? 0 : (quoteBases[owner.depth] ?? 0) - owner.sourcePrefix) : owner.sourcePrefix === undefined ? indent : quote.length + rawIndent - owner.sourcePrefix
    const inlineNoteItem = (blank || !paragraph || quoteDepth < depth || lists.at(-1)?.depth === quoteDepth && indent <= lists.at(-1)!.column) ? /^((?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)(?=\[\^[^\]\n]+\]:(?:[ \t]|$))/.exec(visible) : null
    const noteText = inlineNoteItem ? text.slice(inlineNoteItem[0].length) : text
    const noteHead = (inlineNoteItem || visible.startsWith('[^')) ? /^(\[\^[^\]\n]+\]:[ \t]*)(.*)$/.exec(noteText) : null
    while (noteOwner && fences[n] === original && (text || quoteDepth > noteOwner.depth)) {
      const ownerColumn = quoteDepth > noteOwner.depth ? quoteColumns[noteOwner.depth] ?? 0 : indent
      const outside = quoteDepth < noteOwner.depth || ownerColumn <= noteOwner.column
      const block = isBoundary(original) || noteHead || quoteDepth > noteOwner.depth || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[|]|[`~]{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]|\[[^\]\n]+\]:)/.test(visible) || (visible.startsWith('{') && readAttributes(visible, 0)?.end === visible.length)
      if (outside && !(paragraph && !blank && !block && quoteDepth <= noteOwner.depth)) {
        endNote()
      } else break
    }
    if (noteOwner && fences[n] !== original) {
      const host = noteOwner.depth ? closedQuoteBoundary(original, noteOwner.depth - 1).length : 0
      const payload = original.slice(host).replace(noteOwner.depth ? /^[ \t]/ : /$^/, '')
      const payloadIndent = /^[ \t]*/.exec(payload)![0].length
      if (noteOwner.fenceColumn === undefined && payloadIndent <= noteOwner.column && /^(`{3,}|~{3,})/.test(payload.slice(payloadIndent))) {
        while (noteOwner && payloadIndent <= noteOwner.column) endNote()
      }
      if (noteOwner) {
        noteOwner.fenceColumn ??= payloadIndent
        if (returnedNoteItemAttributes.length) {
          const prefix = ' '.repeat(noteOwner.content)
          for (const attributes of returnedNoteItemAttributes) out.push(prefix + attributes)
          returnedNoteItemAttributes.length = 0
          returnedNoteDestinationDepth = undefined
        }
        out.push(' '.repeat(noteOwner.content) + payload.slice(Math.min(payloadIndent, noteOwner.fenceColumn)))
        paragraph = false
        headingMarker = ''
        blank = false
        continue
      }
    } else if (noteOwner) delete noteOwner.fenceColumn
    if (/^\[(?!\^)[^\]\n]*\]:/.test(text) && out.at(-1)?.includes(emptyNote)) out.push(quoteForCarve() + ' '.repeat(Math.max(0, indent)))
    if (opaqueQuoteOwner && text && (quoteDepth < opaqueQuoteOwner.depth || (quoteDepth === opaqueQuoteOwner.depth ? indent : quoteColumns[opaqueQuoteOwner.depth] ?? 0) < opaqueQuoteOwner.column + 1)) opaqueQuoteOwner = undefined
    const embeddedParent = lists.at(-1)
    if (text && fences[n] === original && embeddedOwners.length && embeddedParent && quoteDepth > embeddedParent.depth && ownerColumn(embeddedParent) <= embeddedParent.column) {
      if (paragraph && !blank) out.push(closedQuoteBoundary(quoteBoundary, Math.max(0, embeddedParent.depth - (noteOwner?.depth ?? 0))))
      setEmbedded(undefined)
      paragraph = false
      headingMarker = ''
    }
    if (text && fences[n] === original && embeddedOwners.length) {
      const startsBlock = /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[|]|[`~]{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]|\[[^\]\n]+\]:)/.test(visible)
      for (let i = 0; i < embeddedOwners.length; i++) {
        const owner = embeddedOwners[i]!
        const outside = quoteDepth < owner.depth || ownerColumn(owner) <= owner.column
        if (outside && (blank || !paragraph || quoteDepth > owner.depth || startsBlock)) {
          const siblingItem = quoteDepth === owner.depth && /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.test(visible)
          if (paragraph && !blank) out.push(closedQuoteBoundary(quoteBoundary, Math.max(0, owner.depth - (noteOwner?.depth ?? 0) - 1 + (siblingItem ? 1 : 0))))
          embeddedOwners = embeddedOwners.slice(0, i)
          embeddedListOwner = embeddedOwners.at(-1)
          paragraph = false
          headingMarker = ''
          break
        }
        if (owner.depth >= quoteDepth && !blank && paragraph && !startsBlock) break
      }
    }
    const blockIndent = quoteDepth > depth ? (quoteColumns[depth] ?? indent) : indent
    const ordinaryQuoteList = lists.at(-1)
    const quoteList = embeddedListOwner && embeddedListOwner.depth < quoteDepth && (!ordinaryQuoteList || embeddedListOwner.depth > ordinaryQuoteList.depth) ? embeddedListOwner : ordinaryQuoteList
    const outsideQuoteItem = quoteList && quoteDepth > quoteList.depth && ownerColumn(quoteList) < quoteList.column + 1
    if (returnedNoteItemAttributes.length) {
      const retainedDepth = Math.max(0, Math.min(returnedNoteDestinationDepth ?? 0, quoteDepth) - (noteOwner?.depth ?? 0))
      const prefix = retainedDepth ? closedQuoteBoundary(quoteForCarve(), retainedDepth - 1) + ' ' : ' '.repeat(noteOwner?.content ?? 0)
      for (const attributes of returnedNoteItemAttributes) out.push(prefix + attributes)
      returnedNoteItemAttributes.length = 0
      returnedNoteDestinationDepth = undefined
    }
    if (noteHead) {
      for (const attribute of pendingAttributes) attribute.output[attribute.row] = ''
      pendingAttributes = []
      if (!noteOwner && (quotedNoteItem || inlineNoteItem) && physicalQuoteDepth < depth) {
        out.push(quoteBoundary)
        depth = physicalQuoteDepth
        quoteBoundary = physicalQuote.trimEnd()
      }
      if (quotedNoteItem) {
        const marker = quotedNoteItem[2]!
        const column = quotedNoteItem[1]!.length
        const context = { sourcePrefix: physicalQuote.length, depth: physicalQuoteDepth, column, content: compactDjotListPrefix(marker).length, target: column, kind: djotListKind(marker.trim()), bullet: marker[0] === '*' ? '*' : '-', loose: false, start: out.length, continuation: false }
        lists.push(context)
        out.push(physicalQuote + quotedNoteItem[1] + compactDjotListPrefix(marker) + quotedNoteItem[3] + emptyNote)
        depth = quoteDepth
        quoteBoundary = (physicalQuote + ' '.repeat(context.target + context.content) + quotedNoteItem[3]).trimEnd()
      }
      if (inlineNoteItem) {
        const parent = lists.at(-1)
        const target = parent && parent.depth === quoteDepth && parent.column === indent ? parent.target : rawIndent
        out.push(quoteForCarve() + ' '.repeat(target) + compactDjotListPrefix(inlineNoteItem[0]) + emptyNote)
      }
      const noteIndent = indent + (inlineNoteItem?.[0].length ?? 0)
      while (lists.length && (lists.at(-1)!.depth > quoteDepth || (lists.at(-1)!.depth === quoteDepth && (indent < lists.at(-1)!.column || !inlineNoteItem && indent === lists.at(-1)!.column)))) lists.pop()
      if (!inlineNoteItem && !quotedNoteItem && (quoteDepth > 0 || (!lists.length && out.length && out.at(-1)?.trim() !== ''))) out.push(quoteForCarve().trimEnd())
      noteOwner = { depth: quoteDepth, column: noteIndent, target: 0, content: 2, listBase: 0, parentOut: out, parentLists: lists, parentDivs: divs, parentDepth: depth, parentBoundary: quoteBoundary, parentEmbedded: embeddedListOwner, parentEmbeddedOwners: embeddedOwners, parentOpaque: opaqueQuoteOwner, parentDefinition: definitionIndent, placement: !noteOwner && quoteDepth === 0 && noteIndent === 0 && !lists.length ? out.length : undefined }
      notes.push(noteOwner)
      out = []
      lists = []
      divs = []
      setEmbedded(undefined)
      opaqueQuoteOwner = undefined
      definitionIndent = -1
      let currentNoteHead = noteHead
      let nestedFirstBody = false
      let noteBodySourceAt = quote.length + rawIndent + (inlineNoteItem?.[0].length ?? 0)
      while (true) {
      const body = currentNoteHead[2]!
      const child = /^((?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)(?=[^ \t])/.exec(body)
      let childBody = body
      if (child) {
        lists.push({ sourcePrefix: quote.length, depth: quoteDepth, column: noteOwner.column + (noteSourceWidths.get(/^\[\^([^\]]+)\]/.exec(currentNoteHead[1]!)![1]!) ?? currentNoteHead[1]!.length), content: compactDjotListPrefix(child[1]!).length, target: noteOwner.target + 2, kind: djotListKind(child[1]!.trim()) + (/^[-*+] $/.test(child[1]!) && /^\[[ xX]\](?:[ \t]+|$)/.test(body.slice(child[1]!.length)) ? ':task' : ''), bullet: child[1]![0] === '*' ? '*' : '-', loose: false, start: out.length, continuation: false })
        childBody = body.slice(child[1]!.length)
        if (/^[-*+] $/.test(child[1]!)) childBody = childBody.replace(/^\[[ xX]\](?:[ \t]+|$)/, '')
      }
      const nestedHead = child ? /^(\[\^[^\]\n]+\]:[ \t]*)(.+)$/.exec(childBody) : null
      if (!nestedFirstBody && nestedHead) {
        out.push(currentNoteHead[1] + compactDjotListPrefix(child![1]!) + emptyNote)
        noteOwner = { depth: quoteDepth, column: lists.at(-1)!.column + child![1]!.length, target: 0, content: 2, listBase: 0, parentOut: out, parentLists: lists, parentDivs: divs, parentDepth: depth, parentBoundary: quoteBoundary, parentEmbedded: embeddedListOwner, parentEmbeddedOwners: embeddedOwners, parentOpaque: opaqueQuoteOwner, parentDefinition: definitionIndent, placement: undefined }
        notes.push(noteOwner)
        out = []
        lists = []
        divs = []
        setEmbedded(undefined)
        opaqueQuoteOwner = undefined
        definitionIndent = -1
        noteBodySourceAt += (noteSourceWidths.get(/^\[\^([^\]]+)\]/.exec(currentNoteHead[1]!)![1]!) ?? currentNoteHead[1]!.length) + child![1]!.length
        currentNoteHead = nestedHead
        nestedFirstBody = true
        continue
      }
      if (/^(`{3,}|~{3,})[ \t]*[a-zA-Z0-9_+#.-]*$/.test(childBody)) noteOwner.fenceColumn = noteOwner.column + noteOwner.content
      const inlineQuote = itemQuotePrefix(childBody)
      const noteBodyStart = noteBodySourceAt + (noteSourceWidths.get(/^\[\^([^\]]+)\]/.exec(currentNoteHead[1]!)![1]!) ?? currentNoteHead[1]!.length) + body.length - childBody.length
      const inlineOwners = inlineQuote.owners.map(owner => ({ ...owner, depth: quoteDepth + owner.depth, sourcePrefix: noteBodyStart + owner.sourceOffset }))
      setEmbedded(inlineOwners.at(-1), inlineOwners)
      depth = quoteDepth + inlineQuote.depth
      const context = child ? lists.at(-1)! : noteOwner
      quoteBoundary = (quoteForCarve() + ' '.repeat(context.target + context.content) + inlineQuote.prefix).trimEnd()
      const emptyTaskEnd = emptyDjotTaskTailEnd(body, n + 1 === lines.length || lines[n + 1]!.trim() === '')
      let writtenBody = compactDjotListPrefix(emptyTaskEnd === undefined ? body : body.slice(0, emptyTaskEnd).trimEnd() + ' +', emptyTaskEnd !== undefined)
      if (emptyTaskEnd !== undefined && body.startsWith('* ')) {
        writtenBody = '*' + writtenBody.slice(1)
        out.push(currentNoteHead[1] + emptyNote + '\n  ' + writtenBody)
      } else out.push(currentNoteHead[1] + writtenBody)
      const content = inlineQuote.body
      const inlineDiv = /^(:{3,})(?:[ \t]+.*)?$/.exec(content)
      if (inlineDiv) divs.push({ width: inlineDiv[1]!.length, prefix: ' '.repeat(context.target + context.content) + inlineQuote.prefix, depth, start: lineOffsets[n]!, ...(child ? { itemColumn: context.column + 1 } : {}) })
      paragraph = !rows[n] && content !== '' && !content.startsWith(emptyNote) && !/^(?:#{1,6}(?:[ \t]|$)|:{3,}|\[[^\]\n]*\]:|(?:[*-][ \t]*){3,}$)/.test(content) && !/^(`{3,}|~{3,})[ \t]*[a-zA-Z0-9_+#.-]*$/.test(content)
      headingMarker = /^(#{1,6})(?:[ \t]|$)/.exec(content)?.[1] ?? ''
      blank = !paragraph
      break
      }

      continue
    }
    if (text === '') {
      while (lists.length && lists.at(-1)!.depth > quoteDepth) lists.pop()
      if (embeddedListOwner && embeddedListOwner.depth > quoteDepth) trimEmbedded(quoteDepth)
      if (outsideQuoteItem) {
        while (lists.length && quoteDepth > lists.at(-1)!.depth && ownerColumn(lists.at(-1)!) < lists.at(-1)!.column + 1) lists.pop()
        if (embeddedListOwner && quoteDepth > embeddedListOwner.depth && ownerColumn(embeddedListOwner) < embeddedListOwner.column + 1) setEmbedded(undefined)
        depth = quoteDepth
        quoteBoundary = quoteForCarve().trimEnd()
      }
      if (paragraph && quoteDepth > depth && !outsideQuoteItem) {
        onLiteralQuote?.(n, depth)
        const markerAt = closedQuoteBoundary(quoteForCarve(), Math.max(0, depth - (noteOwner?.depth ?? 0))).length - 1
        const written = originalForCarve()
        out.push(written.slice(0, markerAt) + '\\' + written.slice(markerAt))
        blank = false
        continue
      }
      out.push(originalForCarve())
      paragraph = false
      headingMarker = ''
      blank = true
      continue
    }
    if ((definitionStack.at(-1) ?? -1) !== definitionIndent) {
      definitionStack.length = 0
      if (definitionIndent >= 0) definitionStack.push(definitionIndent)
    }
    if (/^:(?:[ \t]|$)/.test(visible) && (blank || definitionIndent >= 0) && (blank || indent <= definitionIndent)) {
      while (definitionStack.length && definitionStack.at(-1)! >= indent) definitionStack.pop()
      definitionStack.push(indent)
      definitionIndent = indent
    } else if (definitionIndent >= 0 && blank && indent <= definitionIndent) {
      while (definitionStack.length && definitionStack.at(-1)! >= indent) definitionStack.pop()
      definitionIndent = definitionStack.at(-1) ?? -1
    }
    if (definitionIndent >= 0 && indent <= definitionIndent && rejectedCommentStartsBlock(visible)) {
      out.push(quoteForCarve() + ' '.repeat(indent))
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
    const row: boolean = (rows[n] ?? false) && !(noteOwner && paragraph && quoteDepth >= depth && !(lists.at(-1) && indent <= lists.at(-1)!.column))
    const rawFencedItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+(?:\[[ xX]\][ \t]+)?(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*$/.test(text)
    const rawReferenceItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+\[(?!\^)[^\]\n]+\]:/.test(text)
    const fencedItemOpener = rawFencedItem && /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.test(visible)
    const wholeAttributes = visible.startsWith('{') && readAttributes(raw, rawIndent)?.end === raw.length
    if (pendingAttributes.length && text !== '' && (!wholeAttributes || !lists.some(list => list.depth === quoteDepth && indent > list.column)) && (!/^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+[^ \t]/.test(visible) && !rawFencedItem && !rawReferenceItem || pendingAttributes.some(attribute => attribute.depth !== quoteDepth))) {
      for (const attribute of pendingAttributes) {
        const destinationDepth = Math.min(attribute.depth, quoteDepth)
        const column = quoteDepth > attribute.depth ? quoteColumns[attribute.depth] ?? 0 : indent
        const owner = lists.filter(list => list.depth === destinationDepth && column > list.column).at(-1)
        const target = owner ? owner.target + owner.content + Math.max(0, column - owner.column - owner.content) : column
        const retainedDepth = Math.max(0, destinationDepth - (noteOwner?.depth ?? 0))
        const prefix = retainedDepth === quoteDepth - (noteOwner?.depth ?? 0) ? quoteForCarve() : closedQuoteBoundary(quoteForCarve(), retainedDepth - 1) + (retainedDepth ? ' ' : '')
        attribute.output[attribute.row] = prefix + ' '.repeat(target) + attribute.attributes
      }
      pendingAttributes = []
    }
    const blockStart =
      outsideQuoteItem || (quoteDepth > depth && !paragraph) ||
      row ||
      fences[n] !== original ||
      /^(?:#{1,6}(?:[ \t]|$)|:{3,}|\|)/.test(visible) ||
      (/^(?:[*-][ \t]*){3,}$/.test(visible) && /^(?:[*-][ \t]*){3,}$/.test(text))
    // Match authored empty bodies, not spaces masking inline code.
    const emptyItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]*$/.test(text) || /^[-*+] \[[ xX]\][ \t]*$/.test(text)
    const item =
      /^(?:([-*+])|((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)))[ \t]+[^ \t]/.exec(
        emptyItem ? visible.trimEnd() + ' +' : fencedItemOpener || pendingAttributes.length && (rawFencedItem || rawReferenceItem) ? text : visible,
      )
    if (outsideQuoteItem) {
      paragraph = false
      quoteBoundary = quoteForCarve().trimEnd()
    }
    if (embeddedListOwner && quoteDepth > embeddedListOwner.depth && quoteDepth >= depth && ownerColumn(embeddedListOwner) < embeddedListOwner.column + 1) setEmbedded(undefined)
    const shallowerAttributes = quoteDepth < depth && visible.startsWith('{') && readAttributes(visible, 0)?.end === visible.length
    if (shallowerAttributes && !blank) out.push(quoteForCarve().trimEnd())
    // A new block can end lazy continuation outside a quote or list item.
    if (quoteDepth < depth && (blockStart || item || shallowerAttributes || rejectedCommentStartsBlock(visible))) {
      while (lists.length && lists.at(-1)!.depth > quoteDepth) lists.pop()
      if (embeddedListOwner && embeddedListOwner.depth > quoteDepth) trimEmbedded(quoteDepth)
      const owner = lists.at(-1)
      if (item && !blank && paragraph && (!owner || owner.depth !== quoteDepth || indent > owner.column)) out.push(closedQuoteBoundary(quoteBoundary, Math.max(0, quoteDepth - (noteOwner?.depth ?? 0))))
      else if (rejectedCommentStartsBlock(visible) && !blank) out.push(quoteForCarve().trimEnd())
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
    if (blockStart && !((pendingAttributes.length || fencedItemOpener || row) && item)) {
      // A block outside the nested item's content column belongs to its parent.
      while (
        lists.length &&
        ((quoteDepth > lists.at(-1)!.depth ? ownerColumn(lists.at(-1)!) : blockIndent) <= lists.at(-1)!.column ||
          (lists.length > 1 && (quoteDepth > lists.at(-1)!.depth ? ownerColumn(lists.at(-1)!) : blockIndent) < lists.at(-1)!.column + 1))
      ) {
        lists.pop()
        paragraph = false
        headingMarker = ''
        if (lists.length) lists.at(-1)!.loose = true
      }
      if (blank) for (const list of lists) if (blockIndent > list.column) list.loose = true
      if (!lists.length) setEmbedded(undefined)
    }
    const quoteOwner = lists.at(-1)
    if (
      quoteOwner && quoteDepth > quoteOwner.depth &&
      ownerColumn(quoteOwner) >= quoteOwner.column + 1 &&
      (!paragraph || quoteDepth === depth)
    ) {
      quoteBoundary = quoteForCarve().trimEnd()
      depth = quoteDepth
      if (item && (!paragraph || (embeddedListOwner?.depth === quoteDepth && indent <= embeddedListOwner.column))) {
        nativeRemainder = raw.slice(0, indent) + compactDjotListPrefix(text)
        setEmbedded({ depth: quoteDepth, column: indent, content: compactDjotListPrefix(item[0].slice(0, -1)).length, sourcePrefix: quote.length, sourceContent: item[0].length - 1 }, embeddedOwners.filter(owner => owner.depth < quoteDepth).concat({ depth: quoteDepth, column: indent, content: compactDjotListPrefix(item[0].slice(0, -1)).length, sourcePrefix: quote.length, sourceContent: item[0].length - 1 }))
      }
      out.push(wholeAttributes && !paragraph && embeddedListOwner?.depth !== quoteDepth ? quoteForCarve() + text : originalForCarve())
      paragraph = !(row || fences[n] !== original || /^(?:#{1,6}(?:[ \t]|$)|:{3,})/.test(visible) || (/^(?:[*-][ \t]*){3,}$/.test(visible) && /^(?:[*-][ \t]*){3,}$/.test(text)) || /^\[[^\]\n]*\]:/.test(visible) || (!paragraph && visible.startsWith('{') && readAttributes(visible, 0)?.end === visible.length))
      blank = false
      continue
    }
    if ((fences[n] !== original || row) && !((pendingAttributes.length || fencedItemOpener || row) && item)) {
      out.push(row && !item && !noteOwner && !lists.length && !embeddedListOwner && !opaqueQuoteOwner && definitionIndent < 0 ? quoteForCarve() + text : originalForCarve())
      paragraph = false
      headingMarker = ''
      blank = false
      continue
    }
    if (paragraph && quoteDepth > depth) {
      onLiteralQuote?.(n, depth)
      const markerAt = closedQuoteBoundary(quoteForCarve(), Math.max(0, depth - (noteOwner?.depth ?? 0))).length - 1
      const written = originalForCarve()
      out.push(written.slice(0, markerAt) + '\\' + written.slice(markerAt))
      blank = false
      continue
    }
    if (quoteDepth > depth && !paragraph) {
      lists.length = 0
      setEmbedded(undefined)
      depth = quoteDepth
      quoteBoundary = quoteForCarve().trimEnd()
    } else if (quoteDepth < depth && !paragraph) {
      if (blank) out.push(quoteForCarve().trimEnd())
      while (lists.length && lists.at(-1)!.depth > quoteDepth) lists.pop()
      if (embeddedListOwner && embeddedListOwner.depth > quoteDepth) trimEmbedded(quoteDepth)
      depth = quoteDepth
      quoteBoundary = quoteForCarve().trimEnd()
    }
    if (view.trim() === '' && !(pendingAttributes.length && item)) {
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
        out.push(quoteForCarve() + ' '.repeat(noteOwner && quoteDepth === noteOwner.depth ? noteOwner.target + noteOwner.content : indent) + '\\' + text)
        paragraph = true
        blank = false
      }
      continue
    }
    const rule = (/^(?:[*-][ \t]*){3,}$/.test(visible) && /^(?:[*-][ \t]*){3,}$/.test(text))
    if (item && !rule) {
      const carriedAttributes = pendingAttributes
      pendingAttributes = []
      for (const attribute of carriedAttributes) attribute.output[attribute.row] = /^(?:[ \t]*>(?:[ \t]|$))*[ \t]*/.exec(attribute.output[attribute.row]!)![0].trimEnd()
      const previousList = lists.at(-1)
      const endsNestedList = previousList && indent < previousList.column
      while (lists.length && indent < lists.at(-1)!.column) {
        lists.pop()
        paragraph = false
        headingMarker = ''
      }
      const parent = lists.at(-1)
      const priorKind = parent?.kind
      if (parent && blank && indent === parent.column && endsNestedList && !parent.loose) {
        while (out.length && out.at(-1)!.replace(/>/g, '').trim() === '' && (out.at(-1)!.match(/>/g) ?? []).length <= quoteDepth) out.pop()
        if (!parent.continuation && out[previousList.start - 1]?.replace(/>/g, '').trim() === '') out.splice(previousList.start - 1, 1)
      } else if (parent && blank && indent === parent.column) parent.loose = true
      if (((parent && indent > parent.column) || !parent) && paragraph && !blank) {
        const target = parent?.target !== undefined ? parent.target + parent.content : noteOwner && quoteDepth === noteOwner.depth ? noteOwner.target + noteOwner.content : indent
        const literal = item[1] ? '\\' + text : parent ? text.replace(/[.)]/, '\\$&') : text
        out.push(quoteForCarve() + ' '.repeat(target) + literal)
        if (parent) parent.continuation = true
        blank = false
        continue
      }
      let kind = (item[1] ?? djotListKind(item[2]!)) + (item[1] && item[0].length === 3 && item[0][1] === ' ' && /^\[[ xX]\](?:[ \t]+|$)/.test(text.slice(item[0].length - 1)) ? ':task' : '')
      let context = parent
      const nested = parent && indent > parent.column
      const sharedKind = sharedDjotListKind(priorKind, kind)
      const sameKind = sharedKind !== undefined
      if (parent && !nested && sharedKind !== undefined) { kind = sharedKind; parent.kind = kind }
      if (!parent || nested) {
        context = {
          sourcePrefix,
          depth: quoteDepth,
          column: indent,
          content: compactDjotListPrefix(item[0].slice(0, -1)).length,
          target: nested ? parent.target + parent.content : noteOwner && quoteDepth === noteOwner.depth ? noteOwner.target + noteOwner.content : 0,
          kind,
          bullet: item[1] === '*' ? '*' : '-',
          loose: false,
          start: out.length,
          continuation: false,
        }
        lists.push(context)
      } else if (!sameKind) {
        if (out.at(-1)?.trim() !== '') out.push(quoteForCarve().trimEnd())
        parent.kind = kind
        parent.bullet = parent.bullet === '-' ? '*' : '-'
      }
      if (parent && !nested && parent.loose && parent.continuation && out.at(-1)?.trim() !== '')
        out.push(quoteForCarve().trimEnd())
      const emptyTaskEnd = emptyDjotTaskTailEnd(text, n + 1 === lines.length || lines[n + 1]!.trim() === '')
      const compact = compactDjotListPrefix(emptyTaskEnd !== undefined ? text.slice(0, emptyTaskEnd).trimEnd() + ' +' : emptyItem ? text.trimEnd() + ' +' : text)
      const written = item[1] ? context!.bullet + compact.slice(1) : compact
      context!.continuation = false
      context!.empty = emptyItem
      headingMarker = ''
      const itemOwned = parent && !nested && sameKind
      const attached = carriedAttributes.filter(attribute => itemOwned && attribute.depth === quoteDepth && attribute.owner >= indent)
      const attachedSet = new Set(attached)
      for (const attribute of carriedAttributes) {
        if (!attachedSet.has(attribute)) out.push(quoteForCarve() + ' '.repeat(context!.target) + attribute.attributes)
      }
      if (attached.length && holdItemAttributes) {
        while (out.length && out.at(-1)!.replace(/>/g, '').trim() === '' && (out.at(-1)!.match(/>/g) ?? []).length <= quoteDepth) out.pop()
        const attributes = '{' + attached.map(attribute => attribute.attributes.slice(1, -1)).join(' ') + '}'
        if (context!.loose) out.push(quoteForCarve().trimEnd())
        out.push(quoteForCarve() + ' '.repeat(context!.target) + holdItemAttributes(attributes), quoteForCarve().trimEnd())
      }
      out.push(quoteForCarve() + ' '.repeat(context!.target) + written)
      const body = text.slice(item[0].length - 1)
      const itemHeading = /^(#{1,6})(?:[ \t]+|$)/.exec(body)
      headingMarker = itemHeading?.[1] ?? ''
      const task = item[1] !== undefined && item[0].length === 3 && item[0][1] === ' ' && body.startsWith('[') ? /^\[[ xX]\][ \t]+/.exec(body) : null
      const itemBody = task ? body.slice(task[0].length) : body
      const itemDiv = /^(:{3,})(?:[ \t]+.*)?$/.exec(itemBody)
      if (itemDiv)
        divs.push({
          width: itemDiv[1]!.length,
          prefix: quoteForCarve() + ' '.repeat(context!.target + context!.content),
          itemColumn: context!.column + 1,
          depth: quoteDepth,
          start: lineOffsets[n]!,
        })
      const itemQuote = itemBody.startsWith('>') ? itemQuotePrefix(itemBody) : undefined
      const itemOwners = itemQuote?.owners.map(owner => ({ ...owner, depth: quoteDepth + owner.depth, sourcePrefix: quote.length + rawIndent + item[0].length - 1 + (task?.[0].length ?? 0) + owner.sourceOffset })) ?? []
      setEmbedded(itemOwners.at(-1), itemOwners)
      if (itemQuote?.depth) {
        depth = quoteDepth + (itemQuote.body ? itemQuote.depth : 0)
        quoteBoundary = (quoteForCarve() + ' '.repeat(context!.target + context!.content) + itemQuote.prefix).trimEnd()
      }
      const quoteBody = itemQuote?.body ?? ''
      const itemAttributes = itemBody.startsWith('{') ? readAttributes(itemBody, 0) : undefined
      paragraph = !emptyItem && !row && !rawFencedItem && !itemDiv && !itemHeading && itemAttributes?.end !== itemBody.length && !/^\[(?!\^)[^\]\n]+\]:/.test(itemBody) && !(itemQuote?.depth && (quoteBody === '' || /^\[[^\]\n]*\]:/.test(quoteBody) || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|(?:[*-][ \t]*){3,}$)/.test(quoteBody)))
      blank = !!itemDiv
      continue
    }
    if (div && !paragraph) {
      const parent = lists.at(-1)
      divs.push({
        width: div[1]!.length,
        prefix: quoteForCarve() + ' '.repeat(noteOwner && quoteDepth === noteOwner.depth ? noteOwner.content : indent),
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
    const heldItemAttributes = /^\x00DJOTITEMATTR\x00(?:\d+\x00)?(B?)\d+\x00$/.exec(text)
    if (heldItemAttributes) {
      if (heldItemAttributes[1] && out.at(-1)?.trimEnd() !== quoteForCarve().trimEnd()) out.push(quoteForCarve().trimEnd())
      out.push(originalForCarve())
      paragraph = false
      blank = !!heldItemAttributes[1]
      continue
    }
    const attrs = visible.startsWith('{') ? readAttributes(raw, rawIndent) : undefined
    const attributeLine = attrs?.end === raw.length
    if (attributeLine && !paragraph && !lists.some(list => list.depth === quoteDepth && indent > list.column)) {
      out.push(quoteForCarve() + ' '.repeat(noteOwner && quoteDepth === noteOwner.depth ? noteOwner.content : 0) + attrs!.source)
      paragraph = false
      blank = false
      continue
    }
    if (attributeLine && !paragraph && holdItemAttributes) {
      let owner: typeof lists[number] | undefined
      for (let index = lists.length - 1; index >= 0; index--) {
        const candidate = lists[index]!
        if (candidate.depth === quoteDepth && indent > candidate.column) { owner = candidate; break }
      }
      if (owner && attrs!.source !== '{}') {
        const heldLoose = /\x00DJOTITEMATTR\x00(?:\d+\x00)?B\d+\x00$/.test(out[owner.start - 2] ?? '')
        if (blank && !heldLoose && !out[owner.start]!.includes('{loose}\n')) {
          const start = out[owner.start]!, noteItem = noteOwner ? /^(\[\^[^\]\n]+\]:[ \t]*)(.*)$/.exec(start) : null
          out[owner.start] = noteItem ? `${noteItem[1]}{loose}\n  ${noteItem[2]}` : quoteForCarve() + ' '.repeat(owner.target) + '{loose}\n' + start
          owner.loose = true
        }
        pendingAttributes.push({ owner: owner.column, depth: quoteDepth, row: out.length, output: out, attributes: attrs!.source })
      }
    } else if (visible.trim() !== '' && pendingAttributes.length) {
      let owner: typeof lists[number] | undefined
      for (let index = lists.length - 1; index >= 0; index--) {
        const candidate = lists[index]!
        if (candidate.depth === quoteDepth && indent > candidate.column) { owner = candidate; break }
      }
      const target = owner ? owner.target + owner.content + Math.max(0, indent - owner.column - owner.content) : indent
      for (const attribute of pendingAttributes) attribute.output[attribute.row] = quoteForCarve() + ' '.repeat(target) + attribute.attributes
      pendingAttributes = []
    }
    if (lists.at(-1)?.empty && indent <= lists.at(-1)!.column && visible.trim() !== '' && !attributeLine) {
      if (out.at(-1)?.trim() !== '') out.push(quoteForCarve().trimEnd())
      blank = true
    }
    if (visible.trim() !== '' && !attributeLine) {
      for (const list of lists) if (indent > list.column) list.empty = false
    }
    const outsideColumn = (blank || !paragraph) && !parentContains(lists, indent) && !attributeLine ? lists[0]?.column : undefined
    if (outsideColumn !== undefined) { lists.length = 0; setEmbedded(undefined) }
    const heading = /^(#{1,6})(?:[ \t]+|$)/.exec(visible)
    if (rejectedCommentStartsBlock(visible)) {
      const outsideList = lists.length > 0 && indent <= lists[0]!.column
      if (headingMarker || outsideList) out.push(quoteForCarve() + ' '.repeat(indent))
      if (outsideList) { lists.length = 0; paragraph = false; blank = true }
      headingMarker = ''
    }
    const reference = /^\[[^\]\n]*\]:/.test(visible)
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
      out.push(quoteForCarve() + ' '.repeat(noteOwner && quoteDepth === noteOwner.depth ? noteOwner.target + noteOwner.content : indent) + '\\' + text)
      blank = false
      continue
    }
    if (!paragraph && /^\|`+\|$/.test(text) && !row) {
      while (out[0] === '') out.shift()
      out.push(quoteForCarve() + ' '.repeat(noteOwner && quoteDepth === noteOwner.depth ? noteOwner.target + noteOwner.content : indent) + '\\' + text)
      paragraph = true
      blank = false
      continue
    }
    if (heading) headingMarker = heading[1]!
    if (heading && !lists.length) {
      out.push(
        quoteForCarve() +
          ' '.repeat(noteOwner && quoteDepth === noteOwner.depth ? noteOwner.target + noteOwner.content : 0) +
          heading[1] +
          // Carve whitespace does not include a vertical tab or a form feed, so
          // `String.prototype.trim` would eat heading content (carve-js#2681).
          (trimNonNbsp(text.slice(heading[1]!.length)) ? ' ' + trimStartNonNbsp(text.slice(heading[1]!.length)) : ''),
      )
    } else if (rule && !lists.length && !paragraph) out.push(quoteForCarve() + ' '.repeat(noteOwner && quoteDepth === noteOwner.depth ? noteOwner.target + noteOwner.content : 0) + '***')
    else {
      let embedded: EmbeddedOwner | undefined
      for (const candidate of embeddedOwners) {
        if (candidate.depth > quoteDepth) break
        if (candidate.depth === quoteDepth && ownerColumn(candidate) > candidate.column) { embedded = candidate; break }
      }
      const parent = lists.at(-1)
      if (embedded) out.push(quoteForCarve() + ' '.repeat((embedded.target ?? 0) + embedded.content + Math.max(0, ownerColumn(embedded) - embedded.column - (embedded.sourceContent ?? embedded.content))) + text)
      else if (parent && indent > parent.column)
        out.push(
          quoteForCarve() +
            ' '.repeat(parent.target + parent.content + Math.max(0, indent - parent.column - parent.content)) +
            text,
        )
      else out.push(outsideColumn === undefined || noteOwner ? originalForCarve() : quoteForCarve() + ' '.repeat(Math.max(0, indent - outsideColumn)) + text)
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
    if (blank && !item && !parentContains(lists, indent) && !attributeLine) { lists.length = 0; setEmbedded(undefined) }
    blank = false
  }
  while (notes.length) endNote()
  const newline = out.at(-1) === ''
  if (divs.length && newline) out.pop()
  if (divs.length) dropOrphanAttributeLine(out)
  while (divs.length) {
    const div = divs.pop()!
    if (!div.prefix.includes('>')) out.push(div.prefix + ':'.repeat(div.width))
  }
  if (newline && out.at(-1) !== '') out.push('')
  const rendered: string[] = []
  const placedNotes = new Map<number, string[][]>()
  const appendNote = (body: string[]): void => {
    for (const line of body) rendered.push(line)
    if (rendered.at(-1) !== '') rendered.push('')
  }
  for (const { body, placement } of completedNotes) {
    if (placement === undefined) appendNote(body)
    else {
      const held = placedNotes.get(placement) ?? []
      held.push(body)
      placedNotes.set(placement, held)
    }
  }
  for (let i = 0; i <= out.length; i++) {
    for (const body of placedNotes.get(i) ?? []) appendNote(body)
    if (i < out.length) rendered.push(out[i]!)
  }
  if (!source.endsWith('\n') && rendered.at(-1) === '') rendered.pop()
  return rendered.join('\n')
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
export function djotInlineLayout(source: string, preserveQuote?: (at: number) => boolean): string {
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
  const output: string[] = []
  let escaped = false
  for (let i = 0; i < source.length; i++) {
    escaped = source[i - 1] === '\\' ? !escaped : false
    const commentEnd = comments.get(i)
    if (commentEnd !== undefined && source[commentEnd - 2] !== '%' && source.slice(i + 2, commentEnd).includes('{')) {
      output.push('{%%}')
      i = commentEnd - 1
      continue
    }
    if (mask[i] !== source[i] || escaped) {
      output.push(source[i]!)
      continue
    }
    if (source[i] === '<') {
      const angle = /^<([^<>\s]+)>/.exec(source.slice(i))
      if (angle && /[^:]@|[A-Za-z]:/.test(angle[1]!)) {
        output.push(angle[0])
        i += angle[0].length - 1
        continue
      }
    }
    if (source[i] === '{') {
      const attrs = readAttributes(source, i)
      if (attrs) {
        output.push(source.slice(i, attrs.end))
        i = attrs.end - 1
        continue
      }
    }
    if (source.startsWith('{}', i)) {
      if (mask[i - 1] === ']' && !isDjotEscaped(source, i - 1)) {
        // Empty attributes turn bracketed text into a span.
        output.push('{}')
        i++
        continue
      }
      let end = i + 2
      while (source.startsWith('{}', end)) end += 2
      if (/[_*]/.test(source[i - 1] ?? '') && source[i - 1] === source[end]) {
        // Keep the boundary until emphasis pairing can write separate forced spans.
        output.push(source.slice(i, end))
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
    if (quote && !preserveQuote?.(i)) {
      output.push(quote)
      i++
      continue
    }
    if (source[i] === '\\' && (output.at(-1) === ' ' || output.at(-1) === '\t') && /^[ \t]*\n/.test(source.slice(i + 1)) && !/^[ \t>]*:{3,}[ \t]+$/.test(source.slice(source.lastIndexOf('\n', i - 1) + 1, i))) {
      while (output.at(-1) === ' ' || output.at(-1) === '\t') {
        let slashes = 0
        for (let at = output.length - 2; at >= 0 && output[at] === '\\'; at--) slashes++
        if (slashes % 2) break
        output.pop()
      }
      output.push('\\')
      while (/[ \t]/.test(source[i + 1] ?? '')) i++
      continue
    }
    output.push(source[i]!)
  }
  return output.join('')
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

function indentColumnsAfterQuotes(line: string, depth: number, bases: number[]): number[] {
  let at = 0
  const columns: number[] = []
  for (let level = 0; level <= depth; level++) {
    const start = at
    bases.push(start)
    while (line[at] === ' ' || line[at] === '\t') at++
    columns.push(at - start)
    if (level < depth) {
      at++
      if (line[at] === ' ' || line[at] === '\t') at++
    }
  }
  return columns
}

function itemQuotePrefix(body: string): { depth: number; prefix: string; body: string; owner?: { depth: number; column: number; content: number; sourceOffset: number; sourceContent: number; target: number }; owners: Array<{ depth: number; column: number; content: number; sourceOffset: number; sourceContent: number; target: number }> } {
  let rest = body, depth = 0, prefix = ''
  const owners: Array<{ depth: number; column: number; content: number; sourceOffset: number; sourceContent: number; target: number }> = []
  let owner: typeof owners[number] | undefined
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
    owner = { depth, column: Math.max(0, quote[0].length - end - 1), content: compactDjotListPrefix(item[1]!).length, sourceOffset: body.length - rest.length - Math.max(0, quote[0].length - end - 1), sourceContent: item[1]!.length, target: Math.max(0, quote[0].length - end - 1) }
    owners.push(owner)
    if (!/^>(?:[ \t]|$)/.test(rest.slice(item[0].length))) break
    prefix += ' '.repeat(compactDjotListPrefix(item[1]!).length)
    rest = rest.slice(item[0].length)
  }
  return { depth, prefix, body: rest, owners, ...(owner ? { owner } : {}) }
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
  return (source.includes('`') && /(?:^|\n)[ \t]*:(?:[ \t]|$)/.test(source)) || source.includes('\\|') || (source.includes('`') && /(?:^|\n)(?:[ \t]*>(?:[ \t]|$))*[ \t]*\[\^[^\]\n]+\]:/.test(source)) || (source.includes('`') && /(?:^|\n)[ \t]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]+)[.)]|\((?:[0-9]+|[A-Za-z]+)\))[ \t]+(?:\[[ xX]\][ \t]+)?|\[\^[^\]\n]+\]:[ \t]*)*>/.test(source)) ||
    (source.includes('```') && /(?:^|\n)(?:[ \t]*>(?:[ \t]|$))*[ \t]+`{3,}/.test(source))
}
