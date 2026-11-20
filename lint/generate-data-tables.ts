import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
interface Model { text_leaves: string[], verbatim_leaves: string[], row_leaves: string[], rules: DataRule[] }

const NUMBER_OPS: ReadonlySet<string> = new Set(['len', 'add', 'sub', 'extend_left', 'skip_right'])
const TEXT_OPS: ReadonlySet<string> = new Set(['slice', 'concat', 'trim_end', 'words', 'text_from'])

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
    return (head === 'item' ? 'item' : `self.${head}`) + rest.map((part) => `?.[${literal(/^\d+$/.test(part) ? Number(part) : part)}]`).join('')
  }

  /** The source offset that index 0 of a text value stands at, for the spans of a `matches`. */
  private base(expr: Expr): string {
    const operator = operatorOf(expr)
    if (operator?.[0] === 'f' && typeof operator[1] === 'string') {
      const path = operator[1]
      const split = path.lastIndexOf('.')
      const head = split < 0 ? '' : path.slice(0, split + 1)
      const last = split < 0 ? path : path.slice(split + 1)
      if (last === 'body') return `num(${this.field(`${head}body_start`)})`
      if (last === 'text') return `num(${this.field(`${head}start`)})`
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
    const regex = this.hoist(`new RegExp(${literal(source)}, ${literal(`${typeof flags === 'string' ? flags : ''}${named ? 'd' : ''}`)})`)
    const value = this.value(subject)
    return named ? `(hit(${regex}, ${value}) && mark(${this.base(subject)}))` : `test(${regex}, ${value})`
  }

  some(arg: Expr): string {
    const spec = arg as { in: string, from?: number, where: Expr }
    return `someFrom(${this.field(spec.in)}, ${spec.from ?? 0}, (item) => ${this.test(spec.where)})`
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
  v: (_c, arg) => local(String(arg)),
  len: (c, arg) => `${c.text(arg)}.length`,
  add: (c, _arg, args) => `(${args.map((item) => c.number(item)).join(' + ')})`,
  sub: (c, _arg, args) => `(${c.number(args[0])} - ${c.number(args[1])})`,
  slice: (c, _arg, args) => `${c.text(args[0])}.slice(${args.slice(1).map((item) => c.number(item)).join(', ')})`,
  concat: (c, _arg, args) => `(${args.map((item) => c.text(item)).join(' + ')})`,
  trim_end: (c, arg) => `trimEnd(${c.text(arg)})`,
  words: (c, arg) => `${c.text(arg)}.replaceAll('_', ' ')`,
  if: (c, _arg, args) => `(${c.test(args[0])} ? ${c.value(args[1])} : ${c.value(args[2])})`,
  match: (_c, arg, _args, node) => `group(${literal(String(arg))}, ${node['at'] === 'end' ? 1 : 0})`,
  text_from: (c, arg) => `textFrom(line, ${c.number(arg)})`,
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
  v: (_c, arg) => `Boolean(${local(String(arg))})`,
}

function ruleFunction(rule: DataRule, index: number, compiler: Compiler): string {
  const self = rule.over === 'line' ? 'ModelLine' : 'ModelBlock'
  const body: string[] = ['  groups = undefined']
  for (const [name, expr] of Object.entries(rule.let ?? {})) body.push(`  const ${local(name)} = ${compiler.value(expr)}`)
  if (rule.when !== undefined) body.push(`  if (!${compiler.test(rule.when)}) return`)
  for (const report of rule.report) {
    const values = Object.entries({ ...rule.values, ...report.values })
      .map(([name, expr]) => `${literal(name)}: String(${compiler.value(expr)})`).join(', ')
    const call = `context.report(${literal(rule.id)}, ${compiler.number(report.start ?? rule.range?.start)}, `
      + `${compiler.number(report.end ?? rule.range?.end)}, path, { ${values} }, ${report.message ?? 0})`
    if (report.when === undefined) {
      body.push(`  ${call}`, '  return')
      break
    }
    body.push(`  if (${compiler.test(report.when)}) {`, `    ${call}`, '    return', '  }')
  }
  if (body.some((code) => /[(\s]line[,)]/.test(code))) body.unshift(`  const line = ${rule.over === 'block' ? 'self.line' : 'self'}`)
  return [`function rule${index}(self: ${self}, path: string, context: LintContext): void {`, ...body, '}'].join('\n')
}

const PRELUDE = `import { type RuleId } from './catalog.ts'
import { type ModelBlock, type ModelLine } from './data-model.ts'
import { type LintContext } from './types.ts'

let groups: Record<string, [number, number]> | undefined
let base = 0

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number => Number(value)
const same = (a: unknown, b: unknown): boolean => a === b
const trimEnd = (text: string): string => text.replace(/[ \\t]+$/, '')
const test = (regex: RegExp, value: unknown): boolean => typeof value === 'string' && regex.test(value)
const starts = (value: unknown, prefix: string): boolean => typeof value === 'string' && value.startsWith(prefix)

function hit(regex: RegExp, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const found = regex.exec(value)
  if (found === null) return false
  const spans: Record<string, [number, number]> = {}
  for (const [name, span] of Object.entries(found.indices?.groups ?? {})) if (span !== undefined) spans[name] = span
  groups = spans
  return true
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

function someFrom<T>(list: readonly T[] | undefined, from: number, where: (item: T) => boolean): boolean {
  if (!Array.isArray(list)) return false
  for (let at = from; at < list.length; at++) if (where(list[at] as T)) return true
  return false
}

const textFrom = (line: ModelLine, from: number): string => trimEnd(line.text.slice(from - line.start))

function scan(line: ModelLine, from: number, chars: string, step: -1 | 1): number {
  let at = from - line.start
  if (step < 0) while (at > 0 && chars.includes(line.text[at - 1]!)) at--
  else while (at < line.text.length && chars.includes(line.text[at]!)) at++
  return line.start + at
}
`

/** The rules of data/lint-model.json compiled to TypeScript, one function per rule. */
export function generateDataTables(json: string): string {
  const model = JSON.parse(json) as Model
  const compiler = new Compiler(model)
  const functions = model.rules.map((rule, index) => ruleFunction(rule, index, compiler))
  const entries = model.rules.map((rule, index) => {
    const types = rule.types === undefined ? 'undefined' : literal(rule.types)
    return `  { id: ${literal(rule.id)}, over: ${literal(rule.over)}, types: ${types}, verbatim: new Set(${literal(rule.verbatim ?? [])}), `
      + `run: rule${index} },`
  })
  return ['// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.', PRELUDE,
    ...compiler.hoisted.map((code, index) => `const K${index} = ${code}`), '', ...functions.flatMap((code) => [code, '']),
    'export type DataRule =',
    '  | { id: RuleId, over: \'line\', types: undefined, verbatim: ReadonlySet<string>, run: (self: ModelLine, path: string, context: LintContext) => void }',
    '  | { id: RuleId, over: \'block\', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, '
      + 'run: (self: ModelBlock, path: string, context: LintContext) => void }',
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
