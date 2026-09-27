import { describe, expect, it } from 'vitest'
import type { InlineNode } from '../src/ast.js'
import type { CarveExtension } from '../src/extension.js'
import { parse } from '../src/parse.js'

const content = (): InlineNode[] => [
  { type: 'link', href: '', ref: 'target', rawRef: '[link][target]',
    attrs: { classes: ['own'] }, children: [{ type: 'text', value: 'link' }] },
  { type: 'text', value: ' NASA' },
]
const cases: [string, () => InlineNode, number][] = [
  ['extension', () => ({ type: 'inline_extension', name: 'kbd', content: content() }), 1],
  ['ruby', () => ({ type: 'ruby', pairs: [{ base: content(), annotation: content() }] }), 2],
  ['citation', () => ({ type: 'citation_group', raw: '[@book]', items: [{
    type: 'citation', key: 'book', suppressAuthor: false,
    prefix: content(), locator: content(), suffix: content(),
  }] }), 3],
]

function nodesOfType(value: unknown, type: string): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(item => nodesOfType(item, type))
  const record = value as Record<string, unknown>
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap(item => nodesOfType(item, type))]
}

describe('inline child traversal', () => {
  it.each(cases)('resolves definitions in %s content', (_name, build, count) => {
    const extension: CarveExtension = {
      name: 'custom-container',
      matchInline(text, pos) {
        return text[pos] === '§' ? { node: build(), end: pos + 1 } : null
      },
    }
    const doc = parse('§\n\n[target]: /docs {.definition}\n*[NASA]: Space agency\n', { extensions: [extension] })
    const links = nodesOfType(doc, 'link')
    expect(links).toHaveLength(count)
    for (const link of links) {
      expect(link.href).toBe('/docs')
      expect(link.ref).toBe('target')
      expect(link.rawRef).toBe('[link][target]')
      expect(link.attrs).toMatchObject({ classes: ['definition', 'own'] })
    }
    expect(nodesOfType(doc, 'abbreviation')).toHaveLength(count)
  })

  it('does not apply definition attributes again to context-parsed content', () => {
    const extension: CarveExtension = {
      name: 'context-container',
      matchInline(text, pos, context) {
        if (text[pos] !== '§') return null
        return { node: { type: 'inline_extension', name: 'kbd', content: context.parseInlines('[link][target]') }, end: pos + 1 }
      },
    }
    const doc = parse('§\n\n[target]: /docs {.definition}\n', { extensions: [extension] })
    expect(nodesOfType(doc, 'link')[0]?.attrs).toMatchObject({ classes: ['definition'] })
  })
})
