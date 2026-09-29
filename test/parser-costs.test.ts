import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import { tryFastHtml } from '../src/fast-html.js'
import { toCodepointPositions } from '../src/source-positions.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'
import type { CarveExtension } from '../src/extension.js'
import type { Document, Paragraph } from '../src/ast.js'

const authoritative = (source: string) => renderHtml(resolve(parse(source)))

describe('parser cost reductions preserve output', () => {
  it('keeps fast-path admission and rendering around every complex inline spelling', () => {
    for (const token of ['{', '}', '^', '\\', '<', '>', '_', '~', '!', '@', '$', '=', '#', "'", '"', '--', '...', '/*', '*/', '``', '+-', '(c)', '(r)', '(tm)', ':x:']) {
      for (const prefix of ['', 'a', '😀']) {
        const source = `plain ${prefix}${token} tail\n`
        expect(tryFastHtml(source, {}), source).toBeUndefined()
        expect(carveToHtml(source), source).toBe(authoritative(source))
      }
    }
  })

  it('resumes the outer delimiter scan after rendering nested markup', () => {
    for (const source of [
      'A *bold /inner/ tail* and `code` with /last/.\n',
      'A [*bold* label](/target) and /last/.\n',
      'One: colon\nand another: colon\n',
      'A single: colon and /last/.\n',
      'Plain ' + 'word '.repeat(8192) + 'end\n',
      '`' + 'word '.repeat(8192) + 'end\n',
    ]) expect(carveToHtml(source), source.slice(0, 80)).toBe(authoritative(source))
  })

  it('keeps definition-free trees equal when an unused definition enables the prepass', () => {
    for (const source of [
      'alpha beta\n\ngamma delta\n',
      '> > quote\n\n- one\n  - two\n',
      '::: note\nbody\n:::\n',
      '```\nliteral\n```\n',
      ':: term\n: description\n',
      '😀 *strong*\r\n\r\nnext\r\n',
    ]) {
      const plain = parse(source)
      const scanned = parse(source + '\n\n[unused]: /unused\n')
      expect(scanned.children.filter(node => node.type !== 'link_reference_definition'), source).toEqual(plain.children)
    }
  })

  it('keeps definitions shared within containers and separate between documents', () => {
    const source = '> [ref][r]\n\n- [ref][r]\n\n[r]: /target\n'
    expect(carveToHtml(source).match(/href="\/target"/g)).toHaveLength(2)
    expect(carveToHtml('> [ref][r]\n\n- [ref][r]\n')).not.toContain('href=')
    expect(parse('[^n]: note\n\ntext[^n]\n').footnoteDefs).toBeDefined()
    expect(parse('text[^n]\n').footnoteDefs).toBeUndefined()
  })

  it('keeps pure extension matchers and their generated definitions active', () => {
    const extension: CarveExtension = {
      name: 'generated-definition',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@@ generated') return null
        return {
          node: { type: 'block_quote', children: ctx.parseBlocks('[r]: /local\n\n[ref][r]\n') },
          linesConsumed: 1,
        }
      },
    }
    const source = '@@ generated\n\n~~~\nliteral\n~~~\n'
    const options = { extensions: [extension] }
    const html = carveToHtml(source, options)
    expect(html).toContain('href="/local"')
    expect(carveToHtml(source + '\n\n[unused]: /unused\n', options)).toBe(html)
  })

  it('removes only trailing spaces and tabs while keeping long interior runs', () => {
    const middle = ' '.repeat(8192)
    const source = `a${middle}b  \n  c\t \nd\u00a0 \n`
    const expected = `a${middle}b\nc\nd\u00a0\n`
    expect(parse(source, { positions: false }).children)
      .toEqual(parse(expected, { positions: false }).children)
  })

  for (const [name, convert] of [['parse', parse], ['html', carveToHtml]] as const) {
    perfIt(`${name} scans interior whitespace in linear time`, () => {
      expectScansLinearly(source => void convert(source), ' ', {
        prefix: 'a', suffix: 'b\n', smallRepeats: 2048, label: 'interior spaces',
      })
    })
  }

  it('converts Unicode offsets and line starts together across mixed endings', () => {
    const source = 'a😀\r\nb\ud800c\rd\udc00e\n尾😀'
    const spans = [[1, 3], [5, 8], [9, 12], [13, 16]] as const
    const children: Paragraph[] = spans.map(([startOffset, endOffset], index) => ({
      type: 'paragraph', children: [],
      pos: { startLine: index + 1, endLine: index + 1, startOffset, endOffset, startColumn: 1, endColumn: 1 },
    }))
    const doc: Document = { type: 'document', children }
    toCodepointPositions(doc, source)
    expect(children.map(node => node.pos)).toEqual([
      { startLine: 1, endLine: 1, startOffset: 1, endOffset: 2, startColumn: 2, endColumn: 3 },
      { startLine: 2, endLine: 2, startOffset: 4, endOffset: 7, startColumn: 1, endColumn: 4 },
      { startLine: 3, endLine: 3, startOffset: 8, endOffset: 11, startColumn: 1, endColumn: 4 },
      { startLine: 4, endLine: 4, startOffset: 12, endOffset: 14, startColumn: 1, endColumn: 3 },
    ])
  })
})
