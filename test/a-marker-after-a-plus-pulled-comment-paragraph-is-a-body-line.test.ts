import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `+`-pulled comment-only paragraph reads as a `%%` line, so a list marker past the
// `+` column after it is a body line (markup-carve/carve-js#4894, carve#4799).
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

const COMMENTS = [['{% b %}'], ['{% b', ' b %}'], ['{% b', '   b %}'], ['{% a %} {% b %}']]
const MARKERS = [['- n'], ['* n'], ['1. n'], ['- [ ] n'], ['- n', '- m'], ['- n', '', '  p']]
// Head lines, tail lines and the body column of each host.
const HOSTS: Array<[string[], string[], number]> = [
  [[':: t', ': +'], [], 2],
  [[':: t', ':  +'], [], 3],
  [['[^n]: +'], ['', '', '[^n]'], 2],
  [['> :: t', '> : +'], [], 2],
]

describe('a marker after a plus-pulled comment paragraph is a body line', () => {
  it('renders the reproduction as a list in the description', () => {
    expect(html(':: t\n: +\n{% b\n b %}\n  - n\n')).toBe('<dl><dt>t</dt><dd><ul><li>n</li></ul></dd></dl>')
  })

  for (const [head, tail, bodyColumn] of HOSTS) {
    const quoted = head[0]!.startsWith('>')
    for (const comment of COMMENTS) {
      for (const marker of MARKERS) {
        for (const column of [bodyColumn, bodyColumn + 1, 6]) {
          const shape = (lines: string[]) => {
            const body = [...lines, ...marker.map((line) => line === '' ? '' : ' '.repeat(column) + line)]
            return [...head, ...body.map((line) => quoted && line !== '' ? '> ' + line : line), ...tail].join('\n') + '\n'
          }
          const source = shape(comment)
          it(JSON.stringify(source), () => expect(html(source)).toBe(html(shape(comment.map(() => '%% c')))))
        }
      }
    }
  }
})
