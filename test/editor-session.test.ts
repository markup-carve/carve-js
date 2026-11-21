import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createEditorSession, EditorChangeError, parse } from '../public/index.ts'

const cases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as {
  cases: { id: string, input?: string }[]
}).cases.filter((entry) => entry.input !== undefined && entry.input.length <= 80).slice(0, 60)

describe('editor session', () => {
  it('applies previous-snapshot UTF-16 changes atomically', () => {
    const session = createEditorSession('one two')
    const update = session.update([{ from: 0, to: 3, insert: '1' }, { from: 4, to: 7, insert: '2' }])
    expect(update.source).toBe('1 2')
    expect(update.ast).toEqual(parse('1 2'))
    expect(update.revision).toBe(1)
    expect(update.changedPaths).toContain('/children/0')
  })

  it('rejects overlapping edits and split surrogate pairs without changing the snapshot', () => {
    const session = createEditorSession('a😀b')
    expect(() => session.update([{ from: 2, to: 2, insert: 'x' }])).toThrow(EditorChangeError)
    expect(() => session.update([{ from: 0, to: 2, insert: '' }, { from: 1, to: 1, insert: '' }])).toThrow(EditorChangeError)
    expect(session.snapshot()).toMatchObject({ revision: 0, source: 'a😀b' })
  })

  it('reuses untouched paragraphs and shifts UTF-8 positions after a Unicode edit', () => {
    const session = createEditorSession('één\n\nMitte\n\n終わり\n')
    const before = session.snapshot()
    const update = session.update([{ from: 5, to: 10, insert: '日本語' }])
    expect(update.ast).toEqual(parse(update.source))
    expect(update.reusedPreviousTree).toBe(true)
    expect(update.parsedSourceBytes).toBeLessThan(update.ast.srcByteLength!)
    expect(update.ast.children[0]).toBe(before.ast.children[0])
  })

  it('keeps unchanged node IDs after a length-changing edit', () => {
    const session = createEditorSession('first\n\ntext\n\nlast')
    const before = new Map(session.snapshot().identity.nodes.map(node => [node.path, node.id]))
    const update = session.update([{ from: 7, to: 11, insert: 'edited' }])
    const after = new Map(update.identity.nodes.map(node => [node.path, node.id]))
    for (const path of ['/children/0', '/children/0/children/0', '/children/2']) {
      expect(after.get(path)).toBe(before.get(path))
    }
    expect(update.changedPaths).toContain('/children/1')
  })

  it('falls back for structural edits', () => {
    for (const insert of ['# Heading', '[ref]: /url', 'first\n\nsecond', '1. item']) {
      const session = createEditorSession('before\n\ntext\n\nafter')
      const update = session.update([{ from: 8, to: 12, insert }])
      expect(update.ast).toEqual(parse(update.source))
      expect(update.reusedPreviousTree).toBe(false)
    }
  })

  it('matches fresh parses after repeated local edits', () => {
    const session = createEditorSession('first\n\ntext\n\nlast')
    for (let index = 0; index < 100; index++) {
      const old = session.snapshot().source
      const end = old.indexOf('\n', 7)
      const update = session.update([{ from: 7, to: end, insert: `paragraph ${index} é` }])
      expect(update.ast).toEqual(parse(update.source))
      expect(update.reusedPreviousTree).toBe(true)
      expect(update.parsedSourceBytes).toBeLessThan(update.ast.srcByteLength!)
    }
  })

  it('matches a fresh 0.2 parse after single-character edits throughout clause cases', () => {
    let edits = 0
    for (const entry of cases) {
      const source = entry.input!
      for (let at = 0; at <= source.length; at++) {
        const session = createEditorSession(source)
        expect(session.update([{ from: at, to: at, insert: 'x' }]).ast, entry.id).toEqual(parse(source.slice(0, at) + 'x' + source.slice(at)))
        edits++
      }
      for (let at = 0; at < source.length; at++) {
        const session = createEditorSession(source)
        expect(session.update([{ from: at, to: at + 1, insert: '' }]).ast, entry.id).toEqual(parse(source.slice(0, at) + source.slice(at + 1)))
        edits++
      }
    }
    expect(edits).toBeGreaterThan(1000)
  })
})
