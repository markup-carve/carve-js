import { isDjotEscaped, maskDjotCodeAndDestinations, maskDjotFences, djotInlineBoundaries } from '../../djot-migrate.js'
import { trimNonNbsp, trimStartNonNbsp } from '../../trim-non-nbsp.js'
import { readAttributes } from './djot-word-attributes.js'
import { rejectedCommentStartsBlock } from './djot-attributes.js'
import { continuesParagraph } from './djot-attributes.js'
import { djotTableRows } from '../../djot-migrate.js'
import { backtickRunEnds } from '../../parse/inline/backtick-run-index.js'

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

function quoteOpeningColumn(prefix: string, previousDepth: number, depth: number): number {
  if (depth <= previousDepth) return 0
  let end = 0
  for (let level = 0; level < previousDepth; level++) end += /^[ \t]*>(?:[ \t]|$)/.exec(prefix.slice(end))![0].length
  return /^[ \t]*/.exec(prefix.slice(end))![0].length
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
    const openingColumn = quoteOpeningColumn(prefix, previousDepth, depth)
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

type DivFrame = {
  width: number
  prefix: string
  itemColumn?: number
  depth: number
  start: number
}

type ListFrame = {
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
}

type EmbeddedOwner = { depth: number; column: number; content: number; sourcePrefix?: number; sourceContent?: number; target?: number }
type OpaqueQuoteOwner = { depth: number; column: number; content: number }
type PendingAttribute = { owner: number; depth: number; row: number; output: string[]; attributes: string }
type NoteOwner = { depth: number; column: number; target: number; content: number; listBase: number; parentOut: string[]; parentLists: ListFrame[]; parentDivs: DivFrame[]; parentDepth: number; parentBoundary: string; parentEmbedded: EmbeddedOwner | undefined; parentEmbeddedOwners: EmbeddedOwner[]; parentOpaque: OpaqueQuoteOwner | undefined; parentDefinition: number; placement: number | undefined; fenceColumn?: number }

/** Inputs that stay fixed while one document is laid out. */
interface LayoutInput {
  source: string
  lines: string[]
  mask: string[]
  fences: string[]
  lineOffsets: number[]
  rows: readonly boolean[]
  divClosers: Map<number, number[]>
  hasDefinitionSyntax: boolean
  isBoundary: (line: string) => boolean
  noteSourceWidths: ReadonlyMap<string, number>
  emptyNote: string
  holdItemAttributes: ((attributes: string, block?: boolean) => string) | undefined
  onLiteralQuote: ((line: number, depth: number) => void) | undefined
}

/** Container state carried from one source line to the next. */
interface LayoutState {
  out: string[]
  lists: ListFrame[]
  divs: DivFrame[]
  returnedNoteItemAttributes: string[]
  returnedNoteDestinationDepth: number | undefined
  pendingAttributes: PendingAttribute[]
  paragraph: boolean
  blank: boolean
  depth: number
  embeddedListOwner: EmbeddedOwner | undefined
  embeddedOwners: EmbeddedOwner[]
  noteOwner: NoteOwner | undefined
  notes: NoteOwner[]
  completedNotes: { body: string[]; placement: number | undefined; fenceColumn?: number }[]
  opaqueQuoteOwner: OpaqueQuoteOwner | undefined
  quoteBoundary: string
  headingMarker: string
  definitionIndent: number
  definitionStack: number[]
}

/** One source line split into its quote prefix and content. */
interface LayoutLine {
  n: number
  original: string
  masked: string
  physicalQuote: string
  physicalQuoteDepth: number
  quotedNoteItem: RegExpExecArray | null
  quote: string
  quoteDepth: number
  nativeRemainder: string
  raw: string
  view: string
  rawIndent: number
  sourcePrefix: number
  indent: number
  text: string
  visible: string
  quoteBases: number[]
  quoteColumns: number[]
  inlineNoteItem: RegExpExecArray | null
  noteHead: RegExpExecArray | null
}

/** How the content of a non-blank line opens or continues a block. */
interface BlockLine {
  row: boolean
  rawFencedItem: boolean
  rawReferenceItem: boolean
  fencedItemOpener: boolean
  wholeAttributes: boolean
  blockStart: boolean | undefined
  emptyItem: boolean
  item: RegExpExecArray | null
}

function setEmbedded(s: LayoutState, owner: EmbeddedOwner | undefined, owners?: EmbeddedOwner[]): void {
  s.embeddedListOwner = owner
  s.embeddedOwners = owners ?? (owner ? [owner] : [])
}

function trimEmbedded(s: LayoutState, maximumDepth: number): void {
  while (s.embeddedOwners.at(-1) && s.embeddedOwners.at(-1)!.depth > maximumDepth) s.embeddedOwners.pop()
  s.embeddedListOwner = s.embeddedOwners.at(-1)
}

/** Open a note body: later lines write into a fresh output until the note ends. */
function enterNote(s: LayoutState, depth: number, column: number, placement: number | undefined): NoteOwner {
  const owner: NoteOwner = { depth, column, target: 0, content: 2, listBase: 0, parentOut: s.out, parentLists: s.lists, parentDivs: s.divs, parentDepth: s.depth, parentBoundary: s.quoteBoundary, parentEmbedded: s.embeddedListOwner, parentEmbeddedOwners: s.embeddedOwners, parentOpaque: s.opaqueQuoteOwner, parentDefinition: s.definitionIndent, placement }
  s.noteOwner = owner
  s.notes.push(owner)
  s.out = []
  s.lists = []
  s.divs = []
  setEmbedded(s, undefined)
  s.opaqueQuoteOwner = undefined
  s.definitionIndent = -1
  return owner
}

function endNote(s: LayoutState): void {
  const ended = s.notes.pop()!
  for (const attribute of s.pendingAttributes) { attribute.output[attribute.row] = ''; s.returnedNoteItemAttributes.push(attribute.attributes) }
  s.pendingAttributes = []
  if (s.returnedNoteItemAttributes.length) s.returnedNoteDestinationDepth = Math.min(s.returnedNoteDestinationDepth ?? ended.depth, ended.depth)
  if (s.divs.length) dropOrphanAttributeLine(s.out)
  while (s.divs.length) {
    const div = s.divs.pop()!
    if (!div.prefix.includes('>')) s.out.push(div.prefix + ':'.repeat(div.width))
  }
  s.completedNotes.push({ body: s.out, placement: ended.placement })
  s.out = ended.parentOut
  s.lists = ended.parentLists
  s.divs = ended.parentDivs
  s.depth = ended.parentDepth
  s.quoteBoundary = ended.parentBoundary
  setEmbedded(s, ended.parentEmbedded, ended.parentEmbeddedOwners)
  s.opaqueQuoteOwner = ended.parentOpaque
  s.definitionIndent = ended.parentDefinition
  s.noteOwner = s.notes.at(-1)
  s.paragraph = false
  s.headingMarker = ''
}

function readLayoutLine(I: LayoutInput, s: LayoutState, n: number): LayoutLine {
  const { lines, mask, fences } = I
  const original = lines[n]!,
    masked = mask[n]!
  const physicalQuote = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(original)![0]
  const physicalQuoteDepth = (physicalQuote.match(/>/g) ?? []).length
  const quotedNoteItem: RegExpExecArray | null = !s.noteOwner && (s.blank || !s.paragraph || physicalQuoteDepth < s.depth || s.lists.at(-1)?.depth === physicalQuoteDepth && /^[ \t]*/.exec(original.slice(physicalQuote.length))![0].length <= s.lists.at(-1)!.column) && fences[n] === original ? /^([ \t]*)((?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)(>[ \t](?:[ \t]*>[ \t])*)[ \t]*(?=\[\^[^\]\n]+\]:(?:[ \t]|$))/.exec(original.slice(physicalQuote.length)) : null
  const quote: string = quotedNoteItem ? physicalQuote + quotedNoteItem[1] + quotedNoteItem[2] + quotedNoteItem[3] : physicalQuote
  const quoteDepth: number = (quote.match(/>/g) ?? []).length
  const raw = original.slice(quote.length),
    view = masked.slice(quote.length)
  const rawIndent = /^[ \t]*/.exec(raw)![0].length
  const sourcePrefix = !quotedNoteItem && s.lists.at(-1)?.depth === quoteDepth ? s.lists.at(-1)!.sourcePrefix : quote.length
  const indent = Math.max(0, rawIndent + quote.length - sourcePrefix)
  const text = raw.slice(rawIndent),
    visible = view.slice(rawIndent)
  const quoteBases: number[] = []
  const quoteView = quotedNoteItem ? original.slice(0, physicalQuote.length + quotedNoteItem[1]!.length) + ' '.repeat(quotedNoteItem[2]!.length) + original.slice(physicalQuote.length + quotedNoteItem[1]!.length + quotedNoteItem[2]!.length) : original
  const quoteColumns = quoteDepth > 0 ? indentColumnsAfterQuotes(quoteView, quoteDepth, quoteBases) : []
  const inlineNoteItem = (s.blank || !s.paragraph || quoteDepth < s.depth || s.lists.at(-1)?.depth === quoteDepth && indent <= s.lists.at(-1)!.column) ? /^((?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)(?=\[\^[^\]\n]+\]:(?:[ \t]|$))/.exec(visible) : null
  const noteText = inlineNoteItem ? text.slice(inlineNoteItem[0].length) : text
  const noteHead = (inlineNoteItem || visible.startsWith('[^')) ? /^(\[\^[^\]\n]+\]:[ \t]*)(.*)$/.exec(noteText) : null
  return { n, original, masked, physicalQuote, physicalQuoteDepth, quotedNoteItem, quote, quoteDepth, nativeRemainder: original.slice(quote.length), raw, view, rawIndent, sourcePrefix, indent, text, visible, quoteBases, quoteColumns, inlineNoteItem, noteHead }
}

function ownerColumn(L: LayoutLine, owner: { depth: number; sourcePrefix?: number }): number {
  const { quote, quoteDepth, quoteColumns, quoteBases, rawIndent, indent } = L
  return quoteDepth > owner.depth ? (quoteColumns[owner.depth] ?? rawIndent) + (owner.sourcePrefix === undefined ? 0 : (quoteBases[owner.depth] ?? 0) - owner.sourcePrefix) : owner.sourcePrefix === undefined ? indent : quote.length + rawIndent - owner.sourcePrefix
}

/** The quote prefix Carve needs for this line, aligned to the list items that own each level. */
function quoteForCarve(I: LayoutInput, s: LayoutState, L: LayoutLine): string {
  const { hasDefinitionSyntax, fences } = I
  const { n, original, masked, quote, quoteDepth, quoteColumns } = L
  const baseDepth = s.noteOwner?.depth ?? 0
  const retainedQuote = baseDepth ? quote.slice(closedQuoteBoundary(quote, baseDepth - 1).length).replace(/^[ \t]/, '') : quote
  if (!quoteDepth || s.definitionIndent >= 0 || hasDefinitionSyntax || fences[n] !== original || masked[quote.indexOf('>')] !== '>') return baseDepth ? retainedQuote : quote
  const owner = s.lists.at(-1)
  const contexts: { depth: number; column: number; content: number; target: number; sourcePrefix?: number }[] = []
  if (owner) contexts.push(owner)
  for (const candidate of s.embeddedOwners) {
    if (candidate.depth >= quoteDepth) break
    contexts.push({ ...candidate, target: candidate.target ?? 0 })
  }
  if (s.noteOwner) contexts.push(s.noteOwner)
  if (s.opaqueQuoteOwner) contexts.push({ ...s.opaqueQuoteOwner, target: s.opaqueQuoteOwner.column })
  const firstOwned = Math.min(...contexts.map(value => value!.depth))
  const lastOwned = Math.max(...contexts.map(value => value!.depth))
  const byDepth = new Map<number, typeof contexts[number]>()
  for (const candidate of contexts) if (ownerColumn(L, candidate) > candidate.column && (!byDepth.has(candidate.depth) || candidate.column >= byDepth.get(candidate.depth)!.column)) byDepth.set(candidate.depth, candidate)
  const parts: string[] = []
  for (let level = baseDepth; level < quoteDepth; level++) {
    const held = byDepth.get(level)
    const column = held ? held.target + held.content : level > firstOwned && level < lastOwned ? (quoteColumns[level] ?? 0) : 0
    parts.push(' '.repeat(column), '>')
    if (level + 1 < quoteDepth || !quote.endsWith('>')) parts.push(' ')
  }
  return parts.join('')
}

function originalForCarve(I: LayoutInput, s: LayoutState, L: LayoutLine): string {
  const { fences } = I
  const { n, original, quoteDepth, indent, text, noteHead } = L
  const ownedList = s.lists.at(-1)
  const noteColumn = ownedList && ownedList.depth === quoteDepth && indent > ownedList.column ? ownedList.target + ownedList.content : s.noteOwner?.content ?? 0
  return quoteForCarve(I, s, L) + (s.noteOwner && text !== '' && quoteDepth === s.noteOwner.depth && !noteHead ? fences[n] === original ? ' '.repeat(noteColumn) + text : L.nativeRemainder.slice(Math.min(indent, s.noteOwner.column)) : L.nativeRemainder)
}

/** End notes this line falls outside of, and write fenced lines a note still owns. */
function writeNoteContinuation(I: LayoutInput, s: LayoutState, L: LayoutLine): boolean {
  const { fences, isBoundary } = I
  const { n, original, quoteDepth, quoteColumns, indent, text, visible, noteHead } = L
  while (s.noteOwner && fences[n] === original && (text || quoteDepth > s.noteOwner.depth)) {
    const column = quoteDepth > s.noteOwner.depth ? quoteColumns[s.noteOwner.depth] ?? 0 : indent
    const outside = quoteDepth < s.noteOwner.depth || column <= s.noteOwner.column
    const block = isBoundary(original) || noteHead || quoteDepth > s.noteOwner.depth || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[|]|[`~]{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]|\[[^\]\n]+\]:)/.test(visible) || (visible.startsWith('{') && readAttributes(visible, 0)?.end === visible.length)
    if (outside && !(s.paragraph && !s.blank && !block && quoteDepth <= s.noteOwner.depth)) {
      endNote(s)
    } else break
  }
  if (s.noteOwner && fences[n] !== original) {
    const host = s.noteOwner.depth ? closedQuoteBoundary(original, s.noteOwner.depth - 1).length : 0
    const payload = original.slice(host).replace(s.noteOwner.depth ? /^[ \t]/ : /$^/, '')
    const payloadIndent = /^[ \t]*/.exec(payload)![0].length
    if (s.noteOwner.fenceColumn === undefined && payloadIndent <= s.noteOwner.column && /^(`{3,}|~{3,})/.test(payload.slice(payloadIndent))) {
      while (s.noteOwner && payloadIndent <= s.noteOwner.column) endNote(s)
    }
    if (s.noteOwner) {
      s.noteOwner.fenceColumn ??= payloadIndent
      if (s.returnedNoteItemAttributes.length) {
        const prefix = ' '.repeat(s.noteOwner.content)
        for (const attributes of s.returnedNoteItemAttributes) s.out.push(prefix + attributes)
        s.returnedNoteItemAttributes.length = 0
        s.returnedNoteDestinationDepth = undefined
      }
      s.out.push(' '.repeat(s.noteOwner.content) + payload.slice(Math.min(payloadIndent, s.noteOwner.fenceColumn)))
      s.paragraph = false
      s.headingMarker = ''
      s.blank = false
      return true
    }
  } else if (s.noteOwner) delete s.noteOwner.fenceColumn
  return false
}

/** Close quote and embedded list owners that this line no longer belongs to. */
function releaseLineOwners(I: LayoutInput, s: LayoutState, L: LayoutLine): void {
  const { fences, emptyNote } = I
  const { n, original, quoteDepth, quoteColumns, indent, text, visible } = L
  if (/^\[(?!\^)[^\]\n]*\]:/.test(text) && s.out.at(-1)?.includes(emptyNote)) s.out.push(quoteForCarve(I, s, L) + ' '.repeat(Math.max(0, indent)))
  if (s.opaqueQuoteOwner && text && (quoteDepth < s.opaqueQuoteOwner.depth || (quoteDepth === s.opaqueQuoteOwner.depth ? indent : quoteColumns[s.opaqueQuoteOwner.depth] ?? 0) < s.opaqueQuoteOwner.column + 1)) s.opaqueQuoteOwner = undefined
  const embeddedParent = s.lists.at(-1)
  if (text && fences[n] === original && s.embeddedOwners.length && embeddedParent && quoteDepth > embeddedParent.depth && ownerColumn(L, embeddedParent) <= embeddedParent.column) {
    if (s.paragraph && !s.blank) s.out.push(closedQuoteBoundary(s.quoteBoundary, Math.max(0, embeddedParent.depth - (s.noteOwner?.depth ?? 0))))
    setEmbedded(s, undefined)
    s.paragraph = false
    s.headingMarker = ''
  }
  if (text && fences[n] === original && s.embeddedOwners.length) {
    const startsBlock = /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[|]|[`~]{3,}|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]|\[[^\]\n]+\]:)/.test(visible)
    for (let i = 0; i < s.embeddedOwners.length; i++) {
      const owner = s.embeddedOwners[i]!
      const outside = quoteDepth < owner.depth || ownerColumn(L, owner) <= owner.column
      if (outside && (s.blank || !s.paragraph || quoteDepth > owner.depth || startsBlock)) {
        const siblingItem = quoteDepth === owner.depth && /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.test(visible)
        if (s.paragraph && !s.blank) s.out.push(closedQuoteBoundary(s.quoteBoundary, Math.max(0, owner.depth - (s.noteOwner?.depth ?? 0) - 1 + (siblingItem ? 1 : 0))))
        s.embeddedOwners = s.embeddedOwners.slice(0, i)
        s.embeddedListOwner = s.embeddedOwners.at(-1)
        s.paragraph = false
        s.headingMarker = ''
        break
      }
      if (owner.depth >= quoteDepth && !s.blank && s.paragraph && !startsBlock) break
    }
  }
}

function quoteItemPlacement(s: LayoutState, L: LayoutLine): { blockIndent: number; outsideQuoteItem: boolean | undefined } {
  const { quoteDepth, quoteColumns, indent } = L
  const blockIndent = quoteDepth > s.depth ? (quoteColumns[s.depth] ?? indent) : indent
  const ordinaryQuoteList = s.lists.at(-1)
  const quoteList = s.embeddedListOwner && s.embeddedListOwner.depth < quoteDepth && (!ordinaryQuoteList || s.embeddedListOwner.depth > ordinaryQuoteList.depth) ? s.embeddedListOwner : ordinaryQuoteList
  const outsideQuoteItem = quoteList && quoteDepth > quoteList.depth && ownerColumn(L, quoteList) < quoteList.column + 1
  return { blockIndent, outsideQuoteItem }
}

function flushReturnedNoteAttributes(I: LayoutInput, s: LayoutState, L: LayoutLine): void {
  const { quoteDepth } = L
  if (s.returnedNoteItemAttributes.length) {
    const retainedDepth = Math.max(0, Math.min(s.returnedNoteDestinationDepth ?? 0, quoteDepth) - (s.noteOwner?.depth ?? 0))
    const prefix = retainedDepth ? closedQuoteBoundary(quoteForCarve(I, s, L), retainedDepth - 1) + ' ' : ' '.repeat(s.noteOwner?.content ?? 0)
    for (const attributes of s.returnedNoteItemAttributes) s.out.push(prefix + attributes)
    s.returnedNoteItemAttributes.length = 0
    s.returnedNoteDestinationDepth = undefined
  }
}

function openNote(I: LayoutInput, s: LayoutState, L: LayoutLine, noteHead: RegExpExecArray): void {
  const { emptyNote } = I
  const { physicalQuote, physicalQuoteDepth, quotedNoteItem, quote, quoteDepth, indent, rawIndent, inlineNoteItem } = L
  for (const attribute of s.pendingAttributes) attribute.output[attribute.row] = ''
  s.pendingAttributes = []
  if (!s.noteOwner && (quotedNoteItem || inlineNoteItem) && physicalQuoteDepth < s.depth) {
    s.out.push(s.quoteBoundary)
    s.depth = physicalQuoteDepth
    s.quoteBoundary = physicalQuote.trimEnd()
  }
  if (quotedNoteItem) {
    const marker = quotedNoteItem[2]!
    const column = quotedNoteItem[1]!.length
    const context = { sourcePrefix: physicalQuote.length, depth: physicalQuoteDepth, column, content: compactDjotListPrefix(marker).length, target: column, kind: djotListKind(marker.trim()), bullet: marker[0] === '*' ? '*' : '-', loose: false, start: s.out.length, continuation: false }
    s.lists.push(context)
    s.out.push(physicalQuote + quotedNoteItem[1] + compactDjotListPrefix(marker) + quotedNoteItem[3] + emptyNote)
    s.depth = quoteDepth
    s.quoteBoundary = (physicalQuote + ' '.repeat(context.target + context.content) + quotedNoteItem[3]).trimEnd()
  }
  if (inlineNoteItem) {
    const parent = s.lists.at(-1)
    const target = parent && parent.depth === quoteDepth && parent.column === indent ? parent.target : rawIndent
    s.out.push(quoteForCarve(I, s, L) + ' '.repeat(target) + compactDjotListPrefix(inlineNoteItem[0]) + emptyNote)
  }
  const noteIndent = indent + (inlineNoteItem?.[0].length ?? 0)
  while (s.lists.length && (s.lists.at(-1)!.depth > quoteDepth || (s.lists.at(-1)!.depth === quoteDepth && (indent < s.lists.at(-1)!.column || !inlineNoteItem && indent === s.lists.at(-1)!.column)))) s.lists.pop()
  if (!inlineNoteItem && !quotedNoteItem && (quoteDepth > 0 || (!s.lists.length && s.out.length && s.out.at(-1)?.trim() !== ''))) s.out.push(quoteForCarve(I, s, L).trimEnd())
  enterNote(s, quoteDepth, noteIndent, !s.noteOwner && quoteDepth === 0 && noteIndent === 0 && !s.lists.length ? s.out.length : undefined)
  writeNoteHead(I, s, L, noteHead, quote.length + rawIndent + (inlineNoteItem?.[0].length ?? 0))
}

/** Write a note's first line, opening a nested note when its first item starts one. */
function writeNoteHead(I: LayoutInput, s: LayoutState, L: LayoutLine, noteHead: RegExpExecArray, noteBodySourceAt: number): void {
  const { lines, lineOffsets, rows, noteSourceWidths, emptyNote } = I
  const { n, quote, quoteDepth } = L
  let noteOwner = s.noteOwner!
  let currentNoteHead = noteHead
  let nestedFirstBody = false
  while (true) {
  const body = currentNoteHead[2]!
  const child = /^((?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)(?=[^ \t])/.exec(body)
  let childBody = body
  if (child) {
    s.lists.push({ sourcePrefix: quote.length, depth: quoteDepth, column: noteOwner.column + (noteSourceWidths.get(/^\[\^([^\]]+)\]/.exec(currentNoteHead[1]!)![1]!) ?? currentNoteHead[1]!.length), content: compactDjotListPrefix(child[1]!).length, target: noteOwner.target + 2, kind: djotListKind(child[1]!.trim()) + (/^[-*+] $/.test(child[1]!) && /^\[[ xX]\](?:[ \t]+|$)/.test(body.slice(child[1]!.length)) ? ':task' : ''), bullet: child[1]![0] === '*' ? '*' : '-', loose: false, start: s.out.length, continuation: false })
    childBody = body.slice(child[1]!.length)
    if (/^[-*+] $/.test(child[1]!)) childBody = childBody.replace(/^\[[ xX]\](?:[ \t]+|$)/, '')
  }
  const nestedHead = child ? /^(\[\^[^\]\n]+\]:[ \t]*)(.+)$/.exec(childBody) : null
  if (!nestedFirstBody && nestedHead) {
    s.out.push(currentNoteHead[1] + compactDjotListPrefix(child![1]!) + emptyNote)
    noteOwner = enterNote(s, quoteDepth, s.lists.at(-1)!.column + child![1]!.length, undefined)
    noteBodySourceAt += (noteSourceWidths.get(/^\[\^([^\]]+)\]/.exec(currentNoteHead[1]!)![1]!) ?? currentNoteHead[1]!.length) + child![1]!.length
    currentNoteHead = nestedHead
    nestedFirstBody = true
    continue
  }
  if (/^(`{3,}|~{3,})[ \t]*[a-zA-Z0-9_+#.-]*$/.test(childBody)) noteOwner.fenceColumn = noteOwner.column + noteOwner.content
  const inlineQuote = itemQuotePrefix(childBody)
  const noteBodyStart = noteBodySourceAt + (noteSourceWidths.get(/^\[\^([^\]]+)\]/.exec(currentNoteHead[1]!)![1]!) ?? currentNoteHead[1]!.length) + body.length - childBody.length
  const inlineOwners = inlineQuote.owners.map(owner => ({ ...owner, depth: quoteDepth + owner.depth, sourcePrefix: noteBodyStart + owner.sourceOffset }))
  setEmbedded(s, inlineOwners.at(-1), inlineOwners)
  s.depth = quoteDepth + inlineQuote.depth
  const context = child ? s.lists.at(-1)! : noteOwner
  s.quoteBoundary = (quoteForCarve(I, s, L) + ' '.repeat(context.target + context.content) + inlineQuote.prefix).trimEnd()
  const emptyTaskEnd = emptyDjotTaskTailEnd(body, n + 1 === lines.length || lines[n + 1]!.trim() === '')
  let writtenBody = compactDjotListPrefix(emptyTaskEnd === undefined ? body : body.slice(0, emptyTaskEnd).trimEnd() + ' +', emptyTaskEnd !== undefined)
  if (emptyTaskEnd !== undefined && body.startsWith('* ')) {
    writtenBody = '*' + writtenBody.slice(1)
    s.out.push(currentNoteHead[1] + emptyNote + '\n  ' + writtenBody)
  } else s.out.push(currentNoteHead[1] + writtenBody)
  const content = inlineQuote.body
  const inlineDiv = /^(:{3,})(?:[ \t]+.*)?$/.exec(content)
  if (inlineDiv) s.divs.push({ width: inlineDiv[1]!.length, prefix: ' '.repeat(context.target + context.content) + inlineQuote.prefix, depth: s.depth, start: lineOffsets[n]!, ...(child ? { itemColumn: context.column + 1 } : {}) })
  s.paragraph = !rows[n] && content !== '' && !content.startsWith(emptyNote) && !/^(?:#{1,6}(?:[ \t]|$)|:{3,}|\[[^\]\n]*\]:|(?:[*-][ \t]*){3,}$)/.test(content) && !/^(`{3,}|~{3,})[ \t]*[a-zA-Z0-9_+#.-]*$/.test(content)
  s.headingMarker = /^(#{1,6})(?:[ \t]|$)/.exec(content)?.[1] ?? ''
  s.blank = !s.paragraph
  break
  }
}

function writeBlankLine(I: LayoutInput, s: LayoutState, L: LayoutLine, outsideQuoteItem: boolean | undefined): void {
  const { onLiteralQuote } = I
  const { n, quoteDepth } = L
  while (s.lists.length && s.lists.at(-1)!.depth > quoteDepth) s.lists.pop()
  if (s.embeddedListOwner && s.embeddedListOwner.depth > quoteDepth) trimEmbedded(s, quoteDepth)
  if (outsideQuoteItem) {
    while (s.lists.length && quoteDepth > s.lists.at(-1)!.depth && ownerColumn(L, s.lists.at(-1)!) < s.lists.at(-1)!.column + 1) s.lists.pop()
    if (s.embeddedListOwner && quoteDepth > s.embeddedListOwner.depth && ownerColumn(L, s.embeddedListOwner) < s.embeddedListOwner.column + 1) setEmbedded(s, undefined)
    s.depth = quoteDepth
    s.quoteBoundary = quoteForCarve(I, s, L).trimEnd()
  }
  if (s.paragraph && quoteDepth > s.depth && !outsideQuoteItem) {
    onLiteralQuote?.(n, s.depth)
    const markerAt = closedQuoteBoundary(quoteForCarve(I, s, L), Math.max(0, s.depth - (s.noteOwner?.depth ?? 0))).length - 1
    const written = originalForCarve(I, s, L)
    s.out.push(written.slice(0, markerAt) + '\\' + written.slice(markerAt))
    s.blank = false
    return
  }
  s.out.push(originalForCarve(I, s, L))
  s.paragraph = false
  s.headingMarker = ''
  s.blank = true
}

/** Lines inside a definition body are copied with their quote prefix rewritten. */
function writeDefinitionLine(I: LayoutInput, s: LayoutState, L: LayoutLine): boolean {
  const { lineOffsets, divClosers } = I
  const { n, quoteDepth, indent, visible } = L
  if (s.definitionIndent >= 0 && quoteDepth < s.depth && /^(?:[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t]|:(?:[ \t]|$))/.test(visible)) {
    s.definitionStack.length = 0
    s.definitionIndent = -1
    s.paragraph = false
    s.blank = true
    s.depth = quoteDepth
  }
  if ((s.definitionStack.at(-1) ?? -1) !== s.definitionIndent) {
    s.definitionStack.length = 0
    if (s.definitionIndent >= 0) s.definitionStack.push(s.definitionIndent)
  }
  if (/^:(?:[ \t]|$)/.test(visible) && (s.blank || s.definitionIndent >= 0) && (s.blank || indent <= s.definitionIndent)) {
    while (s.definitionStack.length && s.definitionStack.at(-1)! >= indent) s.definitionStack.pop()
    s.definitionStack.push(indent)
    s.definitionIndent = indent
  } else if (s.definitionIndent >= 0 && s.blank && indent <= s.definitionIndent) {
    while (s.definitionStack.length && s.definitionStack.at(-1)! >= indent) s.definitionStack.pop()
    s.definitionIndent = s.definitionStack.at(-1) ?? -1
  }
  if (s.definitionIndent >= 0 && indent <= s.definitionIndent && rejectedCommentStartsBlock(visible)) {
    s.out.push(quoteForCarve(I, s, L) + ' '.repeat(indent))
    s.definitionIndent = -1
    s.paragraph = false
    s.blank = true
  }
  if (s.definitionIndent >= 0 && indent <= s.definitionIndent && divClosers.has(lineOffsets[n]!)) {
    s.definitionStack.length = 0
    s.definitionIndent = -1
    s.paragraph = false
    s.blank = true
  }
  if (s.definitionIndent >= 0) {
    s.out.push(originalForCarve(I, s, L))
    s.depth = Math.max(s.depth, quoteDepth)
    s.quoteBoundary = quoteForCarve(I, s, L).trimEnd()
    s.headingMarker = ''
    s.paragraph = true
    s.blank = false
    return true
  }
  return false
}

function blockShape(I: LayoutInput, s: LayoutState, L: LayoutLine): Pick<BlockLine, 'row' | 'rawFencedItem' | 'rawReferenceItem' | 'fencedItemOpener' | 'wholeAttributes'> {
  const { rows } = I
  const { n, quoteDepth, indent, raw, rawIndent, text, visible } = L
  const row: boolean = (rows[n] ?? false) && !(s.noteOwner && s.paragraph && quoteDepth >= s.depth && !(s.lists.at(-1) && indent <= s.lists.at(-1)!.column))
  const rawFencedItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+(?:\[[ xX]\][ \t]+)?(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*$/.test(text)
  const rawReferenceItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+\[(?!\^)[^\]\n]+\]:/.test(text)
  const fencedItemOpener = rawFencedItem && /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.test(visible)
  const wholeAttributes = visible.startsWith('{') && readAttributes(raw, rawIndent)?.end === raw.length
  return { row, rawFencedItem, rawReferenceItem, fencedItemOpener, wholeAttributes }
}

/** Place attribute lines held for a list item once the next line shows they belong elsewhere. */
function releasePendingAttributes(I: LayoutInput, s: LayoutState, L: LayoutLine, shape: Pick<BlockLine, 'rawFencedItem' | 'rawReferenceItem' | 'wholeAttributes'>): void {
  const { quoteDepth, quoteColumns, indent, text, visible } = L
  const { rawFencedItem, rawReferenceItem, wholeAttributes } = shape
  if (s.pendingAttributes.length && text !== '' && (!wholeAttributes || !s.lists.some(list => list.depth === quoteDepth && indent > list.column)) && (!/^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+[^ \t]/.test(visible) && !rawFencedItem && !rawReferenceItem || s.pendingAttributes.some(attribute => attribute.depth !== quoteDepth))) {
    for (const attribute of s.pendingAttributes) {
      const destinationDepth = Math.min(attribute.depth, quoteDepth)
      const column = quoteDepth > attribute.depth ? quoteColumns[attribute.depth] ?? 0 : indent
      const owner = s.lists.filter(list => list.depth === destinationDepth && column > list.column).at(-1)
      const target = owner ? owner.target + owner.content + Math.max(0, column - owner.column - owner.content) : column
      const retainedDepth = Math.max(0, destinationDepth - (s.noteOwner?.depth ?? 0))
      const prefix = retainedDepth === quoteDepth - (s.noteOwner?.depth ?? 0) ? quoteForCarve(I, s, L) : closedQuoteBoundary(quoteForCarve(I, s, L), retainedDepth - 1) + (retainedDepth ? ' ' : '')
      attribute.output[attribute.row] = prefix + ' '.repeat(target) + attribute.attributes
    }
    s.pendingAttributes = []
  }
}

function classifyBlockLine(I: LayoutInput, s: LayoutState, L: LayoutLine, outsideQuoteItem: boolean | undefined): BlockLine {
  const { fences } = I
  const { n, original, quoteDepth, text, visible } = L
  const shape = blockShape(I, s, L)
  releasePendingAttributes(I, s, L, shape)
  const { row, rawFencedItem, rawReferenceItem, fencedItemOpener } = shape
  const blockStart =
    outsideQuoteItem || (quoteDepth > s.depth && !s.paragraph) ||
    row ||
    fences[n] !== original ||
    /^(?:#{1,6}(?:[ \t]|$)|:{3,}|\|)/.test(visible) ||
    (/^(?:[*-][ \t]*){3,}$/.test(visible) && /^(?:[*-][ \t]*){3,}$/.test(text))
  // Match authored empty bodies, not spaces masking inline code.
  const emptyItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]*$/.test(text) || /^[-*+] \[[ xX]\][ \t]*$/.test(text)
  const item =
    /^(?:([-*+])|((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)))[ \t]+[^ \t]/.exec(
      emptyItem ? visible.trimEnd() + ' +' : fencedItemOpener || s.pendingAttributes.length && (rawFencedItem || rawReferenceItem) ? text : visible,
    )
  return { ...shape, blockStart, emptyItem, item }
}

/** A new block ends lazy continuation, quoted list items and item-owned divs it falls outside of. */
function endLazyContinuation(I: LayoutInput, s: LayoutState, L: LayoutLine, B: BlockLine, outsideQuoteItem: boolean | undefined): void {
  const { quoteDepth, indent, visible } = L
  const { blockStart, item } = B
  if (outsideQuoteItem) {
    s.paragraph = false
    s.quoteBoundary = quoteForCarve(I, s, L).trimEnd()
  }
  if (s.embeddedListOwner && quoteDepth > s.embeddedListOwner.depth && quoteDepth >= s.depth && ownerColumn(L, s.embeddedListOwner) < s.embeddedListOwner.column + 1) setEmbedded(s, undefined)
  const shallowerAttributes = quoteDepth < s.depth && visible.startsWith('{') && readAttributes(visible, 0)?.end === visible.length
  if (shallowerAttributes && !s.blank) s.out.push(quoteForCarve(I, s, L).trimEnd())
  // A new block can end lazy continuation outside a quote or list item.
  if (quoteDepth < s.depth && (blockStart || item || shallowerAttributes || rejectedCommentStartsBlock(visible))) {
    while (s.lists.length && s.lists.at(-1)!.depth > quoteDepth) s.lists.pop()
    if (s.embeddedListOwner && s.embeddedListOwner.depth > quoteDepth) trimEmbedded(s, quoteDepth)
    const owner = s.lists.at(-1)
    if (item && !s.blank && s.paragraph && (!owner || owner.depth !== quoteDepth || indent > owner.column)) s.out.push(closedQuoteBoundary(s.quoteBoundary, Math.max(0, quoteDepth - (s.noteOwner?.depth ?? 0))))
    else if (rejectedCommentStartsBlock(visible) && !s.blank) s.out.push(quoteForCarve(I, s, L).trimEnd())
    s.paragraph = false
    s.headingMarker = ''
    s.depth = quoteDepth
    s.quoteBoundary = quoteForCarve(I, s, L).trimEnd()
  }
  while (s.divs.at(-1)?.itemColumn !== undefined) {
    const owned = s.divs.at(-1)!
    if (
      quoteDepth >= owned.depth &&
      !(quoteDepth === owned.depth && indent < owned.itemColumn! && (item || blockStart || s.blank))
    )
      break
    s.divs.pop()
    let before = s.out.length
    while (before > 0 && s.out[before - 1]!.trim() === '') before--
    s.out.splice(before, 0, owned.prefix + ':'.repeat(owned.width))
    s.paragraph = false
  }
}

function closeOwnedLists(s: LayoutState, L: LayoutLine, B: BlockLine, blockIndent: number): void {
  const { quoteDepth } = L
  const { blockStart, fencedItemOpener, row, item } = B
  if (blockStart && !((s.pendingAttributes.length || fencedItemOpener || row) && item)) {
    // A block outside the nested item's content column belongs to its parent.
    while (
      s.lists.length &&
      ((quoteDepth > s.lists.at(-1)!.depth ? ownerColumn(L, s.lists.at(-1)!) : blockIndent) <= s.lists.at(-1)!.column ||
        (s.lists.length > 1 && (quoteDepth > s.lists.at(-1)!.depth ? ownerColumn(L, s.lists.at(-1)!) : blockIndent) < s.lists.at(-1)!.column + 1))
    ) {
      s.lists.pop()
      s.paragraph = false
      s.headingMarker = ''
      if (s.lists.length) s.lists.at(-1)!.loose = true
    }
    if (s.blank) for (const list of s.lists) if (blockIndent > list.column) list.loose = true
    if (!s.lists.length) setEmbedded(s, undefined)
  }
}

/** A line inside a quote that a list item owns keeps the item's content column. */
function writeQuoteOwnedLine(I: LayoutInput, s: LayoutState, L: LayoutLine, B: BlockLine): boolean {
  const { fences } = I
  const { n, original, quote, quoteDepth, indent, raw, text, visible } = L
  const { row, wholeAttributes, item } = B
  const quoteOwner = s.lists.at(-1)
  if (
    quoteOwner && quoteDepth > quoteOwner.depth &&
    ownerColumn(L, quoteOwner) >= quoteOwner.column + 1 &&
    (!s.paragraph || quoteDepth === s.depth)
  ) {
    s.quoteBoundary = quoteForCarve(I, s, L).trimEnd()
    s.depth = quoteDepth
    if (item && (!s.paragraph || (s.embeddedListOwner?.depth === quoteDepth && indent <= s.embeddedListOwner.column))) {
      L.nativeRemainder = raw.slice(0, indent) + compactDjotListPrefix(text)
      setEmbedded(s, { depth: quoteDepth, column: indent, content: compactDjotListPrefix(item[0].slice(0, -1)).length, sourcePrefix: quote.length, sourceContent: item[0].length - 1 }, s.embeddedOwners.filter(owner => owner.depth < quoteDepth).concat({ depth: quoteDepth, column: indent, content: compactDjotListPrefix(item[0].slice(0, -1)).length, sourcePrefix: quote.length, sourceContent: item[0].length - 1 }))
    }
    s.out.push(wholeAttributes && !s.paragraph && s.embeddedListOwner?.depth !== quoteDepth ? quoteForCarve(I, s, L) + text : originalForCarve(I, s, L))
    s.paragraph = !(row || fences[n] !== original || /^(?:#{1,6}(?:[ \t]|$)|:{3,})/.test(visible) || (/^(?:[*-][ \t]*){3,}$/.test(visible) && /^(?:[*-][ \t]*){3,}$/.test(text)) || /^\[[^\]\n]*\]:/.test(visible) || (!s.paragraph && visible.startsWith('{') && readAttributes(visible, 0)?.end === visible.length))
    s.blank = false
    return true
  }
  return false
}

function writeLiteralLine(I: LayoutInput, s: LayoutState, L: LayoutLine, B: BlockLine): boolean {
  const { fences, onLiteralQuote } = I
  const { n, original, quoteDepth, text } = L
  const { row, fencedItemOpener, item } = B
  if ((fences[n] !== original || row) && !((s.pendingAttributes.length || fencedItemOpener || row) && item)) {
    s.out.push(row && !item && !s.noteOwner && !s.lists.length && !s.embeddedListOwner && !s.opaqueQuoteOwner && s.definitionIndent < 0 ? quoteForCarve(I, s, L) + text : originalForCarve(I, s, L))
    s.paragraph = false
    s.headingMarker = ''
    s.blank = false
    return true
  }
  if (s.paragraph && quoteDepth > s.depth) {
    onLiteralQuote?.(n, s.depth)
    const markerAt = closedQuoteBoundary(quoteForCarve(I, s, L), Math.max(0, s.depth - (s.noteOwner?.depth ?? 0))).length - 1
    const written = originalForCarve(I, s, L)
    s.out.push(written.slice(0, markerAt) + '\\' + written.slice(markerAt))
    s.blank = false
    return true
  }
  return false
}

function settleQuoteDepth(I: LayoutInput, s: LayoutState, L: LayoutLine): void {
  const { quoteDepth } = L
  if (quoteDepth > s.depth && !s.paragraph) {
    s.lists.length = 0
    setEmbedded(s, undefined)
    s.depth = quoteDepth
    s.quoteBoundary = quoteForCarve(I, s, L).trimEnd()
  } else if (quoteDepth < s.depth && !s.paragraph) {
    if (s.blank) s.out.push(quoteForCarve(I, s, L).trimEnd())
    while (s.lists.length && s.lists.at(-1)!.depth > quoteDepth) s.lists.pop()
    if (s.embeddedListOwner && s.embeddedListOwner.depth > quoteDepth) trimEmbedded(s, quoteDepth)
    s.depth = quoteDepth
    s.quoteBoundary = quoteForCarve(I, s, L).trimEnd()
  }
}

/** Close divs on a `:::` line; false when the line is not a closer here. */
function closeDivLine(I: LayoutInput, s: LayoutState, L: LayoutLine, div: RegExpExecArray): boolean {
  const { lineOffsets, divClosers } = I
  const { n, quoteDepth, indent, text } = L
  const top = s.divs.at(-1)
  const closeStarts = divClosers.get(lineOffsets[n]!)
  if (div && top && closeStarts !== undefined) {
    dropOrphanAttributeLine(s.out)
    let matched = 0
    const outerStart = closeStarts.at(-1)!
    while (s.divs.length && s.divs.at(-1)!.start >= outerStart) {
      const closed = s.divs.pop()!
      while ((closeStarts[matched] ?? -1) > closed.start) matched++
      if (closed.start === closeStarts[matched]) {
        s.out.push(closed.prefix + ':'.repeat(closed.width))
        matched++
      }
    }
    s.paragraph = false
    s.headingMarker = ''
    s.blank = true
    return true
  }
  if (div && /^:{3,}[ \t]*$/.test(text) && top && (div[1]!.length >= top.width || s.paragraph)) {
    if (div[1]!.length >= top.width) {
      dropOrphanAttributeLine(s.out)
      let closed = s.divs.pop()!
      s.out.push(closed.prefix + ':'.repeat(closed.width))
      while (s.divs.length && s.divs.at(-1)!.width !== closed.width && div[1]!.length >= s.divs.at(-1)!.width) {
        closed = s.divs.pop()!
        s.out.push(closed.prefix + ':'.repeat(closed.width))
      }
      s.paragraph = false
      s.headingMarker = ''
      s.blank = true
    } else {
      s.out.push(quoteForCarve(I, s, L) + ' '.repeat(s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.target + s.noteOwner.content : indent) + '\\' + text)
      s.paragraph = true
      s.blank = false
    }
    return true
  }
  return false
}

function writeListItem(I: LayoutInput, s: LayoutState, L: LayoutLine, B: BlockLine, item: RegExpExecArray): void {
  const { quoteDepth, indent, text } = L
  const carriedAttributes = s.pendingAttributes
  s.pendingAttributes = []
  for (const attribute of carriedAttributes) attribute.output[attribute.row] = /^(?:[ \t]*>(?:[ \t]|$))*[ \t]*/.exec(attribute.output[attribute.row]!)![0].trimEnd()
  const previousList = s.lists.at(-1)
  const endsNestedList = previousList && indent < previousList.column
  while (s.lists.length && indent < s.lists.at(-1)!.column) {
    s.lists.pop()
    s.paragraph = false
    s.headingMarker = ''
  }
  const parent = s.lists.at(-1)
  const priorKind = parent?.kind
  if (parent && s.blank && indent === parent.column && endsNestedList && !parent.loose) {
    while (s.out.length && s.out.at(-1)!.replace(/>/g, '').trim() === '' && (s.out.at(-1)!.match(/>/g) ?? []).length <= quoteDepth) s.out.pop()
    if (!parent.continuation && s.out[previousList.start - 1]?.replace(/>/g, '').trim() === '') s.out.splice(previousList.start - 1, 1)
  } else if (parent && s.blank && indent === parent.column) parent.loose = true
  if (((parent && indent > parent.column) || !parent) && s.paragraph && !s.blank) {
    const target = parent?.target !== undefined ? parent.target + parent.content : s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.target + s.noteOwner.content : indent
    const literal = item[1] ? '\\' + text : parent ? text.replace(/[.)]/, '\\$&') : text
    s.out.push(quoteForCarve(I, s, L) + ' '.repeat(target) + literal)
    if (parent) parent.continuation = true
    s.blank = false
    return
  }
  const { context, nested, sameKind } = listItemContext(I, s, L, item, parent, priorKind)
  const itemOwned = parent && !nested && sameKind
  writeListItemLine(I, s, L, B, item, context, carriedAttributes.filter(attribute => itemOwned && attribute.depth === quoteDepth && attribute.owner >= indent), carriedAttributes)
}

/** Djot keeps a nested item's content column after a definition head of several markers. */
function definitionItemTarget(I: LayoutInput, L: LayoutLine, parent: ListFrame): number | undefined {
  const { lines, mask } = I
  const { n, quoteDepth, indent } = L
  let previous = n - 1
  while (previous >= 0 && /^[ \t>]*$/.test(lines[previous]!) && (lines[previous]!.match(/>/g) ?? []).length === quoteDepth) previous--
  const head = previous < 0 ? null : /^((?:[ \t]*>(?:[ \t]|$))*)([ \t]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})\))[ \t]+){2,}):(?:[ \t]|$)/.exec(lines[previous]!)
  if (head && (head[1]!.match(/>/g) ?? []).length === quoteDepth && head[2]!.length === indent && mask[previous]![head[1]!.length + head[2]!.length] === ':') return parent.target + indent - parent.column
  return undefined
}

/** Find or open the list this item belongs to. */
function listItemContext(I: LayoutInput, s: LayoutState, L: LayoutLine, item: RegExpExecArray, parent: ListFrame | undefined, priorKind: string | undefined): { context: ListFrame; nested: boolean | undefined; sameKind: boolean } {
  const { quoteDepth, indent, text, sourcePrefix } = L
  let kind = (item[1] ?? djotListKind(item[2]!)) + (item[1] && item[0].length === 3 && item[0][1] === ' ' && /^\[[ xX]\](?:[ \t]+|$)/.test(text.slice(item[0].length - 1)) ? ':task' : '')
  let context = parent
  const nested = parent && indent > parent.column
  const sharedKind = sharedDjotListKind(priorKind, kind)
  const sameKind = sharedKind !== undefined
  if (parent && !nested && sharedKind !== undefined) { kind = sharedKind; parent.kind = kind }
  if (!parent || nested) {
    const definitionTarget = parent && nested && s.blank ? definitionItemTarget(I, L, parent) : undefined
    context = {
      sourcePrefix,
      depth: quoteDepth,
      column: indent,
      content: compactDjotListPrefix(item[0].slice(0, -1)).length,
      target: definitionTarget ?? (nested ? parent.target + parent.content : s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.target + s.noteOwner.content : 0),
      kind,
      bullet: item[1] === '*' ? '*' : '-',
      loose: false,
      start: s.out.length,
      continuation: false,
    }
    s.lists.push(context)
  } else if (!sameKind) {
    if (s.out.at(-1)?.trim() !== '') s.out.push(quoteForCarve(I, s, L).trimEnd())
    parent.kind = kind
    parent.bullet = parent.bullet === '-' ? '*' : '-'
  }
  if (parent && !nested && parent.loose && parent.continuation && s.out.at(-1)?.trim() !== '')
    s.out.push(quoteForCarve(I, s, L).trimEnd())
  return { context: context!, nested, sameKind }
}

function writeListItemLine(I: LayoutInput, s: LayoutState, L: LayoutLine, B: BlockLine, item: RegExpExecArray, context: ListFrame, attached: PendingAttribute[], carriedAttributes: PendingAttribute[]): void {
  const { lines, lineOffsets, holdItemAttributes } = I
  const { n, quote, quoteDepth, rawIndent, text } = L
  const { emptyItem, row, rawFencedItem } = B
  const emptyTaskEnd = emptyDjotTaskTailEnd(text, n + 1 === lines.length || lines[n + 1]!.trim() === '')
  const compact = compactDjotListPrefix(emptyTaskEnd !== undefined ? text.slice(0, emptyTaskEnd).trimEnd() + ' +' : emptyItem ? text.trimEnd() + ' +' : text)
  const written = item[1] ? context!.bullet + compact.slice(1) : compact
  context!.continuation = false
  context!.empty = emptyItem
  s.headingMarker = ''
  const attachedSet = new Set(attached)
  for (const attribute of carriedAttributes) {
    if (!attachedSet.has(attribute)) s.out.push(quoteForCarve(I, s, L) + ' '.repeat(context!.target) + attribute.attributes)
  }
  if (attached.length && holdItemAttributes) {
    while (s.out.length && s.out.at(-1)!.replace(/>/g, '').trim() === '' && (s.out.at(-1)!.match(/>/g) ?? []).length <= quoteDepth) s.out.pop()
    const attributes = '{' + attached.map(attribute => attribute.attributes.slice(1, -1)).join(' ') + '}'
    if (context!.loose) s.out.push(quoteForCarve(I, s, L).trimEnd())
    s.out.push(quoteForCarve(I, s, L) + ' '.repeat(context!.target) + holdItemAttributes(attributes), quoteForCarve(I, s, L).trimEnd())
  }
  s.out.push(quoteForCarve(I, s, L) + ' '.repeat(context!.target) + written)
  const body = text.slice(item[0].length - 1)
  const itemHeading = /^(#{1,6})(?:[ \t]+|$)/.exec(body)
  s.headingMarker = itemHeading?.[1] ?? ''
  const task = item[1] !== undefined && item[0].length === 3 && item[0][1] === ' ' && body.startsWith('[') ? /^\[[ xX]\][ \t]+/.exec(body) : null
  const itemBody = task ? body.slice(task[0].length) : body
  const itemDiv = /^(:{3,})(?:[ \t]+.*)?$/.exec(itemBody)
  if (itemDiv)
    s.divs.push({
      width: itemDiv[1]!.length,
      prefix: quoteForCarve(I, s, L) + ' '.repeat(context!.target + context!.content),
      itemColumn: context!.column + 1,
      depth: quoteDepth,
      start: lineOffsets[n]!,
    })
  const itemQuote = itemBody.startsWith('>') ? itemQuotePrefix(itemBody) : undefined
  const itemOwners = itemQuote?.owners.map(owner => ({ ...owner, depth: quoteDepth + owner.depth, sourcePrefix: quote.length + rawIndent + item[0].length - 1 + (task?.[0].length ?? 0) + owner.sourceOffset })) ?? []
  setEmbedded(s, itemOwners.at(-1), itemOwners)
  if (itemQuote?.depth) {
    s.depth = quoteDepth + (itemQuote.body ? itemQuote.depth : 0)
    s.quoteBoundary = (quoteForCarve(I, s, L) + ' '.repeat(context!.target + context!.content) + itemQuote.prefix).trimEnd()
  }
  const quoteBody = itemQuote?.body ?? ''
  const itemAttributes = itemBody.startsWith('{') ? readAttributes(itemBody, 0) : undefined
  s.paragraph = !emptyItem && !row && !rawFencedItem && !itemDiv && !itemHeading && itemAttributes?.end !== itemBody.length && !/^\[(?!\^)[^\]\n]+\]:/.test(itemBody) && !(itemQuote?.depth && (quoteBody === '' || /^\[[^\]\n]*\]:/.test(quoteBody) || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|(?:[*-][ \t]*){3,}$)/.test(quoteBody)))
  s.blank = !!itemDiv
}

function openDivLine(I: LayoutInput, s: LayoutState, L: LayoutLine, div: RegExpExecArray): void {
  const { lineOffsets } = I
  const { n, quoteDepth, indent } = L
  const parent = s.lists.at(-1)
  s.divs.push({
    width: div[1]!.length,
    prefix: quoteForCarve(I, s, L) + ' '.repeat(s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.content : indent),
    depth: quoteDepth,
    start: lineOffsets[n]!,
    ...(parent && indent > parent.column ? { itemColumn: parent.column + 1 } : {}),
  })
  s.out.push(originalForCarve(I, s, L))
  s.paragraph = false
  s.headingMarker = ''
  s.blank = true
}

function writeHeldItemAttributes(I: LayoutInput, s: LayoutState, L: LayoutLine): boolean {
  const { text } = L
  const heldItemAttributes = /^\x00DJOTITEMATTR\x00(?:\d+\x00)?(B?)\d+\x00$/.exec(text)
  if (heldItemAttributes) {
    if (heldItemAttributes[1] && s.out.at(-1)?.trimEnd() !== quoteForCarve(I, s, L).trimEnd()) s.out.push(quoteForCarve(I, s, L).trimEnd())
    s.out.push(originalForCarve(I, s, L))
    s.paragraph = false
    s.blank = !!heldItemAttributes[1]
    return true
  }
  return false
}

/** Write a line holding only attributes, or hold it for the list item that follows. */
function placeAttributeLine(I: LayoutInput, s: LayoutState, L: LayoutLine, attrs: ReturnType<typeof readAttributes>, attributeLine: boolean): boolean {
  const { holdItemAttributes } = I
  const { quoteDepth, indent, visible } = L
  if (attributeLine && !s.paragraph && !s.lists.some(list => list.depth === quoteDepth && indent > list.column)) {
    s.out.push(quoteForCarve(I, s, L) + ' '.repeat(s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.content : 0) + attrs!.source)
    s.paragraph = false
    s.blank = false
    return true
  }
  if (attributeLine && !s.paragraph && holdItemAttributes) {
    let owner: typeof s.lists[number] | undefined
    for (let index = s.lists.length - 1; index >= 0; index--) {
      const candidate = s.lists[index]!
      if (candidate.depth === quoteDepth && indent > candidate.column) { owner = candidate; break }
    }
    if (owner && attrs!.source !== '{}') {
      const heldLoose = /\x00DJOTITEMATTR\x00(?:\d+\x00)?B\d+\x00$/.test(s.out[owner.start - 2] ?? '')
      if (s.blank && !heldLoose && !s.out[owner.start]!.includes('{loose}\n')) {
        const start = s.out[owner.start]!, noteItem = s.noteOwner ? /^(\[\^[^\]\n]+\]:[ \t]*)(.*)$/.exec(start) : null
        s.out[owner.start] = noteItem ? `${noteItem[1]}{loose}\n  ${noteItem[2]}` : quoteForCarve(I, s, L) + ' '.repeat(owner.target) + '{loose}\n' + start
        owner.loose = true
      }
      s.pendingAttributes.push({ owner: owner.column, depth: quoteDepth, row: s.out.length, output: s.out, attributes: attrs!.source })
    }
  } else if (visible.trim() !== '' && s.pendingAttributes.length) {
    let owner: typeof s.lists[number] | undefined
    for (let index = s.lists.length - 1; index >= 0; index--) {
      const candidate = s.lists[index]!
      if (candidate.depth === quoteDepth && indent > candidate.column) { owner = candidate; break }
    }
    const target = owner ? owner.target + owner.content + Math.max(0, indent - owner.column - owner.content) : indent
    for (const attribute of s.pendingAttributes) attribute.output[attribute.row] = quoteForCarve(I, s, L) + ' '.repeat(target) + attribute.attributes
    s.pendingAttributes = []
  }
  return false
}

/** Write a paragraph, heading, rule or table line. */
function writeTextLine(I: LayoutInput, s: LayoutState, L: LayoutLine, B: BlockLine, div: RegExpExecArray | null, rule: boolean, attributeLine: boolean): void {
  const { indent, visible } = L
  const { row } = B
  if (s.lists.at(-1)?.empty && indent <= s.lists.at(-1)!.column && visible.trim() !== '' && !attributeLine) {
    if (s.out.at(-1)?.trim() !== '') s.out.push(quoteForCarve(I, s, L).trimEnd())
    s.blank = true
  }
  if (visible.trim() !== '' && !attributeLine) {
    for (const list of s.lists) if (indent > list.column) list.empty = false
  }
  const outsideColumn = (s.blank || !s.paragraph) && !parentContains(s.lists, indent) && !attributeLine ? s.lists[0]?.column : undefined
  if (outsideColumn !== undefined) { s.lists.length = 0; setEmbedded(s, undefined) }
  const heading = /^(#{1,6})(?:[ \t]+|$)/.exec(visible)
  if (rejectedCommentStartsBlock(visible)) {
    const outsideList = s.lists.length > 0 && indent <= s.lists[0]!.column
    if (s.headingMarker || outsideList) s.out.push(quoteForCarve(I, s, L) + ' '.repeat(indent))
    if (outsideList) { s.lists.length = 0; s.paragraph = false; s.blank = true }
    s.headingMarker = ''
  }
  if (row) {
    s.out.push(originalForCarve(I, s, L))
    s.paragraph = false
    s.blank = false
    return
  }
  writeTextContent(I, s, L, B, div, rule, attributeLine, outsideColumn, heading)
}

function writeTextContent(I: LayoutInput, s: LayoutState, L: LayoutLine, B: BlockLine, div: RegExpExecArray | null, rule: boolean, attributeLine: boolean, outsideColumn: number | undefined, heading: RegExpExecArray | null): void {
  const { quoteDepth, indent, text, visible } = L
  const { row, item } = B
  const reference = /^\[[^\]\n]*\]:/.test(visible)
  const block =
    (heading && heading[1] !== s.headingMarker) ||
    div ||
    (rule && (!visible.includes('*') || !visible.includes('-'))) ||
    visible.startsWith('>') ||
    visible.startsWith('|')
  if ((block && (!heading || heading[1] !== s.headingMarker)) || attributeLine || reference) s.headingMarker = ''
  if (s.blank && !block && !attributeLine && !reference) {
    for (const list of s.lists) if (indent > list.column) list.loose = true
  }
  if (s.paragraph && block) {
    s.out.push(quoteForCarve(I, s, L) + ' '.repeat(s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.target + s.noteOwner.content : indent) + '\\' + text)
    s.blank = false
    return
  }
  if (!s.paragraph && /^\|`+\|$/.test(text) && !row) {
    while (s.out[0] === '') s.out.shift()
    s.out.push(quoteForCarve(I, s, L) + ' '.repeat(s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.target + s.noteOwner.content : indent) + '\\' + text)
    s.paragraph = true
    s.blank = false
    return
  }
  if (heading) s.headingMarker = heading[1]!
  if (heading && !s.lists.length) {
    s.out.push(
      quoteForCarve(I, s, L) +
        ' '.repeat(s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.target + s.noteOwner.content : 0) +
        heading[1] +
        // Carve whitespace does not include a vertical tab or a form feed, so
        // `String.prototype.trim` would eat heading content (carve-js#2681).
        (trimNonNbsp(text.slice(heading[1]!.length)) ? ' ' + trimStartNonNbsp(text.slice(heading[1]!.length)) : ''),
    )
  } else if (rule && !s.lists.length && !s.paragraph) s.out.push(quoteForCarve(I, s, L) + ' '.repeat(s.noteOwner && quoteDepth === s.noteOwner.depth ? s.noteOwner.target + s.noteOwner.content : 0) + '***')
  else {
    let embedded: EmbeddedOwner | undefined
    for (const candidate of s.embeddedOwners) {
      if (candidate.depth > quoteDepth) break
      if (candidate.depth === quoteDepth && ownerColumn(L, candidate) > candidate.column) { embedded = candidate; break }
    }
    const parent = s.lists.at(-1)
    if (embedded) s.out.push(quoteForCarve(I, s, L) + ' '.repeat((embedded.target ?? 0) + embedded.content + Math.max(0, ownerColumn(L, embedded) - embedded.column - (embedded.sourceContent ?? embedded.content))) + text)
    else if (parent && indent > parent.column)
      s.out.push(
        quoteForCarve(I, s, L) +
          ' '.repeat(parent.target + parent.content + Math.max(0, indent - parent.column - parent.content)) +
          text,
      )
    else s.out.push(outsideColumn === undefined || s.noteOwner ? originalForCarve(I, s, L) : quoteForCarve(I, s, L) + ' '.repeat(Math.max(0, indent - outsideColumn)) + text)
  }
  // Masked code ends a s.paragraph only when it is a block fence.
  const fence = /^[`~]{3,}/.test(text) && visible.trim() === ''
  s.paragraph = !(
    heading ||
    s.headingMarker ||
    rule ||
    attributeLine ||
    reference ||
    row ||
    fence ||
    /^:[ \t]/.test(visible) ||
    quoteDepth > s.depth
  )
  if (!s.paragraph && quoteDepth > s.depth) s.depth = quoteDepth
  if (s.blank && !item && !parentContains(s.lists, indent) && !attributeLine) { s.lists.length = 0; setEmbedded(s, undefined) }
  s.blank = false
}

function writeBlockLine(I: LayoutInput, s: LayoutState, L: LayoutLine, blockIndent: number, outsideQuoteItem: boolean | undefined): void {
  const B = classifyBlockLine(I, s, L, outsideQuoteItem)
  endLazyContinuation(I, s, L, B, outsideQuoteItem)
  closeOwnedLists(s, L, B, blockIndent)
  if (writeQuoteOwnedLine(I, s, L, B)) return
  if (writeLiteralLine(I, s, L, B)) return
  settleQuoteDepth(I, s, L)
  if (L.view.trim() === '' && !(s.pendingAttributes.length && B.item)) {
    s.out.push(originalForCarve(I, s, L))
    s.paragraph = !s.headingMarker && !/^(?:(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)?\[[^\]\n]+\]:/.test(L.text)
    s.blank = false
    return
  }
  const div = /^(:{3,})(?:[ \t]+.*)?$/.exec(L.visible)
  if (div && closeDivLine(I, s, L, div)) return
  const rule = (/^(?:[*-][ \t]*){3,}$/.test(L.visible) && /^(?:[*-][ \t]*){3,}$/.test(L.text))
  if (B.item && !rule) {
    writeListItem(I, s, L, B, B.item)
    return
  }
  if (div && !s.paragraph) {
    openDivLine(I, s, L, div)
    return
  }
  if (writeHeldItemAttributes(I, s, L)) return
  const attrs = L.visible.startsWith('{') ? readAttributes(L.raw, L.rawIndent) : undefined
  const attributeLine = attrs?.end === L.raw.length
  if (placeAttributeLine(I, s, L, attrs, attributeLine)) return
  writeTextLine(I, s, L, B, div, rule, attributeLine)
}

/** Close what is still open, then place each note body where it belongs. */
function finishLayout(I: LayoutInput, s: LayoutState): string {
  const { source } = I
  while (s.notes.length) endNote(s)
  const newline = s.out.at(-1) === ''
  if (s.divs.length && newline) s.out.pop()
  if (s.divs.length) dropOrphanAttributeLine(s.out)
  while (s.divs.length) {
    const div = s.divs.pop()!
    if (!div.prefix.includes('>')) s.out.push(div.prefix + ':'.repeat(div.width))
  }
  if (newline && s.out.at(-1) !== '') s.out.push('')
  const rendered: string[] = []
  const placedNotes = new Map<number, string[][]>()
  const appendNote = (body: string[]): void => {
    for (const line of body) rendered.push(line)
    if (rendered.at(-1) !== '') rendered.push('')
  }
  for (const { body, placement } of s.completedNotes) {
    if (placement === undefined) appendNote(body)
    else {
      const held = placedNotes.get(placement) ?? []
      held.push(body)
      placedNotes.set(placement, held)
    }
  }
  for (let i = 0; i <= s.out.length; i++) {
    for (const body of placedNotes.get(i) ?? []) appendNote(body)
    if (i < s.out.length) rendered.push(s.out[i]!)
  }
  if (!source.endsWith('\n') && rendered.at(-1) === '') rendered.pop()
  return rendered.join('\n')
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
  const I: LayoutInput = { source, lines, mask, fences, lineOffsets, rows, divClosers, hasDefinitionSyntax, isBoundary, noteSourceWidths, emptyNote, holdItemAttributes, onLiteralQuote }
  const s: LayoutState = {
    out: [],
    lists: [],
    divs: [],
    returnedNoteItemAttributes: [],
    returnedNoteDestinationDepth: undefined,
    pendingAttributes: [],
    paragraph: false,
    blank: true,
    depth: 0,
    embeddedListOwner: undefined,
    embeddedOwners: [],
    noteOwner: undefined,
    notes: [],
    completedNotes: [],
    opaqueQuoteOwner: undefined,
    quoteBoundary: '',
    headingMarker: '',
    definitionIndent: -1,
    definitionStack: [],
  }
  for (let n = 0; n < lines.length; n++) {
    const L = readLayoutLine(I, s, n)
    if (L.quoteDepth > 0 && L.masked[L.quote.indexOf('>')] !== '>' && fences[n] === L.original) {
      s.out.push(L.original)
      s.blank = false
      continue
    }
    if (writeNoteContinuation(I, s, L)) continue
    releaseLineOwners(I, s, L)
    const { blockIndent, outsideQuoteItem } = quoteItemPlacement(s, L)
    flushReturnedNoteAttributes(I, s, L)
    if (L.noteHead) {
      openNote(I, s, L, L.noteHead)
      continue
    }
    if (L.text === '') {
      writeBlankLine(I, s, L, outsideQuoteItem)
      continue
    }
    if (writeDefinitionLine(I, s, L)) continue
    writeBlockLine(I, s, L, blockIndent, outsideQuoteItem)
  }
  return finishLayout(I, s)
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
  let forcedSingle = false
  const plainSingleOpeners: number[] = []
  const firstLine = source.slice(0, source.indexOf('\n') < 0 ? undefined : source.indexOf('\n'))
  let itemIndent: number | undefined = /^([ \t]*)(?:[-+*]|\d+[.)]|:)[ \t]+/.exec(
    firstLine.replace(/^[ \t]*(?:>[ \t]*)+/, ''),
  )?.[1]?.length
  let inDiv = false
  for (let i = 0; i < source.length; i++) {
    escaped = source[i - 1] === '\\' ? !escaped : false
    if (source[i] === '\n') {
      const lineStart = source.lastIndexOf('\n', i - 1) + 1
      const line = source.slice(lineStart, i)
      const nextEnd = source.indexOf('\n', i + 1)
      const next = source.slice(i + 1, nextEnd < 0 ? undefined : nextEnd)
      const unquotedLine = line.replace(/^[ \t]*(?:>[ \t]*)+/, '')
      const unquotedNext = next.replace(/^[ \t]*(?:>[ \t]*)+/, '')
      const nextItem = /^([ \t]*)(?:[-+*]|\d+[.)]|:)[ \t]+/.exec(unquotedNext)
      const nextIndent = nextItem?.[1]?.length
      if (/^[ \t]*(?:>[ \t]*)*$/.test(line) ||
        (inDiv && /^[ \t]*:{3,}[ \t]*$/.test(unquotedLine)) ||
        (nextIndent !== undefined && itemIndent !== undefined && nextIndent <= itemIndent)) {
        plainSingleOpeners.length = 0
      }
      if (/^[ \t]*:{3,}[ \t]+\S/.test(unquotedLine)) inDiv = true
      else if (inDiv && /^[ \t]*:{3,}[ \t]*$/.test(unquotedLine)) inDiv = false
      if (nextIndent !== undefined) itemIndent = nextIndent
      else if (/^[ \t]*(?:>[ \t]*)*$/.test(line)) itemIndent = undefined
    }
    if (source[i] === '|' && !escaped && mask[i] === '|' &&
      /^[ \t]*\|/.test(source.slice(source.lastIndexOf('\n', i - 1) + 1, i + 1))) {
      plainSingleOpeners.length = 0
    }
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
      if (source.startsWith("{'", i)) forcedSingle = true
      else if (source.startsWith("'}", i)) forcedSingle = false
      output.push(quote)
      i++
      continue
    }
    const plainSingle = source[i] === "'" && !preserveQuote?.(i)
    const lastPlainSingle = plainSingleOpeners.at(-1)
    const closesPlainSingle = plainSingle && lastPlainSingle !== undefined && lastPlainSingle !== i - 1 &&
      source[i - 1] !== undefined && !/\s/u.test(source[i - 1]!)
    if (forcedSingle && plainSingle && !closesPlainSingle && source[i - 1] === '/' &&
      (i + 1 === source.length || /^[\s"'.,;:!?)\]]/u.test(source[i + 1]!))) {
      output.push('‘')
      continue
    }
    if (plainSingle) {
      if (closesPlainSingle) plainSingleOpeners.pop()
      else if (source[i + 1] !== undefined && !/\s/u.test(source[i + 1]!) &&
        (i === 0 || [' ', '\t', '\r', '\n', '"', "'", '-', '(', '['].includes(source[i - 1]!))) {
        plainSingleOpeners.push(i)
      }
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
