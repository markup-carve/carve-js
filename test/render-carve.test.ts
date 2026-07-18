import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

if (!existsSync(corpusDir)) {
  throw new Error(
    `Spec corpus not found at ${corpusDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

const cases = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.crv'))
  .map((f) => basename(f, '.crv'))
  .sort()

describe('renderCarve corpus', () => {
  for (const name of cases) {
    const source = readFileSync(resolve(corpusDir, `${name}.crv`), 'utf8')

    it(`${name}: semantic`, () => {
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })

    it(`${name}: idempotent`, () => {
      const formatted = carveToCarve(source)
      expect(carveToCarve(formatted)).toBe(formatted)
    })

    it(`${name}: parses cleanly`, () => {
      const formatted = carveToCarve(source)
      expect(() => parse(formatted)).not.toThrow()
      expect(() => parse(carveToCarve(formatted))).not.toThrow()
    })
  }
})

describe('renderCarve targeted canonicalization', () => {
  it('collapses blank-line runs', () => {
    expect(carveToCarve('a\n\n\n\nb')).toBe('a\n\nb\n')
  })

  it('normalizes bullet markers to dashes', () => {
    expect(carveToCarve('* a\n* b')).toBe('- a\n- b\n')
  })

  it('sizes code fences around inner backticks', () => {
    expect(carveToCarve('```\na ``` b\n```')).toBe('````\na ``` b\n````\n')
  })

  it('preserves the author source order of attribute slots', () => {
    // Reordering slots would change the rendered HTML attribute order, breaking
    // the semantic-preserving invariant, so fmt keeps the source order verbatim.
    expect(carveToCarve('{k=v .cls #id}\n# Title')).toBe('{k=v .cls #id}\n# Title\n')
  })

  it('strips trailing whitespace while preserving nbsp', () => {
    expect(carveToCarve('a  \n\u00a0  \n')).toBe('a\n\u00a0\n')
  })

  it('keeps soft breaks in a plain div that carries a line-block class', () => {
    // The `::: |` sugar forces hard breaks; a generic div with `.line-block`
    // must NOT be rewritten to it (that would turn soft breaks into <br>).
    const src = '{.line-block}\n:::\na\nb\n:::\n'
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(formatted).not.toContain('::: |')
  })

  it('round-trips a line-block sugar div via explicit hard breaks', () => {
    const src = '::: |\na\nb\n:::\n'
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
  })

  it('emits Carve inline delimiters', () => {
    expect(carveToCarve('/i/ *b* _u_ ~s~ {^sup^} {,sub,} =mark=')).toBe(
      '/i/ *b* _u_ ~s~ {^sup^} {,sub,} =mark=\n',
    )
  })

  it('keeps a literal caret escaped and a literal comma unescaped', () => {
    // `^sup^` / `,sub,` are plain text (no bare sup/sub delimiter): the comma
    // needs no escape; the caret keeps one (footnote/caption channels).
    expect(carveToCarve('^sup^ ,sub, stays literal')).toBe(
      '\\^sup\\^ ,sub, stays literal\n',
    )
  })

  it('keeps a quoted admonition title stable across fmt passes (issue 295)', () => {
    const src = '::: note "A titled call-out"\nBody.\n:::\n'
    const f1 = carveToCarve(src)
    const f2 = carveToCarve(f1)
    expect(f2).toBe(f1)
    expect(carveToHtml(f1)).toBe(carveToHtml(src))
  })

  it('keeps a code-fence header with a backslash stable across fmt passes (issue 295)', () => {
    const src = '``` php "src\\Auth.php"\ncode\n```\n'
    const f1 = carveToCarve(src)
    const f2 = carveToCarve(f1)
    expect(f2).toBe(f1)
    expect(carveToHtml(f1)).toBe(carveToHtml(src))
    expect(f1).toContain('"src\\Auth.php"')
  })

  it('escapes literal inline delimiter characters in text', () => {
    const src = String.raw`\* \\/ \[`
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(formatted).toContain(String.raw`\*`)
    expect(formatted).toContain(String.raw`\[`)
  })

  describe('verbatim content survives document normalization (issue 340)', () => {
    it('keeps trailing whitespace inside code-block content', () => {
      const src = '```\ntrailing   \nalso\t\t\n```\n'
      const f1 = carveToCarve(src)
      expect(f1).toBe(src)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('keeps blank-line runs inside code-block content', () => {
      const src = '```\na\n\n\n\nb\n```\n'
      const f1 = carveToCarve(src)
      expect(f1).toBe(src)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('keeps raw-block content byte-exact', () => {
      const src = '```=html\n<pre>x   \n\n\n\ny</pre>\n```\n'
      const f1 = carveToCarve(src)
      expect(f1).toBe(src)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('keeps blank lines and trailing spaces in frontmatter and block comments', () => {
      const src = '---\ntitle: X\n\n\n\nnote: kept\n---\n\n%%%\nc   \n\n\n\nd\n%%%\n\nbody\n'
      const f1 = carveToCarve(src)
      expect(f1).toBe(src)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('code block with trailing-space + blank-line content stays stable inside a blockquote and a list', () => {
      for (const src of [
        '> ```\n> a   \n>\n>\n>\n> b\n> ```\n',
        '- item\n\n  ```\n  a   \n\n\n\n  b\n  ```\n',
      ]) {
        const f1 = carveToCarve(src)
        const f2 = carveToCarve(f1)
        expect(f2).toBe(f1)
        expect(carveToHtml(f1)).toBe(carveToHtml(src))
      }
    })
  })
})
