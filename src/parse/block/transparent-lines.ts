import { Lexer } from '../parse-lexer.js'
import { ownLines, type TraceRecord } from './block-ownership.js'
import { isLinkDefLine, RE_FOOTNOTE_DEF } from '../parse-prepass-core.js'
import { commentLineContent } from './parse-block-scan-core.js'
import type { AbbreviationDef, BlockNode, Comment, DefinitionItem, DefinitionList, Document, InlineNode, LinkReferenceDefinition, List, ListItem, Paragraph, Position } from '../../ast.js'
import { normalizeRefLabel } from '../../label-key.js'

export interface TransparentLineStream {
  lines: string[]
  original: string[]
  sourceLines: number[]
  erased: number[]
  authoredTrace: TraceRecord[]
  authoredOwnership?: ReturnType<typeof ownLines>
  originalOffsets: number[]
}

const REGION_MARKER = /^%%[ \t]*#(?:end)?region(?![A-Za-z0-9_])/
const COMMENT_FENCE = /^%%%/
const COMMENT_LINE = /^%%/
const MARKED_FENCE = /^[ \t>:*+-]*(?:\d+[.)][ \t]*)?%%%/

/** PART 0 S1: select whole, ordinary block lines before any layout reader runs. */
export function transparentLineStream(source: string): TransparentLineStream | null {
  if (!source.includes('%%') && !source.includes(']:')) return null
  const lexer = new Lexer(source)
  lexer.consumeFrontmatter()
  const original = [...lexer.lines]
  let terminal = original.length - 1
  while (terminal >= 0 && original[terminal] === '') terminal--
  const last = original[terminal]
  const prefix = original.slice(0, terminal).join('\n')
  // A final ordinary comment in a plain text/list source has no later layout
  // decision to affect. It can be erased without a second deep ownership walk.
  if (lexer.pos === 0 && !source.includes('\t') && !/[^\x00-\x7F]/.test(source) &&
      terminal >= 0 && original.length - terminal <= 2 && last !== undefined &&
      /^ *%%(?!%)(?:[ \t]|$)/.test(last) && !REGION_MARKER.test(last.trimStart()) &&
      !/[%`~<>{}|:\[\]\\+#]/.test(prefix)) {
    return { lines: original.filter((_line, index) => index !== terminal), original,
      sourceLines: original.map((_line, index) => index).filter((index) => index !== terminal),
      erased: [terminal], authoredTrace: [], originalOffsets: lexer.lineOffsets }
  }
  const trace: TraceRecord[] = []
  const authoredOwnership = ownLines(original, lexer.pos, trace)
  const erased: number[] = []
  for (const record of trace) {
    if (record.step !== 'S5' || record.form !== 'leaf') continue
    const index = record.line - 1
    const rest = original[index]?.replace(/^(?:[ \t]*>[ ]?)*[ \t]*/, '').replace(/[ \t]+$/, '') ?? ''
    if ((COMMENT_LINE.test(rest) && !COMMENT_FENCE.test(rest) && !REGION_MARKER.test(rest)) ||
        (isLinkDefLine(rest) && !RE_FOOTNOTE_DEF.test(rest))) erased.push(index)
  }
  if (!erased.length) return null
  const erasedSet = new Set(erased)
  const lines: string[] = []
  const sourceLines: number[] = []
  // An erased line goes with its quote prefixes (carve#5129).
  for (let index = 0; index < original.length; index++) {
    if (erasedSet.has(index)) continue
    lines.push(original[index]!)
    sourceLines.push(index)
  }
  return { lines, original, sourceLines, erased, authoredTrace: trace, authoredOwnership,
    originalOffsets: lexer.lineOffsets }
}

/** Ordinary space-indented comments have a source span without parsing the full authored tree. */
export function directCommentNodes(stream: TransparentLineStream): Map<number, Comment> | null {
  if (stream.original.some((line) => /[^\x00-\x7F]|\t/.test(line))) return null
  const found = new Map<number, Comment>()
  for (const index of stream.erased) {
    const line = stream.original[index]!
    const prefix = /^ */.exec(line)![0]
    const rest = line.slice(prefix.length)
    if (!/^%%(?!%)(?:[ \t]|$)/.test(rest)) return null
    const startOffset = stream.originalOffsets[index]! + prefix.length
    found.set(index + 1, { type: 'comment', block: false, content: commentLineContent(rest),
      pos: { startLine: index + 1, endLine: index + 1,
        startColumn: prefix.length + 1, endColumn: line.length + 1,
        startOffset, endOffset: stream.originalOffsets[index]! + line.length } })
  }
  return found
}

export interface ErasedLineNodes {
  comments: Map<number, Comment>
  abbreviations: AbbreviationDef[]
  linkDefinitions: LinkReferenceDefinition[]
  /** Labels a visible line below may define again; the caller checks the visible parse holds that definition. */
  contested: Set<string>
}

function shiftPositions(value: unknown, line: number, column: number, offset: number): void {
  if (Array.isArray(value)) {
    for (const part of value) shiftPositions(part, line, column, offset)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, part] of Object.entries(value)) {
      if (key !== 'pos') {
        shiftPositions(part, line, column, offset)
        continue
      }
      const pos = part as Position
      pos.startLine += line
      pos.endLine += line
      if (pos.startColumn !== undefined) pos.startColumn += column
      if (pos.endColumn !== undefined) pos.endColumn += column
      if (pos.startOffset !== undefined) pos.startOffset += offset
      if (pos.endOffset !== undefined) pos.endOffset += offset
    }
  }
}

/**
 * The nodes the authored parse would give the erased lines, read from those lines alone, so the
 * whole document is not parsed a second time (carve#5184). Null where a line's reading may depend
 * on its container; the caller then falls back to the authored parse.
 */
export function erasedLineNodes(stream: TransparentLineStream, parseLine: (text: string) => Document): ErasedLineNodes | null {
  const comments = new Map<number, Comment>()
  const abbreviations: AbbreviationDef[] = []
  const definitions = new Map<string, LinkReferenceDefinition>()
  const batches: Array<{ lines: Array<{ index: number; column: number; startOffset: number; rest: string }>; labels: Set<string> }> = []
  // Offsets count codepoints, so each surrogate pair above a line moves it back by one.
  let pairs = 0
  let counted = 0
  const reach = new Map<number, boolean>()
  const forms = new Map<number, string>()
  const nested = new Set<number>()
  const last = stream.erased.at(-1)! + 1
  for (const record of stream.authoredTrace) {
    // A `%%%` behind a marker, in comment payload or in text the walk read, may open or close a fence in the parser.
    if ((record.step === 'S1' ? record.cell === 'B-comment-keep' : record.step === 'S5' && record.form === 'text') &&
        record.line <= last && MARKED_FENCE.test(stream.original[record.line - 1]!)) return null
    if (record.step !== 'S5') continue
    reach.set(record.line, record.reach === record.owner)
    forms.set(record.line, record.form)
    if (record.owner !== 'doc') nested.add(record.line)
  }
  for (const index of stream.erased) {
    for (; counted < index; counted++) pairs += stream.original[counted]!.match(/[\ud800-\udbff][\udc00-\udfff]/g)?.length ?? 0
    const line = stream.original[index]!
    const prefix = /^ */.exec(line)![0]
    const rest = line.slice(prefix.length)
    // A quote, a tab, a lazy line or a `+` above makes the reading depend on the container.
    if (/^[\t>]/.test(rest) || reach.get(index + 1) !== true || /^[ \t>]*\+[ \t]*$/.test(stream.original[index - 1] ?? '')) return null
    // Below paragraph text, whether a definition starts depends on the container.
    if (forms.get(index) === 'text' && (rest.startsWith('[') || nested.has(index + 1))) return null
    const startOffset = stream.originalOffsets[index]! - pairs + prefix.length
    if (COMMENT_LINE.test(rest)) {
      const length = [...rest].length
      comments.set(index + 1, { type: 'comment', block: false, content: commentLineContent(rest),
        pos: { startLine: index + 1, endLine: index + 1, startColumn: prefix.length + 1, endColumn: prefix.length + length + 1,
          startOffset, endOffset: startOffset + length } })
      continue
    }
    // A document keeps one definition per label, so a repeated label starts the next batch.
    const label = rest.slice(0, rest.indexOf(']:') + 1)
    if (batches.at(-1)?.labels.has(label) !== false) batches.push({ lines: [], labels: new Set() })
    batches.at(-1)!.labels.add(label)
    batches.at(-1)!.lines.push({ index, column: prefix.length, startOffset, rest })
  }
  // The definition lines are read in one parse per batch, each standing alone between blank lines.
  for (const batch of batches) {
    const document = parseLine(batch.lines.map((entry) => entry.rest).join('\n\n'))
    if (document.children.length !== batch.lines.length || document.footnoteDefs || document.frontmatter) return null
    const batchOffsets: number[] = []
    let offset = 0
    for (const entry of batch.lines) {
      batchOffsets.push(offset)
      offset += [...entry.rest].length + 2
    }
    const seen = new Set<number>()
    for (const node of document.children) {
      const at = node.pos ? (node.pos.startLine - 1) / 2 : -1
      const entry = batch.lines[at]
      if (!entry || seen.has(at) || node.pos!.endLine !== node.pos!.startLine) return null
      seen.add(at)
      shiftPositions(node, entry.index - 2 * at, entry.column, entry.startOffset - batchOffsets[at]!)
      if (node.type === 'abbreviation_def') abbreviations.push(node)
      // The last definition of a label is the one the document keeps.
      else if (node.type === 'link_reference_definition') definitions.set(normalizeRefLabel(node.label), node)
      else return null
    }
  }
  abbreviations.sort((a, b) => a.pos!.startLine - b.pos!.startLine)
  // A visible line below that may define the label again decides it, if it is a definition.
  const contested = new Set<string>()
  if (definitions.size) {
    const erased = new Set(stream.erased)
    let first = Infinity
    for (const node of definitions.values()) first = Math.min(first, node.pos!.startLine)
    for (let index = first; index < stream.original.length; index++) {
      const line = stream.original[index]!
      if (erased.has(index) || !line.includes(']:')) continue
      // Every `[` before a `]:` may open the label, so each slice between them is a candidate.
      const opens: number[] = []
      for (let at = 0; at < line.length; at++) {
        if (line[at] === '[') {
          if (opens.push(at) > 64) return null
        } else if (line[at] === ']' && line[at + 1] === ':') {
          for (const open of opens) {
            const key = normalizeRefLabel(line.slice(open + 1, at))
            if ((definitions.get(key)?.pos!.startLine ?? Infinity) <= index) contested.add(key)
          }
        }
      }
    }
  }
  return { comments, abbreviations, contested,
    linkDefinitions: [...definitions.values()].sort((a, b) => a.pos!.startLine - b.pos!.startLine) }
}

/**
 * Whether the visible parse confirms the line-local reading: an erased line inside a visible
 * paragraph may have been that paragraph's text, or an open inline comment's, in the authored parse.
 */
export function erasedLinesStandAlone(document: Document, stream: TransparentLineStream, nodes: ErasedLineNodes): boolean {
  // Per line inside a paragraph: 1, or 2 where that paragraph holds a comment.
  const inside = new Uint8Array(stream.original.length + 2)
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const part of value) visit(part)
    } else if (value !== null && typeof value === 'object') {
      const node = value as { type?: string; pos?: Position; children?: InlineNode[] }
      if (node.type === 'paragraph' && node.pos) {
        const mark = (node.children ?? []).some((child) => child.type === 'comment') ? 2 : 1
        for (let line = node.pos.startLine + 1; line < node.pos.endLine && line < inside.length; line++) {
          inside[line] = Math.max(inside[line]!, mark)
        }
        return
      }
      for (const [key, part] of Object.entries(node)) if (key !== 'pos' && key !== 'attrs') visit(part)
    }
  }
  visit(document.children)
  visit(document.footnoteDefs)
  for (const index of stream.erased) {
    const line = index + 1
    if (inside[line]! > (nodes.comments.has(line) ? 1 : 0)) return false
  }
  return true
}

/**
 * Put each erased definition the document keeps back in place of the visible ones of its label.
 * False when a contested label needs the authored parse to decide.
 */
export function restoreErasedDefinitions(document: Document, erased: LinkReferenceDefinition[],
  visible: ReadonlyMap<string, { rawLabel?: string; href: string }>, nodes: ErasedLineNodes | null,
  sourceLines: readonly string[]): boolean {
  const hoisted = new Map<string, LinkReferenceDefinition[]>()
  for (const child of document.children) {
    if (child.type !== 'link_reference_definition') continue
    const key = normalizeRefLabel(child.label)
    const found = hoisted.get(key)
    if (found) found.push(child)
    else hoisted.set(key, [child])
  }
  // Labels are unique among the erased definitions, so each replaces only visible ones.
  const replaced = new Set<string>()
  const restored: LinkReferenceDefinition[] = []
  for (const node of erased) {
    const key = normalizeRefLabel(node.label)
    // A later visible definition of the label is the one the document keeps. Below a blank line
    // it reads the same without the erased lines; elsewhere only the authored parse can tell.
    const later = nodes && (hoisted.get(key) ?? []).some((existing) => existing.pos!.startLine > node.pos!.startLine &&
      /^[ \t>]*$/.test(sourceLines[existing.pos!.startLine - 2] ?? ''))
    if (nodes?.contested.has(key) && !later) return false
    if (later) continue
    const winner = visible.get(key)
    if (!winner || winner.rawLabel !== node.label || winner.href !== node.href) continue
    replaced.add(key)
    restored.push(node)
  }
  if (restored.length) {
    const kept = document.children.filter((child) => child.type !== 'link_reference_definition' || !replaced.has(normalizeRefLabel(child.label)))
    document.children.length = 0
    for (const child of kept) document.children.push(child)
    for (const node of restored) document.children.push(node)
  }
  return true
}

function authoredComments(document: Document): Map<number, Comment> {
  const found = new Map<number, Comment>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const part of value) visit(part)
    } else if (value !== null && typeof value === 'object') {
      const node = value as Record<string, unknown>
      if (node.type === 'comment' && node.block === false) {
        const comment = value as Comment
        if (comment.pos) found.set(comment.pos.startLine, comment)
      }
      for (const [key, part] of Object.entries(node)) {
        if (key !== 'pos' && key !== 'attrs') visit(part)
      }
    }
  }
  visit(document.children)
  visit(document.footnoteDefs)
  return found
}

export function authoredAbbreviations(document: Document, erased: number[]): AbbreviationDef[] {
  const lines = new Set(erased.map((index) => index + 1))
  const found: AbbreviationDef[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const part of value) visit(part)
    } else if (value !== null && typeof value === 'object') {
      const node = value as Record<string, unknown>
      if (node.type === 'abbreviation_def') {
        const definition = value as AbbreviationDef
        if (definition.pos && lines.has(definition.pos.startLine)) found.push(definition)
      }
      for (const [key, part] of Object.entries(node)) {
        if (key !== 'pos' && key !== 'attrs') visit(part)
      }
    }
  }
  visit(document.children)
  return found.sort((a, b) => a.pos!.startLine - b.pos!.startLine)
}

// Reset per pass so a tree edited between passes is measured again.
let derivedSpans = new WeakMap<object, Span | null>()

type Span = { startOffset: number; endOffset: number }

/** A node's offsets, derived from its placed content where a PART 12 reader left it without `pos` (carve#5136). */
function spanOf(node: object | undefined): Span | undefined {
  if (!node) return undefined
  const pos = (node as { pos?: Position }).pos
  if (pos?.startOffset !== undefined && pos.endOffset !== undefined) return pos as Span
  if (derivedSpans.has(node)) return derivedSpans.get(node) ?? undefined
  let found: Span | null = null
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const part of value) visit(part)
    } else if (value !== null && typeof value === 'object') {
      const inner = spanOf(value)
      if (inner) found = { startOffset: Math.min(found?.startOffset ?? inner.startOffset, inner.startOffset),
        endOffset: Math.max(found?.endOffset ?? inner.endOffset, inner.endOffset) }
    }
  }
  for (const [key, value] of Object.entries(node)) if (key !== 'pos' && key !== 'attrs' && typeof value === 'object') visit(value)
  derivedSpans.set(node, found)
  return found ?? undefined
}

// Items stand in source order, so only the last one starting at or before an offset can hold it
// (carve-js#4392). Every item is a candidate when a probed item has no offsets.
function candidateItems(items: readonly ListItem[], offset: number): number[] {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const start = spanOf(items[mid])?.startOffset
    if (start === undefined) return items.map((_item, index) => index)
    if (start <= offset) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found < 0 ? [] : [found]
}

// The gap after item i ends where item i + 1 starts. An empty item can end before it starts,
// so the gap before the first item past the offset is a candidate too.
function candidateGaps(items: readonly ListItem[], offset: number): number[] {
  if (items.length < 2) return []
  let lo = 1
  let hi = items.length - 1
  let first = items.length
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const start = spanOf(items[mid])?.startOffset
    if (start === undefined) return items.slice(0, -1).map((_item, index) => index)
    if (start > offset) {
      first = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return [first - 1, first].filter((index) => index < items.length - 1)
}

type BlockRun = { from: number; starts: number[]; ends: number[]; reach: number[] }
type BlockIndex = { length: number; runs: BlockRun[] } | { length: number; unsorted: true }
let blockIndexes = new WeakMap<readonly object[], BlockIndex>()

// Sibling blocks stand in source order, so only those starting at or before an offset and reaching
// past it can hold it (carve-js#4392). `reach` is the furthest end so far, which finds overlapping
// siblings too. Definitions hoisted to the end start a second sorted run, and each run is searched
// on its own (carve#5184). An array with a block that has no usable offsets is scanned in full.
function candidateBlocks<T extends object>(blocks: readonly T[], offset: number): readonly T[] {
  if (blocks.length < 16) return blocks
  let index = blockIndexes.get(blocks)
  if (index === undefined || index.length !== blocks.length) {
    const runs: BlockRun[] = []
    let run: BlockRun | undefined
    let usable = true
    for (let i = 0; i < blocks.length; i++) {
      const span = spanOf(blocks[i]!)
      const start = span?.startOffset
      const end = span?.endOffset
      if (start === undefined || end === undefined || Number.isNaN(start) || Number.isNaN(end)) {
        usable = false
        break
      }
      if (!run || start < run.starts.at(-1)!) {
        if (runs.length === 8) {
          usable = false
          break
        }
        run = { from: i, starts: [], ends: [], reach: [] }
        runs.push(run)
      }
      run.starts.push(start)
      run.ends.push(end)
      run.reach.push(Math.max(run.reach.at(-1) ?? -Infinity, end))
    }
    index = usable ? { length: blocks.length, runs } : { length: blocks.length, unsorted: true }
    blockIndexes.set(blocks, index)
  }
  if ('unsorted' in index) return blocks
  const out: T[] = []
  for (const run of index.runs) {
    let lo = 0
    let hi = run.starts.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (run.starts[mid]! <= offset) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    const held: T[] = []
    for (let i = found; i >= 0 && run.reach[i]! > offset; i--) if (run.ends[i]! > offset) held.push(blocks[run.from + i]!)
    for (let i = held.length - 1; i >= 0; i--) out.push(held[i]!)
  }
  return out
}

/** The content column of a list item, where a quote it holds puts its marker. */
function itemContentColumn(item: ListItem): number | undefined {
  return item.children[0]?.pos?.startColumn
}

/** Per quote around a line, the least column of its marker; linked to the quote outside it. */
type QuoteChain = { base: number | undefined; outer: QuoteChain } | undefined

/** `quotes` holds, per quote between `blocks` and the paragraph, the least column of its marker (innermost first). */
function containingParagraph(blocks: BlockNode[], offset: number, base?: number):
  { paragraph: Paragraph; siblings: BlockNode[]; quotes: Array<number | undefined> } | null {
  for (const block of candidateBlocks(blocks, offset)) {
    const span = spanOf(block)
    if (span && span.startOffset <= offset && offset < span.endOffset) {
      if (block.type === 'paragraph') return { paragraph: block, siblings: blocks, quotes: [] }
      type Scope = [BlockNode[], number | undefined]
      const children: Scope[] = block.type === 'list' ?
        candidateItems(block.items, offset).map((index): Scope => [block.items[index]!.children, itemContentColumn(block.items[index]!)]) :
        block.type === 'definition_list' ? block.items.flatMap((item) => item.definitions.map((definition): Scope => [definition, base])) :
        'children' in block && Array.isArray(block.children) && block.type !== 'heading' ?
          [[block.children as BlockNode[], block.type === 'block_quote' ? undefined : base]] : []
      for (const [child, childBase] of children) {
        const match = containingParagraph(child, offset, childBase)
        if (match && block.type === 'block_quote') match.quotes.push(base)
        if (match) return match
      }
    }
  }
  return null
}

function containingBlocks(blocks: BlockNode[], offset: number): BlockNode[] {
  for (const block of candidateBlocks(blocks, offset)) {
    const span = spanOf(block)
    if (!span || span.startOffset > offset || offset >= span.endOffset) continue
    if (block.type === 'list') {
      for (const item of candidateItems(block.items, offset).map((index) => block.items[index]!)) {
        if ((spanOf(item)?.startOffset ?? Infinity) <= offset && offset < (spanOf(item)?.endOffset ?? -1)) {
          return containingBlocks(item.children, offset)
        }
      }
    } else if (block.type === 'definition_list') {
      for (const item of block.items) {
        for (const definition of item.definitions) {
          if (definition.some((child) => (spanOf(child)?.startOffset ?? Infinity) <= offset &&
              offset < (spanOf(child)?.endOffset ?? -1))) return containingBlocks(definition, offset)
        }
      }
    } else if ('children' in block && Array.isArray(block.children) &&
               block.type !== 'paragraph' && block.type !== 'heading') {
      return containingBlocks(block.children as BlockNode[], offset)
    }
  }
  return blocks
}

function trailingListOwner(blocks: BlockNode[], column: number):
  { blocks: BlockNode[]; containers: Array<List | ListItem> } | null {
  for (const block of blocks) {
    if (block.type !== 'list') continue
    for (const item of [...block.items].reverse()) {
      const nested = trailingListOwner(item.children, column)
      if (nested) return { blocks: nested.blocks, containers: [block, item, ...nested.containers] }
      if (item.children[0]?.pos?.startColumn === column)
        return { blocks: item.children, containers: [block, item] }
    }
  }
  return null
}

function betweenListItems(blocks: BlockNode[], offset: number, settle: (blocks: BlockNode[]) => void = () => {}):
  { list: List; after: number } | null {
  for (const block of candidateBlocks(blocks, offset)) {
    if (block.type === 'list') {
      const candidates = candidateItems(block.items, offset)
      for (const i of candidateGaps(block.items, offset)) {
        const item = block.items[i]!
        settle(item.children)
        const visibleEnd = spanOf(item.children.at(-1))?.endOffset
        const itemEnd = spanOf(item)?.endOffset
        const before = visibleEnd === undefined ? itemEnd : Math.min(visibleEnd, itemEnd ?? visibleEnd)
        const after = spanOf(block.items[i + 1])?.startOffset
        if (before !== undefined && after !== undefined && before <= offset && offset < after)
          return { list: block, after: i }
      }
      for (const i of candidates) {
        const nested = betweenListItems(block.items[i]!.children, offset, settle)
        if (nested) return nested
      }
    } else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading') {
      const nested = betweenListItems(block.children as BlockNode[], offset, settle)
      if (nested) return nested
    }
  }
  return null
}

// Entries stand in source order, so only the last one starting before a line can hold or precede it.
// Every entry is a candidate when a probed one has no recorded line.
function itemsBefore(items: readonly DefinitionItem[], line: number): number[] {
  const first = (item: DefinitionItem): number | undefined => item.termSpans?.[0]?.startLine ?? item.definitionLines?.[0]
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const start = first(items[mid]!)
    if (start === undefined) return items.map((_item, index) => index)
    if (start < line) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found < 0 ? [] : [found]
}

function betweenDescriptions(blocks: BlockNode[], offset: number, line: number):
  { list: DefinitionList; item: number; afterDescription: number; afterTerm: number } | null {
  for (const block of candidateBlocks(blocks, offset)) {
    if ((spanOf(block)?.startOffset ?? Infinity) > offset || offset >= (spanOf(block)?.endOffset ?? -1)) continue
    if (block.type === 'definition_list') {
      const items = itemsBefore(block.items, line)
      for (const itemIndex of items) {
        for (const definition of block.items[itemIndex]!.definitions) {
          const nested = betweenDescriptions(definition, offset, line)
          if (nested) return nested
        }
      }
      let preceding: { item: number; afterDescription: number; afterTerm: number; line: number } | undefined
      for (const itemIndex of items) {
        const item = block.items[itemIndex]!
        item.termSpans?.forEach((span, termIndex) => {
          const start = span?.startLine
          if (start !== undefined && start < line && (preceding?.line ?? -1) < start)
            preceding = { item: itemIndex, afterDescription: -1, afterTerm: termIndex, line: start }
        })
        item.definitionLines?.forEach((start, definitionIndex) => {
          if (start !== undefined && start < line && (preceding?.line ?? -1) < start)
            preceding = { item: itemIndex, afterDescription: definitionIndex, afterTerm: -1, line: start }
        })
      }
      if (preceding) return { list: block, item: preceding.item, afterDescription: preceding.afterDescription,
        afterTerm: preceding.afterTerm }
    } else if (block.type === 'list') {
      for (const index of candidateItems(block.items, offset)) {
        const nested = betweenDescriptions(block.items[index]!.children, offset, line)
        if (nested) return nested
      }
    } else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading') {
      const nested = betweenDescriptions(block.children as BlockNode[], offset, line)
      if (nested) return nested
    }
  }
  return null
}

function recordDescriptionGap(gap: { list: DefinitionList; item: number; afterDescription: number; afterTerm: number },
  source: string, node: Comment | AbbreviationDef, originalValue: string): void {
  gap.list.transparentBetweenDescriptions ??= []
  gap.list.transparentBetweenDescriptions.push({ item: gap.item, afterDescription: gap.afterDescription,
    afterTerm: gap.afterTerm,
    source, node, originalValue })
  node.transparentInDefinitionList = true
}

/** A comment after a term leads the description that follows, with any comments before it (CARVE-P12-027). */
function placeInDescription(gap: { list: DefinitionList; item: number; afterDescription: number; afterTerm: number },
  node: Comment): boolean {
  const item = gap.list.items[gap.item]
  const description = gap.afterTerm >= 0 ? item?.definitions[0] : item?.definitions[gap.afterDescription]
  if (!description) return false
  const offset = node.pos!.startOffset!
  if (description.some((child) => (spanOf(child)?.startOffset ?? Infinity) <= offset && offset < (spanOf(child)?.endOffset ?? -1))) return false
  const at = description.findIndex((child) => (spanOf(child)?.startOffset ?? -1) > offset)
  if (at < 0 || description.slice(0, at).some((child) => child.type !== 'comment')) return false
  description.splice(at, 0, node)
  // Written at the description's column, not at its authored spot.
  delete node.transparentSource
  delete node.transparentOriginalValue
  return true
}

/** Rebuild writer-only placement after a PART 12 AST round trip strips it. */
export function hydrateTransparentDefinitionGaps(document: Document): void {
  derivedSpans = new WeakMap()
  blockIndexes = new WeakMap()
  // A quote marker goes at the content column of the item holding the quote, so the line stays in
  // that item; otherwise right after the marker before it.
  const authoredSource = (block: Comment | AbbreviationDef, innermostFirst: ReadonlyArray<number | undefined>): string => {
    const column = block.pos?.startColumn ?? 1
    let source = ''
    let next = 1
    if (column > 1) for (let index = innermostFirst.length - 1; index >= 0; index--) {
      const quote = innermostFirst[index]
      const at = Math.max(quote ?? next, next)
      source += ' '.repeat(at - next) + '> '
      next = at + 2
    }
    return source + ' '.repeat(Math.max(0, column - next)) +
      (block.type === 'comment' ? block.content === '' ? '%%' : `%% ${block.content}` :
        `*[${block.abbr}]: ${block.expansion}`)
  }
  const visit = (blocks: BlockNode[], markerLine?: number): void => {
    const chain = (quotes: QuoteChain): Array<number | undefined> => {
      const out: Array<number | undefined> = []
      for (let at = quotes; at; at = at.outer) out.push(at.base)
      return out
    }
    const pending: Array<{ block: BlockNode; quotes: QuoteChain; base: number | undefined;
      markerLine: number | undefined; description?: BlockNode[] }> = blocks.map((block) => ({ block, quotes: undefined, base: undefined, markerLine }))
    for (let at = 0; at < pending.length; at++) {
      const { block, quotes, base, markerLine, description } = pending[at]!
      const onMarkerLine = block.pos?.startLine !== undefined && block.pos.startLine === markerLine
      // A comment a description holds before another of its blocks is inside it, not a gap (CARVE-P12-027).
      if (block.type === 'comment' && description && description.indexOf(block) < description.length - 1) continue
      if (block.type === 'comment' && !block.block && !block.delimited && block.pos &&
          !onMarkerLine && block.transparentSource === undefined) {
        block.transparentSource = authoredSource(block, chain(quotes))
        block.transparentOriginalValue = block.content
      }
      if ((block.type === 'comment' && !block.block && !onMarkerLine || block.type === 'abbreviation_def') &&
          !block.transparentInDefinitionList && !block.transparentInParagraph && !block.transparentInList &&
          block.pos?.startOffset !== undefined && block.pos.startLine !== undefined) {
        const originalValue = block.type === 'comment' ? block.content : `${block.abbr}\0${block.expansion}`
        const match = containingParagraph(blocks, block.pos.startOffset)
        // A line erased inside a quoted paragraph is spelled with that paragraph's quotes (carve#5129).
        const source = authoredSource(block, match ? match.quotes : chain(quotes))
        if (match) {
          const paragraph = match.paragraph
          paragraph.transparentVisibleLines ??= [...new Set(paragraph.children
            .filter((child) => child.type !== 'soft_break' && child.pos !== undefined)
            .map((child) => child.pos!.startLine))]
          paragraph.transparentComments ??= []
          paragraph.transparentComments.push({ line: block.pos.startLine, source, node: block, originalValue })
          recordFollowingLines(paragraph, block.pos.startLine, (child) =>
            ' '.repeat(Math.max(0, (child.pos?.startColumn ?? 1) - 1)) +
              (child.type === 'text' ? child.value : ''))
          block.transparentInParagraph = true
        } else {
          const listGap = betweenListItems(blocks, block.pos.startOffset)
          if (listGap) {
            listGap.list.transparentBetweenItems ??= []
            listGap.list.transparentBetweenItems.push({ after: listGap.after, source, node: block, originalValue })
            block.transparentInList = true
          } else {
            const gap = betweenDescriptions(blocks, block.pos.startOffset, block.pos.startLine)
            if (gap) recordDescriptionGap(gap, source, block, originalValue)
          }
        }
      }
      if (block.type === 'list') for (const item of block.items)
        for (const child of item.children) pending.push({ block: child, quotes, base: itemContentColumn(item), markerLine: item.pos?.startLine })
      else if (block.type === 'definition_list') for (const item of block.items)
        for (const [index, definition] of item.definitions.entries())
          for (const child of definition) pending.push({ block: child, quotes, base, markerLine: item.definitionLines?.[index], description: definition })
      else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading') {
        const inner = block.type === 'block_quote' ? { base, outer: quotes } : quotes
        for (const child of block.children as BlockNode[]) pending.push({ block: child, quotes: inner,
          base: block.type === 'block_quote' ? undefined : base,
          markerLine: block.type === 'block_quote' ? block.pos?.startLine : markerLine })
      }
    }
  }
  visit(document.children)
  for (const [label, blocks] of Object.entries(document.footnoteDefs ?? {}))
    visit(blocks, document.footnoteDefPos?.[label]?.startLine)
}

function insertAfterParagraph(siblings: BlockNode[], paragraph: Paragraph, node: Comment | AbbreviationDef): void {
  let at = siblings.indexOf(paragraph) + 1
  while (at < siblings.length &&
         (siblings[at]?.type === 'comment' || siblings[at]?.type === 'abbreviation_def') &&
         (siblings[at]?.pos?.startOffset ?? Infinity) <= (node.pos?.startOffset ?? -1)) at++
  siblings.splice(at, 0, node)
}

function visibleParagraphLines(paragraph: Paragraph, stream: TransparentLineStream): number[] {
  const first = paragraph.pos?.startLine
  const last = paragraph.pos?.endLine
  if (first === undefined || last === undefined) return []
  const erased = new Set(stream.erased.map((index) => index + 1))
  const visible: number[] = []
  for (let line = first; line <= last; line++) if (!erased.has(line)) visible.push(line)
  return visible
}

/**
 * A visible container can end before its last erased line; source ownership still names it.
 * Keys follow the trace's `doc/item:1/dd:2` paths, built from the tree so an outer container
 * that opens a nested one on its first line keeps its own key (carve#5178).
 */
function authoredContainerBlocks(document: Document, owners: Map<number, string>):
  Map<string, { blocks: BlockNode[]; containers: Array<{ pos?: Position }> }> {
  const blocksByOwner = new Map<string, { blocks: BlockNode[]; containers: Array<{ pos?: Position }> }>()
  const visit = (blocks: BlockNode[], path: string): void => {
    for (const block of blocks) {
      const line = block.pos?.startLine
      if (block.type === 'block_quote') {
        const key = `${path}/quote:${line}`
        blocksByOwner.set(key, { blocks: block.children, containers: [block] })
        visit(block.children, key)
      } else if (block.type === 'list') {
        for (const item of block.items) {
          const key = `${path}/item:${item.pos?.startLine}`
          blocksByOwner.set(key, { blocks: item.children, containers: [item, block] })
          visit(item.children, key)
        }
      } else if (block.type === 'definition_list') {
        for (const item of block.items) {
          item.definitions.forEach((definition, index) => {
            const marker = item.definitionLines?.[index]
            const key = `${path}/dd:${marker}`
            if (marker !== undefined) blocksByOwner.set(key, { blocks: definition, containers: [block] })
            visit(definition, marker === undefined ? path : key)
          })
        }
      } else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading') {
        const key = `${path}/div:${line}`
        const opened = owners.get(line ?? -1)
        const fenced = opened !== undefined && (opened === key || opened.startsWith(`${key}/`))
        if (fenced) blocksByOwner.set(key, { blocks: block.children as BlockNode[], containers: [block] })
        visit(block.children as BlockNode[], fenced ? key : path)
      }
    }
  }
  visit(document.children, 'doc')
  for (const [label, blocks] of Object.entries(document.footnoteDefs ?? {})) {
    const line = document.footnoteDefPos?.[label]?.startLine
    const authoredOwner = owners.get(line ?? -1)
    const key = authoredOwner?.endsWith(`/footnote:${line}`) ? authoredOwner : `doc/footnote:${line}`
    if (line !== undefined) blocksByOwner.set(key, { blocks, containers: [] })
    visit(blocks, line === undefined ? 'doc' : key)
  }
  return blocksByOwner
}

const followingFromLine = new WeakMap<Paragraph, number>()

function recordFollowingLines(paragraph: Paragraph, line: number, sourceFor: (child: InlineNode) => string): void {
  if ((followingFromLine.get(paragraph) ?? Infinity) <= line) return
  paragraph.transparentFollowingLines ??= []
  const recorded = new Set(paragraph.transparentFollowingLines.map((entry) => entry.line))
  for (const child of paragraph.children) {
    const following = child.pos?.startLine
    if (following === undefined || following <= line || recorded.has(following)) continue
    paragraph.transparentFollowingLines.push({ line: following, source: sourceFor(child) })
    recorded.add(following)
  }
  followingFromLine.set(paragraph, line)
}

/** Keep the authored comment node and let a paragraph crossing it write its line. */
export function restoreTransparentComments(document: Document, authored: Document | null,
  stream: TransparentLineStream, direct?: Map<number, Comment>): void {
  derivedSpans = new WeakMap()
  blockIndexes = new WeakMap()
  const comments = direct ?? (authored ? authoredComments(authored) : new Map<number, Comment>())
  const ownersByLine = new Map(stream.authoredTrace.map((record) => [record.line, record.reach ?? record.owner]))
  const ownedBlocks = authoredContainerBlocks(document, ownersByLine)
  const ownerOf = new Map<BlockNode[], string>([...ownedBlocks].map(([key, entry]) => [entry.blocks, key]))
  // Hoisted comments are placed in one merge per sibling list, so later lookups do not walk them
  // (carve-js#4392). The lookups never match a comment; only insertAfterParagraph reads placed ones.
  const hoisted = new Map<BlockNode[], Comment[]>()
  const placeHoisted = (only?: BlockNode[]): void => {
    for (const [siblings, pending] of hoisted) {
      if (only && siblings !== only) continue
      const merged: BlockNode[] = []
      let next = 0
      for (const comment of pending) {
        while (next < siblings.length && (siblings[next]!.pos?.startOffset ?? Infinity) <= comment.pos!.startOffset!) merged.push(siblings[next++]!)
        merged.push(comment)
      }
      while (next < siblings.length) merged.push(siblings[next++]!)
      siblings.length = 0
      for (const block of merged) siblings.push(block)
      hoisted.delete(siblings)
    }
  }
  for (const index of stream.erased) {
    const original = stream.original[index]!
    const rest = original.replace(/^(?:[ \t]*>[ ]?)*[ \t]*/, '')
    if (!COMMENT_LINE.test(rest) || COMMENT_FENCE.test(rest) || REGION_MARKER.test(rest)) continue
    const comment = comments.get(index + 1)
    if (!comment?.pos || comment.pos.startOffset === undefined) continue
    comment.transparentSource = original
    comment.transparentOriginalValue = comment.content
    const owner = ownersByLine.get(index + 1)
    const footnote = Object.entries(document.footnoteDefPos ?? {}).find(([_label, pos]) =>
      pos.startLine <= index + 1 && (index + 1 <= pos.endLine || owner?.endsWith(`/footnote:${pos.startLine}`)))?.[0]
    const blocks = footnote ? document.footnoteDefs?.[footnote] ?? document.children : document.children
    const match = containingParagraph(blocks, comment.pos!.startOffset!)
    if (match) {
      match.paragraph.transparentVisibleLines ??= visibleParagraphLines(match.paragraph, stream)
      match.paragraph.transparentComments ??= []
      match.paragraph.transparentComments.push({ line: index + 1, source: original, node: comment, originalValue: comment.content })
      recordFollowingLines(match.paragraph, index + 1, (child) => stream.original[child.pos!.startLine - 1]!)
      comment.transparentInParagraph = true
      placeHoisted()
      // A line below the paragraph's container column is not its container's, even where
      // the paragraph folds across it (carve#5178).
      const owner = ownersByLine.get(index + 1)
      const paragraphOwner = ownerOf.get(match.siblings)
      const reached = owner === undefined ? undefined : owner === 'doc' ? footnote ? undefined : document.children : ownedBlocks.get(owner)?.blocks
      if (reached && paragraphOwner?.startsWith(`${owner}/`)) hoisted.set(reached, [...hoisted.get(reached) ?? [], comment])
      else insertAfterParagraph(match.siblings, match.paragraph, comment)
    } else {
      const descriptionGap = betweenDescriptions(blocks, comment.pos.startOffset, index + 1)
      if (descriptionGap && placeInDescription(descriptionGap, comment)) continue
      const owned = owner === undefined ? undefined : ownedBlocks.get(owner)
      // A comment its owner holds is written there in tree order: inside one of the list's
      // descriptions, or after the list's last entry (carve#5178).
      const inOwner = descriptionGap !== null && owned !== undefined && (!owned.blocks.includes(descriptionGap.list) ||
        !descriptionGap.list.items.some((item) => [...item.termSpans?.map((span) => span?.startLine) ?? [],
          ...item.definitionLines ?? []].some((start) => start !== undefined && start > index + 1)))
      if (descriptionGap && !inOwner) recordDescriptionGap(descriptionGap, original, comment, comment.content)
      if (inOwner) {
        delete comment.transparentSource
        delete comment.transparentOriginalValue
      }
      const gap = betweenListItems(blocks, comment.pos.startOffset, placeHoisted)
      if (gap) {
        gap.list.transparentBetweenItems ??= []
        gap.list.transparentBetweenItems.push({ after: gap.after, source: original, node: comment, originalValue: comment.content })
        comment.transparentInList = true
      }
      const trailing = stream.authoredTrace.length === 0 ? trailingListOwner(blocks, comment.pos.startColumn ?? 1) : null
      // A line whose column reaches no container is the document's (carve#5178).
      const siblings = owned?.blocks ?? trailing?.blocks ?? (owner === 'doc' && !footnote ? document.children : containingBlocks(blocks, comment.pos.startOffset))
      const pending = hoisted.get(siblings)
      if (pending && pending.at(-1)!.pos!.startOffset! > comment.pos.startOffset) placeHoisted()
      if (hoisted.has(siblings)) hoisted.get(siblings)!.push(comment)
      else hoisted.set(siblings, [comment])
      if (stream.authoredTrace.length === 0) placeHoisted()
      for (const container of trailing?.containers ?? []) {
        if (container.pos?.endOffset !== undefined && comment.pos.endOffset !== undefined &&
            container.pos.endOffset < comment.pos.endOffset) {
          container.pos.endLine = comment.pos.endLine
          if (comment.pos.endColumn !== undefined) container.pos.endColumn = comment.pos.endColumn
          container.pos.endOffset = comment.pos.endOffset
        }
      }
      // Only an owner that received the comment ends on its line; one it was
      // hoisted out of keeps its own end (CARVE-P12-014, carve#5136).
      if (owned && owner && comment.pos.endOffset !== undefined) {
        const parts = owner.split('/')
        // A collected footnote is hoisted out of its source host. Its owned
        // comment extends the note, not the list item or quote that held it.
        const notePart = parts.findIndex((part) => part.startsWith('footnote:'))
        for (let depth = notePart < 0 ? 2 : notePart + 1; depth <= parts.length; depth++) {
          for (const container of ownedBlocks.get(parts.slice(0, depth).join('/'))?.containers ?? []) {
            if (container.pos?.endOffset !== undefined && container.pos.endOffset < comment.pos.endOffset) {
              container.pos.endLine = comment.pos.endLine
              if (comment.pos.endColumn !== undefined) container.pos.endColumn = comment.pos.endColumn
              container.pos.endOffset = comment.pos.endOffset
            }
          }
        }
      }
    }
  }
  placeHoisted()
}

export function restoreTransparentAbbreviations(document: Document, definitions: AbbreviationDef[], stream: TransparentLineStream): void {
  blockIndexes = new WeakMap()
  for (const definition of definitions) {
    const line = definition.pos!.startLine
    const match = containingParagraph(document.children, definition.pos!.startOffset!)
    if (match) {
      match.paragraph.transparentVisibleLines ??= visibleParagraphLines(match.paragraph, stream)
      match.paragraph.transparentComments ??= []
      match.paragraph.transparentComments.push({ line, source: stream.original[line - 1]!, node: definition,
        originalValue: `${definition.abbr}\0${definition.expansion}` })
      recordFollowingLines(match.paragraph, line, (child) => stream.original[child.pos!.startLine - 1]!)
      definition.transparentInParagraph = true
    } else {
      const descriptionGap = betweenDescriptions(document.children, definition.pos!.startOffset!, line)
      if (descriptionGap) recordDescriptionGap(descriptionGap, stream.original[line - 1]!, definition,
        `${definition.abbr}\0${definition.expansion}`)
      const gap = betweenListItems(document.children, definition.pos!.startOffset!)
      if (gap) {
        gap.list.transparentBetweenItems ??= []
        gap.list.transparentBetweenItems.push({ after: gap.after, source: stream.original[line - 1]!, node: definition,
          originalValue: `${definition.abbr}\0${definition.expansion}` })
        definition.transparentInList = true
      }
    }
    // Abbreviations register document-wide and their AST nodes hoist beside
    // the host block, even when a paragraph or list writes the source line.
    const at = document.children.findIndex((block) => (block.pos?.startOffset ?? Infinity) > definition.pos!.startOffset!)
    document.children.splice(at < 0 ? document.children.length : at, 0, definition)
  }
}

