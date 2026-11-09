import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const F = '```'

describe('a sibling item after the blank of an open child fence in a description- or quote-attached list (carve#5575)', () => {
  it('keeps the sibling in the description', () => {
    expect(carveToHtml(`:: t\n: +\n- li\n  ${F}\n\n- sib\n`)).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li><p>li</p>\n        <pre><code>\n</code></pre>\n      </li>\n' +
      '      <li><p>sib</p></li>\n    </ul>\n  </dd>\n</dl>')
  })

  it('keeps the sibling in the quote', () => {
    expect(carveToHtml(`> +\n- li\n  ${F}\n\n- sib\n`)).toBe(
      '<blockquote>\n  <ul>\n    <li><p>li</p>\n      <pre><code>\n</code></pre>\n    </li>\n' +
      '    <li><p>sib</p></li>\n  </ul>\n</blockquote>')
  })

  it('holds across hosts, markers, fences, payloads and blank runs', () => {
    let checked = 0
    for (const host of [':: t\n: +\n', ':: t\n:  +\n', ':: t\n: x\n: +\n'])
      for (const [lead, indent, sibling] of [['- li', '  ', '- sib'], ['1. li', '   ', '2. sib'], ['- ', '  ', '- sib']] as const)
        for (const fence of [F, `${F} x`, '~~~', '````'])
          for (const payload of [[], ['code']])
            for (const blanks of ['\n', '\n\n']) {
              const opener = lead === '- ' ? `- ${fence}` : `${lead}\n${indent}${fence}`
              const source = `${host}${[opener, ...payload.map(line => indent + line)].join('\n')}\n${blanks}${sibling}\n`
              const html = carveToHtml(source)
              expect(html, source).toMatch(/<p>sib<\/p><\/li>\n {4}<\/[uo]l>\n {2}<\/dd>\n<\/dl>$/)
              expect(html.match(/<pre>/g), source).toHaveLength(1)
              checked++
            }
    expect(checked).toBe(144)
  })

  it('ends a comment span the list left open at a sibling marker, as at the root', () => {
    const html = carveToHtml(`:: t\n: +\n- a\n  %%%\n- b\n  ${F}\n\n- c\n`)
    expect(html).toContain('<li><p>c</p></li>\n    </ul>\n  </dd>\n</dl>')
  })

  it('still ends the list at a blank when no fence is open', () => {
    expect(carveToHtml(':: t\n: +\n- li\n\n- sib\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>li</li>\n    </ul>\n  </dd>\n</dl>\n<ul>\n  <li>sib</li>\n</ul>')
  })
})
