// The maintainer rulings of carve#6191 to #6196 (20 November).
import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const ranges = (source, code) => lint(source).filter((entry) => entry.code === code)
  .map((entry) => [entry.range.startOffset, entry.range.endOffset])
const messageOf = (source, code) => lint(source).find((entry) => entry.code === code)?.message

describe('lint rulings of 20 November', () => {
  it('carve#6191: blockquote-marker-without-space is the line without trailing blanks, in frontmatter too', () => {
    expect(ranges('>a\n', 'blockquote-marker-without-space')).toEqual([[0, 2]])
    expect(ranges('>a  \n', 'blockquote-marker-without-space')).toEqual([[0, 2]])
    expect(ranges('---\ntitle: x\n>a  \n---\n', 'blockquote-marker-without-space')).toEqual([[13, 15]])
    // A no-break space is no space or tab, so it stays in the range (byte offsets).
    expect(ranges('>a\u00a0\n', 'blockquote-marker-without-space')).toEqual([[0, 4]])
    expect(ranges('---\n>a\u00a0\n---\n', 'blockquote-marker-without-space')).toEqual([[4, 8]])
  })

  it('carve#6192: block-opener-overindented is the whole opening mark', () => {
    expect(ranges('# H\n\n   ::::\n   x\n   ::::\n', 'block-opener-overindented')).toEqual([[8, 12]])
    expect(ranges('   ### H\n', 'block-opener-overindented')).toEqual([[3, 6]])
    expect(ranges('   ````\n   x\n   ````\n', 'block-opener-overindented')).toEqual([[3, 7]])
    expect(ranges('   ***\n', 'block-opener-overindented')).toEqual([[3, 6]])
    expect(ranges('   > q\n', 'block-opener-overindented')).toEqual([[3, 4]])
    expect(ranges('   | a |\n', 'block-opener-overindented')).toEqual([[3, 4]])
    expect(ranges('   {.x}\n   :::: foo\n   x\n   ::::\n', 'block-opener-overindented')).toEqual([[11, 15]])
  })

  it('carve#6193: an include directive line is no block opener for list-item-block-overindented', () => {
    expect(ranges('- a\n\n      {{ x.crv }}\n', 'list-item-block-overindented')).toEqual([])
    expect(ranges('- a\n\n      # H\n', 'list-item-block-overindented')).toHaveLength(1)
  })

  it('carve#6194: a colon run in a quote or item inside a div is not compared with the div', () => {
    expect(ranges(':::: x\n:::::  \n', 'colon-fence-length-mismatch')).toEqual([[7, 12]])
    expect(ranges('::::\n> :::\n', 'colon-fence-length-mismatch')).toEqual([])
    expect(ranges('::::\n- a\n\n  :::  \n', 'colon-fence-length-mismatch')).toEqual([])
    expect(ranges('> ::::\n> :::\n', 'colon-fence-length-mismatch')).toEqual([[9, 12]])
  })

  it('carve#6195: an attribute-shaped paragraph line gets only block-opener-without-blank-line', () => {
    const codes = lint('para\n{.c}\n').map((entry) => entry.code)
    expect(codes).toContain('block-opener-without-blank-line')
    expect(codes).not.toContain('unattached-block-attribute')
  })

  it('carve#6197: every attribute line spelling counts for both attribute rules', () => {
    expect(ranges('para\n{ .c }\n', 'block-opener-without-blank-line')).toEqual([[5, 11]])
    expect(ranges('para\n{#id}\n', 'block-opener-without-blank-line')).toEqual([[5, 10]])
    expect(ranges('{ #id }\n', 'unattached-block-attribute')).toEqual([[0, 7]])
  })

  it('carve#6196: a line of only container quote marks is blank; >> at column 1 is text', () => {
    expect(messageOf('> {.c}\n>\n> # H\n', 'unattached-block-attribute')).toContain('A blank line follows this attribute line')
    expect(ranges('{.c}\n>>\n', 'unattached-block-attribute')).toEqual([])
    expect(messageOf('> > {.c}\n>\n', 'unattached-block-attribute')).toContain('This attribute line reaches no block')
    expect(messageOf('- > {.c}\n  >\n', 'unattached-block-attribute')).toContain('A blank line follows this attribute line')
  })
})
