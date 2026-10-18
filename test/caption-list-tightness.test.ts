import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

describe('caption inside a list item', () => {
  it('keeps the list tight with one blank before the caption', () => {
    const html = carveToHtml('- | a |\n\n  ^ cap\n- c\n')
    expect(html).toContain('<caption>cap</caption>')
    expect(html).toContain('<li>c</li>')
  })

  it('loosens when two blanks detach the caption', () => {
    const html = carveToHtml('- | a |\n\n\n  ^ cap\n- c\n')
    expect(html).toContain('<li><p>c</p></li>')
  })

  it.each([
    '![a](b.png)',
    '> q',
    '```\n  x\n  ```',
    '$$`x`',
    '| a |\n  + b |',
    '> q\n  more',
    '::: figure\n  ![a](b.png)\n  :::',
  ])('keeps a captioned host tight: %s', (host) => {
    const html = carveToHtml(`- ${host}\n\n  ^ cap\n- c\n`)
    expect(html).toContain('>cap</')
    expect(html).toContain('<li>c</li>')
  })

  it('treats a caption after a paragraph as a second paragraph', () => {
    const html = carveToHtml('- text\n\n  ^ cap\n- c\n')
    expect(html).toContain('<li><p>c</p></li>')
  })

  it('keeps the same tightness when positions are disabled', () => {
    for (const input of [
      '- | a |\n\n  ^ cap\n- c\n',
      '::: note\n- | a |\n\n  ^ cap\n- c\n:::\n',
    ]) {
      const list = parse(input, { positions: false }).children[0]
      const nested = list?.type === 'admonition' ? list.children[0] : list
      expect(nested?.type).toBe('list')
      if (nested?.type === 'list') expect(nested.tight).toBe(true)
    }
  })

  it('ignores captions found while measuring an attached block', () => {
    const input = '- text\n\n  ^ cap\n+\n| a |\n| b |\n^ c2\n- c\n'
    const list = parse(input).children[0]
    expect(list?.type).toBe('list')
    if (list?.type === 'list') expect(list.tight).toBe(false)
    expect(carveToHtml(input)).toContain('<p>^ cap</p>')
  })

  it.each([
    '::: note\n  q\n  :::',
    '>',
    '```=html\n  <b>\n  ```',
    'text\n  ![a](b.png)',
    '$$`x` and more',
  ])('keeps an orphan caption as a paragraph: %s', (host) => {
    const html = carveToHtml(`- ${host}\n\n  ^ cap\n- c\n`)
    expect(html).toContain('<p>^ cap</p>')
    expect(html).toContain('<li><p>c</p></li>')
  })
})
