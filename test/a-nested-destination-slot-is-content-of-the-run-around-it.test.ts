import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('markup-carve/carve-js#3177: a nested run\'s destination slot is content (CARVE-P3-001)', () => {
  it('keeps an image alt open past a `]` inside a nested link destination', () => {
    expect(carveToHtml('![a [x](/u]) b](/i)\n^ cap')).toBe(
      '<figure>\n  <img src="/i" alt="a [x](/u]) b">\n  <figcaption>cap</figcaption>\n</figure>',
    )
    expect(carveToHtml('![a [x](/u[) b](/i)')).toBe('<img src="/i" alt="a [x](/u[) b">')
    expect(carveToHtml('![a [x](/u "t]") b](/i)')).toBe('<img src="/i" alt="a [x](/u &quot;t]&quot;) b">')
  })

  it('reads a span or link around the nested link as it does without the bracket', () => {
    expect(carveToHtml('[a [x](/u]) b]{.c}')).toBe(carveToHtml('[a [x](/uz) b]{.c}').replace('/uz', '/u]'))
    expect(carveToHtml('[a [x](/u]) b](/i)')).toBe(carveToHtml('[a [x](/u) b](/i)'))
  })

  it('leaves a top-level link and an unclosed outer bracket as they were', () => {
    expect(carveToHtml('[x](/u]) b]')).toBe('<p><a href="/u]">x</a> b]</p>')
    expect(carveToHtml('a [b [x](http://u/]) c')).toBe('<p>a [b <a href="http://u/]">x</a> c</p>')
  })

  perfIt('scans nested runs with open destination slots in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), '[a [x](/u ', { prefix: '![', suffix: '](/i)', label: 'nested open slots' })
    expectScansLinearly((input) => void carveToHtml(input), '[x](/u]) ', { prefix: '![', suffix: '](/i)', label: 'nested closed slots' })
  })
})
