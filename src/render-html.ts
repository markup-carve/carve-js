/*
 * HTML renderer — emits the canonical output defined by the spec corpus.
 *
 * Each block / inline node type gets a case in the appropriate switch.
 * Unimplemented types throw so the corpus runner reports exactly what
 * is missing.
 */

import type { BlockNode, Document, InlineNode } from './ast.js'

export interface RenderOptions {
  /** Template for @mention href; `{user}` replaced. Default: no link. */
  mentionUrl?: string
  /** Template for #tag href; `{name}` replaced. Default: no link. */
  tagUrl?: string
}

export function renderHtml(ast: Document, _opts: RenderOptions = {}): string {
  return ast.children.map(renderBlock).join('\n')
}

function renderBlock(node: BlockNode): string {
  switch (node.type) {
    case 'heading': {
      const inner = node.children.map(renderInline).join('')
      return `<h${node.level}>${inner}</h${node.level}>`
    }
    default:
      throw new Error(`renderHtml: block type "${node.type}" not yet supported`)
  }
}

function renderInline(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value)
    default:
      throw new Error(`renderHtml: inline type "${node.type}" not yet supported`)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
