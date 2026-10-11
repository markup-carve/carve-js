import {expect, it} from 'vitest'
import {parse, carveToHtml} from '../src/index.js'
import type {BlockNode, List} from '../src/ast.js'

function quotedList(source: string, depth: number): List {
  let node: BlockNode | undefined = parse(source).children[0]
  for (let n = 0; n < depth; n++) {
    if (node?.type !== 'block_quote') throw new Error('missing quote')
    node = node.children[0]
  }
  if (node?.type !== 'list') throw new Error('missing list')
  return node
}

for (const depth of [1, 2]) for (const payload of ['x', '%%%', '```', '- marker', ':::: box']) {
  it(`keeps literal ${payload} from changing the malformed paragraph owner at depth ${depth}`, () => {
    const quote = '> '.repeat(depth)
    const source = `${quote}- ::: |\n${quote}  ${payload}\n${quote}  :::\n${quote}  :::bad\n${quote}  :::\n- tail\n`
    expect(parse(source).children).toHaveLength(1)
    const list = quotedList(source, depth)
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.children.map(node => node.type)).toEqual(['line_block', 'paragraph'])
    expect(carveToHtml(source)).toContain(':::bad\n:::\n- tail')
  })
}

for (const depth of [1, 2]) {
  const quote = '> '.repeat(depth)
  it(`retains an overindented bare colon run inside its hosted div at depth ${depth}`, () => {
    const source = `${quote}- ::: box\n${quote}  a\n${quote}    :::\n- tail\n`
    expect(parse(source).children).toHaveLength(1)
    const list = quotedList(source, depth)
    expect(list.items).toHaveLength(1)
    expect(carveToHtml(source)).toContain('a\n:::\n- tail')
  })
  it(`retains an overindented bare colon run as line-block payload at depth ${depth}`, () => {
    const source = `${quote}- ::: |\n${quote}  a\n${quote}    :::\n${quote}  b\n- tail\n`
    expect(parse(source).children).toHaveLength(2)
    const list = quotedList(source, depth)
    expect(list.items[0]!.children).toHaveLength(1)
    expect(list.items[0]!.children[0]!.type).toBe('line_block')
    expect(carveToHtml(source)).toContain(':::')
  })
  for (const closer of [2, 4]) it(`closes an authored opener at column ${closer}, depth ${depth}`, () => {
    const prefix = `${quote}- a\n${quote}    ::: box\n${quote}    x\n${quote}${' '.repeat(closer)}:::\n`
    expect(carveToHtml(prefix + '- tail\n')).toBe(carveToHtml(prefix) + '\n' + carveToHtml('- tail\n'))
  })
}

it('keeps root colon closer behavior unchanged', () => {
  expect(carveToHtml('::: box\na\n  :::\n- tail\n')).toBe('<div class="box">\n  <p>a\n:::\n- tail</p>\n</div>')
})


for (const depth of [1, 2]) for (const fence of ['%%%', '```']) {
  it(`keeps a colon closer inside a closed ${fence} span as verse at depth ${depth}`, () => {
    const quote = '> '.repeat(depth)
    const prefix = `${quote}- ::: |\n${quote}  ${fence}\n${quote}  :::\n${quote}  [r]: /target\n${quote}  ${fence}\n${quote}  :::\n`
    const source = prefix + '- tail\n'
    expect(parse(source).children).toHaveLength(2)
    expect(quotedList(source, depth).items[0]!.children.map(node => node.type)).toEqual(['line_block'])
    expect(carveToHtml(source)).toContain('[r]: /target')
  })
}
