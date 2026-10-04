import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

it('keeps empty and space-ended combined spans on their fallback', () => {
  for (const source of ['/**/', '/*/', '/*a */', '/*a [x */]', '[/*a x]y*/']) {
    expect(JSON.stringify(parse(source))).not.toContain('"boldItalic":true')
  }
  expect(carveToHtml('/*yes*/')).toContain('<strong><em>yes</em></strong>')
  expect(JSON.stringify(parse('/**/ x*/'))).toContain('"boldItalic":true')
  expect(JSON.stringify(parse('/*a */ /*yes*/'))).toContain('"boldItalic":true')
})

perfIt('failed combined spans keep their cost per byte bounded', () => {
  for (const suffix of ['', ' [x */]']) {
    expectBuiltInputScansLinearly(
      (source) => void parse(source),
      (n) => '/*a '.repeat(n) + suffix,
      { smallRepeats: 4096, largeRepeats: 16384 },
    )
  }
})

it('keeps nested angles in cross-reference targets', () => {
  expect(JSON.stringify(parse('</#a<b>'))).toContain('"target":"a<b"')
  const source = '</#'.repeat(512) + ' x></#valid>\n\n# valid'
  expect(carveToHtml(source)).toContain('href="#valid"')
})

perfIt('invalid cross-reference targets share their failed suffix', () => {
  for (const suffix of ['', ' x>']) {
    expectBuiltInputScansLinearly(
      (source) => void parse(source),
      (n) => '</#'.repeat(n) + suffix,
      { smallRepeats: 4096, largeRepeats: 16384 },
    )
  }
})
