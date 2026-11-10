import { describe, expect, it } from 'vitest'
import { carveToHtmlWithReport } from '../src/index.js'

describe('a former carrier spelling is an ordinary attribute on roundtrip export', () => {
  it.each(['data-djot-ref', 'DATA-DJOT-TIGHT', 'data-djot-escaped'])('keeps %s', (name) => {
    const source = `[a](/u){${name}=x}\n`
    const exported = carveToHtmlWithReport(source, { roundtrip: true })
    expect(exported.value.toLowerCase()).toContain(`${name.toLowerCase()}="x"`)
    expect(exported.losses).toEqual([])
    const ordinary = carveToHtmlWithReport(source)
    expect(ordinary.value.toLowerCase()).toContain(`${name.toLowerCase()}="x"`)
    expect(ordinary.losses).toEqual([])
  })

  it('keeps a data-djot- name that spells no carrier', () => {
    const exported = carveToHtmlWithReport('[a](/u){data-djot-keep=x}\n', { roundtrip: true })
    expect(exported.value).toContain('data-djot-keep="x"')
    expect(exported.losses).toEqual([])
  })
})
