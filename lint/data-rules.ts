import { type RuleId } from './catalog.ts'
import { buildModel, type LineModel, type ModelLine } from './data-model.ts'
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
  item?: unknown
  match?: { groups: Record<string, [number, number]>, base: number }
}

const regexes = new Map<string, RegExp>()

function regex(pattern: string, flags: string): RegExp {
  const key = `${flags}/${pattern}`
  let compiled = regexes.get(key)
  if (compiled === undefined) {
    compiled = new RegExp(pattern, `${flags}d`)
    regexes.set(key, compiled)
  }
  return compiled
}

function field(path: string, env: Env): unknown {
  const parts = path.split('.')
  let value: unknown = parts[0] === 'item' ? env.item : env.self[parts[0]!]
  for (let at = 1; at < parts.length; at++) {
    if (value === undefined || value === null) return undefined
    value = (value as Record<string, unknown>)[parts[at]!]
  }
  return value
}

/** The source offset that index 0 of a text value stands at. */
function baseOf(expr: Expr, env: Env): number {
  if (typeof expr !== 'object' || expr === null) return 0
  const node = expr as Record<string, unknown>
  if (typeof node['f'] === 'string') {
    const path = node['f']
    const split = path.lastIndexOf('.')
    const head = split < 0 ? '' : `${path.slice(0, split)}.`
    const last = split < 0 ? path : path.slice(split + 1)
    if (last === 'body') return Number(field(`${head}body_start`, env))
    if (last === 'text') return Number(field(`${head}start`, env))
  }
  if ('text_from' in node) return Number(value(node['text_from'], env))
  return 0
}

function list(operand: unknown): readonly unknown[] {
  if (typeof operand === 'string') return SETS[operand] ?? []
  return Array.isArray(operand) ? operand : []
}

function text(expr: Expr, env: Env): string {
  const result = value(expr, env)
  return typeof result === 'string' ? result : ''
}

function num(expr: Expr, env: Env): number {
  return Number(value(expr, env))
}

type Operator<T> = (arg: Expr, env: Env, node: Record<string, Expr>) => T

const argsOf = (arg: Expr): Expr[] => (Array.isArray(arg) ? arg : [])

function lineScan(arg: Expr, env: Env, step: -1 | 1): number {
  const [from, chars] = argsOf(arg)
  const line = env.line
  if (line === undefined) return num(from, env)
  const over = text(chars, env)
  let at = num(from, env) - line.start
  if (step < 0) while (at > 0 && over.includes(line.text[at - 1]!)) at--
  else while (at < line.text.length && over.includes(line.text[at]!)) at++
  return line.start + at
}

const VALUES: Record<string, Operator<unknown>> = {
  f: (arg, env) => field(String(arg), env),
  v: (arg, env) => env.vars[String(arg)],
  len: (arg, env) => text(arg, env).length,
  add: (arg, env) => argsOf(arg).reduce((sum: number, item) => sum + num(item, env), 0),
  sub: (arg, env) => num(argsOf(arg)[0], env) - num(argsOf(arg)[1], env),
  slice: (arg, env) => {
    const [whole, from, to] = argsOf(arg)
    return to === undefined ? text(whole, env).slice(num(from, env)) : text(whole, env).slice(num(from, env), num(to, env))
  },
  concat: (arg, env) => argsOf(arg).map((item) => text(item, env)).join(''),
  trim_end: (arg, env) => text(arg, env).replace(/[ \t]+$/, ''),
  words: (arg, env) => text(arg, env).replaceAll('_', ' '),
  if: (arg, env) => (test(argsOf(arg)[0], env) ? value(argsOf(arg)[1], env) : value(argsOf(arg)[2], env)),
  match: (arg, env, node) => {
    const span = env.match?.groups[String(arg)]
    if (span === undefined || env.match === undefined) return undefined
    return env.match.base + (node['at'] === 'end' ? span[1] : span[0])
  },
  text_from: (arg, env) => {
    const line = env.line
    return line === undefined ? '' : line.text.slice(num(arg, env) - line.start).replace(/[ \t]+$/, '')
  },
  extend_left: (arg, env) => lineScan(arg, env, -1),
  skip_right: (arg, env) => lineScan(arg, env, 1),
}

function value(expr: Expr, env: Env): unknown {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) return expr
  const node = expr as Record<string, Expr>
  const key = Object.keys(node)[0]!
  const operator = VALUES[key]
  return operator === undefined ? test(expr, env) : operator(node[key], env, node)
}

function matches(arg: Expr, env: Env): boolean {
  const [subject, pattern, flags] = argsOf(arg)
  const whole = value(subject, env)
  if (typeof whole !== 'string') return false
  const found = regex(String(pattern), typeof flags === 'string' ? flags : '').exec(whole)
  if (found === null) return false
  const groups: Record<string, [number, number]> = {}
  for (const [name, span] of Object.entries(found.indices?.groups ?? {})) if (span !== undefined) groups[name] = span
  if (Object.keys(groups).length > 0) env.match = { groups, base: baseOf(subject, env) }
  return true
}

function some(arg: Expr, env: Env): boolean {
  const spec = arg as { in: string, from?: number, where: Expr }
  const items = field(spec.in, env)
  if (!Array.isArray(items)) return false
  const saved = env.item
  try {
    for (let at = spec.from ?? 0; at < items.length; at++) {
      env.item = items[at]
      if (test(spec.where, env)) return true
    }
    return false
  } finally {
    env.item = saved
  }
}

function contains(arg: Expr, env: Env): boolean {
  const haystack = value(argsOf(arg)[0], env)
  const needle = value(argsOf(arg)[1], env)
  if (Array.isArray(haystack)) return haystack.includes(needle)
  return typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle)
}

const pair = (arg: Expr, env: Env): [unknown, unknown] => [value(argsOf(arg)[0], env), value(argsOf(arg)[1], env)]
const numbers = (arg: Expr, env: Env): [number, number] => [num(argsOf(arg)[0], env), num(argsOf(arg)[1], env)]

const TESTS: Record<string, Operator<boolean>> = {
  all: (arg, env) => argsOf(arg).every((item) => test(item, env)),
  any: (arg, env) => argsOf(arg).some((item) => test(item, env)),
  not: (arg, env) => !test(arg, env),
  has: (arg, env) => field(String(arg), env) !== undefined,
  eq: (arg, env) => { const [a, b] = pair(arg, env); return a === b },
  ne: (arg, env) => { const [a, b] = pair(arg, env); return a !== b },
  lt: (arg, env) => { const [a, b] = numbers(arg, env); return a < b },
  le: (arg, env) => { const [a, b] = numbers(arg, env); return a <= b },
  gt: (arg, env) => { const [a, b] = numbers(arg, env); return a > b },
  ge: (arg, env) => { const [a, b] = numbers(arg, env); return a >= b },
  in: (arg, env) => list(argsOf(arg)[1]).includes(value(argsOf(arg)[0], env)),
  contains,
  starts: (arg, env) => {
    const whole = value(argsOf(arg)[0], env)
    return typeof whole === 'string' && whole.startsWith(text(argsOf(arg)[1], env))
  },
  matches,
  some,
  f: (arg, env) => Boolean(field(String(arg), env)),
  v: (arg, env) => Boolean(env.vars[String(arg)]),
}

function test(expr: Expr, env: Env): boolean {
  if (typeof expr === 'boolean') return expr
  if (typeof expr !== 'object' || expr === null) return false
  const node = expr as Record<string, Expr>
  const key = Object.keys(node)[0]!
  const operator = TESTS[key]
  if (operator === undefined) throw new Error(`lint-model: unknown operator ${key}`)
  return operator(node[key], env, node)
}

function stringValues(values: Record<string, Expr>, env: Env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, expr] of Object.entries(values)) out[name] = String(value(expr, env))
  return out
}

function apply(rule: DataRule, self: Record<string, unknown>, line: ModelLine | undefined, path: string, context: LintContext): void {
  const env: Env = { self, line, vars: {} }
  for (const [name, expr] of Object.entries(rule.let ?? {})) env.vars[name] = value(expr, env)
  if (rule.when !== undefined && !test(rule.when, env)) return
  for (const report of rule.report) {
    if (report.when !== undefined && !test(report.when, env)) continue
    const start = num(report.start ?? rule.range?.start, env)
    const end = num(report.end ?? rule.range?.end, env)
    const values = stringValues({ ...rule.values, ...report.values }, env)
    context.report(rule.id as RuleId, start, end, path, values, report.message ?? 0)
    return
  }
}

/** Run the data rules that `active` keeps on the model of the parsed document. */
export function runDataRules(document: Node, context: LintContext, active: (id: RuleId) => boolean): void {
  const rules = MODEL.rules.filter((rule) => active(rule.id as RuleId))
  if (rules.length === 0) return
  const model: LineModel = buildModel(document, context)
  const lineRules = rules.filter((rule) => rule.over === 'line')
  const blockRules = rules.filter((rule) => rule.over === 'block')
  for (const line of model.lines) {
    for (const rule of lineRules) {
      if (VERBATIM.has(line.leaf) && !rule.verbatim?.includes(line.leaf)) continue
      apply(rule, line as unknown as Record<string, unknown>, line, context.lines[line.number - 1]?.path ?? '', context)
    }
  }
  for (const block of model.blocks) {
    for (const rule of blockRules) {
      if (rule.types !== undefined && !rule.types.includes(block.type)) continue
      apply(rule, block as unknown as Record<string, unknown>, block.line, block.path, context)
    }
  }
}
