import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-069 C2-B-076 C2-B-078 description continuation', () => {
  const cases: [string, string][] = [
    ['real quote body', [':: term', ': +', '> the whole definition is this quote', ''].join('\n')],
    ['list as first definition block', [':: t', ': +', '- a', ''].join('\n')],
    ['heading as first definition block', [':: t', ': +', '# H', ''].join('\n')],
  ]
  for (const [name, source] of cases) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-123')
    })
  }

  it.each([
    [':: t\n: +\nl\n : b\n', ':: t\n: l\n: b\n'],
    [':: t\n: +\n# H\n : b\n', ':: t\n: # H\n: b\n'],
  ])('puts a plus follower and sibling at the description column: %s', (source, expected) => {
    const result = upgrade(source)
    expect(result.output).toBe(expected)
    expect(result.check).toBe('pass')
  })

  it('keeps an unrelated table difference beside a plus follower', () => {
    expect(upgrade(':: t\n: +\nl\n : b\n\n|= ^|').check).toBe('mismatch')
  })

  it('aligns a detached plus body with its term', () => {
    const result = upgrade('  :: t\n: +\n  h\n')
    expect(result.output).toBe(':: t\n: h\n')
    expect(result.check).toBe('pass')
  })

  it('keeps a separate table defect beside the detached plus body', () => {
    expect(upgrade('  :: t\n: +\n  h\n\n|= ^|').check).toBe('mismatch')
  })

  it('writes a quote-hosted empty description body without a plus', () => {
    const result = upgrade('> :: t\n> : +\npara\n')
    expect(result.output).toBe('> :: t\n> : {% %}\n\npara\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside a quote-hosted description', () => {
    expect(upgrade('|= ^|\n\n> :: t\n> : +\npara\n').check).toBe('mismatch')
  })

  it('keeps the host indentation of a quote-hosted description', () => {
    const result = upgrade('  > :: t\n  > : +\npara\n')
    expect(result.output).toBe('  > :: t\n  > : {% %}\n\npara\n')
    expect(result.check).toBe('pass')
  })

  it('puts an inner quote on the quote-hosted description line', () => {
    const result = upgrade('> :: t\n> : +\n> > q\n> : b\n')
    expect(result.output).toBe('> :: t\n> : > q\n> : b\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside that inner quote', () => {
    expect(upgrade('|= ^|\n\n> :: t\n> : +\n> > q\n> : b\n').check).toBe('mismatch')
  })

  it('returns a quote-hosted sibling to the description column', () => {
    const result = upgrade('> :: t\n> : +\n> # H\n>  : b\n')
    expect(result.output).toBe('> :: t\n> : # H\n> : b\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside that sibling', () => {
    expect(upgrade('|= ^|\n\n> :: t\n> : +\n> # H\n>  : b\n').check).toBe('mismatch')
  })

  it('aligns an indented sibling with its quote-hosted description', () => {
    const result = upgrade('> :: t\n> : +\n> > q\n  >  : b\n')
    expect(result.output).toBe('> :: t\n> : > q\n> : b\n')
    expect(result.check).toBe('pass')
  })

  it('indents an unclosed fence payload inside its description body', () => {
    const result = upgrade(':: t\n: +\n```\na\n: dd\n')
    expect(result.output).toBe(':: t\n: ```\n  a\n  : dd\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside the unclosed fence', () => {
    expect(upgrade('|= ^|\n\n:: t\n: +\n```\na\n: dd\n').check).toBe('mismatch')
  })

  it('keeps the indentation of an unclosed fence payload', () => {
    const result = upgrade(':: t\n: +\n```\n  a\n: dd\n')
    expect(result.output).toBe(':: t\n: ```\n    a\n  : dd\n')
    expect(result.check).toBe('pass')
  })

  it('writes an old tilde fence with the 0.2 backtick fence', () => {
    const result = upgrade(':: t\n: +\n~~~\na\n: dd\n')
    expect(result.output).toBe(':: t\n: ```\n  a\n  : dd\n')
    expect(result.check).toBe('pass')
  })

  it('keeps content after a closed fence outside the description', () => {
    const result = upgrade(':: t\n: +\n```php\na\n```\nafter\n')
    expect(result.output).toBe(':: t\n: ```php\n  a\n  ```\nafter\n')
    expect(result.check).toBe('pass')
  })

  it('separates a heading from an empty list in a description body', () => {
    const result = upgrade(':: t\n: - +\n   # H\n')
    expect(result.output).toBe(':: t\n: - {% %}\n\n  # H\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside that empty list', () => {
    expect(upgrade('|= ^|\n\n:: t\n: - +\n   # H\n').check).toBe('mismatch')
  })
})
