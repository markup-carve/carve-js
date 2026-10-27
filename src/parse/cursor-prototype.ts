import type { Attrs, BlockNode, BlockQuote, CodeBlock, DefinitionItem, DefinitionList, Document, HeadingLevel, InlineNode, List, ListItem, Paragraph, Position, Table, TableRow, TaskState } from '../ast.js'
import type { InlineSource } from '../parse.js'
import { GENERATED_CONTENT_KINDS } from '../ast.js'
import { utf8ByteLength } from '../extension/abbr-budget.js'
import { dropPositions, toCodepointPositions } from '../source/source-positions.js'
import { normalizeRefLabel } from '../label-key.js'
import { promoteBlockImages } from '../heading/heading-ids.js'
import { promoteCitationDefinitions } from '../extension/citations.js'
import { mergeAttrs } from '../extension/attribute-merge.js'
import { parseAttrs, unescapeAttrValue } from '../extension/attribute-parser.js'
import { dropTrailingWhitespace, readCaptionText } from './block/parse-block-boundaries.js'
import { MAX_NESTING_DEPTH, commentLineContent } from './block/parse-block-scan-core.js'
import { markAboveContentColumn } from './block/paragraph-indent.js'
import { RE_CAPTION, RE_COMMENT_BLOCK_ANY, isBlockImageLine } from './block/parse-quote-core.js'
import { trimNonNbsp } from '../trim-non-nbsp.js'
import { replaceLoneSurrogates } from '../well-formed.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import { inlineSource } from './inline/parse-inline-core.js'
import type { LinkDef } from './inline/inline-resolution.js'
import { olKindOf, olStartOf, sourceColumnAt, type OlKind } from './list/parse-item-core.js'
import { RE_ADMONITION_OPEN, RE_BLOCKQUOTE, RE_FENCE, RE_HARDBREAKS_OPEN, RE_HEADING, RE_LINE_BLOCK_OPEN, RE_ORDERED, RE_QUOTE_BLOCK_OPEN, RE_RAW_FENCE, consumeLooseKey, deriveTableMetadata, extractItemAttr, isTableRow, matchLinkDef, parseBlockAttributeRun, probeBlockAttributes } from './parse-prepass-core.js'
import { Lexer, isBlankLine } from './parse-lexer.js'
import type { ParseOptions } from './block/parse-block-scan-core.js'
import { commentBlockHasCloser, isFigureGroupOpener, parseCommentBlock, parseLineBlockWithHelpers, parseRawBlock, parseTableBlock } from './parse-core.js'
import { delimitedTable, setDelimitedPayloadLines } from '../table/delimited-table.js'

/**
 * An isolated block-cursor experiment. It deliberately fails on syntax that has
 * not been migrated; production entry points never invoke it.
 */
export class UnsupportedCursorSyntax extends Error {}

interface SourceLine { text: string; start: number; number: number; baseColumn?: number;
  spanEndColumn?: number; lazyText?: boolean; wrappedAttr?: boolean }
type ContainerKind = 'root' | 'quote' | 'colon' | 'list' | 'definition'
interface ContainerOwner {
  readonly kind: ContainerKind
  readonly inList: boolean
  readonly inFigureGroup?: boolean
  readonly allowEmptyFence?: boolean
  readonly allowUnclosedFence?: boolean
  readonly fenceBoundary?: SourceLine
  readonly listRootPrefix?: number
  readonly parent?: ContainerOwner
}
const ROOT_OWNER: ContainerOwner = { kind: 'root', inList: false }

function childOwner(parent: ContainerOwner, kind: Exclude<ContainerKind, 'root'>,
  allowEmptyFence = false, allowUnclosedFence = false, fenceBoundary?: SourceLine,
  listRootPrefix = parent.listRootPrefix): ContainerOwner {
  return { kind, inList: kind === 'list' || parent.inList, parent,
    ...(parent.inFigureGroup ? { inFigureGroup: true } : {}),
    ...(allowEmptyFence ? { allowEmptyFence } : {}),
    ...(allowUnclosedFence ? { allowUnclosedFence } : {}),
    ...(fenceBoundary ? { fenceBoundary } : {}),
    ...(listRootPrefix === undefined ? {} : { listRootPrefix }) }
}

function figureGroupOwner(owner: ContainerOwner, figureGroup: boolean): ContainerOwner {
  return figureGroup ? { ...owner, inFigureGroup: true } : owner
}

function unsupportedReferencesColon(colon: RegExpExecArray): boolean {
  return colon[2] === 'references' && colon[1] !== ':::'
}

class Cursor {
  at = 0
  sharedLexer?: Lexer
  fenceCloserSuffix?: { backtick: Uint32Array; tilde: Uint32Array }
  simpleRootListDefinitions?: Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>
  constructor(readonly lines: SourceLine[], readonly rootSource?: string,
    readonly owner: ContainerOwner = ROOT_OWNER,
    readonly physicalLines: SourceLine[] = lines,
    simpleListDefinitions?: Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>) {
    if (simpleListDefinitions) this.simpleRootListDefinitions = simpleListDefinitions
  }
  peek(n = 0): SourceLine | undefined { return this.lines[this.at + n] }
  take(): SourceLine { return this.lines[this.at++]! }
}

function lexerForCursor(cursor: Cursor): Lexer {
  if (cursor.sharedLexer) return cursor.sharedLexer
  const lexer = cursor.rootSource ? new Lexer(cursor.rootSource) :
    new Lexer(cursor.lines.map((line) => line.text))
  if (cursor.rootSource && cursor.lines[0]?.baseColumn === 2) {
    lexer.sourceOffsetMap = cursor.lines.map((line) => line.start)
    lexer.linePrefixWidths = cursor.lines.map((_line, index) => index === 0 ? 1 : 0)
  } else if (!cursor.rootSource) {
    lexer.nested = true
    lexer.sourceLineMap = cursor.lines.map((line) => line.number)
    lexer.sourceOffsetMap = cursor.lines.map((line) => line.start)
    lexer.linePrefixWidths = cursor.lines.map((line) => (line.baseColumn ?? 1) - 1)
  }
  cursor.sharedLexer = lexer
  return lexer
}

function scanLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  if (!source.includes('\r')) {
    let end: number
    while ((end = source.indexOf('\n', start)) !== -1) {
      lines.push({ text: source.slice(start, end), start, number: lines.length + 1 })
      start = end + 1
    }
    if (start < source.length || lines.length === 0) {
      lines.push({ text: source.slice(start), start, number: lines.length + 1 })
    }
    return lines
  }
  let nextLF = source.indexOf('\n', start)
  let nextCR = source.indexOf('\r', start)
  while (nextLF !== -1 || nextCR !== -1) {
    const end = nextCR !== -1 && (nextLF === -1 || nextCR < nextLF) ? nextCR : nextLF
    lines.push({ text: source.slice(start, end), start, number: lines.length + 1 })
    start = end + 1
    if (end === nextCR && source.charCodeAt(start) === 10) start++
    if (nextLF !== -1 && nextLF < start) nextLF = source.indexOf('\n', start)
    if (nextCR !== -1 && nextCR < start) nextCR = source.indexOf('\r', start)
  }
  if (start < source.length || lines.length === 0) {
    lines.push({ text: source.slice(start), start, number: lines.length + 1 })
  }
  return lines
}

function commentOpenersWithCloser(lines: SourceLine[]): Set<number> {
  const remainingRuns = new Map<number, number>()
  const openers = new Set<number>()
  for (const line of lines) {
    if (line.text[0] !== '%') continue
    const match = RE_COMMENT_BLOCK_ANY.exec(line.text)
    if (!match) continue
    const run = match[1]!.length
    remainingRuns.set(run, (remainingRuns.get(run) ?? 0) + 1)
  }
  let openRun: number | undefined
  for (const line of lines) {
    if (line.text[0] !== '%') continue
    const match = RE_COMMENT_BLOCK_ANY.exec(line.text)
    if (!match) continue
    const run = match[1]!.length
    const remaining = remainingRuns.get(run)! - 1
    remainingRuns.set(run, remaining)
    if (openRun !== undefined) {
      if (openRun === run) openRun = undefined
    } else if (remaining > 0) {
      openers.add(line.start)
      openRun = run
    }
  }
  return openers
}

function position(first: SourceLine, last: SourceLine, firstColumn = 1, lastColumn = last.text.length + 1): Position {
  return {
    startLine: first.number,
    endLine: last.number,
    startColumn: (first.baseColumn ?? 1) + firstColumn - 1,
    endColumn: (last.baseColumn ?? 1) + lastColumn - 1,
    startOffset: first.start + firstColumn - 1,
    endOffset: last.start + lastColumn - 1,
  }
}

function contentEndColumn(line: SourceLine): number {
  if (line.spanEndColumn !== undefined) return line.spanEndColumn
  let end = line.text.length
  while (end > 0 && (line.text.charCodeAt(end - 1) === 32 || line.text.charCodeAt(end - 1) === 9)) end--
  return end + 1
}

type ContentLine = { line: SourceLine; column: number; text: string }
const RE_PLAIN_CURSOR_TEXT = /^[A-Za-z0-9 .,;!?()]+$/
function plainCursorText(text: string): boolean {
  return RE_PLAIN_CURSOR_TEXT.test(text) && !text.includes('..') &&
    !/\((?:c|r|tm)\)/i.test(text)
}

class CursorInline extends InlineParseSession {
  // Image promotion only changes paragraphs whose first inline node is an image.
  hasLeadingImage = false
  constructor(readonly linkDefinitions: Map<string, LinkDef>,
    readonly abbreviations: Map<string, string>) { super() }
  tableInlines(text: string, source?: InlineSource, captionContext = false): InlineNode[] {
    return this.parseInline(text, this.abbreviations, this.linkDefinitions, source, captionContext)
  }
  lineBlockInlines(text: string, source?: InlineSource, captionContext = false): InlineNode[] {
    const previous = this.inLineBlock
    this.inLineBlock = true
    try {
      return this.parseInline(text, this.abbreviations, this.linkDefinitions, source, captionContext)
    } finally {
      this.inLineBlock = previous
    }
  }
  inlines(parts: ContentLine[], captionContext = false): InlineNode[] {
    const first = parts[0]!
    const multiLine = parts.length > 1
    if (parts.length >= 3 && !captionContext && this.abbreviations.size === 0 &&
        parts.every((part) => part.text.trim() === part.text && plainCursorText(part.text))) {
      const nodes: InlineNode[] = []
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!
        if (index > 0) {
          const before = parts[index - 1]!
          nodes.push({ type: 'soft_break', pos: position(before.line, part.line,
            before.column + before.text.length, part.column) })
        }
        nodes.push({ type: 'text', value: part.text,
          pos: position(part.line, part.line, part.column, part.column + part.text.length) })
      }
      return nodes
    }
    const text = dropTrailingWhitespace(multiLine ? parts.map((part) => part.text).join('\n') : first.text)
    if (!multiLine && !captionContext && this.abbreviations.size === 0 && text.length > 0 &&
        plainCursorText(text)) {
      return [{ type: 'text', value: text,
        pos: position(first.line, first.line, first.column, first.column + text.length) }]
    }
    const lineAnchors = multiLine ? parts.map((part) => ({
      offset: part.line.start + part.column - 1,
      column: (part.line.baseColumn ?? 1) + part.column - 1, line: part.line.number,
    })) : undefined
    const nodes = this.parseInline(text, this.abbreviations, this.linkDefinitions, {
      anchored: true,
      baseOffset: first.line.start + first.column - 1,
      startLine: first.line.number,
      startColumn: (first.line.baseColumn ?? 1) + first.column - 1,
      ...(lineAnchors ? { lineAnchors } : {}),
    }, captionContext)
    if (nodes[0]?.type === 'image') this.hasLeadingImage = true
    return nodes
  }
}

function imageReferenceResolved(image: Extract<InlineNode, { type: 'image' }>, inline: CursorInline): boolean {
  return !image.ref || inline.linkDefinitions.has(normalizeRefLabel(image.ref))
}

const BULLET = /^([ \t]*)([-*]) +(.*)$/
function fenceOpen(line: string) {
  if (line[0] !== '`' && line[0] !== '~') return null
  const match = RE_FENCE.exec(line)
  if (!match) return null
  const headerRaw = match[4] ?? match[6]
  const labelRaw = match[5] ?? match[7] ?? match[8]
  return { marker: match[2]!, lang: match[3],
    header: headerRaw?.slice(1, -1), label: labelRaw?.slice(1, -1) }
}
const COLON_OPEN = /^(:{3,})(?: +([A-Za-z0-9_][A-Za-z0-9_-]*))?(?: +"([^"]+)")?(?: *\[([A-Za-z0-9_/-]+)\])?[ \t]*$/
const BREAK = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
function rootLinkDef(line: string) {
  return line.startsWith('[') && (!line.startsWith('[^') || line[2] === ']') ? matchLinkDef(line) : null
}

function boundedAdjacentDefinitionTail(lines: SourceLine[], lineNumber: number,
  prefix: string): boolean {
  const next = lines[lineNumber]
  if (!next) return true
  if (next.text !== '') return !next.text.startsWith(prefix)
  let at = lineNumber
  while (lines[at]?.text === '') at++
  return !lines[at]?.text.startsWith(prefix + ' ')
}
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +(.*)$/
const ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +(?![ \t]*$)([^]+)$/u
const LINE_COMMENT = /^[ \t]*%%/

function closesFence(line: string, marker: string): boolean {
  let count = 0
  while (line[count] === marker[0]) count++
  return count >= marker.length && /^[ \t]*$/.test(line.slice(count))
}

function closedFenceEnd(cursor: Cursor, openerOffset = 0): number | undefined {
  const opener = cursor.peek(openerOffset)
  const marker = opener ? fenceOpen(opener.text)?.marker : undefined
  if (!marker) return undefined
  for (let offset = openerOffset + 1; cursor.peek(offset); offset++) {
    if (closesFence(cursor.peek(offset)!.text, marker)) return offset
  }
  return undefined
}

function attributedListMarker(line: string) {
  let indent = 0
  while (line[indent] === ' ') indent++
  const marker = line[indent]
  if ((marker !== '-' && marker !== '*' && marker !== '.') || line[indent + 1] !== '{') return undefined
  const start = indent + 1
  let quote: '"' | "'" | undefined
  for (let i = start + 1; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (quote) { if (ch === quote) quote = undefined; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch !== '}') continue
    const attrs = parseBlockAttributeRun(line.slice(start, i + 1))
    const rest = /^ +(.*)$/.exec(line.slice(i + 1))
    if (!attrs || !rest) return undefined
    return { indent, authoredIndent: indent, ordered: marker === '.',
      raw: marker === '.' ? '' : undefined, delim: marker === '.' ? '.' as const : undefined,
      bullet: marker === '.' ? undefined : marker as '-' | '*',
      width: i + 1 + rest[0].length - rest[1]!.length, continuationWidth: indent + 2,
      content: rest[1]!, attrs }
  }
  return undefined
}

function listMarker(line: string) {
  const attributed = attributedListMarker(line)
  if (attributed) return attributed
  const itemAttr = extractItemAttr(line)
  const ordered = RE_ORDERED.exec(itemAttr?.stripped ?? line)
  if (ordered && !ordered[1]!.includes('\t')) {
    const markerWidth = ordered[0].length - ordered[4]!.length
    const attrWidth = itemAttr ? line.length - itemAttr.stripped.length : 0
    return { indent: sourceColumnAt(ordered[1]!, ordered[1]!.length),
      authoredIndent: ordered[1]!.length, ordered: true, raw: ordered[2]!,
      delim: ordered[3] as '.' | ')', bullet: undefined,
      width: markerWidth + attrWidth,
      ...(itemAttr ? { continuationWidth: markerWidth,
        ...(itemAttr.attrs ? { attrs: itemAttr.attrs } : {}) } : {}),
      content: ordered[4]! }
  }
  const bullet = BULLET.exec(itemAttr?.stripped ?? line)
  if (!bullet) return undefined
  const markerWidth = bullet[0].length - bullet[3]!.length
  const attrWidth = itemAttr ? line.length - itemAttr.stripped.length : 0
  return { indent: sourceColumnAt(bullet[1]!, bullet[1]!.length),
    authoredIndent: bullet[1]!.length, ordered: false, raw: undefined,
    delim: undefined, bullet: bullet[2] as '-' | '*',
    width: markerWidth + attrWidth,
    ...(itemAttr ? { continuationWidth: markerWidth,
      ...(itemAttr.attrs ? { attrs: itemAttr.attrs } : {}) } : {}),
    content: bullet[3]! }
}

function isBlockStart(line: string): boolean {
  return (line[0] === '#' && RE_HEADING.test(line)) ||
    ((line[0] === '`' || line[0] === '~') && RE_FENCE.test(line)) ||
    RE_RAW_FENCE.test(line) ||
    BREAK.test(line) || !!listMarker(line) ||
    (line[0] === '>' && RE_BLOCKQUOTE.test(line)) ||
    (line[0] === '|' && isTableRow(line)) || line.startsWith('::') ||
    rootLinkDef(line) !== null || FOOTNOTE_DEF.test(line) || ABBR_DEF.test(line) || LINE_COMMENT.test(line) ||
    (line.startsWith('{') && parseBlockAttributeRun(line) !== null)
}

function interruptsParagraph(line: string, owner: ContainerOwner): boolean {
  const marker = listMarker(line)
  if (marker) return owner.kind === 'list' && marker.indent === 0
  if (owner.kind !== 'root' && ABBR_DEF.test(line)) return false
  return isBlockStart(line)
}

function interruptsParagraphAtCursor(cursor: Cursor): boolean {
  if (cursor.peek()?.wrappedAttr) return true
  const line = cursor.peek()!.text
  if (cursor.owner.kind === 'root' && line[0] === '{' && !parseBlockAttributeRun(line)) {
    const lexer = lexerForCursor(cursor)
    lexer.pos = cursor.at
    if (probeBlockAttributes(lexer)) return true
  }
  if (cursor.owner.kind === 'root' && (line[0] === '`' || line[0] === '~')) {
    const marker = fenceOpen(line)?.marker ?? RE_RAW_FENCE.exec(line)?.[1]
    if (marker && !hasLaterFenceCloser(cursor, marker)) return false
  }
  return interruptsParagraph(line, cursor.owner)
}

function hasLaterFenceCloser(cursor: Cursor, marker: string): boolean {
  if (!cursor.fenceCloserSuffix) {
    const backtick = new Uint32Array(cursor.lines.length + 1)
    const tilde = new Uint32Array(cursor.lines.length + 1)
    for (let i = cursor.lines.length - 1; i >= 0; i--) {
      backtick[i] = backtick[i + 1]!
      tilde[i] = tilde[i + 1]!
      const line = cursor.lines[i]!.text
      const char = line[0]
      if (char !== '`' && char !== '~') continue
      let run = 0
      while (line[run] === char) run++
      if (!/^[ \t]*$/.test(line.slice(run))) continue
      if (char === '`') backtick[i] = Math.max(backtick[i]!, run)
      else tilde[i] = Math.max(tilde[i]!, run)
    }
    cursor.fenceCloserSuffix = { backtick, tilde }
  }
  const runs = marker[0] === '`' ? cursor.fenceCloserSuffix.backtick : cursor.fenceCloserSuffix.tilde
  return runs[cursor.at + 1]! >= marker.length
}

function hasLaterQuotedFenceCloser(cursor: Cursor, marker: string): boolean {
  for (let offset = 1; cursor.peek(offset); offset++) {
    const text = cursor.peek(offset)!.text
    if (!RE_BLOCKQUOTE.test(text)) break
    const inner = text.slice(text.startsWith('> ') ? 2 : 1)
    if (closesFence(inner, marker)) return true
  }
  return false
}

function quotedFenceStaysInParagraph(cursor: Cursor, body: SourceLine[],
  directParagraph: boolean, plainParagraph: boolean, text: string): boolean {
  if (body.length !== 1 || !directParagraph || !plainParagraph ||
      cursor.owner.kind !== 'root') return false
  const marker = fenceOpen(text)?.marker
  return marker !== undefined && !hasLaterQuotedFenceCloser(cursor, marker)
}

function takeUnmarkedQuoteParagraphLine(cursor: Cursor, body: SourceLine[],
  unclosedFenceParagraph: boolean): SourceLine | undefined {
  const line = cursor.peek()
  if (!unclosedFenceParagraph || !line || !plainQuoteText(line.text)) return undefined
  body.push(cursor.take())
  return line
}

function wrappedQuoteAttributeTail(body: SourceLine[]): boolean {
  const lastBodyText = body.at(-1)?.text
  return body.length >= 2 && lastBodyText?.charCodeAt(lastBodyText.length - 1) === 125 &&
    lastBodyText.trim() === '}' && body.at(-2)!.text.trimStart().startsWith('{') &&
    !!probeBlockAttributes(new Lexer([body.at(-2)!.text.trimStart(), lastBodyText.trimStart()]))
}

function quotedListPlainRun(cursor: Cursor, body: SourceLine[], line: SourceLine,
  active: boolean): boolean {
  if (!active || cursor.owner.kind !== 'list' || !listMarker(body[0]?.text ?? '') ||
      body.at(-1)?.number !== line.number - 1) return false
  return true
}

function quotedListSibling(cursor: Cursor, body: SourceLine[], line: SourceLine,
  active: boolean): boolean {
  if (!quotedListPlainRun(cursor, body, line, active)) return false
  const first = listMarker(body[0]!.text)!
  const next = listMarker(line.text)
  return next !== undefined && first.bullet !== undefined &&
    first.bullet === next.bullet && first.indent === next.indent
}

function quotedListPlainFollower(cursor: Cursor, body: SourceLine[], line: SourceLine,
  active: boolean): boolean {
  return quotedListPlainRun(cursor, body, line, active) && plainQuoteText(line.text)
}

function quotedListFirstBlockFollower(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  return body.at(-1)?.number === line.number - 1 &&
    quoteListEndsInPlus(body.at(-1)!.text) &&
    (RE_HEADING.test(line.text) || isTableRow(line.text)) &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))
}

function mayContinueQuoteLazily(follower: string | undefined, innerLast: string | undefined): boolean {
  if (!follower || !innerLast || follower.startsWith('^ ')) return false
  let finalBlock = innerLast.trimStart()
  while (finalBlock.startsWith('>')) {
    finalBlock = finalBlock.slice(finalBlock[1] === ' ' ? 2 : 1).trimStart()
  }
  if (finalBlock === '' || (isBlockStart(finalBlock) && !finalBlock.startsWith(':: ') &&
      !/^ (?:\[|\{)/.test(innerLast))) return false
  return !interruptsParagraph(follower, ROOT_OWNER)
}

function plainQuoteText(line: string): boolean {
  return /^(?:[\p{L}\p{N}]|\\#)/u.test(line) && !line.includes('\t') && !isBlockStart(line)
}

function plainPlusText(line: string): boolean {
  return line.startsWith('+ ') && line.length > 2 && !isBlockStart(line)
}

function nestedQuoteParagraphText(text: string): boolean {
  let inner = text
  while (inner.startsWith('>')) inner = inner.slice(inner[1] === ' ' ? 2 : 1)
  return plainQuoteText(inner)
}

function listFirstBlockParagraphText(text: string): boolean {
  if (text.startsWith('>')) return nestedQuoteParagraphText(text)
  const marker = listMarker(text)
  return marker !== undefined && nestedQuoteParagraphText(marker.content)
}

function retainedCommentFollower(text: string): boolean {
  return plainQuoteText(text) || text[0] === ' ' && text[1] !== ' '
}

function retainedFencePrefix(text: string): number {
  return /^(?:`{3,}|~{3,})$/.test(text.trimStart()) ? 1 : 0
}

function retainedListFollower(text: string, body: SourceLine[]):
  { prefix: number; rootLazy: boolean } {
  if (listMarker(body[0]?.text ?? '')) return { prefix: 0, rootLazy: false }
  const prefix = retainedFencePrefix(text)
  return { prefix, rootLazy: prefix === 0 }
}

function quoteListLazyLine(body: SourceLine[], line: SourceLine, prefix: number):
  { line: SourceLine; prefix: number } {
  if (body[0]?.text.charCodeAt(0) !== 62) return { line, prefix }
  const previous = body.at(-1)
  if (previous?.number !== line.number - 1 ||
      !(nestedQuoteParagraphText(previous.text) || plainQuoteText(previous.text))) {
    return { line, prefix }
  }
  const text = line.text.trimStart()
  const indent = line.text.length - text.length
  const first = text.charCodeAt(0)
  const lazyBlock = (indent === 1 || indent >= 3) &&
    (first === 35 && RE_HEADING.test(text) || first === 62 && RE_BLOCKQUOTE.test(text) ||
      (first === 45 || first === 42 || first === 43 || first >= 48 && first <= 57) &&
        listMarker(text))
  if (!plainQuoteText(text) && !lazyBlock) return { line, prefix }
  return { line: { ...line, lazyText: true },
    prefix: Math.max(prefix, indent) }
}

function quoteEndsInPlus(text: string): boolean {
  while (text.startsWith('>')) text = text.slice(text[1] === ' ' ? 2 : 1)
  return text === '+'
}

function quoteListEndsInPlus(text: string): boolean {
  const marker = listMarker(text)
  return marker !== undefined && quoteEndsInPlus(marker.content)
}

function quoteListMarkerPrefix(line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { contentColumn?: number; body: SourceLine[] }): number | undefined {
  const previous = frame.body.at(-1)
  const tail = previous?.text ?? ''
  if (previous?.number !== line.number - 1) return undefined
  if (!tail.startsWith('>') || (!quoteEndsInPlus(tail) && !nestedQuoteParagraphText(tail))) {
    return undefined
  }
  if (line.lazyText) return 0
  if (frame.contentColumn !== undefined && marker.indent === frame.contentColumn - 1) {
    return frame.contentColumn - 1
  }
  if (frame.contentColumn !== undefined && frame.body[0]?.text.startsWith('>') &&
      marker.indent >= frame.contentColumn + 1) return marker.indent
  return undefined
}

function quotedListSiblingPrefix(line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { contentColumn?: number; body: SourceLine[] }): number | undefined {
  if (frame.contentColumn === undefined ||
      marker.indent !== frame.contentColumn - 1) return undefined
  const last = frame.body.at(-1)
  let opener = frame.body.length - 1
  while (opener > 0 && plainQuoteText(frame.body[opener]!.text) &&
      frame.body[opener - 1]!.number === frame.body[opener]!.number - 1) opener--
  const first = frame.body[opener]
  if (!first) return undefined
  if (last?.number !== line.number - 1 || !RE_BLOCKQUOTE.test(first.text)) return undefined
  const prefix = first.text.startsWith('> ') ? 2 : 1
  const nested = listMarker(first.text.slice(prefix))
  return nested?.bullet !== undefined && nested.bullet === marker.bullet ? marker.indent : undefined
}

function quoteOwnedListMarker(cursor: Cursor, line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { contentColumn?: number; body: SourceLine[] }):
  { line: SourceLine; prefix: number; rootLazy: boolean } | undefined {
  if (line.lazyText && cursor.owner.kind === 'quote') {
    return { line, prefix: 0, rootLazy: true }
  }
  const prefix = quotedListSiblingPrefix(line, marker, frame) ??
    quoteListMarkerPrefix(line, marker, frame)
  return prefix === undefined ? undefined :
    { line: { ...line, lazyText: true }, prefix, rootLazy: false }
}

function listContinuationPrefix(line: string, base: number, body?: SourceLine[],
  closedQuoteFence = false): number {
  const firstBlockText = body?.[0]?.text
  if (firstBlockText && listMarker(firstBlockText)) return base
  let column = base
  while (line[column] === ' ') column++
  const block = line.slice(column)
  if (block.startsWith('>') && body && openColonRun(body, true) !== undefined) return base
  return column > base && (!closedQuoteFence && block.startsWith('>') ||
    RE_HEADING.test(block)) ? column : base
}

function tabbedListPrefix(line: string, contentColumn: number): number | undefined {
  if (!line.includes('\t')) return undefined
  let column = 0
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char !== ' ' && char !== '\t') break
    column += char === '\t' ? 4 - column % 4 : 1
    if (column >= contentColumn - 1) return index + 1
  }
  return undefined
}

function reachableListPrefix(line: string, contentColumn: number): number | undefined {
  const spaces = ' '.repeat(contentColumn - 1)
  return line.startsWith(spaces) ? spaces.length : tabbedListPrefix(line, contentColumn)
}

function openColonRun(body: SourceLine[], quoted: boolean): number | undefined {
  let first = body[0]?.text
  if (!first) return undefined
  if (quoted) {
    if (!first.startsWith('>')) return undefined
    first = first.slice(first[1] === ' ' ? 2 : 1)
  }
  const opener = COLON_OPEN.exec(first)
  if (!opener) return undefined
  const closer = new RegExp(`^:{${opener[1]!.length}}[ \\t]*$`)
  for (let index = 1; index < body.length; index++) {
    let text = body[index]!.text
    if (quoted && text.startsWith('>')) text = text.slice(text[1] === ' ' ? 2 : 1)
    if (closer.test(text)) return undefined
  }
  return opener[1]!.length
}

function openDegradedQuoteCommentParagraph(body: SourceLine[], quoted: boolean): boolean {
  if (body.length < 2) return false
  const content = (text: string): string => quoted && text.startsWith('>') ?
    text.slice(text[1] === ' ' ? 2 : 1) : text
  return content(body[0]!.text) === '%%%' &&
    plainQuoteText(content(body.at(-1)!.text))
}

function beginsOpenQuotedParagraph(body: SourceLine[]): boolean {
  if (body.length !== 1 || !body[0]!.text.startsWith('>')) return false
  const first = body[0]!.text
  return plainQuoteText(first.slice(first[1] === ' ' ? 2 : 1))
}

function followsClosedListBlock(body: SourceLine[]): boolean {
  const last = body.at(-1)?.text
  return last !== undefined && (last === '' || parseBlockAttributeRun(last) !== null ||
    LINE_COMMENT.test(last))
}

function matchedShiftedFencePrefix(cursor: Cursor, line: string, base: number,
  afterBlock: boolean): number {
  let shifted = base
  while (line[shifted] === ' ') shifted++
  if (shifted === base) return base
  const shiftedText = line.slice(shifted)
  const codeFence = fenceOpen(shiftedText)
  let opener = codeFence?.marker
  if (!opener && (shiftedText[0] === '`' || shiftedText[0] === '~') &&
      cursor.lines[cursor.at - 1]?.text === '') {
    opener = RE_RAW_FENCE.exec(shiftedText)?.[1]
  }
  if (!opener) return base
  if (codeFence && afterBlock) return shifted
  const baseSpaces = ' '.repeat(base)
  const shiftedSpaces = ' '.repeat(shifted)
  for (let i = cursor.at + 1; i < cursor.lines.length; i++) {
    const candidate = cursor.lines[i]!.text
    if (candidate && !candidate.startsWith(baseSpaces)) break
    if (candidate.startsWith(shiftedSpaces) && closesFence(candidate.slice(shifted), opener)) {
      return shifted
    }
  }
  return base
}

function shiftedClosedListColon(cursor: Cursor, base: number):
  { prefix: number; count: number } | undefined {
  const line = cursor.peek()?.text
  if (!line?.startsWith(' '.repeat(base))) return undefined
  let prefix = base
  while (line[prefix] === ' ') prefix++
  if (prefix === base) return undefined
  const opener = COLON_OPEN.exec(line.slice(prefix))
  if (!opener) return undefined
  const closer = new RegExp(`^:{${opener[1]!.length}}[ \\t]*$`)
  for (let count = 1; cursor.peek(count); count++) {
    const follower = cursor.peek(count)!.text
    if (!follower.startsWith(' '.repeat(prefix))) return undefined
    if (closer.test(follower.slice(prefix))) return { prefix, count: count + 1 }
  }
  return undefined
}

function listGapBlockText(cursor: Cursor, next: SourceLine, base: number): string {
  const shiftedColon = shiftedClosedListColon(cursor, base)
  return next.text.slice(shiftedColon?.prefix ?? listContinuationPrefix(next.text, base))
}

function pipeSegments(line: SourceLine): Array<{ text: string; from: number; to: number }> {
  if (!line.text.startsWith('|') || !line.text.endsWith('|')) throw new UnsupportedCursorSyntax('table edge')
  if (line.text.includes('\\|')) throw new UnsupportedCursorSyntax('escaped table pipe')
  const cells: Array<{ text: string; from: number; to: number }> = []
  let from = 1
  for (let i = 1; i < line.text.length; i++) {
    if (line.text[i] !== '|') continue
    cells.push({ text: line.text.slice(from, i), from, to: i })
    from = i + 1
  }
  return cells
}

function parseSimpleTable(cursor: Cursor, inline: CursorInline): Table {
  const header = cursor.take()
  const separator = cursor.take()
  const separators = pipeSegments(separator)
  const alignments = separators.map((cell) => {
    const text = cell.text.trim()
    if (!/^:?-{3,}:?$/.test(text)) throw new UnsupportedCursorSyntax('table separator')
    return text.startsWith(':') && text.endsWith(':') ? 'center' :
      text.startsWith(':') ? 'left' : text.endsWith(':') ? 'right' : undefined
  })
  const widths = separators.map((cell) => cell.text.match(/-+/)![0].length)
  const rows: TableRow[] = []
  const addRow = (line: SourceLine, isHeader: boolean) => {
    const segments = pipeSegments(line)
    if (segments.length !== alignments.length) throw new UnsupportedCursorSyntax('table width')
    rows.push({ type: 'table_row', cells: segments.map((part, i) => {
      const trimmed = part.text.trim()
      const lead = part.text.length - part.text.trimStart().length
      const column = part.from + lead + 1
      return { type: 'table_cell', header: isHeader,
        children: inline.inlines([{ line, column, text: trimmed }]),
        ...(isHeader && alignments[i] ? { align: alignments[i] } : {}),
        pos: position(line, line, part.from + 1, part.to + 1) }
    }), pos: position(line, line) })
  }
  addRow(header, true)
  let last = header
  while (cursor.peek()?.text.startsWith('|')) {
    last = cursor.take()
    addRow(last, false)
  }
  return { type: 'table', rows, separatorWidths: widths, pos: position(header, last) }
}

function parseCanonicalTableWithExistingRules(cursor: Cursor, inline: CursorInline): Table {
  if (cursor.owner.inList && cursor.owner.kind !== 'list') {
    throw new UnsupportedCursorSyntax('list table source mapping')
  }
  const first = cursor.peek()!
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  lexer.abbrDefs = inline.abbreviations
  lexer.linkDefs = inline.linkDefinitions
  const table = parseTableBlock({
    parseInline: (text, _abbrDefs, _linkDefs, source) => inline.tableInlines(text, source),
    recordAttachedCaption: () => {},
    parseCaptionInline: (tableLexer, text) => {
      const capIndex = tableLexer.pos - 1
      const line = tableLexer.lineAt(capIndex)
      if (!line?.endsWith(text)) throw new UnsupportedCursorSyntax('table caption source')
      const within = line.length - text.length
      const anchors = [{ offset: tableLexer.lineOffset(capIndex) + within,
        column: tableLexer.lineStartColumn(capIndex) + within,
        line: tableLexer.lineNumber(capIndex) }]
      const content = readCaptionText(tableLexer, text, anchors)
      return inline.tableInlines(content, inlineSource({ anchored: true,
        baseOffset: anchors[0]!.offset, startLine: anchors[0]!.line,
        startColumn: anchors[0]!.column, lineAnchors: anchors }), true)
    },
  }, lexer)
  if (table.type !== 'table' || lexer.pos <= cursor.at) {
    throw new UnsupportedCursorSyntax('canonical table adapter')
  }
  const last = cursor.lines[lexer.pos - 1]
  if (!last) throw new UnsupportedCursorSyntax('canonical table source range')
  cursor.at = lexer.pos
  table.pos = position(first, last)
  return table
}

function parseTableAtCursor(cursor: Cursor, inline: CursorInline): Table {
  const first = cursor.peek()!
  const second = cursor.peek(1)?.text
  const gfm = second?.startsWith('|') && /^\|(?: *:?-{3,}:? *\|)+$/.test(second)
  if (gfm) {
    let row = 0
    let needsCanonicalReader = false
    while (cursor.peek(row)?.text.startsWith('|')) {
      needsCanonicalReader ||= /\|[ \t]*[<^][ \t]*\||\|[ \t]*\{/.test(cursor.peek(row)!.text)
      row++
    }
    return needsCanonicalReader ? parseCanonicalTableWithExistingRules(cursor, inline) :
      parseSimpleTable(cursor, inline)
  }
  const headed = first.text.startsWith('|=')
  if (!first.text.startsWith('|') ||
      (!headed && cursor.at > 0 && cursor.lines[cursor.at - 1]?.text !== '' &&
        (cursor.owner.kind !== 'root' ||
          listMarker(cursor.lines[cursor.at - 1]!.text) !== undefined ||
          cursor.lines[cursor.at - 1]!.text.startsWith('>')))) {
    throw new UnsupportedCursorSyntax('canonical table header')
  }
  const table = parseCanonicalTableWithExistingRules(cursor, inline)
  if (cursor.owner.inList && isBlankLine(cursor.peek()?.text ?? '') &&
      isBlankLine(cursor.peek(1)?.text ?? '') &&
      RE_CAPTION.test(cursor.peek(2)?.text ?? '')) {
    throw new UnsupportedCursorSyntax('list table caption gap')
  }
  if (!headed && cursor.peek()?.text && !isBlockStart(cursor.peek()!.text)) {
    throw new UnsupportedCursorSyntax('data table paragraph follower')
  }
  if (!headed && cursor.peek()?.text === '' &&
      (listMarker(cursor.peek(1)?.text ?? '') || cursor.peek(1)?.text.startsWith('>'))) {
    throw new UnsupportedCursorSyntax('data table container follower')
  }
  return table
}

function rootBlockAttributeAt(cursor: Cursor, index: number): boolean {
  if (cursor.owner.kind !== 'root' || cursor.lines[index]?.text[0] !== '{') return false
  const lexer = lexerForCursor(cursor)
  const saved = lexer.pos
  lexer.pos = index
  const found = probeBlockAttributes(lexer) !== null
  lexer.pos = saved
  return found
}

function definitionStructuralOffset(text: string, column: number): number | undefined {
  if (!text.startsWith(' '.repeat(column - 1))) {
    const indent = /^ */.exec(text)![0].length
    const content = text.slice(indent)
    return indent > 0 && indent < column - 1 && LINE_COMMENT.test(content) &&
      !RE_COMMENT_BLOCK_ANY.test(content) ? indent : undefined
  }
  let offset = column - 1
  while (text.charCodeAt(offset) === 32) offset++
  const content = text.slice(offset)
  return RE_HEADING.test(content) || RE_BLOCKQUOTE.test(content) ||
    content === ':::' ||
    (LINE_COMMENT.test(content) && !RE_COMMENT_BLOCK_ANY.test(content)) ||
    (content[0] === '{' && parseBlockAttributeRun(content) !== null) ? offset : undefined
}

function definitionStructuralLine(text: string, column: number): boolean {
  return definitionStructuralOffset(text, column) !== undefined
}

function definitionTermBelowColumn(text: string, contentColumn: number): boolean {
  let indent = 0
  if (contentColumn !== 4) while (text.charCodeAt(indent) === 32) indent++
  const belowColumn = contentColumn === 4 ? /^ {1,3}[^ ]/.test(text) :
    indent > 0 && indent < contentColumn && text[indent] !== undefined
  return belowColumn && !listMarker(text) && !LINE_COMMENT.test(text)
}

function definitionTermWrapText(cursor: Cursor, text: string, contentColumn: number): boolean {
  return definitionTermBelowColumn(text, contentColumn) ||
    /^:{1,2}[ \t]*$/.test(text) ||
    (cursor.owner.kind === 'root' && plainQuoteText(text)) ||
    (cursor.owner.kind === 'quote' && !cursor.owner.inList && plainQuoteText(text))
}

function definitionBodyWrapText(text: string, column: number): boolean {
  if (/^ {0,3}[A-Za-z0-9]/.test(text)) return true
  const indent = /^ */.exec(text)![0].length
  return indent > 0 && indent < column - 1 &&
    (text[indent] === '>' || text[indent] === '#' ||
      text[indent] === '[' || text[indent] === '{' || text[indent] === '`')
}

function boundedDefinitionParagraphEnd(lines: SourceLine[], from: number): number | undefined {
  let after = from + 1
  while (lines[after] && plainQuoteText(lines[after]!.text)) after++
  return !lines[after] || lines[after]!.text === '' ? after : undefined
}

function startsRootBlockAfterDefinition(text: string): boolean {
  return RE_BLOCKQUOTE.test(text) || RE_HEADING.test(text) ||
    fenceOpen(text) !== null || COLON_OPEN.test(text) ||
    (text[0] === '|' && isTableRow(text))
}

function hasExposedDefinitionReference(body: SourceLine[]): boolean {
  let fence: string | undefined
  let commentRun: number | undefined
  for (let i = 1; i < body.length; i++) {
    const text = body[i]!.text.trimStart()
    const comment = RE_COMMENT_BLOCK_ANY.exec(text)
    if (commentRun !== undefined) {
      if (comment?.[1]?.length === commentRun) commentRun = undefined
      continue
    }
    if (fence) {
      if (closesFence(text, fence)) fence = undefined
      continue
    }
    if (comment) { commentRun = comment[1]!.length; continue }
    const opener = fenceOpen(text)
    if (opener) { fence = opener.marker; continue }
    if (/^\[(?:\^[^\]]+|[^\]]+)\]:/.test(text)) return true
  }
  return false
}

function definitionBlockFollowerEnd(cursor: Cursor, end: number, column: number): number | undefined {
  const prefix = ' '.repeat(column - 1)
  const first = cursor.lines[end]?.text
  if (!first?.startsWith(prefix) || first.length <= prefix.length) return undefined
  let after = end + 1
  while (cursor.lines[after]?.text.startsWith(prefix) &&
      cursor.lines[after]!.text.length > prefix.length) after++
  return after
}

function attachedDefinitionFollowerEnd(cursor: Cursor, end: number,
  contentPlain: boolean): number | undefined {
  if (cursor.lines[end]?.text !== '+') return undefined
  const follower = cursor.lines[end + 1]?.text ?? ''
  const boundary = cursor.lines[end + 2]?.text
  if (boundary !== undefined && boundary !== '') return undefined
  const marker = listMarker(follower)
  return plainQuoteText(follower) || marker?.indent === 0 ||
    contentPlain && marker !== undefined ? end + 2 : undefined
}

function definitionStructuralFollowerEnd(cursor: Cursor, end: number, column: number):
  number | undefined {
  if (!definitionStructuralLine(cursor.lines[end]?.text ?? '', column)) return undefined
  let after = end + 1
  while (cursor.lines[after] && definitionStructuralLine(cursor.lines[after]!.text, column)) after++
  const opener = cursor.lines[end]!.text
  const offset = definitionStructuralOffset(opener, column)!
  if (offset > column - 1 && RE_BLOCKQUOTE.test(opener.slice(offset)) &&
      plainQuoteText(cursor.lines[after]?.text ?? '')) return undefined
  return !cursor.lines[after] || !cursor.lines[after]!.text.startsWith(' '.repeat(column - 1)) ?
    after : undefined
}

function takeDefinitionBlockContinuation(cursor: Cursor, end: number, line: SourceLine,
  column: number, content: string, inline: CursorInline):
  { blocks: BlockNode[]; last: SourceLine } | undefined {
  const prefix = ' '.repeat(column - 1)
  if (cursor.at >= end || !cursor.peek()!.text.startsWith(prefix)) return undefined
  const body: SourceLine[] = [{ text: content, start: line.start + column - 1,
    number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 }]
  let last = line
  while (cursor.at < end && cursor.peek()!.text.startsWith(prefix)) {
    const follower = cursor.take()
    body.push({ text: follower.text.slice(column - 1), start: follower.start + column - 1,
      number: follower.number, baseColumn: (follower.baseColumn ?? 1) + column - 1 })
    last = follower
  }
  if (hasExposedDefinitionReference(body)) {
    throw new UnsupportedCursorSyntax('definition body reference')
  }
  return { blocks: parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], 1, false), last }
}

function lastPlacedDefinitionLine(blocks: BlockNode[], last: SourceLine,
  physicalLines: SourceLine[]): SourceLine {
  const placedEnd = blocks.at(-1)?.pos?.endLine
  return placedEnd && placedEnd < last.number ? physicalLines[placedEnd - 1] ?? last : last
}

function attachedDefinitionFenceEnd(cursor: Cursor, plus: number): number | undefined {
  if (cursor.lines[plus]?.text !== '+') return undefined
  const marker = fenceOpen(cursor.lines[plus + 1]?.text ?? '')?.marker
  if (!marker) return undefined
  let close = plus + 2
  while (cursor.lines[close] && !closesFence(cursor.lines[close]!.text, marker)) close++
  return cursor.lines[close] && (!cursor.lines[close + 1] || cursor.lines[close + 1]!.text === '') ?
    close + 1 : undefined
}

function definitionListEnd(cursor: Cursor, commentOpeners: ReadonlySet<number> | undefined): number {
  let end = cursor.at
  let mayWrapDefinition = false
  let mayWrapTerm = false
  let termContentColumn = 0
  let mayTermPlus = false
  let mayFirstBlockQuote = false
  let definitionContentColumn = 0
  let definitionContentPlain = false
  let definitionContentBlock = false
  let endedOnStructural = false
  while (end < cursor.lines.length) {
    const text = cursor.lines[end]!.text
    const termMatch = /^:: +[ \t]*([^ \t].*)$/.exec(text)
    const term = termMatch !== null
    const definition = /^: +[ \t]*[^ \t].*$/.test(text)
    if (term || definition) {
      if (/[ \t]$/.test(text)) throw new UnsupportedCursorSyntax('definition list trailing whitespace')
      mayWrapDefinition = definition && !/^: +\+[ \t]*$/.test(text)
      mayFirstBlockQuote = definition && /^: +\+[ \t]*$/.test(text)
      if (definition) {
        const body = /^: +[ \t]*([^ \t].*)$/.exec(text)![1]!
        definitionContentColumn = text.length - body.length + 1
        definitionContentPlain = !isBlockStart(body)
      }
      definitionContentBlock = definition && mayWrapDefinition && !definitionContentPlain
      mayWrapTerm = term
      mayTermPlus = term
      if (term) {
        termContentColumn = text.length - termMatch[1]!.length + 1
      }
      end++
      continue
    }
    if (mayWrapTerm && definitionTermBelowColumn(text, termContentColumn)) {
      let after = end + 1
      while (cursor.lines[after] &&
          definitionTermBelowColumn(cursor.lines[after]!.text, termContentColumn)) after++
      const follower = cursor.lines[after]?.text
      if (follower === undefined || follower === '' ||
          /^: +[ \t]*[^ \t]/.test(follower)) {
        end = after
        mayWrapTerm = false
        continue
      }
    }
    if (mayWrapTerm && definitionTermWrapText(cursor, text, termContentColumn) &&
        (!cursor.lines[end + 1] || cursor.lines[end + 1]!.text === '' ||
          /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 1]!.text) ||
          (cursor.lines[end + 1]!.text === '+' &&
            /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 2]?.text ?? '')))) {
      end++
      mayWrapTerm = false
      continue
    }
    if (mayTermPlus && text === '+' && /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 1]?.text ?? '')) {
      end++
      mayTermPlus = false
      continue
    }
    if (mayWrapTerm && text === '' && /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 1]?.text ?? '') &&
        (!cursor.lines[end + 2] || cursor.lines[end + 2]!.text === '')) {
      end++
      mayWrapTerm = false
      continue
    }
    if (mayWrapDefinition && text === '' && definitionContentColumn > 1 &&
        cursor.lines[end + 1]?.text.startsWith(' '.repeat(definitionContentColumn - 1)) &&
        plainQuoteText(cursor.lines[end + 1]!.text.slice(definitionContentColumn - 1)) &&
        (!cursor.lines[end + 2] || cursor.lines[end + 2]!.text === '')) {
      end += 2
      break
    }
    if (mayFirstBlockQuote && RE_BLOCKQUOTE.test(text) &&
        (!cursor.lines[end + 1] || cursor.lines[end + 1]!.text === '')) {
      end++
      break
    }
    const attachedFenceEnd = mayWrapDefinition ? attachedDefinitionFenceEnd(cursor, end) : undefined
    if (attachedFenceEnd !== undefined) { end = attachedFenceEnd; break }
    if (mayWrapDefinition && definitionContentPlain && definitionContentColumn > 1) {
      const structuralEnd = definitionStructuralFollowerEnd(cursor, end, definitionContentColumn)
      if (structuralEnd !== undefined) {
        end = structuralEnd
        endedOnStructural = true
        break
      }
    }
    if (definitionContentBlock) {
      const blockEnd = definitionBlockFollowerEnd(cursor, end, definitionContentColumn)
      if (blockEnd !== undefined) { end = blockEnd; break }
    }
    if (mayWrapDefinition && definitionContentPlain && /^:{1,2}[ \t]*$/.test(text)) {
      let after = end + 1
      while (cursor.lines[after] && plainQuoteText(cursor.lines[after]!.text)) after++
      const follower = cursor.lines[after]?.text
      const nextDefinitionItem = follower !== undefined && /^::? +[ \t]*[^ \t]/.test(follower)
      if (follower === undefined || follower === '' || nextDefinitionItem) {
        end = after
        if (nextDefinitionItem) continue
        break
      }
    }
    if (mayWrapDefinition && definitionBodyWrapText(text, definitionContentColumn) &&
        !/[ \t]$/.test(text)) {
      const boundary = boundedDefinitionParagraphEnd(cursor.lines, end)
      if (boundary !== undefined) end = boundary
    } else if (mayWrapDefinition) {
      const attachedEnd = attachedDefinitionFollowerEnd(cursor, end, definitionContentPlain)
      if (attachedEnd !== undefined) {
        end = attachedEnd
        mayWrapDefinition = false
      }
    }
    break
  }
  if (end === cursor.at || (cursor.lines[end] && cursor.lines[end]!.text !== '' &&
      !commentOpeners?.has(cursor.lines[end]!.start) &&
      !(endedOnStructural && !cursor.lines[end]!.text.startsWith(' '.repeat(
        definitionContentColumn - 1))) &&
      !(cursor.owner.kind === 'root' && (rootLinkDef(cursor.lines[end]!.text) ||
        rootBlockAttributeAt(cursor, end) ||
        startsRootBlockAfterDefinition(cursor.lines[end]!.text))))) {
    throw new UnsupportedCursorSyntax('definition list body')
  }
  let next = end
  while (cursor.lines[next]?.text === '') next++
  const follower = cursor.lines[next]?.text
  if (follower && (/^[ \t+:]/.test(follower) || follower.startsWith('::'))) {
    throw new UnsupportedCursorSyntax('definition list continuation')
  }
  return end
}

function parseSimpleDefinitionList(cursor: Cursor, inline: CursorInline,
  commentOpeners: ReadonlySet<number> | undefined): DefinitionList {
  const first = cursor.peek()!
  const end = definitionListEnd(cursor, commentOpeners)
  const items: DefinitionItem[] = []
  type CompleteSpans = DefinitionItem & {
    termSpans: Position[]; definitionLines: number[]; definitionSpans: Position[] }
  let current: CompleteSpans | undefined
  let last = first
  while (cursor.at < end) {
    const line = cursor.take()
    if (line.text === '' && current) {
      if (cursor.at < end && current.definitions.length) {
        const follower = cursor.take()
        const column = /^ */.exec(follower.text)![0].length + 1
        current.definitions.at(-1)!.push({ type: 'paragraph',
          children: inline.inlines([{ line: follower, column, text: follower.text.slice(column - 1) }]),
          pos: position(follower, follower, column) })
        last = follower
      }
      continue
    }
    const term = /^:: +[ \t]*([^ \t].*)$/.exec(line.text)
    const definition = /^: +[ \t]*([^ \t].*)$/.exec(line.text)
    if (term) {
      if (!current || current.definitions.length) {
        current = { terms: [], definitions: [], termSpans: [], definitionLines: [], definitionSpans: [] }
        items.push(current)
      }
      const column = line.text.length - term[1]!.length + 1
      const parts: ContentLine[] = [{ line, column, text: term[1]! }]
      let termLast = line
      if (cursor.at < end && definitionTermWrapText(cursor, cursor.peek()!.text, column)) {
        const belowColumn = definitionTermBelowColumn(cursor.peek()!.text, column)
        do {
          termLast = cursor.take()
          parts.push({ line: termLast, column: 1, text: termLast.text })
        } while (belowColumn && cursor.at < end &&
          definitionTermBelowColumn(cursor.peek()!.text, column))
      }
      if (cursor.at < end && cursor.peek()!.text === '+') {
        termLast = cursor.take()
        parts.push({ line: termLast, column: 1, text: termLast.text })
      }
      current.terms.push(inline.inlines(parts))
      current.termSpans.push(position(line, termLast))
      last = termLast
    } else if (definition && current) {
      const column = line.text.length - definition[1]!.length + 1
      const following = cursor.at < end ? cursor.peek() : undefined
      if (!isBlockStart(definition[1]!) &&
          following && definitionStructuralLine(following.text, column)) {
        const body: SourceLine[] = [
          { text: definition[1]!, start: line.start + column - 1,
            number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 },
        ]
        while (cursor.at < end && definitionStructuralLine(cursor.peek()!.text, column)) {
          const block = cursor.take()
          const offset = definitionStructuralOffset(block.text, column)!
          body.push({ text: block.text.slice(offset), start: block.start + offset,
            number: block.number, baseColumn: (block.baseColumn ?? 1) + offset })
          last = block
        }
        const blocks = parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], 1, false)
        current.definitions.push(blocks)
        last = lastPlacedDefinitionLine(blocks, last, cursor.physicalLines)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        continue
      }
      if (definition[1] === '+' && cursor.at < end &&
          RE_BLOCKQUOTE.test(cursor.peek()!.text)) {
        const follower = cursor.take()
        current.definitions.push(parseBlocks(new Cursor([follower], undefined,
          childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false))
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        last = follower
        continue
      }
      const blockBody = isBlockStart(definition[1]!)
      const parts: ContentLine[] = [{ line, column, text: definition[1]! }]
      let definitionLast = line
      const continuation = blockBody ? takeDefinitionBlockContinuation(cursor, end, line,
        column, definition[1]!, inline) : undefined
      if (continuation) {
        current.definitions.push(continuation.blocks)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        last = continuation.last
        continue
      }
      while (cursor.at < end && !isBlankLine(cursor.peek()!.text) &&
          !/^(?:::|:) +[ \t]*[^ \t]/.test(cursor.peek()!.text)) {
        if (!blockBody && cursor.peek()!.text === '+' &&
            (listMarker(cursor.peek(1)?.text ?? '')?.indent ?? 0) > 0) {
          const plus = cursor.take()
          parts.push({ line: plus, column: 1, text: plus.text })
          const follower = cursor.take()
          const followerColumn = /^ */.exec(follower.text)![0].length + 1
          parts.push({ line: follower, column: followerColumn,
            text: follower.text.slice(followerColumn - 1) })
          definitionLast = follower
          continue
        }
        if (cursor.peek()!.text === '+') break
        const follower = cursor.take()
        const followerColumn = /^ */.exec(follower.text)![0].length + 1
        parts.push({ line: follower, column: followerColumn,
          text: follower.text.slice(followerColumn - 1) })
        definitionLast = follower
      }
      if (blockBody && parts.length > 1) throw new UnsupportedCursorSyntax('definition block body')
      const mappedImageLine = parts.length === 1 && definition[1]!.startsWith('![')
      const blocks = blockBody || mappedImageLine ? parseBlocks(new Cursor([{
        text: definition[1]!, start: line.start + column - 1,
        number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1,
      }], undefined, childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false) :
        [{ type: 'paragraph' as const, children: inline.inlines(parts),
          pos: position(line, definitionLast, column,
            /^:{1,2}[ \t]*$/.test(definitionLast.text) ?
              contentEndColumn(definitionLast) : definitionLast.text.length + 1) }]
      current.definitions.push(blocks)
      current.definitionLines.push(line.number)
      current.definitionSpans.push(position(line, line))
      last = definitionLast
    } else if (line.text === '+' && current?.definitions.length && cursor.at < end) {
      const follower = cursor.take()
      if (fenceOpen(follower.text)) {
        const body = [follower]
        while (cursor.at < end) body.push(cursor.take())
        current.definitions.at(-1)!.push(...parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], 1, false))
        last = body.at(-1)!
        continue
      }
      const attached: BlockNode[] = listMarker(follower.text) ?
        parseBlocks(new Cursor([follower], undefined, childOwner(cursor.owner, 'definition'),
          cursor.physicalLines), inline, [], 1, false) : [{ type: 'paragraph',
        children: inline.inlines([{ line: follower, column: 1, text: follower.text }]),
        pos: position(follower, follower) }]
      current.definitions.at(-1)!.push(...attached)
      last = follower
    } else throw new UnsupportedCursorSyntax('definition list body')
  }
  return { type: 'definition_list', items, pos: position(first, last, 1, contentEndColumn(last)) }
}

function takeCaption(cursor: Cursor, inline: CursorInline):
  { children: InlineNode[]; line: SourceLine } | undefined {
  const blank = cursor.peek()?.text === '' ? 1 : 0
  const line = cursor.peek(blank)
  const match = line && RE_CAPTION.exec(line.text)
  if (!match) return undefined
  if (blank) cursor.take()
  cursor.take()
  const column = line.text.length - match[1]!.length + 1
  const parts: ContentLine[] = [{ line, column, text: match[1]! }]
  let last = line
  while (cursor.peek() && plainQuoteText(cursor.peek()!.text) &&
      !RE_CAPTION.test(cursor.peek()!.text) && !isBlockStart(cursor.peek()!.text)) {
    last = cursor.take()
    parts.push({ line: last, column: 1, text: last.text })
  }
  return { children: inline.inlines(parts, true), line: last }
}

function takeQuoteCaption(cursor: Cursor, inline: CursorInline, quote: BlockQuote):
  { children: InlineNode[]; line: SourceLine } | undefined {
  return quote.children.length ? takeCaption(cursor, inline) : undefined
}

function parseParagraphAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
  const first = cursor.peek()!
  const parts: ContentLine[] = []
  let last = first
  let captionLead: InlineNode[] | undefined
  const literalColonOpener = /^:{3,}(?: *\t| +\{|>)/.test(first.text)
  while (cursor.peek() && !isBlankLine(cursor.peek()!.text) &&
      (parts.length === 0 || ((!interruptsParagraphAtCursor(cursor) || cursor.peek()!.lazyText) &&
        !(parts.length === 1 && parts[0]!.text.trim() === '+' &&
          listMarker(cursor.peek()!.text) && !cursor.peek()!.lazyText)) ||
        literalColonOpener && /^:{3,}[ \t]*$/.test(cursor.peek()!.text))) {
    if (parts.length === 1 && parts[0]!.text.startsWith('![') &&
        RE_CAPTION.test(cursor.peek()!.text)) {
      const lead = inline.inlines(parts)
      if (lead.length === 1 && lead[0]?.type === 'image' &&
          imageReferenceResolved(lead[0], inline) &&
          lead[0].pos?.startOffset === parts[0]!.line.start &&
          lead[0].pos?.endOffset === parts[0]!.line.start + parts[0]!.line.text.length) {
        captionLead = lead
        break
      }
    }
    if (parts.length === 1 && parts[0]!.text.startsWith('$$') &&
        RE_CAPTION.test(cursor.peek()!.text)) {
      const lead = inline.inlines(parts)
      if (lead.length === 1 && lead[0]?.type === 'math' && lead[0].display) {
        captionLead = lead
        break
      }
    }
    const line = cursor.take()
    const column = /^[ \t]*/.exec(line.text)![0].length + 1
    parts.push({ line, column, text: line.text.slice(column - 1) })
    last = line
  }
  const paragraph: Paragraph = { type: 'paragraph', children: captionLead ?? inline.inlines(parts),
    pos: position(first, last, parts[0]!.column, last.text.replace(/[ \t]+$/, '').length + 1) }
  if (parts[0]!.column > 1 && paragraph.children[0]?.type === 'image') {
    markAboveContentColumn(paragraph)
  }
  if (parts.length === 1 && paragraph.children.length === 1 && paragraph.children[0]?.type === 'image') {
    const image = paragraph.children[0]
    const caption = imageReferenceResolved(image, inline) ? takeCaption(cursor, inline) : undefined
    if (caption) return { type: 'figure', target: image,
      caption: caption.children, pos: position(first, caption.line) }
    const baseColumn = first.baseColumn ?? 1
    const imageText = cursor.owner.inList ? first.text.trimStart() : first.text
    if (!image.ref && isBlockImageLine(imageText) &&
        image.pos?.startColumn === baseColumn + first.text.length - imageText.length &&
        image.pos.endColumn === baseColumn + first.text.length) return image
  }
  if (paragraph.children.length === 1 && paragraph.children[0]?.type === 'math' &&
      paragraph.children[0].display) {
    const caption = takeCaption(cursor, inline)
    if (caption) return { type: 'figure', target: paragraph,
      caption: caption.children, pos: position(first, caption.line) }
  }
  return paragraph
}

function parseRawAtCursor(cursor: Cursor): BlockNode {
  if (cursor.owner.inList && cursor.at === 0) {
    throw new UnsupportedCursorSyntax('marker-line raw block')
  }
  const first = cursor.peek()!
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const raw = parseRawBlock(lexer)
  if (cursor.owner.kind === 'quote' && lexer.pos === cursor.lines.length &&
      cursor.lines.at(-1)?.text === '') {
    throw new UnsupportedCursorSyntax('quote raw block boundary')
  }
  cursor.at = lexer.pos
  raw.pos = position(first, cursor.lines[cursor.at - 1] ?? first)
  return raw
}

function parseLineBlockAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
  if (cursor.owner.inList && cursor.at === 0) {
    throw new UnsupportedCursorSyntax('marker-line line block')
  }
  const first = cursor.peek()!
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const block = parseLineBlockWithHelpers({
    definitionRegionLines: null, inMatcherRequest: false, inLineBlock: false,
    activeMatchers: [], quoteGlyphHasNul: false,
    parseInline: (text, _abbr, _links, source, caption) =>
      inline.lineBlockInlines(text, source, caption),
  }, lexer)
  cursor.at = lexer.pos
  block.pos = position(first, cursor.lines[cursor.at - 1] ?? first)
  return block
}

function parseNestedCommentAtCursor(cursor: Cursor, run: number): BlockNode | undefined {
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  if (!commentBlockHasCloser(lexer, run)) return undefined
  const first = cursor.peek()!
  const previous = cursor.lines[cursor.at - 1]
  const shiftedAfterNestedList = previous && listMarker(previous.text) &&
    first.number === previous.number + 1 && /^ %%%/.test(first.text)
  if (cursor.owner.inList && (cursor.at === 0 ||
      first.text[0] !== '%' && !shiftedAfterNestedList)) {
    throw new UnsupportedCursorSyntax('list comment source ownership')
  }
  const comment = parseCommentBlock(lexer)
  if (cursor.owner.inList && cursor.lines.slice(cursor.at, lexer.pos).some((line) => line.text === '')) {
    throw new UnsupportedCursorSyntax('list comment blank ownership')
  }
  cursor.at = lexer.pos
  const openerColumn = first.text.length - first.text.trimStart().length + 1
  comment.pos = position(first, cursor.lines[cursor.at - 1] ?? first, openerColumn)
  return comment
}

function ambiguousDegradedComment(cursor: Cursor, first: SourceLine,
  atDocumentLevel: boolean, afterList: boolean): boolean {
  if ((atDocumentLevel && !afterList) || !first.text.trimStart().startsWith('%%%')) return false
  const physical = cursor.physicalLines
  const marker = listMarker(physical[first.number - 1]?.text ?? '')
  if (cursor.owner.kind === 'quote' && cursor.owner.parent?.kind === 'list' &&
      cursor.lines[0]?.number === first.number && marker?.content === '> %%%' &&
      plainQuoteText(cursor.lines[1]?.text ?? '')) return false
  if (!/^[ \t]+%%%/.test(physical[first.number - 1]?.text ?? '')) return true
  const previousMarker = listMarker(physical[first.number - 2]?.text ?? '')
  if (previousMarker && listMarker(previousMarker.content)) return true
  const next = physical[first.number]?.text ?? ''
  const after = physical[first.number + 1]?.text ?? ''
  return /^[ \t]+\S/.test(next) && /^[^ \t]/.test(after)
}

function isListGapBlockStart(text: string, body: SourceLine[]): boolean {
  if (ABBR_DEF.test(text)) return false
  if (text[0] === ' ') {
    const unindented = text.trimStart()
    if ((unindented[0] === '`' || unindented[0] === '~') &&
        (fenceOpen(unindented) || RE_RAW_FENCE.test(unindented))) return true
  }
  if (!RE_CAPTION.test(text)) return isBlockStart(text)
  let only: string | undefined
  for (const line of body) {
    if (line.text === '') continue
    if (only !== undefined) return true
    only = line.text
  }
  return only === undefined || only.startsWith('![') || only.startsWith('$$') || isBlockStart(only)
}

function rejectAmbiguousNestedPlus(marker: ReturnType<typeof listMarker>): void {
  if (marker && marker.indent > 0 && /^\+[ \t]*$/.test(marker.content)) {
    throw new UnsupportedCursorSyntax('indented first-block continuation marker')
  }
}

function rejectRaisedColonContinuation(text: string, frame: { contentColumn?: number } | undefined): void {
  const contentColumn = frame?.contentColumn
  if (contentColumn === undefined) return
  if (/^ {3,}:{3,}(?:[ \t]|$)/.test(text.slice(contentColumn - 1))) {
    throw new UnsupportedCursorSyntax('raised colon list ownership')
  }
}

function rejectAmbiguousListBoundary(marker: ReturnType<typeof listMarker>,
  frame: { indent: number; contentColumn?: number; body: SourceLine[] },
  line: SourceLine): void {
  if (marker && frame.contentColumn !== undefined &&
      marker.indent > frame.indent && marker.indent < frame.contentColumn - 1 &&
      RE_COMMENT_BLOCK_ANY.test(frame.body.at(-1)?.text ?? '')) {
    throw new UnsupportedCursorSyntax('marker after list comment')
  }
  if (frame.body[0]?.text.startsWith('>') && frame.body.at(-1)?.lazyText &&
      line.text.startsWith(' ') && rootLinkDef(line.text.trimStart())) {
    throw new UnsupportedCursorSyntax('quote continuation across list boundary')
  }
}

function rejectListQuoteBoundary(body: SourceLine[], line: SourceLine): void {
  if (body.at(-1)?.text.startsWith('>') &&
      mayContinueQuoteLazily(line.text, body.at(-1)?.text)) {
    throw new UnsupportedCursorSyntax('quote continuation across list boundary')
  }
}

function takeSimpleFirstBlockListPlus(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  depth: number, contentColumn: number): Array<{ line: SourceLine; prefix: number }> | undefined {
  const markerLineNested = depth === 1 &&
    (cursor.owner.kind === 'list' || cursor.owner.kind === 'quote')
  if (!(depth === 0 || markerLineNested) || marker.indent !== 0 || marker.content !== '+') return undefined
  const follower = cursor.peek()
  if (!follower) return undefined
  const after = cursor.peek(1)
  const prefix = ' '.repeat(contentColumn - 1)
  const atContentColumn = prefix.length > 0 && follower.text.startsWith(prefix)
  if (!(plainQuoteText(follower.text) ||
      (markerLineNested && RE_BLOCKQUOTE.test(follower.text)) ||
      (atContentColumn && plainQuoteText(follower.text.slice(prefix.length))))) return undefined
  if (after && !isBlankLine(after.text) && listMarker(after.text)?.indent !== 0) return undefined
  cursor.take()
  return [{ line: follower, prefix: atContentColumn ? prefix.length : 0 }]
}

function takeTaskFirstBlockQuote(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, depth: number): Array<{ line: SourceLine; prefix: number }> | undefined {
  const markerLineNested = depth === 1 && cursor.owner.kind === 'list' && marker.indent === 0
  if (!(depth === 0 || markerLineNested) ||
      marker.content.slice(taskWidth) !== '+') return undefined
  const follower = cursor.peek()
  if (!follower) return undefined
  const indent = /^ */.exec(follower.text)![0].length
  if (indent !== 0 && (!markerLineNested && indent !== marker.indent && indent !== marker.width)) {
    return undefined
  }
  if (!RE_BLOCKQUOTE.test(follower.text.slice(indent))) return undefined
  const after = cursor.peek(1)
  if (after && !isBlankLine(after.text)) return undefined
  cursor.take()
  return [{ line: follower, prefix: indent }]
}

function takeTaskFirstBlockFence(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, depth: number): Array<{ line: SourceLine; prefix: number }> | undefined {
  const markerLineNested = depth === 1 && cursor.owner.kind === 'list' && marker.indent === 0
  if (!(depth === 0 || markerLineNested) || marker.content.slice(taskWidth) !== '+') return undefined
  const first = cursor.peek()
  if (!first) return undefined
  const indent = /^ */.exec(first.text)![0].length
  if (indent !== 0 && indent !== marker.indent && indent !== marker.width) return undefined
  const fence = fenceOpen(first.text.slice(indent))?.marker
  if (!fence) return undefined
  const lines: Array<{ line: SourceLine; prefix: number }> = []
  for (let offset = 0; cursor.peek(offset); offset++) {
    const line = cursor.peek(offset)!
    if (!line.text.startsWith(' '.repeat(indent))) return undefined
    lines.push({ line, prefix: indent })
    if (offset > 0 && closesFence(line.text.slice(indent), fence)) {
      for (let i = 0; i < lines.length; i++) cursor.take()
      return lines
    }
  }
  return undefined
}

function nestedTaskFirstFenceEnd(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): number | undefined {
  if (depth !== 0 || stackLength !== 1 || frame.body.length !== 1 || frame.fenceMarker) return undefined
  const inner = listMarker(frame.body[0]!.text)
  if (!inner || !/^\[[ xX\-_>/!?]\] \+$/.test(inner.content)) return undefined
  return closedFenceEnd(cursor)
}

function nestedSimpleFirstPlain(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): boolean {
  if (depth !== 0 || stackLength !== 1 || frame.body.length !== 1 || frame.fenceMarker) return false
  const inner = listMarker(frame.body[0]!.text)
  const follower = cursor.peek()
  if (inner?.content !== '+' || !follower || !plainQuoteText(follower.text)) return false
  const after = cursor.peek(1)
  return !after || isBlankLine(after.text)
}

function takeListFirstBlock(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, depth: number, contentColumn: number):
  Array<{ line: SourceLine; prefix: number }> | undefined {
  return takeSimpleFirstBlockListPlus(cursor, marker, depth, contentColumn) ??
    takeTaskFirstBlockQuote(cursor, marker, taskWidth, depth) ??
    takeTaskFirstBlockFence(cursor, marker, taskWidth, depth)
}

function isRefusedTaskFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number): boolean {
  if (depth !== 0 || marker.indent === 0 || marker.content.slice(taskWidth) !== '+' || !next) return false
  const indent = /^ */.exec(next.text)![0].length
  return indent > 0 && indent < marker.indent &&
    (RE_BLOCKQUOTE.test(next.text.slice(indent)) || fenceOpen(next.text.slice(indent)) !== null)
}

function isUnattachedRootFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number): boolean {
  if (depth !== 0 || marker.indent !== 0 || marker.content.slice(taskWidth) !== '+') return false
  return next === undefined || isBlankLine(next.text) ||
    (listMarker(next.text)?.indent ?? Number.POSITIVE_INFINITY) <= marker.indent
}

function isRefusedListFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number): boolean {
  return isUnattachedRootFirstBlock(marker, taskWidth, next, depth) ||
    isRefusedTaskFirstBlock(marker, taskWidth, next, depth)
}

function isFenceMarkerContinuation(marker: ReturnType<typeof listMarker>, fenceMarker: string | undefined,
  contentColumn: number | undefined, text: string): boolean {
  return marker !== undefined && fenceMarker !== undefined && contentColumn !== undefined &&
    text.startsWith(' '.repeat(contentColumn - 1))
}

function listContinuationFollower(cursor: Cursor, indent: number,
  fenceMarker: string | undefined, depth: number): Array<{ line: SourceLine; prefix: number }> {
  const next = cursor.peek(1)
  const after = cursor.peek(2)
  const ownColumnQuote = indent > 0 && next?.text.startsWith(' '.repeat(indent)) &&
    RE_BLOCKQUOTE.test(next.text.slice(indent)) && !after
  if (depth !== 0 || fenceMarker || indent !== 0 && !ownColumnQuote) {
    throw new UnsupportedCursorSyntax('nested list continuation')
  }
  if (indent === 0 && next && fenceOpen(next.text)) {
    const marker = fenceOpen(next.text)!.marker
    const lines: Array<{ line: SourceLine; prefix: number }> = [{ line: next, prefix: 0 }]
    for (let offset = 2; cursor.peek(offset); offset++) {
      const line = cursor.peek(offset)!
      lines.push({ line, prefix: 0 })
      if (closesFence(line.text, marker)) {
        const caption = cursor.peek(offset + 1)
        if (caption && RE_CAPTION.test(caption.text)) lines.push({ line: caption, prefix: 0 })
        return lines
      }
    }
    throw new UnsupportedCursorSyntax('unclosed attached fence')
  }
  if (indent === 0 && next && RE_BLOCKQUOTE.test(next.text)) {
    const lines: Array<{ line: SourceLine; prefix: number }> = [{ line: next, prefix: 0 }]
    let offset = 2
    while (cursor.peek(offset) && RE_BLOCKQUOTE.test(cursor.peek(offset)!.text)) {
      lines.push({ line: cursor.peek(offset)!, prefix: 0 })
      offset++
    }
    if (!cursor.peek(offset) || isBlankLine(cursor.peek(offset)!.text)) return lines
    throw new UnsupportedCursorSyntax('multiline list continuation')
  }
  if (!next || next.text === '' || !ownColumnQuote &&
      (next.text[0] === ' ' || next.text[0] === '\t') ||
      isBlockStart(next.text) ||
      (after && after.text !== '' && !listMarker(after.text))) {
    throw new UnsupportedCursorSyntax('multiline list continuation')
  }
  return [{ line: next, prefix: ownColumnQuote ? indent : 0 }]
}

function nestedPlusDisposition(cursor: Cursor,
  frame: { indent: number; item?: ListItem; fenceMarker: string | undefined },
  stackLength: number): SourceLine[] | 'literal' | undefined {
  const text = cursor.peek()!.text
  if (text.charCodeAt(text.length - 1) !== 43 || stackLength < 2 || !frame.item ||
      frame.fenceMarker || text.length !== frame.indent + 1 ||
      text !== `${' '.repeat(frame.indent)}+`) return undefined
  const follower = cursor.peek(1)
  if (!follower || !follower.text.startsWith(' '.repeat(frame.indent))) return 'literal'
  const content = follower.text.slice(frame.indent)
  const fence = fenceOpen(content)?.marker
  if (fence) {
    const lines = [follower]
    for (let offset = 2; cursor.peek(offset); offset++) {
      const next = cursor.peek(offset)!
      if (!next.text.startsWith(' '.repeat(frame.indent))) {
        throw new UnsupportedCursorSyntax('nested attached fence owner')
      }
      lines.push(next)
      if (closesFence(next.text.slice(frame.indent), fence)) return lines
    }
    throw new UnsupportedCursorSyntax('unclosed nested attached fence')
  }
  if (!RE_BLOCKQUOTE.test(content) && !plainQuoteText(content)) return 'literal'
  const after = cursor.peek(2)
  return !after || isBlankLine(after.text) ? [follower] : 'literal'
}

function nestedPlusAtLine(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, line: SourceLine): ReturnType<typeof nestedPlusDisposition> {
  return line.text.charCodeAt(line.text.length - 1) === 43 ?
    nestedPlusDisposition(cursor, frame, stackLength) : undefined
}

function isTaskMarkerContent(content: string, ordered: boolean): boolean {
  return !ordered && /^\[([ xX\-_>/!?])\] /.test(content)
}

function takeTaskMarker(item: ListItem, content: string, ordered: boolean): number {
  if (ordered) return 0
  const task = /^\[([ xX\-_>/!?])\] /.exec(content)
  if (!task) return 0
  item.checked = task[1]!.toLowerCase() === 'x'
  if (task[1] !== ' ' && task[1]!.toLowerCase() !== 'x') item.taskState = task[1] as TaskState
  return task[0].length
}

function sameListKind(marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { ordered: boolean; delim?: '.' | ')'; bullet?: '-' | '*'; taskList: boolean }): boolean {
  return marker.ordered === frame.ordered && marker.delim === frame.delim &&
    marker.bullet === frame.bullet && isTaskMarkerContent(marker.content, marker.ordered) === frame.taskList
}

function endsListBlankRun(blanks: number, next: SourceLine | undefined, rootIndent: number): boolean {
  const marker = next ? listMarker(next.text) : undefined
  return next === undefined || (blanks >= 3 && marker !== undefined && marker.indent <= rootIndent)
}

function isFenceBlankContinuation(cursor: Cursor, frame: ListCursorFrame, next: SourceLine | undefined,
  stackLength: number, depth: number): boolean {
  if (frame.fenceMarker === undefined) return false
  if (!next) return stackLength === 1 && depth === 0 && cursor.owner.kind === 'root' &&
    frame.itemFirst?.number === frame.body[0]?.number
  return frame.contentColumn !== undefined &&
    next.text.startsWith(' '.repeat(frame.contentColumn - 1))
}

function isListContinuationMarker(cursor: Cursor, line: SourceLine, frame: ListCursorFrame): boolean {
  if (!frame.item) return false
  if (line.text === '+' || line.text === `${' '.repeat(frame.indent)}+`) return true
  return line.text === '+ ' && plainQuoteText(cursor.peek(1)?.text ?? '') &&
    (!cursor.peek(2) || cursor.peek(2)!.text === '')
}

function startsNestedListAfterLongBlankRun(blanks: number,
  marker: ReturnType<typeof listMarker>, rootIndent: number): boolean {
  return blanks >= 3 && marker !== undefined && marker.indent > rootIndent
}

function mayFoldNestedListParagraph(cursor: Cursor,
  top: { indent: number; ordered: boolean; delim?: '.' | ')'; bullet?: '-' | '*'; taskList: boolean;
    body: SourceLine[]; fenceMarker: string | undefined }, stackLength: number, depth: number): boolean {
  if (depth !== 0 || stackLength < 2 || top.fenceMarker ||
      !plainQuoteText(cursor.peek()!.text)) return false
  const last = top.body.at(-1)?.text ?? ''
  return plainQuoteText(last) || last === '+' && plainQuoteText(top.body.at(-2)?.text ?? '')
}

function mayFoldBelowColumnParagraph(cursor: Cursor,
  frame: { contentColumn?: number; fenceMarker: string | undefined; body: SourceLine[] },
  stack: readonly ListCursorFrame[]): boolean {
  const next = cursor.peek()!
  const last = frame.body.at(-1)
  if (!frame.contentColumn || frame.fenceMarker || !last ||
      next.text.startsWith(' '.repeat(frame.contentColumn - 1)) ||
      last.number !== next.number - 1 || isBlankLine(next.text) ||
      isBlockStart(next.text)) return false
  if (!plainQuoteText(last.text) &&
      !(plainPlusText(last.text) && frame.body[0]?.text[0] !== '|')) {
    const nestedMarker = frame.body.length === 1 ? listMarker(last.text) : undefined
    if (!nestedMarker || !plainQuoteText(nestedMarker.content)) return false
  }
  const raised = next.text.trimStart()
  if (raised.startsWith('>') || raised.startsWith('`') || raised.startsWith('~') ||
      raised.startsWith('{') || raised.startsWith('::')) return false
  return deepestReachableFrame(stack, next.text, true) === undefined
}

function ownsBelowColumnQuotedLiteral(body: SourceLine[], follower: string): boolean {
  const first = body[0]?.text
  const last = body.at(-1)?.text
  return first?.startsWith('>') === true && nestedQuoteParagraphText(first) &&
    last !== undefined && /^>  (?:\[|\{)/.test(last) && plainQuoteText(follower)
}

function markBelowColumnQuotedLiteral(body: SourceLine[], line: SourceLine): SourceLine {
  return ownsBelowColumnQuotedLiteral(body, line.text) ? { ...line, lazyText: true } : line
}

function mayFoldRootListParagraph(cursor: Cursor,
  frame: { indent: number; contentColumn?: number;
    fenceMarker: string | undefined; body: SourceLine[];
    lazyRootParagraph: boolean },
  stackLength: number, depth: number): boolean {
  const next = cursor.peek()!
  const first = frame.body[0]
  const last = frame.body.at(-1)
  if (!(depth === 0 || depth === 1 &&
      (cursor.owner.kind === 'list' || cursor.owner.kind === 'definition' ||
        cursor.owner.kind === 'quote')) ||
      stackLength !== 1 || frame.indent !== 0 || frame.fenceMarker ||
      last?.number !== next.number - 1 ||
      !(frame.lazyRootParagraph || ownsBelowColumnQuotedLiteral(frame.body, next.text) ||
        frame.body.length === 1 &&
        first !== undefined &&
        (plainQuoteText(first.text) || listFirstBlockParagraphText(first.text)))) return false
  const follower = next.text
  let continues = plainQuoteText(follower) || frame.lazyRootParagraph &&
    frame.body[0]?.text[0] !== '>' && !isBlankLine(follower) && !isBlockStart(follower)
  if (!continues && frame.contentColumn !== undefined) {
    const indent = /^ */.exec(follower)![0].length
    if (indent > frame.indent && indent < frame.contentColumn - 1) {
      const content = follower.slice(indent)
      continues = content !== '' && content[0] !== '[' && content[0] !== '{' &&
        content[0] !== '+' && (cursor.owner.kind === 'definition' || !content.startsWith('*[')) &&
        !content.startsWith('%%')
    }
  }
  return continues
}

function mayFoldMarkerLineNestedFollower(cursor: Cursor,
  frame: { body: SourceLine[]; fenceMarker: string | undefined },
  stackLength: number, depth: number): boolean {
  if (!(depth === 0 || depth === 1 && cursor.owner.kind === 'quote') ||
      stackLength !== 1 || frame.fenceMarker || frame.body.length !== 1) return false
  const first = frame.body[0]!
  const marker = listMarker(first.text)
  const follower = cursor.peek()!
  if (first.number !== follower.number - 1) return false
  if (first.text === '> +' && (RE_BLOCKQUOTE.test(follower.text) ||
      RE_HEADING.test(follower.text) || isTableRow(follower.text)) && !cursor.peek(1)) return true
  return marker !== undefined &&
    (plainQuoteText(marker.content) && plainQuoteText(follower.text) ||
      (marker.content === '+' || /^\[[ xX\-_>/!?]\] \+$/.test(marker.content)) &&
      RE_BLOCKQUOTE.test(follower.text) && !cursor.peek(1))
}

function mayFoldListParagraph(cursor: Cursor,
  frame: { indent: number; contentColumn?: number; ordered: boolean;
    delim?: '.' | ')'; bullet?: '-' | '*';
    taskList: boolean; fenceMarker: string | undefined; body: SourceLine[];
    lazyRootParagraph: boolean }, stack: readonly ListCursorFrame[], depth: number): boolean {
  return mayFoldNestedListParagraph(cursor, frame, stack.length, depth) ||
    mayFoldRootListParagraph(cursor, frame, stack.length, depth) ||
    mayFoldMarkerLineNestedFollower(cursor, frame, stack.length, depth) ||
    mayFoldBelowColumnParagraph(cursor, frame, stack)
}

function finalNestedListLazyLine(cursor: Cursor, body: SourceLine[], stackLength: number):
  'fold' | 'decline' | undefined {
  const line = cursor.peek()!.text
  if (stackLength < 3 || !/^[ ]+\S/.test(line) ||
      !plainQuoteText(body.at(-1)?.text ?? '') || !plainQuoteText(line.trimStart())) return undefined
  return cursor.peek(1) ? 'decline' : 'fold'
}

function isBelowListMarkerColumn(marker: NonNullable<ReturnType<typeof listMarker>>,
  top: { indent: number; contentColumn?: number; fenceMarker: string | undefined;
    body: SourceLine[]; retainedBelowColumnComment: boolean },
  depth: number, lineNumber: number, owner: ContainerOwner, stackLength: number): boolean {
  if (!(depth === 0 || depth === 1 &&
      (owner.kind === 'list' || owner.kind === 'quote')) || stackLength !== 1 ||
      top.fenceMarker || top.contentColumn === undefined ||
      marker.indent <= top.indent || marker.indent >= top.contentColumn - 1 ||
      top.body.at(-1)?.number !== lineNumber - 1) return false
  const last = top.body.at(-1)!.text
  if (top.retainedBelowColumnComment) return true
  if (plainQuoteText(last)) return true
  if (nestedQuoteParagraphText(last)) return true
  const innerMarker = depth === 0 && top.body.length === 1 ? listMarker(last) : undefined
  return innerMarker !== undefined && plainQuoteText(innerMarker.content)
}

function isDedentedNestedParagraphMarker(marker: NonNullable<ReturnType<typeof listMarker>>,
  stack: readonly ListCursorFrame[], line: SourceLine): boolean {
  const top = stack.at(-1)
  const parent = stack[0]
  return stack.length === 2 && top !== undefined && parent !== undefined &&
    parent.contentColumn !== undefined && top.indent === parent.contentColumn - 1 &&
    marker.indent > parent.indent && marker.indent < top.indent &&
    top.body.at(-1)?.number === line.number - 1 &&
    plainQuoteText(top.body.at(-1)?.text ?? '')
}

function belowColumnListBody(line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { body: SourceLine[]; retainedBelowColumnComment: boolean }):
  { line: SourceLine; prefix: number } {
  const quoteFirstBlock = frame.body[0]?.text.startsWith('>')
  return { line: frame.retainedBelowColumnComment || quoteFirstBlock ?
    { ...line, lazyText: true } : line, prefix: quoteFirstBlock ? marker.indent : 0 }
}

function markerFallsBetweenListColumns(marker: ReturnType<typeof listMarker>,
  top: { indent: number; contentColumn?: number }): boolean {
  return marker !== undefined && top.contentColumn !== undefined &&
    marker.indent > top.indent && marker.indent < top.contentColumn - 1
}

function preservesNestedListGap(frame: { indent: number; contentColumn?: number;
  body: SourceLine[] }, nextMarker: ReturnType<typeof listMarker>): boolean {
  return nextMarker !== undefined && frame.contentColumn !== undefined &&
    nextMarker.indent > frame.indent && nextMarker.indent === frame.contentColumn - 1 &&
    listMarker(frame.body[0]?.text ?? '') !== undefined
}

function allowsEmptyRetainedFence(frame: { bareFenceAfterRetainedComment: boolean;
  fenceMarker: string | undefined; body: SourceLine[]; contentColumn?: number },
next: SourceLine | undefined): boolean {
  return frame.bareFenceAfterRetainedComment && frame.fenceMarker !== undefined &&
    /^(?:`{3,}|~{3,})$/.test(frame.body.at(-1)?.text ?? '') &&
    frame.contentColumn !== undefined &&
    !next?.text.startsWith(' '.repeat(frame.contentColumn - 1))
}

function nestedListSpanColumn(owner: ContainerOwner, hostColumn: number | undefined,
  markerIndent: number): number {
  return owner.kind === 'root' ? hostColumn ?? markerIndent + 1 : markerIndent + 1
}

function updateListFrameEnds(frames: Array<{ last: SourceLine; spanColumn: number;
  item?: ListItem; itemFirst?: SourceLine }>, line: SourceLine,
listSpan: (from: SourceLine, to: SourceLine, column: number) => Position): void {
  for (const frame of frames) {
    frame.last = line
    if (frame.item && frame.itemFirst) frame.item.pos = listSpan(frame.itemFirst, line, frame.spanColumn)
  }
}

type ListCursorFrame = { list: List; first: SourceLine; last: SourceLine; indent: number;
  spanColumn: number;
  ordered: boolean; taskList: boolean; kind?: OlKind; delim?: '.' | ')'; bullet?: '-' | '*';
  item?: ListItem; itemFirst?: SourceLine; contentColumn?: number;
  fenceMarker: string | undefined; fencePrefix: number | undefined; fenceMayDedent: boolean;
  quoteFenceMarker: string | undefined; closedQuoteFence: boolean;
  body: SourceLine[];
  blankBeforeInvisible: boolean; lazyRootParagraph: boolean;
  retainedBelowColumnComment: boolean; bareFenceAfterRetainedComment: boolean;
  possibleInvisibleTail: boolean }

function releaseRootListFenceAtBoundary(frame: ListCursorFrame,
  owner: ContainerOwner, stackLength: number): void {
  if (stackLength !== 1 || owner.kind !== 'root' || !frame.fenceMarker ||
      !fenceOpen(frame.body[0]?.text ?? '')) return
  const lastChild = frame.item?.children.at(-1)
  const lastNestedBlock = lastChild?.type === 'list' ?
    lastChild.items.at(-1)?.children.at(-1) : undefined
  if (lastNestedBlock?.type !== 'paragraph') frame.fenceMayDedent = true
}

function listFenceStaysInParagraph(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, text: string, strippedPrefix: number): boolean {
  if (cursor.owner.kind !== 'root' || frame.indent !== 0 || frame.fenceMarker ||
      frame.contentColumn === undefined ||
      frame.body.at(-1)?.number !== line.number - 1 ||
      !plainQuoteText(frame.body.at(-1)?.text ?? '') || text[0] === ' ' ||
      strippedPrefix !== frame.contentColumn - 1) return false
  const marker = fenceOpen(text)?.marker
  if (!marker) return false
  const prefix = ' '.repeat(frame.contentColumn - 1)
  let afterBlank = false
  for (let offset = 0; cursor.peek(offset); offset++) {
    const future = cursor.peek(offset)!.text
    if (future === '') { afterBlank = true; continue }
    if (afterBlank && !future.startsWith(prefix)) break
    if (future.startsWith(prefix)) {
      const inner = future.slice(prefix.length)
      if (closesFence(inner, marker) || afterBlank && fenceOpen(inner.trimStart())) return false
    }
  }
  return true
}

function shouldMatchShiftedListFence(frame: ListCursorFrame, line: SourceLine,
  prefix: number, stackLength: number): boolean {
  return !frame.fenceMarker && line.text[prefix] === ' ' && stackLength === 1 &&
    !listMarker(frame.body[0]?.text ?? '') && !beginsOpenQuotedParagraph(frame.body)
}

function continuedListFencePrefix(frame: ListCursorFrame, line: SourceLine, prefix: number): number {
  if (!line.text.startsWith(' '.repeat(frame.fencePrefix!))) {
    if (!frame.fenceMayDedent) throw new UnsupportedCursorSyntax('shifted fence continuation')
    return prefix
  }
  return frame.fencePrefix!
}

function heldNestedMarkerPrefix(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>): number | undefined {
  const column = frame.contentColumn
  if (column === undefined || marker.indent <= frame.indent ||
      !line.text.startsWith(' '.repeat(column - 1))) return undefined
  if (listMarker(frame.body[0]?.text ?? '')) return column - 1
  const opener = COLON_OPEN.exec(frame.body[0]?.text ?? '')
  if (!opener) return undefined
  const closer = new RegExp(`^:{${opener[1]!.length}}[ \\t]*$`)
  for (let offset = 0; cursor.peek(offset); offset++) {
    const text = cursor.peek(offset)!.text
    if (!text.startsWith(' '.repeat(column - 1))) return undefined
    const body = text.slice(column - 1)
    if (closer.test(body)) return column - 1
    if (!listMarker(body)) return undefined
  }
  return undefined
}

function deepestReachableFrame<T extends { contentColumn?: number }>(frames: readonly T[],
  text: string, excludeTop = false): T | undefined {
  for (let index = frames.length - 1 - (excludeTop ? 1 : 0); index >= 0; index--) {
    const frame = frames[index]!
    if (frame.contentColumn !== undefined &&
        text.startsWith(' '.repeat(frame.contentColumn - 1))) return frame
  }
  return undefined
}

function wrappedListAttributeCount(cursor: Cursor, prefix: number): number {
  if (cursor.owner.kind !== 'root' && cursor.owner.kind !== 'quote') return 0
  const first = cursor.peek()!.text.slice(prefix)
  if (first[0] !== '{' || first.includes('}')) return 0
  const lines = [first]
  for (let index = 1; cursor.peek(index); index++) {
    const text = cursor.peek(index)!.text
    if (isBlankLine(text)) return 0
    lines.push(text)
    if (text.includes('}')) break
  }
  return probeBlockAttributes(new Lexer(lines))?.count ?? 0
}

function attachTrailingListAttrs(body: SourceLine[], list: List): void {
  let end = body.length
  while (end > 0 && isBlankLine(body[end - 1]!.text)) end--
  let attrs: Attrs | null = null
  let start = end
  while (start > 0) {
    const found = parseBlockAttributeRun(body[start - 1]!.text)
    if (!found) break
    attrs = attrs ? mergeAttrs(found, attrs) : found
    start--
  }
  if (attrs) {
    list.attrs = attrs
    body.splice(start)
  }
}

function loosensListGap(cursor: Cursor, body: SourceLine[], text: string,
  prefix: number, nestedContinuation: boolean): boolean {
  if (parseBlockAttributeRun(text.trimStart())) return false
  if (nestedContinuation || isListGapBlockStart(text, body)) return false
  return text[0] !== '{' || wrappedListAttributeCount(cursor, prefix) <= 1
}

function indentedListAttributePrefix(text: string, prefix: number): number {
  const remaining = text.slice(prefix)
  const attribute = remaining.trimStart()
  return attribute !== remaining && parseBlockAttributeRun(attribute) ?
    prefix + remaining.length - attribute.length : prefix
}

function markInvisibleListGap(frame: ListCursorFrame, attrsSeen: boolean, text: string): void {
  if (attrsSeen || LINE_COMMENT.test(text)) frame.blankBeforeInvisible = true
}

function parseList(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number,
  first: SourceLine, firstMarker: NonNullable<ReturnType<typeof listMarker>>): List {
  const listSpan = (from: SourceLine, to: SourceLine, column: number): Position =>
    position(from, to, depth === 0 && from.baseColumn === undefined &&
      column === firstMarker.indent + 1 ? 1 : column, contentEndColumn(to))
  const newFrame = (line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>,
    hostColumn = marker.indent + 1): ListCursorFrame => {
    const list: List = { type: 'list', ordered: marker.ordered, tight: true, items: [] }
    let kind: OlKind | undefined
    if (marker.ordered) {
      let nextRaw: string | null = null
      for (let i = cursor.at + 1; i < cursor.lines.length; i++) {
        const next = listMarker(cursor.lines[i]!.text)
        if (!next || next.indent > marker.indent) continue
        if (next.indent === marker.indent && next.ordered && next.delim === marker.delim) nextRaw = next.raw!
        break
      }
      kind = olKindOf(marker.raw!, nextRaw)
      const start = olStartOf(marker.raw!, kind)
      if (start !== 1) list.start = start
      if (kind !== 'dec') list.olType = kind === 'alo' ? 'a' : kind === 'aup' ? 'A' : kind === 'rlo' ? 'i' : 'I'
      if (marker.delim === ')') list.delim = ')'
      if (marker.raw === '') list.bareMarker = true
    } else if (marker.bullet === '*') list.bulletChar = '*'
    const spanColumn = Math.min(marker.indent + 1, hostColumn, marker.authoredIndent + 1)
    list.pos = listSpan(line, line, spanColumn)
    return { list, first: line, last: line,
      indent: marker.indent, spanColumn,
      ordered: marker.ordered,
      taskList: isTaskMarkerContent(marker.content, marker.ordered),
      ...(kind ? { kind } : {}),
      ...(marker.delim ? { delim: marker.delim } : {}),
      ...(marker.bullet ? { bullet: marker.bullet } : {}), fenceMarker: undefined,
      fencePrefix: undefined, fenceMayDedent: false,
      quoteFenceMarker: undefined, closedQuoteFence: false,
      body: [], blankBeforeInvisible: false,
      lazyRootParagraph: false, retainedBelowColumnComment: false,
      bareFenceAfterRetainedComment: false, possibleInvisibleTail: false }
  }
  const stack = [newFrame(first, firstMarker)]
  const blankContinuationFrame = (next: SourceLine,
    marker: ReturnType<typeof listMarker>, top: ListCursorFrame,
    blankCount: number): ListCursorFrame | undefined => {
    if (marker) return undefined
    if (stack.length > 1 && top.item && next.text === `${' '.repeat(top.indent)}+`) return top
    const follower = cursor.peek(blankCount + 1)
    const afterFollower = cursor.peek(blankCount + 2)
    if (depth === 0 && stack.length === 1 && top.indent === 0 && top.item && next.text === '+' &&
        plainQuoteText(follower?.text ?? '') &&
        (!afterFollower || isBlankLine(afterFollower.text))) return top
    return deepestReachableFrame(stack, next.text)
  }
  const blankLooseFrame = (continued: ListCursorFrame, top: ListCursorFrame,
    next: SourceLine): ListCursorFrame => {
    return stack.length > 1 && continued === top &&
      next.text === `${' '.repeat(top.indent)}+` ? stack.at(-2)! : continued
  }
  const applyInvisibleTail = (frame: ListCursorFrame): void => {
    if (frame.blankBeforeInvisible) frame.list.tight = false
    frame.blankBeforeInvisible = false
  }
  const trimFrameEnd = (frame: ListCursorFrame) => {
    if (!frame.item || !frame.itemFirst) return
    if (frame.item.children.length === 0) {
      const marker = listMarker(frame.itemFirst.text)
      if (marker) {
        frame.last = { ...frame.itemFirst,
          spanEndColumn: 'continuationWidth' in marker ? marker.continuationWidth : marker.width + 1 }
        frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
      }
    }
    const placedEndLine = frame.item.children.at(-1)?.pos?.endLine
    if (placedEndLine && placedEndLine < frame.last.number) {
      const placed = cursor.physicalLines[placedEndLine - 1]
      if (placed) {
        frame.last = placed
        frame.item.pos = listSpan(frame.itemFirst, placed, frame.spanColumn)
      }
    }
  }
  const flush = (frame: ListCursorFrame) => {
    if (!frame.item) return
    if (!frame.body.length) {
      if (frame.possibleInvisibleTail) trimFrameEnd(frame)
      return
    }
    let allowEmptyFence = allowsEmptyRetainedFence(frame, cursor.peek())
    const firstText = frame.body[0]!.text
    if (frame.body.length === 1 && (firstText[0] === '`' || firstText[0] === '~') &&
        /^(?:`{3,}|~{3,})$/.test(firstText) &&
        (frame.itemFirst?.number === frame.body[0]!.number ||
          (cursor.owner.kind === 'quote' && frame.item.children.at(-1)?.type === 'list'))) {
      const next = cursor.peek()
      const immediate = frame.itemFirst ? cursor.physicalLines[frame.itemFirst.number] : undefined
      allowEmptyFence = (!immediate || !isBlankLine(immediate.text)) &&
        (!next || (next.text !== '' && next.text.trim() !== '+' &&
          frame.contentColumn !== undefined &&
          !next.text.startsWith(' '.repeat(frame.contentColumn - 1))))
    }
    if (frame.body.length === 1 && plainQuoteText(firstText) && !frame.body[0]!.lazyText) {
      const line = frame.body[0]!
      frame.item.children.push({ type: 'paragraph',
        children: inline.inlines([{ line, column: 1, text: line.text }]),
        pos: position(line, line, 1, line.text.replace(/[ \t]+$/, '').length + 1) })
    } else if (frame.body.length > 1 && frame.body.every((line) =>
      !line.lazyText && plainQuoteText(line.text))) {
      const first = frame.body[0]!
      const last = frame.body.at(-1)!
      frame.item.children.push({ type: 'paragraph',
        children: inline.inlines(frame.body.map((line) => ({ line, column: 1, text: line.text }))),
        pos: position(first, last, 1, last.text.replace(/[ \t]+$/, '').length + 1) })
    } else {
      frame.item.children.push(...parseBlocks(
        new Cursor(frame.body, undefined, childOwner(cursor.owner, 'list', allowEmptyFence,
          frame.fenceMayDedent || cursor.owner.allowUnclosedFence,
          cursor.owner.fenceBoundary, cursor.owner.kind === 'root' ? firstMarker.width : undefined),
          cursor.physicalLines),
        inline, definitionNodes, depth + 1, false))
    }
    trimFrameEnd(frame)
    frame.body = []
    frame.possibleInvisibleTail = false
    frame.lazyRootParagraph = false
    frame.retainedBelowColumnComment = false
  }
  const mixedNestedHost = (marker: NonNullable<ReturnType<typeof listMarker>>): ListCursorFrame => {
    let host = stack.at(-1)!
    if (stack.length > 1 && marker.indent === host.indent && !sameListKind(marker, host)) {
      const done = stack.pop()!
      flush(done)
      done.list.pos = listSpan(done.first, done.last, done.spanColumn)
      host = stack.at(-1)!
    }
    return host
  }
  const appendBody = (frame: ListCursorFrame, line: SourceLine, prefix: number,
    rootLazy = false) => {
    const claimed = quoteListLazyLine(frame.body, line, prefix)
    line = claimed.line
    prefix = claimed.prefix
    frame.bareFenceAfterRetainedComment = false
    const text = line.text.slice(prefix)
    const literalFence = listFenceStaysInParagraph(cursor, frame, line, text, prefix)
    if (literalFence) {
      line = { ...line, lazyText: true }
      rootLazy = true
    }
    if (line.wrappedAttr || text[0] === '{' && parseBlockAttributeRun(text)) {
      for (const open of stack) open.possibleInvisibleTail = true
    }
    frame.lazyRootParagraph = rootLazy || frame.lazyRootParagraph && plainQuoteText(text)
    const previous = frame.body.at(-1)?.text ?? ''
    if (frame.blankBeforeInvisible && text !== '' && !LINE_COMMENT.test(text) &&
        LINE_COMMENT.test(previous) && !RE_COMMENT_BLOCK_ANY.test(previous)) {
      frame.list.tight = false
      frame.blankBeforeInvisible = false
    }
    if (frame.blankBeforeInvisible && parseBlockAttributeRun(previous) &&
        isBlockStart(text) && !parseBlockAttributeRun(text)) {
      frame.blankBeforeInvisible = false
    }
    frame.body.push(prefix === 0 ? line : { text, start: line.start + prefix, number: line.number,
      baseColumn: (line.baseColumn ?? 1) + prefix,
      ...(line.lazyText ? { lazyText: true } : {}),
      ...(line.wrappedAttr ? { wrappedAttr: true } : {}) })
    if (frame.quoteFenceMarker && text[0] === '>') {
      const inner = text.slice(text[1] === ' ' ? 2 : 1)
      if (closesFence(inner, frame.quoteFenceMarker)) {
        frame.quoteFenceMarker = undefined
        frame.closedQuoteFence = true
      }
    } else if (frame.closedQuoteFence &&
        (text === '' || text[0] === '>' || isBlockStart(text))) {
      frame.closedQuoteFence = false
    } else if (frame.body.length === 1 && text[0] === '>') {
      frame.quoteFenceMarker = fenceOpen(text.slice(text[1] === ' ' ? 2 : 1))?.marker
    }
    if (frame.fenceMarker) {
      if (closesFence(text, frame.fenceMarker)) {
        frame.fenceMarker = undefined
        frame.fencePrefix = undefined
        frame.fenceMayDedent = false
      }
    } else {
      const marker = RE_RAW_FENCE.exec(text)?.[1] ?? fenceOpen(text)?.marker
      if (marker && !literalFence) {
        frame.fenceMarker = marker
        frame.fencePrefix = prefix
      }
    }
  }
  const consumeWrappedAttribute = (frame: ListCursorFrame, prefix: number): boolean => {
    if (cursor.peek()?.text[prefix] !== '{') return false
    const count = wrappedListAttributeCount(cursor, prefix)
    if (count <= 1) return false
    for (let index = 0; index < count; index++) {
      const line = cursor.take()
      appendBody(frame, index === 0 ? { ...line, wrappedAttr: true } : line,
        index === 0 ? prefix : 0)
      updateListFrameEnds(stack, line, listSpan)
    }
    return true
  }
  const appendNestedListGap = (frame: ListCursorFrame, nextMarker: ReturnType<typeof listMarker>,
    blanks: number): void => {
    if (!preservesNestedListGap(frame, nextMarker)) return
    for (let i = 0; i < blanks; i++) {
      appendBody(frame, cursor.lines[cursor.at - blanks + i]!, 0)
    }
  }
  const attachFirstBlock = (frame: ListCursorFrame, item: ListItem,
    line: SourceLine,
    firstBlock: Array<{ line: SourceLine; prefix: number }> | undefined): SourceLine | undefined => {
    if (!firstBlock) return undefined
    frame.body = []
    for (const attached of firstBlock) appendBody(frame, attached.line, attached.prefix)
    frame.last = firstBlock.at(-1)!.line
    item.pos = listSpan(line, frame.last, frame.spanColumn)
    return frame.last
  }
  const appendAttachedBlock = (frame: ListCursorFrame,
    attached: Array<{ line: SourceLine; prefix: number }>): void => {
    for (const { line, prefix } of attached) {
      cursor.take()
      appendBody(frame, line, prefix)
      frame.last = line
    }
    if (frame.itemFirst && frame.item) {
      frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
    }
  }
  const takeNestedTaskFence = (frame: ListCursorFrame): boolean => {
    const end = nestedTaskFirstFenceEnd(cursor, frame, stack.length, depth)
    if (end === undefined) return false
    for (let offset = 0; offset <= end; offset++) {
      const owned = cursor.take()
      appendBody(frame, owned, 0)
      updateListFrameEnds(stack, owned, listSpan)
    }
    return true
  }
  const takeNestedFirstBlock = (frame: ListCursorFrame, line: SourceLine): boolean => {
    if (takeNestedTaskFence(frame)) return true
    if (!nestedSimpleFirstPlain(cursor, frame, stack.length, depth)) return false
    cursor.take()
    appendBody(frame, line, 0)
    updateListFrameEnds(stack, line, listSpan)
    return true
  }
  while (cursor.peek()) {
    const line = cursor.peek()!
    const marker = listMarker(line.text)
    rejectAmbiguousNestedPlus(marker)
    const top = stack.at(-1)!
    rejectAmbiguousListBoundary(marker, top, line)
    const nestedPlus = nestedPlusAtLine(cursor, top, stack.length, line)
    if (nestedPlus) {
      cursor.take()
      if (nestedPlus === 'literal') {
        appendBody(top, { ...line, lazyText: true }, top.indent, true)
        updateListFrameEnds(stack, line, listSpan)
      } else {
        flush(top)
        for (const attached of nestedPlus) {
          cursor.take()
          appendBody(top, attached, top.indent)
          updateListFrameEnds(stack, attached, listSpan)
        }
      }
      continue
    }
    if (isListContinuationMarker(cursor, line, top)) {
      const attached = listContinuationFollower(cursor, top.indent,
        top.fenceMarker, depth)
      cursor.take()
      flush(top)
      appendAttachedBlock(top, attached)
      continue
    }
    if (isFenceMarkerContinuation(marker, top.fenceMarker, top.contentColumn, line.text)) {
      cursor.take()
      appendBody(top, line, top.contentColumn! - 1)
      top.last = line
      if (top.item && top.itemFirst) top.item.pos = listSpan(top.itemFirst, line, top.spanColumn)
      continue
    }
    if (marker) {
      const quoteOwned = quoteOwnedListMarker(cursor, line, marker, top)
      if (quoteOwned) {
        cursor.take()
        appendBody(top, quoteOwned.line, quoteOwned.prefix, quoteOwned.rootLazy)
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (isBelowListMarkerColumn(marker, top, depth, line.number, cursor.owner, stack.length)) {
        cursor.take()
        const claimed = belowColumnListBody(line, marker, top)
        appendBody(top, claimed.line, claimed.prefix, true)
        top.retainedBelowColumnComment = false
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (isDedentedNestedParagraphMarker(marker, stack, line)) {
        cursor.take()
        appendBody(top, { ...line, lazyText: true }, 0, true)
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (markerFallsBetweenListColumns(marker, top)) break
      if (marker.indent < firstMarker.indent) break
      const heldPrefix = heldNestedMarkerPrefix(cursor, top, line, marker)
      if (heldPrefix !== undefined) {
        cursor.take()
        appendBody(top, line, heldPrefix)
        top.last = line
        if (top.item && top.itemFirst) top.item.pos = listSpan(top.itemFirst, line, top.spanColumn)
        continue
      }
      while (stack.length > 1 && marker.indent < stack.at(-1)!.indent) {
        const done = stack.pop()!
        flush(done)
        done.list.pos = listSpan(done.first, done.last, done.spanColumn)
      }
      const host = mixedNestedHost(marker)
      if (marker.indent > host.indent) {
        if (!host.item) break
        const nested = newFrame(line, marker,
          nestedListSpanColumn(cursor.owner, host.contentColumn, marker.indent))
        attachTrailingListAttrs(host.body, nested.list)
        host.blankBeforeInvisible = false
        flush(host)
        host.item.children.push(nested.list)
        stack.push(nested)
      } else if (!sameListKind(marker, host)) {
        break
      }
      const current = stack.at(-1)!
      applyInvisibleTail(current)
      flush(current)
      cursor.take()
      const item: ListItem = { type: 'list_item', children: [], pos: listSpan(line, line, current.spanColumn) }
      const taskWidth = takeTaskMarker(item, marker.content, marker.ordered)
      if ('attrs' in marker) item.attrs = marker.attrs
      current.list.items.push(item)
      current.item = item
      current.itemFirst = line
      current.contentColumn = ('continuationWidth' in marker ? marker.continuationWidth : marker.width) + 1
      current.body = []
      current.possibleInvisibleTail = false
      current.lazyRootParagraph = false
      current.retainedBelowColumnComment = false
      current.fenceMarker = undefined
      current.fencePrefix = undefined
      current.fenceMayDedent = false
      current.quoteFenceMarker = undefined
      current.closedQuoteFence = false
      appendBody(current, line, marker.width + taskWidth)
      const firstBlock = takeListFirstBlock(cursor, marker, taskWidth, depth, current.contentColumn)
      const refusedFirstBlock = !firstBlock && isRefusedListFirstBlock(marker, taskWidth, cursor.peek(), depth)
      const emptyAttributedItem = 'attrs' in marker && current.body.length === 0
      const spanLine = refusedFirstBlock || emptyAttributedItem ?
        { ...line, spanEndColumn: 'continuationWidth' in marker ? marker.continuationWidth : marker.width + 1 } : line
      if (refusedFirstBlock) current.body = []
      const attachedLast = attachFirstBlock(current, item, line, firstBlock)
      updateListFrameEnds(stack, attachedLast ?? spanLine, listSpan)
      continue
    }
    if (line.text === '') {
      top.retainedBelowColumnComment = false
      let blanks = 0
      while (cursor.peek(blanks)?.text === '') blanks++
      const next = cursor.peek(blanks)!
      if (isFenceBlankContinuation(cursor, top, next, stack.length, depth)) {
        for (let i = 0; i < blanks; i++) {
          const blank = cursor.take()
          appendBody(top, blank, 0)
          updateListFrameEnds(stack, blank, listSpan)
        }
        continue
      }
      if (endsListBlankRun(blanks, next, firstMarker.indent)) break
      const nextMarker = listMarker(next.text)
      if (markerFallsBetweenListColumns(nextMarker, top)) break
      if (startsNestedListAfterLongBlankRun(blanks, nextMarker, firstMarker.indent)) {
        while (stack.length > 1) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.spanColumn)
        }
        for (let i = 0; i < blanks; i++) cursor.take()
        continue
      }
      const target = nextMarker && stack.find((frame) => frame.indent === nextMarker.indent)
      const sibling = nextMarker && target && sameListKind(nextMarker, target)
      const nested = nextMarker && nextMarker.indent > top.indent
      const continuationFrame = blankContinuationFrame(next, nextMarker, top, blanks)
      rejectRaisedColonContinuation(next.text, continuationFrame)
      if (!sibling && !nested && !continuationFrame) break
      for (let i = 0; i < blanks; i++) cursor.take()
      appendNestedListGap(top, nextMarker, blanks)
      if (continuationFrame) {
        while (stack.at(-1) !== continuationFrame) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.spanColumn)
        }
        for (let i = 0; i < blanks; i++) {
          const blank = cursor.lines[cursor.at - blanks + i]!
          appendBody(continuationFrame, blank, 0)
        }
        const firstNested = listMarker(continuationFrame.body[0]?.text ?? '')
        const nestedContinuation = firstNested && continuationFrame.contentColumn !== undefined &&
          next.text.startsWith(' '.repeat(continuationFrame.contentColumn - 1 + firstNested.width))
        const prefixLength = continuationFrame.contentColumn! - 1
        let lookahead = 0
        let blockText = listGapBlockText(cursor, next, prefixLength)
        while (parseBlockAttributeRun(blockText.trimStart())) {
          lookahead++
          const following = cursor.peek(lookahead)
          if (!following?.text.startsWith(' '.repeat(prefixLength))) break
          blockText = following.text.slice(listContinuationPrefix(following.text, prefixLength))
        }
        markInvisibleListGap(continuationFrame, lookahead > 0, blockText)
        if (blanks > 1 && RE_CAPTION.test(blockText) ||
            loosensListGap(cursor, continuationFrame.body, blockText,
          prefixLength, nestedContinuation === true)) {
          blankLooseFrame(continuationFrame, top, next).list.tight = false
        }
      } else if (sibling) target.list.tight = false
      continue
    }
    const contentColumn = top.contentColumn
    if (contentColumn === undefined) break
    const prefix = ' '.repeat(contentColumn - 1)
    const reachedPrefix = reachableListPrefix(line.text, contentColumn)
    if (reachedPrefix === undefined && top.body.at(-1)?.number === line.number - 1) {
      const previousText = top.body.at(-1)!.text
      if (LINE_COMMENT.test(line.text) && !RE_COMMENT_BLOCK_ANY.test(line.text) &&
          (top.retainedBelowColumnComment || plainQuoteText(previousText) ||
            listFirstBlockParagraphText(previousText))) {
        cursor.take()
        appendBody(top, line, 0)
        top.retainedBelowColumnComment = true
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (top.retainedBelowColumnComment && retainedCommentFollower(line.text)) {
        cursor.take()
        const follower = retainedListFollower(line.text, top.body)
        appendBody(top, line, follower.prefix, follower.rootLazy)
        top.bareFenceAfterRetainedComment = follower.prefix !== 0
        top.retainedBelowColumnComment = false
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
    }
    if (mayFoldListParagraph(cursor, top, stack, depth)) {
      cursor.take()
      appendBody(top, markBelowColumnQuotedLiteral(top.body, line), 0, true)
      updateListFrameEnds(stack, line, listSpan)
      continue
    }
    if (reachedPrefix === undefined) {
      if (takeNestedFirstBlock(top, line)) continue
      const ancestor = deepestReachableFrame(stack, line.text, true)
      if (ancestor) {
        const lazy = finalNestedListLazyLine(cursor, top.body, stack.length)
        if (lazy === 'decline') {
          throw new UnsupportedCursorSyntax('nested list lazy paragraph owner')
        }
        if (lazy === 'fold') {
          cursor.take()
          appendBody(top, line, 0)
          updateListFrameEnds(stack, line, listSpan)
          continue
        }
        rejectListQuoteBoundary(top.body, line)
        while (stack.at(-1) !== ancestor) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.spanColumn)
        }
        continue
      }
      rejectListQuoteBoundary(top.body, line)
      releaseRootListFenceAtBoundary(top, cursor.owner, stack.length)
      break
    }
    const nestedDefinition = cursor.simpleRootListDefinitions?.get(line.number)
    if (nestedDefinition) {
      takeLinkDefinitionAtCursor(cursor, inline, definitionNodes, true, nestedDefinition)
      continue
    }
    const shiftedColon = stack.length === 1 && !top.fenceMarker &&
      !beginsOpenQuotedParagraph(top.body) ?
      shiftedClosedListColon(cursor, prefix.length) : undefined
    if (shiftedColon) {
      for (let count = 0; count < shiftedColon.count; count++) {
        const owned = cursor.take()
        appendBody(top, owned, shiftedColon.prefix)
        updateListFrameEnds(stack, owned, listSpan)
      }
      continue
    }
    let bodyPrefix = reachedPrefix
    if (top.fenceMarker && top.fencePrefix !== undefined && top.fencePrefix > bodyPrefix) {
      bodyPrefix = continuedListFencePrefix(top, line, bodyPrefix)
    } else if (shouldMatchShiftedListFence(top, line, bodyPrefix, stack.length)) {
      top.fenceMayDedent = cursor.owner.kind !== 'quote' && followsClosedListBlock(top.body)
      bodyPrefix = matchedShiftedFencePrefix(cursor, line.text, bodyPrefix, top.fenceMayDedent)
    }
    if (line.text[bodyPrefix] === ' ') {
      bodyPrefix = indentedListAttributePrefix(line.text, bodyPrefix)
    }
    if (consumeWrappedAttribute(top, bodyPrefix)) continue
    cursor.take()
    appendBody(top, line, bodyPrefix === reachedPrefix && !top.fenceMarker ?
      listContinuationPrefix(line.text, bodyPrefix, top.body, top.closedQuoteFence) : bodyPrefix)
    top.retainedBelowColumnComment = false
    updateListFrameEnds(stack, line, listSpan)
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!
    flush(frame)
    frame.list.pos = listSpan(frame.first, frame.last, frame.spanColumn)
  }
  return stack[0]!.list
}

function takeQuotedInlineCodeContinuation(cursor: Cursor, body: SourceLine[]): SourceLine[] | undefined {
  if (!cursor.owner.inList || body.length !== 1 || !plainQuoteText(body[0]!.text)) return undefined
  const opener = /^( +)(`{3,})[ \t]*$/.exec(cursor.peek()?.text ?? '')
  if (!opener) return undefined
  const prefix = opener[1]!
  let count = 1
  while (cursor.peek(count)?.text.startsWith(prefix)) {
    if (cursor.peek(count)!.text.slice(prefix.length).trimEnd() === opener[2]) {
      if (cursor.peek(count + 1) && !isBlankLine(cursor.peek(count + 1)!.text)) return undefined
      const lines: SourceLine[] = []
      for (let i = 0; i <= count; i++) lines.push(cursor.take())
      return lines
    }
    count++
  }
  return undefined
}

function takeDegradedQuoteLazyLine(cursor: Cursor, first: SourceLine,
  body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  if (!line?.lazyText || !line.text.startsWith('>') ||
      (line.baseColumn ?? 1) <= (first.baseColumn ?? 1) ||
      !openDegradedQuoteCommentParagraph(body, false)) return undefined
  const afterMarker = line.text.slice(line.text[1] === ' ' ? 2 : 1)
  if (rootLinkDef(afterMarker) || FOOTNOTE_DEF.test(afterMarker) || ABBR_DEF.test(afterMarker)) {
    throw new UnsupportedCursorSyntax('degraded quote definition owner')
  }
  return cursor.take()
}

function quoteChildrenAtCursor(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], depth: number, body: SourceLine[],
  directParagraph: boolean, boundaryFence = false): BlockNode[] {
  if (body.length > 0 && directParagraph) {
    const last = body.at(-1)!
    return [{ type: 'paragraph',
      children: inline.inlines(body.map((line) => ({ line, column: 1, text: line.text }))),
      pos: position(body[0]!, last, 1, last.text.replace(/[ \t]+$/, '').length + 1) }]
  }
  return parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner, 'quote', false,
    boundaryFence, boundaryFence ? cursor.peek() : undefined),
    cursor.physicalLines, cursor.simpleRootListDefinitions), inline, definitionNodes, depth + 1, false)
}

interface QuoteListOwnerFrame { column: number; fence: string | undefined }

class QuoteListOwner {
  readonly frames: QuoteListOwnerFrame[] = []
  releasedFence = false
  shiftedFence = false

  observe(text: string): boolean {
    if (text === '') return false
    let indent = 0
    while (text.charCodeAt(indent) === 32) indent++
    let released = false
    while (this.frames.length && indent < this.frames.at(-1)!.column) {
      const old = this.frames.pop()!
      released ||= old.fence !== undefined
      this.releasedFence ||= old.fence !== undefined
    }
    const top = this.frames.at(-1)
    const owned = top && indent >= top.column ? text.slice(top.column) : text
    if (top?.fence) {
      if (indent === top.column && closesFence(owned, top.fence)) top.fence = undefined
      return false
    }
    const marker = listMarker(text)
    if (marker && (!top || marker.indent >= top.column)) {
      const frame: QuoteListOwnerFrame = { column: marker.width,
        fence: fenceOpen(marker.content)?.marker }
      this.frames.push(frame)
      return false
    }
    if (top && indent > top.column && fenceOpen(text.slice(indent))) this.shiftedFence = true
    if (top && indent === top.column) top.fence = fenceOpen(owned)?.marker
    return released && !top && plainQuoteText(text)
  }

  get openFence(): boolean { return this.frames.some((frame) => frame.fence !== undefined) }
  get boundaryFence(): boolean { return !this.shiftedFence && (this.releasedFence || this.openFence) }
}

function observeQuoteListOwner(owner: QuoteListOwner | undefined, container: ContainerOwner,
  text: string, firstLine: boolean): { owner: QuoteListOwner | undefined; resumed: boolean } {
  if (!owner && firstLine && container.kind === 'root' &&
      (text[0] === '-' || text[0] === '*') && listMarker(text)?.indent === 0) {
    owner = new QuoteListOwner()
  }
  return { owner, resumed: !!owner?.observe(text) && !owner.shiftedFence }
}

function quotedParagraphText(text: string, plain: boolean): boolean {
  return plain || nestedQuoteParagraphText(text) || /^ (?:\[|\{)/.test(text) ||
    /^: +/.test(text) || /^:: +[^ ]/.test(text)
}

function quoteNeedsLazyBoundary(follower: string | undefined, last: string | undefined,
  wrappedAttributeTail: boolean, inlineCode: SourceLine[] | undefined): boolean {
  return mayContinueQuoteLazily(follower, last) && !wrappedAttributeTail || !!inlineCode
}

function takeQuoteFirstBlock(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], depth: number): BlockQuote | undefined {
  const first = cursor.peek()!
  if (first.text !== '> +') return undefined
  const markerLineNested = cursor.owner.kind === 'list' &&
    (depth === 1 || depth === 2 && cursor.owner.parent?.kind === 'quote')
  const nestedQuote = depth === 1 && cursor.owner.kind === 'quote'
  if (depth === 0 || markerLineNested || nestedQuote) {
    const fenceEnd = closedFenceEnd(cursor, 1)
    if (fenceEnd !== undefined &&
        (!cursor.peek(fenceEnd + 1) || isBlankLine(cursor.peek(fenceEnd + 1)!.text))) {
      cursor.take()
      const body: SourceLine[] = []
      for (let offset = 1; offset <= fenceEnd; offset++) body.push(cursor.take())
      const last = body.at(-1)!
      return { type: 'block_quote',
        children: parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner, 'quote'),
          cursor.physicalLines), inline, definitionNodes, depth + 1, false),
        pos: position(first, last, 1, contentEndColumn(last)) }
    }
  }
  if (!(depth === 0 || markerLineNested)) return undefined
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  if (!follower || !(plainQuoteText(follower.text) || RE_HEADING.test(follower.text) ||
      isTableRow(follower.text) || markerLineNested && RE_BLOCKQUOTE.test(follower.text)) ||
      after && !isBlankLine(after.text)) return undefined
  cursor.take()
  cursor.take()
  return { type: 'block_quote',
    children: parseBlocks(new Cursor([follower], undefined, childOwner(cursor.owner, 'quote'),
      cursor.physicalLines),
      inline, definitionNodes, depth + 1, false),
    pos: position(first, follower, 1, contentEndColumn(follower)) }
}

function parseQuote(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number): BlockQuote {
  const first = cursor.peek()!
  const firstBlock = takeQuoteFirstBlock(cursor, inline, definitionNodes, depth)
  if (firstBlock) return firstBlock
  const body: SourceLine[] = []
  let last = first
  let plainParagraph = true
  let directParagraph = true
  let unclosedFenceParagraph = false
  let quotedListRun = false
  let listOwner: QuoteListOwner | undefined
  while (cursor.peek()) {
    const line = cursor.peek()!
    if (depth === 0 && body.length === 1 && body[0]!.text === '> +') {
      const fenceEnd = closedFenceEnd(cursor)
      if (fenceEnd !== undefined &&
          (!cursor.peek(fenceEnd + 1) || isBlankLine(cursor.peek(fenceEnd + 1)!.text))) {
        for (let offset = 0; offset <= fenceEnd; offset++) {
          last = cursor.take()
          body.push(last)
        }
        directParagraph = false
        plainParagraph = false
        continue
      }
    }
    const degraded = takeDegradedQuoteLazyLine(cursor, first, body)
    if (degraded) {
      body.push(degraded)
      directParagraph = false
      last = degraded
      continue
    }
    if (!line.lazyText && line.text[0] === '>' && RE_BLOCKQUOTE.test(line.text)) {
      const prefix = line.text.startsWith('> ') ? 2 : 1
      const text = line.text.slice(prefix)
      const literalFence = quotedFenceStaysInParagraph(cursor, body,
        directParagraph, plainParagraph, text)
      if (literalFence) unclosedFenceParagraph = true
      quotedListRun = body.length === 0 && cursor.owner.kind === 'list' &&
        listMarker(text) !== undefined
      cursor.take()
      body.push({ text, start: line.start + prefix,
        number: line.number, baseColumn: (line.baseColumn ?? 1) + prefix })
      const plain: boolean = literalFence || plainQuoteText(text)
      const observed = observeQuoteListOwner(listOwner, cursor.owner, text, body.length === 1)
      listOwner = observed.owner
      directParagraph &&= plain
      plainParagraph = observed.resumed || plainParagraph && quotedParagraphText(text, plain)
      last = line
      continue
    }
    const unmarked = takeUnmarkedQuoteParagraphLine(cursor, body, unclosedFenceParagraph)
    if (unmarked) {
      last = unmarked
      continue
    }
    if (quotedListPlainFollower(cursor, body, line, quotedListRun)) {
      body.push(cursor.take())
      directParagraph = false
      plainParagraph = false
      last = line
      continue
    }
    if (quotedListSibling(cursor, body, line, quotedListRun)) {
      body.push(cursor.take())
      directParagraph = false
      plainParagraph = false
      last = line
      continue
    }
    if (quotedListFirstBlockFollower(cursor, body, line)) {
      body.push(cursor.take())
      directParagraph = false
      plainParagraph = false
      last = line
      continue
    }
    if (openColonRun(body, false) !== undefined && /^ +>/.test(line.text)) {
      const afterMarker = line.text.trimStart().replace(/^> ?/, '')
      if (rootLinkDef(afterMarker) || FOOTNOTE_DEF.test(afterMarker) || ABBR_DEF.test(afterMarker)) {
        throw new UnsupportedCursorSyntax('quoted colon definition owner')
      }
      const owned = cursor.take()
      const prefix = /^ +/.exec(owned.text)![0].length
      body.push({ text: owned.text.slice(prefix), start: owned.start + prefix,
        number: owned.number, baseColumn: (owned.baseColumn ?? 1) + prefix, lazyText: true })
      directParagraph = false
      last = owned
      continue
    }
    if (!cursor.owner.inList && line.text === '+' && body.length > 0 &&
        listMarker(cursor.peek(1)?.text ?? '')?.indent === 0 &&
        (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))) {
      const marker = cursor.take()
      body.push({ ...marker, text: '' })
      const attached = cursor.take()
      body.push(attached)
      last = attached
      plainParagraph = false
      directParagraph = false
      continue
    }
    const lazyColon = /^ +: +/.test(line.text) && body.at(-1)?.text.startsWith(': ')
    const refusedFirstBlock = (quoteEndsInPlus(body.at(-1)?.text ?? '') ||
      quoteListEndsInPlus(body.at(-1)?.text ?? '')) &&
      listMarker(line.text) !== undefined
    if (((!cursor.owner.inList || line.lazyText) && plainParagraph) || refusedFirstBlock) {
      if ((plainQuoteText(line.text) || listMarker(line.text) || lazyColon ||
          line.lazyText && (RE_HEADING.test(line.text) || RE_BLOCKQUOTE.test(line.text)) ||
          (line.text[0] === '>' && !RE_BLOCKQUOTE.test(line.text))) &&
          (lazyColon || refusedFirstBlock || line.lazyText &&
            (listMarker(line.text) || RE_HEADING.test(line.text) || RE_BLOCKQUOTE.test(line.text)) ||
            mayContinueQuoteLazily(line.text, body.at(-1)?.text))) {
        const lazyLine = cursor.take()
        body.push(listMarker(lazyLine.text) ? { ...lazyLine, lazyText: true } : lazyLine)
        directParagraph = false
        last = line
        continue
      }
    }
    break
  }
  if (body.at(-1)?.text.trim() === '+' && cursor.peek()?.text.startsWith('|')) {
    throw new UnsupportedCursorSyntax('quote continuation into table')
  }
  const wrappedAttributeTail = wrappedQuoteAttributeTail(body)
  const inlineCode = !wrappedAttributeTail && cursor.peek()?.text[0] === ' ' &&
    cursor.peek()!.text.includes('`') ? takeQuotedInlineCodeContinuation(cursor, body) : undefined
  if (quoteNeedsLazyBoundary(cursor.peek()?.text, body.at(-1)?.text,
    !!wrappedAttributeTail, inlineCode)) {
    if (!inlineCode && !(listOwner?.openFence && !listOwner.shiftedFence)) {
      throw new UnsupportedCursorSyntax('lazy quote continuation')
    }
    if (inlineCode) {
      body.push(...inlineCode)
      directParagraph = false
      last = inlineCode.at(-1)!
    }
  }
  const children = quoteChildrenAtCursor(cursor, inline, definitionNodes, depth, body,
    directParagraph, listOwner?.boundaryFence)
  const onlyLinkDefinition = children.length === 0 && body.length === 1 &&
    rootLinkDef(body[0]!.text) !== null
  const placedEndLine = children.at(-1)?.pos?.endLine
  const quoteLast = placedEndLine && placedEndLine < last.number ?
    cursor.physicalLines[placedEndLine - 1] ?? last : last
  return { type: 'block_quote', children,
    pos: position(first, quoteLast, 1, onlyLinkDefinition ?
      body[0]!.baseColumn ?? contentEndColumn(quoteLast) : contentEndColumn(quoteLast)) }
}

function takeColonBody(cursor: Cursor, openerLength: number): SourceLine[] {
  const body: SourceLine[] = []
  const closer = new RegExp(`^:{${openerLength}}[ \t]*$`)
  const nestedClosers: RegExp[] = []
  while (cursor.peek()) {
    const text = cursor.peek()!.text
    if ((nestedClosers.at(-1) ?? closer).test(text)) {
      if (nestedClosers.length === 0) break
      nestedClosers.pop()
      body.push(cursor.take())
      continue
    }
    const nested = COLON_OPEN.exec(text) ?? RE_LINE_BLOCK_OPEN.exec(text)
    if (nested) {
      if (nested[2] === 'figure' || nested[2] === 'list-table') {
        throw new UnsupportedCursorSyntax('nested specialized colon container')
      }
      nestedClosers.push(new RegExp(`^:{${nested[1]!.length}}[ \t]*$`))
    } else if (text.startsWith(':::')) throw new UnsupportedCursorSyntax('nested colon container')
    body.push(cursor.take())
  }
  if (!cursor.peek() && body.some((line) => RE_FENCE.test(line.text))) {
    throw new UnsupportedCursorSyntax('unclosed colon literal ownership')
  }
  return body
}

function boundedColonFence(body: SourceLine[], cursor: Cursor, run: number): SourceLine | undefined {
  const first = body[0]
  const opener = first && fenceOpen(first.text)
  const boundary = cursor.peek()
  if (!opener || !boundary || !new RegExp(`^:{${run}}[ \t]*$`).test(boundary.text)) return undefined
  for (let i = 1; i < body.length; i++) {
    if (closesFence(body[i]!.text, opener.marker)) return undefined
  }
  return boundary
}

function boundedQuoteFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  if (cursor.owner.kind !== 'quote' || cursor.lines[0]?.number !== first.number) return false
  const firstPayload = payload[0]
  const next = cursor.physicalLines[(payload.at(-1) ?? first).number]
  if (firstPayload && cursor.owner.parent?.kind === 'list' &&
      cursor.owner.parent.parent?.kind === 'root' &&
      cursor.owner.listRootPrefix !== undefined && next &&
      new RegExp(`^ {${cursor.owner.listRootPrefix + 2},}>`).test(next.text)) return true
  if (!firstPayload) {
    return !next || next.text !== '' && next.text[0] !== ' ' && next.text[0] !== '>'
  }
  const column = firstPayload.baseColumn ?? 1
  if (column >= (first.baseColumn ?? 1) ||
      payload.some((line) => (line.baseColumn ?? 1) < column)) return false
  return !next || !plainQuoteText(next.text)
}

function boundedListFence(cursor: Cursor, first: SourceLine, payload: SourceLine[], marker: string): boolean {
  if (cursor.owner.kind !== 'list' || cursor.owner.listRootPrefix === undefined) return false
  const index = cursor.lines.findIndex((line) => line.number === first.number)
  if (index <= 0 || cursor.lines[index - 1]?.text !== '') return false
  const next = cursor.physicalLines[(payload.at(-1) ?? first).number]
  if (!next || !closesFence(next.text.trimStart(), marker)) return false
  const indent = /^ */.exec(next.text)![0].length
  return indent <= cursor.owner.listRootPrefix
}

function boundedListEofFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  const last = payload.at(-1)
  return cursor.owner.kind === 'list' && cursor.lines[0]?.number === first.number &&
    last?.text === '' && last.number === cursor.physicalLines.at(-1)?.number
}

function takeFenceCloseAtCursor(cursor: Cursor, first: SourceLine, payload: SourceLine[]): SourceLine {
  if (cursor.peek()) return cursor.take()
  const marker = fenceOpen(first.text)?.marker
  if (marker && (cursor.owner.allowUnclosedFence || boundedQuoteFence(cursor, first, payload) ||
      boundedListFence(cursor, first, payload, marker) ||
      boundedListEofFence(cursor, first, payload)) &&
      !payload.some((line) => closesFence(line.text.trimStart(), marker))) {
    const last = payload.at(-1)
    return cursor.owner.fenceBoundary && last && isBlankLine(last.text) ?
      { ...cursor.owner.fenceBoundary, text: '' } : last ?? first
  }
  if (cursor.owner.allowEmptyFence && payload.length === 0 &&
      /^(?:`{3,}|~{3,})$/.test(first.text)) return first
  if (cursor.owner.kind === 'root' && /^(?:`{3,}|~{3,})$/.test(first.text) &&
      (first.number === 1 || isBlankLine(cursor.lines[first.number - 2]?.text))) {
    return payload.at(-1) ?? first
  }
  throw new UnsupportedCursorSyntax('unclosed fence')
}

function footnotePlainColumn(line: SourceLine): number {
  return /^[ \t]*/.exec(line.text)![0].length + 1
}

function simpleFootnoteParagraphLine(line: SourceLine | undefined, allowList = false): boolean {
  if (!line) return false
  const prefix = footnotePlainColumn(line) - 1
  if (sourceColumnAt(line.text, prefix) < 2) return false
  const content = line.text.slice(prefix)
  return plainQuoteText(content) ||
    allowList && !(line.text[0] === '\t' && content[0] === ' ') && listMarker(content) !== undefined ||
    ((content[0] === '*' || content[0] === '_' || content[0] === '`') && !isBlockStart(content))
}

function simpleFootnoteStructuralLines(cursor: Cursor, nextIndex: number):
  { source: SourceLine[]; body: SourceLine[] } | undefined {
  const first = cursor.peek(nextIndex)
  if (!first?.text.startsWith('  ')) return undefined
  const firstIndent = /^[ ]*/.exec(first.text)![0].length
  const firstText = first.text.slice(firstIndent)
  const heading = RE_HEADING.test(firstText)
  const quote = RE_BLOCKQUOTE.test(firstText)
  const fence = fenceOpen(firstText)?.marker ?? RE_RAW_FENCE.exec(firstText)?.[1]
  const table = firstText[0] === '|' && isTableRow(firstText)
  const list = listMarker(firstText)
  if (list && nextIndex === 1) return undefined
  const attrs = firstText[0] === '{' && parseBlockAttributeRun(firstText)
  const comment = LINE_COMMENT.test(firstText)
  if (!heading && !quote && !fence && !table && !list && !attrs && !comment) return undefined
  const source = [first]
  const body: SourceLine[] = [{ text: firstText, start: first.start + firstIndent, number: first.number,
    baseColumn: (first.baseColumn ?? 1) + firstIndent }]
  const second = cursor.peek(nextIndex + 1)
  if ((quote || attrs) && second?.text.startsWith('  ')) {
    const indent = /^[ ]*/.exec(second.text)![0].length
    const text = second.text.slice(indent)
    if ((quote && (plainQuoteText(text) ||
        (indent === firstIndent && RE_HEADING.test(text)))) ||
        (attrs && indent === firstIndent && plainQuoteText(text))) {
      source.push(second)
      body.push({ text, start: second.start + indent, number: second.number,
        baseColumn: (second.baseColumn ?? 1) + indent })
    }
  }
  if (fence) {
    let closed = false
    for (let offset = nextIndex + 1; cursor.peek(offset); offset++) {
      const line = cursor.peek(offset)!
      if (!line.text.startsWith(' '.repeat(firstIndent))) return undefined
      const text = line.text.slice(firstIndent)
      source.push(line)
      body.push({ text, start: line.start + firstIndent, number: line.number,
        baseColumn: (line.baseColumn ?? 1) + firstIndent })
      if (closesFence(text, fence)) { closed = true; break }
    }
    if (!closed) return undefined
  } else if (table) {
    for (let offset = nextIndex + 1; cursor.peek(offset); offset++) {
      const line = cursor.peek(offset)!
      if (!line.text.startsWith(' '.repeat(firstIndent))) break
      const text = line.text.slice(firstIndent)
      if (!isTableRow(text)) break
      source.push(line)
      body.push({ text, start: line.start + firstIndent, number: line.number,
        baseColumn: (line.baseColumn ?? 1) + firstIndent })
    }
  } else if (comment) {
    const opener = RE_COMMENT_BLOCK_ANY.exec(firstText)
    if (opener) {
      let closed = false
      for (let offset = nextIndex + 1; cursor.peek(offset); offset++) {
        const line = cursor.peek(offset)!
        if (!line.text.startsWith(' '.repeat(firstIndent))) return undefined
        const text = line.text.slice(firstIndent)
        source.push(line)
        body.push({ text, start: line.start + firstIndent, number: line.number,
          baseColumn: (line.baseColumn ?? 1) + firstIndent })
        if (RE_COMMENT_BLOCK_ANY.exec(text)?.[1]?.length === opener[1]!.length) {
          closed = true
          break
        }
      }
      if (!closed) return undefined
    }
    const trailing = cursor.peek(nextIndex + source.length)
    const afterTrailing = cursor.peek(nextIndex + source.length + 1)
    if (trailing?.text.startsWith(' '.repeat(firstIndent)) &&
        plainQuoteText(trailing.text.slice(firstIndent)) &&
        (!afterTrailing || isBlankLine(afterTrailing.text))) {
      source.push(trailing)
      body.push({ text: trailing.text.slice(firstIndent), start: trailing.start + firstIndent,
        number: trailing.number, baseColumn: (trailing.baseColumn ?? 1) + firstIndent })
    }
  }
  if (table) {
    let offset = nextIndex + source.length
    let blanks = 0
    while (cursor.peek(offset + blanks)?.text === '') blanks++
    const trailing = cursor.peek(offset + blanks)
    const afterTrailing = cursor.peek(offset + blanks + 1)
    if (blanks > 0 && trailing?.text.startsWith(' '.repeat(firstIndent)) &&
        plainQuoteText(trailing.text.trimStart()) &&
        (!afterTrailing || isBlankLine(afterTrailing.text))) {
      for (let i = 0; i < blanks; i++) {
        const blank = cursor.peek(offset + i)!
        source.push(blank)
        body.push(blank)
      }
      source.push(trailing)
      body.push({ text: trailing.text.slice(firstIndent), start: trailing.start + firstIndent,
        number: trailing.number, baseColumn: (trailing.baseColumn ?? 1) + firstIndent })
    }
  } else if (list) {
    let offset = nextIndex + source.length
    let blanks = 0
    while (cursor.peek(offset + blanks)?.text === '') blanks++
    const trailing = cursor.peek(offset + blanks)
    const afterTrailing = cursor.peek(offset + blanks + 1)
    if (blanks > 0 && trailing?.text.startsWith(' '.repeat(firstIndent + 2)) &&
        RE_BLOCKQUOTE.test(trailing.text.slice(firstIndent + 2)) &&
        (!afterTrailing || isBlankLine(afterTrailing.text))) {
      for (let i = 0; i < blanks; i++) {
        const blank = cursor.peek(offset + i)!
        source.push(blank)
        body.push(blank)
      }
      source.push(trailing)
      body.push({ text: trailing.text.slice(firstIndent), start: trailing.start + firstIndent,
        number: trailing.number, baseColumn: (trailing.baseColumn ?? 1) + firstIndent })
    }
  }
  const after = cursor.peek(nextIndex + source.length)
  if (after && isBlankLine(after.text)) {
    let offset = nextIndex + source.length
    while (cursor.peek(offset) && isBlankLine(cursor.peek(offset)!.text)) offset++
    if (cursor.peek(offset)?.text.startsWith('  ')) return undefined
  }
  return !after || isBlankLine(after.text) ? { source, body } : undefined
}

function takeFootnoteFirstFence(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  if (footnote[2] !== '+' || cursor.owner.kind !== 'root' || !footnoteDefs || !footnoteDefPos) {
    return false
  }
  const end = closedFenceEnd(cursor, 1)
  if (end === undefined || cursor.peek(end + 1) && !isBlankLine(cursor.peek(end + 1)!.text)) {
    return false
  }
  cursor.take()
  const body: SourceLine[] = []
  for (let offset = 1; offset <= end; offset++) body.push(cursor.take())
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: blocks,
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, body.at(-1)!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteAttachedBlock(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (!content || !plainQuoteText(content) || cursor.owner.kind !== 'root' ||
      !footnoteDefs || !footnoteDefPos || cursor.peek(1)?.text !== '+') return false
  const end = closedFenceEnd(cursor, 2) ??
    (listMarker(cursor.peek(2)?.text ?? '') ? 2 : undefined)
  if (end === undefined || cursor.peek(end + 1) && !isBlankLine(cursor.peek(end + 1)!.text)) {
    return false
  }
  cursor.take()
  cursor.take()
  const body: SourceLine[] = []
  for (let offset = 2; offset <= end; offset++) body.push(cursor.take())
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const column = first.text.length - content.length + 1
  const paragraph: Paragraph = { type: 'paragraph',
    children: inline.inlines([{ line: first, column, text: content }]),
    pos: position(first, first, column) }
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: [paragraph, ...blocks],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, body.at(-1)!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeSimpleFootnote(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): void {
  if (takeFootnoteFirstFence(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  if (takeFootnoteAttachedBlock(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  let nextIndex = 1
  while (cursor.peek(nextIndex)?.text === '') nextIndex++
  const next = cursor.peek(nextIndex)?.text
  const hasBodyLine = next !== undefined &&
    sourceColumnAt(next, /^[ \t]*/.exec(next)![0].length) >= 2
  const separated = hasBodyLine && nextIndex > 1
  const structural = hasBodyLine ? simpleFootnoteStructuralLines(cursor, nextIndex) : undefined
  let bodyLength = 0
  if (hasBodyLine && !structural) {
    while (simpleFootnoteParagraphLine(cursor.peek(nextIndex + bodyLength), !separated)) bodyLength++
  }
  const initialQuote = footnote[2] !== undefined && RE_BLOCKQUOTE.test(footnote[2])
  if (!footnote[2] || initialQuote && hasBodyLine && !separated ||
      (footnote[2] !== '{empty}' && isBlockStart(footnote[2]) && !initialQuote) ||
      (hasBodyLine && (footnote[2] === '{empty}' ||
      (bodyLength === 0 && !structural) ||
      (!structural && cursor.peek(nextIndex + bodyLength) &&
        cursor.peek(nextIndex + bodyLength)!.text !== '')))) {
    throw new UnsupportedCursorSyntax('nested or multiline footnote definition')
  }
  cursor.take()
  if (separated) for (let i = 1; i < nextIndex; i++) cursor.take()
  const continuation: SourceLine[] = []
  for (let i = 0; i < bodyLength; i++) continuation.push(cursor.take())
  if (structural) for (let i = 0; i < structural.source.length; i++) cursor.take()
  const plusFollower = cursor.peek()?.text === '+' ? cursor.peek(1) : undefined
  if (footnote[2] === '{empty}' && plusFollower) {
    throw new UnsupportedCursorSyntax('empty footnote continuation')
  }
  const attached = plusFollower && plainQuoteText(plusFollower.text) &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text)) ? plusFollower : undefined
  if (attached) { cursor.take(); cursor.take() }
  const label = footnote[1]!
  if (!footnoteDefs || !footnoteDefPos || Object.hasOwn(footnoteDefs, label)) return
  const bodyIndent = /^[ \t]*/.exec(footnote[2]!)![0].length
  const column = first.text.length - footnote[2]!.length + bodyIndent + 1
  const parts: ContentLine[] = [{ line: first, column, text: footnote[2]!.slice(bodyIndent) }]
  if (!separated) for (const line of continuation) {
    const nextColumn = footnotePlainColumn(line)
    parts.push({ line, column: nextColumn, text: line.text.slice(nextColumn - 1) })
  }
  const bodyLast = structural?.source.at(-1) ?? continuation.at(-1) ?? first
  const last = attached ?? bodyLast
  const initialBody: BlockNode[] = initialQuote ? parseBlocks(new Cursor([{
    text: footnote[2]!.slice(bodyIndent), start: first.start + column - 1,
    number: first.number, baseColumn: column }], undefined,
  childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false) : [{
    type: 'paragraph', children: inline.inlines(parts),
    pos: position(first, separated || structural ? first : bodyLast, column) }]
  const separateBody: Paragraph | undefined = separated && continuation.length ? { type: 'paragraph',
    children: inline.inlines(continuation.map((line) => {
      const nextColumn = footnotePlainColumn(line)
      return { line, column: nextColumn, text: line.text.slice(nextColumn - 1) }
    })),
    pos: position(continuation[0]!, continuation.at(-1)!,
      footnotePlainColumn(continuation[0]!)) } : undefined
  const attachedBody: Paragraph | undefined = attached ? { type: 'paragraph',
    children: inline.inlines([{ line: attached, column: 1, text: attached.text }]),
    pos: position(attached, attached) } : undefined
  const structuralBody = structural ? parseBlocks(new Cursor(structural.body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false) : []
  Object.defineProperty(footnoteDefs, label, { value: footnote[2] === '{empty}' ? [] :
    attachedBody ? separateBody ? [...initialBody, separateBody, ...structuralBody, attachedBody] :
      [...initialBody, ...structuralBody, attachedBody] :
      separateBody ? [...initialBody, separateBody, ...structuralBody] : [...initialBody, ...structuralBody],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, last),
    enumerable: true, configurable: true, writable: true })
}

function matchSigilFence(line: string): { kind: 'hardbreak' | 'quote'; width: number } | undefined {
  const hardbreak = RE_HARDBREAKS_OPEN.exec(line)
  if (hardbreak) return { kind: 'hardbreak', width: hardbreak[1]!.length }
  const quote = RE_QUOTE_BLOCK_OPEN.exec(line)
  return quote ? { kind: 'quote', width: quote[1]!.length } : undefined
}

function parseSigilFence(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[],
  depth: number, sigil: NonNullable<ReturnType<typeof matchSigilFence>>): BlockNode {
  const first = cursor.take()
  const body = takeColonBody(cursor, sigil.width)
  const close = cursor.peek() ? cursor.take() : body.at(-1) ?? first
  const inner = parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner,
    sigil.kind === 'quote' ? 'quote' : 'colon'), cursor.physicalLines),
    inline, definitionNodes, depth + 1, false)
  if (sigil.kind === 'hardbreak') {
    for (const child of inner) {
      if (child.type !== 'paragraph') continue
      child.children = child.children.map((node) => node.type === 'soft_break' ?
        { type: 'hard_break', ...(node.pos ? { pos: node.pos } : {}) } : node)
    }
    return { type: 'div', attrs: { classes: ['hardbreaks'], order: ['.class'] },
      children: inner, pos: position(first, close) }
  }
  const quote: BlockQuote = { type: 'block_quote', fenced: true,
    children: inner, pos: position(first, close) }
  const caption = takeQuoteCaption(cursor, inline, quote)
  return caption ? { type: 'figure', target: quote, caption: caption.children,
    pos: position(first, caption.line) } : quote
}

function takeBlockAttrsAtCursor(cursor: Cursor, atDocumentLevel: boolean): Attrs | null {
  const first = cursor.peek()!
  if (first.text[0] !== '{') return null
  const oneLine = parseBlockAttributeRun(first.text)
  if (oneLine) { cursor.take(); return oneLine }
  if (!atDocumentLevel && !first.wrappedAttr) return null
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const wrapped = probeBlockAttributes(lexer)
  if (!wrapped) return null
  for (let i = 0; i < wrapped.count; i++) cursor.take()
  return wrapped.attrs
}

function simpleClosedListColon(cursor: Cursor, run: string, kind: string | undefined): boolean {
  if (cursor.owner.kind !== 'list') return false
  const body = cursor.peek(1)?.text
  const close = cursor.peek(2)?.text
  if (body !== undefined && plainQuoteText(body) && close === undefined) {
    const following = cursor.physicalLines[cursor.peek(1)!.number]
    if (!following || isBlankLine(following.text)) return true
  }
  const closer = new RegExp(`^:{${run.length}}[ \\t]*$`)
  if (body !== undefined && closer.test(body) &&
      (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))) return true
  if (body !== undefined && (plainQuoteText(body) || kind === 'html' && body[0] === '<') &&
      close !== undefined &&
      closer.test(close) && (!cursor.peek(3) || isBlankLine(cursor.peek(3)!.text))) return true
  if (!listMarker(body ?? '')) return false
  for (let offset = 1; cursor.peek(offset); offset++) {
    const text = cursor.peek(offset)!.text
    if (closer.test(text)) return !cursor.peek(offset + 1) ||
      isBlankLine(cursor.peek(offset + 1)!.text)
    if (!listMarker(text)) return false
  }
  return false
}

function takeLinkDefinitionAtCursor(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], atDocumentLevel: boolean,
  definition: NonNullable<ReturnType<typeof rootLinkDef>>): void {
  const first = cursor.peek()!
  if (!atDocumentLevel && !(cursor.owner.kind === 'quote' &&
      cursor.owner.parent?.kind === 'root' && cursor.at === 0)) {
    throw new UnsupportedCursorSyntax('nested link definition')
  }
  cursor.take()
  if (inline.linkDefinitions.get(normalizeRefLabel(definition.label))?.line !== first.number - 1) return
  const definitionLine = atDocumentLevel && cursor.owner.kind === 'root' ? first :
    cursor.physicalLines[first.number - 1] ?? first
  definitionNodes.push({ type: 'link_reference_definition', label: definition.label, href: definition.href,
    ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
    ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}),
    pos: position(definitionLine, definitionLine) })
}

function parseBlocks(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[],
  depth = 0, atDocumentLevel = true, footnoteDefs?: Record<string, BlockNode[]>,
  footnoteDefPos?: Record<string, Position>, commentOpeners?: Set<number>,
  colonDepth = 0): BlockNode[] {
  if (depth >= MAX_NESTING_DEPTH) throw new UnsupportedCursorSyntax('container nesting limit')
  const children: BlockNode[] = []
  let pendingAttrs: Attrs | null = null
  const emit = (input: BlockNode) => {
    let node = input
    if (node.type !== 'comment' && node.type !== 'abbreviation_def' && pendingAttrs) {
      node.attrs = mergeAttrs(pendingAttrs, node.attrs ?? {})
      pendingAttrs = null
    }
    const code = node.type === 'code_block' ? node :
      node.type === 'figure' && node.target.type === 'code_block' ? node.target : undefined
    if (code && node.attrs?.keyValues?.table === '') {
      const table = delimitedTable(code, node.attrs)
      if (table) {
        if (node.type === 'figure') {
          table.caption = node.caption
          if (node.pos) table.pos = node.pos
        }
        node = table
      }
    }
    if (code?.header !== undefined && node.attrs?.keyValues?.title === undefined &&
        code.attrs?.keyValues?.title === undefined) {
      code.attrs = { ...(code.attrs ?? {}),
        keyValues: { ...(code.attrs?.keyValues ?? {}), title: code.header } }
    }
    if (node.type === 'table') deriveTableMetadata(node)
    consumeLooseKey(node)
    children.push(node)
  }
  while (cursor.peek()) {
    const first = cursor.peek()!
    if (isBlankLine(first.text)) { cursor.take(); continue }
    if (first.lazyText) { emit(parseParagraphAtCursor(cursor, inline)); continue }
    const attrs = takeBlockAttrsAtCursor(cursor, atDocumentLevel)
    if (attrs) {
      pendingAttrs = pendingAttrs ? mergeAttrs(pendingAttrs, attrs) : attrs
      continue
    }
    const footnote = FOOTNOTE_DEF.exec(first.text)
    if (footnote) {
      if (!footnoteDefs || !footnoteDefPos) {
        throw new UnsupportedCursorSyntax('nested or multiline footnote definition')
      }
      takeSimpleFootnote(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)
      continue
    }
    const definition = rootLinkDef(first.text)
    if (definition) {
      takeLinkDefinitionAtCursor(cursor, inline, definitionNodes, atDocumentLevel, definition)
      continue
    }
    const abbreviation = ABBR_DEF.exec(first.text)
    if (abbreviation && atDocumentLevel) {
      cursor.take()
      emit({ type: 'abbreviation_def', abbr: abbreviation[1]!,
        expansion: dropTrailingWhitespace(abbreviation[2]!), pos: position(first, first) })
      continue
    }
    const commentFence = RE_COMMENT_BLOCK_ANY.exec(first.text)
    if (commentFence) {
      if (!atDocumentLevel) {
        const comment = parseNestedCommentAtCursor(cursor, commentFence[1]!.length)
        if (comment) { emit(comment); continue }
      }
      if (first.text[0] !== '%') throw new UnsupportedCursorSyntax('nested block comment')
      if (commentOpeners?.has(first.start)) {
        cursor.take()
        const content: string[] = []
        const openerTail = trimNonNbsp(commentFence[2]!)
        if (openerTail) content.push(openerTail)
        while (cursor.peek()) {
          const closer = RE_COMMENT_BLOCK_ANY.exec(cursor.peek()!.text)
          if (closer?.[1]?.length === commentFence[1]!.length) break
          content.push(cursor.take().text)
        }
        const close = cursor.take()
        emit({ type: 'comment', block: true, content: content.join('\n'), pos: position(first, close) })
        continue
      }
    }
    if (LINE_COMMENT.test(first.text)) {
      if (ambiguousDegradedComment(cursor, first, atDocumentLevel,
        children.at(-1)?.type === 'list')) {
        throw new UnsupportedCursorSyntax('nested degraded block comment')
      }
      cursor.take()
      emit({ type: 'comment', block: false, content: commentLineContent(first.text),
        pos: position(first, first, /^[ \t]*/.exec(first.text)![0].length + 1) })
      continue
    }
    const heading = first.text[0] === '#' ? RE_HEADING.exec(first.text) : null
    if (heading) {
      cursor.take()
      const column = /^#{1,6} +/.exec(first.text)![0].length + 1
      emit({ type: 'heading', level: heading[1]!.length as HeadingLevel,
        children: inline.inlines([{ line: first, column,
          text: heading[3] ? first.text.slice(column - 1) : heading[2]! }]),
        pos: position(first, first, 1, contentEndColumn(first)) })
      continue
    }
    if (BREAK.test(first.text)) {
      cursor.take()
      emit({ type: 'thematic_break',
        ...(first.text[0] === '-' ? {} : { marker: first.text[0] as '*' | '_' }),
        pos: position(first, first) })
      continue
    }
    if (RE_RAW_FENCE.test(first.text)) {
      emit(parseRawAtCursor(cursor))
      continue
    }
    if (RE_LINE_BLOCK_OPEN.test(first.text)) {
      emit(parseLineBlockAtCursor(cursor, inline))
      continue
    }
    const fence = fenceOpen(first.text)
    if (fence) {
      cursor.take()
      const payload: string[] = []
      const payloadLines: SourceLine[] = []
      while (cursor.peek() && !closesFence(cursor.peek()!.text, fence.marker)) {
        const line = cursor.take()
        payload.push(line.text)
        payloadLines.push(line)
      }
      const close = takeFenceCloseAtCursor(cursor, first, payloadLines)
      const block: CodeBlock = { type: 'code_block', content: payload.length ? payload.join('\n') + '\n' : '',
        ...(fence.lang ? { lang: fence.lang } : {}),
        ...(fence.header !== undefined ? { header: fence.header } : {}),
        ...(fence.label !== undefined ? { label: fence.label } : {}),
        pos: position(first, close) }
      if (fence.lang === 'csv' || fence.lang === 'tsv') {
        setDelimitedPayloadLines(block, payloadLines.map((line) => ({
          offset: line.start, line: line.number,
          column: line.baseColumn ?? 1, text: line.text,
        })))
      }
      const caption = takeCaption(cursor, inline)
      emit(caption ? { type: 'figure', target: block, caption: caption.children,
        pos: position(first, caption.line) } : block)
      continue
    }
    if (first.text[0] === '>' && RE_BLOCKQUOTE.test(first.text)) {
      const quote = parseQuote(cursor, inline, definitionNodes, depth)
      const caption = takeQuoteCaption(cursor, inline, quote)
      emit(caption ? { type: 'figure', target: quote, caption: caption.children,
        pos: position(first, caption.line) } : quote)
      continue
    }
    if (first.text[0] === '|' && isTableRow(first.text)) {
      const table = parseTableAtCursor(cursor, inline)
      const caption = takeCaption(cursor, inline)
      if (caption) {
        table.caption = caption.children
        table.pos = position(first, caption.line)
      }
      emit(table)
      continue
    }
    const firstMarker = listMarker(first.text)
    if (firstMarker) {
      emit(parseList(cursor, inline, definitionNodes, depth, first, firstMarker))
      continue
    }
    const sigilFence = matchSigilFence(first.text)
    if (sigilFence) {
      emit(parseSigilFence(cursor, inline, definitionNodes, depth, sigilFence))
      continue
    }
    const simpleColon = COLON_OPEN.exec(first.text)
    const colon = simpleColon ??
      (first.text.includes('\t') ? RE_ADMONITION_OPEN.exec(first.text) : null)
    if (colon) {
      const figureGroup = isFigureGroupOpener(first.text, !!cursor.owner.inFigureGroup)
      const emptyBareDefinition = cursor.owner.kind === 'definition' &&
        colon[2] === undefined && cursor.peek(1) === undefined
      if ((!atDocumentLevel && colonDepth === 0 && cursor.owner.kind !== 'quote' &&
          !simpleClosedListColon(cursor, colon[1]!, colon[2]) && !emptyBareDefinition) ||
          unsupportedReferencesColon(colon)) {
        throw new UnsupportedCursorSyntax('nested or specialized colon container')
      }
      cursor.take()
      const body = takeColonBody(cursor, colon[1]!.length)
      const boundary = boundedColonFence(body, cursor, colon[1]!.length)
      if (colon[2] === undefined && body.some((line) => ABBR_DEF.test(line.text))) {
        throw new UnsupportedCursorSyntax('abbreviation inside bare container')
      }
      const close = cursor.peek() ? cursor.take() : body.at(-1) ?? first
      const owner = childOwner(cursor.owner, 'colon', false, boundary !== undefined, boundary)
      const children = parseBlocks(new Cursor(body, undefined,
        figureGroupOwner(owner, figureGroup),
        cursor.physicalLines),
        inline, definitionNodes, depth + 1, false,
        footnoteDefs, footnoteDefPos, undefined, colonDepth + 1)
      if (figureGroup) {
        const caption = takeCaption(cursor, inline)
        emit({ type: 'figure_group', children,
          ...(caption ? { caption: caption.children } : {}),
          pos: position(first, caption?.line ?? close) })
        continue
      }
      const kind = colon[2]
      const pos = position(first, close)
      if (colon[3] && kind === undefined) throw new UnsupportedCursorSyntax('bare div title')
      if (colon[4] && kind && GENERATED_CONTENT_KINDS.has(kind)) {
        throw new UnsupportedCursorSyntax('directive label')
      }
      const titleText = simpleColon ? colon[3] : colon[3]?.slice(1, -1)
      const title = titleText ? inline.inlines([{ line: first,
        column: first.text.indexOf('"') + 2, text: titleText }]) : undefined
      const label = simpleColon ? colon[4] : colon[4]?.slice(1, -1)
      const node: BlockNode = kind === undefined ? { type: 'div', children,
        ...(label ? { label } : {}), pos } :
        GENERATED_CONTENT_KINDS.has(kind) ?
          { type: 'directive', kind, children, ...(title ? { title } : {}), pos } :
          { type: 'admonition', kind, children, ...(title ? { title } : {}),
            ...(label ? { label } : {}), pos }
      emit(node)
      continue
    }
    if (/^:: +[ \t]*[^ \t]/.test(first.text) &&
        (atDocumentLevel || (cursor.owner.kind === 'quote' && !cursor.owner.inList))) {
      emit(parseSimpleDefinitionList(cursor, inline, commentOpeners))
      continue
    }
    if (/^::[ \t]*$/.test(first.text)) {
      emit(parseParagraphAtCursor(cursor, inline))
      continue
    }
    if (/^:{3,}>/.test(first.text)) {
      emit(parseParagraphAtCursor(cursor, inline))
      continue
    }
    if (/^(?::::|::)/.test(first.text) && !/^:{3,}(?: *\t| +\{)/.test(first.text)) {
      throw new UnsupportedCursorSyntax(`block at line ${first.number}`)
    }
    emit(parseParagraphAtCursor(cursor, inline))
  }
  return children
}

export function parseCursorPrototype(source: string, opts: ParseOptions = {}): Document {
  if (opts.extensions?.some((extension) => extension.matchInline || extension.matchBlock ||
      extension.quoteCharacters) || opts.onUnclosedContainer || opts.onUnclosedCodeFence ||
      opts.onRefusedContinuationMarker || opts.onInvalidContainerMetadata ||
      opts.onDanglingBlockAttributes) {
    throw new UnsupportedCursorSyntax('parser options and callbacks are not migrated')
  }
  const rawSource = source
  const rawByteLength = utf8ByteLength(source)
  const strippedBom = source.charCodeAt(0) === 0xfeff
  if (strippedBom) source = source.slice(1)
  if (source.includes('\0')) source = source.replace(/\0/g, '�')
  source = replaceLoneSurrogates(source)
  const lines = scanLines(source)
  if (strippedBom) for (let i = 0; i < lines.length; i++) {
    lines[i]!.start++
    if (i === 0) lines[i]!.baseColumn = 2
  }
  const cursor = new Cursor(lines, source)
  const commentOpeners = source.includes('%%%') ? commentOpenersWithCloser(cursor.lines) : new Set<number>()
  const linkDefinitions = new Map<string, LinkDef>()
  const abbreviations = new Map<string, string>()
  let openFence: string | undefined
  let openComment: number | undefined
  let simpleRootListPrefix: string | undefined
  let simpleQuoteListPrefix: string | undefined
  const hasDefinitionMarker = source.includes(']:')
  const mayHaveNestedListDefinition = hasDefinitionMarker &&
    (source.includes('  [') || source.includes('>   ['))
  const simpleRootListDefinitions = mayHaveNestedListDefinition ?
    new Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>() : undefined
  if (hasDefinitionMarker) {
    for (const line of cursor.lines) {
      if (mayHaveNestedListDefinition && !openFence && openComment === undefined) {
        const marker = listMarker(line.text)
        if (marker?.indent === 0) simpleRootListPrefix = ' '.repeat(marker.width)
        else if (line.text !== '' && simpleRootListPrefix &&
            !line.text.startsWith(simpleRootListPrefix)) simpleRootListPrefix = undefined
        else if (simpleRootListPrefix && line.text.startsWith(simpleRootListPrefix) &&
            (line.text.startsWith(simpleRootListPrefix + '  ') ||
             isBlockStart(line.text.slice(simpleRootListPrefix.length)) &&
             !rootLinkDef(line.text.slice(simpleRootListPrefix.length)))) {
          simpleRootListPrefix = undefined
        }
        const quoteMarker = line.text.startsWith('> ') ? listMarker(line.text.slice(2)) : undefined
        if (quoteMarker?.indent === 0) simpleQuoteListPrefix = '> ' + ' '.repeat(quoteMarker.width)
        else if (line.text !== '> ' && simpleQuoteListPrefix &&
            !line.text.startsWith(simpleQuoteListPrefix)) simpleQuoteListPrefix = undefined
        else if (simpleQuoteListPrefix && line.text.startsWith(simpleQuoteListPrefix) &&
            (line.text.startsWith(simpleQuoteListPrefix + '  ') ||
             isBlockStart(line.text.slice(simpleQuoteListPrefix.length)) &&
             !rootLinkDef(line.text.slice(simpleQuoteListPrefix.length)))) {
          simpleQuoteListPrefix = undefined
        }
      }
      if (openComment !== undefined) {
        const closer = RE_COMMENT_BLOCK_ANY.exec(line.text)
        if (closer?.[1]?.length === openComment) openComment = undefined
        continue
      }
      if (openFence) {
        if (closesFence(line.text, openFence)) openFence = undefined
        continue
      }
      const fence = fenceOpen(line.text)
      if (fence) { openFence = fence.marker; continue }
      const comment = RE_COMMENT_BLOCK_ANY.exec(line.text)
      if (comment && commentOpeners.has(line.start)) {
        openComment = comment[1]!.length
        continue
      }
      const quoteDefinition = line.text.startsWith('> ') &&
        (line.number === 1 || cursor.lines[line.number - 2]?.text === '')
      const simpleListDefinition = mayHaveNestedListDefinition && simpleRootListPrefix &&
        line.text.startsWith(simpleRootListPrefix + '[') &&
        (cursor.lines[line.number - 2]?.text === '' ||
         boundedAdjacentDefinitionTail(cursor.lines, line.number, simpleRootListPrefix)) ?
        rootLinkDef(line.text.slice(simpleRootListPrefix.length)) : null
      const quoteListDefinition = mayHaveNestedListDefinition && simpleQuoteListPrefix &&
        line.text.startsWith(simpleQuoteListPrefix + '[') &&
        cursor.lines[line.number - 2]?.text === '> ' ?
        rootLinkDef(line.text.slice(simpleQuoteListPrefix.length)) : null
      if (simpleListDefinition || quoteListDefinition) {
        simpleRootListDefinitions!.set(line.number, (simpleListDefinition ?? quoteListDefinition)!)
      }
      const match = rootLinkDef(line.text) || simpleListDefinition || quoteListDefinition ||
        (quoteDefinition ? rootLinkDef(line.text.slice(2)) : null)
      if (match) linkDefinitions.set(normalizeRefLabel(match.label),
        { rawLabel: match.label, line: line.number - 1, href: match.href,
          ...(match.title !== undefined ? { title: unescapeAttrValue(match.title) } : {}),
          ...(match.attrText !== null ? { attrs: parseAttrs(match.attrText) } : {}) })
      const abbr = ABBR_DEF.exec(line.text)
      if (abbr) abbreviations.set(abbr[1]!, dropTrailingWhitespace(abbr[2]!))
    }
  }
  if (simpleRootListDefinitions) cursor.simpleRootListDefinitions = simpleRootListDefinitions
  const inline = new CursorInline(linkDefinitions, abbreviations)
  const definitionNodes: BlockNode[] = []
  const footnoteDefs: Record<string, BlockNode[]> = {}
  const footnoteDefPos: Record<string, Position> = {}
  let frontmatter: Document['frontmatter']
  if (source.startsWith('---')) {
    const lexer = lexerForCursor(cursor)
    lexer.defaultFrontmatterFormat = opts.defaultFrontmatterFormat ?? 'yaml'
    lexer.consumeFrontmatter()
    cursor.at = lexer.pos
    frontmatter = lexer.frontmatter
  }
  const children = parseBlocks(cursor, inline, definitionNodes, 0, true, footnoteDefs, footnoteDefPos,
    commentOpeners)
  const document: Document = { type: 'document', children, srcByteLength: rawByteLength }
  if (Object.keys(footnoteDefs).length) {
    document.footnoteDefs = footnoteDefs
    document.footnoteDefPos = footnoteDefPos
  }
  if (frontmatter) document.frontmatter = frontmatter
  children.push(...definitionNodes)
  if (opts.positions !== false) toCodepointPositions(document, rawSource)
  if (inline.hasLeadingImage) promoteBlockImages(children, true)
  document.children = promoteCitationDefinitions(children)
  return opts.positions === false ? dropPositions(document) : document
}
