import { describe, expect, it } from 'vitest'
import { parse, renderCarve, SourceUnspellableError, type Document, type InlineNode } from '../src/index.js'

// A name `name_word {'.' name_word}` rejects has no Carve spelling, so the
// writer refuses it (ruling markup-carve/carve-php#2159).

const tree = (type: 'mention' | 'tag', name: string): Document =>
  ({
    type: 'document',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: 'ping ' }, type === 'mention' ? { type, user: name } : { type, name }] }],
  }) as unknown as Document

describe('a mention or tag name the grammar rejects', () => {
  const rejected = ['Lea Thompson', "o'brien", 'lea.', '.lea', 'lea..t', 'Zoë', '@lea', 'a#b', '']

  it.each((['mention', 'tag'] as const).flatMap((type) => rejected.map((name) => [type, name] as const)))(
    'is refused for a %s named %j',
    (type, name) => {
      let thrown: unknown
      try {
        renderCarve(tree(type, name))
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(SourceUnspellableError)
      expect((thrown as SourceUnspellableError).nodeType).toBe(type)
    },
  )

  it.each((['mention', 'tag'] as const).flatMap((type) => ['lea', 'john.doe.2', 'a_b-c', 'v1.0'].map((name) => [type, name] as const)))(
    'is written and reads back for a %s named %j',
    (type, name) => {
      const written = renderCarve(tree(type, name))
      expect(written).toBe(`ping ${type === 'mention' ? '@' : '#'}${name}\n`)
      expect(renderCarve(parse(written))).toBe(written)
    },
  )

  // fmt never reaches the refusal: every mention or tag the parser builds
  // carries a name the writer accepts. Exhaustive over short runs of the
  // characters that end, split or break a name.
  it('is never built by a parse', () => {
    const alphabet = ['@', '#', 'a', '.', ' ', "'", 'é', '-', '\\']
    let runs = ['']
    const all: string[] = []
    for (let length = 0; length < 4; length++) {
      runs = runs.flatMap((run) => alphabet.map((ch) => run + ch))
      all.push(...runs)
    }
    const count = (nodes: InlineNode[]): number =>
      nodes.filter((node) => node.type === 'mention' || node.type === 'tag').length
    let built = 0
    for (const run of all) {
      for (const source of [`x ${run} y`, `${run}b`]) {
        const doc = parse(source)
        for (const block of doc.children) {
          if (block.type === 'paragraph') built += count(block.children)
        }
        try {
          renderCarve(doc)
        } catch (error) {
          if (error instanceof SourceUnspellableError && (error.nodeType === 'mention' || error.nodeType === 'tag')) {
            throw new Error(`fmt refused ${JSON.stringify(source)}: ${error.message}`)
          }
        }
      }
    }
    expect(built).toBeGreaterThan(1000)
  })
})
