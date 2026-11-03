import { Lexer } from '../parse-lexer.js'
import { ownLines, type TraceRecord } from './block-ownership.js'
import { isLinkDefLine, RE_FOOTNOTE_DEF } from '../parse-prepass-core.js'
import type { AbbreviationDef, BlockNode, BlockQuote, Comment, DefinitionList, Document, InlineNode, List, ListItem, Paragraph } from '../../ast.js'

export interface TransparentLineStream {
  lines: string[]
  original: string[]
  sourceLines: number[]
  erased: number[]
  authoredTrace: TraceRecord[]
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
  const trace: TraceRecord[] = []
  ownLines(original, lexer.pos, trace)
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
  for (let index = 0; index < original.length; index++) {
    if (!erasedSet.has(index)) {
      lines.push(original[index]!)
      sourceLines.push(index)
      continue
    }
    // Keep an empty quote scaffold so nested note and quote ownership remains
    // available to the layout reader without exposing the erased payload.
    const quotePrefix = /^(?:[ \t]*>[ ]?)+/.exec(original[index]!)?.[0]
    if (quotePrefix) {
      lines.push(quotePrefix)
      sourceLines.push(index)
    }
  }
  return { lines, original, sourceLines, erased, authoredTrace: trace }
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

function containingParagraph(blocks: BlockNode[], offset: number): { paragraph: Paragraph; siblings: BlockNode[] } | null {
  for (const block of blocks) {
    const pos = block.pos
    if (pos?.startOffset !== undefined && pos.endOffset !== undefined &&
        pos.startOffset <= offset && offset < pos.endOffset) {
      if (block.type === 'paragraph') return { paragraph: block, siblings: blocks }
      const children = block.type === 'list' ? block.items.map((item) => item.children) :
        block.type === 'definition_list' ? block.items.flatMap((item) => item.definitions) :
        'children' in block && Array.isArray(block.children) && block.type !== 'heading' ?
          [block.children as BlockNode[]] : []
      for (const child of children) {
        const match = containingParagraph(child, offset)
        if (match) return match
      }
    }
  }
  return null
}

function containingBlocks(blocks: BlockNode[], offset: number): BlockNode[] {
  for (const block of blocks) {
    const pos = block.pos
    if (pos?.startOffset === undefined || pos.endOffset === undefined ||
        pos.startOffset > offset || offset >= pos.endOffset) continue
    if (block.type === 'list') {
      for (const item of block.items) {
        if ((item.pos?.startOffset ?? Infinity) <= offset && offset < (item.pos?.endOffset ?? -1)) {
          return containingBlocks(item.children, offset)
        }
      }
    } else if (block.type === 'definition_list') {
      for (const item of block.items) {
        for (const definition of item.definitions) {
          if (definition.some((child) => (child.pos?.startOffset ?? Infinity) <= offset &&
              offset < (child.pos?.endOffset ?? -1))) return containingBlocks(definition, offset)
        }
      }
    } else if ('children' in block && Array.isArray(block.children) &&
               block.type !== 'paragraph' && block.type !== 'heading') {
      return containingBlocks(block.children as BlockNode[], offset)
    }
  }
  return blocks
}

function betweenListItems(blocks: BlockNode[], offset: number): { list: List; after: number } | null {
  for (const block of blocks) {
    if (block.type === 'list') {
      for (let i = 0; i < block.items.length - 1; i++) {
        const item = block.items[i]
        const visibleEnd = item?.children.at(-1)?.pos?.endOffset
        const itemEnd = item?.pos?.endOffset
        const before = visibleEnd === undefined ? itemEnd : Math.min(visibleEnd, itemEnd ?? visibleEnd)
        const after = block.items[i + 1]?.pos?.startOffset
        if (before !== undefined && after !== undefined && before <= offset && offset < after)
          return { list: block, after: i }
      }
      for (const item of block.items) {
        const nested = betweenListItems(item.children, offset)
        if (nested) return nested
      }
    } else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading') {
      const nested = betweenListItems(block.children as BlockNode[], offset)
      if (nested) return nested
    }
  }
  return null
}

function betweenDescriptions(blocks: BlockNode[], offset: number, line: number):
  { list: DefinitionList; item: number; afterDescription: number; afterTerm: number } | null {
  for (const block of blocks) {
    if ((block.pos?.startOffset ?? Infinity) > offset || offset >= (block.pos?.endOffset ?? -1)) continue
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
      for (const item of block.items) {
        const nested = betweenDescriptions(item.children, offset, line)
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
  const authoredSource = (block: Comment | AbbreviationDef, quoteDepth: number): string => {
    const column = block.pos?.startColumn ?? 1
    const quoted = column > 1 ? quoteDepth : 0
    return '> '.repeat(quoted) +
      ' '.repeat(Math.max(0, column - 1 - 2 * quoted)) +
        (block.type === 'comment' ? block.content === '' ? '%%' : `%% ${block.content}` :
          `*[${block.abbr}]: ${block.expansion}`)
  }
  const visit = (blocks: BlockNode[], quoteDepth: number): void => {
    for (const block of blocks) {
      if (block.type === 'comment' && !block.block && !block.delimited && block.pos &&
          block.transparentSource === undefined) {
        block.transparentSource = authoredSource(block, quoteDepth)
        block.transparentOriginalValue = block.content
      }
      if ((block.type === 'comment' && !block.block || block.type === 'abbreviation_def') &&
          !block.transparentInDefinitionList && !block.transparentInParagraph && !block.transparentInList &&
          block.pos?.startOffset !== undefined && block.pos.startLine !== undefined) {
        const source = authoredSource(block, quoteDepth)
        const originalValue = block.type === 'comment' ? block.content : `${block.abbr}\0${block.expansion}`
        const match = containingParagraph(blocks, block.pos.startOffset)
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
      if (block.type === 'list') for (const item of block.items) visit(item.children, quoteDepth)
      else if (block.type === 'definition_list') for (const item of block.items)
        for (const definition of item.definitions) visit(definition, quoteDepth)
      else if ('children' in block && Array.isArray(block.children) && block.type !== 'paragraph' && block.type !== 'heading')
        visit(block.children as BlockNode[], quoteDepth + (block.type === 'block_quote' ? 1 : 0))
    }
  }
  visit(document.children, 0)
  for (const blocks of Object.values(document.footnoteDefs ?? {})) visit(blocks, 0)
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
export function restoreTransparentComments(document: Document, authored: Document, stream: TransparentLineStream): void {
  const comments = authoredComments(authored)
  const ownersByLine = new Map(stream.authoredTrace.map((record) => [record.line, record.owner]))
  const ownedBlocks = authoredContainerBlocks(document, ownersByLine)
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
      insertAfterParagraph(match.siblings, match.paragraph, comment)
    } else {
      const descriptionGap = betweenDescriptions(blocks, comment.pos.startOffset, index + 1)
      if (descriptionGap) recordDescriptionGap(descriptionGap, original, comment, comment.content)
      const gap = betweenListItems(blocks, comment.pos.startOffset)
      if (gap) {
        gap.list.transparentBetweenItems ??= []
        gap.list.transparentBetweenItems.push({ after: gap.after, source: original, node: comment, originalValue: comment.content })
        comment.transparentInList = true
      }
      const owner = ownersByLine.get(index + 1)
      const owned = owner === undefined ? undefined : ownedBlocks.get(owner)
      const siblings = owned?.blocks ?? containingBlocks(blocks, comment.pos.startOffset)
      const at = siblings.findIndex((block) => (block.pos?.startOffset ?? Infinity) > comment.pos!.startOffset!)
      siblings.splice(at < 0 ? siblings.length : at, 0, comment)
      if (owner && comment.pos.endOffset !== undefined) {
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
}

export function restoreTransparentAbbreviations(document: Document, definitions: AbbreviationDef[], stream: TransparentLineStream): void {
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

/** A retained quote scaffold can appear as literal text on a marker-line lead. */
export function dropTransparentScaffoldText(document: Document, stream: TransparentLineStream): void {
  const erased = new Set(stream.erased.map((index) => index + 1))
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (node.type === 'paragraph') {
      const paragraph = value as Paragraph
      const tail = paragraph.children.at(-1)
      if (tail?.type === 'text' && /^>+$/.test(tail.value) && tail.pos && erased.has(tail.pos.startLine)) {
        paragraph.children.pop()
        if (paragraph.children.at(-1)?.type === 'soft_break') paragraph.children.pop()
        const last = paragraph.children.at(-1)?.pos
        if (last && paragraph.pos) {
          paragraph.pos.endLine = last.endLine
          if (last.endColumn !== undefined) paragraph.pos.endColumn = last.endColumn
          if (last.endOffset !== undefined) paragraph.pos.endOffset = last.endOffset
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'pos' && key !== 'attrs') visit(child)
    }
  }
  visit(document.children)
  visit(document.footnoteDefs)
}

/** Split a quoted paragraph where an erased quote line supplies a blank scaffold. */
export function splitTransparentQuoteParagraphs(document: Document, stream: TransparentLineStream): void {
  const erased = new Set(stream.erased.map((index) => index + 1))
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      const blocks = value as BlockNode[]
      for (let i = 0; i < blocks.length; i++) {
        const paragraph = blocks[i]
        if (paragraph?.type === 'paragraph') {
          const at = paragraph.children.findIndex((child, index) => index > 0 &&
            child.type === 'text' && /^>+$/.test(child.value) && child.pos && erased.has(child.pos.startLine))
          if (at > 0 && at + 2 < paragraph.children.length &&
              paragraph.children[at - 1]?.type === 'soft_break' && paragraph.children[at + 1]?.type === 'soft_break') {
            const line = paragraph.children[at]!.pos!.startLine
            const after = paragraph.children.slice(at + 2)
            paragraph.children = paragraph.children.slice(0, at - 1)
            const firstEnd = paragraph.children.at(-1)?.pos
            const afterStart = after[0]?.pos
            const afterEnd = after.at(-1)?.pos
            if (paragraph.pos && firstEnd) {
              paragraph.pos.endLine = firstEnd.endLine
              if (firstEnd.endColumn !== undefined) paragraph.pos.endColumn = firstEnd.endColumn
              if (firstEnd.endOffset !== undefined) paragraph.pos.endOffset = firstEnd.endOffset
            }
            if (paragraph.transparentVisibleLines) {
              paragraph.transparentVisibleLines = paragraph.transparentVisibleLines.filter((visible) => visible < line)
            }
            paragraph.transparentFollowingLines = []
            const following: Paragraph = { type: 'paragraph', children: after }
            if (afterStart && afterEnd) following.pos = {
              startLine: afterStart.startLine, endLine: afterEnd.endLine,
              ...(afterStart.startColumn !== undefined ? { startColumn: afterStart.startColumn } : {}),
              ...(afterEnd.endColumn !== undefined ? { endColumn: afterEnd.endColumn } : {}),
              ...(afterStart.startOffset !== undefined ? { startOffset: afterStart.startOffset } : {}),
              ...(afterEnd.endOffset !== undefined ? { endOffset: afterEnd.endOffset } : {}),
            }
            let insert = i + 1
            while (blocks[insert]?.type === 'comment' && blocks[insert]?.pos?.startLine === line) insert++
            blocks.splice(insert, 0, following)
          }
        }
        visit(blocks[i])
      }
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key !== 'pos' && key !== 'attrs') visit(child)
    }
  }
  visit(document.children)
  visit(document.footnoteDefs)
}
