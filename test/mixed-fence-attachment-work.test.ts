import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

function measured(source: string, positions = true) {
  const previous = layoutWork.on
  layoutWork.reset()
  layoutWork.on = true
  try {
    const ast = parse(source, { positions })
    return { ast, html: renderHtml(ast), code: layoutWork.fenceCandidateLines, colon: layoutWork.attachmentColonLines }
  } finally {
    layoutWork.on = previous
    layoutWork.reset()
  }
}

function bounded(source: string, positions = true) {
  const result = measured(source, positions)
  const lines = source.split('\n').length
  expect(result.code).toBeLessThanOrEqual(lines * 3)
  expect(result.colon).toBeLessThanOrEqual(lines * 3)
  return result
}

describe('false fence closers in colon attachments', () => {
  for (const character of ['`', '~']) {
    for (const nested of [false, true]) {
      for (const positions of [false, true]) {
        for (const varyingWidth of [false, true]) {
          for (const indented of [false, true]) {
            it(`bounds failed lookahead: ${character}, nested=${nested}, positions=${positions}, varying=${varyingWidth}, indented=${indented}`, () => {
              for (const count of [16, 128, 512]) {
                const opposite = character === '`' ? '~' : '`'
                const openers = Array.from({ length: count }, (_, i) => character.repeat(varyingWidth ? i + 3 : 3) + 'x\n').join('')
                const falseCloser = (indented ? ' ' : '') + character.repeat(varyingWidth ? count + 3 : 3) + (indented ? '' : opposite)
                const source = (nested ? '::: outer\n' : '') + '- item\n+\n::: box\n' + openers
                  + falseCloser + '\n:::\n' + (nested ? ':::\n' : '')
                const result = bounded(source, positions)
                expect(result.html).toContain('item')
                expect(result.html).toContain('class="box"')
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
          expect(bounded(source).html).toContain('item')
        })
      }
      it(`bounds unclosed colon attachments with ${count} closed ${character} spans`, () => {
        const block = '+\n::: box\n' + character.repeat(3) + 'x\npayload\n' + character.repeat(3) + '\n'
        const source = '- item\n' + block.repeat(count) + ' :::\n'
        expect(bounded(source).html).toContain('payload')
      })
    }
    it(`keeps reference definitions inside ${character} code literal`, () => {
      const opposite = character === '`' ? '~' : '`'
      const source = character.repeat(3) + '\n' + character.repeat(3) + opposite + '\n[x]: /url\n'
        + character.repeat(3) + '\n\n[text][x]\n'
      const result = measured(source)
      expect(result.ast.children.some(node => node.type === 'link_reference_definition')).toBe(false)
      expect(result.html).toContain('<p>[text][x]</p>')
    })
    it(`accepts a shorter closer after a failed wide ${character} opener`, () => {
      const source = '- item\n+\n::: box\n' + character.repeat(6) + 'x\n' + character.repeat(3)
        + 'x\npayload\n' + character.repeat(3) + '\n ' + character.repeat(6) + '\n:::\n'
      const result = bounded(source)
      expect(result.html).toContain('<pre><code class="language-x">')
      expect(result.code).toBeGreaterThan(0)
    })
    it(`accepts a longer uniform ${character} closer`, () => {
      const source = '- item\n+\n::: box\n' + character.repeat(3) + '\npayload\n' + character.repeat(5) + '\n:::\n'
      const result = bounded(source)
      expect(result.html).toContain('<pre><code>payload\n</code></pre>')
      expect(result.code).toBeGreaterThan(0)
    })
  }
  for (const count of [16, 128, 512]) {
    for (const shape of ['descending-success', 'sawtooth'] as const) {
      it(`bounds ${shape} opaque spans across ${count} unclosed attachments`, () => {
        const source = '- item\n' + Array.from({ length: count }, (_, i) => '+\n::: box\n'
          + '`'.repeat(shape === 'sawtooth' ? 4 - i % 2 : count + 3 - i) + '\n').join('')
          + (shape === 'sawtooth' ? '' : '+\n::: box\n' + '`'.repeat(count + 4) + '\n') + ' :::\n'
        expect(bounded(source).html).toContain('item')
      })
    }
  }
  it('reuses a positive nested colon boundary', () => {
    const source = '- item\n+\n::: a\n+\n::: b\n:::\n'
    expect(bounded(source).html).toContain('class="b"')
  })
  it('bounds short attachments at many distinct content columns', () => {
    const source = Array.from({ length: 32 }, (_, i) => ' '.repeat(i + 1)
      + '- item\n+\n```x\npayload\n```\n\n').join('')
    expect(bounded(source).html).toContain('payload')
  })
  for (const count of [16, 128, 512]) {
    for (const pairedTail of [false, true]) {
      it(`bounds long tails, paired=${pairedTail}, after ${count} overlapping opaque attachments`, () => {
        const source = '- item\n' + Array.from({ length: count }, (_, i) => '+\n::: box\n' + '`'.repeat(count + 3 - i) + '\n').join('')
          + '`'.repeat(count + 4) + '\n' + 'payload\n'.repeat(2000) + (pairedTail ? '::: tail\n:::\n' : '') + ' :::\n'
        expect(bounded(source).html).toContain('payload')
      })
    }
  }
  it('keeps cached closer characters separate', () => {
    const source = '- item\n+\n::: box\n````x\n~~~x\npayload\n~~~\n ````\n:::\n'
    const result = bounded(source)
    expect(result.code).toBeGreaterThan(0)
    expect(result.html).toContain('payload')
  })
  for (const prefix of ['  - item\n', '- +\n', '[^n]: item\n', ':: term\n:  item\n']) {
    it(`bounds repeated attachments after ${JSON.stringify(prefix)}`, () => {
      const source = prefix + ('+\n::: box\n```x\n:::\n').repeat(128) + ' ```\n'
      expect(JSON.stringify(bounded(source).ast)).toContain('box')
    })
  }
  it('keeps different content columns separate in one lexer', () => {
    const source = '  - item\n+\n::: box\n```x\n:::\n\n- next\n+\n::: box\n```x\npayload\n  ```\n:::\n'
    expect(bounded(source).html).toContain('next')
  })
})
