import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/index.js'
import { SPEC_VERSION } from '../src/version.js'

/**
 * `carve-version-unsupported` (carve#268): a document that declares a Carve spec
 * version this engine does not implement gets a diagnostic, instead of quietly
 * rendering constructs the author expected as something else.
 *
 * The declaration is frontmatter `carve-version:` - the author-facing field. The
 * trailing `%% carve-version:` marker is tool-written provenance, so it is only
 * a fallback.
 */
const rule = (src: string) => lintCarve(src).filter((w) => w.rule === 'carve-version-unsupported')

describe('carve-version-unsupported', () => {
  it('warns when frontmatter declares a newer spec version', () => {
    const src = '---\ncarve-version: 9.9\n---\n\n# Hi\n'
    const [warning] = rule(src)

    expect(warning).toBeDefined()
    expect(warning!.message).toContain('9.9')
    expect(warning!.message).toContain(SPEC_VERSION)
    // The span points at the version text itself, not the whole line.
    expect(src.slice(warning!.start, warning!.end)).toBe('9.9')
    expect(warning!.line).toBe(2)
  })

  it('stays quiet for the current version and for older ones', () => {
    expect(rule(`---\ncarve-version: ${SPEC_VERSION}\n---\n\n# Hi\n`)).toHaveLength(0)
    expect(rule('---\ncarve-version: 0.0.9\n---\n\n# Hi\n')).toHaveLength(0)
  })

  it('stays quiet when nothing is declared', () => {
    // Declaring a version is optional, so silence is the correct answer here -
    // not a warning about the absence.
    expect(rule('# Hi\n\nText.\n')).toHaveLength(0)
    expect(rule('---\ntitle: x\n---\n\n# Hi\n')).toHaveLength(0)
  })

  it('warns on a version string it cannot compare', () => {
    const src = '---\ncarve-version: banana\n---\n\n# Hi\n'
    const [warning] = rule(src)

    expect(warning).toBeDefined()
    expect(warning!.message).toContain('unrecognized')
    expect(src.slice(warning!.start, warning!.end)).toBe('banana')
  })

  it('falls back to the provenance marker when there is no frontmatter', () => {
    const src = '# Hi\n\n%% carve-version: 9.9; generated-by: x\n'
    const [warning] = rule(src)

    expect(warning).toBeDefined()
    expect(src.slice(warning!.start, warning!.end)).toBe('9.9')
  })

  it('does not warn on a marker at the current version', () => {
    // The common case by far: every document `carve fmt --stamp` has touched.
    expect(rule(`# Hi\n\n%% carve-version: ${SPEC_VERSION}; generated-by: x\n`)).toHaveLength(0)
  })

  it('prefers the frontmatter declaration over the marker', () => {
    // They answer different questions - what the author targets, versus what
    // last processed the file - so when they disagree the author's wins.
    const src = `---\ncarve-version: ${SPEC_VERSION}\n---\n\n# Hi\n\n%% carve-version: 9.9; generated-by: x\n`
    expect(rule(src)).toHaveLength(0)
  })

  it('compares numerically, not as strings', () => {
    // "0.10" sorts before "0.9" as text. With SPEC_VERSION at 0.1, a document
    // declaring 0.10 is from the future and must warn.
    expect(rule('---\ncarve-version: 0.10\n---\n\n# Hi\n')).toHaveLength(1)
  })

  it('treats a two-segment declaration and its three-segment form alike', () => {
    expect(rule(`---\ncarve-version: ${SPEC_VERSION}.0\n---\n\n# Hi\n`)).toHaveLength(0)
  })
})
