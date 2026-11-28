import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const findings = (source) => lint(source).filter((finding) => finding.code === 'unattached-block-attribute')

describe('unattached attributes use parsed ownership and document end', () => {
  for (const source of ['{.c}\n%% x\n', '{.c}\n%% #endregion\n']) {
    it(`reports a pending attribute behind a terminal comment in ${JSON.stringify(source)}`, () => {
      expect(findings(source).map((finding) => [finding.range.startOffset, finding.range.endOffset])).toEqual([[0, 4]])
    })
  }

  for (const [source, range] of [
    ['> {.c}\n:::\n', [2, 6]],
    ['> {.c}\n```\nx\n```\n', [2, 6]],
    ['* * {#id}\n:::\n', [4, 9]],
  ]) {
    it(`does not attach across a container boundary in ${JSON.stringify(source)}`, () => {
      expect(findings(source).map((finding) => [finding.range.startOffset, finding.range.endOffset])).toEqual([range])
    })
  }

  for (const source of ['{.c}\n', 'para\n\n{.c}\n']) {
    it(`chooses the document-end message after a final line feed in ${JSON.stringify(source)}`, () => {
      expect(findings(source)).toHaveLength(1)
      expect(findings(source)[0].message).toContain('This attribute line reaches no block')
    })
  }

  it('keeps an owner beyond a comment-only line', () => {
    expect(findings('{.c}\n%% x\npara\n')).toEqual([])
  })
})

describe('an attribute line the parse lifts into lang attaches (carve-js#5773)', () => {
  for (const source of [
    '{:fr}\nUn paragraphe.\n',
    '> {:fr}\n> Un paragraphe.\n',
    '- {:fr}\n  Un paragraphe.\n',
    '{:fr}\n# Titre\n',
    '{:fr}\n- item\n',
    '{:fr}\n> cite\n',
    '{:fr}\n| a | b |\n',
  ]) {
    it(`does not report ${JSON.stringify(source)}`, () => {
      expect(findings(source)).toEqual([])
    })
  }

  for (const source of ['{:fr}\n', '{:fr}\n\nUn paragraphe.\n']) {
    it(`still reports ${JSON.stringify(source)}`, () => {
      expect(findings(source)).toHaveLength(1)
    })
  }
})
