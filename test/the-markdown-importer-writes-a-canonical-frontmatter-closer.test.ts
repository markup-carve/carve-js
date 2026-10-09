import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

// A FRONTMATTER CLOSER IS WRITTEN BARE (PART 1, PART 11 section 6b). A reader
// drops the trailing run of spaces and tabs, so `---<TAB>` closes the block,
// but the writer spells the delimiter `---` and nothing else.
//
// The importer echoed the source's run, so a document closing its frontmatter
// with `---<SP><TAB>` imported with that run intact while this engine's own
// `fmt` wrote `---`. A READER'S LENIENCY IS NOT A WRITER'S LICENSE, and the
// cost was user-visible: a repo gating on `carve fmt --check` failed on its own
// migration output (carve-js#2638).
//
// The closer now comes from the writer's own FRONTMATTER_CLOSER, which
// renderFrontmatter() emits too, so the delimiter cannot be hard-coded into a
// second place and drift - the same cure as the opener in the sibling test.

// Every spelling PART 1 accepts, under a typed, a bare and a spaced opener.
const closers: [what: string, closer: string][] = [
  ['bare', '---'],
  ['one space', '--- '],
  ['one tab', '---\t'],
  ['a space and a tab', '--- \t'],
  ['two tabs', '---\t\t'],
]

const openers: [what: string, opener: string, body: string, expectedOpener: string][] = [
  ['a typed opener', '---yaml', 'title: Hi', '---yaml'],
  ['a bare opener', '---', 'title: Hi', '---yaml'],
  ['another format', '---toml', 'title = "Hi"', '---toml'],
  ['a spaced opener', '--- toml', 'title = "Hi"', '---toml'],
]

const cases = openers.flatMap(([whatOpen, opener, body, expectedOpener]) =>
  closers.map(([whatClose, closer]): [string, string, string] => [
    `${whatOpen} with ${whatClose} closer`,
    `${opener}\n${body}\n${closer}\nBody\n`,
    `${expectedOpener}\n${body}\n---\n\nBody\n`,
  ]),
)

describe('the Markdown importer writes a canonical frontmatter closer (markup-carve/carve-js#2638)', () => {
  it.each(cases)('writes %s bare', (_what, md, expected) => {
    expect(markdownToCarve(md)).toBe(expected)
  })

  // The assertion that counts is the ROUND TRIP, not the bytes alone: import,
  // then `fmt`, and require no change.
  it.each(cases)('imports %s as a writer fixed point', (_what, md) => {
    const imported = markdownToCarve(md)
    expect(carveToCarve(imported)).toBe(imported)
  })

  // The diagnostic in the ticket: the two writers in one engine disagreed.
  it.each(cases)('agrees with what fmt writes for %s', (_what, md) => {
    expect(markdownToCarve(md)).toBe(carveToCarve(md))
  })

  // CONTROL. The cure is the writer's spelling of ONE delimiter, never a trim:
  // the metadata between the fences is opaque and a YAML value is data, so it
  // keeps its own trailing whitespace byte-for-byte. An importer that trimmed
  // every line would pass every assertion above and fail this one.
  it('leaves trailing whitespace INSIDE the block byte-for-byte', () => {
    const imported = markdownToCarve('---yaml\ntitle: Hi  \nlist:\n  - a\t\n--- \nBody\n')

    expect(imported).toBe('---yaml\ntitle: Hi  \nlist:\n  - a\t\n---\n\nBody\n')
    expect(carveToCarve(imported)).toBe(imported)
  })

  // CONTROL. A `---` run that is NOT a closer is a thematic break, whose own
  // spelling is a separate question the writer answers elsewhere. Rewriting the
  // closer must not reach into the body.
  it('does not touch a break in the body', () => {
    expect(markdownToCarve('---yaml\ntitle: Hi\n--- \nBody\n\n*** \n\nMore\n'))
      .toBe('---yaml\ntitle: Hi\n---\n\nBody\n\n---\n\nMore\n')
  })

  // CONTROL. Detection is out of scope, and the rewrite must not start
  // manufacturing frontmatter where a reader finds none: an empty fence pair
  // carries no mapping, so it stays two thematic breaks.
  it('leaves an empty fence pair as two thematic breaks', () => {
    expect(carveToHtml(markdownToCarve('---\n--- \t\n'))).toBe('<hr>\n<hr>')
  })

  // CONTROL. The closer rewrite is not the opener's: the format token stays.
  it('still spells the opener\'s format', () => {
    expect(markdownToCarve('--- toml\ntitle = "Hi"\n--- \t\nBody\n'))
      .toBe('---toml\ntitle = "Hi"\n---\n\nBody\n')
  })
})
