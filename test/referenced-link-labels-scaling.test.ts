import { describe, expect, it } from 'vitest'
import { carveToMarkdown, parse } from '../src/index.js'
import { blocksWithLinkDefinitionsInSourceOrder } from '../src/parse/inline/referenced-link-labels.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

describe('hoisted link definitions in source order', () => {
  it('keeps blocks without positions beside their neighbors', () => {
    const ast = parse('a\n\n[r]: /u\n\nb\n\n[s]: /v\n')
    const blocks = ast.children.filter(node => node.type !== 'link_reference_definition')
    delete blocks[0]!.pos
    expect(blocksWithLinkDefinitionsInSourceOrder(ast).map(node => node.type)).toEqual([
      'paragraph', 'link_reference_definition', 'paragraph', 'link_reference_definition',
    ])
  })

  it('appends definitions without offsets and keeps equal offsets after blocks', () => {
    const ast = parse('a\n\n[r]: /u\n\nb\n\n[s]: /v\n')
    const definitions = ast.children.filter(node => node.type === 'link_reference_definition')
    const blocks = ast.children.filter(node => node.type !== 'link_reference_definition')
    definitions[0]!.pos!.startOffset = blocks[0]!.pos!.startOffset!
    delete definitions[1]!.pos
    expect(blocksWithLinkDefinitionsInSourceOrder(ast)).toEqual([
      blocks[0], definitions[0], blocks[1], definitions[1],
    ])
  })

  perfIt('Markdown conversion with unused definitions scales linearly', () => {
    expectBuiltInputScansLinearly(input => { carveToMarkdown(input) },
      n => Array.from({ length: n }, (_, i) => `paragraph\n\n[r${i}]: /u\n\n`).join(''),
      { label: 'unused link definitions', smallRepeats: 2000, minSampleMs: 30 })
  })
})
