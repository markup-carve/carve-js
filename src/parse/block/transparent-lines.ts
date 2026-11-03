import { Lexer } from '../parse-lexer.js'
import { ownLines, type TraceRecord } from './block-ownership.js'
import { isLinkDefLine, RE_FOOTNOTE_DEF } from '../parse-prepass-core.js'
import type { AbbreviationDef, BlockNode, Comment, Document, List, Paragraph } from '../../ast.js'

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
        const before = block.items[i]?.pos?.endOffset
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

/** Keep the authored comment node and let a paragraph crossing it write its line. */
export function restoreTransparentComments(document: Document, authored: Document, stream: TransparentLineStream): void {
  const comments = authoredComments(authored)
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
      match.paragraph.transparentFollowingLines ??= []
      for (const child of match.paragraph.children) {
        const line = child.pos?.startLine
        if (line === undefined || line <= index + 1 ||
            match.paragraph.transparentFollowingLines.some((entry) => entry.line === line)) continue
        match.paragraph.transparentFollowingLines.push({ line, source: stream.original[line - 1]! })
      }
      comment.transparentInParagraph = true
      insertAfterParagraph(match.siblings, match.paragraph, comment)
    } else {
      const gap = betweenListItems(blocks, comment.pos.startOffset)
      if (gap) {
        gap.list.transparentBetweenItems ??= []
        gap.list.transparentBetweenItems.push({ after: gap.after, source: original, node: comment, originalValue: comment.content })
        comment.transparentInList = true
      }
      const siblings = containingBlocks(blocks, comment.pos.startOffset)
      const at = siblings.findIndex((block) => (block.pos?.startOffset ?? Infinity) > comment.pos!.startOffset!)
      siblings.splice(at < 0 ? siblings.length : at, 0, comment)
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
      match.paragraph.transparentFollowingLines ??= []
      for (const child of match.paragraph.children) {
        const following = child.pos?.startLine
        if (following === undefined || following <= line ||
            match.paragraph.transparentFollowingLines.some((entry) => entry.line === following)) continue
        match.paragraph.transparentFollowingLines.push({ line: following, source: stream.original[following - 1]! })
      }
      definition.transparentInParagraph = true
    } else {
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
