import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

const html = (source: string): string => carveToHtml(source).trim()

const shapes: Array<[string, string]> = [
  ['heading', '# h'],
  ['quote', '> q'],
  ['code fence', '```\ncode\n```'],
  ['raw fence', '```=html\n<b>x</b>\n```'],
  ['comment fence', '%%%\nhidden\n%%%'],
  ['colon fence', '::: note\nbody\n:::'],
  ['table', '| A |\n| b |'],
  ['definition list', ':: term\n:  def'],
  ['nested list', '- one\n  - two'],
  ['attributes plus target', '{.c}\n# h'],
]

const indent = (source: string, width: number): string =>
  source
    .split('\n')
    .map((line) => `${' '.repeat(width)}${line}`)
    .join('\n')

describe('authored block bases in definition and footnote bodies (carve#1729)', () => {
  for (const [name, body] of shapes) {
    it(`reads exact and over-indented ${name} blocks alike`, () => {
      const exactFootnote = `[^n]: intro\n\n${indent(body, 2)}\n\nsee[^n]\n`
      const overFootnote = `[^n]: intro\n\n${indent(body, 3)}\n\nsee[^n]\n`
      expect(html(overFootnote), `${name}, footnote`).toBe(html(exactFootnote))

      const exactDefinition = `:: term\n:  intro\n\n${indent(body, 3)}\n`
      const overDefinition = `:: term\n:  intro\n\n${indent(body, 4)}\n`
      expect(html(overDefinition), `${name}, definition`).toBe(html(exactDefinition))
    })
  }

  it('canonicalizes the opener base while preserving payload indentation', () => {
    const source = '[^n]: intro\n\n   ```\n     code\n   ```\n\nsee[^n]\n'
    const formatted = carveToCarve(source)
    expect(formatted).toContain('\n  ```\n    code\n  ```\n')
    expect(carveToCarve(formatted)).toBe(formatted)
    expect(html(formatted)).toBe(html(source))
  })

  it('keeps source positions anchored in the authored input', () => {
    const source = ':: term\n:  intro\n\n    # heading\n'
    const document = parse(source) as any
    const definition = document.children[0].items[0].definitions[0]
    const heading = definition.find((node: any) => node.type === 'heading')
    const text = heading.children[0]
    expect(source.slice(text.pos.startOffset, text.pos.endOffset)).toBe('heading')
  })
})
