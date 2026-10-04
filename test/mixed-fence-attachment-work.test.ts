import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

describe('false fence closers in colon attachments', () => {
  for (const character of ['`', '~']) {
    for (const nested of [false, true]) {
      for (const positions of [false, true]) {
        for (const varyingWidth of [false, true]) {
          for (const indented of [false, true]) {
            it(`bounds failed lookahead: ${character}, nested=${nested}, positions=${positions}, varyingWidth=${varyingWidth}, indented=${indented}`, () => {
              for (const count of [16, 128, 512]) {
                const opposite = character === '`' ? '~' : '`'
                const openers = Array.from({ length: count }, (_, i) => character.repeat(varyingWidth ? i + 3 : 3) + 'x\n').join('')
                const source = (nested ? '::: outer\n' : '') + '- item\n+\n::: box\n' + openers
                  + (indented ? ' ' : '') + character.repeat(varyingWidth ? count + 3 : 3) + (indented ? '' : opposite) + '\n:::\n' + (nested ? ':::\n' : '')
                const previous = layoutWork.on
                layoutWork.reset()
                layoutWork.on = true
                try {
                  const ast = parse(source, { positions })
                  expect(layoutWork.fenceCandidateLines).toBeLessThanOrEqual(source.split('\n').length * 2)
                  expect(renderHtml(ast)).toContain('item')
                  expect(renderHtml(ast)).toContain('class="box"')
                } finally {
                  layoutWork.on = previous
                  layoutWork.reset()
                }
              }
            })
          }
        }
      }
    }
    for (const count of [16, 128, 512]) {
      for (const shape of ['attachments', 'descending'] as const) {
        it(`bounds ${shape} with ${count} ${character} openers`, () => {
          const source = shape === 'attachments'
            ? '- item\n' + ('+\n::: box\n' + character.repeat(3) + 'x\n:::\n').repeat(count) + ' ' + character.repeat(3) + '\n'
            : '- item\n+\n::: box\n' + Array.from({ length: count }, (_, i) => character.repeat(count + 3 - i) + '\n').join('')
              + ' ' + character.repeat(count + 4) + '\n:::\n'
          const previous = layoutWork.on
          layoutWork.reset()
          layoutWork.on = true
          try {
            expect(renderHtml(parse(source))).toContain('item')
            expect(layoutWork.fenceCandidateLines).toBeLessThanOrEqual(source.split('\n').length * 3)
          } finally {
            layoutWork.on = previous
            layoutWork.reset()
          }
        })
      }
    }
    it(`keeps reference definitions inside ${character} code literal`, () => {
      const opposite = character === '`' ? '~' : '`'
      const source = character.repeat(3) + '\n' + character.repeat(3) + opposite + '\n[x]: /url\n' + character.repeat(3) + '\n\n[text][x]\n'
      const ast = parse(source)
      expect(ast.children.some(node => node.type === 'link_reference_definition')).toBe(false)
      expect(renderHtml(ast)).toContain('<p>[text][x]</p>')
    })
    it(`accepts a shorter closer after a failed wide ${character} opener`, () => {
      const source = '- item\n+\n::: box\n' + character.repeat(6) + 'x\n' + character.repeat(3) + 'x\npayload\n' + character.repeat(3) + '\n ' + character.repeat(6) + '\n:::\n'
      const previous = layoutWork.on
      layoutWork.reset()
      layoutWork.on = true
      try {
        expect(renderHtml(parse(source))).toContain('<pre><code class="language-x">')
        expect(layoutWork.fenceCandidateLines).toBeGreaterThan(source.split('\n').length - 5)
      } finally {
        layoutWork.on = previous
        layoutWork.reset()
      }
    })
    it(`accepts a longer uniform ${character} closer`, () => {
      const source = '- item\n+\n::: box\n' + character.repeat(3) + '\npayload\n' + character.repeat(5) + '\n:::\n'
      const previous = layoutWork.on
      layoutWork.reset()
      layoutWork.on = true
      try {
        expect(renderHtml(parse(source))).toContain('<pre><code>payload\n</code></pre>')
        expect(layoutWork.fenceCandidateLines).toBeGreaterThan(0)
        expect(layoutWork.fenceCandidateLines).toBeLessThanOrEqual(source.split('\n').length * 2)
      } finally {
        layoutWork.on = previous
        layoutWork.reset()
      }
    })
  }
})
