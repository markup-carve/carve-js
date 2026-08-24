import { describe, expect, it } from 'vitest'
import { carveToHtml, tryRenderHtmlStreaming } from '../src/index.js'

describe('streaming render boundary', () => {
  it('emits accepted input byte-identically', () => {
    const source = '# Heading\n\nText with *strong*.\n'
    let output = ''
    expect(tryRenderHtmlStreaming(source, {}, (chunk) => (output += chunk))).toBe('complete')
    expect(output).toBe(carveToHtml(source))
  })

  it('emits nothing before an AST fallback', () => {
    let called = false
    expect(
      tryRenderHtmlStreaming('[^note]: Body.\n\nText[^note].\n', {}, () => (called = true)),
    ).toBe('needs-ast')
    expect(called).toBe(false)
  })
})
