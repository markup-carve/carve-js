import { describe, expect, it } from 'vitest'
import { carveToCarve, renderCarve, SourceUnspellableError, type Attrs, type Document, type InlineNode } from '../src/index.js'

// No source reads back as a mention or tag carrying attributes, so the writer
// refuses the tree instead of dropping them (carve-php#2083).

const paragraph = (...children: InlineNode[]): Document =>
  ({ type: 'document', children: [{ type: 'paragraph', children }] }) as unknown as Document
const text = { type: 'text', value: 'hi ' } as InlineNode
const mention = (attrs?: Attrs) => ({ type: 'mention', user: 'name', ...(attrs && { attrs }) }) as InlineNode
const tag = (attrs?: Attrs) => ({ type: 'tag', name: 'topic', ...(attrs && { attrs }) }) as InlineNode

describe('a mention or tag carrying attributes', () => {
  it.each([
    ['a mention with a class', mention({ classes: ['c'] }), 'mention'],
    ['a mention with an id', mention({ id: 'x' }), 'mention'],
    ['a tag with a class', tag({ classes: ['c'] }), 'tag'],
    ['a tag with a key-value pair', tag({ keyValues: { k: 'v' } }), 'tag'],
  ])('is refused for %s', (_, node, nodeType) => {
    let thrown: unknown
    try {
      renderCarve(paragraph(text, node))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SourceUnspellableError)
    expect((thrown as SourceUnspellableError).nodeType).toBe(nodeType)
  })

  it.each([
    ['a mention without attributes', mention(), 'hi @name\n'],
    ['a mention with an empty attribute set', mention({}), 'hi @name\n'],
    ['a tag without attributes', tag(), 'hi #topic\n'],
    ['a tag with an empty attribute set', tag({ classes: [] }), 'hi #topic\n'],
  ])('is written for %s', (_, node, carve) => {
    expect(renderCarve(paragraph(text, node))).toBe(carve)
  })

  it.each(['@name{.c}', '#topic{.c}', '[@name]{.c}'])('is never built by a parse, so fmt writes %s', (source) => {
    expect(carveToCarve(`${source}\n`)).toBe(`${source}\n`)
  })
})
