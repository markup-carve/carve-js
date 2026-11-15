import { forEachSlot, type Node, SOURCE_ORDER } from '../src/ast.ts'
import { parseWithLayout } from '../src/api.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { CATALOG, type RuleId } from './catalog.ts'
import { LINE_RULES } from './spelling.ts'
import { finishStructure, NODE_RULES } from './structure.ts'
import { markNodeLines, sourceLines } from './source.ts'
import { type Line, type LintContext, type LintOptions, type Rule } from './types.ts'

interface Control {
  kind: 'disable-line' | 'disable-next-line' | 'disable' | 'enable'
  ids: string[]
}

function active(id: RuleId, options: LintOptions): boolean {
  if (id.startsWith('platform-')) return options.platforms?.includes('github') === true && options.rules?.[id] !== 'off'
  const setting = options.rules?.[id] ?? CATALOG[id].default
  if (setting !== 'on') return false
  return true
}

function message(id: RuleId, values: Record<string, string>, index: number): string {
  const templates: readonly string[] = CATALOG[id].messages
  const template = templates[index] ?? templates[0] ?? ''
  let output = ''
  let at = 0
  while (at < template.length) {
    const open = template.indexOf('${', at)
    if (open < 0) return output + template.slice(at)
    const close = template.indexOf('}', open + 2)
    if (close < 0) return output + template.slice(at)
    const key = template.slice(open + 2, close)
    output += template.slice(at, open) + (values[key] ?? template.slice(open, close + 1))
    at = close + 1
  }
  return output
}

function controlIds(tail: string): string[] {
  const ids: string[] = []
  let start = -1
  for (let at = 0; at <= tail.length; at++) {
    const separator = at === tail.length || tail[at] === ' ' || tail[at] === ','
    if (!separator && start < 0) start = at
    if (separator && start >= 0) {
      ids.push(tail.slice(start, at))
      start = -1
    }
  }
  return ids
}

function controlOf(node: Node, context: LintContext): Control | null {
  if (node.type !== 'comment' || node.form !== 'line' || node.pos === undefined) return null
  const start = context.chars[node.pos.startOffset] ?? 0
  const end = context.chars[node.pos.endOffset] ?? context.source.length
  const raw = context.source.slice(start, end)
  const marker = raw.indexOf('%%')
  if (marker < 0 || raw[marker + 2] !== ' ' || raw[marker + 3] === ' ') return null
  const value = node.value
  if (!value.startsWith('carve-lint-')) return null
  const suffix = value.slice('carve-lint-'.length)
  for (const kind of ['disable-next-line', 'disable-line', 'disable', 'enable'] as const) {
    if (!suffix.startsWith(kind)) continue
    const tail = suffix.slice(kind.length)
    if (tail !== '' && tail[0] !== ' ' && tail[0] !== ',') return null
    return { kind, ids: controlIds(tail) }
  }
  return null
}

function runNodeRules(node: Node, path: string, context: LintContext): void {
  for (const rule of NODE_RULES) {
    if (rule.nodes?.includes(node.type) && active(rule.id, context.options)) rule.checkNode?.(node, path, context)
  }
}

function visitChildren(node: Node, path: string, context: LintContext, controls: Control[][]): void {
  forEachSlot(node, (nodes, step, single) => {
    if (single) {
      const child = nodes[0]
      if (child !== undefined) visit(child, `${path}/${step}`, context, controls)
    } else {
      for (let index = 0; index < nodes.length; index++) {
        const child = nodes[index]
        if (child !== undefined) visit(child, `${path}/${step}/${index}`, context, controls)
      }
    }
  }, SOURCE_ORDER)
}

function visit(node: Node, path: string, context: LintContext, controls: Control[][]): void {
  context.nodeTypes.set(path, node.type)
  if (node.attrs?.id !== undefined) context.state.ids.add(node.attrs.id)
  if (node.attrs !== undefined && node.pos !== undefined) context.state.attachedLines.add(node.pos.startLine)
  if (node.type === 'heading' && node.generatedId !== undefined) context.state.ids.add(node.generatedId)
  const pos = node.pos
  if (pos !== undefined) markNodeLines(context.lines, node.type === 'comment' && node.form === 'block' ? 'comment_block' :
    node.type, path, pos.startLine, pos.endLine)
  maskLeaf(node, path, context)
  const control = controlOf(node, context)
  if (control !== null && pos !== undefined) controls[pos.startLine]!.push(control)
  runNodeRules(node, path, context)
  visitChildren(node, path, context, controls)
}

const OPAQUE_LEAF_TYPES: readonly Node['type'][] = ['code', 'raw_inline', 'literal_inline', 'math', 'comment',
  'code_block', 'raw_block', 'frontmatter', 'include', 'link_reference_definition', 'abbreviation_def']

function maskLeaf(node: Node, path: string, context: LintContext): void {
  if (!OPAQUE_LEAF_TYPES.includes(node.type)) return
  const layout = context.layouts.get(path)
  const startByte = node.pos?.startOffset ?? layout?.startByte
  const endByte = node.pos?.endOffset ?? layout?.endByte
  if (startByte === undefined || endByte === undefined) return
  const start = context.chars[startByte] ?? 0
  const end = context.chars[endByte] ?? context.source.length
  context.leafMask.fill(1, start, end)
}

function maskLine(line: Line, mask: Uint8Array): Line {
  if (line.opaque) return line
  const chars = line.text.split('')
  let changed = false
  for (let at = 0; at < chars.length; at++) {
    if (mask[line.start + at] !== 1) continue
    chars[at] = '\0'
    changed = true
  }
  return changed ? { ...line, text: chars.join('') } : line
}

function named(control: Control, id: string): boolean {
  return control.ids.length === 0 || control.ids.includes(id)
}

function suppressed(id: string, line: number, controls: Control[][], state: Map<string, boolean>): boolean {
  const own = controls[line] ?? []
  const previous = controls[line - 1] ?? []
  for (const item of own) if (item.kind === 'disable-line' && named(item, id)) return true
  for (const item of previous) if (item.kind === 'disable-next-line' && named(item, id)) return true
  return state.get(id) === true
}

function findingsByLine(context: LintContext): Diagnostic[][] {
  const byLine: Diagnostic[][] = Array.from({ length: context.lines.length + 1 }, () => [])
  for (let index = 0; index < context.diagnostics.length; index++) {
    const diagnostic = context.diagnostics[index]
    const line = context.findingLines[index]
    if (diagnostic !== undefined && line !== undefined) byLine[line]!.push(diagnostic)
  }
  return byLine
}

function updateDocumentScope(items: Control[], state: Map<string, boolean>): void {
  for (const control of items) {
    if (control.kind !== 'disable' && control.kind !== 'enable') continue
    const ids = control.ids.length === 0 ? Object.keys(CATALOG) : control.ids
    for (const id of ids) state.set(id, control.kind === 'disable')
  }
}

function filterControls(context: LintContext, controls: Control[][]): Diagnostic[] {
  const state = new Map<string, boolean>()
  const byLine = findingsByLine(context)
  const output: Diagnostic[] = []
  for (let line = 1; line <= context.lines.length; line++) {
    updateDocumentScope(controls[line] ?? [], state)
    for (const diagnostic of byLine[line] ?? []) {
      if (!suppressed(diagnostic.code, line, controls, state)) output.push(diagnostic)
    }
  }
  return output
}

function positionOrder(context: LintContext, diagnostics: Diagnostic[]): Diagnostic[] {
  const buckets = new Map<number, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    const at = diagnostic.range?.startOffset ?? 0
    const bucket = buckets.get(at)
    if (bucket === undefined) buckets.set(at, [diagnostic])
    else bucket.push(diagnostic)
  }
  const output: Diagnostic[] = []
  const length = context.bytes[context.source.length] ?? 0
  for (let at = 0; at <= length; at++) {
    const bucket = buckets.get(at)
    if (bucket !== undefined) output.push(...bucket)
  }
  return output
}

/** C2-W-103, C2-W-109: lint a 0.2 source with catalog messages and byte ranges. */
export function lint(source: string, options: LintOptions = {}): Diagnostic[] {
  const parsed = parseWithLayout(source)
  const position = sourceLines(source)
  const context: LintContext = {
    source, ...position, leafMask: new Uint8Array(source.length), options,
    layouts: new Map(parsed.layout.nodes.map((entry) => [entry.path, entry])), nodeTypes: new Map(),
    diagnostics: [], findingLines: [],
    state: { headingLevel: 0, headingKinds: new Set(), mixedReported: false, referenceUrls: new Set(), ids: new Set(),
      fragmentLinks: [], footnoteLabels: new Map(), attachedLines: new Set(),
      usedReferences: new Set(), usedFootnotes: new Set(), referenceDefinitions: [], footnoteDefinitions: [] },
    report(id, start, end, path, values = {}, index = 0) {
      const boundedStart = Math.max(0, Math.min(start, source.length))
      const boundedEnd = Math.max(boundedStart, Math.min(end, source.length))
      const startOffset = position.bytes[boundedStart] ?? 0
      const endOffset = position.bytes[boundedEnd] ?? startOffset
      context.diagnostics.push({ code: id, severity: CATALOG[id].severity, channel: 'lint',
        message: message(id, values, index), path, range: { startOffset, endOffset } })
      context.findingLines.push(position.offsetLines[boundedStart] ?? 1)
    },
  }
  const controls: Control[][] = Array.from({ length: context.lines.length + 1 }, () => [])
  visit(parsed.document, '', context, controls)
  finishStructure(context)
  const scanLines = context.lines.map((line) => maskLine(line, context.leafMask))
  for (const line of scanLines) {
    if (line.opaque) continue
    for (const rule of LINE_RULES) {
      if (active(rule.id, options)) rule.checkLine?.(line, context)
    }
  }
  return positionOrder(context, filterControls(context, controls))
}

export const IMPLEMENTED_RULES: readonly Rule[] = [...LINE_RULES, ...NODE_RULES]
export type { LintOptions } from './types.ts'
