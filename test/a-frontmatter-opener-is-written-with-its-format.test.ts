import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/**
 * The canonical frontmatter opener SPELLS THE FORMAT OUT: `---yaml`, never a
 * bare `---` (markup-carve/carve#977 "A FRONTMATTER OPENER IS WRITTEN
 * ---yaml", PART 11 §6b; the ruling on markup-carve/carve#961).
 *
 * THE RULING REMOVES A SPECIAL CASE RATHER THAN ADDING ONE. This writer already
 * spelled every other format out - `---toml`, `---json`, and any custom word -
 * and dropped the token for `yaml` alone. carve-rs already wrote `---yaml`, so
 * the branch was also the thing keeping the three engines apart on a document
 * where they agreed about everything else.
 *
 * The two spellings PARSE the same: a bare opener takes
 * `defaultFrontmatterFormat`, whose default is `yaml`. Writing the token is
 * what makes the round trip say what the AST holds rather than what the default
 * happens to be - the case the last test here carries.
 *
 * The reader is untouched. `---`, `--- yaml` and `---yaml` all still open
 * frontmatter; only what `fmt` WRITES moves.
 */

describe('the canonical frontmatter opener carries its format token', () => {
  it('writes `---yaml` for a bare opener', () => {
    expect(carveToCarve('---\ntitle: T\n---\n\nbody\n')).toBe('---yaml\ntitle: T\n---\n\nbody\n')
  })

  it('writes `---yaml` for the spaced and unspaced explicit forms alike', () => {
    for (const src of ['--- yaml\ntitle: T\n---\n\nbody\n', '---yaml\ntitle: T\n---\n\nbody\n']) {
      expect(carveToCarve(src)).toBe('---yaml\ntitle: T\n---\n\nbody\n')
    }
  })

  it('CONTROL: every other format was already written this way', () => {
    // These are the rows the ruling matched `yaml` TO, so they must not move.
    expect(carveToCarve('--- toml\ntitle = "T"\n---\n\nbody\n')).toBe(
      '---toml\ntitle = "T"\n---\n\nbody\n',
    )
    expect(carveToCarve('---json\n{"a":1}\n---\n\nbody\n')).toBe('---json\n{"a":1}\n---\n\nbody\n')
    expect(carveToCarve('---custom\nx\n---\n\nbody\n')).toBe('---custom\nx\n---\n\nbody\n')
  })

  it('CONTROL: the CLOSER stays bare', () => {
    // `frontmatter_close = "---", newline` names no format slot, so only the
    // opener carries the token.
    const out = carveToCarve('---\ntitle: T\n---\n\nbody\n')
    expect(out.split('\n')[2]).toBe('---')
  })

  it('CONTROL: the reader still accepts all three opener spellings', () => {
    for (const src of ['---\ntitle: T\n---\n\nbody\n', '--- yaml\ntitle: T\n---\n\nbody\n']) {
      expect(parse(src).frontmatter).toEqual(
        expect.objectContaining({ format: 'yaml', content: 'title: T' }),
      )
      expect(carveToHtml(src).trim()).toBe('<p>body</p>')
    }
  })

  it('keeps fmt idempotent and HTML-equal, on every format', () => {
    for (const src of [
      '---\ntitle: T\n---\n\nbody\n',
      '--- yaml\ntitle: T\n---\n\nbody\n',
      '---toml\na = 1\n---\n\nbody\n',
      '---\n---\n\nbody\n',
      '---\ntitle: X\n\n\nnote: kept\n---\n\nbody\n',
    ]) {
      const f1 = carveToCarve(src)
      expect(carveToCarve(f1)).toBe(f1)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    }
  })

  it('says what the AST holds, not what the reader default happens to be', () => {
    // A bare opener read under a non-default `defaultFrontmatterFormat` holds
    // THAT format. Written bare it would come back as `yaml` on the next pass,
    // under the option's default - the round trip losing the one field
    // frontmatter has.
    const doc = parse('---\nx\n---\n', { defaultFrontmatterFormat: 'toml' })
    expect(doc.frontmatter?.format).toBe('toml')
    expect(carveToCarve('---\nx\n---\n', { defaultFrontmatterFormat: 'toml' })).toBe(
      '---toml\nx\n---\n',
    )
    expect(parse(carveToCarve('---\nx\n---\n', { defaultFrontmatterFormat: 'toml' }))
      .frontmatter?.format).toBe('toml')
  })
})
