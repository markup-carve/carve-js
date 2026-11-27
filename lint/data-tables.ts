// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.
import { type RuleId } from './catalog.ts'
import { type ModelAttribute } from './data-attributes.ts'
import { isAttributeLine } from '../src/lines.ts'
import { foldLabel } from '../src/ast-attributes.ts'
import { foldKey } from '../src/case-fold.ts'
import { columnOf } from '../src/layout-lines.ts'
import { type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { linearPattern, type Pattern } from './linear-patterns.ts'
import { type LintContext } from './types.ts'
import { idExtensions } from './extension-ids.ts'

let groups: Record<string, [number, number]> | undefined
let base = 0
const UNSET: unique symbol = Symbol('unset')

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number => Number(value)
const same = (a: unknown, b: unknown): boolean => a === b
const trimEnd = (text: string): string => {
  let end = text.length
  while (end > 0 && (text.charCodeAt(end - 1) === 32 || text.charCodeAt(end - 1) === 9)) end--
  return text.slice(0, end)
}
const test = (regex: RegExp | Pattern, value: unknown): boolean => typeof value === 'string' && regex.test(value)
const starts = (value: unknown, prefix: string): boolean => typeof value === 'string' && value.startsWith(prefix)

function spansOf(found: RegExpExecArray | RegExpMatchArray): Record<string, [number, number]> {
  const spans: Record<string, [number, number]> = {}
  const all = found.indices?.groups
  if (all === undefined) return spans
  for (const name in all) {
    const span = all[name]
    if (span !== undefined) spans[name] = span
  }
  return spans
}

// The last text each pattern tested, with its spans: the rules of one line test its text against their patterns in turn.
const lastHits = new Map<RegExp | Pattern, { value: string, spans: Record<string, [number, number]> | undefined }>()

// The lines of one leaf often test the same text against the same pattern, as a block's opener line.
function hit(regex: RegExp | Pattern, spans: RegExp | Pattern, value: unknown): boolean {
  if (typeof value !== 'string') return false
  let last = lastHits.get(regex)
  if (last !== undefined && last.value === value) {
    if (last.spans === undefined) return false
    groups = last.spans
    return true
  }
  if (last === undefined) lastHits.set(regex, last = { value, spans: undefined })
  else {
    last.value = value
    last.spans = undefined
  }
  // spans is regex with indices, so one exec tells both.
  if (!(spans instanceof RegExp) && spans.spans !== undefined) {
    const found = spans.spans(value)
    if (found === null) return false
    last.spans = found
  } else {
    const found = spans.exec(value)
    if (found === null) return false
    last.spans = spansOf(found)
  }
  groups = last.spans
  return true
}

const matchAll = (regex: RegExp | Pattern, value: unknown): Iterable<RegExpExecArray> => {
  if (typeof value !== 'string') return []
  return regex instanceof RegExp ? value.matchAll(regex) : regex.matchAll(value)
}

const PAIR_SPACE = /[\p{Zs}\t\n\r]/u

function behindBackslashes(text: string, at: number): boolean {
  let slashes = 0
  while (text.charCodeAt(at - 1 - slashes) === 92) slashes++
  return slashes % 2 === 1
}

// The width of the character that ends at an offset and of the one that starts there: a surrogate pair is one.
function widthBefore(text: string, at: number): number {
  if (at === 0) return 0
  const low = text.charCodeAt(at - 1)
  return at >= 2 && low >= 0xDC00 && low <= 0xDFFF && text.charCodeAt(at - 2) >= 0xD800 && text.charCodeAt(at - 2) <= 0xDBFF ? 2 : 1
}
const widthAt = (text: string, at: number): number => (at >= text.length ? 0 : text.codePointAt(at)! > 0xFFFF ? 2 : 1)

const JOINED = /^[\p{M}\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u
const EDGE = /^[\p{Zs}\t\n\r\f\v]$/u
const WORD = /^[\p{L}\p{N}]$/u

const joinedAt = (text: string, at: number): boolean => JOINED.test(text.slice(at, at + 2))

// C2-W-147, strict: an opener that cannot open a bare pair is passed without taking a closer.
function strictOpener(text: string, mark: string, start: number): boolean {
  const after = text[start + mark.length]
  const before = text.slice(start - widthBefore(text, start), start)
  return !joinedAt(text, start + mark.length) && !behindBackslashes(text, start) && text[start - 1] !== mark[0]
    && after !== undefined && !EDGE.test(after) && after !== mark[0] && (mark.length === 2 || !WORD.test(before))
}

// C2-W-147: the pair scan; each pair also gives the contiguous backslash run before open.
function* pairsOf(value: unknown, mark: string, strict: boolean): Generator<Record<string, [number, number]>> {
  if (typeof value !== 'string') return
  const width = mark.length
  let at = 0
  while (at < value.length) {
    const start = value.indexOf(mark, at)
    if (start < 0) return
    if (strict && !strictOpener(value, mark, start)) {
      at = start + width
      continue
    }
    let end = value.indexOf(mark, start + width + 1)
    while (end >= 0 && (PAIR_SPACE.test(value[end - 1] ?? '') || behindBackslashes(value, end)
      || (strict && joinedAt(value, end + width)))) end = value.indexOf(mark, end + width)
    if (end < 0) return
    const after = end + width
    let slashStart = start
    while (value.charCodeAt(slashStart - 1) === 92) slashStart--
    yield { backslashes: [slashStart, start], open: [start, start + width], inner: [start + width, end], close: [end, after],
      before: [start - widthBefore(value, start), start], after: [after, after + widthAt(value, after)] }
    at = after
  }
}

function mark(at: number): boolean {
  base = at
  return true
}

function group(name: string, side: 0 | 1): number | undefined {
  const span = groups?.[name]
  return span === undefined ? undefined : base + span[side]
}

function contains(haystack: unknown, needle: unknown): boolean {
  if (Array.isArray(haystack)) return haystack.includes(needle)
  return typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle)
}

function someFrom(list: unknown, from: number, where: (item: unknown) => boolean): boolean {
  if (!Array.isArray(list)) return false
  for (let index = from; index < list.length; index++) if (where(list[index])) return true
  return false
}

function countFrom(list: unknown, from: number, where: (item: unknown) => boolean): number {
  if (!Array.isArray(list)) return 0
  let found = 0
  for (let index = from; index < list.length; index++) if (where(list[index])) found++
  return found
}

interface Located { readonly start: number }

type Over = 'block' | 'inline' | 'id' | 'line'
let lookupRecords: Record<Over, readonly Located[]> = { block: [], inline: [], id: [], line: [] }
let lookupSites = new Map<number, Map<unknown, Located[]>>()
let lineRecords: () => readonly Located[] = () => []
let idRecords: () => readonly Located[] = () => []
let idsRead = false
// Per kind of record, the positions of the records of each type, in document order.
let typePositions = new Map<Over, Map<string, number[]>>()
let selectedRecords = new Map<Over, WeakMap<ReadonlySet<string>, readonly Located[]>>()

/** The records of one document that the lookups read, in document order; the line records are made when a lookup reads them. */
export function useRecords(block: readonly Located[], inline: readonly Located[], id: () => readonly Located[] = () => [],
  line: () => readonly Located[] = () => []): void {
  lookupRecords = { block, inline, id: [], line: [] }
  lineRecords = line
  idRecords = id
  idsRead = false
  lookupSites = new Map()
  typePositions = new Map()
  selectedRecords = new Map()
}

function recordsOf(over: Over, types: ReadonlySet<string>): readonly Located[] {
  let selected = selectedRecords.get(over)
  if (selected === undefined) selectedRecords.set(over, selected = new WeakMap())
  const cached = selected.get(types)
  if (cached !== undefined) return cached
  const records = lookupRecords[over]
  let byType = typePositions.get(over)
  if (byType === undefined) {
    const positions = byType = new Map<string, number[]>()
    records.forEach((record, at) => {
      const type = (record as { type?: string }).type ?? ''
      const list = positions.get(type)
      if (list === undefined) positions.set(type, [at])
      else list.push(at)
    })
    typePositions.set(over, byType)
  }
  const lists = [...types].map((type) => byType.get(type) ?? [])
  const positions = lists.length === 1 ? lists[0]! : lists.flat().sort((a, b) => a - b)
  const result = positions.map((at) => records[at]!)
  selected.set(types, result)
  return result
}

// C2-W-141: the first record of the types whose key equals the value, the last one that starts before the record
// (side -1) or the first one that starts after it (side 1).
function lookupIndex(site: number, over: Over, types: ReadonlySet<string> | undefined,
  key: ((item: unknown) => unknown) | undefined): Map<unknown, Located[]> {
  let index = lookupSites.get(site)
  if (index === undefined) {
    index = new Map()
    if (over === 'line' && lookupRecords.line.length === 0) lookupRecords.line = lineRecords()
    if (over === 'id' && !idsRead) {
      lookupRecords.id = idRecords()
      idsRead = true
    }
    for (const record of types === undefined ? lookupRecords[over] : recordsOf(over, types)) {
      // C2-W-150: a lookup with no types reads every block or every inline node; a text run is no node.
      if (types === undefined && (record as { type?: string }).type === 'text_run') continue
      const found = key === undefined ? undefined : key(record)
      const list = index.get(found)
      if (list === undefined) index.set(found, [record])
      else list.push(record)
    }
    lookupSites.set(site, index)
  }
  return index
}

// C2-W-150: with all, every record of the types whose key equals the value, in document order.
function lookupAll(site: number, over: Over, types: ReadonlySet<string> | undefined,
  key: ((item: unknown) => unknown) | undefined, value: unknown, filter?: (item: unknown) => boolean): readonly Located[] {
  const list = lookupIndex(site, over, types, key).get(value) ?? []
  return filter === undefined ? list : list.filter(filter)
}

function lookupAt(site: number, over: Over, types: ReadonlySet<string> | undefined, key: ((item: unknown) => unknown) | undefined,
  value: unknown, start: number, side: -1 | 0 | 1, filter?: (item: unknown) => boolean): Located | undefined {
  const found = lookupIndex(site, over, types, key).get(value)
  if (found === undefined) return undefined
  if (side === 0) return filter === undefined ? found[0] : found.find(filter)
  let low = 0
  let high = found.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (side < 0 ? found[middle]!.start < start : found[middle]!.start <= start) low = middle + 1
    else high = middle
  }
  if (side < 0) {
    for (let at = low - 1; at >= 0; at--) if (filter === undefined || filter(found[at]!)) return found[at]
  } else {
    for (let at = low; at < found.length; at++) if (filter === undefined || filter(found[at]!)) return found[at]
  }
  return undefined
}

function findIn(list: unknown, where: (item: unknown) => boolean): unknown {
  if (!Array.isArray(list)) return undefined
  for (const item of list) if (where(item)) return item
  return undefined
}


// C2-W-150: X, X and Y, X, Y, and Z; each item between the given marks.
function listOf(list: unknown, mark: string): string {
  if (!Array.isArray(list)) return ''
  const items = list.map((item) => mark + String(item) + mark)
  if (items.length < 3) return items.join(' and ')
  return items.slice(0, -1).join(', ') + ', and ' + items.at(-1)!
}

// C2-W-150: %HH decoded as UTF-8; a text in which that fails stays as written.
function percentDecode(text: string): string {
  try { return decodeURIComponent(text) }
  catch { return text }
}

function runValue(context: LintContext, name: string): unknown {
  return name === 'id_extensions' ? idExtensions(context.options.extensions) : undefined
}

// C2-W-141, C2-W-150: the offset of a text in a text, or the index of an item in a list; -1 where there is none.
function indexOf(haystack: unknown, needle: unknown): number {
  if (Array.isArray(haystack)) return haystack.indexOf(needle)
  return typeof haystack === 'string' && typeof needle === 'string' ? haystack.indexOf(needle) : -1
}

// C2-B-004: the column of an offset, counted after the given number of quote marks of its line, with tab stops.
const columnAt = (context: LintContext, offset: number, quotes: number): number => columnOf(context.source, offset, quotes)

const lenOf = (value: unknown): number => (typeof value === 'string' || Array.isArray(value) ? value.length : 0)

const obj = (value: unknown): Record<string | number, unknown> | undefined =>
  (value !== null && typeof value === 'object' ? value as Record<string | number, unknown> : undefined)

const atEnd = (value: unknown, index: number): unknown => (Array.isArray(value) ? value[value.length + index] : obj(value)?.[index])

const nthOf = (value: unknown, index: number): unknown => (index < 0 ? atEnd(value, index) : obj(value)?.[index])

const textFrom = (line: ModelLine, from: number): string => trimEnd(line.text.slice(from - line.start))

function scan(line: ModelLine, from: number, chars: string, step: -1 | 1): number {
  let at = from - line.start
  if (step < 0) while (at > 0 && chars.includes(line.text[at - 1]!)) at--
  else while (at < line.text.length && chars.includes(line.text[at]!)) at++
  return line.start + at
}

const K0 = new RegExp("^!\\[\\]", "")
const K1 = new Set<unknown>(["heading","paragraph"])
const K2 = new Set<unknown>(["table_cell","table_row"])
const K3 = new RegExp("^(?:[^<]|(?:<<)*(?:<<(?:[^<]|$)|<(?:[^!<]|$|!(?:[^-]|$)|!-(?:[^-]|$)|!--(?:[^-\\n\\r\\u{2028}\\u{2029}]|-[^-\\n\\r\\u{2028}\\u{2029}]|--+[^->\\n\\r\\u{2028}\\u{2029}])*--+>)))*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)", "u")
const K4 = new RegExp("^(?:[^<]|(?:<<)*(?:<<(?:[^<]|$)|<(?:[^!<]|$|!(?:[^-]|$)|!-(?:[^-]|$)|!--(?:[^-\\n\\r\\u{2028}\\u{2029}]|-[^-\\n\\r\\u{2028}\\u{2029}]|--+[^->\\n\\r\\u{2028}\\u{2029}])*--+>)))*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)", "du")
const K5 = new RegExp("(?<label>\\[(?<caret>\\^)?[ \\t\\n]+\\])", "gd")
const K6 = linearPattern("^[ \\t]*(?:> [ \\t]*)*(?<c>.*?)[ \\t]*$")
const K7 = (item: unknown): unknown => (!same(obj(item)?.["type"], "text") ? obj(item)?.["start"] : false)
const K8 = new Set<unknown>(["caption","definition_term","heading","line","paragraph"])
const K9 = new RegExp("^:{3,}\\S", "")
const K10 = new RegExp("^\\{[.#_A-Za-z]", "")
const K11 = new Set<unknown>(["admonition","directive","div","figure_group"])
const K12 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "")
const K13 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "d")
const K14 = new Set<unknown>(["caption","paragraph"])
const K15 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "")
const K16 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "d")
const K17 = new RegExp("^>(?: |$)", "")
const K18 = new RegExp("^(?<mark>>)(?:[ \\x00]|$)", "")
const K19 = new RegExp("^(?<mark>>)(?:[ \\x00]|$)", "d")
const K20 = new RegExp("^(?<mark>::) ", "")
const K21 = new RegExp("^(?<mark>::) ", "d")
const K22 = new RegExp("^(?<mark>:) ", "")
const K23 = new RegExp("^(?<mark>:) ", "d")
const K24 = new Set<string>(["caption","paragraph"])
const K25 = (item: unknown): unknown => obj(item)?.["start"]
const K26 = new RegExp("^(?<mark>\\*?\\[.*?\\]:)", "")
const K27 = new RegExp("^(?<mark>\\*?\\[.*?\\]:)", "d")
const K28 = new RegExp("^>[^ ]", "")
const K29 = new RegExp("^> ", "")
const K30 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell"])
const K31 = new RegExp("^\\{%\\s*(?:(?:raw|endraw|endif|endfor|endblock)\\s*|(?:if|for|block)\\s+\\S[\\s\\S]*)%\\}$", "")
const K32 = new Set<string>(["id"])
const K33 = (item: unknown): unknown => str(obj(item)?.["id"]).normalize('NFC')
const K34 = (item: unknown): unknown => (Boolean(obj(item)?.["xref"]) ? foldKey(str(obj(item)?.["id"])) : false)
const K35 = (item: unknown): unknown => (Boolean(obj(item)?.["xref"]) ? str(obj(item)?.["id"]).normalize('NFC') : false)
const K36 = (item: unknown): unknown => ((Boolean(obj(item)?.["rendered"])) ? foldKey(str(obj(item)?.["id"])) : false)
const K37 = (item: unknown): unknown => (Boolean(obj(item)?.["rendered"]) ? obj(item)?.["id"] : false)
const K38 = new RegExp("^(?:\\*?\\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\\s+\\d+)?\\s*:|:\\s+\\S)", "i")
const K39 = new RegExp("(?:^|\\n)[ \\t]*(?:carve|carve-version):[ \\t]*(?<v>0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)[ \\t]*(?:\\n|$)", "")
const K40 = new RegExp("(?:^|\\n)[ \\t]*(?:carve|carve-version):[ \\t]*(?<v>0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)[ \\t]*(?:\\n|$)", "d")
const K41 = new RegExp("(?:^|\\n)[ \\t]*(?:carve|carve-version):[ \\t]*(?<v>\\S*[^\\d.\\s]\\S*|\\.\\S*|\\S*\\.|\\S*\\.\\.\\S*|0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)[ \\t]*(?:\\n|$)", "")
const K42 = new RegExp("(?:^|\\n)[ \\t]*(?:carve|carve-version):[ \\t]*(?<v>\\S*[^\\d.\\s]\\S*|\\.\\S*|\\S*\\.|\\S*\\.\\.\\S*|0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)[ \\t]*(?:\\n|$)", "d")
const K43 = new RegExp("^%%.*?carve-version:[ \\t]*(?<v>0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)(?:[ \\t;]|$)", "")
const K44 = new RegExp("^%%.*?carve-version:[ \\t]*(?<v>0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)(?:[ \\t;]|$)", "d")
const K45 = (item: unknown): unknown => !Boolean(obj(item)?.["blank"])
const K46 = new Set<string>(["frontmatter"])
const K47 = new RegExp("(?:^|\\n)[ \\t]*(?:carve|carve-version):[ \\t]*(?<v>\\S+)[ \\t]*(?:\\n|$)", "")
const K48 = new RegExp("(?:^|\\n)[ \\t]*(?:carve|carve-version):[ \\t]*(?<v>\\S+)[ \\t]*(?:\\n|$)", "d")
const K49 = (item: unknown): unknown => (same(obj(obj(item)?.["line"])?.["number"], 1) && same(obj(obj(item)?.["parent"])?.["type"], "document") && (hit(K47, K48, obj(item)?.["text"]) && mark(num(obj(item)?.["start"]))))
const K50 = new RegExp("^%%.*?carve-version:[ \\t]*(?<v>[^\\s;]*[^\\d.\\s;][^\\s;]*|\\.[^\\s;]*|[^\\s;]*\\.|[^\\s;]*\\.\\.[^\\s;]*|0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)(?:[ \\t;]|$)", "")
const K51 = new RegExp("^%%.*?carve-version:[ \\t]*(?<v>[^\\s;]*[^\\d.\\s;][^\\s;]*|\\.[^\\s;]*|[^\\s;]*\\.|[^\\s;]*\\.\\.[^\\s;]*|0*[1-9]\\d*(?:\\.\\d+)*|0+\\.0*(?:[3-9]|[1-9]\\d+)(?:\\.\\d+)*|0+\\.0*2(?:\\.0+)*\\.0*[1-9]\\d*(?:\\.\\d+)*)(?:[ \\t;]|$)", "d")
const K52 = new RegExp("`$", "")
const K53 = new RegExp("\\n$", "")
const K54 = new RegExp(" $", "")
const K55 = new RegExp("[^ ]", "")
const K56 = new RegExp("^(?<op>%+)", "")
const K57 = new RegExp("^(?<op>%+)", "d")
const K58 = new RegExp("^%+(?:[ \\t]*[^ \\t%]|[ \\t]+%)", "")
const K59 = new RegExp("^[ \\t]*%%", "")
const K60 = new RegExp("^/\\*|\\*/$", "")
const K61 = new RegExp("^\\*/|/\\*$", "")
const K62 = new RegExp("\\|(?<pre>(?:[^|%]|%[^|%])*)%%[^|]*$", "")
const K63 = new RegExp("\\|(?<pre>(?:[^|%]|%[^|%])*)%%[^|]*$", "d")
const K64 = new Set<unknown>([" ","\t"])
const K65 = new Set<unknown>(["csv","tsv"])
const K66 = new RegExp("^(?:able|tble|tale|tabe|tabl|.table|t.able|ta.ble|tab.le|tabl.e|table.|.able|t.ble|ta.le|tab.e|tabl.|atble|tbale|talbe|tabel)$", "i")
const K67 = (item: unknown): unknown => !starts(obj(item)?.["raw_body"], "%%")
const K68 = new Set<unknown>(["block_image","bullet","description","display_math","ordered","text"])
const K69 = new Set<unknown>(["definition_term","line","paragraph"])
const K70 = new RegExp("^(?:>[ \\t]+)*(?<label>\\[.+?\\]:|\\{\\$[A-Za-z0-9_][A-Za-z0-9_-]*(?:[ \\t][^{}\\n]*)?\\}(?:\\{[^{}\\n]*\\})*:).", "")
const K71 = new RegExp("^(?:>[ \\t]+)*(?<label>\\[.+?\\]:|\\{\\$[A-Za-z0-9_][A-Za-z0-9_-]*(?:[ \\t][^{}\\n]*)?\\}(?:\\{[^{}\\n]*\\})*:).", "d")
const K72 = new RegExp("^(?<label>\\[.+?\\]:|\\{\\$[A-Za-z0-9_][A-Za-z0-9_-]*(?:[ \\t][^{}\\n]*)?\\}(?:\\{[^{}\\n]*\\})*:).", "")
const K73 = new RegExp("^(?<label>\\[.+?\\]:|\\{\\$[A-Za-z0-9_][A-Za-z0-9_-]*(?:[ \\t][^{}\\n]*)?\\}(?:\\{[^{}\\n]*\\})*:).", "d")
const K74 = new RegExp("^[ \\t]", "")
const K75 = new Set<unknown>(["admonition","block_quote","definition_description","definition_list","directive","div","figure_group","list","list_item"])
const K76 = new RegExp("^::?[ \\t]+(?<marker>>|[-*]|[0-9]{1,9}[.)])[ \\t]", "")
const K77 = new RegExp("^::?[ \\t]+(?<marker>>|[-*]|[0-9]{1,9}[.)])[ \\t]", "d")
const K78 = new RegExp("^\\\\(?:\\\\\\\\)*$", "")
const K79 = new RegExp("^[\\p{Zs}\\t\\n\\r\\f\\v]|[\\p{Zs}\\t\\n\\r\\f\\v]$", "u")
const K80 = new RegExp("^=|=$", "")
const K81 = new RegExp("^[\\p{L}\\p{N}]", "u")
const K82 = new RegExp("^\\~|\\~$", "")
const K83 = new RegExp("^_|_$", "")
const K84 = new RegExp("^=?\\s*(?<prefix>(?<mark>[<>~][\\^v~]?|\\?[\\^v~])(?:\\{\\s*(?<block>[^{}]*?)\\s*\\})?)[ \\t]\\s*\\S", "")
const K85 = new RegExp("^=?\\s*(?<prefix>(?<mark>[<>~][\\^v~]?|\\?[\\^v~])(?:\\{\\s*(?<block>[^{}]*?)\\s*\\})?)[ \\t]\\s*\\S", "d")
const K86 = new RegExp("^(?:[ \\t>]*|[ \\t]*(?:(?:>[ \\t]*)|(?:[-*]|\\.|[0-9]{1,9}[.)]|[A-Za-z][.)]|[IVXLCDMivxlcdm]{2,9}[.)])[ \\t]+)*(?:[-*]|\\.|[0-9]{1,9}[.)]|[A-Za-z][.)]|[IVXLCDMivxlcdm]{2,9}[.)])(?:[ \\t]+\\[[ xX]\\])?[ \\t]+)$", "")
const K87 = new RegExp("(?:^|[ \\t>])(?:[-*+]|\\.|[0-9]{1,9}[.)]|[A-Za-z][.)]|[IVXLCDMivxlcdm]{2,9}[.)])(?:[ \\t]+\\[[ xX]\\])?[ \\t]+$", "")
const K88 = new RegExp("^(?:[^\"]|\"[^\"]*\")*?[{ \\t]loose(?:=|[ \\t}])", "")
const K89 = new RegExp("^\\s*\\|(?:\\s*[-:]*-[-:]*\\s*\\|)+\\s*$", "")
const K90 = new RegExp("^[^|]*\\|(?:\\s*[-:]*-[-:]*\\s*\\|)*\\s*[-:]*-[-:]*\\s*\\S\\s*$", "")
const K91 = new RegExp("^[-*_]", "")
const K92 = new RegExp("^\\*(?:[ \t]*\\*){2,}$", "")
const K93 = new RegExp("^-(?:[ \t]*-){2,}$", "")
const K94 = new RegExp("^_(?:[ \t]*_){2,}$", "")
const K95 = new RegExp("[ \t]", "")
const K96 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell","table_row"])
const K97 = new RegExp("\\S", "")
const K98 = (item: unknown): unknown => (test(K97, obj(item)?.["text"]) ? (K96.has(obj(item)?.["leaf"]) ? obj(item)?.["quote_depth"] : 0) : false)
const K99 = new Set<string>(["definition_list"])
const K100 = (item: unknown): unknown => obj(item)?.["identity"]
const K101 = new RegExp("^[ \\t]*>", "")
const K102 = new Set<string>(["definition_description"])
const K103 = (item: unknown): unknown => obj(obj(item)?.["line"])?.["number"]
const K104 = new RegExp("^::?(?:[ \\t]|$)", "")
const K105 = new RegExp("^:[ \\t]", "")
const K106 = new RegExp("^:[ \\t]+[^ \\t]", "")
const K107 = new RegExp("[A-Za-z0-9](?<pair>_[^_\\s](?:[^_]*[^_\\s])?_)", "gd")
const K108 = new RegExp("^[A-Za-z0-9]$", "")
const K109 = new Set<string>(["list_item"])
const K110 = new RegExp("^(?:\\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\\)|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)])(?:[ \\t]|$)", "")
const K111 = new RegExp("^\\+[ \\t]+[^ \\t]", "")
const K112 = new RegExp("^\\^|\\^$", "")
const K113 = new Set<unknown>(["ellipsis","em_dash","en_dash","left_double_quote","left_single_quote","right_double_quote","right_single_quote"])
const K114 = new Set<string>(["link_reference_definition"])
const K115 = (item: unknown): unknown => obj(obj(item)?.["node"])?.["href"]
const K116 = new Set<unknown>(["emphasis","strong"])
const K117 = new RegExp("^\\s*$", "")
const K118 = new RegExp("^\\*(?:[^\\\\*]|\\\\[\\s\\S])*\\*[\\s\\S]*\\*\\{", "")
const K119 = new RegExp("^/(?:[^\\\\/]|\\\\[\\s\\S])*/[\\s\\S]*/\\{", "")
const K120 = new RegExp("(?:^|[^\\\\])(?:\\\\\\\\)*(?<m>[*/_~=])(?<run>(?<blk>\\{(?:[^{}\"'\\\\\\n]|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|'(?:[^'\\\\]|\\\\[\\s\\S])*'|\\\\[\\s\\S])*\\})(?:\\{(?:[^{}\"'\\\\\\n]|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|'(?:[^'\\\\]|\\\\[\\s\\S])*'|\\\\[\\s\\S])*\\})*)", "gd")
const K121 = new RegExp("(?<include>\\{\\{(?:\\s*|\\s+(?:\"\"|“”|[#@])[^{}]*)\\}\\})", "gd")
const K122 = new RegExp("^\\{\\{ +#[A-Za-z0-9_][A-Za-z0-9_-]* +\\}\\}$", "")
const K123 = new RegExp("\\]\\([ \\t]*\\)(?:\\{[^{}]*\\})*$", "")
const K124 = new RegExp("^(?<def>\\[(?<label>[ \\t]*[^\\] \\t][^\\]]*)\\]:)$", "")
const K125 = new RegExp("^(?<def>\\[(?<label>[ \\t]*[^\\] \\t][^\\]]*)\\]:)$", "d")
const K126 = new RegExp("^\\[\\^[ \\t]*\\]", "")
const K127 = new RegExp("^[^`]*(?<run>`{3,})", "")
const K128 = new RegExp("^[^`]*(?<run>`{3,})", "d")
const K129 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "")
const K130 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "d")
const K131 = new RegExp("^`{3,}$", "")
const K132 = new Set<unknown>(["list_item","description","footnote"])
const K133 = new RegExp("[^ \\t>]", "")
const K134 = new RegExp("^[ \\t]*:{3,}[ \\t]*figure$", "")
const K135 = new RegExp("^[ \\t]*::: figure ", "")
const K136 = new RegExp("[\"\\[]", "")
const K137 = new Set<string>(["footnote"])
const K138 = new RegExp("^\\[\\^[^\\]]*\\]", "")
const K139 = (item: unknown): unknown => (test(K138, obj(item)?.["text"]) ? obj(obj(item)?.["node"])?.["key"] : "")
const K140 = new RegExp("^\\[\\^(?<label>[^\\]]*)\\]", "")
const K141 = new RegExp("^\\[\\^(?<label>[^\\]]*)\\]", "d")
const K142 = new RegExp("^:{3,}[ \\t]*footnotes(?:[ \\t]|$)", "")
const K143 = new RegExp("^---[ \\t]*\\n", "")
const K144 = new RegExp("^---[ \\t]*\\n[ \\t]*(?:\\n|$)", "")
const K145 = new RegExp("^---[ \\t]*\\n[^:]*$", "")
const K146 = new Set<unknown>(["heading","paragraph","table_cell","table_row"])
const K147 = new RegExp("^[ \\t]*>(?:[^ \\t\\[]|\\[(?:[^!]|!(?:[^NTIWC]|N(?:[^O]|O(?:[^T]|T(?:[^E]|E[^\\]])))|T(?:[^I]|I(?:[^P]|P[^\\]]))|I(?:[^M]|M(?:[^P]|P(?:[^O]|O(?:[^R]|R(?:[^T]|T(?:[^A]|A(?:[^N]|N(?:[^T]|T[^\\]]))))))))|W(?:[^A]|A(?:[^R]|R(?:[^N]|N(?:[^I]|I(?:[^N]|N(?:[^G]|G[^\\]]))))))|C(?:[^A]|A(?:[^U]|U(?:[^T]|T(?:[^I]|I(?:[^O]|O(?:[^N]|N[^\\]])))))))))", "")
const K148 = new RegExp("^[ \\t]*(?:>[ \\t]*)+(?:(?:[-*]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]*>[ \\t]*)?(?:\\[[^\\]]+\\]:[ \\t]*>[ \\t]*)?(?<mark>\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\])", "")
const K149 = new RegExp("^[ \\t]*(?:>[ \\t]*)+(?:(?:[-*]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]*>[ \\t]*)?(?:\\[[^\\]]+\\]:[ \\t]*>[ \\t]*)?(?<mark>\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\])", "d")
const K150 = new RegExp("^\\*\\.[\\s\\S]*\\*$", "")
const K151 = new RegExp("^(?:#+|=+)[ \\t]+[^ \\t].*?[ \\t](?<run>#+)$", "")
const K152 = new RegExp("^(?:#+|=+)[ \\t]+[^ \\t].*?[ \\t](?<run>#+)$", "d")
const K153 = new RegExp("(?:^|[ \\t])(?<run>#+)[ \\t]*$", "")
const K154 = new RegExp("(?:^|[ \\t])(?<run>#+)[ \\t]*$", "d")
const K155 = new Set<string>(["heading"])
const K156 = new RegExp("^\\s*[#=]", "")
const K157 = (item: unknown): unknown => test(K156, obj(item)?.["opener_text"])
const K158 = new RegExp("^\\s*#", "")
const K159 = (item: unknown): unknown => test(K158, obj(item)?.["opener_text"])
const K160 = new RegExp("^\\s*=", "")
const K161 = (item: unknown): unknown => test(K160, obj(item)?.["opener_text"])
const K162 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "")
const K163 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "d")
const K164 = new RegExp("(?<o><!--)", "gd")
const K165 = new RegExp("(?:^|[^\\\\])\\\\(?:\\\\\\\\)*$", "")
const K166 = new RegExp("(?<c><!--.*?-->)", "")
const K167 = new RegExp("(?<c><!--.*?-->)", "d")
const K168 = new RegExp("(?<lines>@lines:[^\\s}]*)", "")
const K169 = new RegExp("(?<lines>@lines:[^\\s}]*)", "d")
const K170 = new RegExp("^[ \\t]*$", "")
const K171 = new RegExp("^ {4,}[^ ]", "")
const K172 = new RegExp("^[ \\t]+[^ \\t]", "")
const K173 = new RegExp("^(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')$", "")
const K174 = new RegExp("^(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*') (?<attr>\\{.*)$", "")
const K175 = new RegExp("^(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*') (?<attr>\\{.*)$", "d")
const K176 = linearPattern("(?<link>\\[[^\\]\\n]+\\][ \\t]+\\((?<dest>[^)\\n]*)\\))|\\[[^\\]\\n]+\\][ \\t]+\\([^)\\n]*|\\[[^\\]\\n]*")
const K177 = new RegExp("[^)\\s]", "")
const K178 = new Set<unknown>(["list_item","admonition","directive","div","figure_group"])
const K179 = new Set<unknown>(["admonition","block_quote","code_block","definition_list","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"])
const K180 = (item: unknown): unknown => obj(obj(item)?.["ancestor_ids"])?.[0]
const K181 = new Set<string>(["list"])
const K182 = (item: unknown): unknown => obj(obj(item)?.["ancestor_ids"])?.[1]
const K183 = new Set<unknown>(["list","paragraph"])
const K184 = (item: unknown): unknown => (!K183.has(obj(item)?.["type"]) ? obj(obj(item)?.["ancestor_ids"])?.[0] : false)
const K185 = new Set<unknown>(["definition_term","paragraph"])
const K186 = new RegExp("^(?:[-*]|[0-9]{1,9}[.)]) [ \\t]*[^ \\t]", "")
const K187 = new RegExp("^:[ \\t].", "")
const K188 = new RegExp("^\\*|\\*$", "")
const K189 = new Set<unknown>(["admonition","block_quote","div","document","footnote","list_item"])
const K190 = new RegExp("^\\s*[ivxlcdmIVXLCDM][.)]", "")
const K191 = new RegExp("^[ \\t]*(?<fence>::: >[\\s\\S]*?)[ \\t]*$", "")
const K192 = new RegExp("^[ \\t]*(?<fence>::: >[\\s\\S]*?)[ \\t]*$", "d")
const K193 = new RegExp("^\\s*>", "")
const K194 = new RegExp("^#(?:end)?region(?:[^A-Za-z0-9_]|$)", "i")
const K195 = new RegExp("^#(?:end)?region(?:[^A-Za-z0-9_]|$)", "")
const K196 = new RegExp("^[ \\t]*(?<m>(?:(?://|--|/\\*|<!--)[ \\t]*)?#(?:end)?region(?:[^A-Za-z0-9_]|$))", "i")
const K197 = new RegExp("^[ \\t]*(?<m>(?:(?://|--|/\\*|<!--)[ \\t]*)?#(?:end)?region(?:[^A-Za-z0-9_]|$))", "id")
const K198 = new RegExp("(?<use>\\{\\{ +#[A-Za-z0-9_][A-Za-z0-9_-]* +\\}\\})", "gd")
const K199 = new RegExp("(?:^|[^\\\\])(?:\\\\\\\\)*$", "")
const K200 = new RegExp("^[ \\t]*(?:>[ \\t]+)*(?<run>={3,}|-{3,})[ \\t]*$", "")
const K201 = new RegExp("^[ \\t]*(?:>[ \\t]+)*(?<run>={3,}|-{3,})[ \\t]*$", "d")
const K202 = new RegExp("[@#]", "")
const K203 = new RegExp("(?<b>[\\p{L}\\p{N}])(?<s>[@#])(?<name>[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)[A-Za-z0-9_.-]*(?<next>[\\p{L}\\p{N}\\p{M}]?)", "gdu")
const K204 = new RegExp("[A-Za-z]", "")
const K205 = new Set<unknown>(["aligns","valigns","widths","header-rows","footer-rows","body-rows","body-header-rows","body-header-cols"])
const K206 = new RegExp("^[0-9]*$", "")
const K207 = new Set<unknown>(["aligns","valigns","widths"])
const K208 = new Set<unknown>(["aligns","valigns"])
const K209 = new RegExp("(?<n>[0-9]+)", "gd")
const K210 = new RegExp("^\\s*(?<block>\\{[^}]+\\})(?<marker>[<>~])", "")
const K211 = new RegExp("^\\s*(?<block>\\{[^}]+\\})(?<marker>[<>~])", "d")
const K212 = new RegExp("\\|\\s*(?<cell>\\{\\s*[^%}\\s][^|]*\\})\\s*\\|[^|]*$", "")
const K213 = new RegExp("\\|\\s*(?<cell>\\{\\s*[^%}\\s][^|]*\\})\\s*\\|[^|]*$", "d")
const K214 = new Set<string>(["table_row"])
const K215 = new Set<unknown>(["table_body","table_foot","table_head"])
const K216 = (item: unknown): unknown => (K215.has(obj(obj(item)?.["parent"])?.["type"]) ? obj(obj(item)?.["ancestor_ids"])?.[1] : "")
const K217 = new RegExp("^[ \\t]*(?<plus>\\+)", "")
const K218 = new RegExp("^[ \\t]*(?<plus>\\+)", "d")
const K219 = new RegExp("\\|(?:[ \\t]*\\{[^{}]*\\})?[ \\t\\x00]*$", "")
const K220 = new Set<unknown>(["<","^"])
const K221 = new RegExp("\\\\[<^]\\s*$", "")
const K222 = new RegExp("^(?:-{3,}|_{3,})$", "")
const K223 = new Set<unknown>(["comment","comment_block"])
const K224 = (item: unknown): unknown => (!K223.has(obj(item)?.["type"]) ? obj(obj(item)?.["ancestor_ids"])?.[0] : false)
const K225 = (item: unknown): unknown => ((same(obj(obj(item)?.["parent"])?.["type"], "list_item") && (num(obj(obj(item)?.["layout"])?.["blankLinesAfter"]) > 0) && (num(obj(lookupAt(26, "block", undefined, K224, obj(obj(item)?.["ancestor_ids"])?.[0], num(obj(item)?.["start"]), 1, undefined))?.["start"]) >= 0)) ? obj(obj(item)?.["ancestor_ids"])?.[1] : false)
const K226 = new RegExp("^(?:\\[[^^]|\\[$|\\*\\[)", "")
const K227 = new RegExp("^\\s*> ", "")
const K228 = (_item: unknown): unknown => true
const K229 = new Set<unknown>(["caption","cell_paragraph","definition_term","heading","line","paragraph"])
const K230 = new RegExp("(?:^|[^\\\\])(?:\\\\\\\\)*(?<run>(?<blk>\\{[ \\t]*(?:[^{}\\s\"'\\\\]|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|'(?:[^'\\\\]|\\\\[\\s\\S])*'|\\\\[\\s\\S])(?:[^{}\"'\\\\\\n]|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|'(?:[^'\\\\]|\\\\[\\s\\S])*'|\\\\[\\s\\S])*\\})(?:\\{[ \\t]*(?:[^{}\\s\"'\\\\]|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|'(?:[^'\\\\]|\\\\[\\s\\S])*'|\\\\[\\s\\S])(?:[^{}\"'\\\\\\n]|\"(?:[^\"\\\\]|\\\\[\\s\\S])*\"|'(?:[^'\\\\]|\\\\[\\s\\S])*'|\\\\[\\s\\S])*\\})*)", "gd")
const K231 = new Set<unknown>(["caption","line","paragraph"])
const K232 = new Set<unknown>([".","#","_","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z"])
const K233 = new RegExp("(?:^|[^\\\\])(?:\\\\\\\\)*(?<o>\\{%)", "")
const K234 = new RegExp("(?:^|[^\\\\])(?:\\\\\\\\)*(?<o>\\{%)", "d")
const K235 = (item: unknown): unknown => contains(obj(item)?.["raw_body"], "%}")
const K236 = new RegExp("[*/]", "")
const K237 = new RegExp("(?<b>^|[\\s(\\[]|(?:^|[^\\\\])(?:\\\\\\\\)*\\\\\\{)(?<d>[*/])[A-Za-z0-9_]", "gd")
const K238 = (item: unknown): unknown => obj(item)?.["leaf_start"]
const K239 = (item: unknown): unknown => foldKey(str(obj(obj(item)?.["node"])?.["key"]))
const K240 = (item: unknown): unknown => ((obj(item)?.["heading_text"] !== undefined) ? foldKey(foldLabel(str(obj(item)?.["heading_text"]))) : false)
const K241 = new Set<string>(["footnote_ref"])
const K242 = (item: unknown): unknown => obj(obj(item)?.["node"])?.["key"]
const K243 = new Set<string>(["image","link"])

function rule0(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K0, self.text)) return
  context.report("a11y/image-alt", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule1(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((K1.has(self.leaf) || K2.has(self.leaf)) && contains(self.text, "<") && (hit(K3, K4, self.text) && mark(num(self.start))))) return
  context.report("bare-html-tag", num(group("tag", 0)), num(group("tag", 1)), path, {  }, 0)
  return
}

function rule2(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "[")) return
  const one = (): void => {
    if (((num(group("caret", 0)) >= 0) || same(str(self.text).slice(((num(group("label", 0)) - num(self.start)) - 1), (num(group("label", 0)) - num(self.start))), "]"))) {
      context.report("blank-reference-label", num(group("label", 0)), num(group("label", 1)), path, { "text": String(str(self.text).slice((num(group("label", 0)) - num(self.start)), (num(group("label", 1)) - num(self.start)))) }, 0)
      return
    }
    if (((same((num(group("label", 0)) - num(self.start)), 0) || same(str(self.text).slice(((num(group("label", 0)) - num(self.start)) - 1), (num(group("label", 0)) - num(self.start))), "\n")) && same(str(self.text).slice((num(group("label", 1)) - num(self.start)), ((num(group("label", 1)) - num(self.start)) + 1)), ":") && !contains(str(self.text).slice((num(group("label", 0)) - num(self.start)), (num(group("label", 1)) - num(self.start))), "\n"))) {
      context.report("blank-reference-label", num(group("label", 0)), (num(group("label", 1)) + 1), path, { "text": String(str(self.text).slice((num(group("label", 0)) - num(self.start)), ((num(group("label", 1)) - num(self.start)) + 1))) }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K5, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule3(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  let v_candidate: unknown = UNSET
  let g_candidate: Record<string, [number, number]> | undefined
  let b_candidate = 0
  let v_candidate_start: unknown = UNSET
  let g_candidate_start: Record<string, [number, number]> | undefined
  let b_candidate_start = 0
  let v_span: unknown = UNSET
  let g_span: Record<string, [number, number]> | undefined
  let b_span = 0
  if (!K8.has(self.leaf)) return
  if ((Boolean(self.leaf_first) && starts((v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate), "~~~"))) {
    context.report("block-marker-as-text", num((v_candidate_start === UNSET ? (g_candidate_start = groups, b_candidate_start = base, v_candidate_start = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))), groups = g_candidate_start, base = b_candidate_start, v_candidate_start) : v_candidate_start)), (num((v_candidate_start === UNSET ? (g_candidate_start = groups, b_candidate_start = base, v_candidate_start = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))), groups = g_candidate_start, base = b_candidate_start, v_candidate_start) : v_candidate_start)) + lenOf((v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate))), path, { "what": String("a tilde fence") }, 0)
    return
  }
  if ((Boolean(self.leaf_first) && test(K9, (v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate)))) {
    context.report("block-marker-as-text", num((v_candidate_start === UNSET ? (g_candidate_start = groups, b_candidate_start = base, v_candidate_start = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))), groups = g_candidate_start, base = b_candidate_start, v_candidate_start) : v_candidate_start)), (num((v_candidate_start === UNSET ? (g_candidate_start = groups, b_candidate_start = base, v_candidate_start = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))), groups = g_candidate_start, base = b_candidate_start, v_candidate_start) : v_candidate_start)) + lenOf((v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate))), path, { "what": String("a colon fence") }, 0)
    return
  }
  if ((test(K10, (v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate)) && !isAttributeLine(str((v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate)), 0, str((v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate)).length) && !(num((v_span === UNSET ? (g_span = groups, b_span = base, v_span = (obj(lookupAt(0, "inline", undefined, K7, (v_candidate_start === UNSET ? (g_candidate_start = groups, b_candidate_start = base, v_candidate_start = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))), groups = g_candidate_start, base = b_candidate_start, v_candidate_start) : v_candidate_start), self.start, 0, undefined))?.["start"]), groups = g_span, base = b_span, v_span) : v_span)) >= 0))) {
    context.report("block-marker-as-text", num((v_candidate_start === UNSET ? (g_candidate_start = groups, b_candidate_start = base, v_candidate_start = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))), groups = g_candidate_start, base = b_candidate_start, v_candidate_start) : v_candidate_start)), (num((v_candidate_start === UNSET ? (g_candidate_start = groups, b_candidate_start = base, v_candidate_start = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))), groups = g_candidate_start, base = b_candidate_start, v_candidate_start) : v_candidate_start)) + lenOf((v_candidate === UNSET ? (g_candidate = groups, b_candidate = base, v_candidate = ((((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))), groups = g_candidate, base = b_candidate, v_candidate) : v_candidate))), path, { "what": String("an attribute line") }, 0)
    return
  }
}

function rule4(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!Boolean(self.after_quote_mark) && (num(self.mark_column) > num(self.owner?.["content_column"])) && !same(self.item_owner?.["type"], "list_item"))) return
  context.report("block-opener-overindented", num(self.opener_start), num(((hit(K12, K13, self.opener_text) && mark(num(self.opener_start))) ? group("mark", 1) : (num(self.opener_start) + 1))), path, { "kind": String((same(self.type, "block_quote") ? "quote" : (K11.has(self.type) ? "div" : str(self.type).replaceAll('_', ' ')))), "past": String((num(self.mark_column) - num(self.owner?.["content_column"]))), "columns": String((same((num(self.mark_column) - num(self.owner?.["content_column"])), 1) ? "column" : "columns")), "owner": String(str(self.owner?.["type"]).replaceAll('_', ' ')) }, 0)
  return
}

function rule5(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K14.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.prev?.["blank"]))) return
  if ((hit(K15, K16, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a heading") }, 0)
    return
  }
  if (((test(K17, self.raw_body) && (hit(K18, K19, self.body) && mark(num(self.body_start)))))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a quote") }, 0)
    return
  }
  if ((hit(K20, K21, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a term") }, 0)
    return
  }
  if ((hit(K22, K23, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a description") }, 0)
    return
  }
  if ((same(self.shape, "attribute_line") && !(num(self.body_start) < num(obj(lookupAt(1, "block", K24, K25, self.leaf_start, self.start, 0, undefined))?.["opener_start"])))) {
    context.report("block-opener-without-blank-line", num(self.body_start), num(self.body_end), path, { "opener": String("an attribute line") }, 0)
    return
  }
  if (((hit(K26, K27, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote"))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a definition") }, 0)
    return
  }
}

function rule6(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K28, self.text) && !test(K29, self.raw_body))) return
  if (K30.has(self.leaf)) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.body_start) + lenOf(self.raw_body)), path, { "text": String(str(self.raw_body).slice(1)) }, 0)
    return
  }
  if (same(self.leaf, "frontmatter")) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.body_start) + lenOf(self.raw_body)), path, { "text": String(str(self.raw_body).slice(1)) }, 1)
    return
  }
}

function rule7(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K31, self.text)) return
  context.report("braced-comment-in-a-template-source", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule8(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_exact_index: unknown = UNSET
  let g_exact_index: Record<string, [number, number]> | undefined
  let b_exact_index = 0
  let v_exact_owner: unknown = UNSET
  let g_exact_owner: Record<string, [number, number]> | undefined
  let b_exact_owner = 0
  let v_case_ids: unknown = UNSET
  let g_case_ids: Record<string, [number, number]> | undefined
  let b_case_ids = 0
  let v_exact_xref: unknown = UNSET
  let g_exact_xref: Record<string, [number, number]> | undefined
  let b_exact_xref = 0
  if (!(!same((v_exact_owner === UNSET ? (g_exact_owner = groups, b_exact_owner = base, v_exact_owner = (obj(lookupAt(2, "id", K32, K33, str(obj(self.node)?.["key"]).normalize('NFC'), self.start, 0, undefined))?.["owner"]), groups = g_exact_owner, base = b_exact_owner, v_exact_owner) : v_exact_owner), "frontmatter") && same(obj(self.node)?.["namespace"], "heading") && !(obj(self.node)?.["href"] !== undefined))) return
  if (((num((v_exact_index === UNSET ? (g_exact_index = groups, b_exact_index = base, v_exact_index = (obj(lookupAt(2, "id", K32, K33, str(obj(self.node)?.["key"]).normalize('NFC'), self.start, 0, undefined))?.["index"]), groups = g_exact_index, base = b_exact_index, v_exact_index) : v_exact_index)) >= 0) && !Boolean((v_exact_xref === UNSET ? (g_exact_xref = groups, b_exact_xref = base, v_exact_xref = (obj(lookupAt(4, "id", K32, K35, str(obj(self.node)?.["key"]).normalize('NFC'), self.start, 0, undefined))?.["xref"]), groups = g_exact_xref, base = b_exact_xref, v_exact_xref) : v_exact_xref)))) {
    context.report("broken-crossref", num(self.start), num(self.end), path, { "target": String(obj(self.node)?.["key"]), "id": String(obj(self.node)?.["key"]), "kind": String((v_exact_owner === UNSET ? (g_exact_owner = groups, b_exact_owner = base, v_exact_owner = (obj(lookupAt(2, "id", K32, K33, str(obj(self.node)?.["key"]).normalize('NFC'), self.start, 0, undefined))?.["owner"]), groups = g_exact_owner, base = b_exact_owner, v_exact_owner) : v_exact_owner)) }, 0)
    return
  }
  if ((lenOf((v_case_ids === UNSET ? (g_case_ids = groups, b_case_ids = base, v_case_ids = (lookupAll(3, "id", K32, K34, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(record)?.["id"])), groups = g_case_ids, base = b_case_ids, v_case_ids) : v_case_ids)) >= 1)) {
    context.report("broken-crossref", num(self.start), num(self.end), path, { "target": String(obj(self.node)?.["key"]), "caseOnlyPhrase": String((same(lenOf((v_case_ids === UNSET ? (g_case_ids = groups, b_case_ids = base, v_case_ids = (lookupAll(3, "id", K32, K34, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(record)?.["id"])), groups = g_case_ids, base = b_case_ids, v_case_ids) : v_case_ids)), 1) ? ("the id " + listOf((v_case_ids === UNSET ? (g_case_ids = groups, b_case_ids = base, v_case_ids = (lookupAll(3, "id", K32, K34, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(record)?.["id"])), groups = g_case_ids, base = b_case_ids, v_case_ids) : v_case_ids), '') + " differs only in case") : ("the ids " + listOf((v_case_ids === UNSET ? (g_case_ids = groups, b_case_ids = base, v_case_ids = (lookupAll(3, "id", K32, K34, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(record)?.["id"])), groups = g_case_ids, base = b_case_ids, v_case_ids) : v_case_ids), '') + " differ only in case"))) }, 1)
    return
  }
  context.report("broken-crossref", num(self.start), num(self.end), path, { "target": String(obj(self.node)?.["key"]) }, 2)
  return
}

function rule9(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_fragment: unknown = UNSET
  let g_fragment: Record<string, [number, number]> | undefined
  let b_fragment = 0
  let v_decoded: unknown = UNSET
  let g_decoded: Record<string, [number, number]> | undefined
  let b_decoded = 0
  let v_as_written: unknown = UNSET
  let g_as_written: Record<string, [number, number]> | undefined
  let b_as_written = 0
  let v_as_decoded: unknown = UNSET
  let g_as_decoded: Record<string, [number, number]> | undefined
  let b_as_decoded = 0
  let v_case_only: unknown = UNSET
  let g_case_only: Record<string, [number, number]> | undefined
  let b_case_only = 0
  if (!(starts(obj(self.node)?.["href"], "#") && same(lenOf(runValue(context, "id_extensions")), 0) && !same((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment), "") && !same(foldKey(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment))), "top") && !(num(obj(lookupAt(6, "id", K32, K37, (v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment), self.start, 0, undefined))?.["index"]) >= 0) && !(num(obj(lookupAt(6, "id", K32, K37, (v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded), self.start, 0, undefined))?.["index"]) >= 0))) return
  if ((lenOf((v_case_only === UNSET ? (g_case_only = groups, b_case_only = base, v_case_only = ((((num((v_as_written === UNSET ? (g_as_written = groups, b_as_written = base, v_as_written = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)).normalize('NFC')))))?.["index"]), groups = g_as_written, base = b_as_written, v_as_written) : v_as_written)) >= 0) && (!(num((v_as_decoded === UNSET ? (g_as_decoded = groups, b_as_decoded = base, v_as_decoded = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["index"]), groups = g_as_decoded, base = b_as_decoded, v_as_decoded) : v_as_decoded)) >= 0) || (num((v_as_written === UNSET ? (g_as_written = groups, b_as_written = base, v_as_written = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)).normalize('NFC')))))?.["index"]), groups = g_as_written, base = b_as_written, v_as_written) : v_as_written)) <= num((v_as_decoded === UNSET ? (g_as_decoded = groups, b_as_decoded = base, v_as_decoded = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["index"]), groups = g_as_decoded, base = b_as_decoded, v_as_decoded) : v_as_decoded))))) ? obj(lookupAt(5, "id", K32, K36, foldKey(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)).normalize('NFC')))))?.["id"] : ((num((v_as_decoded === UNSET ? (g_as_decoded = groups, b_as_decoded = base, v_as_decoded = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["index"]), groups = g_as_decoded, base = b_as_decoded, v_as_decoded) : v_as_decoded)) >= 0) ? obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["id"] : ""))), groups = g_case_only, base = b_case_only, v_case_only) : v_case_only)) >= 1)) {
    context.report("broken-fragment-link", num(self.start), num(self.end), path, { "href": String(obj(self.node)?.["href"]), "caseOnly": String((v_case_only === UNSET ? (g_case_only = groups, b_case_only = base, v_case_only = ((((num((v_as_written === UNSET ? (g_as_written = groups, b_as_written = base, v_as_written = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)).normalize('NFC')))))?.["index"]), groups = g_as_written, base = b_as_written, v_as_written) : v_as_written)) >= 0) && (!(num((v_as_decoded === UNSET ? (g_as_decoded = groups, b_as_decoded = base, v_as_decoded = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["index"]), groups = g_as_decoded, base = b_as_decoded, v_as_decoded) : v_as_decoded)) >= 0) || (num((v_as_written === UNSET ? (g_as_written = groups, b_as_written = base, v_as_written = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)).normalize('NFC')))))?.["index"]), groups = g_as_written, base = b_as_written, v_as_written) : v_as_written)) <= num((v_as_decoded === UNSET ? (g_as_decoded = groups, b_as_decoded = base, v_as_decoded = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["index"]), groups = g_as_decoded, base = b_as_decoded, v_as_decoded) : v_as_decoded))))) ? obj(lookupAt(5, "id", K32, K36, foldKey(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)).normalize('NFC')))))?.["id"] : ((num((v_as_decoded === UNSET ? (g_as_decoded = groups, b_as_decoded = base, v_as_decoded = (obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["index"]), groups = g_as_decoded, base = b_as_decoded, v_as_decoded) : v_as_decoded)) >= 0) ? obj(lookupAt(5, "id", K32, K36, foldKey(str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded))), self.start, 0, (item: unknown): boolean => (!same(str(obj(item)?.["id"]).normalize('NFC'), str((v_decoded === UNSET ? (g_decoded = groups, b_decoded = base, v_decoded = (percentDecode(str((v_fragment === UNSET ? (g_fragment = groups, b_fragment = base, v_fragment = (str(obj(self.node)?.["href"]).slice(1, num(((indexOf(obj(self.node)?.["href"], ":~:") >= 0) ? indexOf(obj(self.node)?.["href"], ":~:") : lenOf(obj(self.node)?.["href"]))))), groups = g_fragment, base = b_fragment, v_fragment) : v_fragment)))), groups = g_decoded, base = b_decoded, v_decoded) : v_decoded)).normalize('NFC')))))?.["id"] : ""))), groups = g_case_only, base = b_case_only, v_case_only) : v_case_only)) }, 0)
    return
  }
  context.report("broken-fragment-link", num(self.start), num(self.end), path, { "href": String(obj(self.node)?.["href"]), "caseOnly": String("") }, 1)
  return
}

function rule10(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K38, self.body))) return
  if ((K2.has(self.next?.["leaf"]) || K2.has(self.next2?.["leaf"]))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 0)
    return
  }
  if ((K2.has(self.prev?.["leaf"]) || K2.has(self.prev2?.["leaf"]) || contains(self.prev?.["text"], "![") || contains(self.prev2?.["text"], "!["))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 1)
    return
  }
}

function rule11(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_numeric_at: unknown = UNSET
  let g_numeric_at: Record<string, [number, number]> | undefined
  let b_numeric_at = 0
  if (!(same(self.parent?.["type"], "document") && same(self.line?.["number"], 1) && (hit(K41, K42, self.text) && mark(num(self.start))))) return
  if (same((v_numeric_at === UNSET ? (g_numeric_at = groups, b_numeric_at = base, v_numeric_at = (((hit(K39, K40, self.text) && mark(num(self.start))) ? group("v", 0) : -1)), groups = g_numeric_at, base = b_numeric_at, v_numeric_at) : v_numeric_at), group("v", 0))) {
    context.report("carve-version-unsupported", num(group("v", 0)), num(group("v", 1)), path, { "version": String(JSON.stringify(str(self.text).slice((num(group("v", 0)) - num(self.start)), (num(group("v", 1)) - num(self.start)))).slice(1, -1)) }, 1)
    return
  }
  context.report("carve-version-unsupported", num(group("v", 0)), num(group("v", 1)), path, { "version": String(JSON.stringify(str(self.text).slice((num(group("v", 0)) - num(self.start)), (num(group("v", 1)) - num(self.start)))).slice(1, -1)) }, 0)
  return
}

function rule12(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_numeric_at: unknown = UNSET
  let g_numeric_at: Record<string, [number, number]> | undefined
  let b_numeric_at = 0
  if (!(starts(self.raw_body, "%%") && !(num(obj(lookupAt(7, "line", undefined, K45, true, num(self.start), 1, undefined))?.["start"]) >= 0) && !(num(obj(lookupAt(8, "block", K46, K49, true, self.start, 0, undefined))?.["start"]) >= 0) && (hit(K50, K51, self.raw_body) && mark(num(self.body_start))))) return
  if (same((v_numeric_at === UNSET ? (g_numeric_at = groups, b_numeric_at = base, v_numeric_at = (((hit(K43, K44, self.raw_body) && mark(num(self.body_start))) ? group("v", 0) : -1)), groups = g_numeric_at, base = b_numeric_at, v_numeric_at) : v_numeric_at), group("v", 0))) {
    context.report("carve-version-unsupported", num(group("v", 0)), num(group("v", 1)), path, { "version": String(JSON.stringify(str(self.raw_body).slice((num(group("v", 0)) - num(self.body_start)), (num(group("v", 1)) - num(self.body_start)))).slice(1, -1)) }, 1)
    return
  }
  context.report("carve-version-unsupported", num(group("v", 0)), num(group("v", 1)), path, { "version": String(JSON.stringify(str(self.raw_body).slice((num(group("v", 0)) - num(self.body_start)), (num(group("v", 1)) - num(self.body_start)))).slice(1, -1)) }, 0)
  return
}

function rule13(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_tick_start: unknown = UNSET
  let g_tick_start: Record<string, [number, number]> | undefined
  let b_tick_start = 0
  let v_tick_end: unknown = UNSET
  let g_tick_end: Record<string, [number, number]> | undefined
  let b_tick_end = 0
  let v_space_start: unknown = UNSET
  let g_space_start: Record<string, [number, number]> | undefined
  let b_space_start = 0
  let v_space_end: unknown = UNSET
  let g_space_end: Record<string, [number, number]> | undefined
  let b_space_end = 0
  if (!((Boolean((v_tick_start === UNSET ? (g_tick_start = groups, b_tick_start = base, v_tick_start = (starts(obj(self.node)?.["value"], "`")), groups = g_tick_start, base = b_tick_start, v_tick_start) : v_tick_start)) && !Boolean((v_tick_end === UNSET ? (g_tick_end = groups, b_tick_end = base, v_tick_end = ((test(K52, obj(self.node)?.["value"]) && !test(K53, obj(self.node)?.["value"]))), groups = g_tick_end, base = b_tick_end, v_tick_end) : v_tick_end))) || (!Boolean((v_tick_start === UNSET ? (g_tick_start = groups, b_tick_start = base, v_tick_start = (starts(obj(self.node)?.["value"], "`")), groups = g_tick_start, base = b_tick_start, v_tick_start) : v_tick_start)) && Boolean((v_tick_end === UNSET ? (g_tick_end = groups, b_tick_end = base, v_tick_end = ((test(K52, obj(self.node)?.["value"]) && !test(K53, obj(self.node)?.["value"]))), groups = g_tick_end, base = b_tick_end, v_tick_end) : v_tick_end))) || (Boolean((v_space_start === UNSET ? (g_space_start = groups, b_space_start = base, v_space_start = (starts(obj(self.node)?.["value"], " ")), groups = g_space_start, base = b_space_start, v_space_start) : v_space_start)) && Boolean((v_space_end === UNSET ? (g_space_end = groups, b_space_end = base, v_space_end = ((test(K54, obj(self.node)?.["value"]) && !test(K53, obj(self.node)?.["value"]))), groups = g_space_end, base = b_space_end, v_space_end) : v_space_end)) && test(K55, obj(self.node)?.["value"])))) return
  context.report("code-span-padding-kept", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule14(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(starts(self.body, ":::") && same(self.shape, "div_bare_run") && (self.open_colon?.[0] !== undefined) && !same(self.open_colon?.[0]?.["width"], lenOf(self.body)))) return
  if ((lenOf(self.body) > num(self.open_colon?.[0]?.["width"]))) {
    context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(lenOf(self.body)), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 2)
    return
  }
  if (someFrom(self.open_colon, 1, (item) => (num(obj(item)?.["width"]) <= lenOf(self.body)))) {
    context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(lenOf(self.body)), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 1)
    return
  }
  context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(lenOf(self.body)), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 0)
  return
}

function rule15(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_opener: unknown = UNSET
  let g_opener: Record<string, [number, number]> | undefined
  let b_opener = 0
  if (!(same(self.leaf, "comment_block") && !Boolean(self.leaf_first) && (lenOf((v_opener === UNSET ? (g_opener = groups, b_opener = base, v_opener = (((same(self.leaf, "comment_block") && !Boolean(self.leaf_first)) ? ((hit(K56, K57, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "") : "")), groups = g_opener, base = b_opener, v_opener) : v_opener)) >= 3) && starts(self.body, str((v_opener === UNSET ? (g_opener = groups, b_opener = base, v_opener = (((same(self.leaf, "comment_block") && !Boolean(self.leaf_first)) ? ((hit(K56, K57, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "") : "")), groups = g_opener, base = b_opener, v_opener) : v_opener))) && test(K58, self.body))) return
  context.report("comment-fence-closer-with-text", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule16(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K59, self.text)) return
  context.report("comment-line-in-line-block", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule17(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if ((same(self.type, "emphasis") && test(K60, self.text))) {
    context.report("comment-shaped-emphasis", num(self.start), num(self.end), path, {  }, 0)
    return
  }
  if ((same(self.type, "strong") && test(K61, self.text))) {
    context.report("comment-shaped-emphasis", num(self.start), num(self.end), path, {  }, 0)
    return
  }
}

function rule18(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.table_below?.["raw_body"], "+")) return
  if ((starts(self.raw_body, "%%") && (starts(self.table_above?.["raw_body"], "|") || starts(self.table_above?.["raw_body"], "+")))) {
    context.report("comment-splits-table-row", num(self.body_start), (num(self.body_start) + lenOf(self.raw_body)), path, {  }, 0)
    return
  }
  if (((starts(self.raw_body, "|") || starts(self.raw_body, "+")) && (hit(K62, K63, self.raw_body) && mark(num(self.body_start))) && K64.has(str(self.raw_body).slice(((num(group("pre", 1)) - num(self.body_start)) - 1), (num(group("pre", 1)) - num(self.body_start)))))) {
    context.report("comment-splits-table-row", (num(group("pre", 1)) - 1), (num(self.body_start) + lenOf(self.raw_body)), path, {  }, 0)
    return
  }
}

function rule19(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(K65.has(obj(self.owner?.["node"])?.["syntax"]) && same(self.kind, "key") && Boolean(self.last_key) && same(self.value, "") && !same(self.key, "table") && test(K66, self.key))) return
  context.report("consumed-key-near-miss", num(self.owner?.["opener_start"]), num(self.owner?.["end"]), path, { "word": String(self.key), "key": String("table") }, 0)
  return
}

function rule20(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_line_start: unknown = UNSET
  let g_line_start: Record<string, [number, number]> | undefined
  let b_line_start = 0
  let v_line_end: unknown = UNSET
  let g_line_end: Record<string, [number, number]> | undefined
  let b_line_end = 0
  if (!(num((v_line_start === UNSET ? (g_line_start = groups, b_line_start = base, v_line_start = (obj(lookupAt(9, "line", undefined, K67, true, num(self.opener_start), 1, undefined))?.["start"]), groups = g_line_start, base = b_line_start, v_line_start) : v_line_start)) < num(self.end))) return
  context.report("continuation-reading-changed", num((v_line_start === UNSET ? (g_line_start = groups, b_line_start = base, v_line_start = (obj(lookupAt(9, "line", undefined, K67, true, num(self.opener_start), 1, undefined))?.["start"]), groups = g_line_start, base = b_line_start, v_line_start) : v_line_start)), num((v_line_end === UNSET ? (g_line_end = groups, b_line_end = base, v_line_end = (obj(lookupAt(9, "line", undefined, K67, true, num(self.opener_start), 1, undefined))?.["end"]), groups = g_line_end, base = b_line_end, v_line_end) : v_line_end)), path, {  }, 0)
  return
}

function rule21(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_term_next: unknown = UNSET
  let g_term_next: Record<string, [number, number]> | undefined
  let b_term_next = 0
  if (!((same(self.leaf, "definition_term") && !Boolean(self.leaf_first) && same((v_term_next === UNSET ? (g_term_next = groups, b_term_next = base, v_term_next = (obj(lookupAt(9, "line", undefined, K67, true, num(self.leaf_head?.["end"]), 1, undefined))?.["start"]), groups = g_term_next, base = b_term_next, v_term_next) : v_term_next), self.start)) || (same(self.prev?.["leaf"], "caption") && !same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.blank) && same(self.quote_marks, self.prev?.["quote_marks"]) && (K68.has(self.shape) || (same(self.shape, "heading") && starts(self.body, "=")))))) return
  if (same(self.leaf, "definition_term")) {
    context.report("continuation-reading-changed", num(self.start), num(self.end), path, {  }, 1)
    return
  }
  context.report("continuation-reading-changed", num(self.start), num(self.end), path, {  }, 2)
  return
}

function rule22(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K69.has(self.leaf) && ((hit(K70, K71, self.body) && mark(num(self.body_start))) && ((Boolean(self.lazy) && contains(self.ancestors, "block_quote")) || (hit(K72, K73, self.body) && mark(num(self.body_start))))) && !contains(self.ancestors, "footnote") && !(same(self.leaf, "definition_term") && !Boolean(self.leaf_first) && !test(K74, self.text)) && (test(K74, self.text) || someFrom(self.ancestors, 0, (item) => K75.has(item))))) return
  context.report("definition-in-container", num(group("label", 0)), num(group("label", 1)), path, {  }, 0)
  return
}

function rule23(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "definition_term") && Boolean(self.leaf_first))) return
  if ((hit(K76, K77, self.body) && mark(num(self.body_start)))) {
    context.report("definition-term-block-folded", num(group("marker", 0)), num(group("marker", 1)), path, {  }, 0)
    return
  }
}

function rule24(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_width: unknown = UNSET
  let g_width: Record<string, [number, number]> | undefined
  let b_width = 0
  if (!(K65.has(self.source_format) && someFrom(obj(self.node)?.["children"], 0, (item) => someFrom(obj(item)?.["children"], 0, (item) => (countFrom(obj(item)?.["children"], 0, () => true) > num((v_width === UNSET ? (g_width = groups, b_width = base, v_width = (countFrom(obj(obj(obj(findIn(obj(self.node)?.["children"], (item) => (obj(obj(item)?.["children"])?.[0] !== undefined)))?.["children"])?.[0])?.["children"], 0, () => true)), groups = g_width, base = b_width, v_width) : v_width))))))) return
  context.report("delimited-table-wide-row", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule25(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "=")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K80, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
      context.report("deprecated-bare-highlight", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "=", true)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule26(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "~")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K82, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
      context.report("deprecated-bare-strike", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "~", true)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule27(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "_")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K83, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
      context.report("deprecated-bare-underline", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "_", true)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule28(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && (!starts(self.text, "=") || Boolean(obj(self.node)?.["header"])) && (hit(K84, K85, self.text) && mark(num(self.start))))) return
  if (!same(group("block", 0), group("block", 1))) {
    context.report("deprecated-cell-alignment", num(group("prefix", 0)), num(group("prefix", 1)), path, { "prefix": String(str(self.text).slice((num(group("prefix", 0)) - num(self.start)), (num(group("prefix", 1)) - num(self.start)))), "braced": String(("{" + str(self.text).slice((num(group("mark", 0)) - num(self.start)), (num(group("mark", 1)) - num(self.start))) + " " + str(self.text).slice((num(group("block", 0)) - num(self.start)), (num(group("block", 1)) - num(self.start))) + "}")) }, 0)
    return
  }
  context.report("deprecated-cell-alignment", num(group("prefix", 0)), num(group("prefix", 1)), path, { "prefix": String(str(self.text).slice((num(group("prefix", 0)) - num(self.start)), (num(group("prefix", 1)) - num(self.start)))), "braced": String(("{" + str(self.text).slice((num(group("mark", 0)) - num(self.start)), (num(group("mark", 1)) - num(self.start))) + "}")) }, 0)
  return
}

function rule29(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.body, "+") && test(K86, str(self.text).slice(0, (num(self.body_start) - num(self.start)))) && !K2.has(self.leaf))) return
  if (test(K87, str(self.text).slice(0, (num(self.body_start) - num(self.start))))) {
    context.report("deprecated-continuation-marker", num(self.body_start), (num(self.body_start) + 1), path, {  }, 2)
    return
  }
  if (contains(self.ancestors, "list_item")) {
    context.report("deprecated-continuation-marker", num(self.body_start), (num(self.body_start) + 1), path, {  }, 1)
    return
  }
  context.report("deprecated-continuation-marker", num(self.body_start), (num(self.body_start) + 1), path, {  }, 0)
  return
}

function rule30(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_line_start: unknown = UNSET
  let g_line_start: Record<string, [number, number]> | undefined
  let b_line_start = 0
  let v_line_end: unknown = UNSET
  let g_line_end: Record<string, [number, number]> | undefined
  let b_line_end = 0
  let v_line_body: unknown = UNSET
  let g_line_body: Record<string, [number, number]> | undefined
  let b_line_body = 0
  if (!((num((v_line_start === UNSET ? (g_line_start = groups, b_line_start = base, v_line_start = (obj(lookupAt(9, "line", undefined, K67, true, num(self.opener_start), 1, undefined))?.["start"]), groups = g_line_start, base = b_line_start, v_line_start) : v_line_start)) < num(self.end)) && (columnAt(context, num((v_line_body === UNSET ? (g_line_body = groups, b_line_body = base, v_line_body = (obj(lookupAt(9, "line", undefined, K67, true, num(self.opener_start), 1, undefined))?.["body_start"]), groups = g_line_body, base = b_line_body, v_line_body) : v_line_body)), countFrom(self.ancestors, 0, (item) => same(item, "blockquote"))) > num(self.mark_column)))) return
  context.report("deprecated-indented-line-under-heading", num((v_line_start === UNSET ? (g_line_start = groups, b_line_start = base, v_line_start = (obj(lookupAt(9, "line", undefined, K67, true, num(self.opener_start), 1, undefined))?.["start"]), groups = g_line_start, base = b_line_start, v_line_start) : v_line_start)), num((v_line_end === UNSET ? (g_line_end = groups, b_line_end = base, v_line_end = (obj(lookupAt(9, "line", undefined, K67, true, num(self.opener_start), 1, undefined))?.["end"]), groups = g_line_end, base = b_line_end, v_line_end) : v_line_end)), path, {  }, 0)
  return
}

function rule31(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(Boolean(self.attributed) && test(K88, str(self.text).slice(0, (num(self.opener_start) - num(self.start)))))) return
  context.report("deprecated-loose-attribute", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule32(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.index, 1) && test(K89, self.text) && contains(self.line?.["prev"]?.["text"], "|") && !test(K90, self.line?.["prev"]?.["text"]))) return
  context.report("deprecated-separator-row", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule33(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  let v_run_start: unknown = UNSET
  let g_run_start: Record<string, [number, number]> | undefined
  let b_run_start = 0
  if (!(test(K91, self.body) && (test(K92, textFrom(line, num((v_run_start === UNSET ? (g_run_start = groups, b_run_start = base, v_run_start = (scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)), groups = g_run_start, base = b_run_start, v_run_start) : v_run_start)))) || test(K93, textFrom(line, num((v_run_start === UNSET ? (g_run_start = groups, b_run_start = base, v_run_start = (scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)), groups = g_run_start, base = b_run_start, v_run_start) : v_run_start)))) || test(K94, textFrom(line, num((v_run_start === UNSET ? (g_run_start = groups, b_run_start = base, v_run_start = (scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)), groups = g_run_start, base = b_run_start, v_run_start) : v_run_start))))) && test(K95, textFrom(line, num((v_run_start === UNSET ? (g_run_start = groups, b_run_start = base, v_run_start = (scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)), groups = g_run_start, base = b_run_start, v_run_start) : v_run_start)))))) return
  context.report("deprecated-spaced-thematic-break", num((v_run_start === UNSET ? (g_run_start = groups, b_run_start = base, v_run_start = (scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)), groups = g_run_start, base = b_run_start, v_run_start) : v_run_start)), num(self.body_end), path, {  }, 0)
  return
}

function rule34(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && same(self.key, "header-rows") && Boolean(self.last_key) && same(self.owner?.["format"], "pipe"))) return
  context.report("deprecated-table-attribute", num(self.owner?.["start"]), num(self.owner?.["end"]), path, {  }, 0)
  return
}

function rule35(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_depth: unknown = UNSET
  let g_depth: Record<string, [number, number]> | undefined
  let b_depth = 0
  let v_content: unknown = UNSET
  let g_content: Record<string, [number, number]> | undefined
  let b_content = 0
  let v_content_start: unknown = UNSET
  let g_content_start: Record<string, [number, number]> | undefined
  let b_content_start = 0
  let v_host_index: unknown = UNSET
  let g_host_index: Record<string, [number, number]> | undefined
  let b_host_index = 0
  let v_host_list: unknown = UNSET
  let g_host_list: Record<string, [number, number]> | undefined
  let b_host_list = 0
  let v_host_column: unknown = UNSET
  let g_host_column: Record<string, [number, number]> | undefined
  let b_host_column = 0
  let v_column: unknown = UNSET
  let g_column: Record<string, [number, number]> | undefined
  let b_column = 0
  if (!(!(same((v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), 0) && test(K101, self.text)) && !(num(obj(lookupAt(12, "block", K102, K103, self.number, self.start, 0, undefined))?.["start"]) >= 0) && test(K104, (v_content === UNSET ? (g_content = groups, b_content = base, v_content = (((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")), groups = g_content, base = b_content, v_content) : v_content)) && !(same(self.leaf, "definition_term") && Boolean(self.leaf_first)) && (num((v_host_column === UNSET ? (g_host_column = groups, b_host_column = base, v_host_column = (obj(lookupAt(11, "block", K99, K100, (v_host_list === UNSET ? (g_host_list = groups, b_host_list = base, v_host_list = (((num((v_host_index === UNSET ? (g_host_index = groups, b_host_index = base, v_host_index = (indexOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestors"], "definition_list")), groups = g_host_index, base = b_host_index, v_host_index) : v_host_index)) >= 0) ? nthOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestor_ids"], num((v_host_index === UNSET ? (g_host_index = groups, b_host_index = base, v_host_index = (indexOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestors"], "definition_list")), groups = g_host_index, base = b_host_index, v_host_index) : v_host_index))) : "")), groups = g_host_list, base = b_host_list, v_host_list) : v_host_list), self.start, 0, undefined))?.["column"]), groups = g_host_column, base = b_host_column, v_host_column) : v_host_column)) > num((v_column === UNSET ? (g_column = groups, b_column = base, v_column = (columnAt(context, num((v_content_start === UNSET ? (g_content_start = groups, b_content_start = base, v_content_start = (((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)), groups = g_content_start, base = b_content_start, v_content_start) : v_content_start)), num((v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth)))), groups = g_column, base = b_column, v_column) : v_column))))) return
  context.report("description-separator-below-content-column", num((v_content_start === UNSET ? (g_content_start = groups, b_content_start = base, v_content_start = (((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)), groups = g_content_start, base = b_content_start, v_content_start) : v_content_start)), (num((v_content_start === UNSET ? (g_content_start = groups, b_content_start = base, v_content_start = (((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)), groups = g_content_start, base = b_content_start, v_content_start) : v_content_start)) + lenOf((v_content === UNSET ? (g_content = groups, b_content = base, v_content = (((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")), groups = g_content, base = b_content, v_content) : v_content))), path, { "name": String((starts((v_content === UNSET ? (g_content = groups, b_content = base, v_content = (((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")), groups = g_content, base = b_content, v_content) : v_content), "::") ? "term" : "description")), "column": String((num((v_column === UNSET ? (g_column = groups, b_column = base, v_column = (columnAt(context, num((v_content_start === UNSET ? (g_content_start = groups, b_content_start = base, v_content_start = (((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)), groups = g_content_start, base = b_content_start, v_content_start) : v_content_start)), num((v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth)))), groups = g_column, base = b_column, v_column) : v_column)) + 1)), "host.column": String((num((v_host_column === UNSET ? (g_host_column = groups, b_host_column = base, v_host_column = (obj(lookupAt(11, "block", K99, K100, (v_host_list === UNSET ? (g_host_list = groups, b_host_list = base, v_host_list = (((num((v_host_index === UNSET ? (g_host_index = groups, b_host_index = base, v_host_index = (indexOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestors"], "definition_list")), groups = g_host_index, base = b_host_index, v_host_index) : v_host_index)) >= 0) ? nthOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestor_ids"], num((v_host_index === UNSET ? (g_host_index = groups, b_host_index = base, v_host_index = (indexOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestors"], "definition_list")), groups = g_host_index, base = b_host_index, v_host_index) : v_host_index))) : "")), groups = g_host_list, base = b_host_list, v_host_list) : v_host_list), self.start, 0, undefined))?.["column"]), groups = g_host_column, base = b_host_column, v_host_column) : v_host_column)) + 1)) }, 0)
  return
}

function rule36(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "definition_term") && !Boolean(self.leaf_first) && test(K105, self.body))) return
  context.report("description-term-multi-line", num(self.body_start), num(self.end), path, {  }, 0)
  return
}

function rule37(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && Boolean(self.leaf_first) && test(K106, self.body))) return
  context.report("djot-definition-list", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule38(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "_")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K83, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K81, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
      context.report("djot-emphasis-underscore", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "_", false)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule39(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.text, "{_")) return
  context.report("djot-emphasis-underscore-braced", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule40(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && starts(self.prev?.["body"], "# ") && test(K97, self.text) && ((num(self.body_start) - num(self.start)) <= (num(self.prev?.["body_start"]) - num(self.prev?.["start"]))))) return
  context.report("djot-heading-continuation", num(self.prev?.["start"]), num(self.end), path, {  }, 0)
  return
}

function rule41(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.text, "{=")) return
  context.report("djot-highlight-braces", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule42(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "_")) return
  const one = (): void => {
    if (test(K108, str(self.text).slice((num(group("pair", 1)) - num(self.start)), ((num(group("pair", 1)) - num(self.start)) + 1)))) {
      context.report("djot-intraword-underscore", num(group("pair", 0)), num(group("pair", 1)), path, {  }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K107, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule43(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_item_index: unknown = UNSET
  let g_item_index: Record<string, [number, number]> | undefined
  let b_item_index = 0
  let v_item_marker_column: unknown = UNSET
  let g_item_marker_column: Record<string, [number, number]> | undefined
  let b_item_marker_column = 0
  let v_column: unknown = UNSET
  let g_column: Record<string, [number, number]> | undefined
  let b_column = 0
  if (!(same(self.leaf, "paragraph") && test(K110, self.body) && (Boolean(self.leaf_first) || (Boolean(self.lazy) && ((num((v_item_index === UNSET ? (g_item_index = groups, b_item_index = base, v_item_index = (indexOf(self.ancestors, "list_item")), groups = g_item_index, base = b_item_index, v_item_index) : v_item_index)) < 0) || (num((v_column === UNSET ? (g_column = groups, b_column = base, v_column = (columnAt(context, num(self.body_start), num(self.quote_depth))), groups = g_column, base = b_column, v_column) : v_column)) <= num((v_item_marker_column === UNSET ? (g_item_marker_column = groups, b_item_marker_column = base, v_item_marker_column = (((num((v_item_index === UNSET ? (g_item_index = groups, b_item_index = base, v_item_index = (indexOf(self.ancestors, "list_item")), groups = g_item_index, base = b_item_index, v_item_index) : v_item_index)) >= 0) ? obj(lookupAt(13, "block", K109, K100, nthOf(self.ancestor_ids, num((v_item_index === UNSET ? (g_item_index = groups, b_item_index = base, v_item_index = (indexOf(self.ancestors, "list_item")), groups = g_item_index, base = b_item_index, v_item_index) : v_item_index))), self.start, 0, undefined))?.["opener_column"] : -1)), groups = g_item_marker_column, base = b_item_marker_column, v_item_marker_column) : v_item_marker_column)))))))) return
  context.report("djot-ordered-marker", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule44(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K111, self.body))) return
  context.report("djot-plus-bullet", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule45(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "~")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K82, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "{") && !same(str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start))), "}") && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "~"))) {
      context.report("djot-subscript-tilde", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "~", false)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule46(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.text, "{~")) return
  context.report("djot-subscript-tilde-braced", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule47(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "^")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K112, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "{") && !same(str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start))), "}") && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "^"))) {
      context.report("djot-superscript-caret", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "^", false)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule48(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  context.report("djot-tag-mention", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule49(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!!K113.has(obj(self.node)?.["kind"])) return
  context.report("djot-typography-sign", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule50(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(num(obj(lookupAt(14, "block", K114, K115, obj(self.node)?.["href"], self.start, 0, undefined))?.["start"]) < num(self.start))) return
  context.report("duplicate-reference-url", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule51(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(someFrom(obj(self.node)?.["children"], 0, (item) => K116.has(obj(item)?.["type"])) && same(countFrom(obj(self.node)?.["children"], 0, (item) => (!same(obj(item)?.["type"], "comment") && !(same(obj(item)?.["type"], "text") && test(K117, obj(item)?.["value"])))), 1))) return
  context.report("emphasis-as-heading", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule52(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!((same(self.type, "text_run") && contains(self.text, "{")) || (same(self.type, "strong") && test(K118, self.text)) || (same(self.type, "emphasis") && test(K119, self.text)))) return
  const one = (): void => {
    if ((same(self.type, "text_run") && isAttributeLine(str(self.text).slice((num(group("blk", 0)) - num(self.start)), (num(group("blk", 1)) - num(self.start))), 0, str(self.text).slice((num(group("blk", 0)) - num(self.start)), (num(group("blk", 1)) - num(self.start))).length))) {
      context.report("emphasis-marker-before-attributes", num(group("m", 0)), num(group("blk", 1)), path, { "ch": String(str(self.text).slice((num(group("m", 0)) - num(self.start)), (num(group("m", 1)) - num(self.start)))) }, 0)
      return
    }
    if ((!same(self.type, "text_run") && same(group("run", 1), self.end) && same(str(self.text).slice((num(group("m", 0)) - num(self.start)), (num(group("m", 1)) - num(self.start))), (same(self.type, "strong") ? "*" : "/")) && (obj(self.node)?.["attrs"] !== undefined))) {
      context.report("emphasis-marker-before-attributes", num(group("m", 0)), num(group("m", 1)), path, { "marker": String(str(self.text).slice((num(group("m", 0)) - num(self.start)), (num(group("m", 1)) - num(self.start)))), "name": String(self.type), "line": String(obj(obj(self.node)?.["pos"])?.["startLine"]), "column": String(obj(obj(self.node)?.["pos"])?.["startColumn"]) }, 1)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K120, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule53(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && contains(self.text, "{{"))) return
  const one = (): void => {
    if (!test(K122, str(self.text).slice((num(group("include", 0)) - num(self.start)), (num(group("include", 1)) - num(self.start))))) {
      context.report("empty-include-path", num(group("include", 0)), num(group("include", 1)), path, { "text": String(str(self.text).slice((num(group("include", 0)) - num(self.start)), (num(group("include", 1)) - num(self.start)))) }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K121, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule54(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K123, self.text)) return
  context.report("empty-link-destination", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule55(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && (hit(K124, K125, self.body) && mark(num(self.body_start))) && !test(K126, self.body))) return
  if (starts(self.body, "[^")) {
    context.report("empty-reference-definition", num(group("def", 0)), num(group("def", 1)), path, { "label": String(str(self.body).slice(1, (lenOf(self.body) - 2))) }, 1)
    return
  }
  context.report("empty-reference-definition", num(group("def", 0)), num(group("def", 1)), path, { "label": String(str(self.body).slice(1, (lenOf(self.body) - 2))) }, 0)
  return
}

function rule56(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_run: unknown = UNSET
  let g_run: Record<string, [number, number]> | undefined
  let b_run = 0
  let v_at: unknown = UNSET
  let g_at: Record<string, [number, number]> | undefined
  let b_at = 0
  if (!((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (lenOf((v_run === UNSET ? (g_run = groups, b_run = base, v_run = (((hit(K127, K128, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : "")), groups = g_run, base = b_run, v_run) : v_run)) >= 3) && (hit(K129, K130, self.last_line?.["text"]) && mark(num(self.last_line?.["start"]))) && test(K131, self.last_line?.["body"]) && !same((num(group("close", 0)) - num(self.last_line?.["start"])), (v_at === UNSET ? (g_at = groups, b_at = base, v_at = (((hit(K127, K128, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? (num(group("run", 0)) - num(self.line?.["start"])) : -1)), groups = g_at, base = b_at, v_at) : v_at)) && starts(str(self.last_line?.["text"]).slice((num(group("close", 0)) - num(self.last_line?.["start"]))), str((v_run === UNSET ? (g_run = groups, b_run = base, v_run = (((hit(K127, K128, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : "")), groups = g_run, base = b_run, v_run) : v_run))) && !(K132.has(self.owner?.["type"]) && test(K133, str(self.line?.["text"]).slice(0, num((v_at === UNSET ? (g_at = groups, b_at = base, v_at = (((hit(K127, K128, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? (num(group("run", 0)) - num(self.line?.["start"])) : -1)), groups = g_at, base = b_at, v_at) : v_at)))) && (columnAt(context, num(group("close", 0)), num(self.last_line?.["quote_depth"])) <= num(self.owner?.["content_column"]))))) return
  context.report("fence-closer-indented", num(group("close", 0)), num(self.last_line?.["end"]), path, { "line": String(self.line?.["number"]) }, 0)
  return
}

function rule57(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!same(countFrom(obj(self.node)?.["children"], 0, (item) => (same(obj(item)?.["type"], "table") || (!same(obj(item)?.["type"], "figure_group") && (obj(item)?.["caption"] !== undefined)))), 0)) return
  context.report("figure-group-empty", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule58(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K134, self.opener_text) && contains(self.ancestors, "figure_group"))) return
  context.report("figure-group-nested", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule59(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K135, self.line?.["text"]) && test(K136, self.line?.["text"]))) return
  context.report("figure-group-opener-metadata", num(self.line?.["start"]), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule60(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "figure_group") && !same(self.type, "figure_group") && someFrom(obj(obj(self.node)?.["caption"])?.["children"], 0, (item) => someFrom(obj(item)?.["children"], 0, (item) => same(obj(item)?.["type"], "caption_number"))))) return
  context.report("figure-group-panel-number", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule61(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!same(countFrom(obj(self.node)?.["children"], 0, (item) => (same(obj(item)?.["type"], "table") || (!same(obj(item)?.["type"], "figure_group") && (obj(item)?.["caption"] !== undefined)))), 1)) return
  context.report("figure-group-single-panel", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule62(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_twin_start: unknown = UNSET
  let g_twin_start: Record<string, [number, number]> | undefined
  let b_twin_start = 0
  let v_twin_text: unknown = UNSET
  let g_twin_text: Record<string, [number, number]> | undefined
  let b_twin_text = 0
  let v_label: unknown = UNSET
  let g_label: Record<string, [number, number]> | undefined
  let b_label = 0
  let v_twin_label: unknown = UNSET
  let g_twin_label: Record<string, [number, number]> | undefined
  let b_twin_label = 0
  if (!((hit(K140, K141, self.text) && mark(num(self.start))) && !same((v_twin_start === UNSET ? (g_twin_start = groups, b_twin_start = base, v_twin_start = (obj(lookupAt(15, "block", K137, K139, obj(self.node)?.["key"], self.start, 0, undefined))?.["start"]), groups = g_twin_start, base = b_twin_start, v_twin_start) : v_twin_start), self.start) && !same((v_twin_label === UNSET ? (g_twin_label = groups, b_twin_label = base, v_twin_label = (((hit(K140, K141, (v_twin_text === UNSET ? (g_twin_text = groups, b_twin_text = base, v_twin_text = (obj(lookupAt(15, "block", K137, K139, obj(self.node)?.["key"], self.start, 0, undefined))?.["text"]), groups = g_twin_text, base = b_twin_text, v_twin_text) : v_twin_text)) && mark(0)) ? str((v_twin_text === UNSET ? (g_twin_text = groups, b_twin_text = base, v_twin_text = (obj(lookupAt(15, "block", K137, K139, obj(self.node)?.["key"], self.start, 0, undefined))?.["text"]), groups = g_twin_text, base = b_twin_text, v_twin_text) : v_twin_text)).slice(2, num(group("label", 1))) : "")), groups = g_twin_label, base = b_twin_label, v_twin_label) : v_twin_label), (v_label === UNSET ? (g_label = groups, b_label = base, v_label = (((hit(K140, K141, self.text) && mark(num(self.start))) ? str(self.text).slice(2, (num(group("label", 1)) - num(self.start))) : "")), groups = g_label, base = b_label, v_label) : v_label)))) return
  context.report("footnote-labels-differ-only-in-whitespace", num(self.start), num(self.end), path, { "label": String((v_label === UNSET ? (g_label = groups, b_label = base, v_label = (((hit(K140, K141, self.text) && mark(num(self.start))) ? str(self.text).slice(2, (num(group("label", 1)) - num(self.start))) : "")), groups = g_label, base = b_label, v_label) : v_label)), "twin": String((v_twin_label === UNSET ? (g_twin_label = groups, b_twin_label = base, v_twin_label = (((hit(K140, K141, (v_twin_text === UNSET ? (g_twin_text = groups, b_twin_text = base, v_twin_text = (obj(lookupAt(15, "block", K137, K139, obj(self.node)?.["key"], self.start, 0, undefined))?.["text"]), groups = g_twin_text, base = b_twin_text, v_twin_text) : v_twin_text)) && mark(0)) ? str((v_twin_text === UNSET ? (g_twin_text = groups, b_twin_text = base, v_twin_text = (obj(lookupAt(15, "block", K137, K139, obj(self.node)?.["key"], self.start, 0, undefined))?.["text"]), groups = g_twin_text, base = b_twin_text, v_twin_text) : v_twin_text)).slice(2, num(group("label", 1))) : "")), groups = g_twin_label, base = b_twin_label, v_twin_label) : v_twin_label)), "key": String(JSON.stringify(str(obj(self.node)?.["key"])).slice(1, -1)) }, 0)
  return
}

function rule63(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!same(self.parent?.["type"], "document") && test(K142, self.opener_text))) return
  context.report("footnotes-placement-in-container", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule64(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_owner: unknown = UNSET
  let g_owner: Record<string, [number, number]> | undefined
  let b_owner = 0
  let v_target: unknown = UNSET
  let g_target: Record<string, [number, number]> | undefined
  let b_target = 0
  if (!(same((v_owner === UNSET ? (g_owner = groups, b_owner = base, v_owner = (obj(lookupAt(2, "id", K32, K33, str(obj(self.node)?.["key"]).normalize('NFC'), self.start, 0, undefined))?.["owner"]), groups = g_owner, base = b_owner, v_owner) : v_owner), "frontmatter") && !Boolean((v_target === UNSET ? (g_target = groups, b_target = base, v_target = (obj(lookupAt(4, "id", K32, K35, str(obj(self.node)?.["key"]).normalize('NFC'), self.start, 0, undefined))?.["xref"]), groups = g_target, base = b_target, v_target) : v_target)))) return
  context.report("frontmatter-crossref", num(self.start), num(self.end), path, { "target": String(obj(self.node)?.["key"]) }, 0)
  return
}

function rule65(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K143, self.text) && (test(K144, self.text) || test(K145, self.text)))) return
  context.report("frontmatter-shaped-thematic-break", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule66(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K146.has(self.leaf) && !test(K147, self.text) && (hit(K148, K149, self.text) && mark(num(self.start))))) return
  context.report("github-alert-marker", num(group("mark", 0)), num(group("mark", 1)), path, {  }, 0)
  return
}

function rule67(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K150, self.text)) return
  context.report("glob-shaped-strong", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule68(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((same(self.last_line?.["number"], self.line?.["number"]) && (hit(K151, K152, self.line?.["body"]) && mark(num(self.line?.["body_start"])))) || ((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (hit(K153, K154, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))))) return
  context.report("heading-closing-hashes", num(group("run", 0)), num(group("run", 1)), path, { "run": String(str(self.last_line?.["text"]).slice((num(group("run", 0)) - num(self.last_line?.["start"])), (num(group("run", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule69(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_previous: unknown = UNSET
  let g_previous: Record<string, [number, number]> | undefined
  let b_previous = 0
  if (!(num(obj(self.node)?.["level"]) > (num((v_previous === UNSET ? (g_previous = groups, b_previous = base, v_previous = (obj(obj(lookupAt(16, "block", K155, undefined, undefined, self.start, -1, undefined))?.["node"])?.["level"]), groups = g_previous, base = b_previous, v_previous) : v_previous)) + 1))) return
  context.report("heading-level-skip", num(self.start), num(self.end), path, { "previous": String((v_previous === UNSET ? (g_previous = groups, b_previous = base, v_previous = (obj(obj(lookupAt(16, "block", K155, undefined, undefined, self.start, -1, undefined))?.["node"])?.["level"]), groups = g_previous, base = b_previous, v_previous) : v_previous)), "level": String(obj(self.node)?.["level"]) }, 0)
  return
}

function rule70(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(obj(lookupAt(17, "block", K155, K157, true, self.start, 0, undefined))?.["start"], self.start) && (num(obj(lookupAt(18, "block", K155, K159, true, self.start, 0, undefined))?.["start"]) >= 0) && (num(obj(lookupAt(19, "block", K155, K161, true, self.start, 0, undefined))?.["start"]) >= 0))) return
  context.report("heading-marker-mixed", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule71(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(hit(K162, K163, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))) return
  context.report("heading-trailing-attribute", num(group("block", 0)), num(group("block", 1)), path, { "block": String(str(self.last_line?.["text"]).slice((num(group("block", 0)) - num(self.last_line?.["start"])), (num(group("block", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule72(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  const one = (): void => {
    if (((indexOf(str(self.text).slice((num(group("o", 1)) - num(self.start))), "-->") >= 0) && contains(str(self.text).slice((num(group("o", 1)) - num(self.start))).slice(0, indexOf(str(self.text).slice((num(group("o", 1)) - num(self.start))), "-->")), "\n") && !test(K165, str(self.text).slice(0, (num(group("o", 0)) - num(self.start)))))) {
      context.report("html-comment-renders-as-text", num(group("o", 0)), (num(group("o", 1)) + indexOf(str(self.text).slice((num(group("o", 1)) - num(self.start))), "-->") + 3), path, {  }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K164, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule73(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && (hit(K166, K167, self.text) && mark(num(self.start))))) return
  context.report("html-comment-renders-as-text", num(group("c", 0)), num(group("c", 1)), path, {  }, 0)
  return
}

function rule74(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((obj(self.node)?.["attrs"] !== undefined) && !(obj(obj(self.node)?.["options"])?.["code"] !== undefined))) return
  context.report("include-attributes-unused", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule75(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((obj(obj(self.node)?.["options"])?.["lines"] !== undefined) && K65.has(obj(obj(self.node)?.["options"])?.["code"]) && someFrom(obj(obj(self.node)?.["attrs"])?.["keyValues"], 0, (item) => same(obj(item)?.[0], "table")) && (hit(K168, K169, self.text) && mark(num(self.start))))) return
  context.report("include-lines-table-rows-hint", num(group("lines", 0)), num(group("lines", 1)), path, {  }, 0)
  return
}

function rule76(self: ModelBlock, path: string, context: LintContext): void {
  const line = self.line
  groups = undefined
  if (!(same(self.parent?.["type"], "document") && (num(self.line?.["number"]) > 1) && test(K170, self.line?.["prev"]?.["text"]) && !same(self.prev_type, "list") && test(K171, self.line?.["text"]))) return
  context.report("indented-code-block", scan(line, num(self.line?.["start"]), " \t", 1), (num(self.line?.["start"]) + lenOf(trimEnd(str(self.line?.["text"])))), path, {  }, 0)
  return
}

function rule77(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_next_text: unknown = UNSET
  let g_next_text: Record<string, [number, number]> | undefined
  let b_next_text = 0
  let v_next_raw: unknown = UNSET
  let g_next_raw: Record<string, [number, number]> | undefined
  let b_next_raw = 0
  let v_next_body: unknown = UNSET
  let g_next_body: Record<string, [number, number]> | undefined
  let b_next_body = 0
  let v_next_end: unknown = UNSET
  let g_next_end: Record<string, [number, number]> | undefined
  let b_next_end = 0
  if (!(test(K172, (v_next_text === UNSET ? (g_next_text = groups, b_next_text = base, v_next_text = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["text"]), groups = g_next_text, base = b_next_text, v_next_text) : v_next_text)) && !(test(K173, (v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw)) || isAttributeLine(str((v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw)), 0, str((v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw)).length) || ((hit(K174, K175, (v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw)) && mark(0)) && isAttributeLine(str((v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw)).slice(num(group("attr", 0)), lenOf((v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw))), 0, str((v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw)).slice(num(group("attr", 0)), lenOf((v_next_raw === UNSET ? (g_next_raw = groups, b_next_raw = base, v_next_raw = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["raw_body"]), groups = g_next_raw, base = b_next_raw, v_next_raw) : v_next_raw))).length))))) return
  context.report("link-definition-indented-line", num((v_next_body === UNSET ? (g_next_body = groups, b_next_body = base, v_next_body = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["body_start"]), groups = g_next_body, base = b_next_body, v_next_body) : v_next_body)), num((v_next_end === UNSET ? (g_next_end = groups, b_next_end = base, v_next_end = (obj(lookupAt(9, "line", undefined, K67, true, num(self.end), 1, undefined))?.["body_end"]), groups = g_next_end, base = b_next_end, v_next_end) : v_next_end)), path, {  }, 0)
  return
}

function rule78(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && contains(self.text, "]"))) return
  const one = (): void => {
    if (((num(group("link", 0)) >= 0) && test(K177, str(self.text).slice((num(group("dest", 0)) - num(self.start)), (num(group("dest", 1)) - num(self.start)))))) {
      context.report("link-gap-before-destination", num(group("link", 0)), num(group("link", 1)), path, {  }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K176, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule79(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((same(self.item_owner?.["type"], "list_item") && K178.has(self.parent?.["type"])) && (K179.has(self.type) || Boolean(self.image_line) || Boolean(self.attributed)) && (num(self.opener_column) > num(self.item_owner?.["content_column"])))) return
  context.report("list-item-block-overindented", num(self.start), num(self.line?.["end"]), path, { "contentColumn": String((num(self.item_owner?.["content_column"]) + 1)) }, 0)
  return
}

function rule80(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (num(self.index) >= 1) && (num(self.column) > num(self.parent?.["marker_column"])) && (num(self.column) < num(self.parent?.["content_column"])))) return
  context.report("list-item-body-below-content-column", num(self.start), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule81(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_previous: unknown = UNSET
  let g_previous: Record<string, [number, number]> | undefined
  let b_previous = 0
  let v_outer: unknown = UNSET
  let g_outer: Record<string, [number, number]> | undefined
  let b_outer = 0
  let v_list_index: unknown = UNSET
  let g_list_index: Record<string, [number, number]> | undefined
  let b_list_index = 0
  let v_list_prev: unknown = UNSET
  let g_list_prev: Record<string, [number, number]> | undefined
  let b_list_prev = 0
  let v_prev_list: unknown = UNSET
  let g_prev_list: Record<string, [number, number]> | undefined
  let b_prev_list = 0
  let v_prev_index: unknown = UNSET
  let g_prev_index: Record<string, [number, number]> | undefined
  let b_prev_index = 0
  let v_closer_index: unknown = UNSET
  let g_closer_index: Record<string, [number, number]> | undefined
  let b_closer_index = 0
  let v_deeper: unknown = UNSET
  let g_deeper: Record<string, [number, number]> | undefined
  let b_deeper = 0
  if (!(num((v_outer === UNSET ? (g_outer = groups, b_outer = base, v_outer = (obj(obj(lookupAt(13, "block", K109, K100, self.ancestor_ids?.[1], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_outer, base = b_outer, v_outer) : v_outer)) >= 0)) return
  if (((num(self.index) >= 1) && (num(self.layout?.["markerColumn"]) < num((v_previous === UNSET ? (g_previous = groups, b_previous = base, v_previous = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_previous, base = b_previous, v_previous) : v_previous))) && (num(self.layout?.["markerColumn"]) > num((v_outer === UNSET ? (g_outer = groups, b_outer = base, v_outer = (obj(obj(lookupAt(13, "block", K109, K100, self.ancestor_ids?.[1], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_outer, base = b_outer, v_outer) : v_outer))))) {
    context.report("list-marker-below-content-column", num(self.start), num(self.end), path, { "column": String((num(self.layout?.["markerColumn"]) + 1)), "contentColumn": String((num((v_previous === UNSET ? (g_previous = groups, b_previous = base, v_previous = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_previous, base = b_previous, v_previous) : v_previous)) + 1)), "baseColumn": String((num((v_outer === UNSET ? (g_outer = groups, b_outer = base, v_outer = (obj(obj(lookupAt(13, "block", K109, K100, self.ancestor_ids?.[1], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_outer, base = b_outer, v_outer) : v_outer)) + 1)) }, 0)
    return
  }
  if ((same(self.index, 0) && (num((v_list_index === UNSET ? (g_list_index = groups, b_list_index = base, v_list_index = (obj(lookupAt(21, "block", K181, K100, self.ancestor_ids?.[0], self.start, 0, undefined))?.["index"]), groups = g_list_index, base = b_list_index, v_list_index) : v_list_index)) >= 1) && K183.has((v_list_prev === UNSET ? (g_list_prev = groups, b_list_prev = base, v_list_prev = (obj(lookupAt(21, "block", K181, K100, self.ancestor_ids?.[0], self.start, 0, undefined))?.["prev_type"]), groups = g_list_prev, base = b_list_prev, v_list_prev) : v_list_prev)) && (!(num((v_closer_index === UNSET ? (g_closer_index = groups, b_closer_index = base, v_closer_index = (obj(lookupAt(23, "block", undefined, K184, self.ancestor_ids?.[1], self.start, -1, undefined))?.["index"]), groups = g_closer_index, base = b_closer_index, v_closer_index) : v_closer_index)) >= 0) || (num((v_closer_index === UNSET ? (g_closer_index = groups, b_closer_index = base, v_closer_index = (obj(lookupAt(23, "block", undefined, K184, self.ancestor_ids?.[1], self.start, -1, undefined))?.["index"]), groups = g_closer_index, base = b_closer_index, v_closer_index) : v_closer_index)) < num((v_prev_index === UNSET ? (g_prev_index = groups, b_prev_index = base, v_prev_index = (obj(lookupAt(21, "block", K181, K100, (v_prev_list === UNSET ? (g_prev_list = groups, b_prev_list = base, v_prev_list = (obj(obj(lookupAt(22, "block", K109, K182, self.ancestor_ids?.[1], self.start, -1, undefined))?.["ancestor_ids"])?.[0]), groups = g_prev_list, base = b_prev_list, v_prev_list) : v_prev_list), self.start, 0, undefined))?.["index"]), groups = g_prev_index, base = b_prev_index, v_prev_index) : v_prev_index)))) && (num((v_outer === UNSET ? (g_outer = groups, b_outer = base, v_outer = (obj(obj(lookupAt(13, "block", K109, K100, self.ancestor_ids?.[1], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_outer, base = b_outer, v_outer) : v_outer)) < num(self.layout?.["markerColumn"])) && (num(self.layout?.["markerColumn"]) < num((v_deeper === UNSET ? (g_deeper = groups, b_deeper = base, v_deeper = (obj(obj(lookupAt(20, "block", K109, K180, (v_prev_list === UNSET ? (g_prev_list = groups, b_prev_list = base, v_prev_list = (obj(obj(lookupAt(22, "block", K109, K182, self.ancestor_ids?.[1], self.start, -1, undefined))?.["ancestor_ids"])?.[0]), groups = g_prev_list, base = b_prev_list, v_prev_list) : v_prev_list), self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_deeper, base = b_deeper, v_deeper) : v_deeper))))) {
    context.report("list-marker-below-content-column", num(self.start), num(self.end), path, { "column": String((num(self.layout?.["markerColumn"]) + 1)), "contentColumn": String((num((v_deeper === UNSET ? (g_deeper = groups, b_deeper = base, v_deeper = (obj(obj(lookupAt(20, "block", K109, K180, (v_prev_list === UNSET ? (g_prev_list = groups, b_prev_list = base, v_prev_list = (obj(obj(lookupAt(22, "block", K109, K182, self.ancestor_ids?.[1], self.start, -1, undefined))?.["ancestor_ids"])?.[0]), groups = g_prev_list, base = b_prev_list, v_prev_list) : v_prev_list), self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_deeper, base = b_deeper, v_deeper) : v_deeper)) + 1)), "baseColumn": String((num((v_outer === UNSET ? (g_outer = groups, b_outer = base, v_outer = (obj(obj(lookupAt(13, "block", K109, K100, self.ancestor_ids?.[1], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_outer, base = b_outer, v_outer) : v_outer)) + 1)) }, 0)
    return
  }
}

function rule82(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K185.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.leaf_first) && test(K186, self.body))) return
  if ((same(self.leaf, "definition_term") || contains(self.ancestors, "definition_term") || contains(self.ancestors, "definition_description"))) {
    context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule83(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_depth: unknown = UNSET
  let g_depth: Record<string, [number, number]> | undefined
  let b_depth = 0
  let v_content: unknown = UNSET
  let g_content: Record<string, [number, number]> | undefined
  let b_content = 0
  let v_content_start: unknown = UNSET
  let g_content_start: Record<string, [number, number]> | undefined
  let b_content_start = 0
  let v_host_index: unknown = UNSET
  let g_host_index: Record<string, [number, number]> | undefined
  let b_host_index = 0
  let v_host_list: unknown = UNSET
  let g_host_list: Record<string, [number, number]> | undefined
  let b_host_list = 0
  let v_host_column: unknown = UNSET
  let g_host_column: Record<string, [number, number]> | undefined
  let b_host_column = 0
  let v_column: unknown = UNSET
  let g_column: Record<string, [number, number]> | undefined
  let b_column = 0
  if (!(same(self.leaf, "paragraph") && same(self.prev?.["leaf_id"], self.leaf_id) && test(K187, self.body) && !starts(self.prev?.["body"], ":: ") && !(!(same((v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), 0) && test(K101, self.text)) && !(num(obj(lookupAt(12, "block", K102, K103, self.number, self.start, 0, undefined))?.["start"]) >= 0) && test(K104, (v_content === UNSET ? (g_content = groups, b_content = base, v_content = (((hit(K6, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")), groups = g_content, base = b_content, v_content) : v_content)) && !(same(self.leaf, "definition_term") && Boolean(self.leaf_first)) && (num((v_host_column === UNSET ? (g_host_column = groups, b_host_column = base, v_host_column = (obj(lookupAt(11, "block", K99, K100, (v_host_list === UNSET ? (g_host_list = groups, b_host_list = base, v_host_list = (((num((v_host_index === UNSET ? (g_host_index = groups, b_host_index = base, v_host_index = (indexOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestors"], "definition_list")), groups = g_host_index, base = b_host_index, v_host_index) : v_host_index)) >= 0) ? nthOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestor_ids"], num((v_host_index === UNSET ? (g_host_index = groups, b_host_index = base, v_host_index = (indexOf(obj(lookupAt(10, "line", undefined, K98, (v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth), self.start, -1, undefined))?.["ancestors"], "definition_list")), groups = g_host_index, base = b_host_index, v_host_index) : v_host_index))) : "")), groups = g_host_list, base = b_host_list, v_host_list) : v_host_list), self.start, 0, undefined))?.["column"]), groups = g_host_column, base = b_host_column, v_host_column) : v_host_column)) > num((v_column === UNSET ? (g_column = groups, b_column = base, v_column = (columnAt(context, num((v_content_start === UNSET ? (g_content_start = groups, b_content_start = base, v_content_start = (((hit(K6, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)), groups = g_content_start, base = b_content_start, v_content_start) : v_content_start)), num((v_depth === UNSET ? (g_depth = groups, b_depth = base, v_depth = ((K96.has(self.leaf) ? self.quote_depth : 0)), groups = g_depth, base = b_depth, v_depth) : v_depth)))), groups = g_column, base = b_column, v_column) : v_column)))))) return
  context.report("markdown-definition-paragraph", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule84(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "~~")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K82, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))))) {
      context.report("markdown-strikethrough-double-tilde", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "~~", false)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule85(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "**")) return
  const one = (): void => {
    if ((!test(K78, str(self.text).slice((num(group("backslashes", 0)) - num(self.start)), (num(group("open", 0)) - num(self.start)))) && !test(K79, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K188, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !contains(str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start))), "*"))) {
      context.report("markdown-strong-double-star", num(group("open", 0)), num(group("close", 1)), path, {  }, 0)
      return
    }
  }
  for (const found of pairsOf(self.text, "**", false)) {
    groups = found
    base = num(self.start)
    one()
  }
}

function rule86(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_next_index: unknown = UNSET
  let g_next_index: Record<string, [number, number]> | undefined
  let b_next_index = 0
  let v_next_style: unknown = UNSET
  let g_next_style: Record<string, [number, number]> | undefined
  let b_next_style = 0
  let v_next_line: unknown = UNSET
  let g_next_line: Record<string, [number, number]> | undefined
  let b_next_line = 0
  if (!(K189.has(self.parent?.["type"]) && same(lenOf(obj(self.node)?.["children"]), 1) && same((v_next_index === UNSET ? (g_next_index = groups, b_next_index = base, v_next_index = (obj(lookupAt(24, "block", K181, K180, self.ancestor_ids?.[0], self.start, 1, undefined))?.["index"]), groups = g_next_index, base = b_next_index, v_next_index) : v_next_index), (num(self.index) + 1)) && ((same(obj(obj(self.node)?.["marker"])?.["style"], "i") && same((v_next_style === UNSET ? (g_next_style = groups, b_next_style = base, v_next_style = (obj(obj(obj(lookupAt(24, "block", K181, K180, self.ancestor_ids?.[0], self.start, 1, undefined))?.["node"])?.["marker"])?.["style"]), groups = g_next_style, base = b_next_style, v_next_style) : v_next_style), "a")) || (same(obj(obj(self.node)?.["marker"])?.["style"], "a") && same((v_next_style === UNSET ? (g_next_style = groups, b_next_style = base, v_next_style = (obj(obj(obj(lookupAt(24, "block", K181, K180, self.ancestor_ids?.[0], self.start, 1, undefined))?.["node"])?.["marker"])?.["style"]), groups = g_next_style, base = b_next_style, v_next_style) : v_next_style), "i")) || (same(obj(obj(self.node)?.["marker"])?.["style"], "I") && same((v_next_style === UNSET ? (g_next_style = groups, b_next_style = base, v_next_style = (obj(obj(obj(lookupAt(24, "block", K181, K180, self.ancestor_ids?.[0], self.start, 1, undefined))?.["node"])?.["marker"])?.["style"]), groups = g_next_style, base = b_next_style, v_next_style) : v_next_style), "A")) || (same(obj(obj(self.node)?.["marker"])?.["style"], "A") && same((v_next_style === UNSET ? (g_next_style = groups, b_next_style = base, v_next_style = (obj(obj(obj(lookupAt(24, "block", K181, K180, self.ancestor_ids?.[0], self.start, 1, undefined))?.["node"])?.["marker"])?.["style"]), groups = g_next_style, base = b_next_style, v_next_style) : v_next_style), "I"))) && test(K190, self.text) && ((num((v_next_line === UNSET ? (g_next_line = groups, b_next_line = base, v_next_line = (obj(obj(lookupAt(24, "block", K181, K180, self.ancestor_ids?.[0], self.start, 1, undefined))?.["line"])?.["number"]), groups = g_next_line, base = b_next_line, v_next_line) : v_next_line)) - num(self.last_line?.["number"])) < 4))) return
  context.report("ordered-list-kind-split", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule87(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_kind: unknown = UNSET
  let g_kind: Record<string, [number, number]> | undefined
  let b_kind = 0
  let v_first_marker: unknown = UNSET
  let g_first_marker: Record<string, [number, number]> | undefined
  let b_first_marker = 0
  let v_first_content: unknown = UNSET
  let g_first_content: Record<string, [number, number]> | undefined
  let b_first_content = 0
  if (!((num(self.index) >= 1) && same((v_kind === UNSET ? (g_kind = groups, b_kind = base, v_kind = (obj(obj(obj(lookupAt(21, "block", K181, K100, self.ancestor_ids?.[0], self.start, 0, undefined))?.["node"])?.["marker"])?.["kind"]), groups = g_kind, base = b_kind, v_kind) : v_kind), "ordered") && (num((v_first_marker === UNSET ? (g_first_marker = groups, b_first_marker = base, v_first_marker = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_first_marker, base = b_first_marker, v_first_marker) : v_first_marker)) > num(self.layout?.["markerColumn"])) && same((v_first_content === UNSET ? (g_first_content = groups, b_first_content = base, v_first_content = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, 0, undefined))?.["layout"])?.["contentColumn"]), groups = g_first_content, base = b_first_content, v_first_content) : v_first_content), self.layout?.["contentColumn"]))) return
  context.report("ordered-marker-right-aligned", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule88(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((hit(K191, K192, self.text) && mark(num(self.start))) && test(K193, self.prev?.["text"]))) return
  context.report("quote-fence-ends-the-quote-above", num(group("fence", 0)), num(group("fence", 1)), path, {  }, 0)
  return
}

function rule89(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(obj(self.node)?.["form"], "line") && test(K194, obj(self.node)?.["value"]) && !test(K195, obj(self.node)?.["value"]))) return
  context.report("region-marker-renders-as-text", num(self.start), num(self.end), path, {  }, 1)
  return
}

function rule90(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(obj(self.node)?.["form"], "line") && test(K194, obj(self.node)?.["value"]) && !test(K195, obj(self.node)?.["value"]))) return
  context.report("region-marker-renders-as-text", num(self.start), num(self.end), path, {  }, 1)
  return
}

function rule91(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && (hit(K196, K197, self.text) && mark(num(self.start))))) return
  context.report("region-marker-renders-as-text", num(group("m", 0)), num(self.body_end), path, {  }, 0)
  return
}

function rule92(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "{{")) return
  const one = (): void => {
    if (test(K199, str(self.text).slice(0, (num(group("use", 0)) - num(self.start))))) {
      context.report("reserved-syntax", num(group("use", 0)), num(group("use", 1)), path, { "text": String(str(self.text).slice((num(group("use", 0)) - num(self.start)), (num(group("use", 1)) - num(self.start)))) }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K198, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule93(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(!same(self.owner?.["type"], "span") && same(self.kind, "key") && Boolean(self.semantic) && Boolean(self.last_key))) return
  context.report("semantic-attribute-outside-span", num(self.start), num(self.key_end), path, { "name": String(self.key), "type": String(self.owner?.["type"]), "value": String(self.value) }, 0)
  return
}

function rule94(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && Boolean(self.semantic) && !Boolean(self.semantic_value) && !same(self.value, "") && Boolean(self.last_key))) return
  context.report("semantic-attribute-value-ignored", num(self.start), num(self.end), path, { "name": String(self.key) }, 0)
  return
}

function rule95(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  if (!((hit(K200, K201, self.text) && mark(num(self.start))) && (self.prev !== undefined) && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"]) && (starts(textFrom(line, num(group("run", 0))), "-") || (same(self.leaf, "paragraph") && same(self.prev?.["leaf_id"], self.leaf_id))))) return
  context.report("setext-heading-underline", num(group("run", 0)), num(group("run", 1)), path, {  }, 0)
  return
}

function rule96(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K202, self.text)) return
  const one = (): void => {
    if ((!test(K108, str(self.text).slice((num(group("b", 0)) - num(self.start)), (num(group("b", 1)) - num(self.start)))) && same(str(self.text).slice((num(group("next", 0)) - num(self.start)), (num(group("next", 1)) - num(self.start))), "") && test(K204, str(self.text).slice((num(group("name", 0)) - num(self.start)), (num(group("name", 1)) - num(self.start)))))) {
      context.report("sigil-after-letter", num(group("s", 0)), num(group("s", 1)), path, {  }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K203, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule97(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && K205.has(self.key) && Boolean(self.kept) && Boolean(self.last_key) && !(same(self.owner?.["format"], "pipe") && same(self.key, "header-rows") && test(K206, self.value)))) return
  context.report("table-attribute-invalid", num(self.start), num(self.end), path, { "key": String(self.key) }, 0)
  return
}

function rule98(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && K207.has(self.key) && !Boolean(self.kept) && Boolean(self.last_key) && (num(self.entries) < num(self.owner?.["columns"])))) return
  context.report("table-column-arity", num(self.start), num(self.key_end), path, { "key": String(self.key), "count": String(self.entries), "widest": String(self.owner?.["columns"]) }, 0)
  return
}

function rule99(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && K208.has(self.key) && Boolean(self.last_key))) return
  const one = (): void => {
    context.report("table-column-overlap", num(self.start), num(self.key_end), path, { "n": String(str((same(self.key, "aligns") ? self.owner?.["align_overlap"] : (same(self.key, "valigns") ? self.owner?.["valign_overlap"] : ""))).slice(num(group("n", 0)), num(group("n", 1)))) }, 0)
    return
  }
  const text = (same(self.key, "aligns") ? self.owner?.["align_overlap"] : (same(self.key, "valigns") ? self.owner?.["valign_overlap"] : ""))
  if (text === '') return
  for (const found of matchAll(K209, text)) {
    groups = spansOf(found)
    base = 0
    one()
  }
}

function rule100(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(hit(K210, K211, self.text) && mark(num(self.start)))) return
  context.report("table-marker-run-padding", num(group("block", 0)), num(group("marker", 1)), path, { "spelling": String((str(self.text).slice((num(group("block", 0)) - num(self.start)), (num(group("block", 1)) - num(self.start))) + str(self.text).slice((num(group("marker", 0)) - num(self.start)), (num(group("marker", 1)) - num(self.start))))), "marker": String(str(self.text).slice((num(group("marker", 0)) - num(self.start)), (num(group("marker", 1)) - num(self.start)))), "block": String(str(self.text).slice((num(group("block", 0)) - num(self.start)), (num(group("block", 1)) - num(self.start)))), "correctedPrefix": String(("{" + str(self.text).slice((num(group("marker", 0)) - num(self.start)), (num(group("marker", 1)) - num(self.start))) + " " + str(self.text).slice(((num(group("block", 0)) - num(self.start)) + 1), ((num(group("block", 1)) - num(self.start)) - 1)) + "}")) }, 0)
  return
}

function rule101(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && !(obj(atEnd(obj(self.node)?.["children"], -1))?.["attrs"] !== undefined) && (hit(K212, K213, self.text) && mark(num(self.start))) && (obj(obj(obj(obj(obj(atEnd(obj(self.node)?.["children"], -1))?.["children"])?.[0])?.["children"])?.[0])?.["value"] !== undefined) && !(obj(obj(obj(obj(atEnd(obj(self.node)?.["children"], -1))?.["children"])?.[0])?.["children"])?.[1] !== undefined) && isAttributeLine(str(obj(obj(obj(obj(obj(atEnd(obj(self.node)?.["children"], -1))?.["children"])?.[0])?.["children"])?.[0])?.["value"]), 0, str(obj(obj(obj(obj(obj(atEnd(obj(self.node)?.["children"], -1))?.["children"])?.[0])?.["children"])?.[0])?.["value"]).length) && contains(str(self.text).slice((num(group("cell", 0)) - num(self.start)), (num(group("cell", 1)) - num(self.start))), obj(obj(obj(obj(obj(atEnd(obj(self.node)?.["children"], -1))?.["children"])?.[0])?.["children"])?.[0])?.["value"]))) return
  context.report("table-row-attribute-as-cell", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule102(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_head_start: unknown = UNSET
  let g_head_start: Record<string, [number, number]> | undefined
  let b_head_start = 0
  let v_head_cells: unknown = UNSET
  let g_head_cells: Record<string, [number, number]> | undefined
  let b_head_cells = 0
  if (!(K215.has(self.parent?.["type"]) && !same((v_head_start === UNSET ? (g_head_start = groups, b_head_start = base, v_head_start = (obj(lookupAt(25, "block", K214, K216, self.ancestor_ids?.[1], self.start, 0, undefined))?.["start"]), groups = g_head_start, base = b_head_start, v_head_start) : v_head_start), self.start) && !same(lenOf(obj(self.node)?.["children"]), lenOf((v_head_cells === UNSET ? (g_head_cells = groups, b_head_cells = base, v_head_cells = (obj(obj(lookupAt(25, "block", K214, K216, self.ancestor_ids?.[1], self.start, 0, undefined))?.["node"])?.["children"]), groups = g_head_cells, base = b_head_cells, v_head_cells) : v_head_cells))))) return
  if ((!(obj(self.node)?.["pos"] !== undefined) && (hit(K217, K218, self.last_line?.["body"]) && mark(num(self.last_line?.["body_start"]))))) {
    context.report("table-row-cell-count", num(group("plus", 0)), num(self.end), path, { "cells": String(lenOf(obj(self.node)?.["children"])), "width": String(lenOf((v_head_cells === UNSET ? (g_head_cells = groups, b_head_cells = base, v_head_cells = (obj(obj(lookupAt(25, "block", K214, K216, self.ancestor_ids?.[1], self.start, 0, undefined))?.["node"])?.["children"]), groups = g_head_cells, base = b_head_cells, v_head_cells) : v_head_cells))) }, 0)
    return
  }
  context.report("table-row-cell-count", num(self.start), num(self.end), path, { "cells": String(lenOf(obj(self.node)?.["children"])), "width": String(lenOf((v_head_cells === UNSET ? (g_head_cells = groups, b_head_cells = base, v_head_cells = (obj(obj(lookupAt(25, "block", K214, K216, self.ancestor_ids?.[1], self.start, 0, undefined))?.["node"])?.["children"]), groups = g_head_cells, base = b_head_cells, v_head_cells) : v_head_cells))) }, 0)
  return
}

function rule103(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  let v_below: unknown = UNSET
  let g_below: Record<string, [number, number]> | undefined
  let b_below = 0
  let v_all_rows: unknown = UNSET
  let g_all_rows: Record<string, [number, number]> | undefined
  let b_all_rows = 0
  let v_count: unknown = UNSET
  let g_count: Record<string, [number, number]> | undefined
  let b_count = 0
  if (!(same(self.kind, "key") && Boolean(self.last_key) && test(K206, self.value) && ((same(self.key, "footer-rows") && (num((v_count === UNSET ? (g_count = groups, b_count = base, v_count = ((same(lenOf(self.value), 0) ? "1" : self.value)), groups = g_count, base = b_count, v_count) : v_count)) > num((v_below === UNSET ? (g_below = groups, b_below = base, v_below = ((num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"]))), groups = g_below, base = b_below, v_below) : v_below)))) || (same(self.key, "header-rows") && (num((v_count === UNSET ? (g_count = groups, b_count = base, v_count = ((same(lenOf(self.value), 0) ? "1" : self.value)), groups = g_count, base = b_count, v_count) : v_count)) > num((v_all_rows === UNSET ? (g_all_rows = groups, b_all_rows = base, v_all_rows = ((num(self.owner?.["head_rows"]) + num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"]))), groups = g_all_rows, base = b_all_rows, v_all_rows) : v_all_rows))))))) return
  if (same(self.key, "footer-rows")) {
    context.report("table-row-count-clamped", num(self.start), num(self.end), path, { "key": String(self.key), "count": String((v_count === UNSET ? (g_count = groups, b_count = base, v_count = ((same(lenOf(self.value), 0) ? "1" : self.value)), groups = g_count, base = b_count, v_count) : v_count)), "effective": String((v_below === UNSET ? (g_below = groups, b_below = base, v_below = ((num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"]))), groups = g_below, base = b_below, v_below) : v_below)) }, 0)
    return
  }
  context.report("table-row-count-clamped", num(self.start), num(self.end), path, { "key": String(self.key), "count": String((v_count === UNSET ? (g_count = groups, b_count = base, v_count = ((same(lenOf(self.value), 0) ? "1" : self.value)), groups = g_count, base = b_count, v_count) : v_count)), "effective": String((v_all_rows === UNSET ? (g_all_rows = groups, b_all_rows = base, v_all_rows = ((num(self.owner?.["head_rows"]) + num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"]))), groups = g_all_rows, base = b_all_rows, v_all_rows) : v_all_rows)) }, 0)
  return
}

function rule104(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && starts(self.body, "|") && !same(self.body, "|") && !test(K219, self.body))) return
  context.report("table-shaped-paragraph", num(self.body_start), num(self.body_end), path, { "owner": String((same(self.leaf, "definition_term") ? "term" : (same(self.leaf, "line") ? "line-block line" : self.leaf))) }, 0)
  return
}

function rule105(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && (obj(self.node)?.["span"] !== undefined))) return
  if ((starts(self.text, "{") || starts(self.text, "={"))) {
    context.report("table-span-marker-attribute", num(self.start), num(self.end), path, { "marker": String((same(obj(self.node)?.["span"], "rowspan") ? "^" : "<")), "direction": String((same(obj(self.node)?.["span"], "rowspan") ? "above it" : "to its left")) }, 0)
    return
  }
  if ((starts(self.text, "=") && !same(self.group, "table_head"))) {
    context.report("table-span-marker-attribute", num(self.start), num(self.end), path, { "marker": String((same(obj(self.node)?.["span"], "rowspan") ? "^" : "<")), "direction": String((same(obj(self.node)?.["span"], "rowspan") ? "above it" : "to its left")) }, 1)
    return
  }
}

function rule106(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && !(obj(self.node)?.["span"] !== undefined) && same(obj(obj(obj(self.node)?.["children"])?.[0])?.["type"], "cell_paragraph") && same(countFrom(obj(obj(obj(self.node)?.["children"])?.[0])?.["children"], 0, () => true), 1) && same(obj(obj(obj(obj(obj(self.node)?.["children"])?.[0])?.["children"])?.[0])?.["type"], "text") && K220.has(obj(obj(obj(obj(obj(self.node)?.["children"])?.[0])?.["children"])?.[0])?.["value"]) && !test(K221, self.text))) return
  if ((same(obj(obj(obj(obj(obj(self.node)?.["children"])?.[0])?.["children"])?.[0])?.["value"], "<") && same(self.index, 0))) {
    context.report("table-span-marker-blocked", num(self.start), num(self.end), path, {  }, 0)
    return
  }
  if (same(obj(obj(obj(obj(obj(self.node)?.["children"])?.[0])?.["children"])?.[0])?.["value"], "<")) {
    context.report("table-span-marker-blocked", num(self.start), num(self.end), path, {  }, 1)
    return
  }
  if (same(self.row_index, 0)) {
    context.report("table-span-marker-blocked", num(self.start), num(self.end), path, {  }, 2)
    return
  }
  context.report("table-span-marker-blocked", num(self.start), num(self.end), path, {  }, 3)
  return
}

function rule107(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && same(self.key, "widths") && Boolean(self.last_key) && !Boolean(self.kept) && (num(self.entry_total) > 100))) return
  context.report("table-width-total", num(self.start), num(self.key_end), path, {  }, 0)
  return
}

function rule108(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K222, self.body) && !(starts(self.body, "-") && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"])) && !(same(self.number, 1) && same(self.body_start, self.start) && same(self.body, "---")))) return
  context.report("thematic-break-spelling", num(self.body_start), num(self.body_end), path, { "raw": String(self.body) }, 0)
  return
}

function rule109(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(obj(self.node)?.["spacing"], "tight") && (num(obj(lookupAt(27, "block", undefined, K225, self.identity, self.start, 0, (item: unknown): boolean => (someFrom(obj(obj(lookupAt(13, "block", K109, K100, obj(obj(item)?.["ancestor_ids"])?.[0], self.start, 0, undefined))?.["node"])?.["children"], 0, (item) => same(obj(item)?.["type"], "paragraph")))))?.["start"]) >= 0))) return
  context.report("tight-list-item-with-blank-line", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule110(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && Boolean(self.leaf_first) && same(self.shape, "attribute_line") && !Boolean(self.attached_here) && (!(self.leaf_next !== undefined) || Boolean(self.leaf_next?.["blank"]) || Boolean(self.leaf_next?.["closes_container"]) || !same(self.leaf_next?.["leaf_id"], self.leaf_id)))) return
  if ((Boolean(self.leaf_next?.["blank"]) && (num(self.leaf_next?.["quote_marks"]) >= num(self.quote_depth)))) {
    context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule111(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K8.has(self.leaf) && starts(self.body, "^ ") && !contains(self.ancestors, "caption") && !((self.prev !== undefined) && !K8.has(self.prev?.["leaf"]) && test(K226, self.prev?.["raw_body"]) && test(K117, str(self.prev?.["text"]).slice(0, (num(self.prev?.["body_start"]) - num(self.prev?.["start"])))) && !test(K227, self.text)))) return
  context.report("unattached-caption", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule112(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_last_cell: unknown = UNSET
  let g_last_cell: Record<string, [number, number]> | undefined
  let b_last_cell = 0
  if (!(K229.has(self.leaf) && contains(self.text, "{"))) return
  const one = (): void => {
    if ((isAttributeLine(str(self.text).slice((num(group("run", 0)) - num(self.start)), (num(group("run", 1)) - num(self.start))), 0, str(self.text).slice((num(group("run", 0)) - num(self.start)), (num(group("run", 1)) - num(self.start))).length) && !(same(group("run", 0), obj(lookupAt(28, "line", undefined, K228, true, (num(group("run", 0)) + 1), -1, undefined))?.["body_start"]) && (same(group("run", 1), obj(lookupAt(28, "line", undefined, K228, true, (num(group("run", 0)) + 1), -1, undefined))?.["body_end"]) || (K231.has(self.leaf) && K232.has(str(self.text).slice((num(group("run", 0)) - num(self.start)), (num(group("run", 1)) - num(self.start))).slice(1, 2))))) && !(same(self.leaf, "cell_paragraph") && same(group("run", 0), self.start) && same(group("run", 1), self.end) && Boolean((v_last_cell === UNSET ? (g_last_cell = groups, b_last_cell = base, v_last_cell = (((indexOf(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))), "|") >= 0) && same(trimEnd(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))).slice(0, indexOf(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))), "|"))), "") && same(trimEnd(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))).slice((indexOf(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))), "|") + 1))), ""))), groups = g_last_cell, base = b_last_cell, v_last_cell) : v_last_cell))))) {
      context.report("unattached-inline-attribute", num(group("run", 0)), num(group("run", 1)), path, {  }, 0)
      return
    }
    if ((!isAttributeLine(str(self.text).slice((num(group("run", 0)) - num(self.start)), (num(group("run", 1)) - num(self.start))), 0, str(self.text).slice((num(group("run", 0)) - num(self.start)), (num(group("run", 1)) - num(self.start))).length) && (isAttributeLine(str(self.text).slice((num(group("blk", 0)) - num(self.start)), (num(group("blk", 1)) - num(self.start))), 0, str(self.text).slice((num(group("blk", 0)) - num(self.start)), (num(group("blk", 1)) - num(self.start))).length) && !(same(group("run", 0), obj(lookupAt(28, "line", undefined, K228, true, (num(group("run", 0)) + 1), -1, undefined))?.["body_start"]) && (same(group("blk", 1), obj(lookupAt(28, "line", undefined, K228, true, (num(group("run", 0)) + 1), -1, undefined))?.["body_end"]) || (K231.has(self.leaf) && K232.has(str(self.text).slice((num(group("run", 0)) - num(self.start)), (num(group("run", 1)) - num(self.start))).slice(1, 2))))) && !(same(self.leaf, "cell_paragraph") && same(group("run", 0), self.start) && same(group("blk", 1), self.end) && Boolean((v_last_cell === UNSET ? (g_last_cell = groups, b_last_cell = base, v_last_cell = (((indexOf(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))), "|") >= 0) && same(trimEnd(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))).slice(0, indexOf(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))), "|"))), "") && same(trimEnd(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))).slice((indexOf(str(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]).slice((num(self.end) - num(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]))), "|") + 1))), ""))), groups = g_last_cell, base = b_last_cell, v_last_cell) : v_last_cell)))))) {
      context.report("unattached-inline-attribute", num(group("blk", 0)), num(group("blk", 1)), path, {  }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K230, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule113(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!((hit(K233, K234, self.text) && mark(num(self.start))) && !contains(str(self.text).slice((num(group("o", 1)) - num(self.start))), "%}") && same(obj(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["leaf_next"])?.["blank"], false) && !same(obj(obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["leaf_next"])?.["shape"], "region_marker") && (num(obj(lookupAt(29, "line", undefined, K235, true, num(self.end), 1, undefined))?.["start"]) >= 0))) return
  context.report("unclosed-braced-comment", num(group("o", 0)), num(self.end), path, {  }, 0)
  return
}

function rule114(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_last_text: unknown = UNSET
  let g_last_text: Record<string, [number, number]> | undefined
  let b_last_text = 0
  let v_last_start: unknown = UNSET
  let g_last_start: Record<string, [number, number]> | undefined
  let b_last_start = 0
  let v_leaf_start: unknown = UNSET
  let g_leaf_start: Record<string, [number, number]> | undefined
  let b_leaf_start = 0
  let v_first_body: unknown = UNSET
  let g_first_body: Record<string, [number, number]> | undefined
  let b_first_body = 0
  if (!(same(self.leaf, "paragraph") && test(K236, self.text))) return
  const one = (): void => {
    if (((!same(str(self.text).slice((num(group("b", 0)) - num(self.start)), (num(group("b", 1)) - num(self.start))), "") || same((v_first_body === UNSET ? (g_first_body = groups, b_first_body = base, v_first_body = (obj(lookupAt(28, "line", undefined, K228, true, (num(self.start) + 1), -1, undefined))?.["body_start"]), groups = g_first_body, base = b_first_body, v_first_body) : v_first_body), self.start)) && !contains(str(self.text).slice((num(group("d", 1)) - num(self.start))), str(self.text).slice((num(group("d", 0)) - num(self.start)), (num(group("d", 1)) - num(self.start)))) && !contains(str((v_last_text === UNSET ? (g_last_text = groups, b_last_text = base, v_last_text = (obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["text"]), groups = g_last_text, base = b_last_text, v_last_text) : v_last_text)).slice((num(self.end) - num((v_last_start === UNSET ? (g_last_start = groups, b_last_start = base, v_last_start = (obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["start"]), groups = g_last_start, base = b_last_start, v_last_start) : v_last_start)))), str(self.text).slice((num(group("d", 0)) - num(self.start)), (num(group("d", 1)) - num(self.start)))) && !(num(obj(lookupAt(30, "line", undefined, K238, (v_leaf_start === UNSET ? (g_leaf_start = groups, b_leaf_start = base, v_leaf_start = (obj(lookupAt(28, "line", undefined, K228, true, num(self.end), -1, undefined))?.["leaf_start"]), groups = g_leaf_start, base = b_leaf_start, v_leaf_start) : v_leaf_start), num(self.end), 1, (item: unknown): boolean => (contains(obj(item)?.["text"], str(self.text).slice((num(group("d", 0)) - num(self.start)), (num(group("d", 1)) - num(self.start)))))))?.["start"]) >= 0))) {
      context.report("unclosed-inline-emphasis", num(group("d", 0)), num(group("d", 1)), path, { "span": String((same(str(self.text).slice((num(group("d", 0)) - num(self.start)), (num(group("d", 1)) - num(self.start))), "*") ? "strong" : "emphasis")) }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K237, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule115(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_previous: unknown = UNSET
  let g_previous: Record<string, [number, number]> | undefined
  let b_previous = 0
  let v_outer: unknown = UNSET
  let g_outer: Record<string, [number, number]> | undefined
  let b_outer = 0
  let v_footnote: unknown = UNSET
  let g_footnote: Record<string, [number, number]> | undefined
  let b_footnote = 0
  let v_kind: unknown = UNSET
  let g_kind: Record<string, [number, number]> | undefined
  let b_kind = 0
  let v_first_marker: unknown = UNSET
  let g_first_marker: Record<string, [number, number]> | undefined
  let b_first_marker = 0
  let v_first_content: unknown = UNSET
  let g_first_content: Record<string, [number, number]> | undefined
  let b_first_content = 0
  if (!((num(self.index) >= 1) && (num(self.layout?.["markerColumn"]) < num((v_previous === UNSET ? (g_previous = groups, b_previous = base, v_previous = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, -1, undefined))?.["layout"])?.["markerColumn"]), groups = g_previous, base = b_previous, v_previous) : v_previous))) && (num((v_previous === UNSET ? (g_previous = groups, b_previous = base, v_previous = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, -1, undefined))?.["layout"])?.["markerColumn"]), groups = g_previous, base = b_previous, v_previous) : v_previous)) > num((v_footnote === UNSET ? (g_footnote = groups, b_footnote = base, v_footnote = ((contains(self.ancestors, "footnote") ? obj(obj(lookupAt(31, "block", K137, undefined, undefined, self.start, -1, undefined))?.["layout"])?.["contentColumn"] : 0)), groups = g_footnote, base = b_footnote, v_footnote) : v_footnote))) && (!(num((v_outer === UNSET ? (g_outer = groups, b_outer = base, v_outer = (obj(obj(lookupAt(13, "block", K109, K100, self.ancestor_ids?.[1], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_outer, base = b_outer, v_outer) : v_outer)) >= 0) || (num(self.layout?.["markerColumn"]) <= num((v_outer === UNSET ? (g_outer = groups, b_outer = base, v_outer = (obj(obj(lookupAt(13, "block", K109, K100, self.ancestor_ids?.[1], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_outer, base = b_outer, v_outer) : v_outer)))) && !((num(self.index) >= 1) && same((v_kind === UNSET ? (g_kind = groups, b_kind = base, v_kind = (obj(obj(obj(lookupAt(21, "block", K181, K100, self.ancestor_ids?.[0], self.start, 0, undefined))?.["node"])?.["marker"])?.["kind"]), groups = g_kind, base = b_kind, v_kind) : v_kind), "ordered") && (num((v_first_marker === UNSET ? (g_first_marker = groups, b_first_marker = base, v_first_marker = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, 0, undefined))?.["layout"])?.["markerColumn"]), groups = g_first_marker, base = b_first_marker, v_first_marker) : v_first_marker)) > num(self.layout?.["markerColumn"])) && same((v_first_content === UNSET ? (g_first_content = groups, b_first_content = base, v_first_content = (obj(obj(lookupAt(20, "block", K109, K180, self.ancestor_ids?.[0], self.start, 0, undefined))?.["layout"])?.["contentColumn"]), groups = g_first_content, base = b_first_content, v_first_content) : v_first_content), self.layout?.["contentColumn"])))) return
  context.report("uneven-list-indent", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule116(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!!(obj(self.node)?.["number"] !== undefined)) return
  context.report("unresolved-footnote", num(self.start), num(self.end), path, { "id": String(obj(self.node)?.["key"]) }, 0)
  return
}

function rule117(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_labels: unknown = UNSET
  let g_labels: Record<string, [number, number]> | undefined
  let b_labels = 0
  let v_ids: unknown = UNSET
  let g_ids: Record<string, [number, number]> | undefined
  let b_ids = 0
  let v_label: unknown = UNSET
  let g_label: Record<string, [number, number]> | undefined
  let b_label = 0
  let v_id: unknown = UNSET
  let g_id: Record<string, [number, number]> | undefined
  let b_id = 0
  let v_case_only: unknown = UNSET
  let g_case_only: Record<string, [number, number]> | undefined
  let b_case_only = 0
  let v_case_candidates: unknown = UNSET
  let g_case_candidates: Record<string, [number, number]> | undefined
  let b_case_candidates = 0
  if (!((obj(self.node)?.["key"] !== undefined) && ((same(self.type, "link") && !(obj(self.node)?.["href"] !== undefined)) || (same(self.type, "image") && !(obj(self.node)?.["src"] !== undefined))))) return
  if ((same(self.type, "link") && (lenOf((v_case_only === UNSET ? (g_case_only = groups, b_case_only = base, v_case_only = (((lenOf((v_label === UNSET ? (g_label = groups, b_label = base, v_label = (findIn((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels), (item) => !same(item, obj(self.node)?.["key"]))), groups = g_label, base = b_label, v_label) : v_label)) >= 1) ? (v_label === UNSET ? (g_label = groups, b_label = base, v_label = (findIn((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels), (item) => !same(item, obj(self.node)?.["key"]))), groups = g_label, base = b_label, v_label) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (g_id = groups, b_id = base, v_id = (findIn((v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids), (item) => !same(item, self.key_text))), groups = g_id, base = b_id, v_id) : v_id)) >= 1)) ? (v_id === UNSET ? (g_id = groups, b_id = base, v_id = (findIn((v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids), (item) => !same(item, self.key_text))), groups = g_id, base = b_id, v_id) : v_id) : ""))), groups = g_case_only, base = b_case_only, v_case_only) : v_case_only)) >= 1))) {
    context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String((str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? "the label " : "the labels ")) + listOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates), '') + str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? " differs only in case" : " differ only in case")))) }, 0)
    return
  }
  if (same(self.type, "link")) {
    context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String((str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? "the label " : "the labels ")) + listOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates), '') + str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? " differs only in case" : " differ only in case")))) }, 1)
    return
  }
  if ((lenOf((v_case_only === UNSET ? (g_case_only = groups, b_case_only = base, v_case_only = (((lenOf((v_label === UNSET ? (g_label = groups, b_label = base, v_label = (findIn((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels), (item) => !same(item, obj(self.node)?.["key"]))), groups = g_label, base = b_label, v_label) : v_label)) >= 1) ? (v_label === UNSET ? (g_label = groups, b_label = base, v_label = (findIn((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels), (item) => !same(item, obj(self.node)?.["key"]))), groups = g_label, base = b_label, v_label) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (g_id = groups, b_id = base, v_id = (findIn((v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids), (item) => !same(item, self.key_text))), groups = g_id, base = b_id, v_id) : v_id)) >= 1)) ? (v_id === UNSET ? (g_id = groups, b_id = base, v_id = (findIn((v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids), (item) => !same(item, self.key_text))), groups = g_id, base = b_id, v_id) : v_id) : ""))), groups = g_case_only, base = b_case_only, v_case_only) : v_case_only)) >= 1)) {
    context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String((str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? "the label " : "the labels ")) + listOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates), '') + str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? " differs only in case" : " differ only in case")))) }, 2)
    return
  }
  context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String((str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? "the label " : "the labels ")) + listOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates), '') + str((same(lenOf((v_case_candidates === UNSET ? (g_case_candidates = groups, b_case_candidates = base, v_case_candidates = (((lenOf((v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels)) >= 1) ? (v_labels === UNSET ? (g_labels = groups, b_labels = base, v_labels = (lookupAll(32, "block", K114, K239, foldKey(str(obj(self.node)?.["key"])), undefined).map((record) => obj(obj(record)?.["node"])?.["key"])), groups = g_labels, base = b_labels, v_labels) : v_labels) : (v_ids === UNSET ? (g_ids = groups, b_ids = base, v_ids = (lookupAll(33, "id", K32, K240, foldKey(foldLabel(str(self.key_text))), undefined).map((record) => obj(record)?.["heading_text"])), groups = g_ids, base = b_ids, v_ids) : v_ids))), groups = g_case_candidates, base = b_case_candidates, v_case_candidates) : v_case_candidates)), 1) ? " differs only in case" : " differ only in case")))) }, 3)
  return
}

function rule118(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_at: unknown = UNSET
  let g_at: Record<string, [number, number]> | undefined
  let b_at = 0
  if (!(!(num(obj(lookupAt(34, "inline", K241, K242, obj(self.node)?.["key"], self.start, 0, undefined))?.["start"]) >= 0) && (num((v_at === UNSET ? (g_at = groups, b_at = base, v_at = (indexOf(self.text, ("[^" + str(obj(self.node)?.["key"]) + "]"))), groups = g_at, base = b_at, v_at) : v_at)) >= 0))) return
  context.report("unused-footnote-definition", (num(self.start) + num((v_at === UNSET ? (g_at = groups, b_at = base, v_at = (indexOf(self.text, ("[^" + str(obj(self.node)?.["key"]) + "]"))), groups = g_at, base = b_at, v_at) : v_at))), (num(self.start) + num((v_at === UNSET ? (g_at = groups, b_at = base, v_at = (indexOf(self.text, ("[^" + str(obj(self.node)?.["key"]) + "]"))), groups = g_at, base = b_at, v_at) : v_at)) + lenOf(("[^" + str(obj(self.node)?.["key"]) + "]"))), path, { "label": String(obj(self.node)?.["key"]) }, 0)
  return
}

function rule119(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!!(num(obj(lookupAt(35, "inline", K243, K242, obj(self.node)?.["key"], self.start, 0, undefined))?.["start"]) >= 0)) return
  context.report("unused-link-reference-definition", num(self.start), num(self.end), path, {  }, 0)
  return
}

/**
 * `only`: the leaf of a line, the parent type of a block, the parent of an inline record or the kind of an attribute record
 * that the rule can match.
 * `needs`: the block and inline types whose records the lookups of the rule read.
 */
interface Needs { readonly block: readonly string[], readonly inline: readonly string[] }
export type DataRule =
  | { id: RuleId, over: 'line', types: undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, needs: Needs, run: (self: ModelLine, path: string, context: LintContext) => void }
  | { id: RuleId, over: 'block', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, needs: Needs, run: (self: ModelBlock, path: string, context: LintContext) => void }
  | { id: RuleId, over: 'inline', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, needs: Needs, run: (self: ModelInline, path: string, context: LintContext) => void }
  | { id: RuleId, over: 'attribute', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, needs: Needs, run: (self: ModelAttribute, path: string, context: LintContext) => void }

export const VERBATIM_LEAVES: ReadonlySet<string> = new Set(["code_block","comment_block","frontmatter","raw_block"])

export const DATA_RULES: readonly DataRule[] = [
  { id: "a11y/image-alt", over: "inline", types: ["image"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule0 },
  { id: "bare-html-tag", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["heading","paragraph","table_cell","table_row"]), needs: {"block":[],"inline":[]}, run: rule1 },
  { id: "blank-reference-label", over: "inline", types: ["text"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule2 },
  { id: "block-marker-as-text", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":["*"]}, run: rule3 },
  { id: "block-opener-overindented", over: "block", types: ["admonition","block_quote","code_block","definition_term","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule4 },
  { id: "block-opener-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","paragraph"]), needs: {"block":["caption","paragraph"],"inline":[]}, run: rule5 },
  { id: "blockquote-marker-without-space", over: "line", types: undefined, verbatim: new Set(["frontmatter"]), only: undefined, needs: {"block":[],"inline":[]}, run: rule6 },
  { id: "braced-comment-in-a-template-source", over: "inline", types: ["comment"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule7 },
  { id: "broken-crossref", over: "inline", types: ["xref"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule8 },
  { id: "broken-fragment-link", over: "inline", types: ["link"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule9 },
  { id: "caption-looking-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":[],"inline":[]}, run: rule10 },
  { id: "carve-version-unsupported", over: "block", types: ["frontmatter"], verbatim: new Set([]), only: new Set(["document"]), needs: {"block":[],"inline":[]}, run: rule11 },
  { id: "carve-version-unsupported", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":["frontmatter"],"inline":[]}, run: rule12 },
  { id: "code-span-padding-kept", over: "inline", types: ["code","literal_inline","math","raw_inline"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule13 },
  { id: "colon-fence-length-mismatch", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule14 },
  { id: "comment-fence-closer-with-text", over: "line", types: undefined, verbatim: new Set(["comment_block"]), only: new Set(["comment_block"]), needs: {"block":[],"inline":[]}, run: rule15 },
  { id: "comment-line-in-line-block", over: "block", types: ["line"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule16 },
  { id: "comment-shaped-emphasis", over: "inline", types: ["emphasis","strong"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule17 },
  { id: "comment-splits-table-row", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule18 },
  { id: "consumed-key-near-miss", over: "attribute", types: ["code_block"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule19 },
  { id: "continuation-reading-changed", over: "block", types: ["abbreviation_def","link_reference_definition"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule20 },
  { id: "continuation-reading-changed", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule21 },
  { id: "definition-in-container", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule22 },
  { id: "definition-term-block-folded", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term"]), needs: {"block":[],"inline":[]}, run: rule23 },
  { id: "delimited-table-wide-row", over: "block", types: ["table"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule24 },
  { id: "deprecated-bare-highlight", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule25 },
  { id: "deprecated-bare-strike", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule26 },
  { id: "deprecated-bare-underline", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule27 },
  { id: "deprecated-cell-alignment", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule28 },
  { id: "deprecated-continuation-marker", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule29 },
  { id: "deprecated-indented-line-under-heading", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule30 },
  { id: "deprecated-loose-attribute", over: "block", types: ["list"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule31 },
  { id: "deprecated-separator-row", over: "block", types: ["table_row"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule32 },
  { id: "deprecated-spaced-thematic-break", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule33 },
  { id: "deprecated-table-attribute", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule34 },
  { id: "description-separator-below-content-column", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":["definition_description","definition_list"],"inline":[]}, run: rule35 },
  { id: "description-term-multi-line", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term"]), needs: {"block":[],"inline":[]}, run: rule36 },
  { id: "djot-definition-list", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":[],"inline":[]}, run: rule37 },
  { id: "djot-emphasis-underscore", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule38 },
  { id: "djot-emphasis-underscore-braced", over: "inline", types: ["underline"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule39 },
  { id: "djot-heading-continuation", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule40 },
  { id: "djot-highlight-braces", over: "inline", types: ["highlight"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule41 },
  { id: "djot-intraword-underscore", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule42 },
  { id: "djot-ordered-marker", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":["list_item"],"inline":[]}, run: rule43 },
  { id: "djot-plus-bullet", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":[],"inline":[]}, run: rule44 },
  { id: "djot-subscript-tilde", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule45 },
  { id: "djot-subscript-tilde-braced", over: "inline", types: ["strike"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule46 },
  { id: "djot-superscript-caret", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule47 },
  { id: "djot-tag-mention", over: "inline", types: ["mention","tag"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule48 },
  { id: "djot-typography-sign", over: "inline", types: ["smart_punctuation"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule49 },
  { id: "duplicate-reference-url", over: "block", types: ["link_reference_definition"], verbatim: new Set([]), only: undefined, needs: {"block":["link_reference_definition"],"inline":[]}, run: rule50 },
  { id: "emphasis-as-heading", over: "block", types: ["paragraph"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule51 },
  { id: "emphasis-marker-before-attributes", over: "inline", types: ["emphasis","strong","text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule52 },
  { id: "empty-include-path", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule53 },
  { id: "empty-link-destination", over: "inline", types: ["link"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule54 },
  { id: "empty-reference-definition", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule55 },
  { id: "fence-closer-indented", over: "block", types: ["code_block"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule56 },
  { id: "figure-group-empty", over: "block", types: ["figure_group"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule57 },
  { id: "figure-group-nested", over: "block", types: ["div"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule58 },
  { id: "figure-group-opener-metadata", over: "block", types: ["div"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule59 },
  { id: "figure-group-panel-number", over: "block", types: undefined, verbatim: new Set([]), only: new Set(["figure_group"]), needs: {"block":[],"inline":[]}, run: rule60 },
  { id: "figure-group-single-panel", over: "block", types: ["figure_group"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule61 },
  { id: "footnote-labels-differ-only-in-whitespace", over: "block", types: ["footnote"], verbatim: new Set([]), only: undefined, needs: {"block":["footnote"],"inline":[]}, run: rule62 },
  { id: "footnotes-placement-in-container", over: "block", types: ["directive"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule63 },
  { id: "frontmatter-crossref", over: "inline", types: ["xref"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule64 },
  { id: "frontmatter-shaped-thematic-break", over: "block", types: ["frontmatter"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule65 },
  { id: "github-alert-marker", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["heading","paragraph","table_cell","table_row"]), needs: {"block":[],"inline":[]}, run: rule66 },
  { id: "glob-shaped-strong", over: "inline", types: ["strong"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule67 },
  { id: "heading-closing-hashes", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule68 },
  { id: "heading-level-skip", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":["heading"],"inline":[]}, run: rule69 },
  { id: "heading-marker-mixed", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":["heading"],"inline":[]}, run: rule70 },
  { id: "heading-trailing-attribute", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule71 },
  { id: "html-comment-renders-as-text", over: "block", types: ["caption","paragraph"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule72 },
  { id: "html-comment-renders-as-text", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule73 },
  { id: "include-attributes-unused", over: "block", types: ["include"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule74 },
  { id: "include-lines-table-rows-hint", over: "block", types: ["include"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule75 },
  { id: "indented-code-block", over: "block", types: ["paragraph"], verbatim: new Set([]), only: new Set(["document"]), needs: {"block":[],"inline":[]}, run: rule76 },
  { id: "link-definition-indented-line", over: "block", types: ["link_reference_definition"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule77 },
  { id: "link-gap-before-destination", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule78 },
  { id: "list-item-block-overindented", over: "block", types: undefined, verbatim: new Set([]), only: new Set(["admonition","directive","div","figure_group","list_item"]), needs: {"block":[],"inline":[]}, run: rule79 },
  { id: "list-item-body-below-content-column", over: "block", types: undefined, verbatim: new Set([]), only: new Set(["list_item"]), needs: {"block":[],"inline":[]}, run: rule80 },
  { id: "list-marker-below-content-column", over: "block", types: ["list_item"], verbatim: new Set([]), only: undefined, needs: {"block":["*","list","list_item"],"inline":[]}, run: rule81 },
  { id: "list-marker-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term","paragraph"]), needs: {"block":[],"inline":[]}, run: rule82 },
  { id: "markdown-definition-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":["definition_description","definition_list"],"inline":[]}, run: rule83 },
  { id: "markdown-strikethrough-double-tilde", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule84 },
  { id: "markdown-strong-double-star", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule85 },
  { id: "ordered-list-kind-split", over: "block", types: ["list"], verbatim: new Set([]), only: new Set(["admonition","block_quote","div","document","footnote","list_item"]), needs: {"block":["list"],"inline":[]}, run: rule86 },
  { id: "ordered-marker-right-aligned", over: "block", types: ["list_item"], verbatim: new Set([]), only: undefined, needs: {"block":["list","list_item"],"inline":[]}, run: rule87 },
  { id: "quote-fence-ends-the-quote-above", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule88 },
  { id: "region-marker-renders-as-text", over: "block", types: ["comment"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule89 },
  { id: "region-marker-renders-as-text", over: "inline", types: ["comment"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule90 },
  { id: "region-marker-renders-as-text", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule91 },
  { id: "reserved-syntax", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule92 },
  { id: "semantic-attribute-outside-span", over: "attribute", types: undefined, verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule93 },
  { id: "semantic-attribute-value-ignored", over: "attribute", types: ["span"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule94 },
  { id: "setext-heading-underline", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule95 },
  { id: "sigil-after-letter", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule96 },
  { id: "table-attribute-invalid", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule97 },
  { id: "table-column-arity", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule98 },
  { id: "table-column-overlap", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule99 },
  { id: "table-marker-run-padding", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule100 },
  { id: "table-row-attribute-as-cell", over: "block", types: ["table_row"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule101 },
  { id: "table-row-cell-count", over: "block", types: ["table_row"], verbatim: new Set([]), only: new Set(["table_body","table_foot","table_head"]), needs: {"block":["table_row"],"inline":[]}, run: rule102 },
  { id: "table-row-count-clamped", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule103 },
  { id: "table-shaped-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule104 },
  { id: "table-span-marker-attribute", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule105 },
  { id: "table-span-marker-blocked", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule106 },
  { id: "table-width-total", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule107 },
  { id: "thematic-break-spelling", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule108 },
  { id: "tight-list-item-with-blank-line", over: "block", types: ["list"], verbatim: new Set([]), only: undefined, needs: {"block":["*","list_item"],"inline":[]}, run: rule109 },
  { id: "unattached-block-attribute", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":[],"inline":[]}, run: rule110 },
  { id: "unattached-caption", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule111 },
  { id: "unattached-inline-attribute", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule112 },
  { id: "unclosed-braced-comment", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule113 },
  { id: "unclosed-inline-emphasis", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule114 },
  { id: "uneven-list-indent", over: "block", types: ["list_item"], verbatim: new Set([]), only: undefined, needs: {"block":["footnote","list","list_item"],"inline":[]}, run: rule115 },
  { id: "unresolved-footnote", over: "inline", types: ["footnote_ref"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule116 },
  { id: "unresolved-reference-link", over: "inline", types: ["image","link"], verbatim: new Set([]), only: undefined, needs: {"block":["link_reference_definition"],"inline":[]}, run: rule117 },
  { id: "unused-footnote-definition", over: "block", types: ["footnote"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":["footnote_ref"]}, run: rule118 },
  { id: "unused-link-reference-definition", over: "block", types: ["link_reference_definition"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":["image","link"]}, run: rule119 },
]
