import { type RuleId } from './catalog.ts'
import { buildModel, DataWalk, type LineModel, type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { DATA_RULES, type DataRule, useRecords, VERBATIM_LEAVES } from './data-tables.ts'
import { type LintContext } from './types.ts'
import { type Node } from '../src/ast.ts'

type LineRun = (self: ModelLine, path: string, context: LintContext) => void
type BlockRun = (self: ModelBlock, path: string, context: LintContext) => void
type InlineRun = (self: ModelInline, path: string, context: LintContext) => void

/** The ids of the catalog rows that `data/lint-model.json` states as data. */
export const DATA_RULE_IDS: ReadonlySet<string> = new Set(DATA_RULES.map((rule) => rule.id))

/** The rows whose hand-written rule is gone: they run from data whether or not the switch is on. */
export const DATA_ONLY: ReadonlySet<string> = new Set(['block-marker-as-text', 'broken-crossref', 'broken-fragment-link',
  'description-separator-below-content-column', 'html-comment-renders-as-text', 'list-marker-below-content-column',
  'markdown-definition-paragraph', 'ordered-marker-right-aligned', 'region-marker-renders-as-text', 'tight-list-item-with-blank-line',
  'uneven-list-indent', 'unresolved-reference-link'])

/** Whether a rule runs from data: every data rule with the switch on, the rows of DATA_ONLY without it. */
export function fromData(id: string, data: boolean): boolean {
  return data ? DATA_RULE_IDS.has(id) : DATA_ONLY.has(id)
}

/** The internal switch: run the data rules in place of the hand-written ones. */
export function dataRulesOn(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.['CARVE_LINT_RULES'] === 'data'
}

interface Active {
  lines: DataRule[]
  blocks: DataRule[]
  inline: Map<string, InlineRun[]>
  /** The block and inline types that lookups read, whose records are made with or without a rule of their own. */
  needBlocks: Set<string>
  needInline: Set<string>
  /** The line rules per leaf and the block rules per type and parent type, in catalog order. */
  byLeaf: Map<string, LineRun[]>
  byBlock: Map<string, Map<string, BlockRun[]>>
}

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

function addRule(out: Active, rule: DataRule): void {
  for (const type of rule.needs.block) out.needBlocks.add(type)
  for (const type of rule.needs.inline) out.needInline.add(type)
  if (rule.over === 'line') out.lines.push(rule)
  else if (rule.over === 'inline') for (const type of rule.types ?? []) push(out.inline, type, rule.run)
  else out.blocks.push(rule)
}

const activeCache = new Map<string, Active>()
let defaultRules: Active | undefined

function activeRules(active: (id: RuleId) => boolean, defaults: boolean): Active {
  if (defaults && defaultRules !== undefined) return defaultRules
  const on = DATA_RULES.map((rule) => active(rule.id))
  const key = on.map((value) => (value ? '1' : '0')).join('')
  let out = activeCache.get(key)
  if (out === undefined) {
    out = { lines: [], blocks: [], inline: new Map(), needBlocks: new Set(), needInline: new Set(), byLeaf: new Map(), byBlock: new Map() }
    for (const [index, rule] of DATA_RULES.entries()) if (on[index]) addRule(out, rule)
    activeCache.set(key, out)
  }
  if (defaults) defaultRules = out
  return out
}

function lineRuns(rules: Active, leaf: string): LineRun[] {
  let runs = rules.byLeaf.get(leaf)
  if (runs !== undefined) return runs
  const verbatim = VERBATIM_LEAVES.has(leaf)
  runs = []
  for (const rule of rules.lines) {
    if (rule.over !== 'line' || (verbatim && !rule.verbatim.has(leaf)) || rule.only?.has(leaf) === false) continue
    runs.push(rule.run)
  }
  rules.byLeaf.set(leaf, runs)
  return runs
}

function blockRuns(rules: Active, type: string, parent: string): BlockRun[] {
  let byParent = rules.byBlock.get(type)
  if (byParent === undefined) rules.byBlock.set(type, byParent = new Map<string, BlockRun[]>())
  let runs = byParent.get(parent)
  if (runs !== undefined) return runs
  runs = []
  for (const rule of rules.blocks) {
    if (rule.over !== 'block' || rule.types?.includes(type) === false || rule.only?.has(parent) === false) continue
    runs.push(rule.run)
  }
  byParent.set(parent, runs)
  return runs
}

function runLines(model: LineModel<BlockRun>, rules: Active, context: LintContext): void {
  if (rules.lines.length === 0) return
  for (const line of model.lines) {
    const runs = lineRuns(rules, line.leaf)
    if (runs.length === 0) continue
    const path = context.lines[line.number - 1]?.path ?? ''
    for (const run of runs) run(line, path, context)
  }
}

function runBlocks(model: LineModel<BlockRun>, context: LintContext): void {
  for (const [index, block] of model.blocks.entries()) for (const run of model.runs[index]!) run(block, block.path, context)
}

function runInline(walk: DataWalk, rules: Active, context: LintContext): void {
  for (const record of walk.inline) {
    for (const run of rules.inline.get(record.type) ?? []) run(record, record.path, context)
  }
}

/** The walk that the lint visit fills for the data rules that `active` keeps, or undefined when none is on. */
export function startDataWalk(document: Node, context: LintContext, active: (id: RuleId) => boolean,
  defaults: boolean): DataWalk | undefined {
  const rules = activeRules(active, defaults)
  if (rules.lines.length === 0 && rules.blocks.length === 0 && rules.inline.size === 0) return undefined
  return new DataWalk(document, new Set([...rules.inline.keys(), ...rules.needInline]), context)
}

/** Run the data rules that `active` keeps on the model of the parsed document, walked by the lint visit. */
export function runDataRules(walk: DataWalk, context: LintContext, active: (id: RuleId) => boolean, defaults: boolean): void {
  const rules = activeRules(active, defaults)
  const model = buildModel(walk.walked, context, (type, parent) => blockRuns(rules, type, parent), rules.needBlocks)
  useRecords(model.blocks, walk.inline, walk.ids, model.lines)
  // The hand-written node rules report during the visit, before the line rules: findings at one offset keep that order.
  runBlocks(model, context)
  runInline(walk, rules, context)
  runLines(model, rules, context)
}
