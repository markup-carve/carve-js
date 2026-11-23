import { describe, expect, it } from 'vitest'
import { type DocumentNode, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

const text = (value: string) => ({ type: 'text', value }) as const
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)] }) as const
const list = (char: '-' | '*', value: string) => ({
  type: 'list', marker: { kind: 'bullet', char }, spacing: 'tight', children: [{ type: 'list_item', children: [paragraph(value)] }],
}) as const
const comment = (value: string) => ({ type: 'comment', form: 'line', value }) as const
const dash = { type: 'smart_punctuation', kind: 'em_dash', glyph: '—', source: '---' } as const
const typed = { type: 'paragraph', children: [dash, text('yaml'), { type: 'soft_break' }, text('k: v'), { type: 'soft_break' }, dash] } as const

function document(...children: unknown[]): DocumentNode {
  return JSON.parse(JSON.stringify({ type: 'document', astVersion: '2.0', children })) as DocumentNode
}

function paths(tree: DocumentNode): { source: string, paths: string[] } {
  const output = writeWithDiagnostics(tree)
  return { source: output.source, paths: output.diagnostics.map((entry) => `${entry.code} ${entry.path}`) }
}

describe('C2-W-155, C2-B-137: a line comment between an open container and the blocks below (carve#6430)', () => {
  it('reports every line comment of a run the list above reads in, and nothing else', () => {
    expect(paths(document(list('-', 'a'), comment('c'), comment('d'), list('*', 'b'), typed))).toEqual({
      source: ' - a\n\n%% c\n%% d\n\n * b\n\n ---yaml\nk: v\n---\n',
      paths: ['structure-unspellable /children/1', 'structure-unspellable /children/2'],
    })
  })

  it('reports a comment the indented list reads in, and the blocks around it read back as without it', () => {
    const tree = document(list('-', 'a'), list('*', 'b'), comment('c'), typed)
    const output = paths(tree)
    expect(output).toEqual({
      source: ' - a\n\n * b\n\n%% c\n\n ---yaml\nk: v\n---\n', paths: ['structure-unspellable /children/2'],
    })
    const read = parse(output.source)
    const kept = document(list('-', 'a'), list('*', 'b'), typed)
    // The comment is read into the last item, so dropping it from the parse gives the tree without it.
    const item = (read.children[1] as { children: { children: unknown[] }[] }).children[0]!
    item.children = item.children.filter((child) => (child as { type: string }).type !== 'comment')
    expect(treesEqual(read, kept)).toBe(true)
  })

  it('keeps a region marker line, which closes the list above, out of the run', () => {
    expect(paths(document(list('-', 'a'), comment('#region r'), list('*', 'b'), typed))).toEqual({
      source: '- a\n\n%% #region r\n\n * b\n\n ---yaml\nk: v\n---\n', paths: [],
    })
  })
})

describe('C2-B-137: only a comment the container read in carries its loss to the comment below (carve#6430)', () => {
  it('writes a comment below one lost for its value as itself', () => {
    const output = writeWithDiagnostics(document(comment('a\n'), comment('c')))
    expect(output.diagnostics.map((entry) => entry.path)).not.toContain('/children/1')
  })

  it('walks a long run of line comments below an open list in linear time', () => {
    const run = (n: number) => document(list('-', 'a'), ...Array.from({ length: n }, (_, at) => comment(`c${at}`)), list('*', 'b'), typed)
    writeWithDiagnostics(run(200))
    const time = (n: number) => { const start = performance.now(); writeWithDiagnostics(run(n)); return performance.now() - start }
    const small = Math.min(time(1000), time(1000))
    const large = Math.min(time(8000), time(8000))
    expect(large / small).toBeLessThan(24)
  })
})
