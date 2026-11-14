// The findings of the first code review of the 0.2 engine, one test per finding, named with the clause each one cites.
import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

describe('linear passes', () => {
  it('C2-I-099: a term reads the character behind the empty spans that follow it, and many spans stay linear', () => {
    expect(render('*[A]: B\n\nA[]{.x}[]{.x} A[]{.x}b')).toBe(
      '<p><abbr title="B">A</abbr><span class="x"></span><span class="x"></span> A<span class="x"></span>b</p>',
    )
    const spans = parse(`*[A]: B\n\nA ${'[]{.x}'.repeat(20000)} A`).children.at(-1) as { children: { type: string }[] }
    expect(spans.children.filter((node) => node.type === 'abbreviation')).toHaveLength(2)
  })

  it('C2-A-035: a later key replaces an earlier one of the same name at its first place, over blocks and lines', () => {
    expect(parse('{k=1 j=2 K=3}\nx').children[0]!.attrs).toEqual({ keyValues: [['k', '3'], ['j', '2']] })
    expect(parse('{k=1}\n{j=2}\n{K=3}\nx').children[0]!.attrs).toEqual({ keyValues: [['k', '3'], ['j', '2']] })
    const many = parse(`{${Array.from({ length: 20000 }, (_, index) => `k${index % 10000}=${index}`).join(' ')}}\nx`).children[0]!
    expect(many.attrs?.keyValues).toHaveLength(10000)
    expect(many.attrs?.keyValues?.[0]).toEqual(['k0', '10000'])
  })

  it('C2-H-141: a reference and its definition with many keys merge, and the reference decides a key', () => {
    expect(render('[x][r]{a=1 B=2}\n\n{b=3 c=4}\n[r]: /u')).toBe('<p><a href="/u" c="4" a="1" B="2">x</a></p>')
  })
})
