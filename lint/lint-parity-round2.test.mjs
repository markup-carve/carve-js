import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const codes = (source) => lint(source).map((entry) => entry.code)

describe('0.2 lint leaf ownership and visual columns', () => {
  it('C2-B-154: a heading continuation is not paragraph text for the list marker rule', () => {
    expect(codes('# H\n - - -\n')).toEqual([
      'deprecated-indented-line-under-heading',
      'deprecated-spaced-thematic-break',
    ])
    for (const mark of ['-', '*']) {
      for (const indent of [' ', '  ', '\t']) {
        expect(codes(`# H\n${indent}${mark} ${mark} ${mark}\n`)).not.toContain('list-marker-without-blank-line')
      }
    }
    expect(codes('text\n- item\n')).toContain('list-marker-without-blank-line')
  })

  it('C2-B-004 and C2-B-154: a tab past the marker continues the heading', () => {
    expect(codes('# H\n\t---\n')).toEqual([
      'deprecated-indented-line-under-heading',
      'thematic-break-spelling',
    ])
    for (const marker of ['#', '##', '=']) {
      for (const indent of ['\t', ' \t', '  \t', '   \t']) {
        expect(codes(`${marker} H\n${indent}more\n`)).toContain('deprecated-indented-line-under-heading')
      }
    }
    expect(codes('> # H\n> \tmore\n')).toContain('deprecated-indented-line-under-heading')
    expect(codes('# *H\n  more*\n')).toContain('deprecated-indented-line-under-heading')
    expect(codes('# [H\n  more](/x)\n')).toContain('deprecated-indented-line-under-heading')
  })

  it('C2-B-025 and C2-B-027: a block past list content uses visual columns', () => {
    expect(codes('- item\n  # H\n\t***\n')).toEqual([
      'block-opener-without-blank-line',
      'list-item-body-below-content-column',
      'list-item-block-overindented',
    ])
    for (const item of ['- item', '* item', '1. item']) {
      const content = item.startsWith('1') ? 3 : 2
      for (const indent of ['\t', ' \t', '  \t', '   \t']) {
        expect(codes(`${item}\n\n${indent}***\n`)).toContain('list-item-block-overindented')
      }
      expect(codes(`${item}\n\n${' '.repeat(content)}***\n`)).not.toContain('list-item-block-overindented')
    }
    expect(codes('> - a\n> \t***\n')).not.toContain('list-item-block-overindented')
    expect(codes('> - a\n>     ***\n')).toContain('list-item-block-overindented')
    expect(codes('- item\n\n\t```\n\t```\n')).toContain('list-item-block-overindented')
    expect(codes('- item\n\n\t> q\n')).toContain('list-item-block-overindented')
    expect(codes('- item\n\n    {.x}\n  ***\n')).toContain('list-item-block-overindented')
    expect(codes('- item\n\n  {.x}\n    ***\n')).not.toContain('list-item-block-overindented')
  })
})
