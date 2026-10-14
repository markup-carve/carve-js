import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve, parse } from '../src/index.js'

describe('line block code through round-trip HTML', () => {
  it('imports code containing a colon closer line', () => {
    const source = '::: |\n`:::\n`\n'
    const imported = htmlToCarve(carveToHtml(source, { roundtrip: true }), { mode: 'roundtrip' })
    expect(carveToHtml(imported.value)).toBe(carveToHtml(source))
    expect(parse(imported.value).children).toMatchObject([
      { type: 'line_block', children: [{ type: 'paragraph', children: [{ type: 'code', value: ':::\n' }] }] },
    ])
  })

  it('imports a text line', () => {
    const source = '::: |\ntext\n'
    expect(() => htmlToCarve(carveToHtml(source, { roundtrip: true }), { mode: 'roundtrip' })).not.toThrow()
  })
})
