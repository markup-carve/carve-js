import { describe, expect, it } from 'vitest'
import { type DocumentNode, type Inline, parse, writeWithDiagnostics } from '../src/index.ts'

function breaks(count: number, first: 'soft_break' | 'hard_break' = 'soft_break'): Inline[] {
  return Array.from({ length: count }, (_, at): Inline => ({ type: at === 0 ? first : 'soft_break' }))
}

function inlines(count: number, first?: 'soft_break' | 'hard_break'): Inline[] {
  return [{ type: 'text', value: 'Note' }, ...breaks(count, first), { type: 'text', value: 'A note.' }]
}

function documentIn(source: string, children: Inline[]): DocumentNode {
  const document = parse(source)
  const find = (node: { type: string, children?: unknown[] }): { children: unknown[] } | undefined =>
    node.type === 'paragraph' ? node as { children: unknown[] } : (node.children as typeof node[] | undefined)?.map(find).find(Boolean)
  find(document)!.children = children
  return document
}

function losses(document: DocumentNode): string[] {
  return writeWithDiagnostics(document).diagnostics.map((entry) => `${entry.code} ${entry.path}`)
}

describe('carve#6618: a soft break behind a break', () => {
  it('C2-W-011, C2-W-124: the tree of NOTE: A note. reports each lost soft break, not the document', () => {
    const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: inlines(3) }] }
    const result = writeWithDiagnostics(document)
    expect(result.source).toBe('Note\n\n\nA note.\n')
    expect(result.diagnostics).toEqual([
      { code: 'structure-unspellable', channel: 'render-loss', severity: 'warning', path: '/children/0/children/2',
        message: 'Carve source cannot spell a soft_break node here' },
      { code: 'structure-unspellable', channel: 'render-loss', severity: 'warning', path: '/children/0/children/3',
        message: 'Carve source cannot spell a soft_break node here' },
    ])
  })

  it.each([
    ['Note\n', '/children/0'],
    ['- Note\n', '/children/0/children/0/children/0'],
    ['> Note\n', '/children/0/children/0'],
  ])('C2-W-117: in %j one entry per soft break behind a soft break', (source, at) => {
    for (let count = 1; count <= 6; count++) {
      const expected = Array.from({ length: count - 1 }, (_, k) => `structure-unspellable ${at}/children/${k + 2}`)
      expect(losses(documentIn(source, inlines(count)))).toEqual(expected)
    }
  })

  it('C2-W-117: a soft break behind a hard break is lost too', () => {
    expect(losses(documentIn('Note\n', inlines(3, 'hard_break')))).toEqual([
      'structure-unspellable /children/0/children/2',
      'structure-unspellable /children/0/children/3',
    ])
  })

  it('C2-W-124: inside emphasis the loss is the soft break, not the emphasis', () => {
    const children: Inline[] = [{ type: 'text', value: 'A ' }, { type: 'emphasis', children: inlines(2) }]
    const result = writeWithDiagnostics(documentIn('Note\n', children))
    expect(result.source).toBe('A /Note\n\nA note./\n')
    expect(result.diagnostics.map((entry) => entry.path)).toEqual(['/children/0/children/1/children/2'])
  })
})
