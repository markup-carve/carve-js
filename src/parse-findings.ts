// The findings of the parse channel that the block pass and the tree builder see (C2-B-111, C2-B-122, C2-B-163,
// C2-B-181): each is noted with its node while the tree is built, and its message is written only when the
// diagnostics are asked for. The texts are those of the catalog (spec/0.2/data/lint-rules.json).
import { type Node } from './ast.ts'
import { CR, LF, SPACE, TAB } from './chars.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { CODE, COMMENT_BLOCK, DIV, FRONTMATTER, LINE_BLOCK } from './kinds.ts'
import { braceBlocksEnd } from './lines.ts'
import { readOpenerInfo } from './opener.ts'
import { unitBytes } from './positions.ts'
import { isSpaceOrTab, lineFeedAt } from './source.ts'
import type { BlockNode } from './tree.ts'

export const UNCLOSED = 0
export const TITLE_SYNTAX = 1
export const DELIMITED_MALFORMED = 2
export const ATTRIBUTE_FALLBACK = 3

/** A finding noted while the tree is built: what it is, the public node it is about and the block it came from. */
export interface ParseNote {
  what: number
  node: Node
  block: BlockNode
  /**
   * For TITLE_SYNTAX: where the opener text that is no word, title or label starts; -1 for a raw fence.
   * For ATTRIBUTE_FALLBACK: where the attribute block starts.
   */
  from: number
}

const CURLY_QUOTES = '“”„‟'

const DIV_WORDS: Readonly<Record<string, string>> = {
  admonition: 'admonition', directive: 'directive', figure_group: 'figure group', block_quote: 'quote fence', div: 'div',
}

const MALFORMED = 'This marked CSV/TSV fence has malformed quoting. It stays a table, and the cell with the unclosed quote holds the '
  + 'rest of the fence body.'

/** True when only spaces, tabs and line breaks stand from `pos` to `end`. A lone CR is content (C2-B-010). */
function onlySpaces(src: string, pos: number, end: number): boolean {
  for (let p = pos; p < end; p++) {
    const code = src.charCodeAt(p)
    if (code === SPACE || code === TAB || code === LF) continue
    if (code !== CR || src.charCodeAt(p + 1) !== LF) return false
  }
  return true
}

/** The 1-based line of the offset `pos`. */
function lineOf(src: string, pos: number): number {
  let line = 1
  for (let p = src.indexOf('\n'); p >= 0 && p < pos; p = src.indexOf('\n', p + 1)) line++
  return line
}

/** The run of one character that opens the block at `start`. */
function openerRun(src: string, start: number): string {
  let p = start
  while (p < src.length && src.charCodeAt(p) === src.charCodeAt(start)) p++
  return src.slice(start, p)
}

function containerMessage(width: number, word: string | null): string {
  const close = `Add a bare fence of ${width} colons to close it.`
  if (word === null) return `This ${width}-colon container has no closer; add a bare fence of ${width} colons to close it.`
  return `This ${width}-colon ${word} has no closer; it runs to the end of its container. ${close}`
}

function unclosedMessage(src: string, note: ParseNote): [string, string] {
  const block = note.block
  const toEnd = onlySpaces(src, block.end, src.length)
  const run = openerRun(src, block.start)
  if (block.kind === CODE) {
    const ending = toEnd ? 'it runs to the end of the document' : `it ends at the end of its container on line ${lineOf(src, block.end)}`
    const message = `The ${run} fence opened here has no closing fence; ${ending}. `
    return ['unclosed-code-fence', `${message}Add a closing ${run} where the code should stop.`]
  }
  if (block.kind === COMMENT_BLOCK) {
    const message = `The ${run} comment fence opened here has no closing fence and hides everything `
      + 'to the end of its container (or: the document). '
    return ['unclosed-comment-fence', `${message}Add a closing ${run} where the comment should stop.`]
  }
  if (block.kind === FRONTMATTER) {
    return ['unclosed-frontmatter', 'This frontmatter block has no closing line, so it runs to the end of the document.']
  }
  if (block.kind === LINE_BLOCK) return ['unclosed-container-fence', containerMessage(run.length, 'line block')]
  // A bare colon run names no kind.
  const bare = block.kind === DIV && note.node.type === 'div' && onlySpaces(src, block.start + run.length, lineFeedAt(src, block.start))
  return ['unclosed-container-fence', containerMessage(run.length, bare ? null : DIV_WORDS[note.node.type] ?? 'div')]
}

/** Splits a trailing ` [label]` off `text`. */
function splitLabel(text: string): [string, string] {
  const open = text.lastIndexOf(' [')
  if (!text.endsWith(']') || open < 0) return [text, '']
  return [text.slice(0, open).trim(), text.slice(open)]
}

/** C2-B-117: a tab or a second space behind the run of a fence leaves the fence with no language. */
function misspaced(src: string, runEnd: number): boolean {
  const code = src.charCodeAt(runEnd)
  return code === TAB || (code === SPACE && isSpaceOrTab(src.charCodeAt(runEnd + 1)))
}

function isCurlyTitle(text: string): boolean {
  return text !== '' && CURLY_QUOTES.includes(text.charAt(0))
}

const TITLE_MESSAGES = [
  'These words are not part of the anonymous div opener; it opens without them. Remove the words or use a named div.',
  'These words follow a valid title and are not part of the code fence opener. Remove them or put them in the block body.',
  'The title after "${type}" uses typographic quotes. Check whether a smart quote filter changed the source; '
    + 'a fence title needs straight double quotes: ${fence} ${type} "${title}"${label}.',
  'Text after "${type}" must be a quoted title or a [label]; it is not read as a title. '
    + 'Write ${fence} ${type} "${title}"${label}.',
  'These further words are not read as a title, label or attributes. The block opens without them. '
    + 'Use "${correctedOpener}" for the same block with only valid opener parts; put attributes on their own line above it.',
  'The whitespace in this fence opener is invalid: at most one space follows the fence, and info-string parts use spaces, '
    + 'never tabs. The block opens with no language; write "${respaced}".',
  'The tab does not separate valid info-string parts; the block keeps its language, but does not keep the later title or label. '
    + 'Use "${respaced}" with spaces between parts.',
  'These further words are not part of the fence opener. Remove them or place them in the block body.',
]

const ATTRIBUTE_MESSAGES = [
  'A code or raw fence carries no inline attributes, so "${attributes}" after its language or format is not attached. '
    + 'The block opens without them. Put "${attributes}" on its own line directly above "${opener}".',
  'A div carries no inline attributes, so "${attributes}" after its name is not attached. '
    + 'The block opens without them. Put "${attributes}" on its own line directly above "${opener}".',
]

function catalogMessage(id: 'fence-title-syntax' | 'fence-opener-fallback', index: number,
  values: Record<string, string>): string {
  const template = (id === 'fence-title-syntax' ? TITLE_MESSAGES : ATTRIBUTE_MESSAGES)[index] ?? ''
  return template.replace(/\$\{([^}]+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)
}

const trimSpaces = (text: string): string => text.replace(/^[ \t\r]+|[ \t\r]+$/g, '')

interface TitleParts {
  run: string
  runEnd: number
  lineEnd: number
  from: number
  before: string
  /** Whether a tab stands between the opener parts before the further words, not inside a title or label. */
  partTab: boolean
  type: string
  wordEnd: number
  rest: string
  label: string
  code: boolean
}

function titleParts(src: string, note: ParseNote): TitleParts {
  const run = openerRun(src, note.block.start)
  const lineEnd = lineFeedAt(src, note.block.start)
  const runEnd = note.block.start + run.length
  const from = Math.max(note.from, runEnd)
  const before = src.slice(runEnd, from)
  // C2-B-117, C2-B-119: the word ends where its characters end, so the further words may be glued to it.
  const info = readOpenerInfo(src, runEnd)
  const type = info.wordStart >= 0 && info.wordEnd <= from ? src.slice(info.wordStart, info.wordEnd) : ''
  const wordEnd = runEnd + before.length - before.replace(/^[ \t]+/, '').length + type.length
  const [rest, label] = splitLabel(trimSpaces(src.slice(from, lineEnd)))
  let parts = before
  for (const [start, end] of [[info.labelStart, info.labelEnd], [info.titleStart, info.titleEnd]] as const) {
    if (start >= runEnd && end <= from) parts = parts.slice(0, start - runEnd) + parts.slice(end - runEnd)
  }
  return { run, runEnd, lineEnd, from, before, partTab: parts.includes('\t'), type, wordEnd, rest, label,
    code: note.node.type === 'code_block' }
}

/** C2-B-117: the whitespace messages of a code fence; -1 for any other opener. */
function spacingVariant(src: string, p: TitleParts): number {
  // A spaced brace block is further words (4); a tab behind the run is the whitespace message (5).
  if (p.type === '' && /^ +\{/.test(src.slice(p.runEnd, p.lineEnd))) return 4
  if (p.type === '' && misspaced(src, p.runEnd)) return 5
  if (p.type !== '' && (p.partTab || src.charCodeAt(p.wordEnd) === TAB)) return 6
  return -1
}

/**
 * C2-B-122: the catalog message for the further words of an opener. Only a code fence takes the code-fence messages
 * (1, 2, 3, 5, 6): a raw fence and a div report message 4, or message 0 for an anonymous div.
 */
function titleVariant(src: string, p: TitleParts): number {
  if (!p.code) return trimSpaces(p.before) === '' ? 0 : 4
  const spacing = spacingVariant(src, p)
  if (spacing >= 0) return spacing
  // C2-B-225: a character glued to the language starts further words, not an unquoted title.
  if (p.type !== '' && p.from === p.wordEnd) return 4
  if (p.type !== '' && isCurlyTitle(p.rest)) return 2
  const titled = p.before.includes('"') && !p.before.includes(']')
  if (titled || /^"[^"\n]*"[ \t]+\S/.test(src.slice(p.wordEnd, p.lineEnd).replace(/^[ \t]+/, ''))) return 1
  // A brace block or a title behind the label is no unquoted title (C2-B-117).
  return p.type !== '' && !p.rest.startsWith('{') && !p.before.includes(']') ? 3 : 4
}

function titleMessage(src: string, note: ParseNote): string {
  const p = titleParts(src, note)
  const line = src.slice(p.runEnd, p.lineEnd).trim()
  const parts = trimSpaces(p.before)
  const variant = titleVariant(src, p)
  const title = variant === 2
    ? p.rest.slice(1, CURLY_QUOTES.includes(p.rest.charAt(p.rest.length - 1)) ? -1 : undefined)
    : p.rest.replace(/^"|"$/g, '')
  return catalogMessage('fence-title-syntax', variant, { type: p.type, fence: p.run, label: p.label, title,
    respaced: line === '' ? p.run : `${p.run} ${line.replace(/\s+/g, ' ')}`,
    correctedOpener: p.run.startsWith('`') && parts !== '' ? `${p.run} ${parts}` : src.slice(note.block.start, p.from).trimEnd() })
}

/** C2-B-105: an attribute block after a fence language or an admonition name, which the block does not take. */
function attributeMessage(src: string, note: ParseNote): string {
  const lineEnd = lineFeedAt(src, note.block.start)
  const blockEnd = braceBlocksEnd(src, note.from, lineEnd)
  const attributes = src.slice(note.from, blockEnd)
  const opener = `${src.slice(note.block.start, note.from)}${src.slice(blockEnd, lineEnd)}`.trim()
  const index = note.block.kind === CODE ? 0 : 1
  return catalogMessage('fence-opener-fallback', index, { attributes, opener })
}

/** Records the title diagnostic at its authored source range. */
function addTitleFinding(src: string, note: ParseNote, offsets: Uint32Array, findings: Findings): void {
  const message = titleMessage(src, note)
  let start = note.from < 0 ? note.block.start : note.from
  const bareTab = note.block.kind === CODE && src[start] === '\t'
    && start === note.block.start + openerRun(src, note.block.start).length
  if (!bareTab) while (start < src.length && (src[start] === ' ' || src[start] === '\t')) start++
  const feed = lineFeedAt(src, note.block.start)
  const end = feed < src.length && feed > note.block.start && src.charCodeAt(feed - 1) === CR ? feed - 1 : feed
  const range = { startOffset: offsets[start]!, endOffset: offsets[end]! }
  addFinding(findings, note.node, { code: 'fence-title-syntax', severity: 'warning', channel: 'parse', message, range })
}

/** Adds the findings of `notes`, in document order, to `findings`. */
export function addParseFindings(src: string, notes: readonly ParseNote[], findings: Findings): void {
  if (notes.length === 0) return
  const offsets = new Uint32Array(src.length + 1)
  for (let at = 0; at < src.length; at++) offsets[at + 1] = offsets[at]! + unitBytes(src, at)
  // A block is noted once its children are built, so an inner block may come first.
  const ordered = [...notes].sort((a, b) => a.block.start - b.block.start)
  for (const note of ordered) {
    if (note.what === UNCLOSED) {
      const [code, message] = unclosedMessage(src, note)
      addFinding(findings, note.node, { code, severity: 'error', channel: 'parse', message })
    } else if (note.what === ATTRIBUTE_FALLBACK) {
      const message = attributeMessage(src, note)
      const end = braceBlocksEnd(src, note.from, lineFeedAt(src, note.block.start))
      const range = { startOffset: offsets[note.from]!, endOffset: offsets[end]! }
      addFinding(findings, note.node, { code: 'fence-opener-fallback', severity: 'error', channel: 'parse', message, range })
    } else if (note.what === TITLE_SYNTAX) {
      addTitleFinding(src, note, offsets, findings)
    } else {
      const start = Math.max(0, note.from)
      const range = { startOffset: offsets[start]!, endOffset: offsets[start + 1]! }
      addFinding(findings, note.node, { code: 'delimited-table-malformed', severity: 'error', channel: 'parse', message: MALFORMED,
        range })
    }
  }
}
