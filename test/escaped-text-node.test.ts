import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToCarve, parse } from '../src/index.js'

/**
 * An escaped character is its own AST node.
 *
 * The backslash carries intent the literal character does not: `\-\-` was
 * written precisely so a downstream processor with smart punctuation on would
 * NOT read an en dash. Flattening it into text lost that, and the Markdown
 * target emitted the trigger bare where carve-php reproduced the escape
 * (carve#350). The inline vocabulary in the spec's profiles.md lists
 * `escaped_text` for the same reason.
 */
describe('escaped_text', () => {
  const source = 'A \\" B \\-\\- C \\.\\.\\. D \\* E \\_ F\n'

  it('parses to its own node type', () => {
    const kinds = (parse('a\\-b\n').children[0] as any).children.map((n: any) => n.type)
    expect(kinds).toEqual(['text', 'escaped_text', 'text'])
  })

  it('renders the bare character in HTML', () => {
    // The backslash is authoring syntax; the reader sees the character.
    expect(carveToHtml(source).trim()).toBe('<p>A " B -- C ... D * E _ F</p>')
  })

  it('reproduces the escape on the Markdown target (PART 11 §7 M2)', () => {
    expect(carveToMarkdown(source).trim()).toBe('A \\" B \\-\\- C \\.\\.\\. D \\* E \\_ F')
  })

  it('adds no backslashes to a document that escaped nothing', () => {
    // The cost of M2 falls only on documents that asked for it.
    expect(carveToMarkdown('A "quoted" phrase -- really.\n').trim()).toBe(
      'A “quoted” phrase – really.',
    )
  })

  it('round-trips through the canonical writer', () => {
    expect(carveToCarve(source)).toBe(source)
  })

  it('is idempotent', () => {
    const once = carveToCarve(source)
    expect(carveToCarve(once)).toBe(once)
  })

  it('keeps quote flanking across the node boundary', () => {
    // The escaped brace is a separate node but still the character before the
    // quote, and flanking reads that character (corpus 163).
    expect(carveToHtml('\\{"quoted"\\}\n')).toContain('{\u201Cquoted\u201D}')
  })

  it('keeps an escaped character in a heading id', () => {
    // The heading still contains the character; the id is slugified from what
    // the reader sees.
    expect(carveToHtml('# What\\\'s new\n')).toContain('id="What-s-new"')
  })
})

/**
 * An escaped space (`\ `) and a literal non-breaking space are two different
 * things in the AST: the parser records the escape with its own placeholder,
 * and a literal nbsp as itself. The writer resolved BOTH to a literal nbsp, so
 * `10\ kg` came back as a literal - the same HTML, a different text node
 * (carve#369).
 */
describe('the escaped-space placeholder', () => {
  it('is written back as the escape the author wrote', () => {
    expect(carveToCarve('10\\ kg\n')).toBe('10\\ kg\n')
  })

  it('leaves a literal non-breaking space alone', () => {
    expect(carveToCarve('10 kg\n')).toBe('10 kg\n')
  })

  it('renders both spellings identically', () => {
    expect(carveToHtml('10\\ kg\n')).toBe(carveToHtml('10 kg\n'))
  })
})
