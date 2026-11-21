// Plain words: ASCII letters and digits with single spaces between them. No rule of the plan reads such a unit
// (none is in INLINE_TRIGGERS or LINE_TRIGGERS, and a letter or digit opens a block only before `.` or `)`), and the
// reader reads lines of them as one paragraph of text and soft breaks. Tests pin both claims.
import { type Node } from './ast.ts'
import { type ParagraphNode } from './ast-nodes.ts'

const PLAIN_WORDS = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

/** Whether `nodes` are texts of plain words between soft breaks, and `content` is their values joined by line feeds. */
export function plainLeaf(nodes: readonly Node[], content: string): boolean {
  let at = 0
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    if (index % 2 === 1) {
      if (node.type !== 'soft_break' || content.charCodeAt(at) !== 10) return false
      at++
      continue
    }
    if (node.type !== 'text' || !content.startsWith(node.value, at) || !PLAIN_WORDS.test(node.value)) return false
    at += node.value.length
  }
  return nodes.length % 2 === 1 && at === content.length
}

/** The paragraph the reader builds from `lines` where each is plain words, else null. */
export function plainParagraph(lines: readonly string[]): ParagraphNode | null {
  if (lines.length === 0) return null
  const children: ParagraphNode['children'] = []
  for (const line of lines) {
    if (!PLAIN_WORDS.test(line)) return null
    if (children.length > 0) children.push({ type: 'soft_break' })
    children.push({ type: 'text', value: line })
  }
  return { type: 'paragraph', children }
}
