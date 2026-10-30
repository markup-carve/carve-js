import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('refused continuation and first-block ownership', () => {
  it.each([
    '::: box\n- q\n+\nx\n+\n:::\n',
    '::: box\n* q\n+\nx\n+\n:::\n',
    '::: box\n1. q\n+\nx\n+\n:::\n',
  ])('keeps a trailing refused marker in its open attached paragraph', source => {
    const html = carveToHtml(source)
    expect(html).toContain('x\n+')
    expect(html).not.toContain('<p>+</p>')
  })

  it.each(['- ', '* ', '1. '])('keeps a sibling after a refused description first block (%s)', marker => {
    const html = carveToHtml(`:: t\n: ${marker}+\n  ${marker}z\n`)
    expect(html).toContain('<li>+</li>\n      <li>z</li>')
    expect(html).not.toContain('<li>\n        <ul>')
  })

  it('keeps a genuine indented child under a first-block list item', () => {
    const html = carveToHtml('- +\n  - z\n')
    expect(html).toContain('<li>+\n    <ul>')
  })
})
