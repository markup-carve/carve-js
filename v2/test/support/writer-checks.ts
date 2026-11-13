// The checks of the writer (spec/0.2/writer.md): its two gates, with and without the sidecar,
// that a canonical input stays as it is, and that no escape is needless.
import { format, formatWithDiagnostics, parse, treesEqual, write, writeWithDiagnostics } from '../../src/index.ts'
import { type AstNode } from '../../src/ast.ts'
import { type Diagnostic } from '../../src/diagnostics.ts'

const VERBATIM_SPANS = ['code', 'literal_inline', 'math', 'raw_inline']

function nodeAt(tree: AstNode, path: string): AstNode | undefined {
  let at: unknown = tree
  for (const part of path.split('/').slice(1)) at = (at as Record<string, unknown> | undefined)?.[part]
  return at as AstNode | undefined
}

/**
 * C2-W-016: whether the writer refused the document for a verbatim span whose later line would
 * open a block. Such a document has no canonical spelling, and the refusal is its result.
 */
export function isRefusal(tree: AstNode, diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((entry) => {
    const node = entry.path === undefined ? undefined : nodeAt(tree, entry.path)
    return entry.code === 'field-unspellable' && node !== undefined && VERBATIM_SPANS.includes(node.type) && (node.value ?? '').includes('\n')
  })
}

function isAsciiPunctuation(code: number): boolean {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)
}

/** C2-W-088: the offset of a backslash of `written` without which the parse is the same, or -1. */
export function needlessEscape(written: string, tree: AstNode): number {
  for (let at = 0; at + 1 < written.length; at++) {
    if (written[at] !== '\\') continue
    if (isAsciiPunctuation(written.charCodeAt(at + 1)) && treesEqual(parse(written.slice(0, at) + written.slice(at + 1)), tree)) return at
    // The character behind a backslash is not the start of another escape.
    at++
  }
  return -1
}

function show(text: string): string {
  return JSON.stringify(text)
}

/** The gates on one written form: it parses to `tree` (C2-W-002) and holds no needless escape (C2-W-088). */
function checkWritten(tree: AstNode, written: string, losses: readonly Diagnostic[], path: string): string | null {
  if (losses.length > 0) return `${path}: the writer reports ${losses.map((entry) => `${entry.code} at ${show(entry.path ?? '')}`).join(', ')}, written ${show(written)}`
  if (!treesEqual(tree, parse(written))) return `${path}: C2-W-002, the written form parses to another tree: ${show(written)}`
  const needless = needlessEscape(written, tree)
  if (needless >= 0) return `${path}: C2-W-088, the backslash at ${needless} is not needed: ${show(written)}`
  // C2-W-003 on the formatter path, and a canonical input stays as it is.
  const again = format(written)
  return again === written ? null : `${path}: the canonical form ${show(written)} is formatted to ${show(again)}`
}

/** The result of the checks on one source: null, a failure, or `refused` (C2-W-016). */
export function checkWriter(src: string): string | null {
  const tree = parse(src)
  const formatted = formatWithDiagnostics(src)
  const plain = writeWithDiagnostics(tree)
  const losses = formatted.diagnostics.filter((entry) => entry.channel === 'render-loss')
  if (isRefusal(tree, losses) && isRefusal(tree, plain.diagnostics)) return 'refused'
  const failure = checkWritten(tree, formatted.source, losses, 'with the record') ?? checkWritten(tree, plain.source, plain.diagnostics, 'without the record')
  if (failure !== null) return failure
  // C2-W-003 without the sidecar.
  const again = write(parse(plain.source))
  return again === plain.source ? null : `without the record: C2-W-003, ${show(plain.source)} is written again as ${show(again)}`
}

export interface WriterEnumerationResult {
  documents: number
  refused: number
  failures: string[]
}

const MAX_REPORTED = 20

/** Checks every document of exactly `length` parts of `alphabet`, joined by `glue` behind `prefix`. */
export function enumerateWriter(alphabet: readonly string[], length: number, glue: string, prefix: string): WriterEnumerationResult {
  const result: WriterEnumerationResult = { documents: 0, refused: 0, failures: [] }
  const choice = new Array<number>(length).fill(0)
  const parts = new Array<string>(length).fill('')
  for (;;) {
    for (let at = 0; at < length; at++) parts[at] = alphabet[choice[at]!]!
    const src = prefix + parts.join(glue)
    result.documents++
    let failure: string | null
    try {
      failure = checkWriter(src)
    } catch (error) {
      failure = `threw ${String(error)}`
    }
    if (failure === 'refused') result.refused++
    else if (failure !== null && result.failures.length < MAX_REPORTED) result.failures.push(`${show(src)}: ${failure}`)
    let at = length - 1
    while (at >= 0 && choice[at] === alphabet.length - 1) choice[at--] = 0
    if (at < 0) return result
    choice[at]!++
  }
}
