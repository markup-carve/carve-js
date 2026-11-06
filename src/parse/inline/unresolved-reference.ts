/*
 * One spelling of "this reference never resolved" (PART 9R R1).
 *
 * A reference link or reference image whose label matched no definition
 * degrades to its literal SOURCE: every render target writes the node back out
 * as the author typed it, and the link text that was built for it is discarded
 * rather than written into the document.
 *
 * UNRESOLVED means no destination, not "carries a ref": PART 12 §3a keeps
 * `ref` and `rawRef` on a RESOLVED reference too, so the presence of a ref does
 * not answer the question (carve#596).
 *
 * The predicate lives here because more than one pass asks it. Both resolution
 * seams and every render target had it written out by hand, and PART 9R R2
 * added a sixth caller with a different consequence - a note inside text that
 * is discarded is not a reference - so the condition is stated once rather than
 * kept in step by hand. It has already moved once (carve#596), which is the
 * kind of change six copies survive unevenly.
 *
 * Two arms stay spelled out: the plain-text and terminal writers take the
 * STRUCTURAL image shape rather than an `Image` node, so they carry no `type`
 * for this to key on.
 */

import type { InlineNode } from '../../ast.js'
import type { UnresolvedReference } from './reference-state.js'
import { isResolvedEmptyReference } from './reference-state.js'

/**
 * True when `node` is a reference link/image that matched no definition.
 *
 * Narrowing, because the callers that go on to READ the label need `ref` to be
 * a string: an unresolved reference is exactly one that has a label, so the
 * predicate can say so rather than leave every call site to re-test it.
 */
export function isUnresolvedReference(node: InlineNode): node is UnresolvedReference {
  if (node.type === 'link') return node.ref !== undefined && !node.href && !isResolvedEmptyReference(node)
  if (node.type === 'image') return node.ref !== undefined && !node.src && !isResolvedEmptyReference(node)
  return false
}

/**
 * A COMMENT-ONLY LINE, the way the block layer reads one (PART 9 §23).
 *
 * Deliberately the line form and not the fence: only a line the block layer
 * EMPTIES is missing from the text the inline parse was handed, and a fence
 * opener is not that - its body is removed with it, so a reference label cannot
 * span one and come back with the opener alone.
 */
const RE_COMMENT_ONLY_LINE = /^[ \t]*%%/

/**
 * The literal source a RENDER TARGET writes for an unresolved reference.
 */
export function referenceSourceText(rawRef: string | undefined): string {
  if (rawRef === undefined) return ''
  if (!rawRef.includes('%%')) return rawRef

  return rawRef
    .split('\n')
    .map((line) => (RE_COMMENT_ONLY_LINE.test(line) ? '' : line))
    .join('\n')
}

/** Plain and terminal targets spell a literal label's soft break as a space. */
export function referenceDisplayText(
  rawRef: string | undefined,
  children: InlineNode[] = [],
  startLine?: number,
  lineBlock = false,
): string {
  if (rawRef === undefined) return ''
  const retained: Array<{ start: number; end: number }> = []
  const visit = (nodes: InlineNode[]): void => {
    for (const node of nodes) {
      if ((node.type === 'hard_break' || node.type === 'code' || node.type === 'raw_inline' || node.type === 'math') && node.pos?.startLine !== undefined && node.pos.endLine !== undefined) {
        retained.push({ start: node.pos.startLine, end: node.pos.endLine })
      }
      if ('children' in node && Array.isArray(node.children)) visit(node.children)
    }
  }
  visit(children)

  const pairedCodeRuns = new Map<number, number>()
  let codeOpener: RegExpExecArray | undefined
  for (const run of rawRef.matchAll(/(?<!\\)`+/g)) {
    if (!codeOpener) codeOpener = run
    else if (codeOpener[0].length === run[0].length) {
      pairedCodeRuns.set(codeOpener.index, run.index + run[0].length)
      codeOpener = undefined
    }
  }

  // Only the first bracketed run is parsed as visible link text or image alt.
  // The following reference identifier is a label, even if it contains ticks.
  let visibleEnd = rawRef.length
  let bracketDepth = 0
  for (let i = rawRef.startsWith('![') ? 1 : 0; i < rawRef.length; i++) {
    if (rawRef[i] === '\\') { i++; continue }
    if (rawRef[i] === '`') {
      const end = pairedCodeRuns.get(i)
      if (end !== undefined) { i = end - 1; continue }
    }
    if (rawRef[i] === '[') bracketDepth++
    else if (rawRef[i] === ']' && --bracketDepth === 0) {
      visibleEnd = i
      break
    }
  }

  // Images store only scalar alt text, and position recording can be disabled.
  // The source still identifies authored hard breaks and verbatim code spans.
  // Link children above additionally identify breaks promoted after parsing.
  const codeSpans = [...pairedCodeRuns].filter(([, end]) => end <= visibleEnd)
  const authoredBreak = (line: string, at: number): boolean => {
    if (at >= visibleEnd) return false
    const slashRun = line.match(/\\+$/)?.[0].length ?? 0
    return lineBlock || slashRun % 2 === 1
      || codeSpans.some(([start, end]) => start <= at && at < end)
  }

  let result = ''
  let cursor = 0
  let lineNumber = startLine
  for (const match of rawRef.matchAll(/\r?\n/g)) {
    const line = rawRef.slice(cursor, match.index)
    result += RE_COMMENT_ONLY_LINE.test(line) ? '' : line
    const currentLine = lineNumber
    result += (currentLine !== undefined && retained.some(({ start, end }) => start <= currentLine && currentLine < end))
      || authoredBreak(line, match.index) ? match[0] : ' '
    if (lineNumber !== undefined) lineNumber++
    cursor = match.index + match[0].length
  }
  const tail = rawRef.slice(cursor)
  return result + (RE_COMMENT_ONLY_LINE.test(tail) ? '' : tail)
}

/**
 * The attribute run an unresolved footnote reference keeps as text (carve#4816).
 *
 * Kept beside the node rather than on it: the AST schema names no field for it,
 * and a resolved reference still takes the run as attributes.
 */
const footnoteAttrSources = new WeakMap<object, string>()

export function appendFootnoteAttrSource(node: object, source: string): void {
  footnoteAttrSources.set(node, (footnoteAttrSources.get(node) ?? '') + source)
}

/** Hands the recorded runs from a tree to its structural copy, which a WeakMap does not follow. */
export function carryFootnoteAttrSources<T>(from: T, to: T): T {
  const stack: Array<[unknown, unknown]> = [[from, to]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    if (!a || typeof a !== 'object' || !b || typeof b !== 'object' || a === b) continue
    const run = footnoteAttrSources.get(a)
    if (run !== undefined) footnoteAttrSources.set(b, run)
    for (const key of Object.keys(a)) stack.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]])
  }
  return to
}

export function footnoteAttrSource(node: object): string {
  return footnoteAttrSources.get(node) ?? ''
}

/** The literal source of an unresolved `[^label]`, with its attribute run. */
export function footnoteRefSourceText(node: { label?: string | undefined }): string {
  return `[^${node.label ?? ''}]${footnoteAttrSource(node)}`
}
