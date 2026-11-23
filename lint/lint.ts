import { forEachSlot, type Node, SOURCE_ORDER } from '../src/ast.ts'
import { parseWithLayoutForLint } from '../src/api.ts'
import { isCompactEmptyCell } from '../src/ast-table.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { CarveOptionError } from '../src/options.ts'
import { CATALOG, type RuleId } from './catalog.ts'
import { LINE_RULES } from './spelling.ts'
import { finishStructure, NODE_RULES } from './structure.ts'
import { lintIncludes } from './includes.ts'
import { markNodeLines, sourceLines } from './source.ts'
import { type Line, type LintContext, type LintOptions, type Rule } from './types.ts'
import { append } from '../src/append.ts'
import { DATA_RULE_IDS, runDataRules, startDataWalk } from './data-rules.ts'
import { DATA_RULES } from './data-tables.ts'

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
    if (!active(rule.id, options) || DATA_RULE_IDS.has(rule.id)) continue
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
      if (child === undefined) return
      const childPath = `${path}/${step}`
      context.dataWalk?.child(child, childPath, node, path, 0)
      visit(child, childPath, context, controls)
    } else {
      for (let index = 0; index < nodes.length; index++) {
        const child = nodes[index]
        if (child === undefined) continue
        if (inertTableNode(node, child, index, nodes.length, context)) continue
        const childPath = `${path}/${step}/${index}`
        context.dataWalk?.child(child, childPath, node, path, index)
        visit(child, childPath, context, controls)
      }
    }
  }, SOURCE_ORDER)
}

/** Keep the last cell as the line model's leaf, but omit preceding cells with no lint facts. */
function inertTableNode(parent: Node, child: Node, index: number, count: number, context: LintContext): boolean {
  if (child.type === 'table_column') return Object.keys(child).length === 1
  return parent.type === 'table_row' && index < count - 1 && child.type === 'table_cell'
    && (isCompactEmptyCell(child) || plainEmptyCell(child, context))
}

function plainEmptyCell(node: Node, context: LintContext): boolean {
  if (node.type !== 'table_cell' || node.header || node.pos === undefined || node.children.length !== 1) return false
  if (Object.keys(node).some((key) => key !== 'type' && key !== 'header' && key !== 'children' && key !== 'pos')) return false
  const paragraph = node.children[0]
  if (paragraph?.type !== 'cell_paragraph' || paragraph.children.length !== 0) return false
  const start = context.chars[node.pos.startOffset]
  const end = context.chars[node.pos.endOffset]
  return start !== undefined && end !== undefined && context.source.slice(start, end).trim() === ''
}

function markDescriptionAndCloser(node: Node, context: LintContext): void {
  const pos = node.pos
  if (pos === undefined) return
  if (['div', 'admonition', 'figure_group', 'line_block', 'block_quote'].includes(node.type) && pos.endLine > pos.startLine
    && /^\s*:{3,}\s*$/.test(context.lines[pos.endLine - 1]?.text ?? '')) context.state.containerClosers.add(pos.endLine)
}

/** The footnote and reference keys that several rules read, collected whichever of them run by hand. */
function collectKeys(node: Node, path: string, context: LintContext): void {
  if (node.type === 'footnote') context.state.footnoteKeys.set(path, node.key)
  // The platform rules read the used footnote keys.
  else if (node.type === 'footnote_ref') context.state.usedFootnotes.add(node.key)
}

function visit(node: Node, path: string, context: LintContext, controls: Control[][]): void {
  context.nodeTypes.set(path, node.type)
  collectKeys(node, path, context)
  if (node.attrs !== undefined && node.pos !== undefined) context.state.attachedLines.add(node.pos.startLine)
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
  if (!BLOCK_OPAQUE.has(node.type)) unmaskQuotePrefixes(path, start, end, context)
}

// C2-B-027: the quote marks that prefix a later line of an inline span in a quote are no characters of the span.
function unmaskQuotePrefixes(path: string, start: number, end: number, context: LintContext): void {
  let quotes = 0
  for (let at = path.lastIndexOf('/children/'); at > 0; at = path.lastIndexOf('/children/', at - 1)) {
    if (context.nodeTypes.get(path.slice(0, at)) === 'block_quote') quotes++
  }
  if (quotes === 0) return
  for (let line = context.source.indexOf('\n', start); line >= 0 && line + 1 < end; line = context.source.indexOf('\n', line + 1)) {
    context.leafMask.fill(0, line + 1, Math.min(quotePrefixEnd(context.source, line + 1, quotes), end))
  }
}

/** The end of up to `quotes` quote marks, each with its leading and one following space or tab, from `at`. */
function quotePrefixEnd(source: string, at: number, quotes: number): number {
  const blank = (char: string | undefined): boolean => char === ' ' || char === '\t'
  for (let mark = 0; mark < quotes; mark++) {
    while (blank(source[at])) at++
    if (source[at] !== '>') break
    at++
    if (blank(source[at])) at++
  }
  return at
}

const BLOCK_OPAQUE: ReadonlySet<Node['type']> = new Set(['code_block', 'raw_block', 'frontmatter', 'link_reference_definition', 'abbreviation_def'])

function needsMasking(line: Line, mask: Uint8Array): boolean {
  return !line.opaque && (line.text.includes('\\') || mask.subarray(line.start, line.end).includes(1))
}

function maskLine(line: Line, mask: Uint8Array): Line {
  if (!needsMasking(line, mask)) return line
  const chars = line.text.split('')
  let changed = false
  // The backslashes right before `at`, counted as the loop goes: counting back from each one made a run quadratic.
  let slashes = 0
  for (let at = 0; at < chars.length; at++) {
    const code = line.text.charCodeAt(at)
    const punct = (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96)
      || (code >= 123 && code <= 126)
    const before = punct ? slashes : 0
    slashes = code === 92 ? slashes + 1 : 0
    if (mask[line.start + at] !== 1 && before % 2 === 0) continue
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

const NODE_ORDER: ReadonlyMap<string, number> = new Map([
  ['include-attributes-unused', 0],
  ['include-lines-table-rows-hint', 1],
  ['deprecated-bare-underline', 2],
  ['deprecated-bare-strike', 3],
  ['deprecated-bare-highlight', 4],
  ['markdown-strong-double-star', 5],
  ['markdown-strikethrough-double-tilde', 6],
  ['djot-emphasis-underscore', 7],
  ['djot-subscript-tilde', 8],
  ['djot-superscript-caret', 9],
  ['a11y/image-alt', 10],
  ['empty-link-destination', 11],
  ['deprecated-loose-attribute', 12],
  ['deprecated-table-attribute', 13],
  ['heading-level-skip', 14],
  ['heading-marker-mixed', 15],
  ['heading-closing-hashes', 16],
  ['heading-trailing-attribute', 17],
  ['duplicate-reference-url', 18],
  ['deprecated-separator-row', 19],
  ['table-row-cell-count', 20],
  ['figure-group-empty', 21],
  ['figure-group-single-panel', 22],
  ['deprecated-substitution-arrow', 23],
  ['frontmatter-shaped-thematic-break', 24],
  ['blockquote-marker-without-space', 25],
  ['html-comment-renders-as-text', 26],
  ['bidi-control-in-source', 27],
  ['description-term-multi-line', 28],
  ['deprecated-indented-line-under-heading', 29],
  ['figure-group-nested', 30],
  ['figure-group-panel-number', 31],
  ['footnotes-placement-in-container', 32],
  ['semantic-attribute-outside-span', 34],
  ['semantic-attribute-value-ignored', 35],
  ['table-column-arity', 36],
  ['table-attribute-invalid', 37],
  ['table-row-count-clamped', 38],
  ['comment-splits-table-row', 39],
  ['table-width-total', 40],
  ['table-row-attribute-as-cell', 41],
  ['emphasis-as-heading', 42],
  ['comment-shaped-emphasis', 43],
  ['glob-shaped-strong', 44],
  ['djot-subscript-tilde-braced', 45],
  ['djot-highlight-braces', 46],
  ['unattached-inline-attribute', 47],
  ['deprecated-cell-alignment', 48],
  ['table-marker-run-padding', 49],
  ['fence-closer-indented', 50],
  ['figure-group-opener-metadata', 51],
  ['comment-line-in-line-block', 52],
  ['broken-crossref', 53],
  ['broken-fragment-link', 54],
  ['platform-issue-reference', 55],
  ['platform-mention-token', 56],
  ['delimited-table-wide-row', 57],
  ['djot-intraword-underscore', 58],
  ['emphasis-marker-before-attributes', 59],
  ['emphasis-marker-before-attributes', 60],
  ['carve-version-unsupported', 61],
  ['blank-reference-label', 62],
  ['comment-fence-closer-with-text', 63],
  ['comment-in-reference-label', 64],
  ['footnote-labels-differ-only-in-whitespace', 65],
  ['table-column-overlap', 66],
  ['tight-list-item-with-blank-line', 67],
  ['braced-comment-in-a-template-source', 68],
  ['region-marker-renders-as-text', 69],
  ['unclosed-braced-comment', 70],
  ['unclosed-inline-emphasis', 71],
  ['ordered-list-kind-split', 72],
  ['sigil-after-letter', 73],
  ['list-item-body-below-content-column', 74],
  ['list-item-block-overindented', 75],
  ['list-marker-below-content-column', 76],
  ['block-opener-overindented', 77],
  ['braced-span-opener-as-text', 78],
  ['consumed-key-near-miss', 79],
  ['ordered-marker-right-aligned', 80],
  ['table-span-marker-blocked', 81],
  ['table-span-marker-attribute', 82],
  ['uneven-list-indent', 83],
  ['non-descriptive-link-text', 84],
  ['unresolved-reference-link', 85],
  ['unused-link-reference-definition', 86],
  ['unresolved-footnote', 87],
  ['unused-footnote-definition', 88],
])

const LINE_ORDER: ReadonlyMap<string, number> = new Map([
  ['deprecated-continuation-marker', 0],
  ['thematic-break-spelling', 1],
  ['setext-heading-underline', 2],
  ['deprecated-spaced-thematic-break', 3],
  ['block-marker-as-text', 4],
  ['html-comment-renders-as-text', 5],
  ['bare-html-tag', 6],
  ['empty-reference-definition', 7],
  ['table-shaped-paragraph', 8],
  ['blockquote-marker-without-space', 9],
  ['block-opener-without-blank-line', 10],
  ['list-marker-without-blank-line', 11],
  ['indented-code-block', 12],
  ['unattached-caption', 13],
  ['unattached-block-attribute', 14],
  ['markdown-definition-paragraph', 15],
  ['empty-include-path', 16],
  ['link-gap-before-destination', 17],
  ['djot-plus-bullet', 18],
  ['definition-in-container', 19],
  ['definition-term-block-folded', 20],
  ['github-alert-marker', 21],
  ['djot-heading-continuation', 22],
  ['quote-fence-ends-the-quote-above', 23],
  ['region-marker-renders-as-text', 24],
  ['caption-looking-paragraph', 25],
  ['colon-fence-length-mismatch', 26],
  ['description-separator-below-content-column', 27],
])

const DIAGNOSTIC_KIND: ReadonlyMap<string, number> = new Map([
  ...DATA_RULES.map((rule): [string, number] => [rule.id, rule.over === 'line' ? 2 : 1]),
  ...NODE_RULES.map((rule): [string, number] => [rule.id, 1]),
  ...LINE_RULES.map((rule): [string, number] => [rule.id, 2]),
])

function diagnosticOrigin(diagnostic: Diagnostic): string {
  const path = diagnostic.path ?? ''
  if (diagnostic.code !== 'table-row-cell-count') return path
  const row = path.lastIndexOf('/children/')
  const group = path.lastIndexOf('/children/', row - 1)
  return group < 0 ? path : path.slice(0, group)
}

function diagnosticKind(diagnostic: Diagnostic): number {
  return diagnostic.channel === 'lint' ? (DIAGNOSTIC_KIND.get(diagnostic.code) ?? 1) : 0
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
  let visitOrder: Map<string, number> | undefined
  const length = context.bytes[context.source.length] ?? 0
  for (let at = 0; at <= length; at++) {
    const bucket = buckets.get(at)
    if (bucket !== undefined && bucket.length > 1) {
      bucket.sort((a, b) => {
        const aKind = diagnosticKind(a)
        const bKind = diagnosticKind(b)
        if (aKind !== bKind) return aKind - bKind
        if (aKind === 1) {
          visitOrder ??= new Map([...context.nodeTypes.keys()].map((path, index) => [path, index]))
          const visit = (visitOrder.get(diagnosticOrigin(a)) ?? 0) - (visitOrder.get(diagnosticOrigin(b)) ?? 0)
          if (visit !== 0) return visit
          return (NODE_ORDER.get(a.code) ?? 999) - (NODE_ORDER.get(b.code) ?? 999)
        }
        if (aKind === 2) return (LINE_ORDER.get(a.code) ?? 999) - (LINE_ORDER.get(b.code) ?? 999)
        return 0
      })
    }
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
  const facts: SourceFacts = { includes: true }
  const own = lintSource(source, options, facts)
  if (options.includes === undefined) return own
  const rest: LintOptions = { ...options }
  // With extensions the expansion, which parses without them, may read another tree.
  const expands = facts.includes || options.extensions !== undefined
  const all = lintIncludes(source, options.includes, own, (text) => lintSource(text, rest),
    (text, node, path) => lintPayload(text, node, path, rest), expands)
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
    state: { headingLevel: 0, headingKinds: new Set(), mixedReported: false, firstHeading: null, referenceUrls: new Set(),
      footnoteKeys: new Map(), attachedLines: new Set(),
      containerClosers: new Set(),
      usedReferences: new Set(), usedFootnotes: new Set(),
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

interface SourceFacts { includes: boolean }

function lintSource(source: string, options: LintOptions, facts?: SourceFacts): Diagnostic[] {
  const parsed = parseWithLayoutForLint(source, { ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(options.headingIds === undefined ? {} : { headingIds: options.headingIds }) })
  if (facts !== undefined) facts.includes = parsed.includes
  const context = createContext(source, options, new Map(parsed.layout.nodes.map((entry) => [entry.path, entry])))
  context.resolved = parsed.resolved
  const controls: Control[][] = Array.from({ length: context.lines.length + 1 }, () => [])
  // The default rule set is the same on every call, so its compiled rule lists are kept.
  const defaults = options.rules === undefined && options.platforms === undefined
  const walk = startDataWalk(parsed.document, context, (id) => active(id, options), defaults)
  if (walk !== undefined) context.dataWalk = walk
  visit(parsed.document, '', context, controls)
  finishStructure(context)
  const scanLines = context.lines.map((line) => maskLine(line, context.leafMask))
  const activeLineRules = LINE_RULES.filter((rule) => active(rule.id, options) && !DATA_RULE_IDS.has(rule.id))
  for (const line of scanLines) {
    if (line.opaque) continue
    for (const rule of activeLineRules) rule.checkLine?.(line, context)
  }
  if (walk !== undefined) runDataRules(walk, { ...context, lines: scanLines }, (id) => active(id, options), defaults)
  const parseFindings = parsed.diagnostics.filter((entry) => options.includes === undefined || entry.code !== 'include-no-resolver')
  return positionOrder(context, [...parseFindings, ...filterControls(context, controls)])
}

export const IMPLEMENTED_RULES: readonly Rule[] = [
  ...[...LINE_RULES, ...NODE_RULES].filter((rule) => !DATA_RULE_IDS.has(rule.id)),
  ...DATA_RULES.map((rule): Rule => ({ id: rule.id, ...(rule.over === 'line' ? { lines: true } : {}) })),
  // A void catalog row is accepted as a rule setting and never reports.
  ...(Object.keys(CATALOG) as RuleId[]).filter((id) => 'status' in CATALOG[id] && CATALOG[id].status === 'void')
    .map((id): Rule => ({ id })),
]
export type { LintOptions } from './types.ts'
