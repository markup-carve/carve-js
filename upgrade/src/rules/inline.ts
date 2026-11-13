// Contract 2.11 and 2.13: inline spellings, read off the inline nodes of the 0.1 tree.
import { change, type Context, note, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'

const BRACE = 0x7b

interface Bare {
  mark: string
  entry: string
  name: string
}

/** C2-I-046: these three delimiters form a span only in braces. */
const BARE: Record<string, Bare> = {
  underline: { mark: '_', entry: 'U-065', name: 'underline' },
  strike: { mark: '~', entry: 'U-066', name: 'strike' },
  highlight: { mark: '=', entry: 'U-067', name: 'highlight' },
}

function bareSpan(ctx: Context, node: Node01, bare: Bare): void {
  const { startOffset: start, endOffset: end } = node.pos!
  if (ctx.src[start] !== bare.mark || ctx.src[end - 1] !== bare.mark || end - start < 2) return
  change(ctx, bare.entry, start, start, '{', `bare ${bare.name} put in braces`)
  change(ctx, bare.entry, end, end, '}', `bare ${bare.name} put in braces`)
}

/** U-068: 0.1 read `/*` as one token of strong around emphasis; 0.2 nests as written (C2-I-052). */
function boldItalic(ctx: Context, node: Node01): void {
  const { startOffset: start, endOffset: end } = node.pos!
  if (node.boldItalic !== true || !ctx.src.startsWith('/*', start) || !ctx.src.startsWith('*/', end - 2)) return
  change(ctx, 'U-068', start, start + 2, '*/', 'emphasis outside strong respelled as strong outside emphasis')
  change(ctx, 'U-068', end - 2, end, '/*', 'emphasis outside strong respelled as strong outside emphasis')
}

function lastEnd(nodes: unknown, fallback: number): number {
  if (!Array.isArray(nodes) || nodes.length === 0) return fallback
  const last = nodes[nodes.length - 1] as Node01
  return last.pos === undefined ? fallback : last.pos.endOffset
}

/** U-069: there is no arrow form in 0.2 (C2-I-062). */
function substitution(ctx: Context, node: Node01): void {
  const { startOffset: start, endOffset: end } = node.pos!
  if (!ctx.src.startsWith('{~', start) || !ctx.src.startsWith('~}', end - 2)) return
  const arrow = ctx.src.indexOf('~>', lastEnd(node.old, start + 2))
  if (arrow < 0 || arrow >= end - 2) return
  const message = 'substitution arrow respelled as a deletion and an insertion'
  change(ctx, 'U-069', start, start + 2, '{-', message)
  change(ctx, 'U-069', arrow, arrow + 2, '-}{+', message)
  change(ctx, 'U-069', end - 2, end, '+}', message)
}

function isOpeningPlace(src: string, at: number): boolean {
  if (at === 0) return true
  const before = src.charCodeAt(at - 1)
  return before === 0x20 || before === 0x09 || before === 0x0a || before === 0x28 || before === 0x5b
}

/** U-071: 0.1 demoted an opening single quote with no closer; 0.2 never changes an emitted quote (C2-I-110). */
function demotedQuote(ctx: Context, node: Node01): void {
  const start = node.pos!.startOffset
  if (node.kind !== 'right_single_quote' || ctx.src[start] !== "'" || !isOpeningPlace(ctx.src, start)) return
  const next = ctx.src.charCodeAt(start + 1)
  if (Number.isNaN(next) || next === 0x20 || next === 0x0a) return
  change(ctx, 'U-071', start, start + 1, '’', 'opening single quote that 0.1 printed as an apostrophe written as the apostrophe')
}

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const SIGILS = new Set(['tag', 'mention', 'inline_extension', 'symbol'])

/** U-073: a sigil starts a form only after a character outside the letter-or-number class (C2-I-090). */
function sigil(ctx: Context, node: Node01): void {
  const start = node.pos!.startOffset
  if (start === 0 || ctx.src.charCodeAt(start) === BRACE) return
  const low = ctx.src.charCodeAt(start - 1)
  const from = low >= 0xdc00 && low <= 0xdfff && start > 1 ? start - 2 : start - 1
  if (!LETTER_OR_NUMBER.test(ctx.src.slice(from, start))) return
  note(ctx, 'U-073', node.pos!.startLine, 'a sigil form directly after a letter or number is text in 0.2')
}

/** U-072: at a brace the attribute block is tried first (C2-I-043). */
function editorialComment(ctx: Context, node: Node01): void {
  const { startOffset: start, startLine } = node.pos!
  const close = ctx.src.indexOf('}', start)
  if (!ctx.src.startsWith('{#', start) || close < 0 || close >= node.pos!.endOffset - 2) return
  note(ctx, 'U-072', startLine, 'an editorial comment that starts like an id is an attribute block in 0.2')
}

function rawHtml(ctx: Context, node: Node01): void {
  if (node.format !== 'html') return
  if (node.type === 'raw_inline') {
    note(ctx, 'U-077', node.pos!.startLine, 'a raw HTML span is written escaped unless the host sets --raw-html')
  } else {
    note(ctx, 'U-076', node.pos!.startLine, 'a raw HTML block is written as a code block unless the host sets --raw-html')
  }
}

function inlineNode(ctx: Context, visit: Visit): void {
  const node = visit.node
  if (node.pos === undefined) return
  const bare = BARE[node.type]
  if (bare !== undefined) bareSpan(ctx, node, bare)
  else if (node.type === 'strong') boldItalic(ctx, node)
  else if (node.type === 'substitution') substitution(ctx, node)
  else if (node.type === 'smart_punctuation') demotedQuote(ctx, node)
  else if (node.type === 'critic_comment') editorialComment(ctx, node)
  else if (SIGILS.has(node.type)) sigil(ctx, node)
  else if (node.type === 'raw_inline' || node.type === 'raw_block') rawHtml(ctx, node)
}

export function inline(ctx: Context): void {
  for (const visit of ctx.visits) inlineNode(ctx, visit)
}
