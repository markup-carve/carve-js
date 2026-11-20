import { type RuleId } from './catalog.ts'
import { buildModel, inlineRecords, type LineModel, type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { DATA_RULES, type DataRule, VERBATIM_LEAVES } from './data-tables.ts'
import { type LintContext } from './types.ts'
import { type Node } from '../src/ast.ts'

type LineRun = (self: ModelLine, path: string, context: LintContext) => void
type BlockRun = (self: ModelBlock, path: string, context: LintContext) => void
type InlineRun = (self: ModelInline, path: string, context: LintContext) => void

/** The ids of the catalog rows that `data/lint-model.json` states as data. */
export const DATA_RULE_IDS: ReadonlySet<string> = new Set(DATA_RULES.map((rule) => rule.id))

/** The internal switch: run the data rules in place of the hand-written ones. */
export function dataRulesOn(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.['CARVE_LINT_RULES'] === 'data'
}

interface Active {
  lines: { run: LineRun, verbatim: ReadonlySet<string> }[]
  anyBlock: BlockRun[]
  byType: Map<string, BlockRun[]>
  inline: Map<string, InlineRun[]>
}

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

function addRule(out: Active, rule: DataRule): void {
  if (rule.over === 'line') out.lines.push({ run: rule.run, verbatim: rule.verbatim })
  else if (rule.over === 'inline') for (const type of rule.types ?? []) push(out.inline, type, rule.run)
  else if (rule.types === undefined) out.anyBlock.push(rule.run)
  else for (const type of rule.types) push(out.byType, type, rule.run)
}

const activeCache = new Map<string, Active>()

function activeRules(active: (id: RuleId) => boolean): Active {
  const on = DATA_RULES.map((rule) => active(rule.id))
  const key = on.map((value) => (value ? '1' : '0')).join('')
  const known = activeCache.get(key)
  if (known !== undefined) return known
  const out: Active = { lines: [], anyBlock: [], byType: new Map(), inline: new Map() }
  for (const [index, rule] of DATA_RULES.entries()) if (on[index]) addRule(out, rule)
  activeCache.set(key, out)
  return out
}

function runLines(model: LineModel, rules: Active, context: LintContext): void {
  for (const line of model.lines) {
    const verbatim = VERBATIM_LEAVES.has(line.leaf)
    const path = context.lines[line.number - 1]?.path ?? ''
    for (const rule of rules.lines) if (!verbatim || rule.verbatim.has(line.leaf)) rule.run(line, path, context)
  }
}

function runBlocks(model: LineModel, rules: Active, context: LintContext): void {
  for (const block of model.blocks) {
    for (const run of rules.byType.get(block.type) ?? []) run(block, block.path, context)
    for (const run of rules.anyBlock) run(block, block.path, context)
  }
}

function runInline(model: LineModel, rules: Active, context: LintContext): void {
  if (rules.inline.size === 0) return
  for (const record of inlineRecords(model.walked, new Set(rules.inline.keys()), context)) {
    for (const run of rules.inline.get(record.type) ?? []) run(record, record.path, context)
  }
}

/** Run the data rules that `active` keeps on the model of the parsed document. */
export function runDataRules(document: Node, context: LintContext, active: (id: RuleId) => boolean): void {
  const rules = activeRules(active)
  if (rules.lines.length === 0 && rules.anyBlock.length === 0 && rules.byType.size === 0 && rules.inline.size === 0) return
  const model = buildModel(document, context)
  runLines(model, rules, context)
  runBlocks(model, rules, context)
  runInline(model, rules, context)
}
