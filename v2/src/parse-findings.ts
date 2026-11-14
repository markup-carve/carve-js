// The findings of the parse channel that the block pass and the tree builder see (C2-B-111, C2-B-122, C2-B-163,
// C2-B-181): each is noted with its node while the tree is built, and its message is written only when the
// diagnostics are asked for. The texts are those of the catalog (spec/0.2/data/lint-rules.json).
import { type Node } from './ast.ts'
import { CR, LF, SPACE, TAB } from './chars.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { CODE, COMMENT_BLOCK, DIV, FRONTMATTER, LINE_BLOCK } from './kinds.ts'
import { lineFeedAt } from './source.ts'
import type { BlockNode } from './tree.ts'

export const UNCLOSED = 0
export const TITLE_SYNTAX = 1
export const DELIMITED_MALFORMED = 2

/** A finding noted while the tree is built: what it is, the public node it is about and the block it came from. */
export interface ParseNote {
  what: number
  node: Node
  block: BlockNode
  /** For TITLE_SYNTAX: where the opener text that is no word, title or label starts; -1 for a raw fence. */
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
    const hidden = toEnd ? 'the document' : 'its container'
    const message = `The ${run} comment fence opened here has no closing fence and hides everything to the end of ${hidden}. `
    return ['unclosed-comment-fence', `${message}Add a closing ${run} where the comment should stop.`]
  }
  if (block.kind === FRONTMATTER) {
    return ['unclosed-frontmatter', 'The frontmatter opened on line 1 has no closing line, so the whole document is frontmatter.']
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

/** C2-B-122: the opener with its further words read as the quoted title the author meant. */
function titleMessage(src: string, note: ParseNote): string {
  const block = note.block
  const run = openerRun(src, block.start)
  const lineEnd = lineFeedAt(src, block.start)
  const line = src.slice(block.start + run.length, lineEnd).trim()
  const space = line.search(/[ \t]/)
  const type = space < 0 ? line : line.slice(0, space)
  const rest = note.from < 0 ? (space < 0 ? '' : line.slice(space).trim()) : src.slice(note.from, lineEnd).trim()
  const [text, label] = note.from < 0 ? [rest, ''] : splitLabel(rest)
  if (CURLY_QUOTES.includes(text.charAt(0))) {
    const title = text.slice(1, CURLY_QUOTES.includes(text.charAt(text.length - 1)) ? -1 : undefined)
    return `The title after "${type}" uses typographic quotes - usually a CMS "smart quote" filter rewrote the source before Carve `
      + `parsed it. A fence title needs straight double quotes: ${run} ${type} "${title}"${label}.`
  }
  return `Text after the "${type}" fence type must be a quoted "title" or a [label]; unquoted it is not read as a title, and the `
    + `block opens. Did you mean ${run} ${type} "${text}"${label}?`
}

/** Adds the findings of `notes`, in document order, to `findings`. */
export function addParseFindings(src: string, notes: readonly ParseNote[], findings: Findings): void {
  // A block is noted once its children are built, so an inner block may come first.
  const ordered = [...notes].sort((a, b) => a.block.start - b.block.start)
  for (const note of ordered) {
    if (note.what === UNCLOSED) {
      const [code, message] = unclosedMessage(src, note)
      addFinding(findings, note.node, { code, severity: 'error', channel: 'parse', message })
    } else if (note.what === TITLE_SYNTAX) {
      const message = titleMessage(src, note)
      addFinding(findings, note.node, { code: 'fence-title-syntax', severity: 'warning', channel: 'parse', message })
    } else {
      addFinding(findings, note.node, { code: 'delimited-table-malformed', severity: 'error', channel: 'parse', message: MALFORMED })
    }
  }
}
