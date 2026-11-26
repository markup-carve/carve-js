import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { render, tryRenderHtmlStreaming } from '../public/index.ts'

const cases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as {
  cases: { id: string, input?: string, options?: object, expected?: { html?: string } }[]
}).cases

describe('streaming HTML render', () => {
  it('publishes exact HTML after successful render, including empty output', () => {
    for (const source of ['', '= Heading\n\nText with *strong*.\n', '😀 & text\n']) {
      const chunks: string[] = []
      expect(tryRenderHtmlStreaming(source, {}, chunk => chunks.push(chunk))).toBe('complete')
      expect(chunks).toEqual([render(source)])
    }
  })

  it('matches normal render over the clause cases', () => {
    let compared = 0
    for (const entry of cases) {
      if (entry.input === undefined || entry.expected?.html === undefined) continue
      const chunks: string[] = []
      const options = entry.options ?? {}
      let normal: string
      try { normal = render(entry.input, options) } catch { continue }
      expect(tryRenderHtmlStreaming(entry.input, options, chunk => chunks.push(chunk)), entry.id).toBe('complete')
      expect(chunks.join(''), entry.id).toBe(normal)
      compared++
    }
    expect(compared).toBeGreaterThan(300)
  })

  it('never calls the sink when render throws, and propagates sink errors', () => {
    let called = false
    expect(() => tryRenderHtmlStreaming('x', { mode: 'invalid' as never }, () => { called = true })).toThrow()
    expect(called).toBe(false)
    const error = new Error('sink failed')
    expect(() => tryRenderHtmlStreaming('x', {}, () => { throw error })).toThrow(error)
  })
})
