import { describe, expect, it } from 'vitest'
import { carveToCarve, parse, renderCarve, SourceUnspellableError, type Document, type InlineNode } from '../src/index.js'

// A mention or tag opens only after a non-word character, and its name runs to
// the last name character, so one glued to a word has no spelling. The writer
// refuses the tree (carve-js#1807).

const mention = { type: 'mention', user: 'name' } as InlineNode
const tag = { type: 'tag', name: 'tag' } as InlineNode
const text = (value: string) => ({ type: 'text', value }) as InlineNode
const paragraph = (...children: InlineNode[]): Document =>
  ({ type: 'document', children: [{ type: 'paragraph', children }] }) as unknown as Document

describe('a mention or tag glued to a word character', () => {
  it.each([
    ['a letter before a mention', paragraph(text('xa'), mention)],
    ['an underscore before a tag', paragraph(text('x_'), tag)],
    ['a digit before a mention', paragraph(text('x1'), mention)],
    ['a name character after a mention', paragraph(mention, text('ax'))],
    ['a hyphen after a tag', paragraph(tag, text('-x'))],
    ['a dot and a name character after a mention', paragraph(mention, text('.x'))],
    ['an attribute-looking word before a mention', paragraph(text('x {.k'), mention)],
  ])('is refused for %s', (_, doc) => {
    expect(() => renderCarve(doc)).toThrow(SourceUnspellableError)
  })

  it.each([
    ['a space before a mention', paragraph(text('x '), mention), 'x @name\n'],
    ['a dot at the end after a tag', paragraph(tag, text('.')), '#tag.\n'],
    ['a space after a mention', paragraph(mention, text(' x')), '@name x\n'],
    ['a strong closer before a tag', paragraph({ type: 'strong', children: [text('b')] } as InlineNode, text(' '), tag), '*b* #tag\n'],
  ])('is written for %s', (_, doc, carve) => {
    expect(renderCarve(doc)).toBe(carve)
  })

  it.each(['a @name b', 'x.@name', '(@name)', '#tag.', '@a.b-c_d x', '*@name*', '{*x*}@name'])(
    'is never built by a parse, so fmt writes %s',
    (source) => {
      expect(() => carveToCarve(`${source}\n`)).not.toThrow()
      expect(JSON.stringify(parse(source))).toMatch(/"type":"(mention|tag)"/)
    },
  )
})
