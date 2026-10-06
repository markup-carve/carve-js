import { describe, expect, it } from 'vitest'
import { createEditorSession as createInternalSession } from '../src/editor-session.js'
import { createEditorSession, EditorChangeError, parse, toAstJson } from '../src/index.js'

const fresh = (source: string) => toAstJson(parse(source, { positions: true }))

describe('editor session', () => {
  it('reports same-length text and reference destination changes', () => {
    const text = createEditorSession('one')
    expect(text.update([{ from: 0, to: 3, insert: 'two' }]).changedPaths).toContain('/children/0/children/0')
    const source = '[label][r]\n\n[r]: /one\n'
    const reference = createEditorSession(source)
    const start = source.indexOf('/one')
    const update = reference.update([{ from: start, to: start + 4, insert: '/two' }])
    expect(update.changedPaths).toContain('/children/0/children/0')
  })

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

  it('keeps batch order and untouched identities with repeated insertion points', () => {
    const session = createEditorSession('one\n\ntwo\n\nthree\n\nfour')
    const old = new Map(session.snapshot().identity.nodes.map(node => [node.path, node.id]))
    const update = session.update([
      { from: 0, to: 0, insert: 'A' },
      { from: 0, to: 0, insert: 'B' },
      { from: 0, to: 3, insert: 'ONE' },
      { from: 17, to: 21, insert: '4' },
    ])
    expect(update.source).toBe('ABONE\n\ntwo\n\nthree\n\n4')
    expect(update.ast).toEqual(fresh(update.source))
    const ids = new Map(update.identity.nodes.map(node => [node.path, node.id]))
    for (const path of ['/children/1', '/children/1/children/0', '/children/2']) expect(ids.get(path)).toBe(old.get(path))
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

  it('maps authored syntax tokens instead of making adapters rediscover them', () => {
    const source = '{#hero .wide}\n### Head\n\n- item\n\n[label](https://example.com)\n\n|= A |\n| x |\n\n```js\ncode\n```\n'
    const nodes = createEditorSession(source).snapshot().nodes
    const heading = nodes.find((node) => node.type === 'heading')!
    expect(heading.tokens).toEqual([
      { role: 'attribute', start: 0, end: 13 },
      { role: 'block-marker', start: 14, end: 18 },
    ])
    expect(nodes.find((node) => node.type === 'list_item')!.tokens).toEqual([
      { role: 'block-marker', start: 24, end: 26 },
    ])
    expect(nodes.find((node) => node.type === 'link')!.tokens.map((token) => [token.role, source.slice(token.start, token.end)])).toEqual([
      ['open-marker', '['], ['close-marker', ']('], ['destination', 'https://example.com'], ['close-marker', ')'],
    ])
    expect(nodes.filter((node) => node.type === 'table_row').flatMap((node) => node.tokens)).toHaveLength(4)
    expect(nodes.find((node) => node.type === 'code_block')!.tokens.map((token) => [token.role, source.slice(token.start, token.end)])).toEqual([
      ['fence-open', '```js\n'], ['fence-close', '\n```'],
    ])
  })
})


it('reuses untouched paragraphs and parses only the edited Unicode paragraph', () => {
  const session = createEditorSession('één\n\nMitte\n\n終わり\n')
  const before = session.snapshot()
  const update = session.update([{ from: 5, to: 10, insert: '日本語' }])
  expect(update.ast).toEqual(fresh(update.source))
  expect(update.reusedPreviousTree).toBe(true)
  expect(update.parsedSourceBytes).toBe(9)
  expect(update.ast.children[0]).toBe(before.ast.children[0])
  expect(() => { update.ast.children.length = 0 }).toThrow()
})

it('matches fresh parses after repeated local edits and structural fallbacks', () => {
  const session = createEditorSession('first\n\ntext\n\nlast')
  for (let index = 0; index < 100; index++) {
    const old = session.snapshot().source
    const end = old.indexOf('\n', 7)
    const update = session.update([{ from: 7, to: end, insert: `paragraph ${index} é` }])
    expect(update.ast).toEqual(fresh(update.source))
    expect(update.reusedPreviousTree).toBe(true)
    expect(update.parsedSourceBytes).toBeLessThan(new TextEncoder().encode(update.source).length)
  }
  for (const insert of ['# Heading', '[ref]: /url', 'first\n\nsecond', '1. item', '']) {
    const session = createEditorSession('before\n\ntext\n\nafter')
    const update = session.update([{ from: 8, to: 12, insert }])
    expect(update.ast).toEqual(fresh(update.source))
    expect(update.reusedPreviousTree).toBe(false)
  }
})


it('requires explicit core-parser opt-in for injected parser callbacks', () => {
  const calls: string[] = []
  const parser = (source: string) => { calls.push(source); return fresh(source) }
  const custom = createInternalSession('first\n\ntext\n\nlast', parser)
  expect(custom.update([{ from: 7, to: 11, insert: 'edited' }]).reusedPreviousTree).toBe(false)
  expect(calls.at(-1)).toBe('first\n\nedited\n\nlast')
  calls.length = 0
  const core = createInternalSession('first\n\ntext\n\nlast', parser, {}, true)
  core.update([{ from: 7, to: 11, insert: 'edited' }])
  expect(calls).toEqual(['first\n\ntext\n\nlast', 'edited'])
})
