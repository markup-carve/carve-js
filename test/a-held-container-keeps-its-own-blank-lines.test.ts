import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const tightness = (node: unknown): boolean[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as Record<string, unknown>
  return [
    ...(value.type === 'list' ? [value.tight as boolean] : []),
    ...Object.values(value).flatMap(tightness),
  ]
}

describe('a held container keeps its own blank lines', () => {
  for (const opener of ['::: inner', ':::', '::: note', '::: warning', '::: |', '::: >', '::: \\']) {
    for (const host of ['plain', 'quote', 'nested', 'depth2', 'boxed', 'quoted-box']) {
      for (const position of ['interior', 'comment', 'after', 'none']) {
        for (const follower of ['end', 'paragraph', 'sibling', 'unclosed']) {
          it(`${opener} / ${host} / ${position} / ${follower}`, () => {
            let lines = [`- ${opener}`, '  a']
            if (position === 'interior') lines.push('', '  x')
            if (position === 'comment') lines.push('  %%%', '  hidden', '  %%%', '', '  x')
            if (follower !== 'unclosed') lines.push('  :::')
            if (position === 'after') lines.push('', '  tail')
            if (follower === 'paragraph') lines.push('', '  following')
            if (follower === 'sibling') lines.push('', '- sibling')
            if (host === 'nested' || host === 'depth2') {
              lines = ['- outer', ...lines.map(line => line ? `  ${line}` : '')]
              if (host === 'depth2') lines = ['- root', ...lines.map(line => line ? `  ${line}` : '')]
            }
            if (host === 'boxed' || host === 'quoted-box') {
              lines = ['- ::: box', ...lines.map(line => line ? `  ${line}` : ''), '  :::']
            }
            if (host === 'quote' || host === 'quoted-box') lines = lines.map(line => line ? `> ${line}` : '>')
            const source = lines.join('\n') + '\n'
            const tight = follower === 'unclosed' || (position !== 'after' && follower === 'end')
            const expected = host === 'depth2' ? [true, true, tight]
              : ['nested', 'boxed', 'quoted-box'].includes(host) ? [true, tight] : [tight]
            expect(tightness(parse(source))).toEqual(expected)
          })
        }
      }
    }
  }

  it('renders paragraphs inside the held container', () => {
    const source = ['- ::: inner', '  a', '', '  x', '  :::'].join('\n')
    expect(carveToHtml(source)).toContain('<p>a</p>\n      <p>x</p>')
  })

  it.each([
    ['- > a', '  >', '  > x'],
    ['- outer', '  - a', '', '    x'],
    ['- :: term', '  : a', '', '    x'],
  ])('keeps descendant paragraphs in their own container: %s', (...lines) => {
    const source = lines.join('\n')
    expect(tightness(parse(source))).toEqual(lines[0] === '- outer' ? [true, false] : [true])
  })
})
