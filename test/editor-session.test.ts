import { describe, expect, it } from 'vitest'
import { createEditorSession, EditorChangeError, parse, toAstJson } from '../src/index.js'

const fresh = (source: string) => toAstJson(parse(source, { positions: true }))

describe('editor session', () => {
  it('turns live heading input into a mapped heading without rewriting source', () => {
    const session = createEditorSession('##')
    const update = session.update([{ from: 2, to: 2, insert: '# Title' }])

    expect(update.source).toBe('### Title')
    expect(update.revision).toBe(1)
    expect(update.nodes).toContainEqual(expect.objectContaining({ type: 'heading', start: 0, end: 9 }))
    expect(update.ast).toEqual(fresh('### Title'))
  })

  it('publishes browser-native UTF-16 ranges for astral text', () => {
    const snapshot = createEditorSession('😀 /bold/').snapshot()
    const emphasis = snapshot.nodes.find((node) => node.type === 'emphasis')
    expect(emphasis).toMatchObject({ start: 3, end: 9 })
    expect(snapshot.source.slice(emphasis!.start, emphasis!.end)).toBe('/bold/')
  })

  it('applies multiple changes atomically in previous-snapshot coordinates', () => {
    const session = createEditorSession('one two')
    const update = session.update([
      { from: 0, to: 3, insert: '1' },
      { from: 4, to: 7, insert: '2' },
    ])
    expect(update.source).toBe('1 2')
    expect(update.ast).toEqual(fresh('1 2'))
  })

  it('rejects overlap and split surrogate pairs without changing the session', () => {
    const session = createEditorSession('a😀b')
    expect(() => session.update([{ from: 2, to: 2, insert: 'x' }])).toThrow(EditorChangeError)
    expect(() => session.update([{ from: 0, to: 2, insert: '' }, { from: 1, to: 1, insert: '' }])).toThrow(EditorChangeError)
    expect(session.snapshot()).toMatchObject({ revision: 0, source: 'a😀b' })
  })

  it('matches a fresh parse through a realistic typing sequence', () => {
    const session = createEditorSession('')
    for (const insert of ['#', '#', '#', ' ', 'H', 'i', '\n', '\n', '-', ' ', 'x']) {
      const at = session.snapshot().source.length
      const update = session.update([{ from: at, to: at, insert }])
      expect(update.ast).toEqual(fresh(update.source))
    }
  })
})
