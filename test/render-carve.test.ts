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
    expect(carveToCarve('/i/ *b* _u_ ~s~ ^sup^ ,sub, =mark=')).toBe(
      '/i/ *b* _u_ ~s~ ^sup^ ,sub, =mark=\n',
    )
  })

  it('escapes literal inline delimiter characters in text', () => {
    const src = String.raw`\* \\/ \[`
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(formatted).toContain(String.raw`\*`)
    expect(formatted).toContain(String.raw`\[`)
  })
})
