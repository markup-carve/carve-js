import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// carve-js#4392: each erased comment line used to walk every list item and every comment placed before it.
describe('transparent comment lines in long lists', () => {
  it('places each comment in source order and writes it back', () => {
    const source = '- a\n%% c1\n\n- b\n%% c2\n\n- c\n%% c3\n'
    const doc = parse(source)
    expect(doc.children.map((block) => block.type === 'comment' ? block.content : block.type)).toEqual(['list', 'c1', 'c2', 'c3'])
    const written = carveToCarve(source)
    expect(written).toBe('- a\n\n%% c1\n\n- b\n\n%% c2\n\n- c\n\n%% c3\n')
    expect(carveToCarve(written)).toBe(written)
    expect(carveToHtml(source)).toBe('<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n  <li><p>c</p></li>\n</ul>')
  })

  it('keeps a comment that follows an earlier one in the same item between the items', () => {
    const doc = parse('- a\n  %% c\n  %% d\n- b\n')
    const list = doc.children[0]
    expect(list?.type).toBe('list')
    if (list?.type !== 'list') return
    expect(list.items[0]!.children.map((block) => block.type === 'comment' ? block.content : block.type)).toEqual(['paragraph', 'c', 'd'])
  })

  perfIt.each([
    ['comment line after each item', '- a\n%% c\n\n'],
    ['comment line inside each nested item', '- a\n  - b\n  %% c\n\n'],
    ['comment line after a refused first-block plus', '- > +\n%% c\np\n\n'],
  ])('restores a %s in linear time', (label, unit) => {
    expectBuiltInputScansLinearly((source) => void parse(source), (repeats) => unit.repeat(repeats),
      { label, smallRepeats: 500, minSampleMs: 250 })
  }, 120000)
})
