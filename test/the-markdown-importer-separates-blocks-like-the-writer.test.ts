import { describe, it, expect } from 'vitest'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { carveToCarve } from '../src/index.js'

const value = (md: string) => markdownToCarveWithLosses(md).value

// Import output has to BE canonical Carve, or a repo gating on
// `carve fmt --check` fails on its own migration output (carve-js#2614).
const cases: [what: string, markdown: string, expected: string][] = [
  ['a closer directly above a block', '---yaml\ntitle: Hi\n---\nBody\n', '---yaml\ntitle: Hi\n---\n\nBody\n'],
  ['a closer as the last line', '---yaml\ntitle: Hi\n---\n', '---yaml\ntitle: Hi\n---\n'],
  // The separator is not written twice, so the fix cannot work by always
  // adding one.
  ['a document that already separates them', '---yaml\ntitle: Hi\n---\n\nBody\n', '---yaml\ntitle: Hi\n---\n\nBody\n'],
  // Where the collision guard from carve-js#2610 meets the separator: the
  // frontmatter survives AND its later break stays a `---`.
  [
    'real frontmatter and a later break',
    '---\ntitle: Hi\n---\nBody\n***\nMore\n',
    '---yaml\ntitle: Hi\n---\n\nBody\n\n---\n\nMore\n',
  ],

  // CONTROLS, not claims. carve-php filed the same symptom at a thematic break
  // (carve-php#2989); this importer already writes that separator on both
  // sides at the top level, and these pin it so the frontmatter change cannot
  // take it away.
  ['a break under a paragraph', 'a\n***\nb\n', 'a\n\n---\n\nb\n'],
  ['a break under a list', '---\n- one\n- two\n---\nBody\n', '***\n\n- one\n- two\n\n***\n\nBody\n'],
]

describe('the Markdown importer separates blocks the way the writer does (markup-carve/carve-js#2614)', () => {
  it.each(cases)('writes %s with the writer\'s separator', (_what, md, expected) => {
    expect(value(md)).toBe(expected)
  })

  // The assertion that counts is the ROUND TRIP, not the bytes alone.
  it.each(cases)('imports %s as a writer fixed point', (_what, md) => {
    const imported = value(md)
    expect(carveToCarve(imported)).toBe(imported)
  })
})
