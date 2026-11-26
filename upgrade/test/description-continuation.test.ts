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
    expect(upgrade(':: t\n: +\nl\n : b\n\n{valigns=top,bottom widths=40}\n| a | b | c |').check).toBe('mismatch')
  })

  it('aligns a detached plus body with its term', () => {
    const result = upgrade('  :: t\n: +\n  h\n')
    expect(result.output).toBe(':: t\n: h\n')
    expect(result.check).toBe('pass')
  })

  it('keeps a separate table defect beside the detached plus body', () => {
    expect(upgrade('  :: t\n: +\n  h\n\n{valigns=top,bottom widths=40}\n| a | b | c |').check).toBe('mismatch')
  })

  it('writes a quote-hosted empty description body without a plus', () => {
    const result = upgrade('> :: t\n> : +\npara\n')
    expect(result.output).toBe('> :: t\n> : {% %}\n\npara\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside a quote-hosted description', () => {
    expect(upgrade('{valigns=top,bottom widths=40}\n| a | b | c |\n\n> :: t\n> : +\npara\n').check).toBe('mismatch')
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
    expect(upgrade('{valigns=top,bottom widths=40}\n| a | b | c |\n\n> :: t\n> : +\n> > q\n> : b\n').check).toBe('mismatch')
  })

  it('returns a quote-hosted sibling to the description column', () => {
    const result = upgrade('> :: t\n> : +\n> # H\n>  : b\n')
    expect(result.output).toBe('> :: t\n> : # H\n> : b\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside that sibling', () => {
    expect(upgrade('{valigns=top,bottom widths=40}\n| a | b | c |\n\n> :: t\n> : +\n> # H\n>  : b\n').check).toBe('mismatch')
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
    expect(upgrade('{valigns=top,bottom widths=40}\n| a | b | c |\n\n:: t\n: +\n```\na\n: dd\n').check).toBe('mismatch')
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

  it('accepts trailing space on the old continuation marker', () => {
    const result = upgrade(':: t\n: + \n```\na\n```\n')
    expect(result.output).toBe(':: t\n: ```\n  a\n  ```\n')
    expect(result.check).toBe('pass')
  })

  it('uses a long 0.2 fence around backticks from a tilde fence', () => {
    const result = upgrade(':: a\n: +\n~~~\n```\nx\n```\n~~~\n')
    expect(result.output).toBe(':: a\n: ````\n  ```\n  x\n  ```\n  ````\n')
    expect(result.check).toBe('pass')
  })

  it('separates a heading from an empty list in a description body', () => {
    const result = upgrade(':: t\n: - +\n   # H\n')
    expect(result.output).toBe(':: t\n: - {% %}\n\n  # H\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an earlier table defect beside that empty list', () => {
    expect(upgrade('{valigns=top,bottom widths=40}\n| a | b | c |\n\n:: t\n: - +\n   # H\n').check).toBe('mismatch')
  })

  it('rewrites two quote-hosted continuations in one document', () => {
    const source = '> :: a\n> : +\npara\n\n> :: b\n> : +\npara2\n'
    const result = upgrade(source)
    expect(result.output).toBe('> :: a\n> : {% %}\n\npara\n\n> :: b\n> : {% %}\n\npara2\n')
    expect(result.check).toBe('pass')
  })

  it('leaves an unrelated defect visible with two continuations', () => {
    const source = '{valigns=top,bottom widths=40}\n| a | b | c |\n\n> :: a\n> : +\npara\n\n> :: b\n> : +\npara2\n'
    expect(upgrade(source).check).toBe('mismatch')
  })

  it('rewrites two plain description continuations together', () => {
    const source = ':: a\n: +\npara\n\n:: b\n: +\npara2\n'
    const result = upgrade(source)
    expect(result.output).toBe(':: a\n: para\n\n:: b\n: para2\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an unrelated table defect beside two plain continuations', () => {
    expect(upgrade('{valigns=top,bottom widths=40}\n| a | b | c |\n\n:: a\n: +\npara\n\n:: b\n: +\npara2\n').check).toBe('mismatch')
  })

  it('rewrites two separate description fences in one document', () => {
    const source = ':: a\n: +\n```\nx\n```\n\n:: b\n: +\n~~~\ny\n~~~\n'
    const result = upgrade(source)
    expect(result.output).toBe(':: a\n: ```\n  x\n  ```\n\n:: b\n: ```\n  y\n  ```\n')
    expect(result.check).toBe('pass')
  })

  it('rewrites a quote continuation and a fence continuation together', () => {
    const source = '> :: a\n> : +\npara\n\n:: b\n: +\n```\ny\n```\n'
    const result = upgrade(source)
    expect(result.output).toBe('> :: a\n> : {% %}\n\npara\n\n:: b\n: ```\n  y\n  ```\n')
    expect(result.check).toBe('pass')
  })

  it('rewrites two empty lists followed by headings in descriptions', () => {
    const source = ':: a\n: - +\n   # A\n\n:: b\n: - +\n   # B\n'
    const result = upgrade(source)
    expect(result.output).toBe(':: a\n: - {% %}\n\n  # A\n\n:: b\n: - {% %}\n\n  # B\n')
    expect(result.check).toBe('pass')
  })

  it('keeps a separate rewrite while moving a description fence', () => {
    const source = ':: t\n: +\n```\na\n```\nafter\n\n~~~\nx\n~~~\n'
    const result = upgrade(source)
    expect(result.output).toContain(':: t\n: ```\n  a\n  ```\nafter')
    expect(result.output).toContain('```\nx\n```')
    expect(result.check).toBe('pass')
  })

  it('finds a detached description after earlier lines', () => {
    const source = '\n'.repeat(12) + '  :: t\n: +\n  h\n'
    const result = upgrade(source)
    expect(result.output).toBe('\n'.repeat(12) + ':: t\n: h\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an indented fence host at its own column', () => {
    const source = '  :: t\n  : +\n  ```\n  a\n  ```\nafter\n'
    const result = upgrade(source)
    expect(result.output).toBe('  :: t\n  : ```\n    a\n    ```\nafter\n')
    expect(result.check).toBe('pass')
  })

  it('closes an attached fence before the following description sibling', () => {
    const source = ':: t\n: n\n+\n```\na\n  b\n\nsee\n'
    const result = upgrade(source)
    expect(result.output).toBe(':: t\n: n\n\n  ```\n  a\n    b\n\n  ```\nsee\n')
    expect(result.check).toBe('pass')
  })

  it('keeps an unrelated table defect after the attached fence', () => {
    const source = ':: t\n: n\n+\n```\na\n  b\n\nsee\n\n{valigns=top,bottom widths=40}\n| a | b | c |'
    expect(upgrade(source).check).toBe('mismatch')
  })
})
