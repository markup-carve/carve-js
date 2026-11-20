import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Expr = unknown
interface Report { when?: Expr, message?: number, start?: Expr, end?: Expr, values?: Record<string, Expr> }
interface DataRule {
  id: string
  over: 'line' | 'block' | 'inline'
  types?: readonly string[]
  verbatim?: readonly string[]
  let?: Record<string, Expr>
  each?: { matches?: Expr, pairs?: Expr }
  when?: Expr
  report: readonly Report[]
  range?: { start: Expr, end: Expr }
  values?: Record<string, Expr>
}
interface Model { text_leaves: string[], verbatim_leaves: string[], row_leaves: string[], rules: DataRule[] }

const NUMBER_OPS: ReadonlySet<string> = new Set(['len', 'add', 'sub', 'extend_left', 'skip_right', 'count', 'index_of'])
const TEXT_OPS: ReadonlySet<string> = new Set(['slice', 'concat', 'trim_end', 'words', 'text_from', 'json_escape'])

// C2-W-142: a pattern with a Unicode property class or a `\u{...}` escape reads code points.
const unicodeFlags = (source: string, flags: string): string => (/\\[pu]\{/.test(source) ? `${flags}u` : flags)

const operatorOf = (expr: Expr): [string, Expr, Record<string, Expr>] | undefined => {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) return undefined
  const node = expr as Record<string, Expr>
  const key = Object.keys(node)[0]
  return key === undefined ? undefined : [key, node[key], node]
}
const argsOf = (arg: Expr): Expr[] => (Array.isArray(arg) ? arg : [])
const literal = (value: unknown): string => (value === undefined ? 'undefined' : JSON.stringify(value))
const local = (name: string): string => `v_${name.replace(/\W/g, '_')}`

/** Compiles the expressions of one model into TypeScript, hoisting its patterns and sets. */
class Compiler {
  readonly hoisted: string[] = []
  /** The record kinds and types that the lookups of the rule being compiled read. */
  needs = { block: new Set<string>(), inline: new Set<string>() }
  private readonly lookupSites = new Map<string, number>()
  /** The compiled value of each `let` of the rule being compiled, read lazily where a rule names it. */
  lets = new Map<string, string>()
  private readonly sets: Record<string, readonly string[]>

  constructor(model: Model) {
    this.sets = { text_leaves: model.text_leaves, verbatim_leaves: model.verbatim_leaves, row_leaves: model.row_leaves }
  }

  private hoist(code: string): string {
    const found = this.hoisted.indexOf(code)
    if (found >= 0) return `K${found}`
    this.hoisted.push(code)
    return `K${this.hoisted.length - 1}`
  }

  field(path: string): string {
    const [head, ...rest] = path.split('.')
    const keys = rest.map((part) => literal(/^\d+$/.test(part) ? Number(part) : part))
    // A list item or an AST node has no static type here: its fields are read by name.
    if (head === 'item' || head === 'node') return `at(${head === 'item' ? 'item' : 'self.node'}${keys.map((key) => `, ${key}`).join('')})`
    return `self.${head}` + keys.map((key) => `?.[${key}]`).join('')
  }

  /** The source offset that index 0 of a text value stands at, for the spans of a `matches`. */
  hoistRegex(source: string, flags: string): string {
    return this.hoist(`new RegExp(${literal(source)}, ${literal(unicodeFlags(source, flags))})`)
  }

  // A let costs nothing until a condition reads it: most lines fail a cheaper test first.
  letValue(name: string): string {
    const code = this.lets.get(name)
    if (code === undefined) return local(name)
    return `(${local(name)} === UNSET ? (${local(name)} = aside(() => ${code})) : ${local(name)})`
  }

  base(expr: Expr): string {
    const operator = operatorOf(expr)
    if (operator?.[0] === 'f' && typeof operator[1] === 'string') {
      const path = operator[1]
      const split = path.lastIndexOf('.')
      const head = split < 0 ? '' : path.slice(0, split + 1)
      const last = split < 0 ? path : path.slice(split + 1)
      if (last === 'body' || last === 'raw_body') return `num(${this.field(`${head}body_start`)})`
      if (last === 'text') return `num(${this.field(`${head}start`)})`
      if (last === 'opener_text') return `num(${this.field(`${head}opener_start`)})`
    }
    if (operator?.[0] === 'text_from') return this.number(operator[1])
    return '0'
  }

  text(expr: Expr): string {
    if (typeof expr === 'string') return literal(expr)
    const operator = operatorOf(expr)
    return operator !== undefined && TEXT_OPS.has(operator[0]) ? this.value(expr) : `str(${this.value(expr)})`
  }

  number(expr: Expr): string {
    if (typeof expr === 'number') return literal(expr)
    const operator = operatorOf(expr)
    return operator !== undefined && NUMBER_OPS.has(operator[0]) ? this.value(expr) : `num(${this.value(expr)})`
  }

  value(expr: Expr): string {
    const operator = operatorOf(expr)
    if (operator === undefined) return literal(expr)
    const [name, arg, node] = operator
    const make = VALUES[name]
    return make === undefined ? this.test(expr) : make(this, arg, argsOf(arg), node)
  }

  matches(arg: Expr): string {
    const [subject, pattern, flags] = argsOf(arg)
    const source = String(pattern)
    const named = source.includes('(?<')
    const plain = typeof flags === 'string' ? flags : ''
    const regex = this.hoist(`new RegExp(${literal(source)}, ${literal(unicodeFlags(source, plain))})`)
    const value = this.value(subject)
    if (!named) return `test(${regex}, ${value})`
    // A plain test first: a pattern with indices is several times slower, and most lines do not match.
    const spans = this.hoist(`new RegExp(${literal(source)}, ${literal(unicodeFlags(source, `${plain}d`))})`)
    return `(hit(${regex}, ${spans}, ${value}) && mark(${this.base(subject)}))`
  }

  some(arg: Expr): string {
    const spec = arg as { in: string, from?: number, where: Expr }
    return `someFrom(${this.field(spec.in)}, ${spec.from ?? 0}, (item) => ${this.test(spec.where)})`
  }

  lookup(arg: Expr): string {
    const spec = arg as { over: 'block' | 'inline', types: string[], key?: Expr, value?: Expr, before?: boolean, after?: boolean, field: string }
    for (const type of spec.types) this.needs[spec.over].add(type)
    const types = this.hoist(`new Set<string>(${literal(spec.types)})`)
    const key = spec.key === undefined ? 'undefined' : `(item: unknown): unknown => ${this.value(spec.key)}`
    const value = spec.key === undefined ? 'undefined' : this.value(spec.value)
    // Lookups over the same records by the same key share one index.
    const signature = `${spec.over} ${types} ${key}`
    let site = this.lookupSites.get(signature)
    if (site === undefined) this.lookupSites.set(signature, site = this.lookupSites.size)
    const side = spec.before === true ? -1 : spec.after === true ? 1 : 0
    const found = `lookupAt(${site}, ${literal(spec.over)}, ${types}, ${key}, ${value}, self.start, ${side})`
    return `at(${found}${spec.field.split('.').map((part) => `, ${literal(/^\d+$/.test(part) ? Number(part) : part)}`).join('')})`
  }

  count(arg: Expr): string {
    const spec = arg as { in: string, from?: number, where: Expr }
    return `countFrom(${this.field(spec.in)}, ${spec.from ?? 0}, (item) => ${this.test(spec.where)})`
  }

  member(arg: Expr): string {
    const [subject, set] = argsOf(arg)
    const members = typeof set === 'string' ? this.sets[set] ?? [] : argsOf(set)
    return `${this.hoist(`new Set<unknown>(${literal(members)})`)}.has(${this.value(subject)})`
  }

  test(expr: Expr): string {
    if (typeof expr === 'boolean') return literal(expr)
    const operator = operatorOf(expr)
    if (operator === undefined) return 'false'
    const [name, arg, node] = operator
    const make = TESTS[name]
    if (make === undefined) throw new Error(`lint-model: unknown operator ${name}`)
    return make(this, arg, argsOf(arg), node)
  }
}

type Make = (c: Compiler, arg: Expr, args: Expr[], node: Record<string, Expr>) => string

const VALUES: Record<string, Make> = {
  f: (c, arg) => c.field(String(arg)),
  v: (c, arg) => c.letValue(String(arg)),
  len: (c, arg) => `lenOf(${c.value(arg)})`,
  add: (c, _arg, args) => `(${args.map((item) => c.number(item)).join(' + ')})`,
  sub: (c, _arg, args) => `(${c.number(args[0])} - ${c.number(args[1])})`,
  slice: (c, _arg, args) => `${c.text(args[0])}.slice(${args.slice(1).map((item) => c.number(item)).join(', ')})`,
  concat: (c, _arg, args) => `(${args.map((item) => c.text(item)).join(' + ')})`,
  trim_end: (c, arg) => `trimEnd(${c.text(arg)})`,
  words: (c, arg) => `${c.text(arg)}.replaceAll('_', ' ')`,
  if: (c, _arg, args) => `(${c.test(args[0])} ? ${c.value(args[1])} : ${c.value(args[2])})`,
  match: (_c, arg, _args, node) => `group(${literal(String(arg))}, ${node['at'] === 'end' ? 1 : 0})`,
  text_from: (c, arg) => `textFrom(line, ${c.number(arg)})`,
  count: (c, arg) => c.count(arg),
  lookup: (c, arg) => c.lookup(arg),
  index_of: (c, _arg, args) => `${c.text(args[0])}.indexOf(${c.text(args[1])})`,
  json_escape: (c, arg) => `JSON.stringify(${c.text(arg)}).slice(1, -1)`,
  extend_left: (c, _arg, args) => `scan(line, ${c.number(args[0])}, ${c.text(args[1])}, -1)`,
  skip_right: (c, _arg, args) => `scan(line, ${c.number(args[0])}, ${c.text(args[1])}, 1)`,
}

const compare = (operator: string): Make => (c, _arg, args) => `(${c.number(args[0])} ${operator} ${c.number(args[1])})`

const TESTS: Record<string, Make> = {
  all: (c, _arg, args) => `(${args.map((item) => c.test(item)).join(' && ') || 'true'})`,
  any: (c, _arg, args) => `(${args.map((item) => c.test(item)).join(' || ') || 'false'})`,
  not: (c, arg) => `!${c.test(arg)}`,
  has: (c, arg) => `(${c.field(String(arg))} !== undefined)`,
  eq: (c, _arg, args) => `same(${c.value(args[0])}, ${c.value(args[1])})`,
  ne: (c, _arg, args) => `!same(${c.value(args[0])}, ${c.value(args[1])})`,
  lt: compare('<'),
  le: compare('<='),
  gt: compare('>'),
  ge: compare('>='),
  in: (c, arg) => c.member(arg),
  contains: (c, _arg, args) => `contains(${c.value(args[0])}, ${c.value(args[1])})`,
  starts: (c, _arg, args) => `starts(${c.value(args[0])}, ${c.text(args[1])})`,
  matches: (c, arg) => c.matches(arg),
  some: (c, arg) => c.some(arg),
  f: (c, arg) => `Boolean(${c.field(String(arg))})`,
  v: (c, arg) => `Boolean(${c.letValue(String(arg))})`,
}

const SELF = { line: 'ModelLine', block: 'ModelBlock', inline: 'ModelInline' } as const

function reportLines(rule: DataRule, compiler: Compiler, indent: string): string[] {
  const body: string[] = []
  for (const report of rule.report) {
    const values = Object.entries({ ...rule.values, ...report.values })
      .map(([name, expr]) => `${literal(name)}: String(${compiler.value(expr)})`).join(', ')
    const call = `context.report(${literal(rule.id)}, ${compiler.number(report.start ?? rule.range?.start)}, `
      + `${compiler.number(report.end ?? rule.range?.end)}, path, { ${values} }, ${report.message ?? 0})`
    if (report.when === undefined) {
      body.push(`${indent}${call}`, `${indent}return`)
      break
    }
    body.push(`${indent}if (${compiler.test(report.when)}) {`, `${indent}  ${call}`, `${indent}  return`, `${indent}}`)
  }
  return body
}

function ruleFunction(rule: DataRule, index: number, compiler: Compiler): string {
  const body: string[] = ['  groups = undefined']
  compiler.needs = { block: new Set(), inline: new Set() }
  compiler.lets = new Map()
  for (const [name, expr] of Object.entries(rule.let ?? {})) {
    const code = compiler.value(expr)
    body.push(`  let ${local(name)}: unknown = UNSET`)
    compiler.lets.set(name, code)
  }
  if (rule.when !== undefined) body.push(`  if (!${compiler.test(rule.when)}) return`)
  if (rule.each === undefined) body.push(...reportLines(rule, compiler, '  '))
  else if (rule.each.pairs !== undefined) {
    const [subject, mark, mode] = argsOf(rule.each.pairs)
    body.push(`  const one = (): void => {`, ...reportLines(rule, compiler, '    '), '  }',
      `  for (const found of pairsOf(${compiler.value(subject)}, ${literal(String(mark))}, ${mode === 'strict'})) {`,
      '    groups = found', `    base = ${compiler.base(subject)}`, '    one()', '  }')
  } else {
    const [subject, pattern] = argsOf(rule.each.matches)
    const regex = compiler.hoistRegex(String(pattern), 'gd')
    body.push(`  const one = (): void => {`, ...reportLines(rule, compiler, '    '), '  }',
      `  for (const found of matchAll(${regex}, ${compiler.value(subject)})) {`,
      '    groups = spansOf(found)', `    base = ${compiler.base(subject)}`, '    one()', '  }')
  }
  if (body.some((code) => /[(\s]line[,)]/.test(code))) {
    if (rule.over === 'inline') throw new Error(`lint-model: ${rule.id} reads a line offset over inline records`)
    body.unshift(`  const line = ${rule.over === 'block' ? 'self.line' : 'self'}`)
  }
  return [`function rule${index}(self: ${SELF[rule.over]}, path: string, context: LintContext): void {`, ...body, '}'].join('\n')
}

const PRELUDE = `import { type RuleId } from './catalog.ts'
import { type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
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
const trimEnd = (text: string): string => text.replace(/[ \\t]+$/, '')
const test = (regex: RegExp, value: unknown): boolean => typeof value === 'string' && regex.test(value)
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

let lastRegex: RegExp | undefined
let lastValue = ''
let lastSpans: Record<string, [number, number]> | undefined

// The lines of one leaf often test the same text against the same pattern, as a block's opener line.
function hit(regex: RegExp, spans: RegExp, value: unknown): boolean {
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

const matchAll = (regex: RegExp, value: unknown): RegExpStringIterator<RegExpExecArray> | [] =>
  (typeof value === 'string' ? value.matchAll(regex) : [])

const PAIR_SPACE = /[\\p{Zs}\\t\\n\\r]/u

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

const JOINED = /^[\\p{M}\\u200D\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}]/u
const EDGE = /^[\\p{Zs}\\t\\n\\r\\f\\v]$/u
const WORD = /^[\\p{L}\\p{N}]$/u

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

let lookupRecords: { block: readonly Located[], inline: readonly Located[] } = { block: [], inline: [] }
let lookupSites = new Map<number, Map<unknown, Located[]>>()

/** The records of one document that the lookups read, in document order. */
export function useRecords(block: readonly Located[], inline: readonly Located[]): void {
  lookupRecords = { block, inline }
  lookupSites = new Map()
}

// C2-W-141: the first record of the types whose key equals the value, the last one that starts before the record
// (side -1) or the first one that starts after it (side 1).
function lookupAt(site: number, over: 'block' | 'inline', types: ReadonlySet<string>, key: ((item: unknown) => unknown) | undefined,
  value: unknown, start: number, side: -1 | 0 | 1): Located | undefined {
  let index = lookupSites.get(site)
  if (index === undefined) {
    index = new Map()
    for (const record of lookupRecords[over]) {
      if (!types.has((record as { type?: string }).type ?? '')) continue
      const found = key === undefined ? undefined : key(record)
      const list = index.get(found)
      if (list === undefined) index.set(found, [record])
      else list.push(record)
    }
    lookupSites.set(site, index)
  }
  const list = index.get(value)
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

const lenOf = (value: unknown): number => (typeof value === 'string' || Array.isArray(value) ? value.length : 0)

function at(value: unknown, ...keys: (string | number)[]): unknown {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
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
`

/**
 * The values that `when` admits for one field, where every match needs one of them: an `eq` or `in` on the field,
 * a conjunct of `all`, or every branch of `any`. The runner skips a rule on a record whose field has another value.
 */
function admitted(expr: Expr, field: string, sets: Record<string, readonly string[]>): readonly string[] | undefined {
  const operator = operatorOf(expr)
  if (operator === undefined) return undefined
  const [name, arg] = operator
  const args = argsOf(arg)
  if (name === 'eq' || name === 'in') return fieldValues(name, args, field, sets)
  if (name === 'all') return args.map((item) => admitted(item, field, sets)).find((found) => found !== undefined)
  if (name !== 'any' || args.length === 0) return undefined
  const branches = args.map((item) => admitted(item, field, sets))
  return branches.every((found) => found !== undefined) ? [...new Set(branches.flat())] : undefined
}

function fieldValues(name: string, args: Expr[], field: string, sets: Record<string, readonly string[]>): readonly string[] | undefined {
  const read = operatorOf(args[0])
  if (read?.[0] !== 'f' || read[1] !== field) return undefined
  if (name === 'eq') return typeof args[1] === 'string' ? [args[1]] : undefined
  const list = typeof args[1] === 'string' ? sets[args[1]] : args[1]
  return Array.isArray(list) && list.every((item) => typeof item === 'string') ? list as string[] : undefined
}

/** The rules of data/lint-model.json compiled to TypeScript, one function per rule. */
export function generateDataTables(json: string): string {
  const model = JSON.parse(json) as Model
  const compiler = new Compiler(model)
  const sets = { text_leaves: model.text_leaves, verbatim_leaves: model.verbatim_leaves, row_leaves: model.row_leaves }
  const needs: { block: string[], inline: string[] }[] = []
  const functions = model.rules.map((rule, index) => {
    const code = ruleFunction(rule, index, compiler)
    needs.push({ block: [...compiler.needs.block].sort(), inline: [...compiler.needs.inline].sort() })
    return code
  })
  const entries = model.rules.map((rule, index) => {
    const types = rule.types === undefined ? 'undefined' : literal(rule.types)
    const field = rule.over === 'line' ? 'leaf' : rule.over === 'block' ? 'parent.type' : 'parent'
    const only = rule.when === undefined ? undefined : admitted(rule.when, field, sets)
    return `  { id: ${literal(rule.id)}, over: ${literal(rule.over)}, types: ${types}, verbatim: new Set(${literal(rule.verbatim ?? [])}), `
      + `only: ${only === undefined ? 'undefined' : `new Set(${literal([...only].sort())})`}, needs: ${literal(needs[index])}, run: rule${index} },`
  })
  return ['// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.', PRELUDE,
    ...compiler.hoisted.map((code, index) => `const K${index} = ${code}`), '', ...functions.flatMap((code) => [code, '']),
    '/**',
    ' * `only`: the leaf of a line, the parent type of a block or the parent of an inline record that the rule can match.',
    ' * `needs`: the block and inline types whose records the lookups of the rule read.',
    ' */',
    'interface Needs { readonly block: readonly string[], readonly inline: readonly string[] }',
    'export type DataRule =',
    '  | { id: RuleId, over: \'line\', types: undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, needs: Needs, '
      + 'run: (self: ModelLine, path: string, context: LintContext) => void }',
    '  | { id: RuleId, over: \'block\', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, '
      + 'needs: Needs, run: (self: ModelBlock, path: string, context: LintContext) => void }',
    '  | { id: RuleId, over: \'inline\', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, '
      + 'needs: Needs, run: (self: ModelInline, path: string, context: LintContext) => void }',
    '',
    `export const VERBATIM_LEAVES: ReadonlySet<string> = new Set(${literal(model.verbatim_leaves)})`,
    '',
    'export const DATA_RULES: readonly DataRule[] = [', ...entries, ']', ''].join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  writeFileSync(join(import.meta.dirname, 'data-tables.ts'),
    generateDataTables(readFileSync(join(root, 'data/lint-model.json'), 'utf8')))
}
