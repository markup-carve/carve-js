import { expect, it } from 'vitest'
import { parse, citations } from '../src/index.js'

function nodes(value: any): any[] {
  if (!value || typeof value !== 'object') return []
  return [value, ...Object.entries(value).filter(([key]) => key !== 'pos')
    .flatMap(([, child]) => nodes(child))]
}

for (const source of [
  '::: |\na\tb\n:::\n',
  '::: |\nwide\t\tgap\n\tlead\n:::\n',
  '> ::: |\n> \t😀 *bold* and /italic/\n> :::\n',
  '- item\n\n  ::: |\n  \ttext\n  :::\n',
  '::: |\n*a\tb*\n%% comment\nlast\n:::\n',
  '::: |\n\t[@x]\n:::\n\n[@x]: source\n',
]) {
  it(`maps unchanged runs to exact source slices: ${JSON.stringify(source)}`, () => {
    const all = nodes(parse(source))
    const text = all.filter((node) => node.type === 'text')
    expect(text.length).toBeGreaterThan(0)
    for (const node of text) {
      expect(node.pos, node.value).toBeDefined()
      expect([...source].slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(node.value)
    }
    for (const node of all.filter((node) => node.type === 'non_breaking_space')) {
      expect(node.pos).toBeUndefined()
    }
  })
}

it('omits a merged text run whose space came from a tab', () => {
  const all = nodes(parse('::: |\ntab\tgap\nwide\t\tgap\n\tlead\n:::\n'))
  const merged = all.find((node) => node.type === 'text' && node.value === 'tab gap')
  expect(merged).toBeDefined()
  expect(merged.pos).toBeUndefined()
  for (const value of ['wide', 'gap', 'lead']) {
    expect(all.find((node) => node.type === 'text' && node.value === value)?.pos).toBeDefined()
  }
})

it('keeps citation item spans and explicit breaks after a tab', () => {
  const source = '::: |\n\t[@x]\\\nnext\n:::\n\n[@x]: source\n'
  const all = nodes(parse(source, { extensions: [citations()] }))
  const group = all.find((node) => node.type === 'citation_group')
  for (const item of group.items) {
    expect(item.pos).toBeDefined()
    expect([...source].slice(item.pos.startOffset, item.pos.endOffset).join('')).toBe('@x')
  }
  const hardBreak = all.find((node) => node.type === 'hard_break')
  expect(hardBreak.pos).toBeDefined()
  expect([...source].slice(hardBreak.pos.startOffset, hardBreak.pos.endOffset).join('')).toBe('\\\n')
})

it('keeps a code span ending at the comment boundary', () => {
  const source = '::: |\n\t`x\n%% c\n:::\n'
  const code = nodes(parse(source)).find((node) => node.type === 'code')
  expect(code.pos).toBeDefined()
  expect(source.slice(code.pos.startOffset, code.pos.endOffset)).toBe('`x\n')
})

it('keeps leading generated columns inside the paragraph', () => {
  const source = '> ::: |\n> \t😀 *bold*\n> :::\n'
  const paragraph = nodes(parse(source)).find((node) => node.type === 'paragraph')
  expect(paragraph.pos.startOffset).toBe(10)
  expect(paragraph.pos.startColumn).toBe(3)
})

it('preserves attributes named pos while remapping node positions', () => {
  const source = '::: |\n\t[word]{pos="x"}\n:::\n'
  const span = nodes(parse(source)).find((node) => node.type === 'span')
  expect(span.attrs.keyValues).toEqual({ pos: 'x' })
  expect(source.slice(span.pos.startOffset, span.pos.endOffset)).toBe('[word]{pos="x"}')
})
