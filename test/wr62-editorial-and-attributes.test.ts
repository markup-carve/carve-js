import { expect, test } from 'vitest'
import { format, parse } from '../src/index.ts'

test('an editorial atom owns later line-start percent text', () => {
  for (const value of ['a\n%% b', 'a\n%% b\n%% c']) {
    const source = `{#${value}#}`
    expect(parse(source).children[0]).toMatchObject({ children: [{ type: 'critic_comment', value }] })
    expect(format(source)).toBe(`${source}\n`)
  }
})

test('an attribute block separates a bare span closer from following word text', () => {
  for (const content of ['a', 'a b', 'abc']) {
    for (const mark of ['*', '/']) {
      for (const following of ['a', mark]) {
        const source = `${mark}${content}${mark}{.c}${following}`
        expect(format(source)).toBe(`${source}\n`)
      }
    }
  }
})
