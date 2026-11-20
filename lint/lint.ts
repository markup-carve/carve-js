import { forEachSlot, type Node, SOURCE_ORDER } from '../src/ast.ts'
import { parseWithLayout } from '../src/api.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { CarveOptionError } from '../src/options.ts'
import { CATALOG, type RuleId } from './catalog.ts'
import { LINE_RULES } from './spelling.ts'
import { finishStructure, NODE_RULES } from './structure.ts'
import { lintIncludes } from './includes.ts'
import { markNodeLines, sourceLines } from './source.ts'
import { type Line, type LintContext, type LintOptions, type Rule } from './types.ts'
import { append } from '../src/append.ts'

interface Control {
  kind: 'disable-line' | 'disable-next-line' | 'disable' | 'enable'
  ids: string[]
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** C2-H-137, C2-W-109: validate the lint options before reading any value. */
function validateRuleSettings(rules: unknown): void {
  if (rules === undefined) return
  if (!plainRecord(rules)) throw new CarveOptionError('rules', 'not a map')
  for (const [name, value] of Object.entries(rules)) {
    if (!Object.hasOwn(CATALOG, name) || (value !== 'on' && value !== 'off')) {
      throw new CarveOptionError('rules', `invalid rule ${name}`)
    }
  }
}

function validateOptions(options: unknown): asserts options is LintOptions {
  if (!plainRecord(options)) throw new CarveOptionError('lint', 'not an object')
  for (const name of Object.keys(options)) {
    if (name !== 'rules' && name !== 'platforms' && name !== 'includes' && name !== 'extensions' && name !== 'headingIds') {
      throw new CarveOptionError(name, 'unknown option')
    }
  }
  const platforms = options['platforms']
  if (platforms !== undefined && (!Array.isArray(platforms) || !platforms.every((item) => item === 'github'))) {
    throw new CarveOptionError('platforms', 'not a list of supported platform names')
  }
  validateRuleSettings(options['rules'])
  if (options['headingIds'] !== undefined && !['off', 'keep-case', 'lower', 'ascii', 'ascii-lower', 'ascii-strict', 'ascii-strict-lower'].includes(String(options['headingIds']))) {
    throw new CarveOptionError('headingIds', 'unknown value')
  }
}

function active(id: RuleId, options: LintOptions): boolean {
  if ('status' in CATALOG[id] && CATALOG[id].status === 'void') return false
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
  for (const rule of context.nodeRules.get(node.type) ?? []) rule.checkNode?.(node, path, context)
}

function nodeRulesByType(options: LintOptions): Map<Node['type'], Rule[]> {
  const byType = new Map<Node['type'], Rule[]>()
  for (const rule of NODE_RULES) {
    if (!active(rule.id, options)) continue
    for (const type of rule.nodes ?? []) {
      const rules = byType.get(type)
      if (rules === undefined) byType.set(type, [rule])
      else rules.push(rule)
    }
  }
  return byType
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

function markSpanStarts(children: readonly Node[], context: LintContext): void {
  for (const child of children) {
    const at = child.type === 'text' || child.pos === undefined ? undefined : context.chars[child.pos.startOffset]
    if (at !== undefined) context.state.spanStarts.add(at)
  }
}

function markDescriptionAndCloser(node: Node, context: LintContext): void {
  const pos = node.pos
  if (pos === undefined) return
  if (node.type === 'definition_description') context.state.descriptionStarts.add(pos.startLine)
  if (['div', 'admonition', 'figure_group', 'line_block', 'block_quote'].includes(node.type) && pos.endLine > pos.startLine
    && /^\s*:{3,}\s*$/.test(context.lines[pos.endLine - 1]?.text ?? '')) context.state.containerClosers.add(pos.endLine)
}

function visit(node: Node, path: string, context: LintContext, controls: Control[][]): void {
  context.nodeTypes.set(path, node.type)
  if (node.type === 'footnote') context.state.footnoteKeys.set(path, node.key)
  if (node.attrs?.id !== undefined) {
    context.state.ids.add(node.attrs.id)
    context.state.idOwners.set(node.attrs.id, node.type)
  }
  if (node.attrs !== undefined && node.pos !== undefined) context.state.attachedLines.add(node.pos.startLine)
  if (node.type === 'paragraph') markSpanStarts(node.children, context)
  if (node.type === 'heading' && node.generatedId !== undefined) {
    context.state.ids.add(node.generatedId)
    context.state.idOwners.set(node.generatedId, node.type)
  }
  const pos = node.pos
  markDescriptionAndCloser(node, context)
  if (pos !== undefined) markNodeLines(context.lines, node.type === 'comment' && node.form === 'block' ? 'comment_block' :
    node.type, path, pos.startLine, pos.endLine)
  markContent(node, context)
  maskLeaf(node, path, context)
  const control = controlOf(node, context)
  if (control !== null && pos !== undefined) controls[pos.startLine]!.push(control)
  runNodeRules(node, path, context)
  visitChildren(node, path, context, controls)
}

const CONTENT_TYPES: ReadonlySet<Node['type']> = new Set(['paragraph', 'caption', 'line', 'heading', 'definition_term', 'thematic_break', 'table_row'])

/** A leaf block starts its first line's text, and each break ends where the next line's text starts. */
function markContent(node: Node, context: LintContext): void {
  const pos = node.pos
  if (pos === undefined) return
  const offset = CONTENT_TYPES.has(node.type) ? pos.startOffset
    : node.type === 'soft_break' || node.type === 'hard_break' ? pos.endOffset : undefined
  if (offset === undefined) return
  const line = context.lines[(node.type === 'soft_break' || node.type === 'hard_break' ? pos.endLine : pos.startLine) - 1]
  const at = context.chars[offset] ?? line?.start
  // A caption's paragraph starts behind the caption's own marker, which stays part of the line's text.
  if (line !== undefined && at !== undefined && (line.content === undefined || at < line.content)) line.content = at
}

const OPAQUE_LEAF_TYPES: readonly Node['type'][] = ['autolink', 'code', 'raw_inline', 'literal_inline', 'math', 'comment',
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

function needsMasking(line: Line, mask: Uint8Array): boolean {
  return !line.opaque && (line.text.includes('\\') || mask.subarray(line.start, line.end).includes(1))
}

function maskLine(line: Line, mask: Uint8Array): Line {
  if (!needsMasking(line, mask)) return line
  const chars = line.text.split('')
  let changed = false
  for (let at = 0; at < chars.length; at++) {
    const code = line.text.charCodeAt(at)
    const punct = (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96)
      || (code >= 123 && code <= 126)
    let slashes = 0
    if (punct) while (line.text[at - 1 - slashes] === '\\') slashes++
    if (mask[line.start + at] !== 1 && slashes % 2 === 0) continue
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
    if (bucket !== undefined) append(output, bucket)
  }
  return output
}

/**
 * C2-W-103, C2-W-109: lint a 0.2 source with catalog messages and byte ranges. C2-N-085: with `includes` the files it
 * includes are linted too, each finding of one with its `file` and a range in that file.
 */
export function lint(source: string, options: LintOptions = {}): Diagnostic[] {
  validateOptions(options)
  const own = lintSource(source, options)
  if (options.includes === undefined) return own
  const rest: LintOptions = { ...options }
  const all = lintIncludes(source, options.includes, own, (text) => lintSource(text, rest),
    (text, node, path) => lintPayload(text, node, path, rest))
  const seen = new Set<string>()
  return all.filter((entry) => {
    const key = `${entry.file ?? ''}\0${entry.code}\0${entry.range?.startOffset ?? ''}\0${entry.range?.endOffset ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function createContext(source: string, options: LintOptions, layouts: LintContext['layouts']): LintContext {
  const position = sourceLines(source)
  const context: LintContext = {
    source, ...position, leafMask: new Uint8Array(source.length), options, layouts, nodeTypes: new Map(),
    nodeRules: nodeRulesByType(options),
    diagnostics: [], findingLines: [],
    state: { headingLevel: 0, headingKinds: new Set(), mixedReported: false, firstHeading: null, referenceUrls: new Set(), ids: new Set(),
      idOwners: new Map(), fragmentLinks: [], crossrefs: [], footnoteLabels: new Map(), footnoteKeys: new Map(), attachedLines: new Set(),
      descriptionStarts: new Set(),
      containerClosers: new Set(),
      spanStarts: new Set(),
      usedReferences: new Set(), usedFootnotes: new Set(), referenceDefinitions: [], unresolvedReferences: [],
      footnoteDefinitions: [] },
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
  return context
}

// C2-N-086: the rules that read the payload of a block, which also run on the child of a code include.
const PAYLOAD_RULES: ReadonlySet<string> = new Set(['bidi-control-in-source'])

/** C2-N-086: the findings of the payload rules on `node`, a block whose positions count in `text`, the file it came from. */
export function lintPayload(text: string, node: Node, path: string, options: LintOptions): Diagnostic[] {
  const context = createContext(text, options, new Map())
  for (const rule of NODE_RULES) {
    if (PAYLOAD_RULES.has(rule.id) && rule.nodes?.includes(node.type) && active(rule.id, options)) rule.checkNode?.(node, path, context)
  }
  return context.diagnostics
}

function lintSource(source: string, options: LintOptions): Diagnostic[] {
  const parsed = parseWithLayout(source, { ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(options.headingIds === undefined ? {} : { headingIds: options.headingIds }) })
  const context = createContext(source, options, new Map(parsed.layout.nodes.map((entry) => [entry.path, entry])))
  const controls: Control[][] = Array.from({ length: context.lines.length + 1 }, () => [])
  visit(parsed.document, '', context, controls)
  finishStructure(context)
  const scanLines = context.lines.map((line) => maskLine(line, context.leafMask))
  const activeLineRules = LINE_RULES.filter((rule) => active(rule.id, options))
  for (const line of scanLines) {
    if (line.opaque) continue
    for (const rule of activeLineRules) rule.checkLine?.(line, context)
  }
  const parseFindings = parsed.diagnostics.filter((entry) => options.includes === undefined || entry.code !== 'include-no-resolver')
  return positionOrder(context, [...parseFindings, ...filterControls(context, controls)])
}

export const IMPLEMENTED_RULES: readonly Rule[] = [...LINE_RULES, ...NODE_RULES]
export type { LintOptions } from './types.ts'
