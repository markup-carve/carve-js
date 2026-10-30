import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(`${source}\n`).trim()

describe('a guard of a held kind does not stand (carve#3973 X1, E3)', () => {
  it.each([
    ['*_a _~b~{t=*} z*', '<p><strong>_a _~b~{t=</strong>} z*</p>'],
    ['*_~a~{title="*_"} _~a~{title="*_"} z*', '<p><strong>_<s title="*_">a</s> _~a~{title=“</strong>_”} z*</p>'],
    ['*_~a~{title="*_"} _~a~{title="*_"} _~a~{title="*_"} z*', '<p><strong>_<s title="*_">a</s> _~a~{title=“</strong><u>“} _~a~{title=“*</u>”} z*</p>'],
  ])('%s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('one guarded child keeps its block', () => {
    expect(html('*_~a~{title="*_"} c* d_')).toBe('<p><strong>_<s title="*_">a</s> c</strong> d_</p>')
  })
})

describe('a braced opener under an open bare one forms first (E2a, E2, E3)', () => {
  it.each([
    ['_z {_~a_b~{c_} a_ b', '<p><u>z <u><s>a_b</s>{c</u> a</u> b</p>'],
    ['a {_*=_=*{c__} c_ d/', '<p>a <u><strong><mark>_</mark></strong>{c_</u> c_ d/</p>'],
  ])('%s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('where the guard stands, the pair keeps its block', () => {
    expect(html('{_~a~{c_}')).toBe('<p>{_<s c_="">a</s></p>')
  })
})
