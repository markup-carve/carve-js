import { type RuleId } from './catalog.ts'
import { type ModelAttribute, attributeRecords } from './data-attributes.ts'
import { buildModel, DataWalk, type LineModel, type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { DATA_RULES, type DataRule, useRecords, VERBATIM_LEAVES } from './data-tables.ts'
import { type LintContext } from './types.ts'
import { type Node } from '../src/ast.ts'

type LineRun = (self: ModelLine, path: string, context: LintContext) => void
type BlockRun = (self: ModelBlock, path: string, context: LintContext) => void
type InlineRun = (self: ModelInline, path: string, context: LintContext) => void
type AttributeRun = (self: ModelAttribute, path: string, context: LintContext) => void

/** The ids of the catalog rows that `data/lint-model.json` states as data. */
export const DATA_RULE_IDS: ReadonlySet<string> = new Set(DATA_RULES.map((rule) => rule.id))

interface Active {
  lines: DataRule[]
  blocks: DataRule[]
  inline: Map<string, InlineRun[]>
  attributes: DataRule[]
  /** The attribute record kinds the attribute rules can match, or every kind. */
  kinds: Set<string>
  allKinds: boolean
  /** The attribute rules per owner type, in catalog order. */
  byOwner: Map<string, AttributeRun[]>
  /** The block and inline types that lookups read, whose records are made with or without a rule of their own. */
  needBlocks: Set<string>
  needInline: Set<string>
  /** The line rules per leaf and the block rules per type and parent type, in catalog order. */
  byLeaf: Map<string, LineRun[]>
  byBlock: Map<string, Map<string, BlockRun[]>>
  /** The inline types the walk records, made once per rule set. */
  walkTypes?: ReadonlySet<string>
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
  else if (rule.over === 'attribute') {
    out.attributes.push(rule)
    if (rule.only === undefined) out.allKinds = true
    else for (const kind of rule.only) out.kinds.add(kind)
  }
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
    out = { lines: [], blocks: [], inline: new Map(), attributes: [], kinds: new Set(), allKinds: false,
      byOwner: new Map(), needBlocks: new Set(), needInline: new Set(),
      byLeaf: new Map(), byBlock: new Map() }
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

function ownerRuns(rules: Active, type: string): AttributeRun[] {
  let runs = rules.byOwner.get(type)
  if (runs !== undefined) return runs
  runs = []
  for (const rule of rules.attributes) if (rule.over === 'attribute' && rule.types?.includes(type) !== false) runs.push(rule.run)
  rules.byOwner.set(type, runs)
  return runs
}

function runAttributes(walk: DataWalk, rules: Active, context: LintContext): void {
  let owner: ModelAttribute['owner'] | undefined
  let runs: AttributeRun[] = []
  for (const record of attributeRecords(walk.attributed, context, rules.allKinds ? undefined : rules.kinds)) {
    if (record.owner !== owner) runs = ownerRuns(rules, (owner = record.owner).type)
    for (const run of runs) run(record, owner.path, context)
  }
}

function runLines(model: LineModel<BlockRun>, rules: Active, context: LintContext): void {
  if (rules.lines.length === 0) return
  for (const line of model.lines.all()) {
    const runs = lineRuns(rules, line.leaf)
    if (runs.length === 0) continue
    const path = context.lines[line.number - 1]?.path || line.table_path || ''
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
  const model = rules.lines.length > 0 || rules.blocks.length > 0 || rules.inline.size > 0
  if (!model && rules.attributes.length === 0) return undefined
  rules.walkTypes ??= new Set([...rules.inline.keys(), ...rules.needInline])
  return new DataWalk(document, rules.walkTypes, context, rules.attributes.length > 0, model)
}

/** Run the data rules that `active` keeps on the model of the parsed document, walked by the lint visit. */
export function runDataRules(walk: DataWalk, context: LintContext, active: (id: RuleId) => boolean, defaults: boolean): void {
  const rules = activeRules(active, defaults)
  if (rules.attributes.length > 0) runAttributes(walk, rules, context)
  if (rules.lines.length === 0 && rules.blocks.length === 0 && rules.inline.size === 0) return
  const model = buildModel(walk.walked, context, (type, parent) => blockRuns(rules, type, parent), rules.needBlocks)
  useRecords(model.blocks, walk.inline)
  let commentPaths: Map<number, string> | undefined
  const report: LintContext['report'] = (id, start, end, path, values, message) => {
    if (id === 'list-item-body-below-content-column') path = path.slice(0, path.lastIndexOf('/children/'))
    if (id === 'comment-fence-closer-with-text') {
      if (commentPaths === undefined) {
        commentPaths = new Map()
        for (const entry of walk.walked) {
          if (entry.node.type !== 'comment' || entry.node.form !== 'block' || entry.node.pos === undefined) continue
          for (let line = entry.node.pos.startLine; line <= entry.node.pos.endLine; line++) commentPaths.set(line, entry.path)
        }
      }
      path = commentPaths.get(context.offsetLines[start] ?? 1) ?? path
    }
    context.report(id, start, end, path, values, message)
  }
  const reportingContext = { ...context, report }
  // The hand-written node rules report during the visit, before the line rules: findings at one offset keep that order.
  runBlocks(model, reportingContext)
  runInline(walk, rules, reportingContext)
  runLines(model, rules, reportingContext)
  // The lookup index holds every record of the document; kept past the call it would hold the whole document alive.
  useRecords([], [])
}
