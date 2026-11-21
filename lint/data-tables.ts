// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.
import { type RuleId } from './catalog.ts'
import { type ModelAttribute } from './data-attributes.ts'
import { isAttributeLine } from '../src/lines.ts'
import { columnOf } from '../src/layout-lines.ts'
import { type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { linearPattern, type Pattern } from './linear-patterns.ts'
import { type LintContext } from './types.ts'

let groups: Record<string, [number, number]> | undefined
let base = 0
const UNSET: unique symbol = Symbol('unset')

// A let read late must not replace the match that the condition reading it has just made.
function aside(compute: () => unknown): unknown {
  const keptGroups = groups
  const keptBase = base
  const value = compute()
  groups = keptGroups
  base = keptBase
  return value
}

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

let lastRegex: RegExp | Pattern | undefined
let lastValue = ''
let lastSpans: Record<string, [number, number]> | undefined

// The lines of one leaf often test the same text against the same pattern, as a block's opener line.
function hit(regex: RegExp | Pattern, spans: RegExp | Pattern, value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (regex === lastRegex && value === lastValue) {
    if (lastSpans === undefined) return false
    groups = lastSpans
    return true
  }
  lastRegex = regex
  lastValue = value
  lastSpans = undefined
  if (!regex.test(value)) return false
  const found = spans.exec(value)
  if (found === null) return false
  lastSpans = spansOf(found)
  groups = lastSpans
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

// C2-W-147: the pair scan; each pair gives the groups open, inner, close, before and after.
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
    yield { open: [start, start + width], inner: [start + width, end], close: [end, after],
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

/** The records of one document that the lookups read, in document order; the line records are made when a lookup reads them. */
export function useRecords(block: readonly Located[], inline: readonly Located[], id: readonly Located[] = [],
  line: () => readonly Located[] = () => []): void {
  lookupRecords = { block, inline, id, line: [] }
  lineRecords = line
  lookupSites = new Map()
}

// C2-W-141: the first record of the types whose key equals the value, the last one that starts before the record
// (side -1) or the first one that starts after it (side 1).
function lookupIndex(site: number, over: Over, types: ReadonlySet<string> | undefined,
  key: ((item: unknown) => unknown) | undefined): Map<unknown, Located[]> {
  let index = lookupSites.get(site)
  if (index === undefined) {
    index = new Map()
    if (over === 'line' && lookupRecords.line.length === 0) lookupRecords.line = lineRecords()
    for (const record of lookupRecords[over]) {
      const type = (record as { type?: string }).type ?? ''
      // C2-W-150: a lookup with no types reads every block or every inline node; a text run is no node.
      if (types === undefined ? type === 'text_run' : !types.has(type)) continue
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
const lookupAll = (site: number, over: Over, types: ReadonlySet<string> | undefined,
  key: ((item: unknown) => unknown) | undefined, value: unknown): readonly Located[] => lookupIndex(site, over, types, key).get(value) ?? []

function lookupAt(site: number, over: Over, types: ReadonlySet<string> | undefined, key: ((item: unknown) => unknown) | undefined,
  value: unknown, start: number, side: -1 | 0 | 1): Located | undefined {
  const list = lookupIndex(site, over, types, key).get(value)
  if (list === undefined) return undefined
  if (side === 0) return list[0]
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (side < 0 ? list[middle]!.start < start : list[middle]!.start <= start) low = middle + 1
    else high = middle
  }
  return side < 0 ? (low === 0 ? undefined : list[low - 1]) : list[low]
}

function findIn(list: unknown, where: (item: unknown) => boolean): unknown {
  if (!Array.isArray(list)) return undefined
  for (const item of list) if (where(item)) return item
  return undefined
}

const joinOf = (list: unknown, glue: string): string => (Array.isArray(list) ? list.map((item) => String(item)).join(glue) : '')

// C2-W-150: %HH decoded as UTF-8; a text in which that fails stays as written.
function percentDecode(text: string): string {
  try { return decodeURIComponent(text) }
  catch { return text }
}

function runValue(context: LintContext, name: string): unknown {
  return name === 'extensions' ? context.options.extensions ?? [] : undefined
}

// C2-W-141, C2-W-150: the offset of a text in a text, or the index of an item in a list; -1 where there is none.
function indexOf(haystack: unknown, needle: unknown): number {
  if (Array.isArray(haystack)) return haystack.indexOf(needle)
  return typeof haystack === 'string' && typeof needle === 'string' ? haystack.indexOf(needle) : -1
}

// C2-B-004: the column of an offset, counted after the given number of quote marks of its line, with tab stops.
const columnAt = (context: LintContext, offset: number, quotes: number): number => columnOf(context.source, offset, quotes)

const lenOf = (value: unknown): number => (typeof value === 'string' || Array.isArray(value) ? value.length : 0)

function at(value: unknown, ...keys: (string | number)[]): unknown {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined
    current = typeof key === 'number' && key < 0 && Array.isArray(current) ? current[current.length + key]
      : (current as Record<string | number, unknown>)[key]
  }
  return current
}

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
const K3 = linearPattern("^(?:[^<]|<!--.*?-->|<[^!<A-Za-z/]|<[A-Za-z/]|<<|<!(?:[^-]|$)|<!-(?:[^-]|$)|<$)*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)")
const K4 = new RegExp("(?<label>\\[(?<caret>\\^)?[ \\t\\n]+\\])", "gd")
const K5 = new RegExp("^[ \\t]*(?:> [ \\t]*)*(?<c>.*?)[ \\t]*$", "")
const K6 = new RegExp("^[ \\t]*(?:> [ \\t]*)*(?<c>.*?)[ \\t]*$", "d")
const K7 = new Set<unknown>(["caption","definition_term","heading","line","paragraph"])
const K8 = new RegExp("^:{3,}\\S", "")
const K9 = new RegExp("^\\{[.#_A-Za-z]", "")
const K10 = new Set<unknown>(["admonition","directive","div","figure_group"])
const K11 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "")
const K12 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "d")
const K13 = new Set<unknown>(["caption","paragraph"])
const K14 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "")
const K15 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "d")
const K16 = new RegExp("^>(?: |$)", "")
const K17 = new RegExp("^(?<mark>>)(?:[ \\x00]|$)", "")
const K18 = new RegExp("^(?<mark>>)(?:[ \\x00]|$)", "d")
const K19 = new RegExp("^[ \t]*> ", "")
const K20 = new RegExp("^(?<mark>::) ", "")
const K21 = new RegExp("^(?<mark>::) ", "d")
const K22 = new RegExp("^(?<mark>:) ", "")
const K23 = new RegExp("^(?<mark>:) ", "d")
const K24 = new RegExp("^(?<mark>\\*?\\[.*?\\]:)", "")
const K25 = new RegExp("^(?<mark>\\*?\\[.*?\\]:)", "d")
const K26 = new RegExp("^>[^ ]", "")
const K27 = new RegExp("^>[ \\t]", "")
const K28 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell"])
const K29 = new RegExp("^\\{%\\s*(?:(?:raw|endraw|endif|endfor|endblock)\\s*|(?:if|for|block)\\s+\\S[\\s\\S]*)%\\}$", "")
const K30 = new Set<string>(["id"])
const K31 = new Set<unknown>(["caption","heading"])
const K32 = new RegExp("^(?:\\*?\\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\\s+\\d+)?\\s*:|:\\s+\\S)", "i")
const K33 = new RegExp("^(?<op>%+)", "")
const K34 = new RegExp("^(?<op>%+)", "d")
const K35 = new RegExp("^%+(?:[ \\t]*[^ \\t%]|[ \\t]+%)", "")
const K36 = new RegExp("^[ \\t]*%%", "")
const K37 = new RegExp("^/\\*|\\*/$", "")
const K38 = new RegExp("^\\*/|/\\*$", "")
const K39 = new RegExp("\\|(?<pre>(?:[^|%]|%[^|%])*)%%[^|]*$", "")
const K40 = new RegExp("\\|(?<pre>(?:[^|%]|%[^|%])*)%%[^|]*$", "d")
const K41 = new Set<unknown>([" ","\t"])
const K42 = new Set<unknown>(["csv","tsv"])
const K43 = new RegExp("^(?:able|tble|tale|tabe|tabl|.table|t.able|ta.ble|tab.le|tabl.e|table.|.able|t.ble|ta.le|tab.e|tabl.|atble|tbale|talbe|tabel)$", "i")
const K44 = new Set<unknown>(["caption","definition_term","line","paragraph"])
const K45 = new RegExp("^(?:>[ \\t]+)*(?<label>\\[.+?\\]:).", "")
const K46 = new RegExp("^(?:>[ \\t]+)*(?<label>\\[.+?\\]:).", "d")
const K47 = new RegExp("^(?<label>\\[.+?\\]:).", "")
const K48 = new RegExp("^(?<label>\\[.+?\\]:).", "d")
const K49 = new RegExp("^[ \\t]", "")
const K50 = new Set<unknown>(["admonition","block_quote","definition_description","definition_list","directive","div","figure_group","list","list_item"])
const K51 = new RegExp("^::?[ \\t]+(?<body>(?:>[ \\t]|[-*][ \\t]|[0-9]{1,9}[.)][ \\t])[\\s\\S]*)$", "")
const K52 = new RegExp("^::?[ \\t]+(?<body>(?:>[ \\t]|[-*][ \\t]|[0-9]{1,9}[.)][ \\t])[\\s\\S]*)$", "d")
const K53 = linearPattern("(?:^|[^\\\\])(?:\\\\\\\\)*\\\\$")
const K54 = new RegExp("^[\\p{Zs}\\t\\n\\r\\f\\v]|[\\p{Zs}\\t\\n\\r\\f\\v]$", "u")
const K55 = new RegExp("^=|=$", "")
const K56 = new RegExp("^[\\p{L}\\p{N}]", "u")
const K57 = new RegExp("^\\~|\\~$", "")
const K58 = new RegExp("^_|_$", "")
const K59 = new RegExp("^=?\\s*(?<prefix>(?<mark>[<>~][\\^v~]?|\\?[\\^v~])(?:\\{\\s*(?<block>[^{}]*?)\\s*\\})?)[ \\t]\\s*\\S", "")
const K60 = new RegExp("^=?\\s*(?<prefix>(?<mark>[<>~][\\^v~]?|\\?[\\^v~])(?:\\{\\s*(?<block>[^{}]*?)\\s*\\})?)[ \\t]\\s*\\S", "d")
const K61 = new RegExp("(?:^|[ \\t>])(?:[-*+]|[0-9]{1,9}[.)]|[A-Za-z][.)])(?:[ \\t]+\\[[ xX]\\])?[ \\t]+$", "")
const K62 = new RegExp("^(?:[^\"]|\"[^\"]*\")*?[{ \\t]loose(?:=|[ \\t}])", "")
const K63 = new RegExp("^\\s*\\|(?:\\s*[-:]*-[-:]*\\s*\\|)+\\s*$", "")
const K64 = new RegExp("^[^|]*\\|(?:\\s*[-:]*-[-:]*\\s*\\|)*\\s*[-:]*-[-:]*\\s*\\S\\s*$", "")
const K65 = new RegExp("^[-*_]", "")
const K66 = new RegExp("^\\*(?:[ \t]*\\*){2,}$", "")
const K67 = new RegExp("^-(?:[ \t]*-){2,}$", "")
const K68 = new RegExp("^_(?:[ \t]*_){2,}$", "")
const K69 = new RegExp("[ \t]", "")
const K70 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell","table_row"])
const K71 = new RegExp("\\S", "")
const K72 = new Set<string>(["definition_list"])
const K73 = new RegExp("^[ \\t]*>", "")
const K74 = new Set<string>(["definition_description"])
const K75 = new RegExp("^::?(?:[ \\t]|$)", "")
const K76 = new RegExp("^%%", "")
const K77 = new RegExp("^\\+[ \\t]+[^ \\t]", "")
const K78 = new RegExp("^\\^|\\^$", "")
const K79 = new Set<string>(["link_reference_definition"])
const K80 = new Set<unknown>(["emphasis","strong"])
const K81 = new RegExp("^\\s*$", "")
const K82 = new RegExp("(?<include>\\{\\{(?:\\s*|\\s+(?:\"\"|“”|[#@])[^{}]*)\\}\\})", "gd")
const K83 = new RegExp("\\]\\([ \\t]*\\)(?:\\{[^{}]*\\})*$", "")
const K84 = linearPattern("^(?<def>\\[(?<label>[^\\]]*[^\\] \\t][^\\]]*)\\]:)$")
const K85 = new RegExp("^\\[\\^[ \\t]*\\]", "")
const K86 = new RegExp("^[^`]*(?<run>`{3,})", "")
const K87 = new RegExp("^[^`]*(?<run>`{3,})", "d")
const K88 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "")
const K89 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "d")
const K90 = new RegExp("^`{3,}$", "")
const K91 = new RegExp("^[ \\t]*:{3,}[ \\t]*figure$", "")
const K92 = new RegExp("^[ \\t]*::: figure ", "")
const K93 = new RegExp("[\"\\[]", "")
const K94 = new Set<string>(["footnote"])
const K95 = new RegExp("^\\[\\^[^\\]]*\\]", "")
const K96 = new RegExp("^\\[\\^(?<label>[^\\]]*)\\]", "")
const K97 = new RegExp("^\\[\\^(?<label>[^\\]]*)\\]", "d")
const K98 = new RegExp("^:{3,}[ \\t]*footnotes(?:[ \\t]|$)", "")
const K99 = new RegExp("^---[ \\t]*\\n", "")
const K100 = new RegExp("^---[ \\t]*\\n[ \\t]*(?:\\n|$)", "")
const K101 = new RegExp("^---[ \\t]*\\n[^:]*$", "")
const K102 = new Set<unknown>(["heading","paragraph","table_cell","table_row"])
const K103 = new RegExp("^\\s*>>", "")
const K104 = new RegExp("^[ \\t]*(?:>[ \\t]*)+(?:(?:[-*]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]*>[ \\t]*)?(?:\\[[^\\]]+\\]:[ \\t]*>[ \\t]*)?(?<mark>\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\])", "")
const K105 = new RegExp("^[ \\t]*(?:>[ \\t]*)+(?:(?:[-*]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]*>[ \\t]*)?(?:\\[[^\\]]+\\]:[ \\t]*>[ \\t]*)?(?<mark>\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\])", "d")
const K106 = new RegExp("^\\*\\.[\\s\\S]*\\*$", "")
const K107 = new RegExp("^(?:#+|=+)[ \\t]+[^ \\t].*?[ \\t](?<run>#+)$", "")
const K108 = new RegExp("^(?:#+|=+)[ \\t]+[^ \\t].*?[ \\t](?<run>#+)$", "d")
const K109 = new RegExp("(?:^|[ \\t])(?<run>#+)[ \\t]*$", "")
const K110 = new RegExp("(?:^|[ \\t])(?<run>#+)[ \\t]*$", "d")
const K111 = new Set<string>(["heading"])
const K112 = new RegExp("^\\s*[#=]", "")
const K113 = new RegExp("^\\s*#", "")
const K114 = new RegExp("^\\s*=", "")
const K115 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "")
const K116 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "d")
const K117 = new RegExp("(?<o><!--)", "gd")
const K118 = new RegExp("(?:^|[^\\\\])\\\\(?:\\\\\\\\)*$", "")
const K119 = new RegExp("(?<c><!--.*?-->)", "")
const K120 = new RegExp("(?<c><!--.*?-->)", "d")
const K121 = new RegExp("(?<lines>@lines:[^\\s}]*)", "")
const K122 = new RegExp("(?<lines>@lines:[^\\s}]*)", "d")
const K123 = new RegExp("^[ \\t]*$", "")
const K124 = new RegExp("^ {4,}[^ ]", "")
const K125 = linearPattern("(?<link>\\[[^\\]\\n]+\\][ \\t]+\\([^)\\n]*\\))")
const K126 = linearPattern("\\([^)\\n]*[^)\\s][^)\\n]*\\)$")
const K127 = new Set<unknown>(["list_item","admonition","directive","div","figure_group"])
const K128 = new Set<unknown>(["admonition","block_quote","code_block","definition_list","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"])
const K129 = new Set<string>(["list_item"])
const K130 = new Set<string>(["list"])
const K131 = new Set<unknown>(["definition_term","paragraph"])
const K132 = new RegExp("^(?:[-*]|[0-9]{1,9}[.)]) [ \\t]*[^ \\t]", "")
const K133 = new RegExp("^:[ \\t].", "")
const K134 = new RegExp("^\\*|\\*$", "")
const K135 = new Set<unknown>(["admonition","block_quote","div","document","footnote","list_item"])
const K136 = new RegExp("^\\s*[ivxlcdmIVXLCDM][.)]", "")
const K137 = new RegExp("^[ \\t]*(?<fence>::: >[\\s\\S]*?)[ \\t]*$", "")
const K138 = new RegExp("^[ \\t]*(?<fence>::: >[\\s\\S]*?)[ \\t]*$", "d")
const K139 = new RegExp("^\\s*>", "")
const K140 = new RegExp("^#(?:end)?region(?:[^A-Za-z0-9_]|$)", "i")
const K141 = new RegExp("^#(?:end)?region(?:[^A-Za-z0-9_]|$)", "")
const K142 = new RegExp("^[ \\t]*(?<m>(?:(?://|--|/\\*|<!--)[ \\t]*)?#(?:end)?region(?:[^A-Za-z0-9_]|$))", "i")
const K143 = new RegExp("^[ \\t]*(?<m>(?:(?://|--|/\\*|<!--)[ \\t]*)?#(?:end)?region(?:[^A-Za-z0-9_]|$))", "id")
const K144 = new RegExp("^[ \\t]*(?:>[ \\t]+)*(?<run>={3,}|-{3,})[ \\t]*$", "")
const K145 = new RegExp("^[ \\t]*(?:>[ \\t]+)*(?<run>={3,}|-{3,})[ \\t]*$", "d")
const K146 = new Set<unknown>(["aligns","valigns","widths","header-rows","footer-rows","body-rows","body-header-rows","body-header-cols"])
const K147 = new RegExp("^[0-9]*$", "")
const K148 = new Set<unknown>(["aligns","valigns","widths"])
const K149 = new Set<unknown>(["aligns","valigns"])
const K150 = new RegExp("(?<n>[0-9]+)", "gd")
const K151 = new RegExp("^\\s*(?<block>\\{[^}]+\\})(?<marker>[<>~])", "")
const K152 = new RegExp("^\\s*(?<block>\\{[^}]+\\})(?<marker>[<>~])", "d")
const K153 = new RegExp("\\|\\s*\\{\\s*[^%}\\s][^|]*\\}\\s*\\|[^|]*$", "")
const K154 = new Set<string>(["table_row"])
const K155 = new Set<unknown>(["table_body","table_foot","table_head"])
const K156 = new RegExp("^[ \\t]*(?<plus>\\+)", "")
const K157 = new RegExp("^[ \\t]*(?<plus>\\+)", "d")
const K158 = new RegExp("\\|(?:[ \\t]*\\{[^{}]*\\})?[ \\t\\x00]*$", "")
const K159 = new Set<unknown>(["<","^"])
const K160 = new RegExp("\\\\[<^]\\s*$", "")
const K161 = new RegExp("^(?:-{3,}|_{3,})$", "")
const K162 = new Set<unknown>(["comment","comment_block"])
const K163 = new RegExp("^(?:\\[[^^]|\\[$|\\*\\[)", "")
const K164 = new RegExp("^\\s*> ", "")
const K165 = new Set<string>(["footnote_ref"])
const K166 = new Set<string>(["image","link"])

function rule0(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K0, self.text)) return
  context.report("a11y/image-alt", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule1(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((K1.has(self.leaf) || K2.has(self.leaf)) && contains(self.text, "<") && (hit(K3, K3, self.text) && mark(num(self.start))))) return
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
  for (const found of matchAll(K4, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule3(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  let v_candidate: unknown = UNSET
  let v_candidate_start: unknown = UNSET
  let v_span: unknown = UNSET
  if (!K7.has(self.leaf)) return
  if ((Boolean(self.leaf_first) && starts((v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate), "~~~"))) {
    context.report("block-marker-as-text", num((v_candidate_start === UNSET ? (v_candidate_start = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)))) : v_candidate_start)), (num((v_candidate_start === UNSET ? (v_candidate_start = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)))) : v_candidate_start)) + lenOf((v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate))), path, { "what": String("a tilde fence") }, 0)
    return
  }
  if ((Boolean(self.leaf_first) && test(K8, (v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate)))) {
    context.report("block-marker-as-text", num((v_candidate_start === UNSET ? (v_candidate_start = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)))) : v_candidate_start)), (num((v_candidate_start === UNSET ? (v_candidate_start = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)))) : v_candidate_start)) + lenOf((v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate))), path, { "what": String("a colon fence") }, 0)
    return
  }
  if ((test(K9, (v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate)) && !isAttributeLine(str((v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate)), 0, str((v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate)).length) && !(num((v_span === UNSET ? (v_span = aside(() => at(lookupAt(0, "inline", undefined, (item: unknown): unknown => ((same(at(item, "parent"), "paragraph") && !same(at(item, "type"), "text")) ? at(item, "start") : false), (v_candidate_start === UNSET ? (v_candidate_start = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)))) : v_candidate_start), self.start, 0), "start"))) : v_span)) >= 0))) {
    context.report("block-marker-as-text", num((v_candidate_start === UNSET ? (v_candidate_start = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)))) : v_candidate_start)), (num((v_candidate_start === UNSET ? (v_candidate_start = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? self.leaf_start : ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start)))) : v_candidate_start)) + lenOf((v_candidate === UNSET ? (v_candidate = aside(() => (((num(self.leaf_start) >= num(self.start)) && (num(self.leaf_start) < num(self.end))) ? textFrom(line, num(self.leaf_start)) : ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : "")))) : v_candidate))), path, { "what": String("an attribute line") }, 0)
    return
  }
}

function rule4(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!Boolean(self.after_quote_mark) && (num(self.mark_column) > num(self.owner?.["content_column"])) && !same(self.item_owner?.["type"], "list_item"))) return
  context.report("block-opener-overindented", num(self.opener_start), num(((hit(K11, K12, self.opener_text) && mark(num(self.opener_start))) ? group("mark", 1) : (num(self.opener_start) + 1))), path, { "kind": String((same(self.type, "block_quote") ? "quote" : (K10.has(self.type) ? "div" : str(self.type).replaceAll('_', ' ')))), "past": String((num(self.mark_column) - num(self.owner?.["content_column"]))), "columns": String((same((num(self.mark_column) - num(self.owner?.["content_column"])), 1) ? "column" : "columns")), "owner": String(str(self.owner?.["type"]).replaceAll('_', ' ')) }, 0)
  return
}

function rule5(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K13.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.prev?.["blank"]))) return
  if ((hit(K14, K15, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a heading") }, 0)
    return
  }
  if (((test(K16, self.raw_body) && (hit(K17, K18, self.body) && mark(num(self.body_start)))) && !(Boolean(self.quote_prefix) && test(K19, self.prev?.["text"]) && contains(self.ancestors, "block_quote")))) {
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
  if (same(self.shape, "attribute_line")) {
    context.report("block-opener-without-blank-line", num(self.body_start), num(self.body_end), path, { "opener": String("an attribute line") }, 0)
    return
  }
  if (((hit(K24, K25, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote"))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a definition") }, 0)
    return
  }
}

function rule6(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K26, self.text) && !test(K27, self.raw_body))) return
  if (K28.has(self.leaf)) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + lenOf(trimEnd(str(self.text)))), path, { "text": String(trimEnd(str(self.text)).slice(1)) }, 0)
    return
  }
  if (same(self.leaf, "frontmatter")) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + lenOf(trimEnd(str(self.text)))), path, { "text": String(trimEnd(str(self.text)).slice(1)) }, 1)
    return
  }
}

function rule7(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K29, self.text)) return
  context.report("braced-comment-in-a-template-source", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule8(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_exact_index: unknown = UNSET
  let v_exact_owner: unknown = UNSET
  let v_case_ids: unknown = UNSET
  if (!(same(at(self.node, "namespace"), "heading") && !(at(self.node, "href") !== undefined))) return
  if (((num((v_exact_index === UNSET ? (v_exact_index = aside(() => at(lookupAt(1, "id", K30, (item: unknown): unknown => at(item, "id"), at(self.node, "key"), self.start, 0), "index"))) : v_exact_index)) >= 0) && !K31.has((v_exact_owner === UNSET ? (v_exact_owner = aside(() => at(lookupAt(1, "id", K30, (item: unknown): unknown => at(item, "id"), at(self.node, "key"), self.start, 0), "owner"))) : v_exact_owner)))) {
    context.report("broken-crossref", num(self.start), num(self.end), path, { "target": String(at(self.node, "key")), "id": String(at(self.node, "key")), "kind": String((v_exact_owner === UNSET ? (v_exact_owner = aside(() => at(lookupAt(1, "id", K30, (item: unknown): unknown => at(item, "id"), at(self.node, "key"), self.start, 0), "owner"))) : v_exact_owner)) }, 0)
    return
  }
  if ((lenOf((v_case_ids === UNSET ? (v_case_ids = aside(() => lookupAll(2, "id", K30, (item: unknown): unknown => (K31.has(at(item, "owner")) ? str(at(item, "id")).toLowerCase() : false), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_case_ids)) >= 1)) {
    context.report("broken-crossref", num(self.start), num(self.end), path, { "target": String(at(self.node, "key")), "caseOnlyPhrase": String((same(lenOf((v_case_ids === UNSET ? (v_case_ids = aside(() => lookupAll(2, "id", K30, (item: unknown): unknown => (K31.has(at(item, "owner")) ? str(at(item, "id")).toLowerCase() : false), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_case_ids)), 1) ? ("the id " + joinOf((v_case_ids === UNSET ? (v_case_ids = aside(() => lookupAll(2, "id", K30, (item: unknown): unknown => (K31.has(at(item, "owner")) ? str(at(item, "id")).toLowerCase() : false), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_case_ids), ", ") + " differs only in case") : ("the ids " + joinOf((v_case_ids === UNSET ? (v_case_ids = aside(() => lookupAll(2, "id", K30, (item: unknown): unknown => (K31.has(at(item, "owner")) ? str(at(item, "id")).toLowerCase() : false), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_case_ids), ", ") + " differ only in case"))) }, 1)
    return
  }
  context.report("broken-crossref", num(self.start), num(self.end), path, { "target": String(at(self.node, "key")) }, 2)
  return
}

function rule9(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_fragment: unknown = UNSET
  let v_decoded: unknown = UNSET
  let v_as_written: unknown = UNSET
  let v_as_decoded: unknown = UNSET
  let v_case_only: unknown = UNSET
  if (!(starts(at(self.node, "href"), "#") && same(lenOf(runValue(context, "extensions")), 0) && !same((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment), "") && !same(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment)).toLowerCase(), "top") && !(num(at(lookupAt(1, "id", K30, (item: unknown): unknown => at(item, "id"), (v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment), self.start, 0), "index")) >= 0) && !(num(at(lookupAt(1, "id", K30, (item: unknown): unknown => at(item, "id"), (v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded), self.start, 0), "index")) >= 0))) return
  if ((lenOf((v_case_only === UNSET ? (v_case_only = aside(() => (((num((v_as_written === UNSET ? (v_as_written = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment)).toLowerCase(), self.start, 0), "index"))) : v_as_written)) >= 0) && (!(num((v_as_decoded === UNSET ? (v_as_decoded = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "index"))) : v_as_decoded)) >= 0) || (num((v_as_written === UNSET ? (v_as_written = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment)).toLowerCase(), self.start, 0), "index"))) : v_as_written)) <= num((v_as_decoded === UNSET ? (v_as_decoded = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "index"))) : v_as_decoded))))) ? at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment)).toLowerCase(), self.start, 0), "id") : ((num((v_as_decoded === UNSET ? (v_as_decoded = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "index"))) : v_as_decoded)) >= 0) ? at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "id") : "")))) : v_case_only)) >= 1)) {
    context.report("broken-fragment-link", num(self.start), num(self.end), path, { "href": String(at(self.node, "href")), "caseOnly": String((v_case_only === UNSET ? (v_case_only = aside(() => (((num((v_as_written === UNSET ? (v_as_written = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment)).toLowerCase(), self.start, 0), "index"))) : v_as_written)) >= 0) && (!(num((v_as_decoded === UNSET ? (v_as_decoded = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "index"))) : v_as_decoded)) >= 0) || (num((v_as_written === UNSET ? (v_as_written = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment)).toLowerCase(), self.start, 0), "index"))) : v_as_written)) <= num((v_as_decoded === UNSET ? (v_as_decoded = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "index"))) : v_as_decoded))))) ? at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment)).toLowerCase(), self.start, 0), "id") : ((num((v_as_decoded === UNSET ? (v_as_decoded = aside(() => at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "index"))) : v_as_decoded)) >= 0) ? at(lookupAt(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str((v_decoded === UNSET ? (v_decoded = aside(() => percentDecode(str((v_fragment === UNSET ? (v_fragment = aside(() => str(at(self.node, "href")).slice(1, num(((indexOf(at(self.node, "href"), ":~:") >= 0) ? indexOf(at(self.node, "href"), ":~:") : lenOf(at(self.node, "href"))))))) : v_fragment))))) : v_decoded)).toLowerCase(), self.start, 0), "id") : "")))) : v_case_only)) }, 0)
    return
  }
  context.report("broken-fragment-link", num(self.start), num(self.end), path, { "href": String(at(self.node, "href")), "caseOnly": String("") }, 1)
  return
}

function rule10(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K32, self.body))) return
  if ((K2.has(self.next?.["leaf"]) || K2.has(self.next2?.["leaf"]))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 0)
    return
  }
  if ((K2.has(self.prev?.["leaf"]) || K2.has(self.prev2?.["leaf"]) || contains(self.prev?.["text"], "![") || contains(self.prev2?.["text"], "!["))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 1)
    return
  }
}

function rule11(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(starts(self.body, ":::") && same(self.shape, "div_bare_run") && (self.open_colon?.[0] !== undefined) && !same(self.open_colon?.[0]?.["width"], lenOf(self.body)))) return
  if ((lenOf(self.body) > num(self.open_colon?.[0]?.["width"]))) {
    context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(lenOf(self.body)), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 2)
    return
  }
  if (someFrom(self.open_colon, 1, (item) => (num(at(item, "width")) <= lenOf(self.body)))) {
    context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(lenOf(self.body)), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 1)
    return
  }
  context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(lenOf(self.body)), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 0)
  return
}

function rule12(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_opener: unknown = UNSET
  if (!(same(self.leaf, "comment_block") && !Boolean(self.leaf_first) && (lenOf((v_opener === UNSET ? (v_opener = aside(() => ((same(self.leaf, "comment_block") && !Boolean(self.leaf_first)) ? ((hit(K33, K34, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "") : ""))) : v_opener)) >= 3) && starts(self.body, str((v_opener === UNSET ? (v_opener = aside(() => ((same(self.leaf, "comment_block") && !Boolean(self.leaf_first)) ? ((hit(K33, K34, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "") : ""))) : v_opener))) && test(K35, self.body))) return
  context.report("comment-fence-closer-with-text", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule13(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K36, self.text)) return
  context.report("comment-line-in-line-block", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule14(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if ((same(self.type, "emphasis") && test(K37, self.text))) {
    context.report("comment-shaped-emphasis", num(self.start), num(self.end), path, {  }, 0)
    return
  }
  if ((same(self.type, "strong") && test(K38, self.text))) {
    context.report("comment-shaped-emphasis", num(self.start), num(self.end), path, {  }, 0)
    return
  }
}

function rule15(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.table_below?.["raw_body"], "+")) return
  if ((starts(self.raw_body, "%%") && (starts(self.table_above?.["raw_body"], "|") || starts(self.table_above?.["raw_body"], "+")))) {
    context.report("comment-splits-table-row", num(self.body_start), (num(self.body_start) + lenOf(self.raw_body)), path, {  }, 0)
    return
  }
  if (((starts(self.raw_body, "|") || starts(self.raw_body, "+")) && (hit(K39, K40, self.raw_body) && mark(num(self.body_start))) && K41.has(str(self.raw_body).slice(((num(group("pre", 1)) - num(self.body_start)) - 1), (num(group("pre", 1)) - num(self.body_start)))))) {
    context.report("comment-splits-table-row", (num(group("pre", 1)) - 1), (num(self.body_start) + lenOf(self.raw_body)), path, {  }, 0)
    return
  }
}

function rule16(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(K42.has(at(self.owner?.["node"], "syntax")) && same(self.kind, "key") && Boolean(self.last_key) && same(self.value, "") && !same(self.key, "table") && test(K43, self.key))) return
  context.report("consumed-key-near-miss", num(self.owner?.["opener_start"]), num(self.owner?.["end"]), path, { "word": String(self.key), "key": String("table") }, 0)
  return
}

function rule17(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K44.has(self.leaf) && ((hit(K45, K46, self.body) && mark(num(self.body_start))) && ((Boolean(self.lazy) && contains(self.ancestors, "block_quote")) || (hit(K47, K48, self.body) && mark(num(self.body_start))))) && !contains(self.ancestors, "footnote") && !(same(self.leaf, "definition_term") && !Boolean(self.leaf_first) && !test(K49, self.text)) && (test(K49, self.text) || someFrom(self.ancestors, 0, (item) => K50.has(at(item)))))) return
  context.report("definition-in-container", num(group("label", 0)), num(group("label", 1)), path, {  }, 0)
  return
}

function rule18(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "definition_term") && Boolean(self.leaf_first))) return
  if ((hit(K51, K52, self.body) && mark(num(self.body_start)))) {
    context.report("definition-term-block-folded", num(group("body", 0)), num(group("body", 1)), path, {  }, 0)
    return
  }
}

function rule19(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_width: unknown = UNSET
  if (!(K42.has(self.source_format) && someFrom(at(self.node, "children"), 0, (item) => someFrom(at(item, "children"), 0, (item) => (countFrom(at(item, "children"), 0, () => true) > num((v_width === UNSET ? (v_width = aside(() => countFrom(at(self.node, "children", 0, "children", 0, "children"), 0, () => true))) : v_width))))))) return
  context.report("delimited-table-wide-row", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule20(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "=")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K55, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
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

function rule21(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "~")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K57, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
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

function rule22(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "_")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K58, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
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

function rule23(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && (!starts(self.text, "=") || Boolean(at(self.node, "header"))) && (hit(K59, K60, self.text) && mark(num(self.start))))) return
  if (!same(group("block", 0), group("block", 1))) {
    context.report("deprecated-cell-alignment", num(group("prefix", 0)), num(group("prefix", 1)), path, { "prefix": String(str(self.text).slice((num(group("prefix", 0)) - num(self.start)), (num(group("prefix", 1)) - num(self.start)))), "braced": String(("{" + str(self.text).slice((num(group("mark", 0)) - num(self.start)), (num(group("mark", 1)) - num(self.start))) + " " + str(self.text).slice((num(group("block", 0)) - num(self.start)), (num(group("block", 1)) - num(self.start))) + "}")) }, 0)
    return
  }
  context.report("deprecated-cell-alignment", num(group("prefix", 0)), num(group("prefix", 1)), path, { "prefix": String(str(self.text).slice((num(group("prefix", 0)) - num(self.start)), (num(group("prefix", 1)) - num(self.start)))), "braced": String(("{" + str(self.text).slice((num(group("mark", 0)) - num(self.start)), (num(group("mark", 1)) - num(self.start))) + "}")) }, 0)
  return
}

function rule24(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.body, "+") && !K2.has(self.leaf))) return
  if (test(K61, str(self.text).slice(0, (num(self.body_start) - num(self.start))))) {
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

function rule25(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(Boolean(self.attributed) && test(K62, str(self.text).slice(0, (num(self.opener_start) - num(self.start)))))) return
  context.report("deprecated-loose-attribute", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule26(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.index, 1) && test(K63, self.text) && contains(self.line?.["prev"]?.["text"], "|") && !test(K64, self.line?.["prev"]?.["text"]))) return
  context.report("deprecated-separator-row", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule27(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  let v_run_start: unknown = UNSET
  if (!(test(K65, self.body) && (test(K66, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)))) || test(K67, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)))) || test(K68, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start))))) && test(K69, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)))))) return
  context.report("deprecated-spaced-thematic-break", num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)), num(self.body_end), path, {  }, 0)
  return
}

function rule28(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && same(self.key, "header-rows") && Boolean(self.last_key) && same(self.owner?.["format"], "pipe"))) return
  context.report("deprecated-table-attribute", num(self.owner?.["start"]), num(self.owner?.["end"]), path, {  }, 0)
  return
}

function rule29(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_depth: unknown = UNSET
  let v_content: unknown = UNSET
  let v_content_start: unknown = UNSET
  let v_host_index: unknown = UNSET
  let v_host_list: unknown = UNSET
  let v_host_column: unknown = UNSET
  let v_column: unknown = UNSET
  if (!(!(same((v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), 0) && test(K73, self.text)) && !(num(at(lookupAt(6, "block", K74, (item: unknown): unknown => at(item, "line", "number"), self.number, self.start, 0), "start")) >= 0) && test(K75, (v_content === UNSET ? (v_content = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))) : v_content)) && !(same(self.leaf, "definition_term") && Boolean(self.leaf_first)) && (num((v_host_column === UNSET ? (v_host_column = aside(() => at(lookupAt(5, "block", K72, (item: unknown): unknown => at(item, "identity"), (v_host_list === UNSET ? (v_host_list = aside(() => ((num((v_host_index === UNSET ? (v_host_index = aside(() => indexOf(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestors"), "definition_list"))) : v_host_index)) >= 0) ? at(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestor_ids"), num((v_host_index === UNSET ? (v_host_index = aside(() => indexOf(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestors"), "definition_list"))) : v_host_index))) : ""))) : v_host_list), self.start, 0), "column"))) : v_host_column)) > num((v_column === UNSET ? (v_column = aside(() => columnAt(context, num((v_content_start === UNSET ? (v_content_start = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))) : v_content_start)), num((v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth))))) : v_column))))) return
  context.report("description-separator-below-content-column", num((v_content_start === UNSET ? (v_content_start = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))) : v_content_start)), (num((v_content_start === UNSET ? (v_content_start = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))) : v_content_start)) + lenOf((v_content === UNSET ? (v_content = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))) : v_content))), path, { "name": String((starts((v_content === UNSET ? (v_content = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))) : v_content), "::") ? "term" : "description")), "column": String((num((v_column === UNSET ? (v_column = aside(() => columnAt(context, num((v_content_start === UNSET ? (v_content_start = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))) : v_content_start)), num((v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth))))) : v_column)) + 1)), "host.column": String((num((v_host_column === UNSET ? (v_host_column = aside(() => at(lookupAt(5, "block", K72, (item: unknown): unknown => at(item, "identity"), (v_host_list === UNSET ? (v_host_list = aside(() => ((num((v_host_index === UNSET ? (v_host_index = aside(() => indexOf(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestors"), "definition_list"))) : v_host_index)) >= 0) ? at(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestor_ids"), num((v_host_index === UNSET ? (v_host_index = aside(() => indexOf(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestors"), "definition_list"))) : v_host_index))) : ""))) : v_host_list), self.start, 0), "column"))) : v_host_column)) + 1)) }, 0)
  return
}

function rule30(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(num(self.last_line?.["number"]) > num(self.line?.["number"]))) return
  if (!test(K76, self.line?.["next"]?.["body"])) {
    context.report("description-term-multi-line", num(self.line?.["next"]?.["body_start"]), num(self.line?.["next"]?.["end"]), path, {  }, 0)
    return
  }
  if ((self.line?.["next2"] !== undefined)) {
    context.report("description-term-multi-line", num(self.line?.["next2"]?.["body_start"]), num(self.line?.["next2"]?.["end"]), path, {  }, 0)
    return
  }
}

function rule31(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "_")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K58, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start)))) && !test(K56, str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start)))))) {
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

function rule32(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && starts(self.prev?.["body"], "# ") && test(K71, self.text) && ((num(self.body_start) - num(self.start)) <= (num(self.prev?.["body_start"]) - num(self.prev?.["start"]))))) return
  context.report("djot-heading-continuation", num(self.prev?.["start"]), num(self.end), path, {  }, 0)
  return
}

function rule33(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.text, "{=")) return
  context.report("djot-highlight-braces", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule34(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K77, self.body))) return
  context.report("djot-plus-bullet", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule35(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "~")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K57, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "{") && !same(str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start))), "}") && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "~"))) {
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

function rule36(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.text, "{~")) return
  context.report("djot-subscript-tilde-braced", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule37(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "^")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K78, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "{") && !same(str(self.text).slice((num(group("after", 0)) - num(self.start)), (num(group("after", 1)) - num(self.start))), "}") && !same(str(self.text).slice((num(group("before", 0)) - num(self.start)), (num(group("before", 1)) - num(self.start))), "^"))) {
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

function rule38(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(num(at(lookupAt(7, "block", K79, (item: unknown): unknown => at(item, "node", "href"), at(self.node, "href"), self.start, 0), "start")) < num(self.start))) return
  context.report("duplicate-reference-url", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule39(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(someFrom(at(self.node, "children"), 0, (item) => K80.has(at(item, "type"))) && same(countFrom(at(self.node, "children"), 0, (item) => (!same(at(item, "type"), "comment") && !(same(at(item, "type"), "text") && test(K81, at(item, "value"))))), 1))) return
  context.report("emphasis-as-heading", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule40(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && contains(self.text, "{{"))) return
  const one = (): void => {
    context.report("empty-include-path", num(group("include", 0)), num(group("include", 1)), path, { "text": String(str(self.text).slice((num(group("include", 0)) - num(self.start)), (num(group("include", 1)) - num(self.start)))) }, 0)
    return
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K82, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule41(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K83, self.text)) return
  context.report("empty-link-destination", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule42(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && (hit(K84, K84, self.body) && mark(num(self.body_start))) && !test(K85, self.body))) return
  if (starts(self.body, "[^")) {
    context.report("empty-reference-definition", num(group("def", 0)), num(group("def", 1)), path, { "label": String(str(self.body).slice(1, (lenOf(self.body) - 2))) }, 1)
    return
  }
  context.report("empty-reference-definition", num(group("def", 0)), num(group("def", 1)), path, { "label": String(str(self.body).slice(1, (lenOf(self.body) - 2))) }, 0)
  return
}

function rule43(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_run: unknown = UNSET
  let v_at: unknown = UNSET
  if (!((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (lenOf((v_run === UNSET ? (v_run = aside(() => ((hit(K86, K87, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : ""))) : v_run)) >= 3) && (hit(K88, K89, self.last_line?.["text"]) && mark(num(self.last_line?.["start"]))) && test(K90, self.last_line?.["body"]) && !same((num(group("close", 0)) - num(self.last_line?.["start"])), (v_at === UNSET ? (v_at = aside(() => ((hit(K86, K87, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? (num(group("run", 0)) - num(self.line?.["start"])) : -1))) : v_at)) && starts(str(self.last_line?.["text"]).slice((num(group("close", 0)) - num(self.last_line?.["start"]))), str((v_run === UNSET ? (v_run = aside(() => ((hit(K86, K87, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : ""))) : v_run))))) return
  context.report("fence-closer-indented", num(group("close", 0)), num(self.last_line?.["end"]), path, {  }, 0)
  return
}

function rule44(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!same(countFrom(at(self.node, "children"), 0, (item) => (same(at(item, "type"), "table") || (!same(at(item, "type"), "figure_group") && (at(item, "caption") !== undefined)))), 0)) return
  context.report("figure-group-empty", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule45(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K91, self.opener_text) && contains(self.ancestors, "figure_group"))) return
  context.report("figure-group-nested", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule46(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K92, self.line?.["text"]) && test(K93, self.line?.["text"]))) return
  context.report("figure-group-opener-metadata", num(self.line?.["start"]), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule47(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!same(countFrom(at(self.node, "children"), 0, (item) => (same(at(item, "type"), "table") || (!same(at(item, "type"), "figure_group") && (at(item, "caption") !== undefined)))), 1)) return
  context.report("figure-group-single-panel", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule48(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_twin_start: unknown = UNSET
  let v_twin_text: unknown = UNSET
  let v_label: unknown = UNSET
  let v_twin_label: unknown = UNSET
  if (!((hit(K96, K97, self.text) && mark(num(self.start))) && !same((v_twin_start === UNSET ? (v_twin_start = aside(() => at(lookupAt(8, "block", K94, (item: unknown): unknown => (test(K95, at(item, "text")) ? at(item, "node", "key") : ""), at(self.node, "key"), self.start, 0), "start"))) : v_twin_start), self.start) && !same((v_twin_label === UNSET ? (v_twin_label = aside(() => ((hit(K96, K97, (v_twin_text === UNSET ? (v_twin_text = aside(() => at(lookupAt(8, "block", K94, (item: unknown): unknown => (test(K95, at(item, "text")) ? at(item, "node", "key") : ""), at(self.node, "key"), self.start, 0), "text"))) : v_twin_text)) && mark(0)) ? str((v_twin_text === UNSET ? (v_twin_text = aside(() => at(lookupAt(8, "block", K94, (item: unknown): unknown => (test(K95, at(item, "text")) ? at(item, "node", "key") : ""), at(self.node, "key"), self.start, 0), "text"))) : v_twin_text)).slice(2, num(group("label", 1))) : ""))) : v_twin_label), (v_label === UNSET ? (v_label = aside(() => ((hit(K96, K97, self.text) && mark(num(self.start))) ? str(self.text).slice(2, (num(group("label", 1)) - num(self.start))) : ""))) : v_label)))) return
  context.report("footnote-labels-differ-only-in-whitespace", num(self.start), num(self.end), path, { "label": String((v_label === UNSET ? (v_label = aside(() => ((hit(K96, K97, self.text) && mark(num(self.start))) ? str(self.text).slice(2, (num(group("label", 1)) - num(self.start))) : ""))) : v_label)), "twin": String((v_twin_label === UNSET ? (v_twin_label = aside(() => ((hit(K96, K97, (v_twin_text === UNSET ? (v_twin_text = aside(() => at(lookupAt(8, "block", K94, (item: unknown): unknown => (test(K95, at(item, "text")) ? at(item, "node", "key") : ""), at(self.node, "key"), self.start, 0), "text"))) : v_twin_text)) && mark(0)) ? str((v_twin_text === UNSET ? (v_twin_text = aside(() => at(lookupAt(8, "block", K94, (item: unknown): unknown => (test(K95, at(item, "text")) ? at(item, "node", "key") : ""), at(self.node, "key"), self.start, 0), "text"))) : v_twin_text)).slice(2, num(group("label", 1))) : ""))) : v_twin_label)), "key": String(JSON.stringify(str(at(self.node, "key"))).slice(1, -1)) }, 0)
  return
}

function rule49(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!same(self.parent?.["type"], "document") && test(K98, self.opener_text))) return
  context.report("footnotes-placement-in-container", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule50(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K99, self.text) && (test(K100, self.text) || test(K101, self.text)))) return
  context.report("frontmatter-shaped-thematic-break", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule51(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K102.has(self.leaf) && !test(K103, self.text) && (hit(K104, K105, self.text) && mark(num(self.start))))) return
  context.report("github-alert-marker", num(group("mark", 0)), num(group("mark", 1)), path, {  }, 0)
  return
}

function rule52(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K106, self.text)) return
  context.report("glob-shaped-strong", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule53(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((same(self.last_line?.["number"], self.line?.["number"]) && (hit(K107, K108, self.line?.["body"]) && mark(num(self.line?.["body_start"])))) || ((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (hit(K109, K110, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))))) return
  context.report("heading-closing-hashes", num(group("run", 0)), num(group("run", 1)), path, { "run": String(str(self.last_line?.["text"]).slice((num(group("run", 0)) - num(self.last_line?.["start"])), (num(group("run", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule54(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_previous: unknown = UNSET
  if (!(num(at(self.node, "level")) > (num((v_previous === UNSET ? (v_previous = aside(() => at(lookupAt(9, "block", K111, undefined, undefined, self.start, -1), "node", "level"))) : v_previous)) + 1))) return
  context.report("heading-level-skip", num(self.start), num(self.end), path, { "previous": String((v_previous === UNSET ? (v_previous = aside(() => at(lookupAt(9, "block", K111, undefined, undefined, self.start, -1), "node", "level"))) : v_previous)), "level": String(at(self.node, "level")) }, 0)
  return
}

function rule55(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(at(lookupAt(10, "block", K111, (item: unknown): unknown => test(K112, at(item, "text")), true, self.start, 0), "start"), self.start) && (num(at(lookupAt(11, "block", K111, (item: unknown): unknown => test(K113, at(item, "text")), true, self.start, 0), "start")) >= 0) && (num(at(lookupAt(12, "block", K111, (item: unknown): unknown => test(K114, at(item, "text")), true, self.start, 0), "start")) >= 0))) return
  context.report("heading-marker-mixed", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule56(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(hit(K115, K116, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))) return
  context.report("heading-trailing-attribute", num(group("block", 0)), num(group("block", 1)), path, { "block": String(str(self.last_line?.["text"]).slice((num(group("block", 0)) - num(self.last_line?.["start"])), (num(group("block", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule57(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  const one = (): void => {
    if (((indexOf(str(self.text).slice((num(group("o", 1)) - num(self.start))), "-->") >= 0) && contains(str(self.text).slice((num(group("o", 1)) - num(self.start))).slice(0, indexOf(str(self.text).slice((num(group("o", 1)) - num(self.start))), "-->")), "\n") && !test(K118, str(self.text).slice(0, (num(group("o", 0)) - num(self.start)))))) {
      context.report("html-comment-renders-as-text", num(group("o", 0)), (num(group("o", 1)) + indexOf(str(self.text).slice((num(group("o", 1)) - num(self.start))), "-->") + 3), path, {  }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K117, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule58(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && (hit(K119, K120, self.text) && mark(num(self.start))))) return
  context.report("html-comment-renders-as-text", num(group("c", 0)), num(group("c", 1)), path, {  }, 0)
  return
}

function rule59(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((at(self.node, "attrs") !== undefined) && !(at(self.node, "options", "code") !== undefined))) return
  context.report("include-attributes-unused", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule60(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((at(self.node, "options", "lines") !== undefined) && K42.has(at(self.node, "options", "code")) && someFrom(at(self.node, "attrs", "keyValues"), 0, (item) => same(at(item, 0), "table")) && (hit(K121, K122, self.text) && mark(num(self.start))))) return
  context.report("include-lines-table-rows-hint", num(group("lines", 0)), num(group("lines", 1)), path, {  }, 0)
  return
}

function rule61(self: ModelBlock, path: string, context: LintContext): void {
  const line = self.line
  groups = undefined
  if (!(same(self.parent?.["type"], "document") && (num(self.line?.["number"]) > 1) && test(K123, self.line?.["prev"]?.["text"]) && !same(self.prev_type, "list") && test(K124, self.line?.["text"]))) return
  context.report("indented-code-block", scan(line, num(self.line?.["start"]), " \t", 1), (num(self.line?.["start"]) + lenOf(trimEnd(str(self.line?.["text"])))), path, {  }, 0)
  return
}

function rule62(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && contains(self.text, "]"))) return
  const one = (): void => {
    if (test(K126, str(self.text).slice((num(group("link", 0)) - num(self.start)), (num(group("link", 1)) - num(self.start))))) {
      context.report("link-gap-before-destination", num(group("link", 0)), num(group("link", 1)), path, {  }, 0)
      return
    }
  }
  const text = self.text
  if (text === '') return
  for (const found of matchAll(K125, text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule63(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((same(self.item_owner?.["type"], "list_item") && K127.has(self.parent?.["type"])) && (K128.has(self.type) || Boolean(self.image_line) || Boolean(self.attributed)) && (num(self.opener_column) > num(self.item_owner?.["content_column"])))) return
  context.report("list-item-block-overindented", num(self.start), num(self.line?.["end"]), path, { "contentColumn": String((num(self.item_owner?.["content_column"]) + 1)) }, 0)
  return
}

function rule64(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (num(self.index) >= 1) && (num(self.column) > num(self.parent?.["marker_column"])) && (num(self.column) < num(self.parent?.["content_column"])))) return
  context.report("list-item-body-below-content-column", num(self.start), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule65(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_previous: unknown = UNSET
  let v_outer: unknown = UNSET
  let v_list_index: unknown = UNSET
  let v_list_prev: unknown = UNSET
  let v_prev_list: unknown = UNSET
  let v_deeper: unknown = UNSET
  if (!(num((v_outer === UNSET ? (v_outer = aside(() => at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[1], self.start, 0), "layout", "markerColumn"))) : v_outer)) >= 0)) return
  if (((num(self.index) >= 1) && (num(self.layout?.["markerColumn"]) < num((v_previous === UNSET ? (v_previous = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, -1), "layout", "markerColumn"))) : v_previous))) && (num(self.layout?.["markerColumn"]) > num((v_outer === UNSET ? (v_outer = aside(() => at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[1], self.start, 0), "layout", "markerColumn"))) : v_outer))))) {
    context.report("list-marker-below-content-column", num(self.start), num(self.end), path, { "column": String((num(self.layout?.["markerColumn"]) + 1)), "contentColumn": String((num((v_previous === UNSET ? (v_previous = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, -1), "layout", "markerColumn"))) : v_previous)) + 1)), "baseColumn": String((num((v_outer === UNSET ? (v_outer = aside(() => at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[1], self.start, 0), "layout", "markerColumn"))) : v_outer)) + 1)) }, 0)
    return
  }
  if ((same(self.index, 0) && (num((v_list_index === UNSET ? (v_list_index = aside(() => at(lookupAt(15, "block", K130, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[0], self.start, 0), "index"))) : v_list_index)) >= 1) && same((v_list_prev === UNSET ? (v_list_prev = aside(() => at(lookupAt(15, "block", K130, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[0], self.start, 0), "prev_type"))) : v_list_prev), "list") && (num((v_outer === UNSET ? (v_outer = aside(() => at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[1], self.start, 0), "layout", "markerColumn"))) : v_outer)) < num(self.layout?.["markerColumn"])) && (num(self.layout?.["markerColumn"]) < num((v_deeper === UNSET ? (v_deeper = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), (v_prev_list === UNSET ? (v_prev_list = aside(() => at(lookupAt(16, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 1), self.ancestor_ids?.[1], self.start, -1), "ancestor_ids", 0))) : v_prev_list), self.start, 0), "layout", "markerColumn"))) : v_deeper))))) {
    context.report("list-marker-below-content-column", num(self.start), num(self.end), path, { "column": String((num(self.layout?.["markerColumn"]) + 1)), "contentColumn": String((num((v_deeper === UNSET ? (v_deeper = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), (v_prev_list === UNSET ? (v_prev_list = aside(() => at(lookupAt(16, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 1), self.ancestor_ids?.[1], self.start, -1), "ancestor_ids", 0))) : v_prev_list), self.start, 0), "layout", "markerColumn"))) : v_deeper)) + 1)), "baseColumn": String((num((v_outer === UNSET ? (v_outer = aside(() => at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[1], self.start, 0), "layout", "markerColumn"))) : v_outer)) + 1)) }, 0)
    return
  }
}

function rule66(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K131.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.leaf_first) && test(K132, self.body))) return
  if ((same(self.leaf, "definition_term") || contains(self.ancestors, "definition_term") || contains(self.ancestors, "definition_description"))) {
    context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule67(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_depth: unknown = UNSET
  let v_content: unknown = UNSET
  let v_content_start: unknown = UNSET
  let v_host_index: unknown = UNSET
  let v_host_list: unknown = UNSET
  let v_host_column: unknown = UNSET
  let v_column: unknown = UNSET
  if (!(same(self.leaf, "paragraph") && same(self.prev?.["leaf_id"], self.leaf_id) && test(K133, self.body) && !starts(self.prev?.["body"], ":: ") && !(!(same((v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), 0) && test(K73, self.text)) && !(num(at(lookupAt(6, "block", K74, (item: unknown): unknown => at(item, "line", "number"), self.number, self.start, 0), "start")) >= 0) && test(K75, (v_content === UNSET ? (v_content = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? str(self.text).slice((num(group("c", 0)) - num(self.start)), (num(group("c", 1)) - num(self.start))) : ""))) : v_content)) && !(same(self.leaf, "definition_term") && Boolean(self.leaf_first)) && (num((v_host_column === UNSET ? (v_host_column = aside(() => at(lookupAt(5, "block", K72, (item: unknown): unknown => at(item, "identity"), (v_host_list === UNSET ? (v_host_list = aside(() => ((num((v_host_index === UNSET ? (v_host_index = aside(() => indexOf(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestors"), "definition_list"))) : v_host_index)) >= 0) ? at(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestor_ids"), num((v_host_index === UNSET ? (v_host_index = aside(() => indexOf(at(lookupAt(4, "line", undefined, (item: unknown): unknown => (test(K71, at(item, "text")) ? (K70.has(at(item, "leaf")) ? at(item, "quote_depth") : 0) : false), (v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth), self.start, -1), "ancestors"), "definition_list"))) : v_host_index))) : ""))) : v_host_list), self.start, 0), "column"))) : v_host_column)) > num((v_column === UNSET ? (v_column = aside(() => columnAt(context, num((v_content_start === UNSET ? (v_content_start = aside(() => ((hit(K5, K6, self.text) && mark(num(self.start))) ? group("c", 0) : self.start))) : v_content_start)), num((v_depth === UNSET ? (v_depth = aside(() => (K70.has(self.leaf) ? self.quote_depth : 0))) : v_depth))))) : v_column)))))) return
  context.report("markdown-definition-paragraph", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule68(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "~~")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K57, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))))) {
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

function rule69(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "**")) return
  const one = (): void => {
    if ((!test(K53, str(self.text).slice(0, (num(group("open", 0)) - num(self.start)))) && !test(K54, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !test(K134, str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start)))) && !contains(str(self.text).slice((num(group("inner", 0)) - num(self.start)), (num(group("inner", 1)) - num(self.start))), "*"))) {
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

function rule70(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_next_index: unknown = UNSET
  let v_next_style: unknown = UNSET
  let v_next_line: unknown = UNSET
  if (!(K135.has(self.parent?.["type"]) && same(lenOf(at(self.node, "children")), 1) && same((v_next_index === UNSET ? (v_next_index = aside(() => at(lookupAt(17, "block", K130, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 1), "index"))) : v_next_index), (num(self.index) + 1)) && ((same(at(self.node, "marker", "style"), "i") && same((v_next_style === UNSET ? (v_next_style = aside(() => at(lookupAt(17, "block", K130, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 1), "node", "marker", "style"))) : v_next_style), "a")) || (same(at(self.node, "marker", "style"), "a") && same((v_next_style === UNSET ? (v_next_style = aside(() => at(lookupAt(17, "block", K130, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 1), "node", "marker", "style"))) : v_next_style), "i")) || (same(at(self.node, "marker", "style"), "I") && same((v_next_style === UNSET ? (v_next_style = aside(() => at(lookupAt(17, "block", K130, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 1), "node", "marker", "style"))) : v_next_style), "A")) || (same(at(self.node, "marker", "style"), "A") && same((v_next_style === UNSET ? (v_next_style = aside(() => at(lookupAt(17, "block", K130, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 1), "node", "marker", "style"))) : v_next_style), "I"))) && test(K136, self.text) && ((num((v_next_line === UNSET ? (v_next_line = aside(() => at(lookupAt(17, "block", K130, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 1), "line", "number"))) : v_next_line)) - num(self.last_line?.["number"])) < 4))) return
  context.report("ordered-list-kind-split", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule71(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_kind: unknown = UNSET
  let v_first_marker: unknown = UNSET
  let v_first_content: unknown = UNSET
  if (!((num(self.index) >= 1) && same((v_kind === UNSET ? (v_kind = aside(() => at(lookupAt(15, "block", K130, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[0], self.start, 0), "node", "marker", "kind"))) : v_kind), "ordered") && (num((v_first_marker === UNSET ? (v_first_marker = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 0), "layout", "markerColumn"))) : v_first_marker)) > num(self.layout?.["markerColumn"])) && same((v_first_content === UNSET ? (v_first_content = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 0), "layout", "contentColumn"))) : v_first_content), self.layout?.["contentColumn"]))) return
  context.report("ordered-marker-right-aligned", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule72(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((hit(K137, K138, self.text) && mark(num(self.start))) && test(K139, self.prev?.["text"]))) return
  context.report("quote-fence-ends-the-quote-above", num(group("fence", 0)), num(group("fence", 1)), path, {  }, 0)
  return
}

function rule73(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(at(self.node, "form"), "line") && test(K140, at(self.node, "value")) && !test(K141, at(self.node, "value")))) return
  context.report("region-marker-renders-as-text", num(self.start), num(self.end), path, {  }, 1)
  return
}

function rule74(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(at(self.node, "form"), "line") && test(K140, at(self.node, "value")) && !test(K141, at(self.node, "value")))) return
  context.report("region-marker-renders-as-text", num(self.start), num(self.end), path, {  }, 1)
  return
}

function rule75(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && (hit(K142, K143, self.text) && mark(num(self.start))))) return
  context.report("region-marker-renders-as-text", num(group("m", 0)), num(self.body_end), path, {  }, 0)
  return
}

function rule76(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(!same(self.owner?.["type"], "span") && same(self.kind, "key") && Boolean(self.semantic) && Boolean(self.last_key))) return
  context.report("semantic-attribute-outside-span", num(self.start), num(self.key_end), path, { "name": String(self.key), "type": String(self.owner?.["type"]), "value": String(self.value) }, 0)
  return
}

function rule77(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && Boolean(self.semantic) && !Boolean(self.semantic_value) && !same(self.value, "") && Boolean(self.last_key))) return
  context.report("semantic-attribute-value-ignored", num(self.start), num(self.end), path, { "name": String(self.key) }, 0)
  return
}

function rule78(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  if (!((hit(K144, K145, self.text) && mark(num(self.start))) && (self.prev !== undefined) && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"]) && (starts(textFrom(line, num(group("run", 0))), "-") || (same(self.leaf, "paragraph") && same(self.prev?.["leaf_id"], self.leaf_id))))) return
  context.report("setext-heading-underline", num(group("run", 0)), num(group("run", 1)), path, {  }, 0)
  return
}

function rule79(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && K146.has(self.key) && Boolean(self.kept) && Boolean(self.last_key) && !(same(self.owner?.["format"], "pipe") && same(self.key, "header-rows") && test(K147, self.value)))) return
  context.report("table-attribute-invalid", num(self.start), num(self.end), path, { "key": String(self.key) }, 0)
  return
}

function rule80(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && K148.has(self.key) && !Boolean(self.kept) && Boolean(self.last_key) && (num(self.entries) < num(self.owner?.["columns"])))) return
  context.report("table-column-arity", num(self.start), num(self.key_end), path, { "key": String(self.key), "count": String(self.entries), "widest": String(self.owner?.["columns"]) }, 0)
  return
}

function rule81(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && K149.has(self.key) && Boolean(self.last_key))) return
  const one = (): void => {
    context.report("table-column-overlap", num(self.start), num(self.key_end), path, { "n": String(str((same(self.key, "aligns") ? self.owner?.["align_overlap"] : (same(self.key, "valigns") ? self.owner?.["valign_overlap"] : ""))).slice(num(group("n", 0)), num(group("n", 1)))) }, 0)
    return
  }
  const text = (same(self.key, "aligns") ? self.owner?.["align_overlap"] : (same(self.key, "valigns") ? self.owner?.["valign_overlap"] : ""))
  if (text === '') return
  for (const found of matchAll(K150, text)) {
    groups = spansOf(found)
    base = 0
    one()
  }
}

function rule82(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(hit(K151, K152, self.text) && mark(num(self.start)))) return
  context.report("table-marker-run-padding", num(group("block", 0)), num(group("marker", 1)), path, { "spelling": String((str(self.text).slice((num(group("block", 0)) - num(self.start)), (num(group("block", 1)) - num(self.start))) + str(self.text).slice((num(group("marker", 0)) - num(self.start)), (num(group("marker", 1)) - num(self.start))))), "marker": String(str(self.text).slice((num(group("marker", 0)) - num(self.start)), (num(group("marker", 1)) - num(self.start)))), "block": String(str(self.text).slice((num(group("block", 0)) - num(self.start)), (num(group("block", 1)) - num(self.start)))), "correctedPrefix": String(("{" + str(self.text).slice((num(group("marker", 0)) - num(self.start)), (num(group("marker", 1)) - num(self.start))) + " " + str(self.text).slice(((num(group("block", 0)) - num(self.start)) + 1), ((num(group("block", 1)) - num(self.start)) - 1)) + "}")) }, 0)
  return
}

function rule83(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && !(at(self.node, "children", -1, "attrs") !== undefined) && test(K153, self.text))) return
  context.report("table-row-attribute-as-cell", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule84(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_head_start: unknown = UNSET
  let v_head_cells: unknown = UNSET
  if (!(K155.has(self.parent?.["type"]) && !same((v_head_start === UNSET ? (v_head_start = aside(() => at(lookupAt(18, "block", K154, (item: unknown): unknown => (K155.has(at(item, "parent", "type")) ? at(item, "ancestor_ids", 1) : ""), self.ancestor_ids?.[1], self.start, 0), "start"))) : v_head_start), self.start) && !same(lenOf(at(self.node, "children")), lenOf((v_head_cells === UNSET ? (v_head_cells = aside(() => at(lookupAt(18, "block", K154, (item: unknown): unknown => (K155.has(at(item, "parent", "type")) ? at(item, "ancestor_ids", 1) : ""), self.ancestor_ids?.[1], self.start, 0), "node", "children"))) : v_head_cells))))) return
  if ((!(at(self.node, "pos") !== undefined) && (hit(K156, K157, self.last_line?.["body"]) && mark(num(self.last_line?.["body_start"]))))) {
    context.report("table-row-cell-count", num(group("plus", 0)), num(self.end), path, { "cells": String(lenOf(at(self.node, "children"))), "width": String(lenOf((v_head_cells === UNSET ? (v_head_cells = aside(() => at(lookupAt(18, "block", K154, (item: unknown): unknown => (K155.has(at(item, "parent", "type")) ? at(item, "ancestor_ids", 1) : ""), self.ancestor_ids?.[1], self.start, 0), "node", "children"))) : v_head_cells))) }, 0)
    return
  }
  context.report("table-row-cell-count", num(self.start), num(self.end), path, { "cells": String(lenOf(at(self.node, "children"))), "width": String(lenOf((v_head_cells === UNSET ? (v_head_cells = aside(() => at(lookupAt(18, "block", K154, (item: unknown): unknown => (K155.has(at(item, "parent", "type")) ? at(item, "ancestor_ids", 1) : ""), self.ancestor_ids?.[1], self.start, 0), "node", "children"))) : v_head_cells))) }, 0)
  return
}

function rule85(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  let v_below: unknown = UNSET
  let v_all_rows: unknown = UNSET
  let v_count: unknown = UNSET
  if (!(same(self.kind, "key") && Boolean(self.last_key) && test(K147, self.value) && ((same(self.key, "footer-rows") && (num((v_count === UNSET ? (v_count = aside(() => (same(lenOf(self.value), 0) ? "1" : self.value))) : v_count)) > num((v_below === UNSET ? (v_below = aside(() => (num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"])))) : v_below)))) || (same(self.key, "header-rows") && !same(self.owner?.["format"], "pipe") && (num((v_count === UNSET ? (v_count = aside(() => (same(lenOf(self.value), 0) ? "1" : self.value))) : v_count)) > num((v_all_rows === UNSET ? (v_all_rows = aside(() => (num(self.owner?.["head_rows"]) + num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"])))) : v_all_rows))))))) return
  if (same(self.key, "footer-rows")) {
    context.report("table-row-count-clamped", num(self.start), num(self.end), path, { "key": String(self.key), "count": String((v_count === UNSET ? (v_count = aside(() => (same(lenOf(self.value), 0) ? "1" : self.value))) : v_count)), "effective": String((v_below === UNSET ? (v_below = aside(() => (num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"])))) : v_below)) }, 0)
    return
  }
  context.report("table-row-count-clamped", num(self.start), num(self.end), path, { "key": String(self.key), "count": String((v_count === UNSET ? (v_count = aside(() => (same(lenOf(self.value), 0) ? "1" : self.value))) : v_count)), "effective": String((v_all_rows === UNSET ? (v_all_rows = aside(() => (num(self.owner?.["head_rows"]) + num(self.owner?.["body_rows"]) + num(self.owner?.["foot_rows"])))) : v_all_rows)) }, 0)
  return
}

function rule86(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && starts(self.body, "|") && !same(self.body, "|") && !test(K158, self.body))) return
  context.report("table-shaped-paragraph", num(self.body_start), num(self.body_end), path, { "owner": String((same(self.leaf, "definition_term") ? "term" : (same(self.leaf, "line") ? "line-block line" : self.leaf))) }, 0)
  return
}

function rule87(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && (at(self.node, "span") !== undefined))) return
  if ((starts(self.text, "{") || starts(self.text, "={"))) {
    context.report("table-span-marker-attribute", num(self.start), num(self.end), path, { "marker": String((same(at(self.node, "span"), "rowspan") ? "^" : "<")), "direction": String((same(at(self.node, "span"), "rowspan") ? "above it" : "to its left")) }, 0)
    return
  }
  if ((starts(self.text, "=") && !same(self.group, "table_head"))) {
    context.report("table-span-marker-attribute", num(self.start), num(self.end), path, { "marker": String((same(at(self.node, "span"), "rowspan") ? "^" : "<")), "direction": String((same(at(self.node, "span"), "rowspan") ? "above it" : "to its left")) }, 1)
    return
  }
}

function rule88(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.source_format, "pipe") && !(at(self.node, "span") !== undefined) && same(at(self.node, "children", 0, "type"), "cell_paragraph") && same(countFrom(at(self.node, "children", 0, "children"), 0, () => true), 1) && same(at(self.node, "children", 0, "children", 0, "type"), "text") && K159.has(at(self.node, "children", 0, "children", 0, "value")) && !test(K160, self.text))) return
  if ((same(at(self.node, "children", 0, "children", 0, "value"), "<") && same(self.index, 0))) {
    context.report("table-span-marker-blocked", num(self.start), num(self.end), path, {  }, 0)
    return
  }
  if (same(at(self.node, "children", 0, "children", 0, "value"), "<")) {
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

function rule89(self: ModelAttribute, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.kind, "key") && same(self.key, "widths") && Boolean(self.last_key) && !Boolean(self.kept) && (num(self.entry_total) > 100))) return
  context.report("table-width-total", num(self.start), num(self.key_end), path, {  }, 0)
  return
}

function rule90(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K161, self.body) && !(starts(self.body, "-") && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"])) && !(same(self.number, 1) && same(self.body_start, self.start) && same(self.body, "---")))) return
  context.report("thematic-break-spelling", num(self.body_start), num(self.body_end), path, { "raw": String(self.body) }, 0)
  return
}

function rule91(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(at(self.node, "spacing"), "tight") && (num(at(lookupAt(20, "block", undefined, (item: unknown): unknown => ((same(at(item, "parent", "type"), "list_item") && (num(at(item, "layout", "blankLinesAfter")) > 0) && (num(at(lookupAt(19, "block", undefined, (item: unknown): unknown => (!K162.has(at(item, "type")) ? at(item, "ancestor_ids", 0) : false), at(item, "ancestor_ids", 0), num(at(item, "start")), 1), "start")) >= 0) && someFrom(at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), at(item, "ancestor_ids", 0), self.start, 0), "node", "children"), 0, (item) => same(at(item, "type"), "paragraph"))) ? at(item, "ancestor_ids", 1) : false), self.identity, self.start, 0), "start")) >= 0))) return
  context.report("tight-list-item-with-blank-line", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule92(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && Boolean(self.leaf_first) && same(self.shape, "attribute_line") && !Boolean(self.attached_here) && (!(self.leaf_next !== undefined) || Boolean(self.leaf_next?.["blank"]) || Boolean(self.leaf_next?.["closes_container"]) || !same(self.leaf_next?.["leaf_id"], self.leaf_id)))) return
  if ((Boolean(self.leaf_next?.["blank"]) && (num(self.leaf_next?.["quote_marks"]) >= num(self.quote_depth)))) {
    context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule93(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K7.has(self.leaf) && starts(self.body, "^ ") && !contains(self.ancestors, "caption") && !((self.prev !== undefined) && !K7.has(self.prev?.["leaf"]) && test(K163, self.prev?.["raw_body"]) && test(K81, str(self.prev?.["text"]).slice(0, (num(self.prev?.["body_start"]) - num(self.prev?.["start"])))) && !test(K164, self.text)))) return
  context.report("unattached-caption", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule94(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_previous: unknown = UNSET
  let v_outer: unknown = UNSET
  let v_footnote: unknown = UNSET
  let v_kind: unknown = UNSET
  let v_first_marker: unknown = UNSET
  let v_first_content: unknown = UNSET
  if (!((num(self.index) >= 1) && (num(self.layout?.["markerColumn"]) < num((v_previous === UNSET ? (v_previous = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, -1), "layout", "markerColumn"))) : v_previous))) && (num((v_previous === UNSET ? (v_previous = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, -1), "layout", "markerColumn"))) : v_previous)) > num((v_footnote === UNSET ? (v_footnote = aside(() => (contains(self.ancestors, "footnote") ? at(lookupAt(21, "block", K94, undefined, undefined, self.start, -1), "layout", "contentColumn") : 0))) : v_footnote))) && (!(num((v_outer === UNSET ? (v_outer = aside(() => at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[1], self.start, 0), "layout", "markerColumn"))) : v_outer)) >= 0) || (num(self.layout?.["markerColumn"]) <= num((v_outer === UNSET ? (v_outer = aside(() => at(lookupAt(14, "block", K129, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[1], self.start, 0), "layout", "markerColumn"))) : v_outer)))) && !((num(self.index) >= 1) && same((v_kind === UNSET ? (v_kind = aside(() => at(lookupAt(15, "block", K130, (item: unknown): unknown => at(item, "identity"), self.ancestor_ids?.[0], self.start, 0), "node", "marker", "kind"))) : v_kind), "ordered") && (num((v_first_marker === UNSET ? (v_first_marker = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 0), "layout", "markerColumn"))) : v_first_marker)) > num(self.layout?.["markerColumn"])) && same((v_first_content === UNSET ? (v_first_content = aside(() => at(lookupAt(13, "block", K129, (item: unknown): unknown => at(item, "ancestor_ids", 0), self.ancestor_ids?.[0], self.start, 0), "layout", "contentColumn"))) : v_first_content), self.layout?.["contentColumn"])))) return
  context.report("uneven-list-indent", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule95(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!!(at(self.node, "number") !== undefined)) return
  context.report("unresolved-footnote", num(self.start), num(self.end), path, { "id": String(at(self.node, "key")) }, 0)
  return
}

function rule96(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  let v_labels: unknown = UNSET
  let v_ids: unknown = UNSET
  let v_label: unknown = UNSET
  let v_id: unknown = UNSET
  let v_case_only: unknown = UNSET
  if (!((at(self.node, "key") !== undefined) && ((same(self.type, "link") && !(at(self.node, "href") !== undefined)) || (same(self.type, "image") && !(at(self.node, "src") !== undefined))))) return
  if ((same(self.type, "link") && (lenOf((v_case_only === UNSET ? (v_case_only = aside(() => ((lenOf((v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label)) >= 1) ? (v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id)) >= 1)) ? (v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id) : "")))) : v_case_only)) >= 1))) {
    context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String(("the label " + str((v_case_only === UNSET ? (v_case_only = aside(() => ((lenOf((v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label)) >= 1) ? (v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id)) >= 1)) ? (v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id) : "")))) : v_case_only)) + " differs only in case")) }, 0)
    return
  }
  if (same(self.type, "link")) {
    context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String(("the label " + str((v_case_only === UNSET ? (v_case_only = aside(() => ((lenOf((v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label)) >= 1) ? (v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id)) >= 1)) ? (v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id) : "")))) : v_case_only)) + " differs only in case")) }, 1)
    return
  }
  if ((lenOf((v_case_only === UNSET ? (v_case_only = aside(() => ((lenOf((v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label)) >= 1) ? (v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id)) >= 1)) ? (v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id) : "")))) : v_case_only)) >= 1)) {
    context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String(("the label " + str((v_case_only === UNSET ? (v_case_only = aside(() => ((lenOf((v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label)) >= 1) ? (v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id)) >= 1)) ? (v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id) : "")))) : v_case_only)) + " differs only in case")) }, 2)
    return
  }
  context.report("unresolved-reference-link", num(self.start), num(self.end), path, { "rawRef": String(self.raw_ref), "caseOnlyPhrase": String(("the label " + str((v_case_only === UNSET ? (v_case_only = aside(() => ((lenOf((v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label)) >= 1) ? (v_label === UNSET ? (v_label = aside(() => findIn((v_labels === UNSET ? (v_labels = aside(() => lookupAll(22, "block", K79, (item: unknown): unknown => str(at(item, "node", "key")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "node", "key")))) : v_labels), (item) => !same(at(item), at(self.node, "key"))))) : v_label) : ((same(self.type, "link") && (lenOf((v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id)) >= 1)) ? (v_id === UNSET ? (v_id = aside(() => findIn((v_ids === UNSET ? (v_ids = aside(() => lookupAll(3, "id", K30, (item: unknown): unknown => str(at(item, "id")).toLowerCase(), str(at(self.node, "key")).toLowerCase()).map((record) => at(record, "id")))) : v_ids), (item) => !same(at(item), at(self.node, "key"))))) : v_id) : "")))) : v_case_only)) + " differs only in case")) }, 3)
  return
}

function rule97(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_at: unknown = UNSET
  if (!(!(num(at(lookupAt(23, "inline", K165, (item: unknown): unknown => at(item, "node", "key"), at(self.node, "key"), self.start, 0), "start")) >= 0) && (num((v_at === UNSET ? (v_at = aside(() => indexOf(self.text, ("[^" + str(at(self.node, "key")) + "]")))) : v_at)) >= 0))) return
  context.report("unused-footnote-definition", (num(self.start) + num((v_at === UNSET ? (v_at = aside(() => indexOf(self.text, ("[^" + str(at(self.node, "key")) + "]")))) : v_at))), (num(self.start) + num((v_at === UNSET ? (v_at = aside(() => indexOf(self.text, ("[^" + str(at(self.node, "key")) + "]")))) : v_at)) + lenOf(("[^" + str(at(self.node, "key")) + "]"))), path, { "label": String(at(self.node, "key")) }, 0)
  return
}

function rule98(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!!(num(at(lookupAt(24, "inline", K166, (item: unknown): unknown => at(item, "node", "key"), at(self.node, "key"), self.start, 0), "start")) >= 0)) return
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
  { id: "block-opener-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","paragraph"]), needs: {"block":[],"inline":[]}, run: rule5 },
  { id: "blockquote-marker-without-space", over: "line", types: undefined, verbatim: new Set(["frontmatter"]), only: undefined, needs: {"block":[],"inline":[]}, run: rule6 },
  { id: "braced-comment-in-a-template-source", over: "inline", types: ["comment"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule7 },
  { id: "broken-crossref", over: "inline", types: ["xref"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule8 },
  { id: "broken-fragment-link", over: "inline", types: ["link"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule9 },
  { id: "caption-looking-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":[],"inline":[]}, run: rule10 },
  { id: "colon-fence-length-mismatch", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule11 },
  { id: "comment-fence-closer-with-text", over: "line", types: undefined, verbatim: new Set(["comment_block"]), only: new Set(["comment_block"]), needs: {"block":[],"inline":[]}, run: rule12 },
  { id: "comment-line-in-line-block", over: "block", types: ["line"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule13 },
  { id: "comment-shaped-emphasis", over: "inline", types: ["emphasis","strong"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule14 },
  { id: "comment-splits-table-row", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule15 },
  { id: "consumed-key-near-miss", over: "attribute", types: ["code_block"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule16 },
  { id: "definition-in-container", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule17 },
  { id: "definition-term-block-folded", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term"]), needs: {"block":[],"inline":[]}, run: rule18 },
  { id: "delimited-table-wide-row", over: "block", types: ["table"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule19 },
  { id: "deprecated-bare-highlight", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule20 },
  { id: "deprecated-bare-strike", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule21 },
  { id: "deprecated-bare-underline", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule22 },
  { id: "deprecated-cell-alignment", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule23 },
  { id: "deprecated-continuation-marker", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule24 },
  { id: "deprecated-loose-attribute", over: "block", types: ["list"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule25 },
  { id: "deprecated-separator-row", over: "block", types: ["table_row"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule26 },
  { id: "deprecated-spaced-thematic-break", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule27 },
  { id: "deprecated-table-attribute", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule28 },
  { id: "description-separator-below-content-column", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":["definition_description","definition_list"],"inline":[]}, run: rule29 },
  { id: "description-term-multi-line", over: "block", types: ["definition_term"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule30 },
  { id: "djot-emphasis-underscore", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule31 },
  { id: "djot-heading-continuation", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule32 },
  { id: "djot-highlight-braces", over: "inline", types: ["highlight"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule33 },
  { id: "djot-plus-bullet", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":[],"inline":[]}, run: rule34 },
  { id: "djot-subscript-tilde", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule35 },
  { id: "djot-subscript-tilde-braced", over: "inline", types: ["strike"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule36 },
  { id: "djot-superscript-caret", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule37 },
  { id: "duplicate-reference-url", over: "block", types: ["link_reference_definition"], verbatim: new Set([]), only: undefined, needs: {"block":["link_reference_definition"],"inline":[]}, run: rule38 },
  { id: "emphasis-as-heading", over: "block", types: ["paragraph"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule39 },
  { id: "empty-include-path", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule40 },
  { id: "empty-link-destination", over: "inline", types: ["link"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule41 },
  { id: "empty-reference-definition", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule42 },
  { id: "fence-closer-indented", over: "block", types: ["code_block"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule43 },
  { id: "figure-group-empty", over: "block", types: ["figure_group"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule44 },
  { id: "figure-group-nested", over: "block", types: ["div"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule45 },
  { id: "figure-group-opener-metadata", over: "block", types: ["div"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule46 },
  { id: "figure-group-single-panel", over: "block", types: ["figure_group"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule47 },
  { id: "footnote-labels-differ-only-in-whitespace", over: "block", types: ["footnote"], verbatim: new Set([]), only: undefined, needs: {"block":["footnote"],"inline":[]}, run: rule48 },
  { id: "footnotes-placement-in-container", over: "block", types: ["directive"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule49 },
  { id: "frontmatter-shaped-thematic-break", over: "block", types: ["frontmatter"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule50 },
  { id: "github-alert-marker", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["heading","paragraph","table_cell","table_row"]), needs: {"block":[],"inline":[]}, run: rule51 },
  { id: "glob-shaped-strong", over: "inline", types: ["strong"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule52 },
  { id: "heading-closing-hashes", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule53 },
  { id: "heading-level-skip", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":["heading"],"inline":[]}, run: rule54 },
  { id: "heading-marker-mixed", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":["heading"],"inline":[]}, run: rule55 },
  { id: "heading-trailing-attribute", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule56 },
  { id: "html-comment-renders-as-text", over: "block", types: ["caption","paragraph"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule57 },
  { id: "html-comment-renders-as-text", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule58 },
  { id: "include-attributes-unused", over: "block", types: ["include"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule59 },
  { id: "include-lines-table-rows-hint", over: "block", types: ["include"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule60 },
  { id: "indented-code-block", over: "block", types: ["paragraph"], verbatim: new Set([]), only: new Set(["document"]), needs: {"block":[],"inline":[]}, run: rule61 },
  { id: "link-gap-before-destination", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule62 },
  { id: "list-item-block-overindented", over: "block", types: undefined, verbatim: new Set([]), only: new Set(["admonition","directive","div","figure_group","list_item"]), needs: {"block":[],"inline":[]}, run: rule63 },
  { id: "list-item-body-below-content-column", over: "block", types: undefined, verbatim: new Set([]), only: new Set(["list_item"]), needs: {"block":[],"inline":[]}, run: rule64 },
  { id: "list-marker-below-content-column", over: "block", types: ["list_item"], verbatim: new Set([]), only: undefined, needs: {"block":["list","list_item"],"inline":[]}, run: rule65 },
  { id: "list-marker-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term","paragraph"]), needs: {"block":[],"inline":[]}, run: rule66 },
  { id: "markdown-definition-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":["definition_description","definition_list"],"inline":[]}, run: rule67 },
  { id: "markdown-strikethrough-double-tilde", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule68 },
  { id: "markdown-strong-double-star", over: "inline", types: ["text_run"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule69 },
  { id: "ordered-list-kind-split", over: "block", types: ["list"], verbatim: new Set([]), only: new Set(["admonition","block_quote","div","document","footnote","list_item"]), needs: {"block":["list"],"inline":[]}, run: rule70 },
  { id: "ordered-marker-right-aligned", over: "block", types: ["list_item"], verbatim: new Set([]), only: undefined, needs: {"block":["list","list_item"],"inline":[]}, run: rule71 },
  { id: "quote-fence-ends-the-quote-above", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule72 },
  { id: "region-marker-renders-as-text", over: "block", types: ["comment"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule73 },
  { id: "region-marker-renders-as-text", over: "inline", types: ["comment"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule74 },
  { id: "region-marker-renders-as-text", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule75 },
  { id: "semantic-attribute-outside-span", over: "attribute", types: undefined, verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule76 },
  { id: "semantic-attribute-value-ignored", over: "attribute", types: ["span"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule77 },
  { id: "setext-heading-underline", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule78 },
  { id: "table-attribute-invalid", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule79 },
  { id: "table-column-arity", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule80 },
  { id: "table-column-overlap", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule81 },
  { id: "table-marker-run-padding", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule82 },
  { id: "table-row-attribute-as-cell", over: "block", types: ["table_row"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule83 },
  { id: "table-row-cell-count", over: "block", types: ["table_row"], verbatim: new Set([]), only: new Set(["table_body","table_foot","table_head"]), needs: {"block":["table_row"],"inline":[]}, run: rule84 },
  { id: "table-row-count-clamped", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule85 },
  { id: "table-shaped-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule86 },
  { id: "table-span-marker-attribute", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule87 },
  { id: "table-span-marker-blocked", over: "block", types: ["table_cell"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule88 },
  { id: "table-width-total", over: "attribute", types: ["table"], verbatim: new Set([]), only: new Set(["key"]), needs: {"block":[],"inline":[]}, run: rule89 },
  { id: "thematic-break-spelling", over: "line", types: undefined, verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule90 },
  { id: "tight-list-item-with-blank-line", over: "block", types: ["list"], verbatim: new Set([]), only: undefined, needs: {"block":["*","list_item"],"inline":[]}, run: rule91 },
  { id: "unattached-block-attribute", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), needs: {"block":[],"inline":[]}, run: rule92 },
  { id: "unattached-caption", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), needs: {"block":[],"inline":[]}, run: rule93 },
  { id: "uneven-list-indent", over: "block", types: ["list_item"], verbatim: new Set([]), only: undefined, needs: {"block":["footnote","list","list_item"],"inline":[]}, run: rule94 },
  { id: "unresolved-footnote", over: "inline", types: ["footnote_ref"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":[]}, run: rule95 },
  { id: "unresolved-reference-link", over: "inline", types: ["image","link"], verbatim: new Set([]), only: undefined, needs: {"block":["link_reference_definition"],"inline":[]}, run: rule96 },
  { id: "unused-footnote-definition", over: "block", types: ["footnote"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":["footnote_ref"]}, run: rule97 },
  { id: "unused-link-reference-definition", over: "block", types: ["link_reference_definition"], verbatim: new Set([]), only: undefined, needs: {"block":[],"inline":["image","link"]}, run: rule98 },
]
