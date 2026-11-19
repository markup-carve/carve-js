import { type RuleId } from './catalog.ts'
import { buildModel, type ModelLine } from './data-model.ts'
import { LINT_MODEL } from './data-tables.ts'
import { type LintContext } from './types.ts'
import { type Node } from '../src/ast.ts'

type Expr = unknown
interface Report { when?: Expr, message?: number, start?: Expr, end?: Expr, values?: Record<string, Expr> }
interface DataRule {
  id: string
  over: 'line' | 'block'
  types?: readonly string[]
  verbatim?: readonly string[]
  let?: Record<string, Expr>
  when?: Expr
  report: readonly Report[]
  range?: { start: Expr, end: Expr }
  values?: Record<string, Expr>
}

const MODEL = LINT_MODEL as unknown as { text_leaves: string[], verbatim_leaves: string[], row_leaves: string[], rules: DataRule[] }
const SETS: Record<string, readonly string[]> = { text_leaves: MODEL.text_leaves, verbatim_leaves: MODEL.verbatim_leaves,
  row_leaves: MODEL.row_leaves }
const VERBATIM: ReadonlySet<string> = new Set(MODEL.verbatim_leaves)

/** The ids of the catalog rows that `data/lint-model.json` states as data. */
export const DATA_RULE_IDS: ReadonlySet<string> = new Set(MODEL.rules.map((rule) => rule.id))

/** The internal switch: run the data rules in place of the hand-written ones. */
export function dataRulesOn(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.['CARVE_LINT_RULES'] === 'data'
}

interface Env {
  self: Record<string, unknown>
  line: ModelLine | undefined
  vars: Record<string, unknown>
  item: unknown
  match: { groups: Record<string, [number, number]>, base: number } | undefined
}

type Value = (env: Env) => unknown
type Test = (env: Env) => boolean

const argsOf = (arg: Expr): Expr[] => (Array.isArray(arg) ? arg : [])
const operatorOf = (expr: Expr): [string, Expr, Record<string, Expr>] | undefined => {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) return undefined
  const node = expr as Record<string, Expr>
  const key = Object.keys(node)[0]
  return key === undefined ? undefined : [key, node[key], node]
}

function fieldOf(path: string): Value {
  const parts = path.split('.')
  const head = parts[0]!
  const rest = parts.slice(1)
  return (env) => {
    let value: unknown = head === 'item' ? env.item : env.self[head]
    for (const part of rest) {
      if (value === undefined || value === null) return undefined
      value = (value as Record<string, unknown>)[part]
    }
    return value
  }
}

/** The source offset that index 0 of a text value stands at, for the spans of a `matches`. */
function baseOf(expr: Expr): Value {
  const operator = operatorOf(expr)
  if (operator?.[0] === 'f' && typeof operator[1] === 'string') {
    const path = operator[1]
    const split = path.lastIndexOf('.')
    const head = split < 0 ? '' : path.slice(0, split + 1)
    const last = split < 0 ? path : path.slice(split + 1)
    if (last === 'body') return fieldOf(`${head}body_start`)
    if (last === 'text') return fieldOf(`${head}start`)
  }
  if (operator?.[0] === 'text_from') return compileValue(operator[1])
  return () => 0
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

function textOf(expr: Expr): (env: Env) => string {
  const value = compileValue(expr)
  return (env) => asText(value(env))
}

function numberOf(expr: Expr): (env: Env) => number {
  const value = compileValue(expr)
  return (env) => Number(value(env))
}

function lineScan(arg: Expr, step: -1 | 1): Value {
  const [fromExpr, charsExpr] = argsOf(arg)
  const from = numberOf(fromExpr)
  const chars = textOf(charsExpr)
  return (env) => {
    const line = env.line
    if (line === undefined) return from(env)
    const over = chars(env)
    let at = from(env) - line.start
    if (step < 0) while (at > 0 && over.includes(line.text[at - 1]!)) at--
    else while (at < line.text.length && over.includes(line.text[at]!)) at++
    return line.start + at
  }
}

const trimEnd = (text: string): string => text.replace(/[ \t]+$/, '')

const VALUES: Record<string, (arg: Expr, node: Record<string, Expr>) => Value> = {
  f: (arg) => fieldOf(String(arg)),
  v: (arg) => (env) => env.vars[String(arg)],
  len: (arg) => { const text = textOf(arg); return (env) => text(env).length },
  add: (arg) => { const items = argsOf(arg).map(numberOf); return (env) => items.reduce((sum, item) => sum + item(env), 0) },
  sub: (arg) => { const [a, b] = argsOf(arg).map(numberOf); return (env) => a!(env) - b!(env) },
  slice: (arg) => {
    const [whole, from, to] = argsOf(arg)
    const text = textOf(whole)
    const start = numberOf(from)
    const end = to === undefined ? undefined : numberOf(to)
    return (env) => (end === undefined ? text(env).slice(start(env)) : text(env).slice(start(env), end(env)))
  },
  concat: (arg) => { const items = argsOf(arg).map(textOf); return (env) => items.map((item) => item(env)).join('') },
  trim_end: (arg) => { const text = textOf(arg); return (env) => trimEnd(text(env)) },
  words: (arg) => { const text = textOf(arg); return (env) => text(env).replaceAll('_', ' ') },
  if: (arg) => {
    const [condition, then, otherwise] = argsOf(arg)
    const test = compileTest(condition)
    const a = compileValue(then)
    const b = compileValue(otherwise)
    return (env) => (test(env) ? a(env) : b(env))
  },
  match: (arg, node) => {
    const name = String(arg)
    const end = node['at'] === 'end'
    return (env) => {
      const span = env.match?.groups[name]
      return span === undefined || env.match === undefined ? undefined : env.match.base + (end ? span[1] : span[0])
    }
  },
  text_from: (arg) => {
    const from = numberOf(arg)
    return (env) => (env.line === undefined ? '' : trimEnd(env.line.text.slice(from(env) - env.line.start)))
  },
  extend_left: (arg) => lineScan(arg, -1),
  skip_right: (arg) => lineScan(arg, 1),
}

function compileValue(expr: Expr): Value {
  const operator = operatorOf(expr)
  if (operator === undefined) return () => expr
  const make = VALUES[operator[0]]
  return make === undefined ? compileTest(expr) : make(operator[1], operator[2])
}

function matches(arg: Expr): Test {
  const [subject, pattern, flags] = argsOf(arg)
  const source = String(pattern)
  const named = source.includes('(?<')
  const regex = new RegExp(source, `${typeof flags === 'string' ? flags : ''}${named ? 'd' : ''}`)
  const value = compileValue(subject)
  const base = baseOf(subject)
  return (env) => {
    const whole = value(env)
    if (typeof whole !== 'string') return false
    const found = regex.exec(whole)
    if (found === null) return false
    if (!named) return true
    const groups: Record<string, [number, number]> = {}
    for (const [name, span] of Object.entries(found.indices?.groups ?? {})) if (span !== undefined) groups[name] = span
    env.match = { groups, base: Number(base(env)) }
    return true
  }
}

function some(arg: Expr): Test {
  const spec = arg as { in: string, from?: number, where: Expr }
  const items = fieldOf(spec.in)
  const where = compileTest(spec.where)
  const from = spec.from ?? 0
  return (env) => {
    const list = items(env)
    if (!Array.isArray(list)) return false
    const saved = env.item
    try {
      for (let at = from; at < list.length; at++) {
        env.item = list[at]
        if (where(env)) return true
      }
      return false
    } finally {
      env.item = saved
    }
  }
}

function compare(arg: Expr, check: (a: number, b: number) => boolean): Test {
  const [a, b] = argsOf(arg).map(numberOf)
  return (env) => check(a!(env), b!(env))
}

function contains(arg: Expr): Test {
  const [a, b] = argsOf(arg).map(compileValue)
  return (env) => {
    const haystack = a!(env)
    const needle = b!(env)
    if (Array.isArray(haystack)) return haystack.includes(needle)
    return typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle)
  }
}

const TESTS: Record<string, (arg: Expr) => Test> = {
  all: (arg) => { const items = argsOf(arg).map(compileTest); return (env) => items.every((item) => item(env)) },
  any: (arg) => { const items = argsOf(arg).map(compileTest); return (env) => items.some((item) => item(env)) },
  not: (arg) => { const test = compileTest(arg); return (env) => !test(env) },
  has: (arg) => { const value = fieldOf(String(arg)); return (env) => value(env) !== undefined },
  eq: (arg) => { const [a, b] = argsOf(arg).map(compileValue); return (env) => a!(env) === b!(env) },
  ne: (arg) => { const [a, b] = argsOf(arg).map(compileValue); return (env) => a!(env) !== b!(env) },
  lt: (arg) => compare(arg, (a, b) => a < b),
  le: (arg) => compare(arg, (a, b) => a <= b),
  gt: (arg) => compare(arg, (a, b) => a > b),
  ge: (arg) => compare(arg, (a, b) => a >= b),
  in: (arg) => {
    const [subject, set] = argsOf(arg)
    const members = new Set<unknown>(typeof set === 'string' ? SETS[set] ?? [] : argsOf(set))
    const value = compileValue(subject)
    return (env) => members.has(value(env))
  },
  contains,
  starts: (arg) => {
    const [subject, prefix] = argsOf(arg)
    const value = compileValue(subject)
    const head = textOf(prefix)
    return (env) => { const whole = value(env); return typeof whole === 'string' && whole.startsWith(head(env)) }
  },
  matches,
  some,
  f: (arg) => { const value = fieldOf(String(arg)); return (env) => Boolean(value(env)) },
  v: (arg) => (env) => Boolean(env.vars[String(arg)]),
}

function compileTest(expr: Expr): Test {
  if (typeof expr === 'boolean') return () => expr
  const operator = operatorOf(expr)
  if (operator === undefined) return () => false
  const make = TESTS[operator[0]]
  if (make === undefined) throw new Error(`lint-model: unknown operator ${operator[0]}`)
  return make(operator[1])
}

interface CompiledReport { when: Test | undefined, message: number, start: Value, end: Value, values: [string, Value][] }
interface CompiledRule {
  id: RuleId
  over: 'line' | 'block'
  types: ReadonlySet<string> | undefined
  verbatim: ReadonlySet<string>
  lets: [string, Value][]
  when: Test | undefined
  reports: CompiledReport[]
}

function compileRule(rule: DataRule): CompiledRule {
  return {
    id: rule.id as RuleId,
    over: rule.over,
    types: rule.types === undefined ? undefined : new Set(rule.types),
    verbatim: new Set(rule.verbatim ?? []),
    lets: Object.entries(rule.let ?? {}).map(([name, expr]) => [name, compileValue(expr)]),
    when: rule.when === undefined ? undefined : compileTest(rule.when),
    reports: rule.report.map((report) => ({
      when: report.when === undefined ? undefined : compileTest(report.when),
      message: report.message ?? 0,
      start: compileValue(report.start ?? rule.range?.start),
      end: compileValue(report.end ?? rule.range?.end),
      values: Object.entries({ ...rule.values, ...report.values }).map(([name, expr]) => [name, compileValue(expr)]),
    })),
  }
}

let compiled: CompiledRule[] | undefined

const env: Env = { self: {}, line: undefined, vars: {}, item: undefined, match: undefined }

function apply(rule: CompiledRule, self: object, line: ModelLine | undefined, path: string, context: LintContext): void {
  env.self = self as Record<string, unknown>
  env.line = line
  env.match = undefined
  for (const [name, value] of rule.lets) env.vars[name] = value(env)
  if (rule.when !== undefined && !rule.when(env)) return
  for (const report of rule.reports) {
    if (report.when !== undefined && !report.when(env)) continue
    const values: Record<string, string> = {}
    for (const [name, value] of report.values) values[name] = String(value(env))
    context.report(rule.id, Number(report.start(env)), Number(report.end(env)), path, values, report.message)
    return
  }
}

function rulesByType(rules: readonly CompiledRule[]): Map<string, CompiledRule[]> {
  const byType = new Map<string, CompiledRule[]>()
  for (const rule of rules) {
    if (rule.over !== 'block') continue
    for (const type of rule.types ?? []) byType.set(type, [...byType.get(type) ?? [], rule])
  }
  return byType
}

/** Run the data rules that `active` keeps on the model of the parsed document. */
export function runDataRules(document: Node, context: LintContext, active: (id: RuleId) => boolean): void {
  const rules = (compiled ??= MODEL.rules.map(compileRule)).filter((rule) => active(rule.id))
  if (rules.length === 0) return
  const model = buildModel(document, context)
  const lineRules = rules.filter((rule) => rule.over === 'line')
  const anyBlock = rules.filter((rule) => rule.over === 'block' && rule.types === undefined)
  const byType = rulesByType(rules)
  for (const line of model.lines) {
    const verbatim = VERBATIM.has(line.leaf)
    const path = context.lines[line.number - 1]?.path ?? ''
    for (const rule of lineRules) if (!verbatim || rule.verbatim.has(line.leaf)) apply(rule, line, line, path, context)
  }
  for (const block of model.blocks) {
    for (const rule of byType.get(block.type) ?? []) apply(rule, block, block.line, block.path, context)
    for (const rule of anyBlock) apply(rule, block, block.line, block.path, context)
  }
}
