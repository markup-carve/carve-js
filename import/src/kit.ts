import {
  format, isUrlAllowed, validateTree, writeWithDiagnostics, type Attrs, type Block, type Diagnostic, type DocumentNode,
  type Inline, type ListNode, type TableCellNode, type TableRowNode,
} from '../../v2/src/index.ts'

export type Format = 'markdown' | 'gfm' | 'djot' | 'html'
export type ImportDiagnostic = Diagnostic & { foreignType?: string }
export interface ImportResult { document: DocumentNode, source: string, diagnostics: ImportDiagnostic[] }

export class ImportInputError extends Error {
  readonly code = 'import-input-error'
  readonly foreignType: string
  constructor(message: string, foreignType: string) { super(message); this.foreignType = foreignType }
}

export interface Context {
  format: Format
  input: string
  diagnostics: ImportDiagnostic[]
  deferred?: DocumentNode['children']
  rootLang?: string
  rootDir?: 'ltr' | 'rtl' | 'auto'
}

export function finding(context: Context, code: 'import-unsupported' | 'import-degraded', foreignType: string,
  message: string, start?: number, end?: number): void {
  const range = start === undefined || end === undefined ? undefined : {
    startOffset: Buffer.byteLength(context.input.slice(0, start)),
    endOffset: Buffer.byteLength(context.input.slice(0, end)),
  }
  context.diagnostics.push({ code, severity: 'warning', channel: 'render-loss', message, foreignType,
    ...(range ? { range } : {}) })
}

export function documentOf(context: Context, children: DocumentNode['children']): DocumentNode {
  return { type: 'document', astVersion: '2.0', children,
    ...(context.rootLang ? { lang: context.rootLang } : {}),
    ...(context.rootDir ? { dir: context.rootDir } : {}),
    extensions: [{ name: 'carve.source', version: '1', required: false },
      { name: 'carve.style', version: '1', required: false }],
    data: { 'carve.source': { format: context.format, locator: { part: 'input' },
      importer: { name: 'carve-import', version: '0.0.0' } } } }
}

export function complete(context: Context, children: DocumentNode['children']): ImportResult {
  const document = documentOf(context, children)
  validateTree(document)
  const written = writeWithDiagnostics(document)
  return { document, source: format(written.source), diagnostics: [...context.diagnostics, ...written.diagnostics] }
}

export function attrsOf(entries: Iterable<readonly [string, string]>): Attrs | undefined {
  const attrs: Attrs = {}
  for (const [key, value] of entries) {
    if (key.toLowerCase() === 'id') attrs.id = value
    else if (key.toLowerCase() === 'class') attrs.classes = [...(attrs.classes ?? []), ...classNames(value)]
    else attrs.keyValues = [...(attrs.keyValues ?? []), [key, value]]
  }
  return Object.keys(attrs).length ? attrs : undefined
}

export function classNames(value: string): string[] {
  const names: string[] = []
  let start = -1
  for (let at = 0; at <= value.length; at++) {
    const code = at === value.length ? 32 : value.charCodeAt(at)
    const space = code === 32 || (code >= 9 && code <= 13)
    if (space && start >= 0) { names.push(value.slice(start, at)); start = -1 }
    else if (!space && start < 0) start = at
  }
  return names
}

export function safeUrl(context: Context, foreignType: string, url: string, start?: number, end?: number): string | undefined {
  if (isUrlAllowed(url)) return url
  finding(context, 'import-degraded', foreignType, `Denied URL scheme in ${foreignType}`, start, end)
  return undefined
}

export function text(value: string): Inline { return { type: 'text', value: value.replaceAll('\0', '\ufffd') } }
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
  const marker = ordered ? { kind: 'ordered' as const, style: '1', delimiter: '.', ...(start && start !== 1 ? { start } : {}) }
    : { kind: 'bullet' as const, char: '-' }
  return { type: 'list', children: items, marker, spacing: tight ? 'tight' : 'loose' }
}

export function cell(children: Inline[], header: boolean): TableCellNode {
  return { type: 'table_cell', header, children: [{ type: 'cell_paragraph', children: coalesce(children) }] }
}

export function row(children: TableCellNode[]): TableRowNode { return { type: 'table_row', children } }

export function assertNever(value: never): never { throw new ImportInputError(`Unknown foreign node: ${String(value)}`, 'unknown') }
