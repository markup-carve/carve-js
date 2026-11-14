// The checks of the writer (spec/0.2/writer.md): its two gates, with and without the sidecar,
// that a canonical input stays as it is, and that the escaping test asks for every escape.
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
    const multiline = node !== undefined && VERBATIM_SPANS.includes(node.type) && (node.value ?? '').includes('\n')
    return entry.code === 'field-unspellable' && multiline
  })
}

function isAsciiPunctuation(code: number): boolean {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)
}

/** `text` with every backslash before ASCII punctuation taken out: the text bare of escapes. */
function bare(text: string): string {
  let out = ''
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '\\' && at + 1 < text.length && isAsciiPunctuation(text.charCodeAt(at + 1))) at++
    out += text[at]
  }
  return out
}

/**
 * C2-W-088, C2-W-091: whether the test asks for the backslash at `at`, tested with the escapes to its
 * left in place and the text to its right bare: the line parses to a different tree without it.
 */
export function asksForEscape(written: string, at: number): boolean {
  const left = written.slice(0, at)
  const rest = `${written[at + 1]!}${bare(written.slice(at + 2))}`
  return !treesEqual(parse(`${left}\\${rest}`), parse(`${left}${rest}`))
}

/**
 * C2-W-088: the offset of a backslash of `written` that no test asks for, or -1. Where a construct
 * would pair differently with the right side bare, `asksForEscape` misses the escape of its opener
 * (C2-W-090): `x(\/u)(\/u)/` for the text `x(/u)(/u)/`. Such an escape passes when the written form
 * without it parses to another tree; the inputs are logged for the specification.
 */
export function unaskedEscape(written: string, tree: AstNode): number {
  for (let at = 0; at + 1 < written.length; at++) {
    if (written[at] !== '\\') continue
    if (isAsciiPunctuation(written.charCodeAt(at + 1)) && !asksForEscape(written, at)
      && treesEqual(parse(written.slice(0, at) + written.slice(at + 1)), tree)) return at
    // The character behind a backslash is not the start of another escape.
    at++
  }
  return -1
}

function show(text: string): string {
  return JSON.stringify(text)
}

/** The gates on one written form: it parses to `tree` (C2-W-002) and holds no escape the test does not ask for (C2-W-088). */
function checkWritten(tree: AstNode, written: string, losses: readonly Diagnostic[], path: string): string | null {
  if (losses.length > 0) {
    const reported = losses.map((entry) => `${entry.code} at ${show(entry.path ?? '')}`).join(', ')
    return `${path}: the writer reports ${reported}, written ${show(written)}`
  }
  if (!treesEqual(tree, parse(written))) return `${path}: C2-W-002, the written form parses to another tree: ${show(written)}`
  const unasked = unaskedEscape(written, tree)
  if (unasked >= 0) return `${path}: C2-W-088, the test does not ask for the backslash at ${unasked}: ${show(written)}`
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
  const failure = checkWritten(tree, formatted.source, losses, 'with the record')
    ?? checkWritten(tree, plain.source, plain.diagnostics, 'without the record')
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
export function enumerateWriter(
  alphabet: readonly string[], length: number, glue: string, prefix: string, maxReported = MAX_REPORTED,
): WriterEnumerationResult {
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
    else if (failure !== null && result.failures.length < maxReported) result.failures.push(`${show(src)}: ${failure}`)
    let at = length - 1
    while (at >= 0 && choice[at] === alphabet.length - 1) choice[at--] = 0
    if (at < 0) return result
    choice[at]!++
  }
}
