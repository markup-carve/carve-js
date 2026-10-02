import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, tryRenderHtmlStreaming } from '../src/index.js'

describe('streaming render boundary', () => {
  it('delivers multiple complete UTF-16 chunks with exact concatenation', () => {
    const source = '# Heading\n\nSecond paragraph.\n'
    const chunks: string[] = []
    expect(tryRenderHtmlStreaming(source, {}, (chunk) => chunks.push(chunk))).toBe('complete')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(carveToHtml(source))
  })

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

it('bounds large chunks and matches the AST renderer', () => {
  for (const source of [
    'word & text '.repeat(20_000).trimEnd(),
    '```\n' + '<&>'.repeat(30_000) + '\n```\n',
    '- item with *strong*\n'.repeat(8_000),
    '| A | B |\n| --- | --- |\n' + '| alpha | beta |\n'.repeat(8_000),
  ]) {
    const chunks: string[] = []
    expect(tryRenderHtmlStreaming(source, {}, (chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(4096)
      chunks.push(chunk)
    })).toBe('complete')
    expect(chunks.length).toBeGreaterThan(10)
    expect(chunks.join('')).toBe(renderHtml(parse(source)))
  }
})

it('rejects late unsupported syntax without publishing the valid prefix', () => {
  const source = 'plain paragraph\n\n'.repeat(10_000) + '{unsupported}\n'
  expect(tryRenderHtmlStreaming(source, {}, () => { throw new Error('unexpected output') })).toBe('needs-ast')
})

it('snapshots URL options before callbacks can mutate them', () => {
  const options = { allowedUrlSchemes: ['https'] }
  const source = 'first\n\n[label](https://example.com)\n'
  const expected = renderHtml(parse(source), options)
  let output = ''
  expect(tryRenderHtmlStreaming(source, options, (chunk) => {
    options.allowedUrlSchemes.length = 0
    output += chunk
  })).toBe('complete')
  expect(output).toBe(expected)
})

it('calls once for empty output and propagates sink errors', () => {
  const chunks: string[] = []
  expect(tryRenderHtmlStreaming('', {}, (chunk) => chunks.push(chunk))).toBe('complete')
  expect(chunks).toEqual([''])
  const failure = new Error('sink failed')
  expect(() => tryRenderHtmlStreaming('text', {}, () => { throw failure })).toThrow(failure)
})

it('keeps supplementary characters whole at escaping and sink boundaries', () => {
  for (const width of [508, 509, 510, 511, 512, 4091, 4092, 4093, 4094, 4095, 4096]) {
    const source = 'a'.repeat(width) + '😀'.repeat(5000) + ' & tail\n'
    const chunks: string[] = []
    expect(tryRenderHtmlStreaming(source, {}, (chunk) => chunks.push(chunk))).toBe('complete')
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096)
      expect(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(chunk)).toBe(false)
    }
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString()).toBe(renderHtml(parse(source)))
  }
})

it('hands deeply nested lists back without publishing a prefix', () => {
  const source = Array.from({ length: 300 }, (_, level) => '  '.repeat(level) + '- item\n').join('')
  expect(tryRenderHtmlStreaming(source, {}, () => { throw new Error('unexpected output') })).toBe('needs-ast')
})
