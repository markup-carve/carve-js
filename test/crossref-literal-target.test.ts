import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, renderCarve, parse, type Document } from '../src/index.js'
import { SourceUnspellableError } from '../src/source-unspellable-error.js'

describe('cross-reference target spelling', () => {
  for (const target of ['p\\an', 'ls\\-greet', 'a\\\\b', 'a\\', '日本語']) {
    it(`keeps the literal target ${JSON.stringify(target)}`, () => {
      const source = `See </#${target}>.\n`
      const once = carveToCarve(source)
      expect(once).toBe(source)
      expect(carveToCarve(once)).toBe(once)
      expect(carveToHtml(once)).toBe(carveToHtml(source))
      const paragraph = parse(source).children[0]!
      expect(paragraph.type).toBe('paragraph')
      if (paragraph.type === 'paragraph') expect(paragraph.children[1]).toMatchObject({ type: 'heading_ref', target })
    })
  }
  for (const source of ["| </#a\\> |\n", "| </#a\\|b> |\n", "[x </#a\\]>](u)\n"]) {
    it(`keeps the crossref spelling in its host ${JSON.stringify(source)}`, () => {
      const once = carveToCarve(source)
      expect(once).toBe(source)
      const target = source.slice(source.indexOf("</#") + 3, source.indexOf(">"))
      const tree = JSON.stringify(parse(source))
      expect(tree).toContain('"type":"heading_ref"')
      expect(tree).toContain('"target":' + JSON.stringify(target))
      expect(carveToCarve(once)).toBe(once)
      expect(carveToHtml(once)).toBe(carveToHtml(source))
    })
  }
  for (const target of ['', 'a>b', 'a b', 'a\tb', 'a\nb', 'a\rb', 'a\0b']) {
    it(`refuses an unspellable hand-built target ${JSON.stringify(target)}`, () => {
      const document: Document = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'heading_ref', target }] }] }
      expect(() => renderCarve(document)).toThrow(SourceUnspellableError)
    })
  }
})
