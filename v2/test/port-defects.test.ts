import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

const types = (src: string): string[] => parse(src).children.map((node) => node.type)

describe('C2-B-166/167: a trailing line comment on a row', () => {
  it('C2-B-166: a commented row stays a row when a later line holds a pipe', () => {
    expect(types('| a | b | %% note\n| c | d |\n')).toEqual(['table'])
    expect(render('| a | b | %% note\n| c | d |\n')).toContain('<tr><td>a</td><td>b</td></tr>')
    expect(types('| a | b | %% note\n\nx|\n')).toEqual(['table', 'paragraph'])
    expect(types('|a| %%\n|\n')).toEqual(['table', 'paragraph'])
    expect(types('> | a | %% n\n> | b |\n')).toEqual(['block_quote'])
    expect(render('> | a | %% n\n> | b |\n')).toContain('<tr><td>a</td></tr>\n      <tr><td>b</td></tr>')
  })
})
