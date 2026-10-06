import { describe, expect, it } from 'vitest'
import { AppendOnlyCloser } from '../src/append-only-closer.js'
import { expectBuiltInputScansLinearly, expectScansLinearly, perfIt } from './helpers/scaling.js'
import { carveToHtml } from '../src/index.js'

describe('append-only nested lead closer', () => {
  it('checks each new line once and never treats the lead as a closer', () => {
    let checked = 0
    const scan = new AppendOnlyCloser(line => { checked++; return line === '%%%' })
    const lines = ['%%%']
    for (let n = 0; n < 200; n++) {
      lines.push('body')
      expect(scan.closedIn(lines)).toBe(false)
      expect(scan.closedIn(lines)).toBe(false)
    }
    expect(checked).toBe(200)
    lines.push('%%%')
    expect(scan.closedIn(lines)).toBe(true)
    lines.push('body')
    expect(scan.closedIn(lines)).toBe(true)
    expect(checked).toBe(201)
  })

  it('matches a complete scan at every prefix', () => {
    for (const closer of ['%%%', '```', '~~~', undefined]) {
      const scan = new AppendOnlyCloser(closer === undefined ? undefined : line => line.trim() === closer)
      const lines: string[] = []
      for (const line of ['```', 'text', '', '  ~~~', ' %%%', '```', 'text']) {
        lines.push(line)
        expect(scan.closedIn(lines)).toBe(closer !== undefined && lines.some((s, i) => i > 0 && s.trim() === closer))
      }
    }
  })

  it('recognizes closers before a flush-left follower, including after a blank', () => {
    for (const gap of ['', '\n']) {
      expect(carveToHtml(':: t\n: - %%%\n' + gap + '    %%%\nx\n')).toMatch(/<\/dl>\s*<p>x<\/p>/)
      const code = carveToHtml(':: t\n: - ```\n' + gap + '    ```\n~~~\n')
      expect(code).toContain('    <p>~~~</p>\n  </dd>')
    }
  })

  it('keeps long unclosed comment and code leads within their description', () => {
    const body = 'x\n'.repeat(200)
    const comment = carveToHtml(':: t\n: - %%%\n' + body)
    expect(comment).toContain('    <p>' + body.trimEnd() + '</p>\n  </dd>')
    expect(comment).not.toMatch(/<\/dl>\s*<p>/)
    const output = carveToHtml(':: t\n: - ```\n' + '~~~\n'.repeat(200))
    expect(output).toContain('<pre><code>')
    expect(output).toContain('~~~\n'.repeat(200))
  })
})

for (const [name, lead, unit] of [
  ['comment', ':: t\n: - %%%\n', 'x\n'],
  ['code', ':: t\n: - ```\n', '~~~\n'],
] as const) {
  perfIt(`description ${name} closer scans scale linearly`, () => {
    expectScansLinearly(carveToHtml, unit, { prefix: lead, smallRepeats: 2000, label: `description ${name} closer` })
  })
}

perfIt('literal colon paragraph interruption scales linearly', () => {
  expectBuiltInputScansLinearly(carveToHtml, n => 'x\n'.repeat(n) + ':::bogus\n' + ':::\n'.repeat(n), { smallRepeats: 2000, label: 'literal colon paragraph interruption' })
})
