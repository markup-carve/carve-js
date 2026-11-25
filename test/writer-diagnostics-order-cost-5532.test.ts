// carve-js#5532: the C2-W-158 order comes from the places the entries were located at, not from re-reading each path.
import { describe, expect, it } from 'vitest'
import { type Inline } from '../src/ast-nodes.ts'
import { type Diagnostic, type Findings, inDocumentOrder, locateFindings } from '../src/diagnostics.ts'
import { decodeTree, type DocumentNode, type Node, writeWithDiagnostics } from '../src/index.ts'

function chain(depth: number, title: string, wrapper: 'span' | 'emphasis' | null): Inline[] {
  let children: Inline[] = []
  for (let at = 0; at < depth; at++) {
    children = [{ type: 'span', attrs: { keyValues: [['title', title]] }, children: [{ type: 'text', value: '[ ' }, ...children] }]
  }
  if (wrapper === 'span') return [{ type: 'span', attrs: { keyValues: [['title', 'ab']] }, children }]
  if (wrapper === 'emphasis') return [{ type: 'emphasis', children }]
  return children
}

const text = (value: string) => ({ type: 'text', value })
const paragraph = (children: object[]) => ({ type: 'paragraph', children })

function trees(): DocumentNode[] {
  const out: DocumentNode[] = []
  for (const wrapper of [null, 'span', 'emphasis'] as const) for (const depth of [1, 2, 7, 40]) {
    out.push({ type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: chain(depth, 'a\nb', wrapper) },
      { type: 'paragraph', children: chain(3, 'c\nd', wrapper) }] })
  }
  const cell = { type: 'table_cell', header: false, children: [paragraph([text('a')]), paragraph([text('b')])] }
  out.push(decodeTree(JSON.stringify({ type: 'document', astVersion: '2.0', lang: 'de', metadata: { keywords: ['k'] }, children: [
    { type: 'table', columns: [{ type: 'table_column' }], children: [
      { type: 'table_body', attrs: { id: 'b' }, children: [{ type: 'table_row', children: [cell] }] }] },
    paragraph([{ type: 'span', attrs: { keyValues: [['title', 'x\ny'], ['lang', 'p\nq']] }, children: [text('s')] }]),
    { type: 'line_block', children: [{ type: 'line', children: [text('l'), { type: 'comment', form: 'braced', value: 'c\nd' }] }] },
  ] })))
  return out
}

describe('C2-W-158 order from located places (carve-js#5532)', () => {
  it('matches the order of the paths read from the document', () => {
    for (const document of trees()) {
      const { diagnostics } = writeWithDiagnostics(document)
      expect(diagnostics.length).toBeGreaterThan(0)
      expect(inDocumentOrder(document, [...diagnostics])).toEqual(diagnostics)
    }
  })

  it('names every expanded include around a node, from the entry file inward', () => {
    const leaf: Node = { type: 'text', value: 'x' }
    const inner = { type: 'include', path: 'b.crv', file: 'b.crv', pos: { startOffset: 3, endOffset: 9 },
      children: [{ type: 'paragraph', children: [leaf] }] } as unknown as Node
    const outer = { type: 'include', path: 'a.crv', file: 'a.crv', pos: { startOffset: 0, endOffset: 12 },
      children: [{ type: 'paragraph', children: [text('y')] }, inner] } as unknown as Node
    const document = { type: 'document', astVersion: '2.0', children: [outer] } as unknown as DocumentNode
    const entry: Diagnostic = { code: 'c', severity: 'warning', channel: 'render-loss', message: 'm' }
    const findings: Findings = { entries: [entry], nodes: [leaf] }
    const [located] = locateFindings(document, findings)
    expect(located!.path).toBe('/children/0/children/1/children/0/children/0')
    expect(located!.file).toBe('b.crv')
    expect(located!.includedBy).toEqual([{ range: { startOffset: 0, endOffset: 12 } },
      { file: 'a.crv', range: { startOffset: 3, endOffset: 9 } }])
  })
})
