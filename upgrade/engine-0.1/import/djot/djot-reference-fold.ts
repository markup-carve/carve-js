import { readAttributes } from './djot-attributes.js'
import { maskDjotCodeAndDestinations, maskDjotFences, djotContentStart, djotTableRows } from '../../djot-migrate.js'

export type AcceptedDjotReference = { label: string; target: string; end: number }

type DefinitionOwner = { start: number; depth: number }
type ReferenceLine = {
  n: number
  line: string
  depth: number
  at: number
  content: string
  definition: RegExpExecArray | null
  noteAt: number
  ownerMarker: RegExpExecArray | null
  physicalPrefix: string
  marker: boolean
}
type LineOwnership = {
  owner: DefinitionOwner | undefined
  ownerExit: boolean
  metadataExit: boolean
  boundary: boolean
  rowEntry: boolean
}

const REFERENCE_DEFINITION = /^\[(?!\^[^\]\n]+\]:(?:[ \t\r]|$))([^\]\n]*)\]:[ \t]*([^ \t\r\n]*)\r?$/
const PHYSICAL_PREFIX = /^(?:[ \t]*>(?:[ \t]|$))*[ \t]*/
const ITEM_MARKER = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/
const ITEM_OR_DEFINITION_MARKER = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/
const PREVIOUS_BLOCK_START = /^(?:#{1,6} |:{3,}|[`~]{3,}|\[[^\]]*\]:|(?:[-*][ \t]*){3,}$)/
const OWNER_CLOSING_BLOCK = /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|(?:[-*][ \t]*){3,}$)/
const CODE_FENCE_OPENER = /^(?:`{3,}|~{3,})[ \t]*=?[A-Za-z0-9_+#.-]*[ \t]*$/

/**
 * Folds Djot reference definitions whose destination continues on following lines
 * into one line, escapes `]:` where Djot would not read a definition, and records
 * the definitions it accepts.
 */
export function foldDjotReferences(source: string, accepted?: Map<number, AcceptedDjotReference>, originalMask?: string, originalRows?: readonly boolean[]): string {
  if (!source.includes(']:')) return source
  return new DjotReferenceFolder(source, accepted, originalMask, originalRows).fold()
}

class DjotReferenceFolder {
  private readonly lines: string[]
  private readonly mask: string
  private readonly rows: boolean[]
  private readonly removed = new Set<number>()
  private readonly owners: DefinitionOwner[] = []
  private fenceMask: string | undefined
  private offset = 0
  private previous = ''
  private previousDepth = 0
  private previousAttributeBlock = false

  constructor(
    private readonly source: string,
    private readonly accepted?: Map<number, AcceptedDjotReference>,
    originalMask?: string,
    originalRows?: readonly boolean[],
  ) {
    this.lines = source.split('\n')
    this.mask = originalMask ?? maskDjotCodeAndDestinations(source, false, true, false)
    this.rows = originalRows ? [...originalRows] : djotTableRows(source, this.mask)
  }

  fold(): string {
    for (let n = 0; n < this.lines.length; n++) n = this.foldLine(n)
    return this.lines.filter((_line, n) => !this.removed.has(n)).join('\n')
  }

  /** Rewrites line `n` and returns the last line it consumed. */
  private foldLine(n: number): number {
    const facts = this.readLine(n)
    const ownership = this.trackOwners(facts)
    const separator = this.separator(facts, ownership)
    if (separator) this.lines[n] = separator + facts.line
    const opens = ownership.boundary || facts.marker
    let last = n
    if (facts.definition && this.definitionVisible(facts, ownership.metadataExit) && opens) last = this.foldDefinition(facts, facts.definition, separator)
    this.escapeRejectedDefinition(facts, opens)
    const attrs = facts.content[0] === '{' ? readAttributes(facts.content, 0) : undefined
    this.previousAttributeBlock = opens && attrs?.end === facts.content.trimEnd().length
    this.previous = facts.content.trim()
    this.previousDepth = facts.depth
    this.offset += facts.line.length + 1
    return last
  }

  private readLine(n: number): ReferenceLine {
    const line = this.lines[n]!, at = djotContentStart(line), content = line.slice(at)
    const prefix = line.slice(0, at)
    const noteAt = prefix.indexOf('[^')
    const depth = quoteDepth(line)
    const definition = REFERENCE_DEFINITION.exec(content)
    const ownerMarker = noteAt < 0 ? ITEM_MARKER.exec(prefix) : null
    const physicalPrefix = PHYSICAL_PREFIX.exec(line)![0]
    const marker = ITEM_OR_DEFINITION_MARKER.test(noteAt < 0 ? prefix : prefix.slice(0, noteAt))
    return { n, line, depth, at, content, definition, noteAt, ownerMarker, physicalPrefix, marker }
  }

  /** Closes the item or note owners this line leaves and opens the one it starts. */
  private trackOwners(facts: ReferenceLine): LineOwnership {
    const { n, depth, at, content, definition } = facts
    const owner = this.owners.at(-1)
    const ownerExit = owner !== undefined && this.leavesOwner(owner, facts)
    const metadata = definition !== null || content.startsWith('{') && readAttributes(content, 0)?.end === content.trimEnd().length
    if (ownerExit && metadata && this.mask[this.offset + at] === ' ') this.fenceMask ??= maskDjotFences(this.source, undefined, this.rows, true)
    const metadataExit = ownerExit && metadata && (this.mask[this.offset + at] !== ' ' || this.fenceMask?.[this.offset + at] !== ' ')
    const boundary = this.startsBlock(n, depth, metadataExit, at)
    const boundaryRow = this.isBoundaryRow(facts, ownerExit)
    const rowEntry = boundaryRow && ownerExit && !this.rows[n]
    if (boundaryRow) this.rows[n] = true
    const closed = metadataExit || this.previous === '' || this.closesOwner(facts, boundaryRow) || !!this.rows[n - 1]
    if (ownerExit && closed) this.popLeftOwners(facts)
    if (boundary) this.openOwner(facts)
    return { owner, ownerExit, metadataExit, boundary, rowEntry }
  }

  private popLeftOwners(facts: ReferenceLine): void {
    while (this.owners.at(-1) && this.leavesOwner(this.owners.at(-1)!, facts)) this.owners.pop()
  }

  /** A note head or list marker on a block-starting line owns the definitions indented under it. */
  private openOwner(facts: ReferenceLine): void {
    if (facts.noteAt < 0 && facts.ownerMarker === null) return
    const start = facts.noteAt >= 0 ? facts.noteAt : facts.ownerMarker!.index
    const top = this.owners.at(-1)
    if (this.mask[this.offset + start] !== ' ' && (top?.start !== start + 1 || top?.depth !== facts.depth)) this.owners.push({ start: start + 1, depth: facts.depth })
  }

  private leavesOwner(owner: DefinitionOwner, facts: ReferenceLine): boolean {
    return facts.depth < owner.depth || facts.depth === owner.depth && facts.physicalPrefix.length < owner.start
  }

  /** Whether line `n` may start a block, judged from the line before it. */
  private startsBlock(n: number, depth: number, metadataExit: boolean, at: number): boolean {
    const previousLine = this.lines[n - 1] ?? '', previousAt = djotContentStart(previousLine)
    const previousNote = previousLine.slice(0, previousAt).indexOf('[^')
    const previousOwner = previousNote < 0 ? previousAt : previousNote + 1
    const outdented = metadataExit || at < previousOwner && ITEM_MARKER.test(previousLine.slice(0, previousNote < 0 ? previousAt : previousNote))
    return this.previous === '' || this.previousAttributeBlock || this.rows[n - 1]! || depth !== this.previousDepth ||
      /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-*][ \t]*){3,}$/.test(previousLine) || outdented || PREVIOUS_BLOCK_START.test(this.previous)
  }

  private isBoundaryRow(facts: ReferenceLine, ownerExit: boolean): boolean {
    const { n, line, physicalPrefix } = facts
    const rowEnd = line.trimEnd().length - 1, rowStart = physicalPrefix.length
    const afterRowOrOwner = ownerExit || !!this.rows[n - 1]
    return afterRowOrOwner && line[rowStart] === '|' && rowEnd > rowStart &&
      this.mask[this.offset + rowStart] === '|' && this.mask[this.offset + rowEnd] === '|' && line[rowEnd - 1] !== '\\'
  }

  private closesOwner(facts: ReferenceLine, boundaryRow: boolean): boolean {
    const { n, line, physicalPrefix } = facts
    const body = line.slice(physicalPrefix.length)
    return boundaryRow || OWNER_CLOSING_BLOCK.test(body) && this.mask[this.offset + physicalPrefix.length] !== ' ' || this.rows[n]! || CODE_FENCE_OPENER.test(body)
  }

  /** The blank quote line inserted when metadata or a table row leaves its owner. */
  private separator(facts: ReferenceLine, ownership: LineOwnership): string {
    const { n, definition, marker } = facts
    const { ownerExit, metadataExit, rowEntry, owner } = ownership
    const separates = metadataExit && !marker || rowEntry || definition !== null && this.rows[n - 1] && !marker && (ownerExit || owner === undefined)
    return separates && this.previous !== '' ? facts.physicalPrefix + '\n' : ''
  }

  private definitionVisible(facts: ReferenceLine, metadataExit: boolean): boolean {
    const at = this.offset + facts.at
    return this.mask[at] === '[' || metadataExit && this.fenceMask?.[at] === '['
  }

  /** Joins destination continuation lines into line `n` and returns the last one joined. */
  private foldDefinition(facts: ReferenceLine, definition: RegExpExecArray, separator: string): number {
    const { n, line, depth, at, content } = facts
    let target = definition[2] ?? '',
      end = n
    while (end + 1 < this.lines.length) {
      const token = this.continuationToken(this.lines[end + 1]!, depth, at)
      if (token === undefined) break
      target += token
      end++
    }
    this.accepted?.set(n, { label: definition[1]!, target, end })
    const nextByte = content[definition[1]!.length + 3]
    if (end > n || target !== '' && nextByte !== ' ')
      this.lines[n] = separator + line.slice(0, at) + `[${definition[1]}]:${target ? ' ' + target : ''}`
    for (let k = n + 1; k <= end; k++) {
      this.offset += this.lines[k]!.length + 1
      this.removed.add(k)
    }
    return end
  }

  private continuationToken(next: string, depth: number, at: number): string | undefined {
    const nextAt = djotContentStart(next)
    const nextPrefix = next.slice(0, nextAt), nextToken = next.slice(nextAt).replace(/\r$/, '')
    if (quoteDepth(next) !== depth || nextAt <= at || nextPrefix.includes('[^') || ITEM_OR_DEFINITION_MARKER.test(nextPrefix) || !/^[^ \t\r\n]+$/.test(nextToken)) return undefined
    return nextToken
  }

  private escapeRejectedDefinition(facts: ReferenceLine, opens: boolean): void {
    const { n, line, at, content, definition } = facts
    const invalidDefinition = definition === null && /^\[(?!\^)[^\]\n]*\]:/.test(content)
    if ((invalidDefinition || definition && !opens) && this.mask[this.offset + at] === '[') this.lines[n] = line.slice(0, at) + line.slice(at).replace(']:', ']\\:')
  }
}

function quoteDepth(line: string): number {
  let depth = 0
  let content = line
  while (true) {
    const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(content)
    if (!prefix) return depth
    depth++
    content = content.slice(prefix[0].length)
  }
}
