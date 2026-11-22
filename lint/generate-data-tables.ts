import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasLinearMatcher } from './linear-patterns.ts'

type Expr = unknown
interface Report { when?: Expr, message?: number, start?: Expr, end?: Expr, values?: Record<string, Expr> }
interface DataRule {
  id: string
  over: 'line' | 'block' | 'inline' | 'attribute'
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

const NUMBER_OPS: ReadonlySet<string> = new Set(['len', 'add', 'sub', 'extend_left', 'skip_right', 'count', 'index_of', 'column'])
const TEXT_OPS: ReadonlySet<string> = new Set(['slice', 'concat', 'trim_end', 'words', 'text_from', 'json_escape', 'lower', 'join',
  'percent_decode', 'nfc', 'fold', 'fold_space', 'quoted_list', 'plain_list'])

// C2-W-142: a pattern with a Unicode property class or a `\u{...}` escape reads code points.
const unicodeFlags = (source: string, flags: string): string => (/\\[pu]\{/.test(source) ? `${flags}u` : flags)

const operatorOf = (expr: Expr): [string, Expr, Record<string, Expr>] | undefined => {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) return undefined
  const node = expr as Record<string, Expr>
  const key = Object.keys(node)[0]
  return key === undefined ? undefined : [key, node[key], node]
}
const argsOf = (arg: Expr): Expr[] => (Array.isArray(arg) ? arg : [])
// Whether compiled code reads anything but the item of a lookup: the record being checked, its line, a let or the run.
const readsRecord = (code: string): boolean => /\b(?:self|line|context|v_\w+|path)\b/.test(code.replace(/"(?:[^"\\]|\\.)*"/g, '""'))
const literal = (value: unknown): string => (value === undefined ? 'undefined' : JSON.stringify(value))
const local = (name: string): string => `v_${name.replace(/\W/g, '_')}`
// The groups and base a let saves while it computes, so the condition that reads it keeps its own.
const kept = (name: string): [string, string] => [`g_${name.replace(/\W/g, '_')}`, `b_${name.replace(/\W/g, '_')}`]

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
    const keys = rest.map((part) => literal(/^-?\d+$/.test(part) ? Number(part) : part))
    // A list item or an AST node has no static type here: its fields are read by name. A negative index counts from the end.
    if (head === 'item' || head === 'node' || rest.some((part) => part.startsWith('-'))) {
      const from = head === 'item' ? 'item' : head === 'node' ? 'self.node' : `self.${head}`
      return this.at(from, keys)
    }
    // The node of an attribute record's owner is a tree node too (C2-W-148).
    const node = rest.indexOf('node') + 1
    if (node > 0 && node < rest.length) {
      return this.at(`self.${head}${keys.slice(0, node).map((key) => `?.[${key}]`).join('')}`, keys.slice(node))
    }
    return `self.${head}` + keys.map((key) => `?.[${key}]`).join('')
  }

  /** The source offset that index 0 of a text value stands at, for the spans of a `matches`. */
  hoistRegex(source: string, flags: string): string {
    // carve#6297: a pattern a backtracking engine runs in quadratic time gets the linear matcher of the same answers.
    if (hasLinearMatcher(source)) return this.hoist(`linearPattern(${literal(source)})`)
    return this.hoist(`new RegExp(${literal(source)}, ${literal(unicodeFlags(source, flags))})`)
  }

  // A let costs nothing until a condition reads it: most lines fail a cheaper test first.
  letValue(name: string): string {
    const code = this.lets.get(name)
    if (code === undefined) return local(name)
    const [keptGroups, keptBase] = kept(name)
    const value = local(name)
    return `(${value} === UNSET ? (${keptGroups} = groups, ${keptBase} = base, ${value} = (${code}), groups = ${keptGroups}, base = ${keptBase}, ${value}) : ${value})`
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
    const regex = this.hoistRegex(source, plain)
    const value = this.value(subject)
    if (!named) return `test(${regex}, ${value})`
    // A plain test first: a pattern with indices is several times slower, and most lines do not match.
    const spans = this.hoistRegex(source, `${plain}d`)
    return `(hit(${regex}, ${spans}, ${value}) && mark(${this.base(subject)}))`
  }

  some(arg: Expr): string {
    const spec = arg as { in: Expr, from?: number, where: Expr }
    return `someFrom(${this.list(spec.in)}, ${spec.from ?? 0}, ${this.where(spec.where)})`
  }

  // A test that reads no item, as a count of all items, takes no parameter.
  where(expr: Expr): string {
    const code = this.test(expr)
    return /\bitem\b/.test(code) ? `(item) => ${code}` : `() => ${code}`
  }

  // The index is built once per document, so a key that reads only its item is one function, not one per call.
  lookupKey(expr: Expr | undefined): string {
    if (expr === undefined) return 'undefined'
    const key = `(item: unknown): unknown => ${this.value(expr)}`
    if (readsRecord(key)) throw new Error(`lint-model: a lookup key reads more than its item: ${JSON.stringify(expr)}`)
    return this.hoist(key)
  }

  /**
   * A key `if [test, key, false]` whose test also reads the record being checked: the conjuncts that read only the item
   * stay in the key of the shared index, the others filter the records the index finds for one value.
   */
  splitKey(expr: Expr | undefined): { key: Expr | undefined, filter: string } {
    const operator = operatorOf(expr)
    if (operator?.[0] !== 'if') return { key: expr, filter: 'undefined' }
    const [test, key, otherwise] = argsOf(operator[1])
    const tests = operatorOf(test)?.[0] === 'all' ? argsOf(operatorOf(test)![1]) : [test]
    const outside = tests.filter((item) => readsRecord(this.test(item)))
    if (outside.length === 0 || otherwise !== false) return { key: expr, filter: 'undefined' }
    const inside = tests.filter((item) => !outside.includes(item))
    const filter = `(item: unknown): boolean => ${this.test({ all: outside })}`
    return { key: inside.length === 0 ? key : { if: [{ all: inside }, key, false] }, filter }
  }

  lookup(arg: Expr): string {
    const spec = arg as { over: 'block' | 'inline' | 'id' | 'line', types?: string[], key?: Expr, value?: Expr, before?: boolean, after?: boolean,
      all?: boolean, from?: Expr, field?: string }
    const kinds = spec.over === 'id' ? ['id'] : spec.types
    // C2-W-150: a block lookup that names no types reads every block.
    if (spec.over === 'block' || spec.over === 'inline') for (const type of kinds ?? ['*']) this.needs[spec.over].add(type)
    const types = kinds === undefined ? 'undefined' : this.hoist(`new Set<string>(${literal(kinds)})`)
    const split = this.splitKey(spec.key)
    const key = this.lookupKey(split.key)
    const filter = split.filter
    const value = spec.key === undefined ? 'undefined' : this.value(spec.value)
    // Lookups over the same records by the same key share one index.
    const signature = `${spec.over} ${types} ${key}`
    let site = this.lookupSites.get(signature)
    if (site === undefined) this.lookupSites.set(signature, site = this.lookupSites.size)
    const keys = (spec.field ?? '').split('.').filter((part) => part !== '').map((part) => literal(/^-?\d+$/.test(part) ? Number(part) : part))
    if (spec.all === true) {
      return `lookupAll(${site}, ${literal(spec.over)}, ${types}, ${key}, ${value}, ${filter}).map((record) => ${this.at('record', keys)})`
    }
    const side = spec.before === true ? -1 : spec.after === true ? 1 : 0
    const from = spec.from === undefined ? 'self.start' : this.number(spec.from)
    return this.at(`lookupAt(${site}, ${literal(spec.over)}, ${types}, ${key}, ${value}, ${from}, ${side}, ${filter})`, keys)
  }

  // Each step of a path is its own property read, so each read site sees few node shapes; `obj` reads nothing from a
  // value that is no object, as `at` did, and a negative index counts from the end of a list.
  at(from: string, keys: readonly string[]): string {
    let code = from
    for (const key of keys) code = /^-\d+$/.test(key) ? `atEnd(${code}, ${key})` : `obj(${code})?.[${key}]`
    return code
  }

  // C2-W-150: the list of some or count is a field path, or a value.
  list(arg: Expr): string { return typeof arg === 'string' ? this.field(arg) : this.value(arg) }

  find(arg: Expr): string {
    const spec = arg as { in: Expr, where: Expr, field?: string }
    const keys = (spec.field ?? '').split('.').filter((part) => part !== '').map((part) => literal(/^-?\d+$/.test(part) ? Number(part) : part))
    return this.at(`findIn(${this.value(spec.in)}, (item) => ${this.test(spec.where)})`, keys)
  }

  count(arg: Expr): string {
    const spec = arg as { in: Expr, from?: number, where: Expr }
    return `countFrom(${this.list(spec.in)}, ${spec.from ?? 0}, ${this.where(spec.where)})`
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
  index_of: (c, _arg, args) => `indexOf(${c.value(args[0])}, ${c.value(args[1])})`,
  nth: (c, _arg, args) => `nthOf(${c.value(args[0])}, ${c.number(args[1])})`,
  column: (c, _arg, args) => `columnAt(context, ${c.number(args[0])}, ${c.number(args[1])})`,
  json_escape: (c, arg) => `JSON.stringify(${c.text(arg)}).slice(1, -1)`,
  lower: (c, arg) => `${c.text(arg)}.toLowerCase()`,
  join: (c, _arg, args) => `joinOf(${c.value(args[0])}, ${c.text(args[1])})`,
  nfc: (c, arg) => `${c.text(arg)}.normalize('NFC')`,
  fold: (c, arg) => `foldKey(${c.text(arg)})`,
  fold_space: (c, arg) => `foldLabel(${c.text(arg)})`,
  quoted_list: (c, arg) => `listOf(${c.value(arg)}, '"')`,
  plain_list: (c, arg) => `listOf(${c.value(arg)}, '')`,
  find: (c, arg) => c.find(arg),
  percent_decode: (c, arg) => `percentDecode(${c.text(arg)})`,
  run: (_c, arg) => `runValue(context, ${literal(String(arg))})`,
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
  attribute_line: (c, arg) => `isAttributeLine(${c.text(arg)}, 0, ${c.text(arg)}.length)`,
  some: (c, arg) => c.some(arg),
  f: (c, arg) => `Boolean(${c.field(String(arg))})`,
  v: (c, arg) => `Boolean(${c.letValue(String(arg))})`,
}

const SELF = { line: 'ModelLine', block: 'ModelBlock', inline: 'ModelInline', attribute: 'ModelAttribute' } as const

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
    body.push(`  let ${local(name)}: unknown = UNSET`, `  let ${kept(name)[0]}: Record<string, [number, number]> | undefined`, `  let ${kept(name)[1]} = 0`)
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
    // A pattern that cannot match an empty text finds nothing in one, so the scan is not started.
    const empty = new RegExp(String(pattern), unicodeFlags(String(pattern), '')).test('')
    body.push(`  const one = (): void => {`, ...reportLines(rule, compiler, '    '), '  }',
      `  const text = ${compiler.value(subject)}`, ...(empty ? [] : ['  if (text === \'\') return']),
      `  for (const found of matchAll(${regex}, text)) {`,
      '    groups = spansOf(found)', `    base = ${compiler.base(subject)}`, '    one()', '  }')
  }
  if (body.some((code) => /[(\s]line[,)]/.test(code))) {
    if (rule.over === 'inline' || rule.over === 'attribute') throw new Error(`lint-model: ${rule.id} reads a line offset over ${rule.over} records`)
    body.unshift(`  const line = ${rule.over === 'block' ? 'self.line' : 'self'}`)
  }
  return [`function rule${index}(self: ${SELF[rule.over]}, path: string, context: LintContext): void {`, ...body, '}'].join('\n')
}

const PRELUDE = `import { type RuleId } from './catalog.ts'
import { type ModelAttribute } from './data-attributes.ts'
import { isAttributeLine } from '../src/lines.ts'
import { foldLabel } from '../src/ast-attributes.ts'
import { foldKey } from '../src/case-fold.ts'
import { columnOf } from '../src/layout-lines.ts'
import { type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { linearPattern, type Pattern } from './linear-patterns.ts'
import { type LintContext } from './types.ts'

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
// Per kind of record, the positions of the records of each type, in document order.
let typePositions = new Map<Over, Map<string, number[]>>()

/** The records of one document that the lookups read, in document order; the line records are made when a lookup reads them. */
export function useRecords(block: readonly Located[], inline: readonly Located[], id: readonly Located[] = [],
  line: () => readonly Located[] = () => []): void {
  lookupRecords = { block, inline, id, line: [] }
  lineRecords = line
  lookupSites = new Map()
  typePositions = new Map()
}

function recordsOf(over: Over, types: ReadonlySet<string>): readonly Located[] {
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
  return positions.map((at) => records[at]!)
}

// C2-W-141: the first record of the types whose key equals the value, the last one that starts before the record
// (side -1) or the first one that starts after it (side 1).
function lookupIndex(site: number, over: Over, types: ReadonlySet<string> | undefined,
  key: ((item: unknown) => unknown) | undefined): Map<unknown, Located[]> {
  let index = lookupSites.get(site)
  if (index === undefined) {
    index = new Map()
    if (over === 'line' && lookupRecords.line.length === 0) lookupRecords.line = lineRecords()
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
  const list = filter === undefined ? found : found.filter(filter)
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
    const field = rule.over === 'line' ? 'leaf' : rule.over === 'block' ? 'parent.type' : rule.over === 'attribute' ? 'kind' : 'parent'
    const only = rule.when === undefined ? undefined : admitted(rule.when, field, sets)
    return `  { id: ${literal(rule.id)}, over: ${literal(rule.over)}, types: ${types}, verbatim: new Set(${literal(rule.verbatim ?? [])}), `
      + `only: ${only === undefined ? 'undefined' : `new Set(${literal([...only].sort())})`}, needs: ${literal(needs[index])}, run: rule${index} },`
  })
  // A value operator the model no longer uses leaves no helper behind.
  const used = functions.join('\n')
  const prelude = used.includes('joinOf(') ? PRELUDE : PRELUDE.replace(/^const joinOf = .*\n/m, '')
  return ['// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.', prelude,
    ...compiler.hoisted.map((code, index) => `const K${index} = ${code}`), '', ...functions.flatMap((code) => [code, '']),
    '/**',
    ' * `only`: the leaf of a line, the parent type of a block, the parent of an inline record or the kind of an attribute record',
    ' * that the rule can match.',
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
    '  | { id: RuleId, over: \'attribute\', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, '
      + 'needs: Needs, run: (self: ModelAttribute, path: string, context: LintContext) => void }',
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
