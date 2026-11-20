import { type RuleId } from './catalog.ts'
import { buildModel, type ModelBlock, type ModelLine } from './data-model.ts'
import { DATA_RULES, VERBATIM_LEAVES } from './data-tables.ts'
import { type LintContext } from './types.ts'
import { type Node } from '../src/ast.ts'

type LineRun = (self: ModelLine, path: string, context: LintContext) => void
type BlockRun = (self: ModelBlock, path: string, context: LintContext) => void

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
}

const activeCache = new Map<string, Active>()

function activeRules(active: (id: RuleId) => boolean): Active {
  const on = DATA_RULES.map((rule) => active(rule.id))
  const key = on.map((value) => (value ? '1' : '0')).join('')
  const known = activeCache.get(key)
  if (known !== undefined) return known
  const out: Active = { lines: [], anyBlock: [], byType: new Map() }
  activeCache.set(key, out)
  for (const [index, rule] of DATA_RULES.entries()) {
    if (!on[index]) continue
    if (rule.over === 'line') {
      out.lines.push({ run: rule.run, verbatim: rule.verbatim })
      continue
    }
    if (rule.types === undefined) out.anyBlock.push(rule.run)
    else for (const type of rule.types) out.byType.set(type, [...out.byType.get(type) ?? [], rule.run])
  }
  return out
}

/** Run the data rules that `active` keeps on the model of the parsed document. */
export function runDataRules(document: Node, context: LintContext, active: (id: RuleId) => boolean): void {
  const rules = activeRules(active)
  if (rules.lines.length === 0 && rules.anyBlock.length === 0 && rules.byType.size === 0) return
  const model = buildModel(document, context)
  for (const line of model.lines) {
    const verbatim = VERBATIM_LEAVES.has(line.leaf)
    const path = context.lines[line.number - 1]?.path ?? ''
    for (const rule of rules.lines) if (!verbatim || rule.verbatim.has(line.leaf)) rule.run(line, path, context)
  }
  for (const block of model.blocks) {
    for (const run of rules.byType.get(block.type) ?? []) run(block, block.path, context)
    for (const run of rules.anyBlock) run(block, block.path, context)
  }
}
