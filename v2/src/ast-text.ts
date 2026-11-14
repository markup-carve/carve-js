// The plain text of inline nodes (C2-H-143): what a heading id, a task label, a caption label
// and the text of a cross-reference are made of. A node gives the literal text it carries or nothing.
import { type AstNode, asNode, handle, type Inline, type Node, type NodeHandlers, type RubyNode } from './ast.ts'

const NO_BREAK_SPACE = ' '

function rubyText(node: RubyNode): string {
  let out = ''
  for (const pair of node.pairs) out += `${plainText(pair.base)}(${plainText(pair.annotation)})`
  return out
}

function valueText(node: { value: string }): string {
  return node.value
}

// C2-H-143: the node types that give text of their own.
const TEXT_OF: NodeHandlers<string> = {
  text: valueText, code: valueText, math: valueText, literal_inline: valueText,
  non_breaking_space: () => NO_BREAK_SPACE,
  soft_break: () => ' ', hard_break: () => ' ',
  smart_punctuation: (node) => node.glyph ?? node.source,
  abbreviation: (node) => node.key,
  mention: (node) => `@${node.target}`,
  tag: (node) => `#${node.name}`,
  autolink: (node) => node.text ?? node.href,
  image: (node) => node.alt ?? '',
  caption_number: (node) => (node.n === undefined ? '' : String(node.n)),
  ruby: rubyText,
  // An index entry is no part of the text it stands in.
  inline_extension: (node) => (node.name === 'index' ? '' : plainText(node.children)),
}

/** C2-H-143: the text of a node type that gives text of its own, or undefined for one that does not. */
function ownText(node: Node): string | undefined {
  return handle(TEXT_OF, node.type, node, undefined)
}

// C2-H-143: the node types that give nothing, so a comment or a note never moves an id.
const SILENT = ['footnote_ref', 'inline_footnote', 'xref', 'symbol', 'raw_inline', 'critic_comment', 'comment', 'citation_group']

/** The text of one node: its own, or nothing, or else that of its inline children. */
function textOf(node: Node): string {
  const own = ownText(node)
  if (own !== undefined) return own
  return !('children' in node) || SILENT.includes(node.type) ? '' : plainText(node.children)
}

/**
 * C2-B-208: the plain text of the label of a caption. It is that of a heading, except that a
 * symbol gives the text the caption writes for it (C2-H-101): its entry in `symbols`, or its source.
 */
export function labelText(nodes: readonly AstNode[], symbols: Readonly<Record<string, string>>): string {
  let out = ''
  for (const loose of nodes) {
    const node = asNode(loose)
    if (node.type === 'symbol') {
      out += symbolText(node.name, symbols)
      continue
    }
    const own = ownText(node)
    if (own !== undefined) out += own
    else if ('children' in node && !SILENT.includes(node.type)) out += labelText(node.children, symbols)
  }
  return out
}

function symbolText(name: string, symbols: Readonly<Record<string, string>>): string {
  return Object.hasOwn(symbols, name) ? symbols[name]! : `:${name}:`
}

export function plainText(nodes: readonly AstNode[] | readonly Inline[]): string {
  let out = ''
  for (const node of nodes) out += textOf(asNode(node))
  return out
}

/** The plain text of the blocks of an item, for the label of its task box: the text of its leaves, joined by spaces. */
export function blockText(nodes: readonly AstNode[]): string {
  const parts: string[] = []
  for (const loose of nodes) {
    const node = asNode(loose)
    if (node.type === 'paragraph' || node.type === 'heading') parts.push(plainText(node.children))
  }
  return parts.join(' ')
}
