import { describe, expect, it } from 'vitest'
import {
  carveToHtml, carveToMarkdownWithReport, carveToAnsiWithReport,
  carveToPlainText, carveToAnsi,
} from '../src/index.js'

describe('ruled JavaScript regressions', () => {
  it('drops paired quotation marks from generated heading ids', () => {
    for (const [open, close] of [['„', '“'], ['‚', '‘'], ['«', '»'], ['‟', '”']]) {
      expect(carveToHtml(`# q ${open}2 active${close}\n`)).toContain('id="q-2-active"')
    }
  })

  it('lets the second consecutive marker attach a block in a hosted quote', () => {
    const source = '::: note\n> q\n+\n+\ntail\n:::\n'
    expect(carveToHtml(source)).toContain('<p>q</p>\n    <p>tail</p>')
  })

  it('denies a scheme exposed by target normalization', () => {
    const source = '[x](\u202ejavascript:alert(1))\n'
    const markdown = carveToMarkdownWithReport(source)
    const ansi = carveToAnsiWithReport(source)
    expect(markdown.value).toContain('[x]()')
    expect(markdown.losses.map(loss => loss.code)).toEqual(['destination-denied'])
    expect(ansi.value).toContain('()')
    expect(ansi.losses.map(loss => loss.code)).toEqual(['destination-denied'])
  })

  it('uses spaces for soft breaks in literal unresolved reference labels', () => {
    const source = '[t][r\nx]\n'
    expect(carveToPlainText(source)).toContain('[t][r x]')
    expect(carveToAnsi(source)).toContain('[t][r x]')
  })

  it('keeps an invalid line-range code include opaque in core HTML', () => {
    const source = '{{ data/p2.csv @code:csv @lines:01-2 }}\n'
    expect(carveToHtml(source)).toContain('<p>{{ data/p2.csv @code:csv @lines:01-2 }}</p>')
  })
})
