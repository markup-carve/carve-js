import { describe, expect, it } from 'vitest'
import { carveToHtmlWithReport } from '../src/index.js'

describe('a deprecated carrier spelling is dropped on roundtrip export', () => {
  it.each(['data-djot-ref', 'DATA-DJOT-TIGHT', 'data-djot-escaped'])('drops and reports %s', (name) => {
    const source = `[a](/u){${name}=x}\n`
    const exported = carveToHtmlWithReport(source, { roundtrip: true })
    expect(exported.value.toLowerCase()).not.toContain(name.toLowerCase())
    expect(exported.losses).toContainEqual(expect.objectContaining({ code: 'carrier-attribute-dropped', attribute: name }))
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
