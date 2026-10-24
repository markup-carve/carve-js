import { readAttributes } from './djot-attributes.js'

export function isDjotEscaped(source: string, at: number): boolean {
  let start = at
  while (source[start - 1] === '\\') start--
  return (at - start) % 2 !== 0
}

export function djotContentStart(line: string): number {
    let at = 0
    while (at < line.length) {
      while (line[at] === ' ' || line[at] === '\t') at++
      if (line[at] === '>' && (at + 1 === line.length || line[at + 1] === ' ' || line[at + 1] === '\t')) { at++; continue }
      const marker = /^(?:\[\^[^\]\n]+\]:(?:[ \t]+|[\r\n]*$)|(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})\)|:)[ \t]+)/.exec(line.slice(at))
      if (!marker) break
      at += marker[0].length
      if (/^[-*+] $/.test(marker[0])) {
        const task = /^\[[ xX]\][ \t]+/.exec(line.slice(at))
        if (task) at += task[0].length
      }
    }
    return at
  }

export function djotItemPrefix(line: string, at: number): string {
  return line.slice(0, at).replace(/\[\^[^\]\n]+\]:[ \t]*/g, '')
}

export function djotTableRows(source: string, mask: string): boolean[] {
  let offset = 0, previousRow = false, previousBlock = true, footnoteColumn = -1, noteContainerColumn = -1, noteContainerDepth = 0, noteItemColumn = -1, noteItemDepth = 0, noteItemPrefix = 0
  let inlineNote: { depth: number; column: number } | undefined
  return source.split('\n').map(line => {
    const at = djotContentStart(line), end = line.trimEnd().length - 1, content = line.slice(at)
    const prefix = line.slice(0, at), noteAt = prefix.indexOf('[^')
    const opensItem = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(noteAt < 0 ? prefix : prefix.slice(0, noteAt))
    const closesNote = footnoteColumn >= 0 && at < footnoteColumn
    if (closesNote) { footnoteColumn = -1; noteContainerColumn = -1 }
    const physicalDepth = (/^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0].match(/>/g) ?? []).length
    const closesContainer = noteContainerColumn >= 0 && content.trim() !== '' && (noteContainerDepth > 0 ? physicalDepth < noteContainerDepth : at <= noteContainerColumn)
    const physicalPrefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    const itemColumn = physicalDepth > noteItemDepth ? (Array.from(physicalPrefix.matchAll(/>/g))[noteItemDepth]?.index ?? 0) - noteItemPrefix : /^[ \t]*/.exec(line.slice(physicalPrefix.length))![0].length + physicalPrefix.length - noteItemPrefix
    const closesNoteItem = noteItemColumn >= 0 && content.startsWith('|') && (physicalDepth < noteItemDepth || itemColumn <= noteItemColumn)
    if (closesNoteItem || closesNote) noteItemColumn = -1
    if (closesContainer) noteContainerColumn = -1
    const closesInlineNote = inlineNote && content.trim() !== '' && (physicalDepth < inlineNote.depth || physicalDepth === inlineNote.depth && /^[ \t]*/.exec(line.slice(physicalPrefix.length))![0].length <= inlineNote.column)
    if (closesInlineNote) inlineNote = undefined
    const allowed = previousBlock || previousRow || opensItem || closesNote || closesContainer || closesNoteItem || !!closesInlineNote
    const noteHead = noteAt >= 0 && mask[offset + noteAt] === '[' ? /^\[\^[^\]\n]+\]:/.exec(line.slice(noteAt)) : null
    const note = noteHead ? line.slice(0, noteAt + noteHead[0].length) : undefined
    if (note !== undefined && allowed) {
      const nestedHeads = Array.from(line.slice(noteAt + noteHead![0].length, at).matchAll(/\[\^[^\]\n]+\]:/g))
      const nestedHead = nestedHeads.at(-1)
      if (nestedHead) {
        const nestedAt = noteAt + noteHead![0].length + nestedHead.index!
        const structural = line.slice(0, nestedAt).replace(/\[\^[^\]\n]+\]:[ \t]*/g, value => ' '.repeat(value.length))
        const quotes = Array.from(structural.matchAll(/>[ \t]/g))
        inlineNote = { depth: quotes.length, column: nestedAt - ((quotes.at(-1)?.index ?? -2) + 2) }
      }
      const notePrefix = line.slice(0, noteAt)
      const noteDepth = (notePrefix.match(/>/g) ?? []).length
      footnoteColumn = note.indexOf('[^') + 2
      const after = line.slice(note.length)
      const padding = /^[ \t]*/.exec(after)![0].length
      const body = after.slice(padding)
      const firstItem = /^(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.exec(body)
      noteItemColumn = firstItem ? note.length + padding - notePrefix.length : -1
      noteItemDepth = noteDepth
      noteItemPrefix = notePrefix.length
      if (/^(?:>(?:[ \t]|$)|[-*+][ \t]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)][ \t]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)[ \t])/.test(body)) {
        noteContainerColumn = note.length + padding
        const inlineDepth = (body.slice(0, djotContentStart(body)).replace(/\[\^[^\]\n]+\]:[ \t]*/g, '').match(/>/g) ?? []).length
        noteContainerDepth = inlineDepth ? noteDepth + inlineDepth : 0
      }
    }
    const row: boolean = allowed && line[at] === '|' && mask[offset + at] === '|' && line[end] === '|' && mask[offset + end] === '|' && line[end - 1] !== '\\'
    previousBlock = content.trim() === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{|\[[^\]]+\]:)/.test(content)
    previousRow = row
    offset += line.length + 1
    return row
  })
}


type BoundaryItem = { column: number; depth: number }
type BoundaryDiv = { width: number; column: number; depth: number; itemColumn: number | undefined; itemDepth: number; minimumWidth: number; scopeStart: number; start: number }
type BoundaryFence = { ch: string; width: number; depth: number; itemColumn: number | undefined }
type BoundaryLine = { line: string; depth: number; trimmed: string; indent: number; marker: RegExpExecArray | null; active: BoundaryItem | undefined; startsItem: boolean; blank: boolean }
type ScopedBody = { body: string; column: number; bodyDepth: number; canOpen: boolean }

const SCOPED_BLOCK_START = /^(?:#{1,6}(?: |$)|:{3,}|[`~]{3,}|(?:[*-][ \t]*){3,}$)/
const SCOPED_CODE_FENCE = /^(`{3,}|~{3,})(.*)$/

export function djotInlineBoundaries(source: string, mask: string, codeScopes = false, divClosers?: Map<number, number[]>, divOwners?: Map<number, { column: number | undefined; depth: number }>): number[] {
  return new InlineBoundaryScanner(source, mask, codeScopes, divClosers, divOwners).scan()
}

class InlineBoundaryScanner {
  private readonly boundaries: number[] = []
  private readonly rows: boolean[]
  private readonly items: BoundaryItem[] = []
  private readonly divs: BoundaryDiv[] = []
  private codeFence: BoundaryFence | undefined
  private previousBlock = true
  private previousDepth = 0
  private previousBlank = true
  private offset = 0
  private row = 0

  constructor(
    private readonly source: string,
    private readonly mask: string,
    private readonly codeScopes: boolean,
    private readonly divClosers?: Map<number, number[]>,
    private readonly divOwners?: Map<number, { column: number | undefined; depth: number }>,
  ) {
    this.rows = djotTableRows(source, mask)
  }

  scan(): number[] {
    for (const rawLine of this.source.split('\n')) {
      this.scanLine(this.codeScopes && rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine)
      this.row++
      this.offset += rawLine.length + 1
    }
    return this.boundaries
  }

  private scanLine(line: string): void {
    const facts = this.readLine(line)
    if (this.codeScopes) this.trackCodeScopes(facts)
    if (this.previousBlank || facts.startsItem) this.openItemBoundary(facts)
    if (this.rows[this.row]) this.pushCellBoundaries(line)
    this.previousBlank = facts.blank
    this.previousDepth = facts.depth
  }

  private readLine(line: string): BoundaryLine {
    const prefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    const depth = (prefix.match(/>/g) ?? []).length
    const content = line.slice(prefix.length), trimmed = content.replace(/^[ \t]*/, ''), indent = content.length - trimmed.length
    const marker = /^(?:\[\^[^\]\n]+\]:[ \t]*|(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+)/.exec(trimmed)
    const active = this.items.at(-1)
    const startsItem: boolean = !!marker && ((this.previousBlank || this.codeScopes && this.previousBlock) || (!!active && depth <= active.depth && indent < active.column))
    const blank = trimmed === '' || trimmed === '\r'
    return { line, depth, trimmed, indent, marker, active, startsItem, blank }
  }

  private trackCodeScopes(facts: BoundaryLine): void {
    if (this.previousBlock && !facts.blank) {
      while (this.items.length && facts.depth === this.items.at(-1)!.depth && facts.indent < this.items.at(-1)!.column && !facts.startsItem) this.items.pop()
    }
    const blockStart = SCOPED_BLOCK_START.test(facts.trimmed) || !!facts.marker
    this.closeOutsideDivs(facts, blockStart)
    const scoped = this.scopedBody(facts, blockStart)
    this.closeOutdentedFence(facts)
    const ticks = SCOPED_CODE_FENCE.exec(scoped.body)
    if (this.codeFence) this.previousBlock = this.closesCodeFence(this.codeFence, ticks, scoped.bodyDepth)
    else if (ticks && scoped.canOpen && (ticks[1]![0] !== '`' || !ticks[2]!.includes('`'))) this.openCodeFence(facts, ticks, scoped.bodyDepth)
    else this.scanDivFence(facts, scoped)
  }

  private closeOutsideDivs(facts: BoundaryLine, blockStart: boolean): void {
    const { depth, indent, blank, startsItem } = facts
    while (this.divs.length) {
      const owner = this.divs.at(-1)!
      const outsideQuote = depth < owner.depth && (blank || this.previousBlank || startsItem || blockStart)
      const outsideItem = owner.itemColumn !== undefined && depth === owner.itemDepth &&
        indent < owner.itemColumn && !blank && (this.previousBlank || startsItem || blockStart)
      if (!outsideQuote && !outsideItem) break
      this.divs.pop()
    }
  }

  private scopedBody(facts: BoundaryLine, blockStart: boolean): ScopedBody {
    const { depth, indent, marker, startsItem } = facts
    let body = startsItem ? facts.trimmed.slice(marker![0].length) : facts.trimmed
    let column = indent + (startsItem ? marker![0].length : 0)
    if (startsItem && /^[-*+] $/.test(marker![0])) {
      const task = /^\[[ xX]\][ \t]+/.exec(body)
      if (task) { body = body.slice(task[0].length); column += task[0].length }
    }
    const padding = /^[ \t]*/.exec(body)![0].length
    body = body.slice(padding)
    column += padding
    const nestedQuote = /^(?:>[ \t]+)*/.exec(body)![0]
    const bodyDepth = depth + (nestedQuote.match(/>/g) ?? []).length
    body = body.slice(nestedQuote.length)
    if (nestedQuote) column = 0
    const item = this.items.at(-1)
    const canOpen: boolean = this.previousBlock || this.previousBlank || !!startsItem || (blockStart && (depth < this.previousDepth || !!item && depth === item.depth && indent < item.column))
    return { body, column, bodyDepth, canOpen }
  }

  private closeOutdentedFence(facts: BoundaryLine): void {
    const fence = this.codeFence
    const { depth, indent } = facts
    if (!fence || !(depth < fence.depth || fence.itemColumn !== undefined && depth === fence.depth && indent < fence.itemColumn && !facts.blank)) return
    this.codeFence = undefined
    while (this.items.length && depth === this.items.at(-1)!.depth && indent < this.items.at(-1)!.column) this.items.pop()
  }

  private closesCodeFence(fence: BoundaryFence, ticks: RegExpExecArray | null, bodyDepth: number): boolean {
    if (!ticks || ticks[1]![0] !== fence.ch || ticks[1]!.length < fence.width || !/^[ \t]*$/.test(ticks[2]!) || bodyDepth !== fence.depth) return false
    this.codeFence = undefined
    return true
  }

  private openCodeFence(facts: BoundaryLine, ticks: RegExpExecArray, bodyDepth: number): void {
    this.codeFence = { ch: ticks[1]![0]!, width: ticks[1]!.length, depth: bodyDepth, itemColumn: this.ownerItemColumn(facts, facts.marker?.[0].length ?? 0) }
    this.previousBlock = false
  }

  /** The item column a fence or div opened on this line belongs to. */
  private ownerItemColumn(facts: BoundaryLine, markerWidth: number): number | undefined {
    const { active, depth, indent } = facts
    if (facts.startsItem) return indent + markerWidth
    return active && depth === active.depth && indent >= active.column ? active.column : undefined
  }

  private scanDivFence(facts: BoundaryLine, scoped: ScopedBody): void {
    const { body, bodyDepth } = scoped
    const fence = /^(:{3,})(?:[ \t]*[A-Za-z0-9_-]+)?[ \t]*$/.exec(body)
    const owner = this.divs.at(-1)
    const visible = this.mask[this.offset + facts.line.length - body.length] === ':'
    if (fence && visible && owner && /^[ \t]*$/.test(body.slice(fence[1]!.length)) &&
        bodyDepth === owner.depth && fence[1]!.length >= owner.minimumWidth) this.closeDivs(owner, fence[1]!.length)
    else if (fence && visible && scoped.canOpen) this.openDiv(facts, scoped, owner, fence[1]!.length)
    else this.previousBlock = this.endsBlock(facts, scoped)
  }

  private closeDivs(owner: BoundaryDiv, width: number): void {
    this.boundaries.push(this.offset)
    let low = owner.scopeStart, high = this.divs.length - 1
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.divs[mid]!.minimumWidth <= width) high = mid
      else low = mid + 1
    }
    this.divClosers?.set(this.offset, this.divs.slice(low).map(owner => owner.start).reverse())
    this.divOwners?.set(this.offset, { column: this.divs[low]!.itemColumn, depth: this.divs[low]!.itemDepth })
    this.divs.length = low
    this.previousBlock = true
  }

  private openDiv(facts: BoundaryLine, scoped: ScopedBody, owner: BoundaryDiv | undefined, width: number): void {
    this.boundaries.push(this.offset)
    const sameScope = owner?.depth === scoped.bodyDepth
    this.divs.push({ width, column: scoped.column, depth: scoped.bodyDepth,
      itemColumn: this.ownerItemColumn(facts, facts.marker ? itemMarkerWidth(facts.marker) : 0),
      itemDepth: facts.depth, start: this.offset, minimumWidth: sameScope ? Math.min(owner.minimumWidth, width) : width, scopeStart: sameScope ? owner.scopeStart : this.divs.length })
    this.previousBlock = true
  }

  private endsBlock(facts: BoundaryLine, scoped: ScopedBody): boolean {
    const { body } = scoped
    const attrs = body.startsWith('{') ? readAttributes(body, 0) : undefined
    return facts.blank || this.rows[this.row]! || (scoped.canOpen && (/^(?:#{1,6}(?: |$)|(?:[*-][ \t]*){3,}$|\[[^\]]+\]:)/.test(body) || !!attrs && /^[ \t]*$/.test(body.slice(attrs.end))))
  }

  private openItemBoundary(facts: BoundaryLine): void {
    this.boundaries.push(this.offset)
    if (facts.blank) return
    const { depth, indent } = facts
    while (this.items.length) {
      const item = this.items.at(-1)!
      if (depth > item.depth || (depth === item.depth && indent >= item.column)) break
      this.items.pop()
    }
    if (facts.startsItem) this.items.push({ column: indent + itemMarkerWidth(facts.marker!), depth })
  }

  private pushCellBoundaries(line: string): void {
    for (let at = 0; at < line.length; at++) if (line[at] === '|' && this.mask[this.offset + at] === '|' && line[at - 1] !== '\\') this.boundaries.push(this.offset + at)
  }
}

function itemMarkerWidth(marker: RegExpExecArray): number {
  return marker[0].startsWith('[^') ? 2 : marker[0].length
}

export function djotSimpleDestinationRanges(source: string): Map<number, number> | undefined {
  const ranges = new Map<number, number>()
  if (!source.includes('](')) return ranges
  if (source.includes('\\') || source.includes('`') || source.includes('][')) return undefined
  let found = 0
  for (const match of source.matchAll(/\[[^\[\]\n]*\]\([^()\n]*\)/g)) {
    const target = match[0].indexOf('](') + 1
    if (match[0][1] === '^' || match[0].includes('|') || /[{<"]/.test(match[0].slice(target + 1, -1))) return undefined
    ranges.set(match.index! + target, match.index! + match[0].length)
    found++
  }
  let expected = 0
  for (let at = source.indexOf(']('); at !== -1; at = source.indexOf('](', at + 2)) expected++
  return found === expected ? ranges : undefined
}

export function djotDestinationRanges(source: string, mask: string): Map<number, number> {
  const ranges = new Map<number, number>()
  if (!source.includes('](')) return ranges
  const boundaries = djotInlineBoundaries(source, mask)
  const nextBracket = new Map<number, number>()
  let close = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (source[at] === '\n') close = -1
    else if (source[at] === ']' && !isDjotEscaped(source, at)) close = at
    if (at >= 2 && source[at - 1] === '[' && source[at - 2] === ']') nextBracket.set(at, close)
  }
  const angles = new Map(Array.from(source.matchAll(/<[^<>\s]+>/g), match => [match.index!, /[^:]@|[A-Za-z]:/.test(match[0]) ? match.index! + match[0].length : -1]))
  const tableCode = new Set<number>()
  let lineOffset = 0
  for (const line of source.split('\n')) {
    if (/^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\|/.test(line)) for (const run of line.matchAll(/`+/g)) tableCode.add(lineOffset + run.index!)
    lineOffset += line.length + 1
  }
  const labels: Array<{ at: number; slot: number; target?: number; parens: number }> = []
  let owner: typeof labels[number] | undefined, boundary = 0
  for (let at = 0; at < source.length; at++) {
    while ((boundaries[boundary] ?? source.length) <= at) { labels.length = 0; owner = undefined; boundary++ }
    if (owner && tableCode.has(at)) owner = undefined
    if (mask[at] !== source[at]) continue
    if (source[at] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) { at++; continue }
    const angle = angles.get(at)
    if (angle !== undefined && angle > at) { at = angle - 1; continue }
    if (source[at] === '{') { const attrs = readAttributes(source, at); if (attrs) { at = attrs.end - 1; continue } }
    if (source[at] === '[') { labels.push({ at, slot: labels.length, parens: 0 }); continue }
    const tip = labels.at(-1)
    if (!tip) continue
    if (source[at] === ']') {
      if (source[tip.at + 1] === '^') { labels.pop(); if (tip === owner) owner = undefined; continue }
      if (source[at + 1] === '[') {
        const end = nextBracket.get(at + 2) ?? -1
        if (end >= 0) { labels.pop(); if (tip === owner) owner = undefined; at = end }
        continue
      }
      if (source[at + 1] === '{' && readAttributes(source, at + 1)) { labels.pop(); if (tip === owner) owner = undefined; continue }
      if (source[at + 1] === '(') { tip.target = at + 1; tip.parens = 0; owner = tip; at++; continue }
    }
    if (!owner) continue
    if (source[at] === '(') owner.parens++
    else if (source[at] === ')') {
      if (owner.parens) { owner.parens--; continue }
      ranges.set(owner.target!, at + 1)
      labels.length = owner.slot
      owner = undefined
    }
  }
  return ranges
}
