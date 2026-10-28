import type { Admonition, BlockNode, Document, InlineNode } from '../../ast.js'

/** GitHub alert label -> the Carve admonition kind it imports as. */
export const GITHUB_ALERT_KINDS: Readonly<Record<string, string>> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'info',
  WARNING: 'warning',
  CAUTION: 'danger',
}

/** A label line exactly as GitHub documents it: uppercase, alone on the line. */
export const GITHUB_ALERT_LABEL = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/

function alertKind(first: InlineNode | undefined, source: string): string | undefined {
  if (first?.type !== 'text' || first.attrs || first.pos?.startOffset === undefined || first.pos.endOffset === undefined) return undefined
  // The source slice, not the text value: an escaped `\[!NOTE]` reads the same
  // and stays literal on GitHub.
  const label = GITHUB_ALERT_LABEL.exec(source.slice(first.pos.startOffset, first.pos.endOffset))
  return label === null || label[0] !== first.value ? undefined : GITHUB_ALERT_KINDS[label[1]!]
}

function alertAdmonition(node: BlockNode, source: string): Admonition | undefined {
  if (node.type !== 'block_quote' || node.attrs) return undefined
  const [head, ...rest] = node.children
  if (head?.type !== 'paragraph' || head.attrs) return undefined
  const kind = alertKind(head.children[0], source)
  if (kind === undefined) return undefined
  const after = head.children[1]
  if (after !== undefined && after.type !== 'soft_break') return undefined
  const tail = head.children.slice(2)
  const children: BlockNode[] = tail.length > 0 ? [{ ...head, children: tail }, ...rest] : rest
  if (children.length === 0) return undefined
  return { type: 'admonition', kind, children, ...(node.pos ? { pos: node.pos } : {}) }
}

/**
 * Rewrite each top-level GitHub alert blockquote as its admonition. GitHub
 * renders alerts only outside other elements, so nested quotes stay quotes.
 */
export function importGithubAlerts(document: Document, source: string): boolean {
  let changed = false
  document.children = document.children.map(node => {
    const admonition = alertAdmonition(node, source)
    if (admonition === undefined) return node
    changed = true
    return admonition
  })
  return changed
}
