import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToAnsi, carveToMarkdown, carveToPlainText } from '../src/index.js'

const corpus = resolve(dirname(fileURLToPath(import.meta.url)), '../spec/tests/corpus')
const fixture = (slug: string, ext: string) => readFileSync(resolve(corpus, `${slug}.${ext}`), 'utf8')

describe('list continuation content columns', () => {
  for (const slug of ['05-lists-29', '05-lists-30']) {
    it(`${slug} matches plain and ANSI sidecars`, () => {
      const source = fixture(slug, 'crv')
      expect(carveToPlainText(source)).toBe(fixture(slug, 'txt'))
      expect(carveToAnsi(source)).toBe(fixture(slug, 'ansi'))
    })
  }

  it('keeps the outer ANSI counter after an ordered list in a continuation block', () => {
    const source = '1. setup\n\n   ::: box\n\n   1. inner\n   2. next\n\n   :::\n\n2. build\n'
    expect(carveToAnsi(source)).toContain('\x1b[33m2.\x1b[0m build')
  })

  it('places a quoted list relative to its continuation column', () => {
    const source = '- item\n\n  > quote\n  >\n  > - one\n  > - two\n'
    const plain = carveToPlainText(source)
    const ansi = carveToAnsi(source)
    expect(plain).toBe('- item\n\n  "quote\n\n  - one\n  - two"\n')
    expect(ansi).toContain('  \x1b[36m\x1b[2m│\x1b[0m \x1b[36m•\x1b[0m one')
    expect(ansi).toContain('  \x1b[36m\x1b[2m│\x1b[0m \x1b[36m•\x1b[0m two')
  })

  it('keeps a tight nested sublist tight', () => {
    expect(carveToPlainText('- outer\n  - inner\n- next\n')).toBe('- outer\n  - inner\n- next\n')
  })

  it('leaves hard breaks in the first paragraph at column zero', () => {
    expect(carveToPlainText('- first\\\n  second\n')).toBe('- first\nsecond\n')
  })

  it('keeps definition body indentation inside the continuation column', () => {
    const source = '- item\n\n  :: term\n  :  body\n'
    expect(carveToPlainText(source)).toContain('\n  term\n    body\n')
    expect(carveToAnsi(source)).toContain('\n  \x1b[1m\x1b[33mterm\x1b[0m\n    body\n')
  })

  it('keeps Markdown output for 05-lists-29 unchanged', () => {
    const source = fixture('05-lists-29', 'crv')
    expect(carveToMarkdown(source)).toBe('- item one\n\n  second para\n\n  ```\n  code\n  ```\n\n  > quote\n\n  - nested\n')
  })
})
