import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * CARVE-P0-004: ONE AUTHORED BLOCK BASE (markup-carve/carve-js#2205).
 * A closing run between the container's content column and the fence's base is body.
 */

const bodyOf = (s: string): string => {
  const m = /<code[^>]*>([\s\S]*?)<\/code>/.exec(carveToHtml(s))
  return m ? m[1]! : '<<no code block>>'
}

const pad = (n: number) => ' '.repeat(n)

describe('a fence closer below its authored base is body', () => {
  it('keeps the reported list item payload', () => {
    expect(bodyOf('- head\n\n      ```\n      a\n    ```\n\n    tail\n')).toBe('a\n  ```\n\n  tail\n')
  })

  it('keeps the reported footnote payload', () => {
    expect(bodyOf('x[^1]\n\n[^1]: note\n\n      ```\n      a\n    ```\n\n    tail\n')).toBe('a\n  ```\n\n  tail\n')
  })

  for (const [host, content, prefix, quote] of [
    ['item', 2, '- head\n\n', ''],
    ['fn', 2, 'x[^1]\n\n[^1]: note\n\n', ''],
    ['nested', 4, '- outer\n\n  - inner\n\n', ''],
    ['desc', 3, ':: t\n:  desc\n\n', ''],
    ['quoteitem', 2, '> - head\n>\n', '> '],
  ] as const) {
    const shape = (opener: number, closer: number) =>
      prefix + [pad(opener) + '```', pad(opener) + 'a', pad(closer) + '```', '', pad(closer) + 'tail']
        .map((line) => quote + line + '\n').join('')

    describe(host, () => {
      for (const [openOffset, closeOffset, expected] of [
        [4, 2, 'a\n  ```\n\n  tail\n'],
        [6, 3, 'a\n   ```\n\n   tail\n'],
      ] as const) {
        it(`keeps the run at ${content + closeOffset} below base ${content + openOffset}`, () => {
          expect(bodyOf(shape(content + openOffset, content + closeOffset))).toBe(expected)
        })
      }

      it('closes at the authored base', () => {
        expect(bodyOf(shape(content + 4, content + 4))).toBe('a\n')
      })

      it('keeps a run past the authored base as payload', () => {
        expect(bodyOf(shape(content + 4, content + 6))).toBe('a\n  ```\n\n  tail\n')
      })

      it('closes at the container content column', () => {
        expect(bodyOf(shape(content + 4, content))).toBe('a\n')
      })

      it('runs to the end of the container without a closer', () => {
        const src = prefix + [pad(content + 4) + '```', pad(content + 4) + 'a', '', pad(content) + 'tail']
          .map((line) => quote + line + '\n').join('')
        expect(bodyOf(src)).toBe('a\n\ntail\n')
      })
    })
  }

  it('keeps a document-level indented run as payload', () => {
    expect(bodyOf('```\na\n  ```\n\n  tail\n')).toBe('a\n  ```\n\n  tail\n')
  })

  it('closes a document-level fence at its base', () => {
    expect(bodyOf('```\na\n```\n')).toBe('a\n')
  })

  it('keeps a tilde run below the authored base as payload', () => {
    expect(bodyOf('- head\n\n      ~~~\n      a\n    ~~~\n\n    tail\n')).toBe('a\n  ~~~\n\n  tail\n')
  })

  it('closes at a later run at the authored base', () => {
    expect(bodyOf('- head\n\n      ```\n      a\n    ```\n      b\n      ```\n\n  after\n')).toBe('a\n  ```\nb\n')
  })

  it('closes at a later run at the container content column', () => {
    expect(bodyOf('- head\n\n      ```\n      a\n    ```\n      b\n  ```\n\n  after\n')).toBe('a\n  ```\nb\n')
  })

  it('measures a tab-indented base in columns', () => {
    // A tab reaches column 4, so the opener sits at 6 and the run at 4.
    expect(bodyOf('- head\n\n\t  ```\n\t  a\n\t```\n\n\ttail\n')).toBe('a\n  ```\n\n  tail\n')
  })

  it('keeps a raw fence below the authored base as payload', () => {
    const html = carveToHtml('- head\n\n      ```=html\n      <b>a</b>\n    ```\n\n    tail\n')
    expect(html).toContain('<b>a</b>\n  ```\n\n  tail\n')
  })

  // The `%%%` fence has the REVERSE rule, written for itself, and every reader
  // honors it: the span is erased and its closer still closes.
  it('preserves the reverse rule for comment fences', () => {
    const html = carveToHtml('- head\n\n      %%%\n      a\n    %%%\n\n    tail\n')
    expect(html).not.toContain('<code')
    expect(html).not.toContain('%%%')
    expect(html).toContain('tail')
  })
})
