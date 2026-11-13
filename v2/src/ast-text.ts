// The plain text of inline nodes (C2-H-143): what a heading id, a task label, a caption label
// and the text of a cross-reference are made of. A node gives the literal text it carries or nothing.
import { type AstNode } from './ast.ts'

type TextOf = (node: AstNode) => string

const NO_BREAK_SPACE = ' '

function childText(node: AstNode): string {
  return plainText(node.children ?? [])
}

function valueText(node: AstNode): string {
  return node.value ?? ''
}

function rubyText(node: AstNode): string {
  let out = ''
  for (const pair of node.pairs ?? []) out += `${plainText(pair.base)}(${plainText(pair.annotation)})`
  return out
}

// C2-H-143: the node types that give text of their own.
const TEXT_OF = new Map<string, TextOf>([
  ['text', valueText], ['code', valueText], ['math', valueText], ['literal_inline', valueText],
  ['non_breaking_space', () => NO_BREAK_SPACE],
  ['soft_break', () => ' '], ['hard_break', () => ' '],
  ['smart_punctuation', (node) => node.glyph ?? node.source ?? ''],
  ['abbreviation', (node) => node.key ?? ''],
  ['mention', (node) => `@${node.target ?? ''}`],
  ['tag', (node) => `#${node.name ?? ''}`],
  ['autolink', (node) => node.text ?? node.href ?? ''],
  ['image', (node) => node.alt ?? ''],
  ['caption_number', (node) => (node.n === undefined ? '' : String(node.n))],
  ['ruby', rubyText],
  // An index entry is no part of the text it stands in.
  ['inline_extension', (node) => (node.name === 'index' ? '' : childText(node))],
])
// C2-H-143: the node types that give nothing, so a comment or a note never moves an id.
const SILENT = ['footnote_ref', 'inline_footnote', 'xref', 'symbol', 'raw_inline', 'critic_comment', 'comment', 'citation_group']

/** The text of one node: its own, or nothing, or else that of its inline children. */
function textOf(node: AstNode): string {
  const own = TEXT_OF.get(node.type)
  if (own !== undefined) return own(node)
  return node.children === undefined || SILENT.includes(node.type) ? '' : childText(node)
}

/**
 * C2-B-208: the plain text of the label of a caption. It is that of a heading, except that a
 * symbol gives the text the caption writes for it (C2-H-101): its entry in `symbols`, or its source.
 */
export function labelText(nodes: AstNode[], symbols: Readonly<Record<string, string>>): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'symbol') out += symbolText(node.name ?? '', symbols)
    else if (node.children === undefined || TEXT_OF.has(node.type) || SILENT.includes(node.type)) out += textOf(node)
    else out += labelText(node.children, symbols)
  }
  return out
}

function symbolText(name: string, symbols: Readonly<Record<string, string>>): string {
  return Object.hasOwn(symbols, name) ? symbols[name]! : `:${name}:`
}

export function plainText(nodes: AstNode[]): string {
  let out = ''
  for (const node of nodes) out += textOf(node)
  return out
}

/** The plain text of the blocks of an item, for the label of its task box: the text of its leaves, joined by spaces. */
export function blockText(nodes: AstNode[]): string {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.type === 'paragraph' || node.type === 'heading') parts.push(plainText(node.children ?? []))
  }
  return parts.join(' ')
}
