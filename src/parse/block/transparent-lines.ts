import { Lexer } from '../parse-lexer.js'
import { ownLines, type TraceRecord } from './block-ownership.js'
import { isLinkDefLine, RE_FOOTNOTE_DEF } from '../parse-prepass-core.js'
import { commentLineContent } from './parse-block-scan-core.js'
import type { AbbreviationDef, BlockNode, BlockQuote, Comment, DefinitionList, Document, InlineNode, List, ListItem, Paragraph, Position } from '../../ast.js'

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

type BlockIndex = { length: number; starts: number[]; ends: number[]; reach: number[] } | { length: number; unsorted: true }
let blockIndexes = new WeakMap<readonly object[], BlockIndex>()

// Sibling blocks stand in source order, so only those starting at or before an offset and reaching
// past it can hold it (carve-js#4392). `reach` is the furthest end so far, which finds overlapping
// siblings too. An array with a block that has no usable offsets is scanned in full.
function candidateBlocks<T extends object>(blocks: readonly T[], offset: number): readonly T[] {
  if (blocks.length < 16) return blocks
  let index = blockIndexes.get(blocks)
  if (index === undefined || index.length !== blocks.length) {
    const starts: number[] = []
    const ends: number[] = []
    const reach: number[] = []
    let sorted = true
    for (const block of blocks) {
      const span = spanOf(block)
      const start = span?.startOffset
      const end = span?.endOffset
      if (start === undefined || end === undefined || Number.isNaN(start) || Number.isNaN(end) ||
          start < (starts.at(-1) ?? -Infinity)) {
        sorted = false
        break
      }
      starts.push(start)
      ends.push(end)
      reach.push(Math.max(reach.at(-1) ?? -Infinity, end))
    }
    index = sorted ? { length: blocks.length, starts, ends, reach } : { length: blocks.length, unsorted: true }
    blockIndexes.set(blocks, index)
  }
  if ('unsorted' in index) return blocks
  let lo = 0
  let hi = blocks.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (index.starts[mid]! <= offset) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  const out: T[] = []
  for (let i = found; i >= 0 && index.reach[i]! > offset; i--) if (index.ends[i]! > offset) out.push(blocks[i]!)
  return out.reverse()
}

/** The content column of a list item, where a quote it holds puts its marker. */
function itemContentColumn(item: ListItem): number | undefined {
  return item.children[0]?.pos?.startColumn
}

/** `quotes` holds, per quote between `blocks` and the paragraph, the least column of its marker (outermost first). */
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
        if (match) return block.type === 'block_quote' ? { ...match, quotes: [base, ...match.quotes] } : match
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

function betweenDescriptions(blocks: BlockNode[], offset: number, line: number):
  { list: DefinitionList; item: number; afterDescription: number; afterTerm: number } | null {
  for (const block of candidateBlocks(blocks, offset)) {
    if ((spanOf(block)?.startOffset ?? Infinity) > offset || offset >= (spanOf(block)?.endOffset ?? -1)) continue
    if (block.type === 'definition_list') {
      for (const item of block.items) {
        for (const definition of item.definitions) {
          const nested = betweenDescriptions(definition, offset, line)
          if (nested) return nested
        }
      }
      let preceding: { item: number; afterDescription: number; afterTerm: number; line: number } | undefined
      block.items.forEach((item, itemIndex) => {
        item.termSpans?.forEach((span, termIndex) => {
          const start = span?.startLine
          if (start !== undefined && start < line && (preceding?.line ?? -1) < start)
            preceding = { item: itemIndex, afterDescription: -1, afterTerm: termIndex, line: start }
        })
        item.definitionLines?.forEach((start, definitionIndex) => {
          if (start !== undefined && start < line && (preceding?.line ?? -1) < start)
            preceding = { item: itemIndex, afterDescription: definitionIndex, afterTerm: -1, line: start }
        })
      })
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

/** Rebuild writer-only placement after a PART 12 AST round trip strips it. */
export function hydrateTransparentDefinitionGaps(document: Document): void {
  derivedSpans = new WeakMap()
  blockIndexes = new WeakMap()
  // A quote marker goes at the content column of the item holding the quote, so the line stays in
  // that item; otherwise right after the marker before it.
  const authoredSource = (block: Comment | AbbreviationDef, quotes: ReadonlyArray<number | undefined>): string => {
    const column = block.pos?.startColumn ?? 1
    let source = ''
    let next = 1
    if (column > 1) for (const quote of quotes) {
      const at = Math.max(quote ?? next, next)
      source += ' '.repeat(at - next) + '> '
      next = at + 2
    }
    return source + ' '.repeat(Math.max(0, column - next)) +
      (block.type === 'comment' ? block.content === '' ? '%%' : `%% ${block.content}` :
        `*[${block.abbr}]: ${block.expansion}`)
  }
  const visit = (blocks: BlockNode[], markerLine?: number): void => {
    const pending: Array<{ block: BlockNode; quotes: Array<number | undefined>; base: number | undefined;
      markerLine: number | undefined }> = blocks.map((block) => ({ block, quotes: [], base: undefined, markerLine }))
    for (let at = 0; at < pending.length; at++) {
      const { block, quotes, base, markerLine } = pending[at]!
      const onMarkerLine = block.pos?.startLine !== undefined && block.pos.startLine === markerLine
      if (block.type === 'comment' && !block.block && !block.delimited && block.pos &&
          !onMarkerLine && block.transparentSource === undefined) {
        block.transparentSource = authoredSource(block, quotes)
        block.transparentOriginalValue = block.content
      }
      if ((block.type === 'comment' && !block.block && !onMarkerLine || block.type === 'abbreviation_def') &&
          !block.transparentInDefinitionList && !block.transparentInParagraph && !block.transparentInList &&
          block.pos?.startOffset !== undefined && block.pos.startLine !== undefined) {
        const originalValue = block.type === 'comment' ? block.content : `${block.abbr}\0${block.expansion}`
        const match = containingParagraph(blocks, block.pos.startOffset)
        // A line erased inside a quoted paragraph is spelled with that paragraph's quotes (carve#5129).
        const source = authoredSource(block, match ? match.quotes : quotes)
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
          for (const child of definition) pending.push({ block: child, quotes, base, markerLine: item.definitionLines?.[index] })
      else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading')
        for (const child of block.children as BlockNode[]) pending.push({ block: child,
          quotes: block.type === 'block_quote' ? [...quotes, base] : quotes,
          base: block.type === 'block_quote' ? undefined : base,
          markerLine: block.type === 'block_quote' ? block.pos?.startLine : markerLine })
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

/** A visible container can end before its last erased line; source ownership still names it. */
function authoredContainerBlocks(document: Document, owners: Map<number, string>):
  Map<string, { blocks: BlockNode[]; containers: Array<BlockQuote | List | ListItem> }> {
  const blocksByOwner = new Map<string, { blocks: BlockNode[]; containers: Array<BlockQuote | List | ListItem> }>()
  const visit = (blocks: BlockNode[]): void => {
    for (const block of blocks) {
      if (block.type === 'block_quote') {
        const owner = owners.get(block.pos?.startLine ?? -1)?.match(/^.*\/quote:\d+/)?.[0]
        if (owner) blocksByOwner.set(owner, { blocks: block.children, containers: [block] })
      }
      if (block.type === 'list') {
        for (const item of block.items) {
          const owner = owners.get(item.pos?.startLine ?? -1)?.match(/^.*\/item:\d+/)?.[0]
          if (owner) blocksByOwner.set(owner, { blocks: item.children, containers: [item, block] })
          visit(item.children)
        }
      } else if (block.type === 'definition_list') {
        for (const item of block.items) for (const definition of item.definitions) visit(definition)
      } else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading') {
        visit(block.children as BlockNode[])
      }
    }
  }
  visit(document.children)
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
  const ownersByLine = new Map(stream.authoredTrace.map((record) => [record.line, record.owner]))
  const ownedBlocks = authoredContainerBlocks(document, ownersByLine)
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
    const footnote = Object.entries(document.footnoteDefPos ?? {}).find(([_label, pos]) =>
      pos.startLine <= index + 1 && index + 1 <= pos.endLine)?.[0]
    const blocks = footnote ? document.footnoteDefs?.[footnote] ?? document.children : document.children
    const match = containingParagraph(blocks, comment.pos!.startOffset!)
    if (match) {
      match.paragraph.transparentVisibleLines ??= visibleParagraphLines(match.paragraph, stream)
      match.paragraph.transparentComments ??= []
      match.paragraph.transparentComments.push({ line: index + 1, source: original, node: comment, originalValue: comment.content })
      recordFollowingLines(match.paragraph, index + 1, (child) => stream.original[child.pos!.startLine - 1]!)
      comment.transparentInParagraph = true
      placeHoisted()
      insertAfterParagraph(match.siblings, match.paragraph, comment)
    } else {
      const descriptionGap = betweenDescriptions(blocks, comment.pos.startOffset, index + 1)
      if (descriptionGap) recordDescriptionGap(descriptionGap, original, comment, comment.content)
      const gap = betweenListItems(blocks, comment.pos.startOffset, placeHoisted)
      if (gap) {
        gap.list.transparentBetweenItems ??= []
        gap.list.transparentBetweenItems.push({ after: gap.after, source: original, node: comment, originalValue: comment.content })
        comment.transparentInList = true
      }
      const owner = ownersByLine.get(index + 1)
      const owned = owner === undefined ? undefined : ownedBlocks.get(owner)
      const trailing = stream.authoredTrace.length === 0 ? trailingListOwner(blocks, comment.pos.startColumn ?? 1) : null
      const siblings = owned?.blocks ?? trailing?.blocks ?? containingBlocks(blocks, comment.pos.startOffset)
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
        for (let depth = 2; depth <= parts.length; depth++) {
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

