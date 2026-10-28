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
import { dropTrailingWhitespace, readCaptionText, trackItemLazyState, verbatimOnlyLazyState, type ItemLazyState } from './block/parse-block-boundaries.js'
import { MAX_NESTING_DEPTH, commentLineContent } from './block/parse-block-scan-core.js'
import { markAboveContentColumn } from './block/paragraph-indent.js'
import { RE_CAPTION, RE_COMMENT_BLOCK_ANY, blockQuoteParagraphClaimOpen, isBlockImageLine, trackBlockQuoteLazyState } from './block/parse-quote-core.js'
import { trimNonNbsp } from '../trim-non-nbsp.js'
import { parseDirective } from '../include-directive.js'
import { replaceLoneSurrogates } from '../well-formed.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import { inlineSource } from './inline/parse-inline-core.js'
import type { LinkDef } from './inline/inline-resolution.js'
import { olKindOf, olStartOf, sourceColumnAt, type OlKind } from './list/parse-item-core.js'
import { RE_ADMONITION_OPEN, RE_BLOCKQUOTE, RE_DIV_OPEN, RE_FENCE, RE_HARDBREAKS_OPEN, RE_HEADING, RE_LINE_BLOCK_OPEN, RE_ORDERED, RE_QUOTE_BLOCK_OPEN, RE_RAW_FENCE, RE_VALID_ADMONITION_OPEN, consumeLooseKey, deriveTableMetadata, extractItemAttr, isTableRow, matchLinkDef, parseBlockAttributeRun, probeBlockAttributes } from './parse-prepass-core.js'
import { Lexer, isBlankLine } from './parse-lexer.js'
import type { DanglingBlockAttributes, ParseOptions, UnclosedCodeFence, UnclosedContainer } from './block/parse-block-scan-core.js'
import { commentBlockHasCloser, isFigureGroupOpener, parseCommentBlock, parseLineBlockWithHelpers, parseRawBlock, parseTableBlock } from './parse-core.js'
import { delimitedTable, setDelimitedPayloadLines } from '../table/delimited-table.js'
import { verbatimSpanEnd } from './inline/parse-brackets.js'

/**
 * An isolated block-cursor experiment. It deliberately fails on syntax that has
 * not been migrated; production entry points never invoke it.
 */
export class UnsupportedCursorSyntax extends Error {}

interface SourceLine { text: string; start: number; number: number; baseColumn?: number;
  spanEndColumn?: number; lazyText?: boolean; wrappedAttr?: boolean;
  ownedDefinition?: boolean; ownedDefinitionBody?: boolean; ownedFirstBlock?: boolean;
  quoteResume?: boolean; quotedAttachedSibling?: boolean; claimedQuoteLazy?: boolean }
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

function hasContainerOwner(owner: ContainerOwner, kind: ContainerKind): boolean {
  for (let current: ContainerOwner | undefined = owner; current; current = current.parent) {
    if (current.kind === kind) return true
  }
  return false
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
const RE_PLAIN_CURSOR_TEXT = /^[A-Za-z0-9 .,;!?():\-]+$/
function plainCursorText(text: string): boolean {
  if (!RE_PLAIN_CURSOR_TEXT.test(text) || text.includes('..') || text.includes('--') ||
      /\((?:c|r|tm)\)/i.test(text)) return false
  const colon = text.indexOf(':')
  return colon === -1 || text.indexOf(':', colon + 1) === -1
}

function cursorContainerLabel(text: string): string {
  if (!text.includes('%%')) return text
  const nodes = new InlineParseSession().parseRefLabelInlines(text)
  const last = nodes.at(-1)
  if (last?.type !== 'comment' || last.block) return text
  const start = last.pos?.startOffset
  return start === undefined ? text : text.slice(0, start).replace(/ +$/, '')
}

type CursorDiagnostic =
  | { kind: 'dangling'; event: DanglingBlockAttributes }
  | { kind: 'fence'; event: UnclosedCodeFence }
  | { kind: 'invalid'; event: UnclosedContainer }
  | { kind: 'container'; event: UnclosedContainer }

class CursorInline extends InlineParseSession {
  // Image promotion only changes paragraphs whose first inline node is an image.
  hasLeadingImage = false
  footnoteDefs?: Record<string, BlockNode[]>
  footnoteDefPos?: Record<string, Position>
  diagnostics?: CursorDiagnostic[]
  constructor(readonly linkDefinitions: Map<string, LinkDef>,
    readonly abbreviations: Map<string, string>,
    readonly positionless = false,
    readonly recordDanglingAttributes = false,
    readonly recordUnclosedCodeFences = false,
    readonly recordInvalidMetadata = false,
    readonly recordUnclosedContainers = false) {
    super()
    if (recordDanglingAttributes || recordUnclosedCodeFences || recordInvalidMetadata ||
        recordUnclosedContainers) this.diagnostics = []
  }
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
    if (nodes[0]?.type === 'image' || nodes[0]?.type === 'comment' &&
        nodes.find((node) => node.type !== 'comment')?.type === 'image') this.hasLeadingImage = true
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
  const itemAttr = line.includes('{') ? extractItemAttr(line) : null
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

function takeDefinitionQuoteTail(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  if (cursor.owner.kind !== 'definition' || body.length < 2 ||
      !/^\+ [^+]/.test(body.at(-1)!.text)) return undefined
  const line = cursor.peek()
  if (!line || !plainQuoteText(line.text) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
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

function takeNestedQuoteListLazyLine(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  if (cursor.owner.kind !== 'root' &&
      (cursor.owner.kind !== 'quote' || cursor.owner.parent?.kind !== 'root')) return undefined
  const first = listMarker(body[0]?.text ?? '')
  const line = cursor.peek()
  if (!first || first.indent !== 0 || !plainQuoteText(first.content) || !line ||
      body.at(-1)?.number !== line.number - 1 ||
      !line.text.startsWith(' '.repeat(first.width)) ||
      isBlankLine(line.text) ||
      line.text.slice(first.width).trimStart().startsWith('%%')) return undefined
  const owned = { ...cursor.take(), lazyText: true }
  body.push(owned)
  return owned
}

function quotedListFirstBlockFollower(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  return body.at(-1)?.number === line.number - 1 &&
    quoteListEndsInPlus(body.at(-1)!.text) &&
    (RE_HEADING.test(line.text) || isTableRow(line.text)) &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))
}

function indentedLiteralAbbreviation(text: string): boolean {
  return text.startsWith(' ') && ABBR_DEF.test(text.trimStart())
}

function indentedLiteralColon(text: string): boolean {
  const content = text.trimStart()
  return text.startsWith(' ') && content.startsWith(':::') && !COLON_OPEN.test(content)
}

function mayContinueQuoteLazily(follower: string | undefined, innerLast: string | undefined): boolean {
  if (!follower || !innerLast || follower.startsWith('^ ')) return false
  let finalBlock = innerLast.trimStart()
  while (finalBlock.startsWith('>')) {
    finalBlock = finalBlock.slice(finalBlock[1] === ' ' ? 2 : 1).trimStart()
  }
  if (finalBlock === '' || (isBlockStart(finalBlock) && !indentedLiteralAbbreviation(innerLast) &&
      !finalBlock.startsWith(':: ') &&
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
  frame: ListCursorFrame):
  { line: SourceLine; prefix: number; rootLazy: boolean } | undefined {
  if (line.quotedAttachedSibling) frame.list.tight = false
  if (line.lazyText && cursor.owner.kind === 'quote') {
    return { line, prefix: 0, rootLazy: true }
  }
  const prefix = quotedListSiblingPrefix(line, marker, frame) ??
    quoteListMarkerPrefix(line, marker, frame)
  return prefix === undefined ? undefined :
    { line: { ...line, lazyText: true }, prefix, rootLazy: false }
}

function quotedFencePayload(text: string, depth: number): string | undefined {
  let rest = text
  for (let level = 0; level < depth; level++) {
    if (rest[0] !== '>') return undefined
    rest = rest.slice(rest[1] === ' ' ? 2 : 1)
  }
  return rest
}

function quotedFenceOpener(text: string): { marker: string; depth: number } | undefined {
  let depth = 0
  let rest = text
  while (rest[0] === '>') {
    rest = rest.slice(rest[1] === ' ' ? 2 : 1)
    depth++
  }
  const marker = fenceOpen(rest)?.marker
  return marker ? { marker, depth } : undefined
}

function listContinuationPrefix(line: string, base: number, body?: SourceLine[],
  closedQuoteFence = false, next?: string): number {
  const firstBlockText = body?.[0]?.text
  if (firstBlockText && listMarker(firstBlockText)) return base
  let column = base
  while (line[column] === ' ') column++
  const block = line.slice(column)
  if (block.startsWith('>') && body && openColonRun(body, true) !== undefined) return base
  const previousLine = body?.at(-1)
  const previous = previousLine?.text ?? ''
  if (block.startsWith('>') && previous === '' && body?.at(-2)?.ownedDefinitionBody &&
      (next === undefined || isBlankLine(next))) return base
  return column > base && (!closedQuoteFence && block.startsWith('>') ||
    RE_HEADING.test(block) || BREAK.test(previous) && fenceOpen(block) !== null ||
    body && previous === '' && /^:: +/.test(block) ||
    previousLine?.ownedDefinition && column === (previousLine.baseColumn ?? 1) - 1 &&
      /^: +/.test(block)) ? column : base
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

function endsOpenQuotedParagraph(body: SourceLine[]): boolean {
  const last = body.at(-1)?.text
  return last !== undefined && RE_BLOCKQUOTE.test(last) &&
    plainQuoteText(last.slice(last[1] === ' ' ? 2 : 1))
}

function shiftedQuotedHeading(body: SourceLine[], line: SourceLine, prefix: number): boolean {
  return endsOpenQuotedParagraph(body) && body.at(-1)?.number === line.number - 1 &&
    line.text[prefix] === ' ' && RE_HEADING.test(line.text.slice(prefix).trimStart())
}

function listContinuationClaim(frame: ListCursorFrame, line: SourceLine,
  bodyPrefix: number, reachedPrefix: number, next?: SourceLine):
  { line: SourceLine; prefix: number } {
  if (frame.closedQuoteFence && frame.quoteFenceDepth > 1 &&
      line.text.slice(reachedPrefix).startsWith(' ') &&
      line.text.trimStart().startsWith('>') && next &&
      plainQuoteText(next.text) && !next.text.startsWith(' ')) {
    throw new UnsupportedCursorSyntax('nested quoted fence tail owner')
  }
  const prefix = bodyPrefix === reachedPrefix && !frame.fenceMarker ?
    listContinuationPrefix(line.text, bodyPrefix, frame.body, frame.closedQuoteFence,
      next?.text) : bodyPrefix
  const ownedDefinition = prefix > bodyPrefix && /^:: +/.test(line.text.slice(prefix))
  const ownedDefinitionBody = prefix > bodyPrefix && frame.body.at(-1)?.ownedDefinition &&
    /^: +/.test(line.text.slice(prefix))
  return { line: shiftedQuotedHeading(frame.body, line, bodyPrefix) ?
    { ...line, lazyText: true } : ownedDefinition ? { ...line, ownedDefinition: true } :
      ownedDefinitionBody ? { ...line, ownedDefinitionBody: true } : line, prefix }
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
  const tabbedListRow = cursor.owner.kind === 'list' &&
    cursor.physicalLines[first.number - 1]?.text.startsWith('\t')
  if (!first.text.startsWith('|') ||
      (!headed && cursor.at > 0 && cursor.lines[cursor.at - 1]?.text !== '' &&
        (cursor.owner.kind !== 'root' && !tabbedListRow ||
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
  if (!headed && cursor.peek()?.text && !isBlockStart(cursor.peek()!.text) &&
      (hasContainerOwner(cursor.owner, 'definition') ||
        cursor.owner.inList && cursor.peek(1)?.text === '' &&
        RE_CAPTION.test(cursor.peek(2)?.text ?? ''))) {
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
    return indent < column - 1 && LINE_COMMENT.test(content) &&
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
  if (/^ *[A-Za-z0-9]/.test(text)) return true
  const indent = /^ */.exec(text)![0].length
  if (indent === column - 1 && /^\+ [^+]/.test(text.slice(indent))) return true
  return indent > 0 && indent < column - 1 &&
    (text[indent] === '>' || text[indent] === '#' ||
      text[indent] === '[' || text[indent] === '{' || text[indent] === '`')
}

function nestedDefinitionBodyEnd(cursor: Cursor, from: number, column: number): number | undefined {
  const first = cursor.lines[from]?.text
  if (!first || first.charCodeAt(column - 1) !== 58 ||
      first.charCodeAt(column) !== 58 || first.charCodeAt(column + 1) !== 32) return undefined
  const prefix = ' '.repeat(column - 1)
  if (!first.startsWith(prefix)) return undefined
  let after = from + 1
  while (cursor.lines[after]?.text.startsWith(prefix) &&
      cursor.lines[after]!.text.length > prefix.length) after++
  return !cursor.lines[after] || cursor.lines[after]!.text === '' ? after : undefined
}

function definitionFenceBodyEnd(cursor: Cursor, from: number, column: number): number | undefined {
  const prefix = ' '.repeat(column - 1)
  const first = cursor.lines[from]?.text
  if (!first?.startsWith(prefix)) return undefined
  const marker = fenceOpen(first.slice(prefix.length))?.marker
  if (!marker) return undefined
  for (let at = from + 1; at < cursor.lines.length; at++) {
    const text = cursor.lines[at]!.text
    if (text === '') return undefined
    if (!text.startsWith(prefix)) {
      for (let later = at + 1; later < cursor.lines.length; later++) {
        const follower = cursor.lines[later]!.text
        if (follower === '') break
        if (follower.startsWith(prefix) && closesFence(follower.slice(prefix.length), marker)) {
          return at
        }
      }
      return undefined
    }
    if (!text.startsWith(prefix) || !closesFence(text.slice(prefix.length), marker)) continue
    return !cursor.lines[at + 1] || cursor.lines[at + 1]!.text === '' ? at + 1 : undefined
  }
  return undefined
}

function definitionFenceBoundary(cursor: Cursor, from: number, column: number,
  mayWrap: boolean, plain: boolean): { end: number; structural: boolean } | undefined {
  if (!mayWrap || !plain) return undefined
  const end = definitionFenceBodyEnd(cursor, from, column)
  if (end === undefined) return undefined
  const boundary = cursor.lines[end]?.text
  return { end, structural: boundary !== undefined && boundary !== '' &&
    !boundary.startsWith(' '.repeat(column - 1)) }
}

function boundedDefinitionParagraphEnd(lines: SourceLine[], from: number): number | undefined {
  const codeRun = /^ +(`{3,})[ \t]*$/.exec(lines[from]?.text ?? '')?.[1]
  if (codeRun) {
    for (let at = from + 1; at < lines.length; at++) {
      if (lines[at]!.text !== codeRun) continue
      if (!lines[at + 1] || lines[at + 1]!.text === '') return at + 1
      break
    }
  }
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
  const opener = cursor.lines[end - 1]?.text.slice(column - 1)
  const last = cursor.lines[after - 1]?.text.slice(column - 1)
  if (RE_BLOCKQUOTE.test(opener ?? '') && RE_BLOCKQUOTE.test(last ?? '') &&
      plainQuoteText(cursor.lines[after]?.text ?? '')) {
    const paragraphEnd = boundedDefinitionParagraphEnd(cursor.lines, after)
    if (paragraphEnd !== undefined) return paragraphEnd
  }
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
  while (cursor.lines[after] && definitionStructuralLine(cursor.lines[after]!.text, column) &&
      !cursor.lines[after]!.text.startsWith('%%')) after++
  const commentTail = definitionCommentTailEnd(cursor, after - 1, column)
  if (cursor.lines[end]!.text.startsWith('%%') && commentTail === undefined) return undefined
  if (commentTail !== undefined) after = commentTail
  const opener = cursor.lines[end]!.text
  const offset = definitionStructuralOffset(opener, column)!
  if (offset > column - 1 && RE_BLOCKQUOTE.test(opener.slice(offset)) &&
      plainQuoteText(cursor.lines[after]?.text ?? '')) {
    const quoteContent = opener.slice(offset + (opener[offset + 1] === ' ' ? 2 : 1))
    const follower = cursor.lines[after]!.text
    return plainQuoteText(quoteContent) && !isBlockStart(quoteContent) &&
      !isBlockStart(follower) &&
      (!cursor.lines[after + 1] || isBlankLine(cursor.lines[after + 1]!.text)) ?
      after + 1 : undefined
  }
  return !cursor.lines[after] || !cursor.lines[after]!.text.startsWith(' '.repeat(column - 1)) ?
    after : undefined
}

function definitionCommentTailEnd(cursor: Cursor, commentAt: number,
  column: number): number | undefined {
  const comment = cursor.lines[commentAt]?.text ?? ''
  const indent = /^ */.exec(comment)![0].length
  if (indent >= column - 1 || !LINE_COMMENT.test(comment) ||
      RE_COMMENT_BLOCK_ANY.test(comment)) return undefined
  const tail = cursor.lines[commentAt + 1]?.text
  const tailIndent = /^ */.exec(tail ?? '')![0].length
  if (!tail || tailIndent > column - 1 || !plainQuoteText(tail.slice(tailIndent)) ||
      cursor.lines[commentAt + 2] && cursor.lines[commentAt + 2]!.text !== '') return undefined
  return commentAt + 2
}

function takeDefinitionBlockContinuation(cursor: Cursor, end: number, line: SourceLine,
  column: number, content: string, inline: CursorInline, depth: number):
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
  if (RE_BLOCKQUOTE.test(content)) while (cursor.at < end &&
      plainQuoteText(cursor.peek()!.text)) {
    const follower = cursor.take()
    body.push(follower)
    last = follower
  }
  if (hasExposedDefinitionReference(body)) {
    throw new UnsupportedCursorSyntax('definition body reference')
  }
  return { blocks: parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false), last }
}

function lastPlacedDefinitionLine(blocks: BlockNode[], last: SourceLine,
  physicalLines: SourceLine[]): SourceLine {
  const placedEnd = blocks.at(-1)?.pos?.endLine
  return placedEnd && placedEnd < last.number ? physicalLines[placedEnd - 1] ?? last : last
}

function attachedDefinitionFenceEnd(cursor: Cursor, plus: number): number | undefined {
  if (cursor.lines[plus]?.text !== '+') return undefined
  const attribute = rootBlockAttributeAt(cursor, plus + 1) &&
    fenceOpen(cursor.lines[plus + 2]?.text ?? '')
  const fence = plus + (attribute ? 2 : 1)
  const marker = fenceOpen(cursor.lines[fence]?.text ?? '')?.marker
  if (!marker) return undefined
  let close = fence + 1
  while (cursor.lines[close] && !closesFence(cursor.lines[close]!.text, marker)) close++
  return cursor.lines[close] && (!cursor.lines[close + 1] || cursor.lines[close + 1]!.text === '') ?
    close + 1 : undefined
}

function safeDefinitionListEnd(cursor: Cursor, end: number, body: string): boolean {
  const listBody = listMarker(body)
  if (!listBody) return false
  const nestedBody = listMarker(listBody.content)
  const previousText = cursor.lines[end - 1]?.text.trimStart() ?? ''
  const safeStructure = fenceOpen(listBody.content) ||
    nestedBody && fenceOpen(nestedBody.content) ||
    !listBody.ordered && !listBody.content.trimStart().startsWith('+') &&
    (RE_HEADING.test(previousText) ||
      isTableRow(listBody.content) && isTableRow(previousText))
  return Boolean(safeStructure) &&
    !cursor.lines.slice(cursor.at, end + 1).some((line) => line.text.includes('{'))
}

function uncertainDefinitionListEnd(cursor: Cursor, end: number,
  commentOpeners: ReadonlySet<number> | undefined, contentColumn: number,
  endedOnStructural: boolean, body: string): boolean {
  const line = cursor.lines[end]
  return Boolean(line && line.text !== '' &&
    !commentOpeners?.has(line.start) &&
    !(endedOnStructural && !line.text.startsWith(' '.repeat(contentColumn - 1))) &&
    !(cursor.owner.kind === 'root' && (rootLinkDef(line.text) ||
      rootBlockAttributeAt(cursor, end) || startsRootBlockAfterDefinition(line.text) ||
      body === '' && LINE_COMMENT.test(line.text))) &&
    !safeDefinitionListEnd(cursor, end, body))
}

function terminalDefinitionFollower(text: string, following: SourceLine | undefined,
  mayFirstBlock: boolean, mayWrapDefinition: boolean, definitionContentPlain: boolean): boolean {
  if (following && following.text !== '') return false
  if (mayFirstBlock && (RE_BLOCKQUOTE.test(text) || plainQuoteText(text))) return true
  return mayWrapDefinition && definitionContentPlain &&
    /^ (?:-{3,}|\*{3,}|_{3,}|~{3,}|(?:- ){2,}-)[ \t]*$/.test(text)
}

function definitionListEnd(cursor: Cursor, commentOpeners: ReadonlySet<number> | undefined): number {
  let end = cursor.at
  let mayWrapDefinition = false
  let mayWrapTerm = false
  let termContentColumn = 0
  let mayTermPlus = false
  let mayFirstBlock = false
  let definitionContentColumn = 0
  let definitionContentPlain = false
  let definitionContentBlock = false
  let definitionListText = ''
  let endedOnStructural = false
  let endedOnFenceBoundary = false
  while (end < cursor.lines.length) {
    const text = cursor.lines[end]!.text
    const termMatch = /^:: +[ \t]*([^ \t].*)$/.exec(text)
    const term = termMatch !== null
    const definition = /^: +[ \t]*[^ \t].*$/.test(text)
    if (term || definition) {
      if (/[ \t]$/.test(text)) throw new UnsupportedCursorSyntax('definition list trailing whitespace')
      mayWrapDefinition = definition && !/^: +\+[ \t]*$/.test(text)
      mayFirstBlock = definition && /^: +\+[ \t]*$/.test(text)
      if (definition) {
        const body = /^: +[ \t]*([^ \t].*)$/.exec(text)![1]!
        definitionContentColumn = text.length - body.length + 1
        definitionContentPlain = !isBlockStart(body)
        definitionListText = body
      }
      definitionContentBlock = definition && mayWrapDefinition && !definitionContentPlain
      mayWrapTerm = term
      mayTermPlus = term
      if (term) {
        termContentColumn = text.length - termMatch[1]!.length + 1
        definitionListText = ''
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
    if (terminalDefinitionFollower(text, cursor.lines[end + 1],
      mayFirstBlock, mayWrapDefinition, definitionContentPlain)) {
      end++
      break
    }
    if (mayWrapDefinition && text === '' &&
        definitionStructuralLine(cursor.lines[end + 1]?.text ?? '', definitionContentColumn) &&
        (!cursor.lines[end + 2] || cursor.lines[end + 2]!.text === '')) {
      end += 2
      break
    }
    const attachedFenceEnd = mayWrapDefinition ? attachedDefinitionFenceEnd(cursor, end) : undefined
    if (attachedFenceEnd !== undefined) { end = attachedFenceEnd; break }
    const nestedEnd = mayWrapDefinition && definitionContentPlain ?
      nestedDefinitionBodyEnd(cursor, end, definitionContentColumn) : undefined
    if (nestedEnd !== undefined) { end = nestedEnd; break }
    const fenced = definitionFenceBoundary(cursor, end, definitionContentColumn,
      mayWrapDefinition, definitionContentPlain)
    if (fenced) {
      endedOnStructural = fenced.structural
      endedOnFenceBoundary = fenced.structural
      end = fenced.end
      break
    }
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
  if (end === cursor.at || uncertainDefinitionListEnd(cursor, end, commentOpeners,
    definitionContentColumn, endedOnStructural, definitionListText)) {
    throw new UnsupportedCursorSyntax('definition list body')
  }
  let next = end
  while (cursor.lines[next]?.text === '') next++
  const follower = cursor.lines[next]?.text
  if (follower && !endedOnFenceBoundary &&
      (/^[ \t+:]/.test(follower) || follower.startsWith('::'))) {
    throw new UnsupportedCursorSyntax('definition list continuation')
  }
  return end
}

function parseSimpleDefinitionList(cursor: Cursor, inline: CursorInline,
  commentOpeners: ReadonlySet<number> | undefined, depth: number): DefinitionList {
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
        const previous = cursor.lines[cursor.at - 3]
        const definition = previous && /^: +[ \t]*([^ \t].*)$/.exec(previous.text)
        const contentColumn = definition ? previous.text.length - definition[1]!.length + 1 : 0
        const structuralOffset = contentColumn ?
          definitionStructuralOffset(follower.text, contentColumn) : undefined
        if (structuralOffset !== undefined) {
          const body = { text: follower.text.slice(structuralOffset),
            start: follower.start + structuralOffset, number: follower.number,
            baseColumn: (follower.baseColumn ?? 1) + structuralOffset }
          current.definitions.at(-1)!.push(...parseBlocks(new Cursor([body], undefined,
            childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false))
          last = follower
          continue
        }
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
      const nestedEnd = !isBlockStart(definition[1]!) ?
        nestedDefinitionBodyEnd(cursor, cursor.at, column) : undefined
      if (nestedEnd !== undefined && nestedEnd <= end) {
        const body: SourceLine[] = [{ text: definition[1]!, start: line.start + column - 1,
          number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 }]
        while (cursor.at < nestedEnd) {
          const follower = cursor.take()
          body.push({ text: follower.text.slice(column - 1),
            start: follower.start + column - 1, number: follower.number,
            baseColumn: (follower.baseColumn ?? 1) + column - 1 })
          last = follower
        }
        const blocks = parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false)
        current.definitions.push(blocks)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        continue
      }
      const fencedEnd = !isBlockStart(definition[1]!) ?
        definitionFenceBodyEnd(cursor, cursor.at, column) : undefined
      if (fencedEnd !== undefined && fencedEnd <= end) {
        const prefix = ' '.repeat(column - 1)
        const boundary = cursor.lines[fencedEnd]
        const unclosed = boundary !== undefined && boundary.text !== '' &&
          !boundary.text.startsWith(prefix)
        const body: SourceLine[] = [{ text: definition[1]!, start: line.start + column - 1,
          number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 }]
        while (cursor.at < fencedEnd) {
          const follower = cursor.take()
          const offset = follower.text.startsWith(prefix) ? prefix.length : 0
          body.push({ text: follower.text.slice(offset), start: follower.start + offset,
            number: follower.number, baseColumn: (follower.baseColumn ?? 1) + offset })
          last = follower
        }
        const blocks = parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition', false, unclosed,
            unclosed ? boundary : undefined), cursor.physicalLines), inline, [], depth + 1, false)
        current.definitions.push(blocks)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        continue
      }
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
        if (cursor.at < end && body.length === 2 &&
            (body[1]!.baseColumn ?? 1) > column && RE_BLOCKQUOTE.test(body[1]!.text) &&
            plainQuoteText(body[1]!.text.slice(body[1]!.text[1] === ' ' ? 2 : 1)) &&
            !isBlockStart(body[1]!.text.slice(body[1]!.text[1] === ' ' ? 2 : 1)) &&
            plainQuoteText(cursor.peek()!.text) && !isBlockStart(cursor.peek()!.text) &&
            (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))) {
          last = cursor.take()
          body.push(last)
        }
        if (cursor.at < end && definitionCommentTailEnd(cursor, cursor.at - 1, column) === cursor.at + 1) {
          last = cursor.take()
          const offset = last.text.startsWith(' '.repeat(column - 1)) ? column - 1 : 0
          body.push({ text: last.text.slice(offset), start: last.start + offset,
            number: last.number, baseColumn: (last.baseColumn ?? 1) + offset })
        }
        const blocks = parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false)
        current.definitions.push(blocks)
        last = lastPlacedDefinitionLine(blocks, last, cursor.physicalLines)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        continue
      }
      if (definition[1] === '+' && cursor.at < end &&
          (RE_BLOCKQUOTE.test(cursor.peek()!.text) || plainQuoteText(cursor.peek()!.text))) {
        const follower = cursor.take()
        current.definitions.push(parseBlocks(new Cursor([follower], undefined,
          childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], depth + 1, false))
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        last = follower
        continue
      }
      const blockBody = isBlockStart(definition[1]!)
      const parts: ContentLine[] = [{ line, column, text: definition[1]! }]
      let definitionLast = line
      const continuation = blockBody ? takeDefinitionBlockContinuation(cursor, end, line,
        column, definition[1]!, inline, depth) : undefined
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
      }], undefined, childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], depth + 1, false) :
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
      if (fenceOpen(follower.text) || rootBlockAttributeAt(cursor, cursor.at - 1) &&
          fenceOpen(cursor.peek()?.text ?? '')) {
        const body = [follower]
        while (cursor.at < end) body.push(cursor.take())
        current.definitions.at(-1)!.push(...parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false))
        last = body.at(-1)!
        continue
      }
      const attached: BlockNode[] = listMarker(follower.text) ?
        parseBlocks(new Cursor([follower], undefined, childOwner(cursor.owner, 'definition'),
          cursor.physicalLines), inline, [], depth + 1, false) : [{ type: 'paragraph',
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

function positionlessImageCaptionIsText(inline: CursorInline, image: InlineNode,
  first: SourceLine): boolean {
  return inline.positionless && image.type === 'image' &&
    (image.ref !== undefined || image.pos?.startLine !== image.pos?.endLine ||
      /`{2,}/.test(first.text))
}

function parseParagraphAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
  const first = cursor.peek()!
  const codeInclude = first.text.includes('{{') &&
    parseDirective(first.text.trim())?.code !== undefined
  const parts: ContentLine[] = []
  let last = first
  let captionLead: InlineNode[] | undefined
  let imageCaptionSlot = false
  const literalColonOpener = /^:{3,}(?: *\t| +\{|>)/.test(first.text)
  while (cursor.peek() && !isBlankLine(cursor.peek()!.text) &&
      (parts.length === 0 || ((!interruptsParagraphAtCursor(cursor) || cursor.peek()!.lazyText) &&
        !(parts.length === 1 && parts[0]!.text.trim() === '+' &&
          listMarker(cursor.peek()!.text) && !cursor.peek()!.lazyText)) ||
        literalColonOpener && /^:{3,}[ \t]*$/.test(cursor.peek()!.text))) {
    if (codeInclude && parts.length > 0) break
    if (imageCaptionSlot && RE_CAPTION.test(cursor.peek()!.text)) break
    if (parts.length === 1 && /^!\[[^\]]*\]\[[^\]]+\][ \t]*$/.test(parts[0]!.line.text) &&
        RE_CAPTION.test(cursor.peek()!.text)) imageCaptionSlot = true
    if (parts.length > 0 && parts[0]!.text.startsWith('![') &&
        RE_CAPTION.test(cursor.peek()!.text)) {
      const lead = inline.inlines(parts)
      if (lead.length === 1 && lead[0]?.type === 'image' &&
          imageReferenceResolved(lead[0], inline) &&
          lead[0].pos?.startOffset === parts[0]!.line.start &&
          lead[0].pos?.endOffset === last.start + last.text.length &&
          !positionlessImageCaptionIsText(inline, lead[0], first)) {
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
  const literalInclude = codeInclude && !/^\{\{ +["“]/.test(parts[0]!.text)
  const literalText = literalInclude ? dropTrailingWhitespace(parts[0]!.text) : ''
  const children: InlineNode[] = literalInclude ? [{ type: 'text', value: literalText,
    pos: position(first, first, parts[0]!.column, parts[0]!.column + literalText.length) }] :
    captionLead ?? inline.inlines(parts)
  const paragraph: Paragraph = { type: 'paragraph', children,
    pos: position(first, last, parts[0]!.column, last.text.replace(/[ \t]+$/, '').length + 1) }
  if (parts[0]!.column > 1 && paragraph.children[0]?.type === 'image') {
    markAboveContentColumn(paragraph)
  }
  if (paragraph.children.length === 1 && paragraph.children[0]?.type === 'image') {
    const image = paragraph.children[0]
    const caption = !positionlessImageCaptionIsText(inline, image, first) &&
      (imageReferenceResolved(image, inline) || cursor.peek()?.text === '') ?
      takeCaption(cursor, inline) : undefined
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

function parseRawAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
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
  if (inline.recordUnclosedCodeFences) {
    const marker = RE_RAW_FENCE.exec(first.text)?.[1]
    const last = cursor.lines[cursor.at - 1] ?? first
    if (marker && !closesFence(last.text, marker)) {
      inline.diagnostics!.push({ kind: 'fence', event: { line: first.number, column: first.baseColumn ?? 1,
        marker, endLine: last.number + 1,
        reason: last.number >= cursor.physicalLines.length ? 'document' : 'container' } })
    }
  }
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
  if (inline.recordUnclosedContainers) {
    const width = RE_LINE_BLOCK_OPEN.exec(first.text)?.[1]?.length
    if (width && !closesColonOwner(cursor.lines[cursor.at - 1]?.text ?? '', width)) {
      inline.diagnostics!.push({ kind: 'container', event: {
        kind: 'line block', line: first.number, column: first.baseColumn ?? 1,
        startOffset: first.start, endOffset: first.start + width, fenceWidth: width,
      } })
    }
  }
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
  if (listMarker(body[0]?.text ?? '') && body.length > 2 && body.at(-1)?.text === '' &&
      body.slice(1, -1).every((line) => line.text !== '' && !RE_BLOCKQUOTE.test(line.text) &&
        !fenceOpen(line.text) && !COLON_OPEN.test(line.text))) return false
  let only: string | undefined
  for (const line of body) {
    if (line.text === '') continue
    if (only !== undefined) return true
    only = line.text
  }
  return only === undefined || only.startsWith('![') || only.startsWith('$$') || isBlockStart(only)
}

function rejectAmbiguousNestedPlus(cursor: Cursor, marker: ReturnType<typeof listMarker>): void {
  if (!marker || marker.indent === 0 || !/^\+[ \t]*$/.test(marker.content)) return
  const parent = listMarker(cursor.lines[0]?.text ?? '')
  const next = cursor.peek(1)?.text ?? ''
  const indent = /^ */.exec(next)![0].length
  const opener = next.slice(indent)
  const quote = RE_BLOCKQUOTE.test(opener) &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))
  const fence = fenceOpen(opener)?.marker
  let closedFence = false
  if (fence) for (let offset = 2; cursor.peek(offset); offset++) {
    const line = cursor.peek(offset)!.text
    if (line.startsWith(' '.repeat(indent)) &&
        closesFence(line.slice(indent), fence)) {
      closedFence = !cursor.peek(offset + 1) || isBlankLine(cursor.peek(offset + 1)!.text)
      break
    }
  }
  if (!parent || parent.ordered || indent > marker.indent + (marker.ordered ? 0 : 2) ||
      !quote && !closedFence) {
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
  if (line.ownedFirstBlock) return
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
  if (follower.text[0] === '\t' && after && RE_BLOCKQUOTE.test(after.text)) {
    throw new UnsupportedCursorSyntax('tab-owned first block before quote')
  }
  if (markerLineNested && cursor.owner.kind === 'list' &&
      (follower.baseColumn ?? 1) > 1 &&
      !RE_BLOCKQUOTE.test(follower.text)) return undefined
  const prefix = ' '.repeat(contentColumn - 1)
  const atContentColumn = prefix.length > 0 && follower.text.startsWith(prefix)
  if (!(plainQuoteText(follower.text) ||
      (markerLineNested && RE_BLOCKQUOTE.test(follower.text)) ||
      (atContentColumn && plainQuoteText(follower.text.slice(prefix.length))))) return undefined
  if (after && !isBlankLine(after.text) && listMarker(after.text)?.indent !== 0 &&
      after.text !== '+' && !RE_BLOCKQUOTE.test(after.text) &&
      !RE_HEADING.test(after.text) && !BREAK.test(after.text)) return undefined
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

function nestedFirstFenceEnd(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): number | undefined {
  if (depth !== 0 || stackLength !== 1 || frame.body.length !== 1 || frame.fenceMarker) return undefined
  const inner = listMarker(frame.body[0]!.text)
  const task = inner && /^\[[ xX\-_>/!?]\] \+$/.test(inner.content)
  if (!task && frame.body[0]!.text !== '> +') return undefined
  return closedFenceEnd(cursor)
}

function unclosedNestedInlineFence(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number): number[] | undefined {
  const line = cursor.peek()
  if (!line || cursor.owner.kind !== 'root' || stackLength < 2 || frame.body.length !== 1 ||
      !plainQuoteText(frame.body[0]!.text) || frame.contentColumn === undefined ||
      !line.text.startsWith(' '.repeat(frame.indent))) return undefined
  const text = line.text.slice(frame.indent)
  const marker = fenceOpen(text)?.marker
  if (!marker || line.text.startsWith(' '.repeat(frame.contentColumn - 1))) return undefined
  const prefixes = [frame.indent]
  for (let offset = 1; cursor.peek(offset); offset++) {
    const following = cursor.peek(offset)!
    if (!plainQuoteText(following.text.trimStart())) return undefined
    const prefix = following.text.startsWith(' '.repeat(frame.indent)) ? frame.indent : 0
    if (closesFence(following.text.slice(prefix), marker)) return undefined
    prefixes.push(prefix)
  }
  return prefixes
}

function nestedSimpleFirstBlock(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): boolean {
  if (depth === 1 && stackLength === 1 && frame.body[0]?.text === '> +' &&
      cursor.peek()?.ownedFirstBlock) return true
  if (depth === 0 && stackLength === 1 && frame.body.length === 1 &&
      frame.body[0]?.text === '> > +' && RE_BLOCKQUOTE.test(cursor.peek()?.text ?? '')) {
    const after = cursor.peek(1)
    return !after || isBlankLine(after.text)
  }
  if (depth !== 0 || stackLength > 2 || frame.body.length !== 1 || frame.fenceMarker) return false
  const inner = listMarker(frame.body[0]!.text)
  const follower = cursor.peek()
  if (!inner || !follower) return false
  const prefix = stackLength === 2 && follower.text.startsWith(' '.repeat(frame.indent)) ?
    frame.indent : 0
  const stackedQuote = inner.content === '> +' && stackLength === 2 &&
    prefix === frame.indent && plainQuoteText(follower.text.slice(prefix))
  if (!(stackedQuote || inner.content === '+' &&
      (stackLength === 1 && plainQuoteText(follower.text) ||
       stackLength === 2 && RE_BLOCKQUOTE.test(follower.text.slice(prefix))))) return false
  const after = cursor.peek(1)
  return !after || isBlankLine(after.text)
}

function nestedQuoteFirstHeading(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): boolean {
  if (depth !== 0 || stackLength !== 2 || frame.body.length !== 1 ||
      frame.body[0]!.text !== '> +' || !RE_HEADING.test(cursor.peek()?.text ?? '')) return false
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
  const nextIndent = next ? /^ */.exec(next.text)![0].length : 0
  return next === undefined || isBlankLine(next.text) ||
    nextIndent > 0 && nextIndent < marker.width + taskWidth ||
    (listMarker(next.text)?.indent ?? Number.POSITIVE_INFINITY) <= marker.indent
}

function isRefusedListFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number, owner: ContainerOwner): boolean {
  return isUnattachedRootFirstBlock(marker, taskWidth, next, depth) ||
    isRefusedTaskFirstBlock(marker, taskWidth, next, depth) ||
    depth === 1 && owner.kind === 'list' && marker.indent === 0 &&
    marker.content.slice(taskWidth) === '+' && (!next || (next.baseColumn ?? 1) > 1)
}

function isFenceMarkerContinuation(marker: ReturnType<typeof listMarker>, fenceMarker: string | undefined,
  contentColumn: number | undefined, text: string): boolean {
  return marker !== undefined && fenceMarker !== undefined && contentColumn !== undefined &&
    text.startsWith(' '.repeat(contentColumn - 1))
}

function listFenceContinuationClaim(marker: ReturnType<typeof listMarker>, frame: ListCursorFrame,
  line: SourceLine, owner: ContainerOwner, stackLength: number,
  orderedRoot: boolean): { line: SourceLine; prefix: number } | undefined {
  const column = frame.contentColumn
  if (owner.kind === 'root' && stackLength === 1 && orderedRoot &&
      frame.fenceMarker && column !== undefined && line.text.trim() === '' &&
      reachableListPrefix(line.text, column) === undefined) {
    return { line: { ...line, text: '' }, prefix: 0 }
  }
  return isFenceMarkerContinuation(marker, frame.fenceMarker, column, line.text) ?
    { line, prefix: column! - 1 } : undefined
}

function listContinuationFollower(cursor: Cursor, indent: number,
  fenceMarker: string | undefined, depth: number): Array<{ line: SourceLine; prefix: number }> {
  const next = cursor.peek(1)
  const after = cursor.peek(2)
  const ownPrefix = indent > 0 && next ? reachableListPrefix(next.text, indent + 1) : undefined
  const ownColumnQuote = ownPrefix !== undefined && next !== undefined &&
    RE_BLOCKQUOTE.test(next.text.slice(ownPrefix)) && !after
  const quoteContinuation = depth === 1 && cursor.owner.kind === 'quote' &&
    listMarker(cursor.lines[0]?.text ?? '')?.content.trim() !== '+'
  if (!(depth === 0 || quoteContinuation) ||
      fenceMarker || indent !== 0 && !ownColumnQuote) {
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
  return [{ line: next, prefix: ownColumnQuote ? ownPrefix! : 0 }]
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
  const attribute = parseBlockAttributeRun(content)
  if (attribute) {
    const opener = cursor.peek(2)
    const fenced = opener?.text.startsWith(' '.repeat(frame.indent)) ?
      fenceOpen(opener.text.slice(frame.indent))?.marker : undefined
    if (fenced) {
      const lines = [follower, opener!]
      for (let offset = 3; cursor.peek(offset); offset++) {
        const next = cursor.peek(offset)!
        if (!next.text.startsWith(' '.repeat(frame.indent))) {
          throw new UnsupportedCursorSyntax('nested attached fence owner')
        }
        lines.push(next)
        if (closesFence(next.text.slice(frame.indent), fenced)) return lines
      }
      throw new UnsupportedCursorSyntax('unclosed nested attached fence')
    }
  }
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
  if (line.text.includes('\t') && line.text.endsWith('+')) {
    let column = 0
    for (const char of line.text.slice(0, -1)) {
      if (char === ' ') column++
      else if (char === '\t') column += 4 - column % 4
      else return false
    }
    const next = cursor.peek(1)
    const nextPrefix = next ? reachableListPrefix(next.text, frame.indent + 1) : undefined
    if (column === frame.indent && nextPrefix !== undefined && !cursor.peek(2) &&
        RE_BLOCKQUOTE.test(next!.text.slice(nextPrefix))) return true
  }
  return line.text === '+ ' && plainQuoteText(cursor.peek(1)?.text ?? '') &&
    (!cursor.peek(2) || cursor.peek(2)!.text === '')
}

function startsNestedListAfterLongBlankRun(blanks: number,
  marker: ReturnType<typeof listMarker>, rootIndent: number): boolean {
  return blanks >= 3 && marker !== undefined && marker.indent > rootIndent
}

function entersOpenListCodeSpan(body: SourceLine[], follower: string,
  contentColumn: number | undefined): boolean {
  const closer = /^ *(`{3,})[ \t]*$/.exec(follower)
  if (!closer || contentColumn === undefined ||
      closer[0].length - closer[0].trimStart().length >= contentColumn - 1 ||
      body.length < 2 || !plainQuoteText(body[0]!.text) ||
      body.some((line) => line.text === '')) return false
  const text = body.map((line) => line.text).join('\n')
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '`') continue
    const span = verbatimSpanEnd(text, at)
    if (!span.closed) return true
    at = span.end - 1
  }
  return false
}

function hasUnclosedListCodeSpan(body: SourceLine[]): boolean {
  if (body.length < 2 || body.some((line) => line.text === '')) return false
  const text = body.map((line) => line.text).join('\n')
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '`') continue
    const span = verbatimSpanEnd(text, at)
    if (!span.closed) return true
    at = span.end - 1
  }
  return false
}

function hasLaterIndentedTildeCloser(cursor: Cursor, indent: number, marker: string): boolean {
  const prefix = ' '.repeat(indent)
  for (let offset = 1; cursor.peek(offset); offset++) {
    const text = cursor.peek(offset)!.text
    if (text.startsWith(prefix) && closesFence(text.slice(indent), marker)) return true
  }
  return false
}

function attachedListFenceCaption(frame: ListCursorFrame, line: SourceLine,
  owner: ContainerOwner, stackLength: number, reachedPrefix: number | undefined): boolean {
  if (reachedPrefix !== undefined || stackLength !== 1 || owner.kind !== 'root' ||
      frame.indent !== 0 || frame.fenceMarker || frame.body.length < 2 ||
      line.text[0] !== '^' || !RE_CAPTION.test(line.text)) return false
  const marker = fenceOpen(frame.body[0]!.text)?.marker
  return marker !== undefined && closesFence(frame.body.at(-1)!.text, marker)
}

function foldsListTildeRun(body: SourceLine[], follower: string,
  contentColumn: number | undefined): boolean {
  const run = /^( +)(~{3,})[ \t]*$/.exec(follower)
  return run !== null && contentColumn !== undefined &&
    run[1]!.length < contentColumn - 1 && body.length >= 2 &&
    plainQuoteText(body[0]!.text) &&
    body.every((line) => line.text !== '') &&
    body.some((line) => line.text.trimStart() === run[2])
}

function mayFoldNestedListParagraph(cursor: Cursor,
  top: { indent: number; contentColumn?: number; ordered: boolean;
    delim?: '.' | ')'; bullet?: '-' | '*'; taskList: boolean;
    body: SourceLine[]; fenceMarker: string | undefined }, stackLength: number,
  rootContentColumn: number | undefined): boolean {
  if (stackLength < 2 || top.fenceMarker) return false
  const follower = cursor.peek()!.text
  const last = top.body.at(-1)?.text ?? ''
  const tilde = cursor.owner.kind === 'quote' ? /^( +)(~{3,})[ \t]*$/.exec(follower) : null
  if (tilde && hasUnclosedListCodeSpan(top.body) &&
      !hasLaterIndentedTildeCloser(cursor, tilde[1]!.length, tilde[2]!)) return true
  if (cursor.owner.kind === 'quote' && top.body.length === 1 &&
      rootContentColumn !== undefined && top.indent === rootContentColumn - 1 &&
      top.body.at(-1)?.number === cursor.peek()!.number - 1 &&
      !top.body.at(-1)?.lazyText && plainQuoteText(last) &&
      top.contentColumn !== undefined &&
      follower.startsWith(' '.repeat(top.contentColumn - 1)) &&
      follower[top.contentColumn - 1] !== ' ' &&
      fenceOpen(follower.trimStart()) !== null) return true
  if (rootContentColumn !== undefined && top.indent === rootContentColumn - 1 &&
      top.body.length === 1 && top.body[0]!.number === cursor.peek()!.number - 1 &&
      plainQuoteText(last) && /^ *(?:`{3,}|~{3,})[ \t]*$/.test(follower) &&
      follower.length - follower.trimStart().length === top.indent) return true
  const nonRowPipe = follower.trimStart().startsWith('|') &&
    !isTableRow(follower.trimStart()) && follower.startsWith(' ')
  if ((plainQuoteText(follower) || nonRowPipe ||
      follower.startsWith('+ ') && top.body.at(-1)?.lazyText &&
      top.body.at(-1)?.text.trimStart().startsWith('|')) &&
      (plainQuoteText(last) || nonRowPipe || top.body.at(-1)?.lazyText ||
        last === '+' && plainQuoteText(top.body.at(-2)?.text ?? ''))) return true
  return (follower[0] === ' ' || follower[0] === '`') && follower.includes('`') &&
    entersOpenListCodeSpan(top.body, follower, top.contentColumn) ||
    follower[0] === ' ' && follower.includes('~') &&
    foldsListTildeRun(top.body, follower, top.contentColumn)
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
  if (next.text.includes('\t')) {
    const reached = reachableListPrefix(next.text, frame.contentColumn)
    if (reached !== undefined && isTableRow(next.text.slice(reached))) return false
  }
  if (!plainQuoteText(last.text) && !last.claimedQuoteLazy &&
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

function foldedNestedParagraphLine(body: SourceLine[], line: SourceLine): SourceLine {
  const folded = markBelowColumnQuotedLiteral(body, line)
  return folded.text.trimStart().startsWith('|') &&
    !isTableRow(folded.text.trimStart()) ? { ...folded, lazyText: true } : folded
}

function mayFoldRootListParagraph(cursor: Cursor,
  frame: { indent: number; contentColumn?: number;
    fenceMarker: string | undefined; body: SourceLine[];
    lazyRootParagraph: boolean },
  stackLength: number, depth: number): boolean {
  const next = cursor.peek()!
  const first = frame.body[0]
  const last = frame.body.at(-1)
  const retainedCommentParagraph = first !== undefined && frame.body.length === 1 &&
    first.text.startsWith(' ') && first.number > 1 &&
    LINE_COMMENT.test(cursor.physicalLines[first.number - 2]?.text.trimStart() ?? '')
  const literalAbbreviation = frame.body.length >= 2 && first !== undefined &&
    last !== undefined && plainQuoteText(first.text) && ABBR_DEF.test(last.text)
  if (!(depth === 0 || depth === 1 &&
      (cursor.owner.kind === 'list' || cursor.owner.kind === 'definition' ||
        cursor.owner.kind === 'quote')) ||
      stackLength !== 1 || frame.indent !== 0 || frame.fenceMarker ||
      last?.number !== next.number - 1 ||
      !(frame.lazyRootParagraph || retainedCommentParagraph || literalAbbreviation ||
        ownsBelowColumnQuotedLiteral(frame.body, next.text) ||
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
      marker.content.startsWith('+ ') && marker.content.includes('|') &&
      plainQuoteText(follower.text) ||
      (marker.content === '+' || /^\[[ xX\-_>/!?]\] \+$/.test(marker.content)) &&
      RE_BLOCKQUOTE.test(follower.text) && !cursor.peek(1))
}

function mayFoldListParagraph(cursor: Cursor,
  frame: { indent: number; contentColumn?: number; ordered: boolean;
    delim?: '.' | ')'; bullet?: '-' | '*';
    taskList: boolean; fenceMarker: string | undefined; body: SourceLine[];
    lazyRootParagraph: boolean }, stack: readonly ListCursorFrame[], depth: number): boolean {
  return mayFoldNestedListParagraph(cursor, frame, stack.length, stack[0]?.contentColumn) ||
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
    body: SourceLine[]; retainedBelowColumnComment: boolean; ordered: boolean },
  depth: number, lineNumber: number, owner: ContainerOwner, stackLength: number): boolean {
  if (!(depth === 0 || depth === 1 &&
      (owner.kind === 'list' || owner.kind === 'quote')) || stackLength !== 1 ||
      top.fenceMarker || top.contentColumn === undefined ||
      marker.indent <= top.indent || marker.indent >= top.contentColumn - 1 ||
      top.body.at(-1)?.number !== lineNumber - 1) return false
  const last = top.body.at(-1)!.text
  if (top.retainedBelowColumnComment) return true
  if (plainQuoteText(last)) return true
  if (owner.kind === 'root' && top.ordered && hasUnclosedListCodeSpan(top.body)) return true
  if (nestedQuoteParagraphText(last)) return true
  const priorMarker = listMarker(last)
  if (depth === 0 && owner.kind === 'root' &&
      priorMarker?.indent === marker.indent && plainQuoteText(priorMarker.content) &&
      top.body.length > 1 && top.body[0]!.text !== '' &&
      plainQuoteText(top.body[0]!.text)) return true
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
  fenceBoundary?: SourceLine;
  quoteFenceMarker: string | undefined; quoteFenceDepth: number; closedQuoteFence: boolean;
  body: SourceLine[];
  blankBeforeInvisible: boolean; lazyRootParagraph: boolean;
  retainedBelowColumnComment: boolean; bareFenceAfterRetainedComment: boolean;
  possibleInvisibleTail: boolean; ownerState?: ItemLazyState }

function sharedQuoteClaimsLine(cursor: Cursor, frame: ListCursorFrame, line: SourceLine,
  marker: ReturnType<typeof listMarker>): boolean {
  if (!frame.ownerState) return false
  const previous = frame.body.at(-1)
  if (cursor.peek(1) && !frame.body[0]?.text.startsWith('>') &&
      previous?.number === line.number - 1 &&
      previous.text.startsWith('>') &&
      FOOTNOTE_DEF.test(previous.text.slice(previous.text[1] === ' ' ? 2 : 1))) {
    throw new UnsupportedCursorSyntax('quoted footnote follower owner')
  }
  if (previous?.number !== line.number - 1) return false
  const quote = frame.ownerState?.quoteInner
  if (!quote) return false
  if (!marker && line.text !== '' && previous.claimedQuoteLazy &&
      blockQuoteParagraphClaimOpen(quote) && plainQuoteText(line.text.trimStart())) return true
  if (!marker && frame.contentColumn !== undefined &&
      line.text.startsWith(' '.repeat(frame.contentColumn)) &&
      RE_HEADING.test(line.text.trimStart()) && blockQuoteParagraphClaimOpen(quote)) return true
  const mode = quote.mode
  const indent = line.text.length - line.text.trimStart().length
  if (mode.kind === 'paragraph' && mode.itemParagraph &&
      (plainQuoteText(line.text.trimStart()) &&
        frame.contentColumn !== undefined && indent < frame.contentColumn - 1 ||
        frame.contentColumn !== undefined && RE_HEADING.test(line.text.trimStart()) &&
          (indent > 0 && indent < frame.contentColumn - 1 ||
            indent >= frame.contentColumn))) return true
  return marker !== undefined && marker.indent > 0 && blockQuoteParagraphClaimOpen(quote)
}

function recordOrderedFenceBoundary(owner: ContainerOwner, stackLength: number,
  orderedRoot: boolean, frame: ListCursorFrame, line: SourceLine): void {
  if (owner.kind === 'root' && stackLength === 1 && orderedRoot &&
      frame.fenceMarker && frame.body.at(-1)?.text === '') frame.fenceBoundary = line
}

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
  line: SourceLine, text: string, strippedPrefix: number,
  marker: string | undefined): boolean {
  if (cursor.owner.kind !== 'root' || frame.fenceMarker ||
      frame.contentColumn === undefined ||
      frame.body.at(-1)?.number !== line.number - 1 ||
      !plainQuoteText(frame.body.at(-1)?.text ?? '') ||
      isBlockStart(frame.body.at(-1)?.text ?? '') || text[0] === ' ' ||
      strippedPrefix !== frame.contentColumn - 1) return false
  if (!marker) return false
  const prefix = ' '.repeat(frame.contentColumn - 1)
  let afterBlank = false
  for (let offset = 0; cursor.peek(offset); offset++) {
    const future = cursor.peek(offset)!.text
    if (future === '') { afterBlank = true; continue }
    if (frame.indent > 0 && !future.startsWith(prefix)) {
      const sibling = listMarker(future)
      if (sibling && sibling.indent <= frame.indent) break
    }
    if (afterBlank && !future.startsWith(prefix)) {
      if (frame.indent > 0 && RE_HEADING.test(future.trimStart())) return false
      break
    }
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
    !listMarker(frame.body[0]?.text ?? '') && !endsOpenQuotedParagraph(frame.body)
}

function continuedListFencePrefix(frame: ListCursorFrame, line: SourceLine, prefix: number): number {
  if (!line.text.startsWith(' '.repeat(frame.fencePrefix!))) {
    if (!frame.fenceMayDedent) throw new UnsupportedCursorSyntax('shifted fence continuation')
    const indent = /^ */.exec(line.text)![0].length
    if (indent > prefix && fenceOpen(line.text.slice(indent))) return indent
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
  text: string, excludeTop = false, knownIndent?: number): T | undefined {
  let indent = knownIndent ?? 0
  if (knownIndent === undefined) while (text.charCodeAt(indent) === 32) indent++
  for (let index = frames.length - 1 - (excludeTop ? 1 : 0); index >= 0; index--) {
    const frame = frames[index]!
    if (frame.contentColumn !== undefined &&
        indent >= frame.contentColumn - 1) return frame
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

function listGapLoosens(cursor: Cursor, body: SourceLine[], text: string, blanks: number,
  prefix: number, nestedContinuation: boolean): boolean {
  if (blanks === 1 && (/^ +:: +/.test(text) ||
      body.at(-2)?.ownedDefinitionBody && RE_BLOCKQUOTE.test(text.trimStart()))) return false
  return blanks > 1 && RE_CAPTION.test(text) ||
    loosensListGap(cursor, body, text, prefix, nestedContinuation)
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

function takeListFrameFootnote(cursor: Cursor, inline: CursorInline, frame: ListCursorFrame,
  depth: number, stackLength: number, ordered: boolean, reachedPrefix: number,
  footnoteDefs?: Record<string, BlockNode[]>,
  footnoteDefPos?: Record<string, Position>): number | undefined {
  const line = cursor.peek()!
  if (!line.text.startsWith('[^', reachedPrefix) || depth !== 0 || stackLength !== 1 ||
      ordered || frame.fenceMarker || frame.item?.children.length !== 0 ||
      !footnoteDefs || !footnoteDefPos) return undefined
  const footnote = FOOTNOTE_DEF.exec(line.text.slice(reachedPrefix))
  if (!footnote || !plainQuoteText(footnote[2] ?? '') ||
      !frame.body.every((part) => isBlankLine(part.text) || plainQuoteText(part.text))) {
    return undefined
  }
  const contentColumn = frame.contentColumn!
  const afterNote = cursor.peek(1)?.text ?? ''
  const ambiguousGap = frame.body.some((part) => isBlankLine(part.text)) &&
    (afterNote.startsWith(' '.repeat(contentColumn - 1)) &&
      plainQuoteText(afterNote.slice(reachedPrefix)) ||
      listMarker(afterNote)?.indent === frame.indent)
  if (ambiguousGap) throw new UnsupportedCursorSyntax('list-owned footnote gap')
  const owned: SourceLine[] = []
  for (let offset = 0; cursor.peek(offset); offset++) {
    const candidate = cursor.peek(offset)!
    if (isBlankLine(candidate.text)) { owned.push({ ...candidate, text: '' }); continue }
    const claim = reachableListPrefix(candidate.text, contentColumn)
    if (claim === undefined) { owned.push(candidate); break }
    owned.push({ ...candidate, text: candidate.text.slice(claim),
      start: candidate.start + claim,
      baseColumn: (candidate.baseColumn ?? 1) + claim })
  }
  if (owned.slice(1).some((part) => LINE_COMMENT.test(part.text.trimStart()) ||
      rootLinkDef(part.text.trimStart()) || FOOTNOTE_DEF.test(part.text.trimStart()) ||
      /^ [^ ]/.test(part.text) && plainQuoteText(part.text.trimStart()))) {
    throw new UnsupportedCursorSyntax('list-owned footnote continuation')
  }
  const nested = new Cursor(owned, undefined, ROOT_OWNER, cursor.physicalLines)
  takeSimpleFootnote(nested, inline, owned[0]!, footnote, footnoteDefs, footnoteDefPos)
  return nested.at
}

function takeListFrameDefinition(cursor: Cursor, inline: CursorInline,
  frame: ListCursorFrame, depth: number, stackLength: number, ordered: boolean,
  reachedPrefix: number): { node: DefinitionList; count: number } | undefined {
  const line = cursor.peek()!
  if (!line.text.startsWith(':: ', reachedPrefix) || depth !== 0 || stackLength !== 1 ||
      ordered || frame.fenceMarker || frame.item?.children.length !== 0 ||
      !frame.body.every((part) => isBlankLine(part.text) || plainQuoteText(part.text))) {
    return undefined
  }
  const contentColumn = frame.contentColumn!
  if (!cursor.peek(1)?.text.startsWith(' '.repeat(contentColumn - 1) + ': ')) return undefined
  const definitionLine = cursor.peek(1)!.text.slice(contentColumn - 1)
  const definitionBody = /^: +[ \t]*([^ \t].*)$/.exec(definitionLine)
  if (!definitionBody) return undefined
  const definitionBodyPrefix = definitionLine.length - definitionBody[1]!.length
  const owned: SourceLine[] = []
  for (let offset = 0; cursor.peek(offset); offset++) {
    const part = cursor.peek(offset)!
    if (isBlankLine(part.text)) { owned.push({ ...part, text: '' }); continue }
    const claim = reachableListPrefix(part.text, contentColumn)
    if (claim === undefined) { owned.push(part); break }
    const text = part.text.slice(claim)
    const indent = /^ */.exec(text)![0].length
    if (offset > 1 && indent < definitionBodyPrefix &&
        (RE_BLOCKQUOTE.test(text.slice(indent)) || RE_HEADING.test(text.slice(indent)))) break
    owned.push({ ...part, text, start: part.start + claim,
      baseColumn: (part.baseColumn ?? 1) + claim })
  }
  if (owned.slice(2).some((part) => rootLinkDef(part.text.trimStart()) ||
      /^: +/.test(part.text))) {
    throw new UnsupportedCursorSyntax('list-owned definition boundary')
  }
  const nested = new Cursor(owned, undefined, childOwner(cursor.owner, 'definition'),
    cursor.physicalLines)
  const node = parseSimpleDefinitionList(nested, inline, undefined, depth + 1)
  return { node, count: nested.at }
}

function listFrameDefinitionAction(cursor: Cursor, inline: CursorInline,
  frame: ListCursorFrame, stack: ListCursorFrame[], depth: number, ordered: boolean,
  reachedPrefix: number, definitionNodes: BlockNode[],
  listSpan: (from: SourceLine, to: SourceLine, column: number) => Position):
  (() => void) | undefined {
  const line = cursor.peek()!
  const link = cursor.simpleRootListDefinitions?.get(line.number)
  if (link) return () => takeLinkDefinitionAtCursor(cursor, inline,
    definitionNodes, true, link)
  if (line.text[reachedPrefix] !== ':') return undefined
  const definition = takeListFrameDefinition(cursor, inline,
    frame, depth, stack.length, ordered, reachedPrefix)
  if (!definition) return undefined
  return () => {
    frame.item!.children.push(definition.node)
    let last = line
    for (let offset = 0; offset < definition.count; offset++) last = cursor.take()
    updateListFrameEnds(stack, last, listSpan)
    frame.lazyRootParagraph = false
  }
}

function collectMarkerLineLinkDefinition(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], frame: ListCursorFrame, line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>, depth: number): void {
  if (cursor.owner.kind !== 'root' || depth !== 0) return
  const definition = cursor.simpleRootListDefinitions?.get(line.number)
  if (!definition || !rootLinkDef(marker.content)) return
  frame.body = []
  frame.possibleInvisibleTail = true
  takeLinkDefinitionAtCursor(new Cursor([line], undefined, cursor.owner,
    cursor.physicalLines), inline, definitionNodes, true, definition)
}

function shiftedColonAtListFrame(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, prefixLength: number): ReturnType<typeof shiftedClosedListColon> {
  if (stackLength !== 1 || frame.fenceMarker || beginsOpenQuotedParagraph(frame.body)) {
    return undefined
  }
  return shiftedClosedListColon(cursor, prefixLength)
}

function parseList(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number,
  first: SourceLine, firstMarker: NonNullable<ReturnType<typeof listMarker>>,
  footnoteDefs?: Record<string, BlockNode[]>, footnoteDefPos?: Record<string, Position>): List {
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
    const spanColumn = cursor.owner.kind === 'colon' && line.baseColumn === undefined ? 1 :
      Math.min(marker.indent + 1, hostColumn, marker.authoredIndent + 1)
    list.pos = listSpan(line, line, spanColumn)
    return { list, first: line, last: line,
      indent: marker.indent, spanColumn,
      ordered: marker.ordered,
      taskList: isTaskMarkerContent(marker.content, marker.ordered),
      ...(kind ? { kind } : {}),
      ...(marker.delim ? { delim: marker.delim } : {}),
      ...(marker.bullet ? { bullet: marker.bullet } : {}), fenceMarker: undefined,
      fencePrefix: undefined, fenceMayDedent: false,
      quoteFenceMarker: undefined, quoteFenceDepth: 0, closedQuoteFence: false,
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
    if (placedEndLine && placedEndLine > frame.last.number) {
      const placed = cursor.physicalLines[placedEndLine - 1]
      if (placed) {
        frame.last = { ...placed, text: '' }
        frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
      }
    }
    if (placedEndLine && placedEndLine < frame.last.number) {
      const placed = cursor.physicalLines[placedEndLine - 1]
      if (placed) {
        frame.last = placed
        frame.item.pos = listSpan(frame.itemFirst, placed, frame.spanColumn)
      }
    }
    const lastChild = frame.item.children.at(-1)
    if (lastChild?.type === 'block_quote' && lastChild.children.length === 0 &&
        lastChild.pos?.endLine === frame.last.number &&
        lastChild.pos.endColumn !== undefined &&
        lastChild.pos.endColumn < contentEndColumn(frame.last)) {
      frame.last = { ...frame.last, spanEndColumn: lastChild.pos.endColumn }
      frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
    }
    if (lastChild?.type === 'list' && placedEndLine === frame.last.number &&
        frame.itemFirst.number === frame.last.number && frame.last.text.endsWith('+') &&
        lastChild.pos?.endColumn !== undefined &&
        lastChild.pos.endColumn < contentEndColumn(frame.last)) {
      frame.last = { ...frame.last, spanEndColumn: lastChild.pos.endColumn }
      frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
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
    if (frame.body.length > 1 && firstText[0] === '{' &&
        !frame.body[0]!.wrappedAttr && !parseBlockAttributeRun(firstText) &&
        probeBlockAttributes(lexerForCursor(new Cursor(frame.body)))) {
      frame.body[0] = { ...frame.body[0]!, wrappedAttr: true }
      frame.possibleInvisibleTail = true
    }
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
    if (frame.body.length === 1 && plainQuoteText(firstText) && !frame.body[0]!.lazyText &&
        !frame.body[0]!.wrappedAttr) {
      const line = frame.body[0]!
      frame.item.children.push({ type: 'paragraph',
        children: inline.inlines([{ line, column: 1, text: line.text }]),
        pos: position(line, line, 1, line.text.replace(/[ \t]+$/, '').length + 1) })
    } else if (frame.body.length > 1 && !frame.body[0]!.wrappedAttr && frame.body.every((line) =>
      !line.lazyText && plainQuoteText(line.text))) {
      const first = frame.body[0]!
      const last = frame.body.at(-1)!
      frame.item.children.push({ type: 'paragraph',
        children: inline.inlines(frame.body.map((line) => ({ line, column: 1, text: line.text }))),
        pos: position(first, last, 1, last.text.replace(/[ \t]+$/, '').length + 1) })
    } else {
      const unclosedAfterNestedList = cursor.owner.kind === 'root' &&
        frame.item.children.at(-1)?.type === 'list' &&
        fenceOpen(frame.body[0]!.text) !== null &&
        frame.body.at(-1)?.number === cursor.physicalLines.at(-1)?.number
      frame.item.children.push(...parseBlocks(
        new Cursor(frame.body, undefined, childOwner(cursor.owner, 'list', allowEmptyFence,
          frame.fenceMayDedent || cursor.owner.allowUnclosedFence || unclosedAfterNestedList,
          frame.fenceBoundary ?? cursor.owner.fenceBoundary,
          cursor.owner.kind === 'root' ? firstMarker.width : undefined),
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
    if (frame.indent > 0 && !frame.fenceMarker && text[0] === '`' &&
        frame.body.some((prior) => prior.lazyText && /^`{3,}/.test(prior.text)) &&
        entersOpenListCodeSpan(frame.body, text, frame.contentColumn)) {
      line = { ...line, lazyText: true }
      rootLazy = true
    }
    const codeFenceMarker = (text[0] === '`' || text[0] === '~') ? fenceOpen(text)?.marker : undefined
    const literalFence = (frame.indent === 0 || text[0] === '`' || text[0] === '~') &&
      listFenceStaysInParagraph(cursor, frame, line, text, prefix, codeFenceMarker)
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
      ...(line.claimedQuoteLazy ? { claimedQuoteLazy: true } : {}),
      ...(line.ownedDefinition ? { ownedDefinition: true } : {}),
      ...(line.ownedDefinitionBody ? { ownedDefinitionBody: true } : {}),
      ...(line.ownedFirstBlock ? { ownedFirstBlock: true } : {}),
      ...(line.wrappedAttr ? { wrappedAttr: true } : {}) })
    if (frame.ownerState || text.startsWith('>')) {
      const state = frame.ownerState ??= verbatimOnlyLazyState()
      if (line.claimedQuoteLazy && state.quoteInner) {
        const inner = state.quoteInner.mode
        if (inner.kind !== 'paragraph' || !inner.itemParagraph ||
            !RE_HEADING.test(text.trimStart())) {
          trackBlockQuoteLazyState(text, state.quoteInner, () => false, () => false)
        }
      } else {
        trackItemLazyState(text, state, () => false)
      }
    }
    if (frame.quoteFenceMarker && text[0] === '>') {
      const inner = quotedFencePayload(text, frame.quoteFenceDepth)
      if (inner !== undefined && closesFence(inner, frame.quoteFenceMarker)) {
        frame.quoteFenceMarker = undefined
        frame.closedQuoteFence = true
      }
    } else if (frame.closedQuoteFence &&
        (text === '' || text[0] === '>' || isBlockStart(text))) {
      frame.closedQuoteFence = false
      frame.quoteFenceDepth = 0
    } else if (frame.body.length === 1 && text[0] === '>') {
      const opened = quotedFenceOpener(text)
      frame.quoteFenceMarker = opened?.marker
      frame.quoteFenceDepth = opened?.depth ?? 0
    }
    if (frame.fenceMarker) {
      if (closesFence(text, frame.fenceMarker)) {
        frame.fenceMarker = undefined
        frame.fencePrefix = undefined
        frame.fenceMayDedent = false
      }
    } else {
      const marker = RE_RAW_FENCE.exec(text)?.[1] ?? codeFenceMarker
      if (marker && !literalFence && !line.lazyText) {
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
      updateListFrameEnds(stack, line, listSpan)
    }
  }
  const takeNestedFirstFence = (frame: ListCursorFrame): boolean => {
    const end = nestedFirstFenceEnd(cursor, frame, stack.length, depth)
    if (end === undefined) return false
    for (let offset = 0; offset <= end; offset++) {
      const owned = cursor.take()
      appendBody(frame, owned, 0)
      updateListFrameEnds(stack, owned, listSpan)
    }
    return true
  }
  const takeNestedFirstBlock = (frame: ListCursorFrame, line: SourceLine): boolean => {
    if (takeNestedFirstFence(frame)) return true
    if (nestedQuoteFirstHeading(cursor, frame, stack.length, depth)) {
      cursor.take()
      appendBody(frame, line, 0)
      updateListFrameEnds(stack, line, listSpan)
      return true
    }
    if (!nestedSimpleFirstBlock(cursor, frame, stack.length, depth)) return false
    cursor.take()
    const prefix = stack.length === 2 && line.text.startsWith(' '.repeat(frame.indent)) ?
      frame.indent : 0
    const ownedFirstBlock = listMarker(frame.body[0]?.text ?? '')?.content === '> +' ||
      frame.body[0]?.text === '> > +'
    appendBody(frame, ownedFirstBlock ? { ...line, ownedFirstBlock: true } : line, prefix)
    updateListFrameEnds(stack, line, listSpan)
    return true
  }
  const retainFenceSiblingBlanks = (frame: ListCursorFrame,
    target: ListCursorFrame | undefined, sibling: boolean | undefined, count: number): boolean => {
    if (!frame.fenceMarker || !sibling || target !== frame) return false
    for (let index = 0; index < count; index++) {
      const blank = cursor.take()
      appendBody(frame, blank, 0)
      updateListFrameEnds(stack, blank, listSpan)
    }
    frame.list.tight = false
    return true
  }
  const retainFenceBoundaryBlanks = (frame: ListCursorFrame, count: number,
    next: SourceLine | undefined): boolean => {
    const finalFence = frame.fenceMarker && !next && cursor.owner.allowUnclosedFence &&
      cursor.owner.fenceBoundary
    const nextMarker = next && listMarker(next.text)
    const differentRootBullet = frame.fenceMarker && stack.length === 1 && count === 1 &&
      cursor.owner.kind === 'root' && nextMarker?.indent === frame.indent &&
      !frame.ordered && nextMarker.bullet !== frame.bullet
    let nestedRootFence = false
    if (!finalFence && stack.length === 1 && count === 1 && frame.body.length === 1 &&
        next && plainQuoteText(next.text) &&
        (!cursor.peek(count + 1) || cursor.peek(count + 1)!.text === '')) {
      const nestedFirst = listMarker(frame.body[0]!.text)
      nestedRootFence = nestedFirst !== undefined && fenceOpen(nestedFirst.content) !== null
    }
    if (!finalFence && !nestedRootFence && !differentRootBullet) return false
    for (let index = 0; index < count; index++) {
      const blank = cursor.take()
      appendBody(frame, blank, 0)
      updateListFrameEnds(stack, blank, listSpan)
    }
    if (nestedRootFence || differentRootBullet) {
      frame.fenceMayDedent = true
      if (next) frame.fenceBoundary = next
    }
    return true
  }
  const takeFenceBlank = (frame: ListCursorFrame, count: number,
    next: SourceLine | undefined): 'break' | 'continue' | undefined => {
    if (retainFenceBoundaryBlanks(frame, count, next)) return 'break'
    if (!isFenceBlankContinuation(cursor, frame, next, stack.length, depth)) return undefined
    for (let index = 0; index < count; index++) {
      const blank = cursor.take()
      appendBody(frame, blank, 0)
      updateListFrameEnds(stack, blank, listSpan)
    }
    return 'continue'
  }
  const continuationOwner = (line: SourceLine): ListCursorFrame => {
    const top = stack.at(-1)!
    if (line.text !== '+' || top.fenceMarker || stack.length < 2) return top
    let owner: ListCursorFrame | undefined
    for (let index = stack.length - 2; index >= 0; index--) {
      if (stack[index]!.indent === 0) { owner = stack[index]; break }
    }
    if (!owner) return top
    while (stack.at(-1) !== owner) {
      const done = stack.pop()!
      flush(done)
      done.list.pos = listSpan(done.first, done.last, done.spanColumn)
    }
    return owner
  }
  while (cursor.peek()) {
    const line = cursor.peek()!
    if (line.quoteResume) break
    const marker = listMarker(line.text)
    const inlineFence = unclosedNestedInlineFence(cursor, stack.at(-1)!, stack.length)
    if (inlineFence) {
      const frame = stack.at(-1)!
      for (const prefix of inlineFence) {
        const owned = cursor.take()
        appendBody(frame, { ...owned, lazyText: true }, prefix, true)
        updateListFrameEnds(stack, owned, listSpan)
      }
      continue
    }
    rejectAmbiguousNestedPlus(cursor, marker)
    const top = continuationOwner(line)
    if (sharedQuoteClaimsLine(cursor, top, line, marker)) {
      cursor.take()
      appendBody(top, { ...line, lazyText: true, claimedQuoteLazy: true }, 0, true)
      updateListFrameEnds(stack, line, listSpan)
      continue
    }
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
    const fenceContinuation = listFenceContinuationClaim(marker, top, line,
      cursor.owner, stack.length, firstMarker.ordered)
    if (fenceContinuation) {
      cursor.take()
      appendBody(top, fenceContinuation.line, fenceContinuation.prefix)
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
      delete current.ownerState
      current.possibleInvisibleTail = false
      current.lazyRootParagraph = false
      current.retainedBelowColumnComment = false
      current.fenceMarker = undefined
      current.fencePrefix = undefined
      current.fenceMayDedent = false
      delete current.fenceBoundary
      current.quoteFenceMarker = undefined
      current.quoteFenceDepth = 0
      current.closedQuoteFence = false
      appendBody(current, line, marker.width + taskWidth)
      collectMarkerLineLinkDefinition(cursor, inline, definitionNodes, current, line, marker, depth)
      const firstBlock = takeListFirstBlock(cursor, marker, taskWidth, depth, current.contentColumn)
      const refusedFirstBlock = !firstBlock && isRefusedListFirstBlock(marker, taskWidth,
        cursor.peek(), depth, cursor.owner)
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
      const fenceBlank = takeFenceBlank(top, blanks, next)
      if (fenceBlank === 'break') break
      if (fenceBlank === 'continue') continue
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
      if (retainFenceSiblingBlanks(top, target, sibling, blanks)) continue
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
        if (listGapLoosens(cursor, continuationFrame.body, blockText, blanks,
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
    if (attachedListFenceCaption(top, line, cursor.owner, stack.length, reachedPrefix)) {
      cursor.take()
      appendBody(top, line, 0)
      updateListFrameEnds(stack, line, listSpan)
      continue
    }
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
      appendBody(top, foldedNestedParagraphLine(top.body, line), 0, true)
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
      recordOrderedFenceBoundary(cursor.owner, stack.length, firstMarker.ordered, top, line)
      releaseRootListFenceAtBoundary(top, cursor.owner, stack.length)
      break
    }
    const footnoteLines = takeListFrameFootnote(cursor, inline, top, depth, stack.length,
      firstMarker.ordered, reachedPrefix, footnoteDefs, footnoteDefPos)
    if (footnoteLines !== undefined) {
      flush(top)
      for (let offset = 0; offset < footnoteLines; offset++) cursor.take()
      top.lazyRootParagraph = false
      continue
    }
    const definitionAction = listFrameDefinitionAction(cursor, inline, top, stack, depth,
      firstMarker.ordered, reachedPrefix, definitionNodes, listSpan)
    if (definitionAction) {
      flush(top)
      definitionAction()
      continue
    }
    const shiftedColon = shiftedColonAtListFrame(cursor, top, stack.length, prefix.length)
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
    const claim = listContinuationClaim(top, line, bodyPrefix, reachedPrefix, cursor.peek(1))
    cursor.take()
    appendBody(top, claim.line, claim.prefix)
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
  const opener = /^( +)(`{3,})(?:[A-Za-z][\w-]*)?[ \t]*$/.exec(cursor.peek()?.text ?? '')
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
  for (let index = 0; index < body.length - 1; index++) {
    const line = body[index]!
    if (line.text[0] !== '{' || parseBlockAttributeRun(line.text)) continue
    if (!probeBlockAttributes(lexerForCursor(new Cursor(body.slice(index))))) continue
    body[index] = { ...line, wrappedAttr: true }
    directParagraph = false
  }
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

interface QuoteListOwnerFrame { contentColumn: number; fence: string | undefined }

class QuoteListOwner {
  readonly frames: QuoteListOwnerFrame[] = []
  releasedFence = false
  shiftedFence = false

  observe(text: string): boolean {
    if (text === '') return false
    let indent = 0
    while (text.charCodeAt(indent) === 32) indent++
    let released = false
    const reached = deepestReachableFrame(this.frames, text, false, indent)
    while (this.frames.length && this.frames.at(-1) !== reached) {
      const old = this.frames.pop()!
      released ||= old.fence !== undefined
      this.releasedFence ||= old.fence !== undefined
    }
    const top = this.frames.at(-1)
    const owned = top && indent >= top.contentColumn - 1 ?
      text.slice(top.contentColumn - 1) : text
    if (top?.fence) {
      if (indent === top.contentColumn - 1 && closesFence(owned, top.fence)) top.fence = undefined
      return false
    }
    const marker = listMarker(text)
    if (marker && (!top || marker.indent >= top.contentColumn - 1)) {
      const frame: QuoteListOwnerFrame = { contentColumn: marker.width + 1,
        fence: fenceOpen(marker.content)?.marker }
      this.frames.push(frame)
      return false
    }
    if (top && indent > top.contentColumn - 1 && fenceOpen(text.slice(indent))) this.shiftedFence = true
    if (top && indent === top.contentColumn - 1) top.fence = fenceOpen(owned)?.marker
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
  return plain || indentedLiteralAbbreviation(text) || nestedQuoteParagraphText(text) ||
    /^ (?:\[|\{)/.test(text) ||
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
    (depth === 1 || depth === 2 && cursor.owner.parent?.kind === 'quote' ||
      cursor.peek(1)?.ownedFirstBlock === true)
  const nestedQuote = depth === 1 && cursor.owner.kind === 'quote'
  const ownedNested = cursor.owner.kind === 'quote' && cursor.peek(1)?.ownedFirstBlock === true
  if (depth === 0 || markerLineNested || nestedQuote || ownedNested) {
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
  if (!(depth === 0 || markerLineNested || nestedQuote || ownedNested)) return undefined
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  if (!follower || !(plainQuoteText(follower.text) || RE_HEADING.test(follower.text) ||
      isTableRow(follower.text) || (markerLineNested || ownedNested) &&
      RE_BLOCKQUOTE.test(follower.text)) ||
      after && !isBlankLine(after.text)) return undefined
  cursor.take()
  cursor.take()
  return { type: 'block_quote',
    children: parseBlocks(new Cursor([follower], undefined, childOwner(cursor.owner, 'quote'),
      cursor.physicalLines),
      inline, definitionNodes, depth + 1, false),
    pos: position(first, follower, 1, contentEndColumn(follower)) }
}

function takeQuotedColonDefinitionTail(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  if (!line || openColonRun(body, false) === undefined || !/^ +>/.test(line.text)) {
    return undefined
  }
  const afterMarker = line.text.trimStart().replace(/^> ?/, '')
  if (rootLinkDef(afterMarker) || FOOTNOTE_DEF.test(afterMarker) || ABBR_DEF.test(afterMarker)) {
    throw new UnsupportedCursorSyntax('quoted colon definition owner')
  }
  const owned = cursor.take()
  const prefix = /^ +/.exec(owned.text)![0].length
  body.push({ text: owned.text.slice(prefix), start: owned.start + prefix,
    number: owned.number, baseColumn: (owned.baseColumn ?? 1) + prefix, lazyText: true })
  return owned
}

function takeQuotedListLiteralTail(cursor: Cursor, body: SourceLine[],
  listOwner: QuoteListOwner | undefined): SourceLine | undefined {
  const line = cursor.peek()
  const last = body.at(-1)?.text ?? ''
  const literalDefinition = /^ +> {2,}\[[^\]]+\]: +\S/.test(last)
  if (!listOwner || !(indentedLiteralAbbreviation(last) || literalDefinition) ||
      !line || !plainQuoteText(line.text) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
  body.push(cursor.take())
  return line
}

function takeIndentedColonQuoteTail(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  if (!line || !indentedLiteralColon(body.at(-1)?.text ?? '') ||
      !/^ +:::$/.test(line.text) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
  body.push(cursor.take())
  return line
}

function quotedContinuationFollower(cursor: Cursor, body: SourceLine[]): boolean {
  const next = cursor.peek(1)?.text ?? ''
  return listMarker(next)?.indent === 0 ||
    body.at(-1)?.text === '' && plainQuoteText(next) ||
    cursor.owner.kind === 'quote' && listMarker(body.at(-1)?.text ?? '') !== undefined &&
      plainQuoteText(next)
}

function quotedOwnedBodyLine(line: SourceLine, body: SourceLine[], prefix: number,
  text: string): SourceLine {
  if (line.ownedFirstBlock && body.at(-1)?.text === '> +') return line
  return { text, start: line.start + prefix, number: line.number,
    baseColumn: (line.baseColumn ?? 1) + prefix,
    ...(line.ownedFirstBlock ? { ownedFirstBlock: true } : {}) }
}

function canAttachQuoteContinuation(cursor: Cursor, body: SourceLine[], line: SourceLine): boolean {
  if (cursor.owner.inList || line.text !== '+' || body.length === 0) return false
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  const plain = plainQuoteText(follower?.text ?? '')
  const firstBody = body[0]
  const nestedQuote = body.length === 1 && firstBody !== undefined &&
    firstBody.number === cursor.lines[0]?.number && plainQuoteText(firstBody.text) &&
    follower?.text[0] === '>' && RE_BLOCKQUOTE.test(follower.text) &&
    (!after || isBlankLine(after.text))
  const quotedAfter = after?.text[0] === '>' && RE_BLOCKQUOTE.test(after.text) ?
    after.text.slice(after.text[1] === ' ' ? 2 : 1) : undefined
  const attachedMarker = listMarker(follower?.text ?? '')
  const resumedMarker = listMarker(quotedAfter ?? '')
  const sameAttachedList = attachedMarker?.indent === 0 && resumedMarker?.indent === 0 &&
    attachedMarker.ordered === resumedMarker.ordered &&
    attachedMarker.bullet === resumedMarker.bullet && attachedMarker.delim === resumedMarker.delim &&
    !('attrs' in attachedMarker) && !('attrs' in resumedMarker) &&
    plainQuoteText(attachedMarker.content) && plainQuoteText(resumedMarker.content)
  const afterResumedList = cursor.peek(3)?.text
  const boundedResumedList = sameAttachedList &&
    (!afterResumedList || isBlankLine(afterResumedList))
  return (quotedContinuationFollower(cursor, body) || plain || nestedQuote) &&
    (!after || isBlankLine(after.text) ||
      attachedMarker?.indent === 0 && quotedAfter !== undefined &&
        (!resumedMarker || boundedResumedList) ||
      plain && isBlockStart(after.text) && !RE_BLOCKQUOTE.test(after.text))
}

function takeQuoteLazyBoundaryTail(cursor: Cursor, body: SourceLine[],
  wrappedAttributeTail: boolean, inlineCode: SourceLine[] | undefined,
  listOwner: QuoteListOwner | undefined, directParagraph: boolean): SourceLine[] | undefined {
  if (!quoteNeedsLazyBoundary(cursor.peek()?.text, body.at(-1)?.text,
    wrappedAttributeTail, inlineCode)) return undefined
  if (body.length === 1 && plainQuoteText(body[0]!.text) &&
      cursor.peek()?.text === '+' && !cursor.peek(1)) {
    return [{ ...cursor.take(), lazyText: true }]
  }
  const tableLine = (text: string): string => text.replace(/^(?:> ?)+/, '')
  const joinedTableEnd = body.length === 2 &&
    /^\|.*\|[ \t]*$/.test(tableLine(body[0]!.text)) &&
    /^\+.*\|/.test(tableLine(body[1]!.text))
  const nestedLazy = !inlineCode && !tableLine(body[0]?.text ?? '').startsWith('|') &&
    body.at(-1)?.text.startsWith('>') &&
    !directParagraph && plainQuoteText(cursor.peek()?.text ?? '') &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))
  if (nestedLazy) return [{ ...cursor.take(), lazyText: true }]
  if (!inlineCode && !(listOwner?.openFence && !listOwner.shiftedFence) && !joinedTableEnd) {
    throw new UnsupportedCursorSyntax('lazy quote continuation')
  }
  return inlineCode
}

function isRootDefinitionOnlyQuote(cursor: Cursor, children: BlockNode[], body: SourceLine[]): boolean {
  return cursor.owner.kind === 'root' && children.length === 0 && body.length > 1 &&
    body.every((line) => rootLinkDef(line.text) !== null || FOOTNOTE_DEF.test(line.text))
}

function isSingleDefinitionOnlyQuote(children: BlockNode[], body: SourceLine[]): boolean {
  return children.length === 0 && body.length === 1 &&
    (rootLinkDef(body[0]!.text) !== null || FOOTNOTE_DEF.test(body[0]!.text))
}

function rejectOverindentedQuotedColon(cursor: Cursor, first: SourceLine): void {
  const follower = cursor.peek(1)?.text
  if (/^>  +:{3,}/.test(first.text) && follower &&
      !follower.startsWith('>') && !follower.startsWith(' ')) {
    throw new UnsupportedCursorSyntax('overindented quoted colon owner')
  }
}

function takeLeadingPlusQuoteFollower(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  if (body.length !== 1 || body[0]!.text !== '+') return undefined
  const line = cursor.peek()
  if (!line?.text.startsWith(' ') || !plainQuoteText(line.text.trimStart()) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
  return cursor.take()
}

function parseQuote(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number): BlockQuote {
  const first = cursor.peek()!
  rejectOverindentedQuotedColon(cursor, first)
  const firstBlock = takeQuoteFirstBlock(cursor, inline, definitionNodes, depth)
  if (firstBlock) return firstBlock
  const body: SourceLine[] = []
  let last = first
  let plainParagraph = true
  let directParagraph = true
  let unclosedFenceParagraph = false
  let quotedListRun = false
  let firstFence = false
  let listOwner: QuoteListOwner | undefined
  let attachedListReturn = false
  while (cursor.peek()) {
    const line = cursor.peek()!
    const leadingPlusFollower = takeLeadingPlusQuoteFollower(cursor, body)
    if (leadingPlusFollower) {
      last = leadingPlusFollower
      body.push(leadingPlusFollower)
      directParagraph = false
      continue
    }
    if (line.claimedQuoteLazy) {
      last = cursor.take()
      body.push(last)
      directParagraph = false
      continue
    }
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
      const owned = quotedOwnedBodyLine(line, body, prefix, text)
      body.push(attachedListReturn ? { ...owned,
        ...(listMarker(text) ? { quotedAttachedSibling: true } : { quoteResume: true }) } : owned)
      attachedListReturn = false
      if (body.length === 1) firstFence = fenceOpen(text) !== null
      const plain: boolean = literalFence || plainQuoteText(text)
      const observed = observeQuoteListOwner(listOwner, cursor.owner, text, body.length === 1)
      listOwner = observed.owner
      directParagraph &&= plain
      plainParagraph = plain && !firstFence || observed.resumed ||
        plainParagraph && quotedParagraphText(text, plain)
      last = line
      continue
    }
    const definitionTail = takeDefinitionQuoteTail(cursor, body)
    if (definitionTail) {
      directParagraph = false
      last = definitionTail
      continue
    }
    const unmarked = takeUnmarkedQuoteParagraphLine(cursor, body, unclosedFenceParagraph)
    if (unmarked) {
      last = unmarked
      continue
    }
    const nestedListLazy = takeNestedQuoteListLazyLine(cursor, body)
    if (nestedListLazy) {
      directParagraph = false
      plainParagraph = false
      last = nestedListLazy
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
    const colonTail = takeQuotedColonDefinitionTail(cursor, body)
    if (colonTail) {
      directParagraph = false
      last = colonTail
      continue
    }
    if (canAttachQuoteContinuation(cursor, body, line)) {
      const marker = cursor.take()
      body.push({ ...marker, text: '' })
      const attached = cursor.take()
      body.push(attached)
      attachedListReturn = listMarker(attached.text)?.indent === 0
      last = attached
      plainParagraph = false
      directParagraph = false
      continue
    }
    const attachedList = line.text === '+' && listMarker(cursor.peek(1)?.text ?? '')?.indent === 0
    const quotedAfterList = cursor.peek(2)?.text
    if (attachedList && quotedAfterList?.startsWith('>') &&
        RE_BLOCKQUOTE.test(quotedAfterList) &&
        !plainQuoteText(quotedAfterList.slice(quotedAfterList[1] === ' ' ? 2 : 1))) {
      throw new UnsupportedCursorSyntax('quote owner after attached list')
    }
    const abbreviationTail = takeQuotedListLiteralTail(cursor, body, listOwner)
    if (abbreviationTail) {
      directParagraph = false
      last = abbreviationTail
      continue
    }
    const colonLiteralTail = takeIndentedColonQuoteTail(cursor, body)
    if (colonLiteralTail) {
      directParagraph = false
      last = colonLiteralTail
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
  const lazyTail = takeQuoteLazyBoundaryTail(cursor, body,
    !!wrappedAttributeTail, inlineCode, listOwner, directParagraph)
  if (lazyTail) {
    body.push(...lazyTail)
    directParagraph = false
    last = lazyTail.at(-1)!
  }
  const children = quoteChildrenAtCursor(cursor, inline, definitionNodes, depth, body,
    directParagraph, listOwner?.boundaryFence)
  const onlyDefinition = isSingleDefinitionOnlyQuote(children, body)
  const onlyRootDefinitions = isRootDefinitionOnlyQuote(cursor, children, body)
  const placedEndLine = children.at(-1)?.pos?.endLine
  const quoteLast = onlyRootDefinitions ? first : placedEndLine && placedEndLine < last.number ?
    cursor.physicalLines[placedEndLine - 1] ?? last : last
  const markerEnd = first.text[1] === ' ' ? 3 : 2
  return { type: 'block_quote', children,
    pos: position(first, quoteLast, 1, onlyDefinition || onlyRootDefinitions ?
      markerEnd : contentEndColumn(quoteLast)) }
}

function closesColonOwner(text: string, width: number): boolean {
  let offset = 0
  while (text[offset] === ':') offset++
  if (offset !== width) return false
  while (offset < text.length) {
    if (text[offset] !== ' ' && text[offset] !== '\t') return false
    offset++
  }
  return true
}

function takeColonBody(cursor: Cursor, openerLength: number): SourceLine[] {
  const body: SourceLine[] = []
  const nestedClosers: number[] = []
  let opaqueFence: string | undefined
  while (cursor.peek()) {
    const text = cursor.peek()!.text
    if (opaqueFence) {
      const structuralCloser = closesColonOwner(text, nestedClosers.at(-1) ?? openerLength) &&
        !hasLaterFenceCloser(cursor, opaqueFence)
      if (!structuralCloser) {
        body.push(cursor.take())
        if (closesFence(text, opaqueFence)) opaqueFence = undefined
        continue
      }
      opaqueFence = undefined
    }
    const firstChar = text[0]
    const openingFence = firstChar === '`' || firstChar === '~' ?
      fenceOpen(text)?.marker ?? RE_RAW_FENCE.exec(text)?.[1] : undefined
    if (openingFence) {
      opaqueFence = openingFence
      body.push(cursor.take())
      continue
    }
    if (closesColonOwner(text, nestedClosers.at(-1) ?? openerLength)) {
      if (nestedClosers.length === 0) break
      nestedClosers.pop()
      body.push(cursor.take())
      continue
    }
    const nested = text[0] === ':' ? COLON_OPEN.exec(text) ?? RE_DIV_OPEN.exec(text) ??
      RE_VALID_ADMONITION_OPEN.exec(text) ?? RE_ADMONITION_OPEN.exec(text) ??
      RE_LINE_BLOCK_OPEN.exec(text) ?? RE_QUOTE_BLOCK_OPEN.exec(text) ??
      RE_HARDBREAKS_OPEN.exec(text) : null
    if (nested) {
      nestedClosers.push(nested[1]!.length)
    } else if (text.startsWith(':::')) throw new UnsupportedCursorSyntax('nested colon container')
    body.push(cursor.take())
  }
  if (opaqueFence) throw new UnsupportedCursorSyntax('unclosed colon literal ownership')
  if (!cursor.peek() && body.some((line) => RE_FENCE.test(line.text))) {
    throw new UnsupportedCursorSyntax('unclosed colon literal ownership')
  }
  return body
}

function boundedColonFence(body: SourceLine[], cursor: Cursor, run: number): SourceLine | undefined {
  let openerIndex = 0
  while (openerIndex < body.length) {
    const text = body[openerIndex]!.text
    if (text === '' || LINE_COMMENT.test(text) && !RE_COMMENT_BLOCK_ANY.test(text) ||
        (text[0] === '{' || text[0] === ' ' || text[0] === '\t') &&
        parseBlockAttributeRun(text)) openerIndex++
    else break
  }
  const opener = body[openerIndex] && fenceOpen(body[openerIndex]!.text)
  const boundary = cursor.peek()
  if (!opener || !boundary || !new RegExp(`^:{${run}}[ \t]*$`).test(boundary.text)) return undefined
  for (let i = openerIndex + 1; i < body.length; i++) {
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

function boundedListDedentFence(cursor: Cursor, first: SourceLine,
  payload: SourceLine[], marker: string): boolean {
  if (cursor.owner.kind !== 'list' || cursor.owner.listRootPrefix === undefined ||
      payload.length === 0) return false
  const next = cursor.physicalLines[payload.at(-1)!.number]
  const closer = cursor.physicalLines[payload.at(-1)!.number + 1]
  if (!next || !closer || !plainQuoteText(next.text.trimStart())) return false
  const prefix = cursor.owner.listRootPrefix
  const ownerPrefix = Math.max(prefix, (first.baseColumn ?? 1) - 1)
  const indent = /^ */.exec(next.text)![0].length
  const closerIndent = /^ */.exec(closer.text)![0].length
  return indent < prefix && (closerIndent === prefix || closerIndent === ownerPrefix) &&
    closesFence(closer.text.slice(closerIndent), marker) &&
    (!cursor.physicalLines[closer.number] || cursor.physicalLines[closer.number]!.text === '')
}

function boundedListEofFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  const last = payload.at(-1)
  return cursor.owner.kind === 'list' && cursor.lines[0]?.number === first.number &&
    last?.text === '' && last.number === cursor.physicalLines.at(-1)?.number
}

function boundedListSiblingFence(cursor: Cursor, payload: SourceLine[]): SourceLine | undefined {
  const last = payload.at(-1)
  if (cursor.owner.kind !== 'list' || cursor.owner.listRootPrefix === undefined ||
      !last || last.text !== '') return undefined
  const next = cursor.physicalLines[last.number]
  return next && listMarker(next.text)?.indent === 0 ? { ...next, text: '' } : undefined
}

function boundedPostBreakEmptyFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  const index = cursor.lines.indexOf(first)
  return cursor.owner.kind === 'list' && payload.length === 0 && index > 0 &&
    BREAK.test(cursor.lines[index - 1]!.text) &&
    first.number === cursor.physicalLines.at(-1)?.number
}

function takeFenceCloseAtCursor(cursor: Cursor, first: SourceLine, payload: SourceLine[]): SourceLine {
  if (cursor.peek()) return cursor.take()
  const marker = fenceOpen(first.text)?.marker
  const siblingBoundary = marker ? boundedListSiblingFence(cursor, payload) : undefined
  if (siblingBoundary) return siblingBoundary
  if (marker && (cursor.owner.allowUnclosedFence || boundedQuoteFence(cursor, first, payload) ||
      boundedListFence(cursor, first, payload, marker) ||
      boundedListDedentFence(cursor, first, payload, marker) ||
      boundedListEofFence(cursor, first, payload) ||
      boundedPostBreakEmptyFence(cursor, first, payload)) &&
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
  if (cursor.owner.kind === 'list' && cursor.lines[0]?.number === first.number &&
      payload.length === 1 && payload[0]!.text !== '' &&
      payload[0]!.number === cursor.physicalLines.at(-1)?.number) return payload[0]!
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

function takeFootnoteFirstPlain(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const follower = cursor.peek(1)
  if (footnote[2] !== '+' || cursor.owner.kind !== 'root' || !footnoteDefs || !footnoteDefPos ||
      !follower || !plainQuoteText(follower.text) ||
      cursor.peek(2) && !isBlankLine(cursor.peek(2)!.text)) return false
  cursor.take()
  cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const paragraph: Paragraph = { type: 'paragraph',
    children: inline.inlines([{ line: follower, column: 1, text: follower.text }]),
    pos: position(follower, follower) }
  Object.defineProperty(footnoteDefs, label, { value: [paragraph],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, follower),
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
    (listMarker(cursor.peek(2)?.text ?? '') ||
      RE_BLOCKQUOTE.test(cursor.peek(2)?.text ?? '') ? 2 : undefined)
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

function takeFootnoteCommentTail(cursor: Cursor, inline: CursorInline):
  { blocks: BlockNode[]; last: SourceLine } | undefined {
  const comment = cursor.peek()
  const follower = cursor.peek(1)
  if (!comment || !LINE_COMMENT.test(comment.text) || !follower ||
      footnotePlainColumn(follower) <= 1 || !plainQuoteText(follower.text.trimStart()) ||
      cursor.peek(2) && !isBlankLine(cursor.peek(2)!.text)) return undefined
  cursor.take()
  cursor.take()
  const commentBlock = parseBlocks(new Cursor([comment], undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  const column = footnotePlainColumn(follower)
  const paragraph: Paragraph = { type: 'paragraph',
    children: inline.inlines([{ line: follower, column, text: follower.text.slice(column - 1) }]),
    pos: position(follower, follower, column) }
  return { blocks: [...commentBlock, paragraph], last: follower }
}

function takeBoundedFootnoteBlocks(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (!content || !plainQuoteText(content) || cursor.owner.kind !== 'root' ||
      !footnoteDefs || !footnoteDefPos) return false
  const source: SourceLine[] = []
  let structural = false
  let offset = 1
  let nonblank = 0
  while (cursor.peek(offset)) {
    const line = cursor.peek(offset)!
    if (isBlankLine(line.text)) {
      let next = offset
      while (cursor.peek(next) && isBlankLine(cursor.peek(next)!.text)) next++
      if (!cursor.peek(next)?.text.startsWith('  ')) break
      while (offset < next) source.push(cursor.peek(offset++)!)
      continue
    }
    if (!line.text.startsWith('  ')) break
    const text = line.text.slice(2)
    if (text.startsWith(' ') || text.startsWith('[') ||
        text.startsWith('::') || text.startsWith(':')) return false
    structural ||= RE_BLOCKQUOTE.test(text) || RE_HEADING.test(text) ||
      listMarker(text) !== undefined || fenceOpen(text) !== null
    source.push(line)
    nonblank++
    offset++
  }
  if (nonblank < 2 || !structural) return false
  if (source.slice(0, -1).some((line) => listMarker(line.text.slice(2)))) return false
  const next = cursor.peek(offset)
  if (next && !isBlankLine(next.text)) return false
  let after = offset
  while (cursor.peek(after) && isBlankLine(cursor.peek(after)!.text)) after++
  if (cursor.peek(after)?.text.startsWith('  ')) return false
  cursor.take()
  for (const _line of source) cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const column = first.text.length - content.length + 1
  const body: SourceLine[] = [{ text: content, start: first.start + column - 1,
    number: first.number, baseColumn: (first.baseColumn ?? 1) + column - 1 },
  ...source.map((line) => isBlankLine(line.text) ? { ...line, text: '' } : ({ text: line.text.slice(2), start: line.start + 2,
    number: line.number, baseColumn: (line.baseColumn ?? 1) + 2 }))]
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: blocks,
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, source.at(-1)!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeSimpleFootnote(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): void {
  if (takeFootnoteFirstFence(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  if (takeFootnoteFirstPlain(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  if (takeFootnoteAttachedBlock(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  if (takeBoundedFootnoteBlocks(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
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
  const doublePlus = plusFollower?.text === '+' &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text)) ? plusFollower : undefined
  const attached = plusFollower && plainQuoteText(plusFollower.text) &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text) ||
      isBlockStart(cursor.peek(2)!.text)) ? plusFollower : undefined
  if (attached || doublePlus) { cursor.take(); cursor.take() }
  const commentTail = !attached && !doublePlus && !structural && bodyLength === 0 &&
    footnote[2] && plainQuoteText(footnote[2]) ? takeFootnoteCommentTail(cursor, inline) : undefined
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
  const last = commentTail?.last ?? attached ?? doublePlus ?? bodyLast
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
  const attachedLine = attached ?? doublePlus
  const attachedBody: Paragraph | undefined = attachedLine ? { type: 'paragraph',
    children: inline.inlines([{ line: attachedLine, column: 1, text: attachedLine.text }]),
    pos: position(attachedLine, attachedLine) } : undefined
  const structuralBody = structural ? parseBlocks(new Cursor(structural.body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false) : []
  Object.defineProperty(footnoteDefs, label, { value: footnote[2] === '{empty}' ? [] :
    attachedBody ? separateBody ? [...initialBody, separateBody, ...structuralBody, attachedBody] :
      [...initialBody, ...structuralBody, attachedBody] :
      separateBody ? [...initialBody, separateBody, ...structuralBody, ...(commentTail?.blocks ?? [])] :
        [...initialBody, ...structuralBody, ...(commentTail?.blocks ?? [])],
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

function boundedListColonBody(cursor: Cursor): boolean {
  if (cursor.owner.kind !== 'list' || !cursor.peek(1)) return false
  let last = cursor.peek()!
  for (let offset = 1; cursor.peek(offset); offset++) {
    const line = cursor.peek(offset)!
    if (line.number !== last.number + 1 || !plainQuoteText(line.text)) return false
    last = line
  }
  const follower = cursor.physicalLines[last.number]?.text
  if (last.number > cursor.peek()!.number + 1 && follower?.startsWith('+')) return false
  return follower === undefined || follower !== '' &&
    follower[0] !== ' ' && follower[0] !== '\t'
}

function parseColonAtCursor(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], depth: number, atDocumentLevel: boolean,
  footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined,
  colonDepth: number): BlockNode | undefined {
  const first = cursor.peek()!
  if (first.text[0] !== ':') return undefined
  const simple = COLON_OPEN.exec(first.text)
  const div = simple ? null : RE_DIV_OPEN.exec(first.text)
  const valid = simple || div ? null : RE_VALID_ADMONITION_OPEN.exec(first.text)
  const opener = simple ?? div ?? valid ?? RE_ADMONITION_OPEN.exec(first.text)
  if (!opener) return undefined
  const kind = div ? undefined : opener[2]
  const titleRaw = div ? undefined : opener[3]
  const labelRaw = div ? div[2] : opener[4]
  const figureGroup = isFigureGroupOpener(first.text, !!cursor.owner.inFigureGroup)
  const emptyBareDefinition = cursor.owner.kind === 'definition' &&
    kind === undefined && cursor.peek(1) === undefined
  const physicalFollower = cursor.physicalLines[first.number]?.text
  const belowListColumnParagraph = physicalFollower !== undefined &&
    first.baseColumn !== undefined && /^ +\S/.test(physicalFollower) &&
    /^ */.exec(physicalFollower)![0].length < first.baseColumn - 1 &&
    plainQuoteText(physicalFollower.trimStart())
  const emptyListContainer = cursor.owner.kind === 'list' && cursor.peek(1) === undefined &&
    (physicalFollower === undefined || physicalFollower === '' ||
      physicalFollower[0] !== ' ' && physicalFollower[0] !== '\t' ||
      belowListColumnParagraph)
  const boundedListContainer = boundedListColonBody(cursor)
  if ((!atDocumentLevel && colonDepth === 0 && cursor.owner.kind !== 'quote' &&
      !simpleClosedListColon(cursor, opener[1]!, kind) && !emptyBareDefinition &&
      !emptyListContainer && !boundedListContainer) ||
      unsupportedReferencesColon(opener)) {
    throw new UnsupportedCursorSyntax('nested or specialized colon container')
  }
  if (!simple && !div && !valid && inline.recordInvalidMetadata) {
    inline.diagnostics!.push({ kind: 'invalid', event: {
      kind: kind && GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
      line: first.number, column: first.baseColumn ?? 1,
      startOffset: first.start, endOffset: first.start + first.text.length,
      fenceWidth: opener[1]!.length,
    } })
  }
  cursor.take()
  const body = takeColonBody(cursor, opener[1]!.length)
  const boundary = boundedColonFence(body, cursor, opener[1]!.length)
  if (kind === undefined && body.some((line) => ABBR_DEF.test(line.text))) {
    throw new UnsupportedCursorSyntax('abbreviation inside bare container')
  }
  const finalBodyLine = body.at(-1) ?? first
  const continuationBoundary = cursor.owner.kind === 'list' &&
    cursor.lines[0]?.number === first.number &&
    cursor.physicalLines[finalBodyLine.number]?.text === '+'
  if (cursor.owner.kind === 'list' && !continuationBoundary &&
      cursor.physicalLines[finalBodyLine.number]?.text === '+' &&
      cursor.lines[0]?.number !== first.number) {
    throw new UnsupportedCursorSyntax('nested list container continuation owner')
  }
  if (!cursor.peek() && !continuationBoundary && inline.recordUnclosedContainers) {
    inline.diagnostics!.push({ kind: 'container', event: {
      kind: kind === undefined ? 'div' : GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
      line: first.number, column: first.baseColumn ?? 1,
      startOffset: first.start, endOffset: first.start + opener[1]!.length,
      fenceWidth: opener[1]!.length,
    } })
  }
  const close = cursor.peek() ? cursor.take() : body.at(-1) ?? first
  const owner = childOwner(cursor.owner, 'colon', false, boundary !== undefined, boundary)
  const children = parseBlocks(new Cursor(body, undefined,
    figureGroupOwner(owner, figureGroup), cursor.physicalLines),
  inline, definitionNodes, depth + 1, false,
  footnoteDefs, footnoteDefPos, undefined, colonDepth + 1)
  if (figureGroup) {
    const caption = takeCaption(cursor, inline)
    return { type: 'figure_group', children,
      ...(caption ? { caption: caption.children } : {}),
      pos: position(first, caption?.line ?? close) }
  }
  const pos = position(first, close)
  if (titleRaw && kind === undefined) throw new UnsupportedCursorSyntax('bare div title')
  if (labelRaw && kind && GENERATED_CONTENT_KINDS.has(kind)) {
    throw new UnsupportedCursorSyntax('directive label')
  }
  const titleText = simple ? titleRaw : titleRaw?.slice(1, -1)
  const title = titleText ? inline.inlines([{ line: first,
    column: first.text.indexOf('"') + 2, text: titleText }]) : undefined
  const labelText = simple ? labelRaw : labelRaw?.slice(1, -1)
  const label = labelText === undefined ? undefined : cursorContainerLabel(labelText)
  return kind === undefined ? { type: 'div', children,
    ...(label === undefined ? {} : { label }), pos } :
    GENERATED_CONTENT_KINDS.has(kind) ?
      { type: 'directive', kind, children, ...(title ? { title } : {}), pos } :
      { type: 'admonition', kind, children, ...(title ? { title } : {}),
        ...(label === undefined ? {} : { label }), pos }
}

function reportDanglingAtCursor(cursor: Cursor, inline: CursorInline,
  pendingAt: SourceLine | undefined, children: BlockNode[]): void {
  if (!pendingAt || !inline.recordDanglingAttributes) return
  const authored = cursor.physicalLines[pendingAt.number - 1]?.text ?? ''
  if (cursor.owner.kind === 'colon' && pendingAt.text === '{empty}' &&
      /^: +\{empty\}$/.test(authored)) return
  let wholeBodyOf: 'description' | 'footnote' | undefined
  if (children.length === 0) {
    if (cursor.owner.kind === 'definition' || cursor.owner.kind === 'colon' && /^: +\{/.test(authored)) {
      wholeBodyOf = 'description'
    } else if (cursor.owner.kind === 'colon' && /^\[\^[^\]]+\]: +\{/.test(authored)) {
      wholeBodyOf = 'footnote'
    }
  }
  inline.diagnostics!.push({ kind: 'dangling', event: { line: pendingAt.number, column: pendingAt.baseColumn ?? 1,
    startOffset: pendingAt.start, endOffset: pendingAt.start + pendingAt.text.length,
    ...(wholeBodyOf ? { wholeBodyOf } : {}) } })
}

function parseBlocks(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[],
  depth = 0, atDocumentLevel = true, footnoteDefs?: Record<string, BlockNode[]>,
  footnoteDefPos?: Record<string, Position>, commentOpeners?: Set<number>,
  colonDepth = 0): BlockNode[] {
  if (depth >= MAX_NESTING_DEPTH) throw new UnsupportedCursorSyntax('container nesting limit')
  const singleRootQuoteFootnote = cursor.owner.kind === 'quote' &&
    cursor.owner.parent?.kind === 'root' && cursor.lines.length === 1 &&
    FOOTNOTE_DEF.test(cursor.lines[0]!.text)
  const rootQuoteDefinitions = cursor.owner.kind === 'quote' &&
    cursor.owner.parent?.kind === 'root' && cursor.lines.length > 1 &&
    cursor.lines.every((line) => rootLinkDef(line.text) !== null || FOOTNOTE_DEF.test(line.text))
  if (cursor.owner.kind === 'quote' && cursor.owner.parent?.kind === 'list' ||
      singleRootQuoteFootnote || rootQuoteDefinitions) {
    footnoteDefs ??= inline.footnoteDefs
    footnoteDefPos ??= inline.footnoteDefPos
  }
  const children: BlockNode[] = []
  let pendingAttrs: Attrs | null = null
  let pendingAt: SourceLine | undefined
  const emit = (input: BlockNode) => {
    let node = input
    if (node.type !== 'comment' && node.type !== 'abbreviation_def' && pendingAttrs) {
      node.attrs = mergeAttrs(pendingAttrs, node.attrs ?? {})
      pendingAttrs = null
      pendingAt = undefined
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
      pendingAt ??= first
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
      emit(parseRawAtCursor(cursor, inline))
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
      const unclosed = inline.recordUnclosedCodeFences && !cursor.peek()
      const close = takeFenceCloseAtCursor(cursor, first, payloadLines)
      if (unclosed) {
        const endLine = payloadLines.at(-1)?.number ?? first.number
        inline.diagnostics!.push({ kind: 'fence', event: { line: first.number, column: first.baseColumn ?? 1,
          marker: fence.marker, endLine: endLine + 1,
          reason: endLine >= cursor.physicalLines.length ? 'document' : 'container' } })
      }
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
      emit(parseList(cursor, inline, definitionNodes, depth, first, firstMarker,
        footnoteDefs, footnoteDefPos))
      continue
    }
    const sigilFence = matchSigilFence(first.text)
    if (sigilFence) {
      emit(parseSigilFence(cursor, inline, definitionNodes, depth, sigilFence))
      continue
    }
    const colonNode = parseColonAtCursor(cursor, inline, definitionNodes, depth,
      atDocumentLevel, footnoteDefs, footnoteDefPos, colonDepth)
    if (colonNode) { emit(colonNode); continue }
    if (/^:: +[ \t]*[^ \t]/.test(first.text) &&
        (atDocumentLevel || cursor.owner.kind === 'definition' || first.ownedDefinition ||
          (cursor.owner.kind === 'quote' && !cursor.owner.inList))) {
      emit(parseSimpleDefinitionList(cursor, inline, commentOpeners, depth))
      continue
    }
    if (/^::[ \t]*$/.test(first.text)) {
      emit(parseParagraphAtCursor(cursor, inline))
      continue
    }
    if (atDocumentLevel && cursor.owner.kind === 'root' && /^::\t/.test(first.text)) {
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
  reportDanglingAtCursor(cursor, inline, pendingAt, children)
  return children
}

function hoistBareListFootnote(lines: SourceLine[], inline: CursorInline,
  footnoteDefs: Record<string, BlockNode[]>, footnoteDefPos: Record<string, Position>):
  SourceLine[] | undefined {
  const marker = listMarker(lines[0]?.text ?? '')
  const note = lines[1]
  const follower = lines[2]
  if (!marker?.ordered || marker.raw !== '' || marker.indent !== 0 ||
      !note || !/^ {3}\[\^[^\]]+\]: +\S/.test(note.text) ||
      lines.length !== 3 || !follower ||
      !/^ {4,5}- +\S/.test(follower.text)) return undefined
  const strip = (line: SourceLine): SourceLine => ({ ...line, text: line.text.slice(3),
    start: line.start + 3, baseColumn: (line.baseColumn ?? 1) + 3 })
  const owned = [strip(note)]
  if (follower.text.startsWith('     ')) owned.push(strip(follower))
  const nested = new Cursor(owned, undefined, ROOT_OWNER, lines)
  const match = FOOTNOTE_DEF.exec(owned[0]!.text)
  if (!match) return undefined
  takeSimpleFootnote(nested, inline, owned[0]!, match, footnoteDefs, footnoteDefPos)
  const consumed = new Set(owned.slice(0, nested.at).map((line) => line.number))
  return lines.filter((line) => !consumed.has(line.number))
}

function hoistMarkerLineFootnote(lines: SourceLine[], inline: CursorInline,
  footnoteDefs: Record<string, BlockNode[]>, footnoteDefPos: Record<string, Position>):
  SourceLine[] | undefined {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const marker = listMarker(line.text)
    if (!marker || marker.indent !== 0 || marker.ordered || marker.width !== 2 ||
        'attrs' in marker || 'continuationWidth' in marker) continue
    const noteText = line.text.slice(marker.width)
    const note = FOOTNOTE_DEF.exec(noteText)
    if (!note || !plainQuoteText(note[2] ?? '')) continue
    const body: SourceLine[] = []
    let end = index + 1
    while (end < lines.length) {
      const next = lines[end]!
      if (isBlankLine(next.text)) {
        let after = end + 1
        while (after < lines.length && isBlankLine(lines[after]!.text)) after++
        if (!lines[after]?.text.startsWith(' '.repeat(marker.width + 2))) break
        while (end < after) body.push({ ...lines[end++]!, text: '' })
        continue
      }
      if (!next.text.startsWith(' '.repeat(marker.width + 2))) break
      body.push({ ...next, text: next.text.slice(marker.width + 2),
        start: next.start + marker.width + 2,
        baseColumn: (next.baseColumn ?? 1) + marker.width + 2 })
      end++
    }
    if (body.filter((part) => !isBlankLine(part.text)).length === 1 &&
          body.some((part) => LINE_COMMENT.test(part.text)) ||
        body.some((part) => listMarker(part.text) !== undefined) &&
          plainQuoteText(lines[end]?.text ?? '')) {
      throw new UnsupportedCursorSyntax('marker-line footnote owner')
    }
    const contentColumn = marker.width + noteText.length - note[2]!.length + 1
    const firstBody = { ...line, text: note[2]!, start: line.start + contentColumn - 1,
      baseColumn: (line.baseColumn ?? 1) + contentColumn - 1 }
    const blocks = parseBlocks(new Cursor([firstBody, ...body], undefined,
      childOwner(ROOT_OWNER, 'colon'), lines), inline, [], 1, false)
    Object.defineProperty(footnoteDefs, note[1]!, { value: blocks,
      enumerable: true, configurable: true, writable: true })
    Object.defineProperty(footnoteDefPos, note[1]!, { value: position({ ...line,
      text: noteText, start: line.start + marker.width,
      baseColumn: (line.baseColumn ?? 1) + marker.width }, lines[end - 1] ?? line),
    enumerable: true, configurable: true, writable: true })
    return [...lines.slice(0, index), { ...line, text: line.text.slice(0, marker.width) },
      ...lines.slice(end)]
  }
  return undefined
}

function hasDedentedNestedFenceBoundary(lines: readonly SourceLine[]): boolean {
  for (let index = 0; index + 6 < lines.length; index++) {
    if (lines[index + 1]!.text !== '' || lines[index + 5]!.text !== '') continue
    const marker = listMarker(lines[index]!.text)
    if (!marker || marker.indent === 0) continue
    const opener = lines[index + 2]!.text
    const openIndent = /^ */.exec(opener)![0].length
    const fence = fenceOpen(opener.slice(openIndent))?.marker
    if (!fence || openIndent <= marker.width) continue
    const close = lines[index + 4]!.text
    const closeIndent = /^ */.exec(close)![0].length
    const tail = lines[index + 6]!.text
    if (closeIndent > marker.indent && closeIndent < marker.width &&
        closesFence(close.slice(closeIndent), fence) &&
        tail.startsWith(' '.repeat(marker.indent)) && plainQuoteText(tail.trimStart())) return true
  }
  return false
}

function recordMarkerLineLinkDefinition(cursor: Cursor, line: SourceLine,
  links: Map<string, LinkDef>, known?: Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>):
  Map<number, NonNullable<ReturnType<typeof rootLinkDef>>> | undefined {
  if (line.text[0] !== '-' && line.text[0] !== '*' &&
      !/^[0-9A-Za-z]/.test(line.text)) return known
  const marker = listMarker(line.text)
  const previous = cursor.lines[line.number - 2]
  const previousMarker = line.number === 2 && previous ? listMarker(previous.text) : undefined
  const precedingRootItem = previousMarker?.indent === 0 && plainQuoteText(previousMarker.content)
  if (!marker || marker.indent !== 0 ||
      line.number > 1 && !isBlankLine(previous!.text) && !precedingRootItem) return known
  const definition = rootLinkDef(marker.content)
  if (!definition) return known
  const definitions = known ?? new Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>()
  definitions.set(line.number, definition)
  links.set(normalizeRefLabel(definition.label), { rawLabel: definition.label,
    line: line.number - 1, href: definition.href,
    ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
    ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}) })
  return definitions
}

function indexedQuoteListDefinition(line: SourceLine, previous: SourceLine | undefined,
  next: SourceLine | undefined, prefix: string | undefined,
  hasNestedMarker: boolean): ReturnType<typeof rootLinkDef> {
  if (!hasNestedMarker || !prefix || !line.text.startsWith(prefix + '[')) return null
  const prior = previous?.text ?? ''
  const simpleItem = (prior.startsWith('> - ') || prior.startsWith('> * ')) &&
    plainQuoteText(prior.slice(4)) && !isBlockStart(prior.slice(4))
  if (prior !== '> ' && !(simpleItem && (!next || isBlankLine(next.text)))) return null
  return rootLinkDef(line.text.slice(prefix.length))
}

function rejectAmbiguousShallowListOwnership(lines: SourceLine[], source: string): void {
  if (lines.length < 2) return
  // A nested quote can keep ownership of a later, shallow list marker after
  // another block has started. The cursor list frame cannot yet make that
  // decision from physical columns alone.
  let nestedQuoteSeen = false
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!.text
    // A flush-left follower can still belong to a quoted list item's paragraph.
    if (text[0] === '>' && text[1] === ' ' && index + 1 < lines.length &&
        (text[2] === '-' || text[2] === '*' || /^[0-9A-Za-z]$/.test(text[2] ?? ''))) {
      const quotedMarker = listMarker(text.slice(2))
      const follower = lines[index + 1]!.text
      if (quotedMarker && plainQuoteText(quotedMarker.content) &&
          follower !== '' && !RE_BLOCKQUOTE.test(follower) &&
          follower[0] !== ' ' && follower[0] !== '\t' &&
          !follower.startsWith('^ ')) {
        throw new UnsupportedCursorSyntax('quoted list physical follower owner')
      }
    }
    if (lines.length < 3) continue
    const marker = listMarker(text)
    if (index >= 2 && marker?.indent === 1 &&
        listMarker(lines[index - 1]!.text)?.indent === 1 &&
        listMarker(lines[index - 2]!.text)?.indent === 0 &&
        listMarker(lines[index - 2]!.text)?.content === '') {
      throw new UnsupportedCursorSyntax('one-column list sibling owner')
    }
    if (lines.length >= 6 && index >= 4 && source.includes('>') &&
        nestedQuoteSeen && marker?.indent === 1) {
      throw new UnsupportedCursorSyntax('nested quote and shallow list owner')
    }
    if (/^\s{2,}>/.test(text)) nestedQuoteSeen = true
  }
}

function emitCursorDiagnostics(inline: CursorInline, opts: ParseOptions): void {
  if (!inline.diagnostics) return
  const seen = new Set<string>()
  for (const diagnostic of inline.diagnostics) {
    if (diagnostic.kind === 'dangling') {
      const event = diagnostic.event
      const key = `attr:${event.startOffset}:${event.endOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onDanglingBlockAttributes?.(event)
    } else if (diagnostic.kind === 'fence') {
      const event = diagnostic.event
      const key = `fence:${event.line}:${event.column}:${event.marker}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onUnclosedCodeFence?.(event)
    } else if (diagnostic.kind === 'invalid') {
      const event = diagnostic.event
      const key = `invalid:${event.startOffset}:${event.endOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onInvalidContainerMetadata?.(event)
    } else {
      const event = diagnostic.event
      const key = `container:${event.startOffset}:${event.endOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onUnclosedContainer?.(event)
    }
  }
}

export function parseCursorPrototype(source: string, opts: ParseOptions = {}): Document {
  if (opts.extensions?.some((extension) => extension.matchInline || extension.matchBlock ||
      extension.quoteCharacters) ||
      opts.onRefusedContinuationMarker) {
    throw new UnsupportedCursorSyntax('parser options and callbacks are not migrated')
  }
  const rawSource = source
  const rawByteLength = utf8ByteLength(source)
  const strippedBom = source.charCodeAt(0) === 0xfeff
  if (strippedBom) source = source.slice(1)
  if (source.includes('\0')) source = source.replace(/\0/g, '�')
  source = replaceLoneSurrogates(source)
  const lines = scanLines(source)
  rejectAmbiguousShallowListOwnership(lines, source)
  if ((source.includes('```') || source.includes('~~~')) &&
      hasDedentedNestedFenceBoundary(lines)) {
    throw new UnsupportedCursorSyntax('dedented nested fence owner')
  }
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
  let simpleRootListNested = false
  let simpleQuoteListPrefix: string | undefined
  const hasDefinitionMarker = source.includes(']:')
  const mayHaveNestedListDefinition = hasDefinitionMarker &&
    (source.includes('  [') || source.includes('>   ['))
  let simpleRootListDefinitions = mayHaveNestedListDefinition ?
    new Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>() : undefined
  if (hasDefinitionMarker) {
    for (const line of cursor.lines) {
      if (mayHaveNestedListDefinition && !openFence && openComment === undefined) {
        const marker = listMarker(line.text)
        if (marker?.indent === 0) {
          simpleRootListPrefix = ' '.repeat(marker.width)
          simpleRootListNested = false
        }
        else if (line.text !== '' && simpleRootListPrefix &&
            !line.text.startsWith(simpleRootListPrefix)) {
          simpleRootListPrefix = undefined
          simpleRootListNested = false
        }
        else if (simpleRootListPrefix && line.text.startsWith(simpleRootListPrefix) &&
            (line.text.startsWith(simpleRootListPrefix + '  ') ||
             isBlockStart(line.text.slice(simpleRootListPrefix.length)) &&
             !rootLinkDef(line.text.slice(simpleRootListPrefix.length)))) {
          if (listMarker(line.text.slice(simpleRootListPrefix.length))) {
            simpleRootListNested = true
          } else if (!rootLinkDef(line.text.slice(simpleRootListPrefix.length).trimStart())) {
            simpleRootListPrefix = undefined
            simpleRootListNested = false
          }
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
        line.text.startsWith(simpleRootListPrefix) &&
        /^ *\[/.test(line.text.slice(simpleRootListPrefix.length)) &&
        (!simpleRootListNested && cursor.lines[line.number - 2]?.text === '' ||
         boundedAdjacentDefinitionTail(cursor.lines, line.number, simpleRootListPrefix)) ?
        rootLinkDef(line.text.slice(simpleRootListPrefix.length).trimStart()) : null
      const quoteListDefinition = indexedQuoteListDefinition(line,
        cursor.lines[line.number - 2], cursor.lines[line.number], simpleQuoteListPrefix,
        mayHaveNestedListDefinition)
      if (simpleListDefinition || quoteListDefinition) {
        simpleRootListDefinitions!.set(line.number, (simpleListDefinition ?? quoteListDefinition)!)
      }
      simpleRootListDefinitions = recordMarkerLineLinkDefinition(cursor, line,
        linkDefinitions, simpleRootListDefinitions)
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
  const inline = new CursorInline(linkDefinitions, abbreviations, opts.positions === false,
    opts.onDanglingBlockAttributes !== undefined, opts.onUnclosedCodeFence !== undefined,
    opts.onInvalidContainerMetadata !== undefined, opts.onUnclosedContainer !== undefined)
  const definitionNodes: BlockNode[] = []
  const footnoteDefs: Record<string, BlockNode[]> = {}
  const footnoteDefPos: Record<string, Position> = {}
  inline.footnoteDefs = footnoteDefs
  inline.footnoteDefPos = footnoteDefPos
  const ownedFootnoteLines = hoistBareListFootnote(lines, inline, footnoteDefs, footnoteDefPos) ??
    (source.includes(' [^') ?
      hoistMarkerLineFootnote(lines, inline, footnoteDefs, footnoteDefPos) : undefined)
  const blockCursor = ownedFootnoteLines ? new Cursor(ownedFootnoteLines, source, ROOT_OWNER, lines) : cursor
  if (ownedFootnoteLines && simpleRootListDefinitions) {
    blockCursor.simpleRootListDefinitions = simpleRootListDefinitions
  }
  let frontmatter: Document['frontmatter']
  if (source.startsWith('---')) {
    const lexer = lexerForCursor(cursor)
    lexer.defaultFrontmatterFormat = opts.defaultFrontmatterFormat ?? 'yaml'
    lexer.consumeFrontmatter()
    cursor.at = lexer.pos
    frontmatter = lexer.frontmatter
  }
  const children = parseBlocks(blockCursor, inline, definitionNodes, 0, true, footnoteDefs, footnoteDefPos,
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
  emitCursorDiagnostics(inline, opts)
  return opts.positions === false ? dropPositions(document) : document
}
