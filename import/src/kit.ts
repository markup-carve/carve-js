import {
  isUrlAllowed, MAX_TREE_DEPTH, validateTree, writeWithDiagnostics,
  type Attrs, type Block, type Diagnostic, type DocumentNode,
  type Inline, type ListNode, type TableCellNode, type TableRowNode,
} from '../../v2/src/index.ts'

export type Format = 'markdown' | 'gfm' | 'djot' | 'html'
export type ImportDiagnostic = Diagnostic & { foreignType?: string }
export interface ImportResult { document: DocumentNode, source: string, diagnostics: ImportDiagnostic[] }

export class ImportInputError extends Error {
  readonly code = 'import-input-error'
  readonly foreignType: string
  constructor(message: string, foreignType: string) { super(message); this.name = 'ImportInputError'; this.foreignType = foreignType }
}

/** C2-M-006, C2-M-082: runs one import; a refusal becomes `ImportInputError` and `strictLosses` makes each loss an error. */
export function runImport(format: Format, strictLosses: boolean, run: () => ImportResult): ImportResult {
  try {
    const result = run()
    if (strictLosses) for (const entry of result.diagnostics) {
      if (entry.channel === 'render-loss') entry.severity = 'error'
    }
    return result
  } catch (error) {
    if (error instanceof ImportInputError) throw error
    if (error instanceof RangeError && error.message.includes('stack')) {
      throw new ImportInputError(`Foreign input exceeds the engine tree depth limit of ${MAX_TREE_DEPTH}`, format)
    }
    throw new ImportInputError(error instanceof Error ? error.message : String(error), format)
  }
}

/** C2-A-026: foreign parsers can produce deeper trees than the engine can accept. */
export function ensureForeignDepth(root: unknown, format: Format): void {
  const pending: { value: unknown, depth: number }[] = [{ value: root, depth: 0 }]
  while (pending.length > 0) {
    const entry = pending.pop()
    if (entry === undefined) continue
    if (entry.depth > MAX_TREE_DEPTH) {
      throw new ImportInputError(`Foreign input exceeds the engine tree depth limit of ${MAX_TREE_DEPTH}`, format)
    }
    const value = entry.value
    if (value === null || typeof value !== 'object') continue
    const children: unknown = Reflect.get(value, 'children') ?? Reflect.get(value, 'childNodes')
    if (Array.isArray(children)) for (const child of children) pending.push({ value: child, depth: entry.depth + 1 })
    const content: unknown = Reflect.get(value, 'content')
    if (content !== null && typeof content === 'object') pending.push({ value: content, depth: entry.depth + 1 })
  }
}

export interface Context {
  format: Format
  input: string
  /** C2-M-065, C2-M-066: comments and raw elements are kept only with `rawHtml` on. */
  rawHtml?: boolean
  diagnostics: ImportDiagnostic[]
  deferred?: DocumentNode['children']
  rootLang?: string
  rootDir?: 'ltr' | 'rtl' | 'auto'
  /** The UTF-8 offset of each UTF-16 offset of `input`, built at the first finding with a range. */
  byteOffsets?: Uint32Array
}

function unitBytes(input: string, at: number): number {
  const code = input.charCodeAt(at)
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = input.charCodeAt(at + 1)
    return next >= 0xdc00 && next <= 0xdfff ? 4 : 3
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const before = input.charCodeAt(at - 1)
    return before >= 0xd800 && before <= 0xdbff ? 0 : 3
  }
  return 3
}

/** The UTF-8 offset of `at`, as `Buffer.byteLength` gives it for the input before `at`; one table per input keeps it linear. */
function byteOffset(context: Context, at: number): number {
  let table = context.byteOffsets
  if (table === undefined) {
    table = new Uint32Array(context.input.length + 1)
    for (let index = 0; index < context.input.length; index++) table[index + 1] = (table[index] ?? 0) + unitBytes(context.input, index)
    context.byteOffsets = table
  }
  return table[Math.min(Math.max(at, 0), context.input.length)] ?? 0
}

/** C2-M-083: the codes of the HTML importer. The Markdown and Djot importers keep the two codes of the 0.1 importer. */
export type HtmlImportCode = 'import-attribute-dropped' | 'import-carrier-ignored' | 'import-destination-denied'
  | 'import-element-dropped' | 'import-element-mapped' | 'import-structure-repaired' | 'import-whitespace-normalized'
export type ImportCode = HtmlImportCode | 'import-unsupported' | 'import-degraded'

export function finding(context: Context, code: ImportCode, foreignType: string,
  message: string, start?: number, end?: number): void {
  const range = start === undefined || end === undefined ? undefined : {
    startOffset: byteOffset(context, start),
    endOffset: byteOffset(context, end),
  }
  // C2-M-020: whitespace normalization changes no visible text.
  const severity = code === 'import-whitespace-normalized' ? 'hint' : 'warning'
  context.diagnostics.push({ code, severity, channel: 'render-loss', message, foreignType,
    ...(range ? { range } : {}) })
}

export function documentOf(context: Context, children: DocumentNode['children']): DocumentNode {
  return { type: 'document', astVersion: '2.0', children,
    ...(context.rootLang ? { lang: context.rootLang } : {}),
    ...(context.rootDir ? { dir: context.rootDir } : {}),
    extensions: [{ name: 'carve.source', version: '1', required: false, slots: [] },
      { name: 'carve.style', version: '1', required: false, slots: [] }],
    data: { 'carve.source': { format: context.format, locator: { part: 'input' },
      importer: { name: 'carve-import', version: '0.0.0' } } } }
}

export function complete(context: Context, children: DocumentNode['children']): ImportResult {
  const document = documentOf(context, children)
  validateTree(document)
  const written = writeWithDiagnostics(document)
  return { document, source: written.source, diagnostics: [...context.diagnostics, ...written.diagnostics] }
}

export function attrsOf(entries: Iterable<readonly [string, string]>): Attrs | undefined {
  const attrs: Attrs = {}
  for (const [key, value] of entries) {
    if (key.toLowerCase() === 'id') attrs.id = value
    else if (key.toLowerCase() === 'class') addClasses(attrs, classNames(value))
    else attrs.keyValues = [...(attrs.keyValues ?? []), [key, value]]
  }
  return Object.keys(attrs).length ? attrs : undefined
}

/** C2-M-052 row `class`, C2-A-058: a value that leaves no class gives no `classes`. */
function addClasses(attrs: Attrs, names: string[]): void {
  if (names.length > 0) attrs.classes = [...(attrs.classes ?? []), ...names]
}

// C2-I-030: the writer's key test, so that the importer keeps only a key the writer can spell.
export { isKey } from '../../v2/src/write-attributes.ts'

/** Splits a class attribute at ASCII whitespace (C2-M-052). */
export function classNames(value: string): string[] {
  const names: string[] = []
  let start = -1
  for (let at = 0; at <= value.length; at++) {
    const code = at === value.length ? 32 : value.charCodeAt(at)
    // C2-M-016: ASCII whitespace is space, tab, line feed, form feed and carriage return, not the vertical tab.
    const space = code === 32 || code === 9 || code === 10 || code === 12 || code === 13
    if (space && start >= 0) { names.push(value.slice(start, at)); start = -1 }
    else if (!space && start < 0) start = at
  }
  return names
}

export function safeUrl(context: Context, foreignType: string, url: string, start?: number, end?: number): string | undefined {
  if (isUrlAllowed(url)) return url
  const code = context.format === 'html' ? 'import-destination-denied' : 'import-degraded'
  finding(context, code, foreignType, `Denied URL scheme in ${foreignType}`, start, end)
  return undefined
}

/**
 * A link with no destination and no key, as from a denied or missing URL, has no Carve spelling
 * (C2-W-011): it becomes its text, and an image its alternative text, in a span where attributes remain.
 */
export function withDestination(node: Inline): Inline[] {
  if (node.type === 'link' && node.href === undefined && node.key === undefined) {
    return node.attrs === undefined ? node.children : [{ type: 'span', children: node.children, attrs: node.attrs }]
  }
  if (node.type !== 'image' || node.src !== undefined || node.key !== undefined) return [node]
  const alt = node.alt === undefined || node.alt === '' ? [] : [text(node.alt)]
  return node.attrs === undefined ? alt : [{ type: 'span', children: alt, attrs: node.attrs }]
}

export function text(value: string): Inline { return { type: 'text', value: value.replaceAll('\0', '\ufffd') } }
export function softText(value: string): Inline[] {
  const limit = value.length
  const result: Inline[] = []
  let start = 0
  for (let at = 0; at < limit; at++) {
    if (value[at] !== '\n' && value[at] !== '\r') continue
    if (at > start) result.push(text(value.slice(start, at)))
    result.push({ type: 'soft_break' })
    if (value[at] === '\r' && value[at + 1] === '\n') at++
    start = at + 1
  }
  if (start < limit) result.push(text(value.slice(start, limit)))
  return result
}
export function paragraph(children: Inline[]): Block { return { type: 'paragraph', children: coalesce(children) } }
export function coalesce(children: Inline[]): Inline[] {
  const result: Inline[] = []
  for (const child of children) {
    const previous = result[result.length - 1]
    if (child.type === 'text' && previous?.type === 'text') previous.value += child.value
    else result.push(child)
  }
  return result
}

export function list(ordered: boolean, items: ListNode['children'], tight: boolean, start?: number): ListNode {
  const marker = ordered ? { kind: 'ordered' as const, style: '1', delimiter: '.',
    ...(start !== undefined && start !== 1 ? { start } : {}) }
    : { kind: 'bullet' as const, char: '-' }
  return { type: 'list', children: items, marker, spacing: tight ? 'tight' : 'loose' }
}

export function cell(children: Inline[], header: boolean): TableCellNode {
  return { type: 'table_cell', header, children: [{ type: 'cell_paragraph', children: coalesce(children) }] }
}

export function row(children: TableCellNode[]): TableRowNode { return { type: 'table_row', children } }

export function assertNever(value: never): never { throw new ImportInputError(`Unknown foreign node: ${String(value)}`, 'unknown') }
