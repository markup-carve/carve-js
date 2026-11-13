// Edges of the block writer that the mutation run showed no clause test reaches.
import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, write } from '../src/index.ts'

const TICK = '`'
const FENCE = TICK.repeat(3)

describe('blocks', () => {
  it('C2-W-039: every block that is written with a colon run counts for the run of the div around it', () => {
    expect(format(':::::\n::: note\na\n:::\n:::::')).toBe('::::\n::: note\na\n:::\n::::\n')
    expect(format(':::::\n::: toc\n:::\n:::::')).toBe('::::\n::: toc\n\n:::\n::::\n')
    expect(format(':::::\n::: figure\n![a](b)\n:::\n:::::')).toBe('::::\n::: figure\n![a](b)\n:::\n::::\n')
    expect(format(':::::\n::: |\na\n:::\n:::::')).toBe('::::\n::: |\na\n:::\n::::\n')
    expect(format('::::::\n::::\n::: >\na\n:::\n::::\n::::::')).toBe(':::::\n::::\n::: >\na\n:::\n::::\n:::::\n')
    expect(format(':::::\n- ::: x\n  a\n  :::\n:::::')).toBe('::::\n- ::: x\n  a\n  :::\n::::\n')
  })

  it('C2-W-038: a backtick run with spaces behind it, or indented by a tab, is a bare run; a run with text behind it is not', () => {
    const long = FENCE + FENCE
    expect(format(`${long}\n${FENCE} \n\t${FENCE}${TICK}\n${long}`)).toBe(`${FENCE}${TICK}${TICK}\n${FENCE} \n\t${FENCE}${TICK}\n${FENCE}${TICK}${TICK}\n`)
    expect(format(`${long}\n${FENCE} x\n${TICK}${TICK} y\n${long}`)).toBe(`${FENCE}\n${FENCE} x\n${TICK}${TICK} y\n${FENCE}\n`)
  })

  it('C2-W-035, C2-B-040: level six is written as it is, and the last uppercase letter takes two spaces', () => {
    expect(format('###### a')).toBe('====== a\n')
    expect(format('Z.  a')).toBe('Z.  a\n')
    expect(format('z. a')).toBe('z. a\n')
  })

  it('C2-W-059: a comment stands after a blank line where the block before it would take its line, and directly below elsewhere', () => {
    expect(format(':: t\n\n%% c')).toBe(':: t\n\n%% c\n')
    expect(format('| a |\n\n%% c')).toBe('| a |\n\n%% c\n')
    expect(format('> a\n\n%% c')).toBe('> a\n\n%% c\n')
    expect(format('= h\n%% c')).toBe('= h\n%% c\n')
    expect(format('***\n%% c')).toBe('***\n%% c\n')
    expect(format(`${FENCE}\nx\n${FENCE}\n%% c`)).toBe(`${FENCE}\nx\n${FENCE}\n%% c\n`)
    expect(format('- a\n  - b\n\n  %% c')).toBe('- a\n  - b\n\n    %% c\n')
  })

  it('C2-W-059: the comments between a figure group and its caption stand behind its closer, and one inside it stays inside', () => {
    expect(format('::: figure\n![a](b)\n:::\n%% one\n%% two\n^ cap')).toBe('::: figure\n![a](b)\n:::\n%% one\n%% two\n^ cap\n')
    expect(format('::: figure\n![a](b)\n\n%% in\n:::')).toBe('::: figure\n![a](b)\n\n%% in\n:::\n')
  })

  it('C2-W-058: an empty path is quoted, and an option value with a space is quoted', () => {
    expect(format('{{ "" }}')).toBe('{{ "" }}\n')
    expect(format('{{ a.crv @lines:"1 2" }}')).toBe('{{ a.crv @lines:"1 2" }}\n')
  })

  it('C2-W-081: a hard-break block with a title is written in the class form, since the opener takes none', () => {
    expect(format('{.hardbreaks}\n::: "T"\na\n:::')).toBe('::: hardbreaks "T"\na\n:::\n')
  })
})

describe('continuation rows', () => {
  const stays = (src: string): void => {
    const written = format(src)
    expect(written).toBe(`${src}\n`)
    expect(treesEqual(parse(written), parse(src))).toBe(true)
  }

  it('C2-W-067, C2-L-020: the offsets of a wrap are bytes, also behind characters of two, three and four bytes', () => {
    stays('| é ü |\n+ ö 😀 |\n+ ß |')
  })

  it('C2-L-021: a fragment that joins an empty cell, and one behind an empty continuation row', () => {
    stays('| |\n+ b |')
    stays('| a |\n+ |\n+ b |')
    stays('| a | b |\n+ c | d |\n+ | e |')
  })

  it('C2-L-020: wraps in two text nodes of one cell, and in a text node behind a code span', () => {
    stays(`| x ${TICK}c${TICK} y |\n+ z |`)
    stays(`| x ${TICK}c${TICK} |\n+ y z |\n+ w |`)
    stays('| *a |\n+ b* c |')
  })

  it('C2-W-005: a code span that crossed rows holds the line break, so its rows are kept with and without the record', () => {
    const src = `| ${TICK}a |\n+ b${TICK} |`
    stays(src)
    const plain = write(parse(src))
    expect(plain).toBe(`${src}\n`)
    expect(parse(src).children![0]!.children![0]!.children![0]!.children![0]!.children![0]!.children![0]!.value).toBe('a\nb')
  })
})
