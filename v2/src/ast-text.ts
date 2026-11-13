// The plain text of inline nodes (CARVE-P2-004): what a heading id, a task label, a caption label
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

// A footnote reference, a cross-reference, a symbol, raw inline and every comment give nothing.
const TEXT_OF = new Map<string, TextOf>([
  ['text', valueText], ['code', valueText], ['math', valueText], ['literal_inline', valueText],
  ['non_breaking_space', () => NO_BREAK_SPACE],
  ['soft_break', () => ' '], ['hard_break', () => ' '],
  ['smart_punctuation', (node) => node.glyph ?? node.source ?? ''],
  ['abbreviation', (node) => node.key ?? ''],
  ['mention', (node) => node.label ?? `@${node.target ?? ''}`],
  ['tag', (node) => `#${node.name ?? ''}`],
  ['autolink', (node) => node.text ?? node.href ?? ''],
  ['image', (node) => node.alt ?? ''],
  ['caption_number', (node) => (node.n === undefined ? '' : String(node.n))],
  ['ruby', rubyText],
  ['emphasis', childText], ['strong', childText], ['underline', childText], ['strike', childText],
  ['superscript', childText], ['subscript', childText], ['highlight', childText], ['link', childText],
  ['span', childText], ['small_caps', childText], ['insert', childText], ['delete', childText],
  ['inline_extension', childText],
])

export function plainText(nodes: AstNode[]): string {
  let out = ''
  for (const node of nodes) out += TEXT_OF.get(node.type)?.(node) ?? ''
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
