import { describe, it, expect } from 'vitest'
import { carveToCarve, markdownToCarve, parse } from '../src/index.js'

/**
 * A FRONTMATTER OPENER IS WRITTEN `---yaml` (CARVE-P11-011, PART 11 §6b): the
 * canonical writer spells the format token for EVERY format, the default one
 * included.
 *
 * The importer used to emit the source opener verbatim, so a bare `---` in the
 * Markdown came back as a bare `---` while this engine's own `fmt` wrote
 * `---yaml` on the same document. A READER'S LENIENCY IS NOT A WRITER'S
 * LICENSE, and the cost was user-visible: a freshly imported file failed the
 * repo's own `fmt --check` gate on a diff the author never introduced.
 *
 * The opener now comes from the canonical writer's own spelling helper, so the
 * token cannot be hard-coded into a second place and drift.
 */

describe('the Markdown importer writes a canonical frontmatter opener', () => {
  it('spells the default format on a bare opener', () => {
    expect(markdownToCarve('---\ntitle: Hi\n---\n\nBody.\n')).toBe(
      '---yaml\ntitle: Hi\n---\n\nBody.\n',
    )
  })

  it('spells a typed format, so a hard-coded `---yaml` would not pass', () => {
    // §6b covers every format rather than the default alone. An implementation
    // that pasted the string `---yaml` in would satisfy the test above and fail
    // this one.
    expect(markdownToCarve('---toml\ntitle = "Hi"\n---\n\nBody.\n')).toBe(
      '---toml\ntitle = "Hi"\n---\n\nBody.\n',
    )
  })

  it('canonicalizes the lenient spaced spelling of either format', () => {
    expect(markdownToCarve('--- toml\ntitle = "Hi"\n---\n\nBody.\n')).toBe(
      '---toml\ntitle = "Hi"\n---\n\nBody.\n',
    )
    expect(markdownToCarve('--- yaml\ntitle: Hi\n---\n\nBody.\n')).toBe(
      '---yaml\ntitle: Hi\n---\n\nBody.\n',
    )
  })

  it('agrees with what `fmt` writes for the same document', () => {
    // The diagnostic in the ticket: the two writers in one engine disagreed.
    for (const md of [
      '---\ntitle: Hi\n---\n\nBody.\n',
      '---toml\ntitle = "Hi"\n---\n\nBody.\n',
      '--- toml\ntitle = "Hi"\n---\n\nBody.\n',
    ]) {
      expect(markdownToCarve(md)).toBe(carveToCarve(md))
    }
  })

  it('leaves an imported document with nothing for `fmt --check` to report', () => {
    for (const md of [
      '---\ntitle: Hi\n---\n\nBody.\n',
      '---toml\ntitle = "Hi"\n---\n\nBody.\n',
      '--- yaml\ntitle: a **bold** value\n---\n\nBody.\n',
    ]) {
      const imported = markdownToCarve(md)
      expect(carveToCarve(imported)).toBe(imported)
    }
  })

  it('CONTROL: the metadata between the fences still survives byte-for-byte', () => {
    // Only the opener is the canonical writer's to spell. The content is opaque
    // and a YAML value is data, not prose.
    const imported = markdownToCarve('---\ntitle: a **bold** and _under_ value\n---\n\nBody.\n')
    expect(parse(imported).frontmatter?.content).toBe('title: a **bold** and _under_ value')
  })

  it('CONTROL: the closer stays bare', () => {
    // `frontmatter_close` names no format slot, so only the opener takes a token.
    expect(markdownToCarve('---\ntitle: Hi\n---\n\nBody.\n').split('\n')[2]).toBe('---')
  })

  it('CONTROL: an empty fence pair is still two thematic breaks, not frontmatter', () => {
    // Detection is out of scope here; this guards that the opener rewrite did
    // not start manufacturing frontmatter where there was none.
    expect(parse(markdownToCarve('---\n---')).frontmatter).toBeFalsy()
    expect(parse(markdownToCarve('---\n\ntext')).frontmatter).toBeFalsy()
  })
})
