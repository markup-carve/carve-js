// The syntax tokens of an editor snapshot (carve#6342): carve-js is the reference the other engines port.
import { describe, expect, it } from 'vitest'
import { createEditorSession } from '../public/index.ts'

function tokens(source: string, type: string): string[] {
  const node = createEditorSession(source).snapshot().nodes.find((entry) => entry.type === type)
  return (node?.tokens ?? []).map((token) => `${token.role} ${token.start}-${token.end}`)
}

describe('editor session tokens', () => {
  it('a link destination ends before its title', () => {
    expect(tokens('[x](url "title")', 'link')).toEqual(['open-marker 0-1', 'close-marker 2-4', 'destination 4-7', 'close-marker 15-16'])
    expect(tokens('[x](a(b))', 'link')).toEqual(['open-marker 0-1', 'close-marker 2-4', 'destination 4-8', 'close-marker 8-9'])
  })

  it('an escaped pipe or a pipe inside a cell is no table marker', () => {
    expect(tokens('| a \\| b | c |', 'table_row')).toEqual(['table-marker 0-1', 'table-marker 9-10', 'table-marker 13-14'])
    expect(tokens('| `a|b` | c |', 'table_row')).toEqual(['table-marker 0-1', 'table-marker 8-9', 'table-marker 12-13'])
  })

  it('a fence closer starts on its own line', () => {
    expect(tokens('```\na\n```', 'code_block')).toEqual(['fence-open 0-4', 'fence-close 6-9'])
    expect(tokens('```\n```', 'code_block')).toEqual(['fence-open 0-4', 'fence-close 4-7'])
    expect(tokens('> ```\n> a\n> ```', 'code_block')).toEqual(['fence-open 2-6', 'fence-close 12-15'])
    expect(tokens('```\na', 'code_block')).toEqual(['fence-open 0-4'])
    expect(tokens('````\na\n```', 'code_block')).toEqual(['fence-open 0-5'])
    expect(tokens('```\nfoo```', 'code_block')).toEqual(['fence-open 0-4'])
    expect(tokens('```\n> ```', 'code_block')).toEqual(['fence-open 0-4'])
    expect(tokens('```\na\n  ```', 'code_block')).toEqual(['fence-open 0-4', 'fence-close 8-11'])
    expect(tokens('- ```\n  a\n  ```', 'code_block')).toEqual(['fence-open 2-6', 'fence-close 12-15'])
    expect(tokens('````\na\n`````', 'code_block')).toEqual(['fence-open 0-5', 'fence-close 7-12'])
  })

  it('an equals heading has a block marker', () => {
    expect(tokens('= H', 'heading')).toEqual(['block-marker 0-2'])
    expect(tokens('# H', 'heading')).toEqual(['block-marker 0-2'])
  })

  it('the attribute lines above a block are attribute tokens', () => {
    expect(tokens('{.k}\n= H', 'heading')).toEqual(['attribute 0-4', 'block-marker 5-7'])
    expect(tokens('{.k}\npara', 'paragraph')).toEqual(['attribute 0-4'])
    expect(tokens('{.k}\n{#i}\n- item', 'list')).toEqual(['attribute 0-4', 'attribute 5-9'])
    expect(tokens('{.k}\n```\na\n```', 'code_block')).toEqual(['attribute 0-4', 'fence-open 5-9', 'fence-close 11-14'])
    expect(tokens('{table}\n{{ a.csv }}\n', 'include')).toEqual(['attribute 0-7'])
    expect(tokens('> {.x}\n> ```\n> a\n> ```', 'code_block')).toEqual(['attribute 2-6', 'fence-open 9-13', 'fence-close 19-22'])
    expect(tokens('- {.x}\n  = H', 'heading')).toEqual(['attribute 2-6', 'block-marker 9-11'])
  })

  it('a list item marker', () => {
    expect(tokens('- item', 'list_item')).toEqual(['block-marker 0-2'])
  })
})
