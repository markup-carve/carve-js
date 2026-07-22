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

  it('preserves the authored bullet marker (issue 286)', () => {
    // The marker is semantic (§11): normalizing `*` to `-` would merge
    // adjacent lists separated only by their bullet char.
    expect(carveToCarve('* a\n* b')).toBe('* a\n* b\n')
    expect(carveToCarve('- a\n- b')).toBe('- a\n- b\n')
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

describe('verbatim spans with surrounding spaces stay fmt-idempotent', () => {
  // A verbatim span whose content both begins and ends with a space is stripped
  // by one space on each side at parse; fmt must pad it back so the strip is
  // reversible. Applies to plain code spans, attributed ones, and inline
  // literals alike (all share the serializer).
  const cases = ['``  x  ``', '``  x  ``{.foo}', '!``  x  ``', '!`` x``', '!``x ``', '!``   ``']
  for (const src of cases) {
    it(`round-trips ${JSON.stringify(src)}`, () => {
      const once = carveToCarve(src)
      expect(carveToHtml(once)).toBe(carveToHtml(src)) // invariant
      expect(carveToCarve(once)).toBe(once) // idempotent
    })
  }
})

describe('all-space verbatim content is never stripped or padded', () => {
  // Regression: the strip skips content that consists ENTIRELY of spaces (the
  // CommonMark rule, and what the executable spec's codeText() does). Stripping
  // it produced an empty verbatim span, which has no representable Carve source
  // -- a bare `` `` `` reparses as a two-backtick opener -- so `!`  `` degraded
  // to `!``` and then to `\!```, changing the document on every fmt pass. The
  // serializer must mirror the parser and NOT pad all-space content either,
  // otherwise each pass grew the span by two spaces.
  const cases = [
    '` `',
    '`  `',
    '`   `',
    '!` `',
    '!`  `',
    '!`   `',
    '$` x `',
    '$`  `',
    '``  ``',
    '!``  ``',
    '`a b`',
    '` a `',
  ]
  for (const src of cases) {
    it(`round-trips ${JSON.stringify(src)}`, () => {
      const once = carveToCarve(src)
      expect(carveToHtml(once)).toBe(carveToHtml(src)) // invariant
      expect(carveToCarve(once)).toBe(once) // idempotent
    })
  }

  it('preserves all-space content verbatim rather than collapsing it', () => {
    // Two spaces must survive as two spaces; previously they stripped to empty.
    expect(carveToHtml('`  `')).toBe('<p><code>  </code></p>')
    expect(carveToHtml('`   `')).toBe('<p><code>   </code></p>')
    // ... while a non-all-space span still gets the single-space strip.
    expect(carveToHtml('` a `')).toBe('<p><code>a</code></p>')
  })

  it('keeps an all-space inline literal a literal across fmt', () => {
    // The bug turned this into an escaped bang plus an unclosed code span.
    expect(carveToCarve('!`  `').trim()).toBe('!`  `')
  })
})
