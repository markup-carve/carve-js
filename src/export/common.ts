// What the Markdown, plain-text and ANSI exports share: the resolved copy of the tree, the loss record and the text
// of the nodes whose output does not depend on the target.
import {
  type DocumentNode, type FootnoteNode, type ImageNode, type IncludeNode, type Inline, type LinkNode, type Node, type NodeHandlers,
  type SmartPunctuationNode,
} from '../ast.ts'
import { validateTree } from '../ast-validate.ts'
import { derivedTextBudget } from '../derived-text.ts'
import { type Diagnostic, type Findings, locateFindings } from '../diagnostics.ts'
import { isUrlAllowed } from '../html-attributes.ts'
import { CarveOptionError, checkType, type UrlPolicy } from '../options.ts'
import { utf8Length } from '../positions.ts'
import { resolve, type Resolution } from '../resolve.ts'
import { smartGlyph } from '../ast-text.ts'
import { includeMessage } from '../expand.ts'
import { includeSource } from '../include.ts'
import { expandSnippets, SNIPPET_BUDGETS } from '../snippet-expand.ts'

/** The options every export reads. */
export interface ExportOptions {
  /** Writes the glyph of smart punctuation (the default), or the characters as typed when false. */
  smartTypography?: boolean
  /** Throws `CarveExportError` instead of returning a result that lost something. */
  strictLosses?: boolean
  /** The schemes a link or an image may use; a denied destination is written empty and reported. */
  urlPolicy?: UrlPolicy
}

/** What an export returns: its text and the losses of the run. */
export interface ExportResult {
  output: string
  diagnostics: Diagnostic[]
}

/** Thrown under `strictLosses` when the export lost something. */
export class CarveExportError extends Error {
  diagnostics: Diagnostic[]

  constructor(diagnostics: Diagnostic[]) {
    const codes = diagnostics.map((entry) => entry.code).join(', ')
    super(`the export lost ${diagnostics.length} construct${diagnostics.length === 1 ? '' : 's'}: ${codes}`)
    this.name = 'CarveExportError'
    this.diagnostics = diagnostics
  }
}

export type ExportTarget = 'markdown' | 'plain' | 'ansi'

/** The loss codes only the exports report, beside the render-loss codes of the catalog they share with HTML. */
export const EXPORT_LOSS_CODES: readonly string[] = [
  'markdown-container-flattened', 'markdown-caption-flattened', 'markdown-attributes-dropped', 'fence-title-dropped', 'raw-html-escaped',
  'table-header-row-demoted', 'table-header-cell-demoted', 'list-style-dropped', 'table-span-flattened', 'ruby-flattened',
  'editorial-comment-flattened',
]

/** The bound of a recursive walk, above the parser's own nesting limit, for supplied trees. */
export const MAX_EXPORT_DEPTH = 1000

export interface Exporter {
  target: ExportTarget
  document: DocumentNode
  resolution: Resolution
  smartTypography: boolean
  urlPolicy: UrlPolicy
  losses: Findings
  derivedBudget: number
  /** Bytes of derived text (abbreviation expansions, cross-reference labels) still allowed in this run. */
  derivedLeft: number
  derivedReported: boolean
  depth: number
  linkDepth: number
}

function checkPolicy(value: unknown): void {
  if (typeof value !== 'object' || value === null) throw new CarveOptionError('urlPolicy', 'not an object')
  for (const [name, list] of Object.entries(value)) {
    if (name !== 'deny' && name !== 'allow') throw new CarveOptionError('urlPolicy', `unknown field ${name}`)
    if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) {
      throw new CarveOptionError('urlPolicy', `${name} is not a list of schemes`)
    }
  }
}

/** The output of the handler of `node`'s type, or undefined where the table has none. */
export function dispatch<C>(table: NodeHandlers<string, C>, node: Node, context: C): string | undefined {
  const handler = table[node.type] as ((node: Node, context: C) => string) | undefined
  return handler?.(node, context)
}

/** Every node of the tree below `root`, its slots and the fields that hold nodes included. */
export function eachNode(root: Node, visit: (node: Node) => void): void {
  const pending: Node[] = [root]
  const push = (value: unknown): void => {
    if (typeof value === 'object' && value !== null && 'type' in value) pending.push(value as Node)
  }
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    visit(node)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(push)
      else push(value)
    }
  }
}

/**
 * Refuses an options value that is not an object, an unknown name, or a value of the wrong kind. `own` names further
 * boolean options; `headingShift` is an option of the Markdown export only (C2-H-209).
 */
export function checkExportOptions(options: unknown, own: readonly string[] = [], target?: ExportTarget): void {
  if (options === undefined) return
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new CarveOptionError('options', 'not an object')
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (name === 'smartTypography' || name === 'strictLosses' || own.includes(name)) {
      if (typeof value !== 'boolean') throw new CarveOptionError(name, 'not a boolean')
    } else if (name === 'urlPolicy') checkPolicy(value)
    else if (name === 'headingShift' && target === 'markdown') checkType(name, value)
    else throw new CarveOptionError(name, 'unknown option')
  }
}

/** Validates `document`, then expands and resolves a copy, so the caller's tree is not changed. */
export function startExport(target: ExportTarget, document: DocumentNode, options: ExportOptions | undefined): Exporter {
  const summary = { snippetUses: false }
  validateTree(document, undefined, undefined, [], undefined, summary)
  const copy = structuredClone(document)
  const losses: Findings = { entries: [], nodes: [] }
  if (summary.snippetUses) expandSnippets(copy, losses, { roundtrip: false, source: undefined }, document)
  const snippetBudget = SNIPPET_BUDGETS.get(copy)
  const resolution = resolve(copy, 'keep-case', null)
  const derivedBudget = snippetBudget?.budget ?? derivedTextBudget(document, undefined)
  return {
    target, document: copy, resolution, smartTypography: options?.smartTypography !== false, urlPolicy: options?.urlPolicy ?? {},
    losses, derivedBudget, derivedLeft: snippetBudget?.left ?? derivedBudget,
    derivedReported: snippetBudget?.reported ?? false, depth: 0, linkDepth: 0,
  }
}

/** The result of a run: the losses take their positions from the copy, which keeps the positions of the input. */
export function finishExport(x: Exporter, output: string, strict: boolean | undefined): ExportResult {
  const diagnostics = locateFindings(x.document, x.losses)
  if (strict === true && diagnostics.length > 0) throw new CarveExportError(diagnostics)
  return { output, diagnostics }
}

export function loss(x: Exporter, node: Node | null, code: string, message: string, severity: 'warning' | 'error' = 'warning'): void {
  x.losses.entries.push({ code, severity, channel: 'render-loss', message })
  x.losses.nodes.push(node)
}

/** Descends one level of the tree, refusing a supplied tree nested past `MAX_EXPORT_DEPTH`. */
export function nested<T>(x: Exporter, run: () => T): T {
  if (x.depth >= MAX_EXPORT_DEPTH) throw new CarveOptionError('document', `nested deeper than ${MAX_EXPORT_DEPTH} levels`)
  x.depth++
  try {
    return run()
  } finally {
    x.depth--
  }
}

export function insideLink<T>(x: Exporter, run: () => T): T {
  x.linkDepth++
  try {
    return run()
  } finally {
    x.linkDepth--
  }
}

/**
 * Takes `text` from the budget of derived text (C2-H-201). Past the budget the caller writes the plain form, and
 * the first such occurrence is reported.
 */
export function drawDerived(x: Exporter, node: Node, text: string): boolean {
  const cost = utf8Length(text)
  if (cost <= x.derivedLeft) {
    x.derivedLeft -= cost
    return true
  }
  if (!x.derivedReported) {
    x.derivedReported = true
    loss(x, node, 'derived-text-budget', 'Wrote an abbreviation or a cross-reference in its plain form: ' +
      `the derived text of this render reached its budget of ${x.derivedBudget} bytes`)
  }
  return false
}

/** The destination of a link or an image, empty where the URL policy denies its scheme (reported on `node`). */
export function allowedDestination(x: Exporter, url: string, node: Node): string {
  if (isUrlAllowed(url, x.urlPolicy)) return url
  const message = node.type === 'image' ? 'Blanked a denied image source' : 'Blanked a denied destination scheme'
  loss(x, node, 'destination-denied', message, 'error')
  return ''
}

export function rawDropped(x: Exporter, node: Node & { format: string }, block: boolean): void {
  loss(x, node, 'raw-format-dropped', `Dropped ${block ? 'block' : 'inline'} raw format "${node.format}" while rendering ${x.target}`)
}

export function smartText(x: Exporter, node: SmartPunctuationNode): string {
  return x.smartTypography ? smartGlyph(node) : node.source
}

/** C2-H-086: the label part of an unresolved reference, as typed. */
export function referenceLabel(node: LinkNode | ImageNode, key: string): string {
  if (node.refForm === 'collapsed') return '[]'
  if (node.refForm === 'shortcut') return ''
  return `[${key}]`
}

/** Whether a link or an image is a reference that found no definition. */
export function isUnresolved(node: LinkNode | ImageNode): boolean {
  return node.key !== undefined && (node.type === 'link' ? node.href === undefined : node.src === undefined)
}

/** The text a cross-reference stands for, or its source where it found no target. */
export function xrefText(x: Exporter, node: Node & { type: 'xref', key: string, href?: string }): { text: string, resolved: boolean } {
  const text = node.href === undefined ? undefined : x.resolution.xrefText.get(node)
  if (text === undefined) return { text: `</#${node.key}>`, resolved: false }
  return { text: drawDerived(x, node, text) ? text : node.key, resolved: true }
}

/** C2-H-133: an include that was not expanded is written as its source line, and reported. */
export function unexpandedInclude(x: Exporter, node: IncludeNode): string {
  loss(x, node, 'include-unresolved', includeMessage('include-unresolved', { path: node.path }))
  return includeSource(node)
}

/** The number of the note of a footnote reference or an inline footnote, where it has one. */
export function noteNumber(x: Exporter, node: Node): number | undefined {
  return x.resolution.noteOf.get(node)?.number
}

function isBlank(value: string): boolean {
  return /^[ \t]*$/u.test(value)
}

/** Whether the line that starts beside `from` and runs in the direction `step` holds only comments and spaces. */
function isCommentOnlyLine(nodes: readonly Inline[], from: number, step: number, atEnd: boolean, nested: boolean): boolean {
  let comment = false
  for (let at = from; at >= 0 && at < nodes.length; at += step) {
    const node = nodes[at]!
    if (node.type === 'comment') comment = true
    else if (node.type === 'soft_break' || node.type === 'hard_break') return comment && !atEnd
    else if (node.type !== 'text' || !isBlank(node.value)) return false
  }
  return comment && !nested
}

/**
 * C2-H-069: a comment-only line takes one line break with it, the one behind it, or the one before it where the
 * content ends with the comment. `nested` is true for the children of an inline node.
 */
export function isSkippedBreak(nodes: readonly Inline[], at: number, nested: boolean): boolean {
  return isCommentOnlyLine(nodes, at - 1, -1, false, nested) || isCommentOnlyLine(nodes, at + 1, 1, true, nested)
}

/** The footnote definitions of the document in source order, the first of each key only. */
export function footnoteDefinitions(document: DocumentNode): FootnoteNode[] {
  const found: FootnoteNode[] = []
  const keys = new Set<string>()
  const visit = (children: readonly Node[]): void => {
    for (const child of children) {
      if (child.type === 'include') visit(child.children ?? [])
      if (child.type !== 'footnote' || keys.has(child.key)) continue
      keys.add(child.key)
      found.push(child)
    }
  }
  visit(document.children)
  return found
}

/** Bidirectional controls the exports never write (U+202A to U+202E, U+2066 to U+2069). */
export function stripBidi(text: string): string {
  return text.replace(/[‪-‮⁦-⁩]/gu, '')
}

/** The text of each inline type that is not the text of its children. */
const PLAIN_TEXT: NodeHandlers<string, Exporter> = {
  text: (node) => node.value,
  code: (node) => node.value,
  literal_inline: (node) => node.value,
  math: (node) => node.value,
  smart_punctuation: (node, x) => smartText(x, node),
  soft_break: () => ' ',
  hard_break: () => ' ',
  non_breaking_space: () => ' ',
  autolink: (node) => node.text ?? node.href,
  image: (node) => node.alt ?? '',
  abbreviation: (node) => node.key,
  symbol: (node) => `:${node.name}:`,
  mention: (node) => node.label ?? `@${node.target}`,
  tag: (node) => `#${node.name}`,
  xref: (node, x) => x.resolution.xrefText.get(node) ?? `</#${node.key}>`,
  caption_number: (node) => (node.n === undefined ? '#' : String(node.n)),
  citation_group: (node) => node.raw,
  critic_comment: (node) => node.value,
  comment: () => '',
  raw_inline: () => '',
  ruby: (node, x) => node.pairs.map((pair) => plainInlineText(x, pair.base)).join(''),
}

/** The text of inline content with no styling, for a measure or a slug. */
export function plainInlineText(x: Exporter, nodes: readonly Inline[]): string {
  let out = ''
  for (const node of nodes) {
    const own = dispatch(PLAIN_TEXT, node, x)
    if (own !== undefined) out += own
    else if ('children' in node && Array.isArray(node.children)) out += plainInlineText(x, node.children as readonly Inline[])
  }
  return out
}
