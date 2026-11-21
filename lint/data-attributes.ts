import { type Node, type TableCellNode, type TableColumnNode } from '../src/ast.ts'
import { type AttributeSink, emptyMemo, readAttributeBlock } from '../src/attributes.ts'
import { braceBlockEnd, cellMarksLength, skipSpaces } from '../src/lines.ts'
import { CORE_SEMANTIC_KEYS } from '../src/options.ts'
import { quoteDepth, quotedStart } from './data-model.ts'
import { type LintContext } from './types.ts'

/** The nodes that carry `attrs` in visit order, with their paths and whether each is inline content. */
export interface Attributed { readonly nodes: Node[], readonly paths: string[], readonly inline: boolean[] }

/** C2-W-148: one part of an attribute block that a node took. */
export interface ModelAttribute {
  readonly kind: 'id' | 'class' | 'lang' | 'key'
  readonly key: string
  readonly value: string
  readonly start: number
  readonly key_end: number
  readonly end: number
  readonly text: string
  readonly index: number
  readonly last_key: boolean
  readonly kept: boolean
  readonly semantic: boolean
  readonly semantic_value: boolean
  readonly entries: number
  readonly entry_total: number
  readonly owner: AttributeOwner
}

const SPACE = 32
const TAB = 9

/** The fields of the node that an attribute record belongs to (`attribute_owner_fields`). */
export class AttributeOwner {
  readonly type: string
  readonly start: number
  readonly end: number
  private opener: number
  readonly node: Node
  readonly path: string
  readonly source: string
  private readonly context: LintContext
  private overlapCache: [string, string] | undefined = undefined
  private rowCache: [number, number, number] | undefined = undefined
  private formatCache: string | undefined = undefined

  /** C2-H-075: the semantic span keys, and whether the element carries the value. */
  readonly semantic: readonly (readonly [string, string | null])[]

  constructor(node: Node, path: string, context: LintContext, start: number, end: number, opener: number,
    semantic: readonly (readonly [string, string | null])[]) {
    this.semantic = semantic
    this.node = node
    this.path = path
    this.context = context
    this.source = context.source
    this.type = node.type === 'comment' && node.form === 'block' ? 'comment_block' : node.type
    this.start = start
    this.end = end
    this.opener = opener
  }

  /** Where a block's own text starts behind its attribute lines; a negative value names the line, read when asked. */
  get opener_start(): number {
    if (this.opener < 0) {
      const line = this.context.lines[-this.opener - 1]!
      this.opener = quotedStart(line, quoteDepth(this.path, this.context.nodeTypes as Map<string, string>))
    }
    return this.opener
  }

  get format(): string {
    return (this.formatCache ??= this.node.type === 'table' ? this.context.layouts.get(this.path)?.sourceFormat ?? '' : '')
  }
  get columns(): number { return this.node.type === 'table' ? this.node.columns.length : 0 }
  get head_rows(): number { return this.rows()[0] }
  get body_rows(): number { return this.rows()[1] }
  get foot_rows(): number { return this.rows()[2] }

  private rows(): [number, number, number] {
    return (this.rowCache ??= [groupRows(this.node, 'table_head'), groupRows(this.node, 'table_body'), groupRows(this.node, 'table_foot')])
  }
  get align_overlap(): string { return this.overlaps()[0] }
  get valign_overlap(): string { return this.overlaps()[1] }

  // C2-B-213: the columns where `aligns` or `valigns` and a mark of the first head row set the same axis.
  private overlaps(): [string, string] {
    if (this.overlapCache !== undefined) return this.overlapCache
    const align: number[] = []
    const valign: number[] = []
    const node = this.node
    const head = node.type === 'table' ? node.children.find((child) => child.type === 'table_head') : undefined
    const first = head?.type === 'table_head' ? head.children.find((child) => child.type === 'table_row') : undefined
    if (node.type === 'table' && first?.type === 'table_row') {
      node.columns.forEach((column: TableColumnNode, at) => {
        const cell = first.children[at] as TableCellNode | undefined
        if (cell === undefined) return
        if (column.align !== undefined && cell.align !== undefined) align.push(at + 1)
        else if (column.valign !== undefined && cell.valign !== undefined) valign.push(at + 1)
      })
    }
    return (this.overlapCache = [align.join(' '), valign.join(' ')])
  }
}

function groupRows(node: Node, type: string): number {
  if (node.type !== 'table') return 0
  let rows = 0
  for (const group of node.children) {
    if (group.type === type && 'children' in group) rows += group.children.filter((row) => row.type === 'table_row').length
  }
  return rows
}

/** C2-H-075 keys with those a registered extension adds (carve-js#5060). */
function semanticKeys(context: LintContext): readonly (readonly [string, string | null])[] {
  let keys = CORE_SEMANTIC_KEYS
  for (const entry of context.options.extensions ?? []) if (entry.semanticKeys !== undefined) keys = entry.semanticKeys
  return keys
}

// A handful of names: comparing them costs less than hashing each key that a source slice made.
function semanticOf(keys: readonly (readonly [string, string | null])[], key: string): readonly [string, string | null] | undefined {
  for (const entry of keys) if (entry[0].length === key.length && entry[0] === key) return entry
  return undefined
}

const DECIMAL = /^[ \t]*([0-9]+)(?:\.([0-9]+))?[ \t]*$/

const skipBlanks = (value: string, at: number): number => {
  while (value.charCodeAt(at) === SPACE || value.charCodeAt(at) === TAB) at++
  return at
}

/** The total so far in whole units and millionths; `at`: where the next entry starts, -1 after the last, -2 for no decimal. */
interface Total { whole: number, millionths: number, at: number }

/** C2-B-212: one entry, digits with at most one dot between them, added to `total`; `at` behind its comma, or -1. */
function addEntry(value: string, total: Total): void {
  let at = skipBlanks(value, total.at)
  const digits = at
  while (isDigit(value.charCodeAt(at))) at++
  if (at === digits) return void (total.at = -2)
  total.whole += Number(value.slice(digits, at))
  if (value.charCodeAt(at) === 46) {
    const from = ++at
    while (isDigit(value.charCodeAt(at))) at++
    if (at === from || at - from > 6) return void (total.at = at === from ? -2 : -3)
    total.millionths += Number(value.slice(from, at).padEnd(6, '0'))
  }
  at = skipBlanks(value, at)
  total.at = at === value.length ? -1 : value.charCodeAt(at) === 44 ? at + 1 : -2
}

/** C2-B-212: the exact sum of the entries, spaces around an entry ignored; 0 when one is no decimal number. */
function entryTotal(value: string): number {
  const total: Total = { whole: 0, millionths: 0, at: 0 }
  while (total.at >= 0) addEntry(value, total)
  if (total.at === -3) return exactTotal(value)
  if (total.at === -2) return 0
  return total.whole + Math.floor(total.millionths / 1_000_000) + (total.millionths % 1_000_000) / 1_000_000
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57

// More than six decimals: summed as integers, so a total a number cannot hold still compares right with a whole number.
function exactTotal(value: string): number {
  const entries: RegExpExecArray[] = []
  for (const entry of value.split(',')) {
    const match = DECIMAL.exec(entry)
    if (match === null) return 0
    entries.push(match)
  }
  const scale = Math.max(...entries.map((match) => match[2]?.length ?? 0))
  let total = 0n
  for (const match of entries) total += BigInt(match[1]! + (match[2] ?? '').padEnd(scale, '0'))
  const unit = 10n ** BigInt(scale)
  const sum = Number(total / unit) + Number(total % unit) / Number(unit)
  if (total % unit === 0n || sum !== Math.trunc(sum)) return sum
  // Rounded onto a whole number: step to the side the exact total lies on, so a comparison with it still holds.
  const step = Math.max(sum * Number.EPSILON, Number.MIN_VALUE)
  return total > BigInt(sum) * unit ? sum + step : sum - step
}

class AttributeRecord implements ModelAttribute {
  readonly kind: ModelAttribute['kind']
  readonly key: string
  readonly value: string
  readonly start: number
  readonly key_end: number
  readonly end: number
  index = 0
  last_key: boolean
  owner!: AttributeOwner

  constructor(kind: ModelAttribute['kind'], key: string, value: string, start: number, keyEnd: number, end: number) {
    this.kind = kind
    this.key = key
    this.value = value
    this.start = start
    this.key_end = keyEnd
    this.end = end
    this.last_key = kind === 'key'
  }

  get text(): string { return this.owner.source.slice(this.start, this.end) }
  get kept(): boolean { return this.kind === 'key' && kept(this.owner.node.attrs?.keyValues, this.key) }
  get semantic(): boolean { return this.kind === 'key' && semanticOf(this.owner.semantic, this.key) !== undefined }
  get semantic_value(): boolean { return this.kind === 'key' && (semanticOf(this.owner.semantic, this.key)?.[1] ?? null) !== null }
  get entries(): number {
    if (this.kind !== 'key') return 0
    let entries = 1
    for (let at = this.value.indexOf(','); at >= 0; at = this.value.indexOf(',', at + 1)) entries++
    return entries
  }
  get entry_total(): number { return this.kind === 'key' ? entryTotal(this.value) : 0 }
}

/** Where the parts of one owner go: only the kinds an active rule can match are kept, and every part counts for `index`. */
class Reader implements AttributeSink {
  readonly source: string
  readonly out: AttributeRecord[]
  readonly kinds: ReadonlySet<string> | undefined
  index = 0

  constructor(source: string, out: AttributeRecord[], kinds: ReadonlySet<string> | undefined) {
    this.source = source
    this.out = out
    this.kinds = kinds
  }

  private part(kind: ModelAttribute['kind'], key: string, value: string, start: number, keyEnd: number, end: number): void {
    const index = this.index++
    if (this.kinds !== undefined && !this.kinds.has(kind)) return
    const record = new AttributeRecord(kind, key, value, start, keyEnd, end)
    record.index = index
    this.out.push(record)
  }

  id(name: string, start = 0, end = 0): void { this.part('id', '', name, start, end, end) }
  className(name: string, start = 0, end = 0): void { this.part('class', '', name, start, end, end) }
  lang(tag: string, start = 0, end = 0): void { this.part('lang', '', tag, start, end, end) }
  key(key: string, value: string, start = 0, keyEnd = 0, end = 0): void { this.part('key', key, value, start, keyEnd, end) }

  /**
   * The run of glued valid blocks at `from`, read with the attribute grammar as `attributeBlocksEnd` reads it, its
   * parts taken; in a cell prefix the first block may open with alignment marks (C2-B-182). Returns the end of the run.
   */
  run(from: number, end: number, cell: boolean): number {
    const memo = emptyMemo()
    for (let at = from; ;) {
      const blockEnd = braceBlockEnd(this.source, at, end)
      if (blockEnd < 0) return at
      const marks = cell && at === from ? cellMarksLength(this.source, at) : 0
      const kept = this.out.length
      const index = this.index
      const marksOnly = marks > 0 && skipSpaces(this.source, at + 1 + marks, blockEnd) === blockEnd - 1
      if (!marksOnly && readAttributeBlock(this.source, at + marks, blockEnd, memo, this) !== blockEnd) {
        this.rollback(kept, index)
        return at
      }
      at = blockEnd
    }
  }

  rollback(length: number, index: number): void {
    this.out.length = length
    this.index = index
  }
}

function trimmedEnd(source: string, from: number, end: number): number {
  while (end > from && (source.charCodeAt(end - 1) === SPACE || source.charCodeAt(end - 1) === TAB)) end--
  return end
}

/**
 * C2-B-090, C2-B-091, C2-B-102: the attribute lines at the start of a block, read behind the prefixes of its quotes.
 * Returns where the block's own text starts, or minus the number of its line when that is read later.
 */
function lineParts(reader: Reader, node: Node, start: number, path: string, context: LintContext): number {
  const pos = node.pos!
  let marks = -1
  let from = start
  for (let number = pos.startLine; number <= pos.endLine; number++) {
    const line = context.lines[number - 1]
    if (line === undefined) break
    if (number > pos.startLine) {
      // Behind every quote mark the line does not start with a brace, so behind fewer it does not either.
      if (context.source.charCodeAt(quotedStart(line)) !== 123) return -number
      if (marks < 0) marks = quoteDepth(path, context.nodeTypes as Map<string, string>)
      from = quotedStart(line, marks)
    }
    const end = trimmedEnd(context.source, from, line.start + line.text.length)
    if (context.source.charCodeAt(from) !== 123) return from
    // C2-B-090: glued valid blocks and nothing else on the line.
    const kept = reader.out.length
    const index = reader.index
    if (reader.run(from, end, false) !== end) {
      reader.rollback(kept, index)
      return from
    }
  }
  return start
}

/** C2-B-101, C2-B-171: the run of glued blocks that abuts the marker of an item or a cell. */
function markerParts(reader: Reader, start: number, end: number, cell: boolean): void {
  const source = reader.source
  let at = start
  if (cell) {
    if (source.charCodeAt(at) === 124) at++
    if (source.charCodeAt(at) === 61) at++
  } else {
    for (let code = source.charCodeAt(at); at < end && code !== 123 && code > SPACE; code = source.charCodeAt(++at));
  }
  if (source.charCodeAt(at) === 123) reader.run(at, end, cell)
}

/** C2-I-036: the run of glued blocks that ends at the end of an inline node. */
function inlineParts(reader: Reader, start: number, end: number): void {
  const source = reader.source
  if (source.charCodeAt(end - 1) !== 125) return
  const kept = reader.out.length
  for (let at = source.indexOf('{', start + 1); at >= 0 && at < end; at = source.indexOf('{', at + 1)) {
    if (reader.run(at, end, false) === end) return
    reader.rollback(kept, 0)
  }
}

const MARKER_OWNERS: ReadonlySet<string> = new Set(['list_item', 'table_cell'])

function kept(keyValues: readonly (readonly [string, string])[] | undefined, key: string): boolean {
  if (keyValues === undefined) return false
  for (const pair of keyValues) if (pair[0] === key) return true
  return false
}

const SPAN_KEYS: ReadonlySet<string> = new Set(['abbr', 'time', 'kbd'])

/** C2-I-039, C2-A-035: whether two keys of one owner have the name the tree merges by (`keyIdentity`). */
function sameName(a: string, b: string, span: boolean): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  const lower = a.toLowerCase()
  if (lower !== b.toLowerCase()) return false
  return !span || (a === lower && SPAN_KEYS.has(lower)) === (b === lower && SPAN_KEYS.has(lower))
}

/** The fields a record takes from its owner and from the later parts of that owner. */
function finish(records: AttributeRecord[], first: number, owner: AttributeOwner): void {
  let keys = 0
  for (let at = first; at < records.length; at++) {
    const record = records[at]!
    record.owner = owner
    if (record.kind === 'key') keys++
  }
  if (keys < 2) return
  // C2-I-039: a later key replaces an earlier one of the same name.
  const span = owner.type === 'span'
  for (let at = first; at < records.length; at++) {
    const record = records[at]!
    if (record.kind !== 'key') continue
    for (let later = at + 1; later < records.length; later++) {
      const other = records[later]!
      if (other.kind === 'key' && sameName(record.key, other.key, span)) {
        record.last_key = false
        break
      }
    }
  }
}

/**
 * The attribute records of the visited nodes, in source order within each owner. `kinds`: the record kinds that the
 * active rules can match; the parts of other kinds count for `index` but make no record.
 */
export function attributeRecords(attributed: Attributed, context: LintContext, kinds?: ReadonlySet<string>): ModelAttribute[] {
  const records: AttributeRecord[] = []
  const reader = new Reader(context.source, records, kinds)
  let semantic: readonly (readonly [string, string | null])[] | undefined
  for (let item = 0; item < attributed.nodes.length; item++) {
    const node = attributed.nodes[item]!
    const path = attributed.paths[item]!
    if (node.pos === undefined) continue
    const start = context.chars[node.pos.startOffset] ?? 0
    const end = context.chars[node.pos.endOffset] ?? context.source.length
    const first = records.length
    reader.index = 0
    let opener = start
    if (attributed.inline[item]) inlineParts(reader, start, end)
    else if (MARKER_OWNERS.has(node.type)) markerParts(reader, start, end, node.type === 'table_cell')
    else opener = lineParts(reader, node, start, path, context)
    if (records.length === first) continue
    const owner = new AttributeOwner(node, path, context, start, end, opener, semantic ??= semanticKeys(context))
    finish(records, first, owner)
  }
  return records
}
