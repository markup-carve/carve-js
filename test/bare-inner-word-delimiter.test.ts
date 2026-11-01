import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

describe('bare spans with an inner word delimiter', () => {
  it.each(['/', '_', '*', '~', '='])('leaves a %s span literal when its content has the same delimiter inside a word', delimiter => {
    const input = `${delimiter}my${delimiter}var${delimiter}`
    expect(carveToHtml(input).trim()).toBe(`<p>${input}</p>`)
    expect(carveToHtml(`{${input}}`).trim()).toContain('my' + delimiter + 'var')
  })

  it('still pairs a span with no inner delimiter', () => {
    expect(carveToHtml('/etc/').trim()).toBe('<p><em>etc</em></p>')
  })

  it('braces Markdown emphasis whose content contains an inner slash', () => {
    expect(markdownToCarve('*usr/local*\n')).toBe('{/usr/local/}\n')
  })
})
