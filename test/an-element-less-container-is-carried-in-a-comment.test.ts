import { describe, expect, it } from 'vitest'
import { carveToMarkdown, markdownToCarve, migrateMarkdown } from '../src/index.js'

/**
 * CARVE-P11-063, PART 11 §10s: under the opt-in carrier mode the Markdown
 * target brackets every ELEMENT-LESS CONTAINER with an HTML comment carrying
 * its Carve opener and closer verbatim, so an export and a re-import return
 * the container.
 *
 * Ported from the shared conformance file
 * (tests/an-element-less-container-is-carried-in-a-comment.test.mjs in
 * markup-carve/carve, as markup-carve/carve#2849 corrected it), which runs
 * against the published package and so cannot see this branch.
 *
 * THE TWO CONTROLS ARE THE POINT: with the mode off the emitted bytes are the
 * ones this target emits today, and a document holding no element-less
 * container gains no comment either way. A carrier that moved the default
 * output would be a breaking change rather than an opt-in mode. Both are
 * written so that they are controls on EVERY build - neither touches the new
 * option - rather than only on one that has the mode.
 *
 * TWO OF THE CLAUSE'S OWN SAMPLES CANNOT BE MEASURED AS WRITTEN. `::: wrapper
 * {.fancy}` is not a Carve opener: PART 4 is STRICT that the opener line
 * carries no inline `{...}` attributes, so this engine reads the whole line as
 * a paragraph and no writer can carry what the tree does not hold. An
 * attributed container's Carve spelling is a PRECEDING attribute line, and that
 * is the line carried here; the `-->` case rides a quoted title, which takes
 * one and has no escape of its own.
 */

/** The 29 constructs this target degrades, measured on this engine. */
const CARRIED: Array<[name: string, carve: string, carrier: string]> = [
  [
    'a tab set and each of its panels',
    '::: tabs\n:::: tab [Overview]\nFirst panel.\n::::\n\n:::: tab [Install]\nSecond panel.\n::::\n:::\n',
    '<!-- carve: ::: tabs -->\n<!-- carve: :::: tab [Overview] -->\n**Overview**\n\nFirst panel.\n\n' +
      '<!-- carve: :::: -->\n<!-- carve: :::: tab [Install] -->\n**Install**\n\nSecond panel.\n\n' +
      '<!-- carve: :::: -->\n<!-- carve: ::: -->\n',
  ],
  [
    'a code-group set and its panel',
    '::: code-group\n:::: tab [sh]\n```sh\nx\n```\n::::\n:::\n',
    '<!-- carve: ::: code-group -->\n<!-- carve: :::: tab [sh] -->\n**sh**\n\n```sh\nx\n```\n\n' +
      '<!-- carve: :::: -->\n<!-- carve: ::: -->\n',
  ],
  [
    'a named div, whose name is what today drops',
    '::: wrapper\nA generic div.\n:::\n',
    '<!-- carve: ::: wrapper -->\nA generic div.\n\n<!-- carve: ::: -->\n',
  ],
  // An attributed container is TWO Carve lines, so it is two markers.
  [
    'a named div carrying attributes',
    '{.fancy #w}\n::: wrapper\nA generic div.\n:::\n',
    '<!-- carve: {.fancy #w} -->\n<!-- carve: ::: wrapper -->\nA generic div.\n\n<!-- carve: ::: -->\n',
  ],
  [
    'a div nested in a named div',
    '::: outer\n:::: inner\nx\n::::\n:::\n',
    '<!-- carve: ::: outer -->\n<!-- carve: :::: inner -->\nx\n\n<!-- carve: :::: -->\n<!-- carve: ::: -->\n',
  ],
  [
    'a columns container and each column',
    '::: columns\n:::: column\nA\n::::\n\n:::: column\nB\n::::\n:::\n',
    '<!-- carve: ::: columns -->\n<!-- carve: :::: column -->\nA\n\n<!-- carve: :::: -->\n' +
      '<!-- carve: :::: column -->\nB\n\n<!-- carve: :::: -->\n<!-- carve: ::: -->\n',
  ],
  [
    'a disclosure',
    '::: details "Open me"\nHidden.\n:::\n',
    '<!-- carve: ::: details "Open me" -->\n**Open me**\n\nHidden.\n\n<!-- carve: ::: -->\n',
  ],
  [
    'a spoiler',
    '::: spoiler\nHidden.\n:::\n',
    '<!-- carve: ::: spoiler -->\nHidden.\n\n<!-- carve: ::: -->\n',
  ],
  [
    'a composite figure group wrapper',
    '::: figure\n![a](a.png)\n:::\n',
    '<!-- carve: ::: figure -->\n![a](a.png)\n\n<!-- carve: ::: -->\n',
  ],
  [
    'a typeless div carrying a label',
    '::: [First]\nx\n:::\n',
    '<!-- carve: ::: [First] -->\n**First**\n\nx\n\n<!-- carve: ::: -->\n',
  ],
  // THE ESCAPE, the only spelling in the payload that is not Carve source read
  // back verbatim. A quoted title takes a `-->` and has no escape of its own,
  // so it is where the case lives.
  [
    'a payload carrying `-->`',
    '::: note "a --> b"\nBody.\n:::\n',
    '<!-- carve: ::: note "a --\\> b" -->\n**a → b**\n\nBody.\n\n<!-- carve: ::: -->\n',
  ],
  [
    'a payload already carrying a backslash before that `>`',
    '::: note "a --\\> b"\nBody.\n:::\n',
    '<!-- carve: ::: note "a --\\\\> b" -->\n**a --\\> b**\n\nBody.\n\n<!-- carve: ::: -->\n',
  ],
  [
    'a label carrying `-->`',
    '::: wrapper [a --> b]\nx\n:::\n',
    '<!-- carve: ::: wrapper [a --\\> b] -->\n**a --> b**\n\nx\n\n<!-- carve: ::: -->\n',
  ],
]
for (const kind of ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote']) {
  CARRIED.push([
    `an admonition of kind ${kind}`,
    `::: ${kind}\nAn admonition body.\n:::\n`,
    `<!-- carve: ::: ${kind} -->\nAn admonition body.\n\n<!-- carve: ::: -->\n`,
  ])
  CARRIED.push([
    `an admonition of kind ${kind} carrying a title`,
    `::: ${kind} "A title"\nAn admonition body.\n:::\n`,
    `<!-- carve: ::: ${kind} "A title" -->\n**A title**\n\nAn admonition body.\n\n<!-- carve: ::: -->\n`,
  ])
}

/** A damaged marker set imports as plain Markdown plus one diagnostic. */
const DAMAGED: Array<[shape: string, source: string]> = [
  ['one marker deleted', 'Body.\n<!-- carve: ::: -->\n'],
  ['two markers reordered', '<!-- carve: ::: -->\nBody.\n<!-- carve: ::: note -->\n'],
  [
    'an unbalanced set',
    '<!-- carve: ::: note -->\n<!-- carve: ::: wrapper -->\nBody.\n<!-- carve: ::: -->\n',
  ],
]

const PLAIN = '# Head\n\nA paragraph with *bold* text.\n\n- one\n- two\n'
const PLAIN_MARKDOWN = '# Head\n\nA paragraph with **bold** text.\n\n- one\n- two\n'

describe('an element-less container is carried in a comment', () => {
  it('the mode OFF emits exactly the bytes this target emits today', () => {
    expect(carveToMarkdown(CARRIED[0]![1])).toBe(
      '**Overview**\n\nFirst panel.\n\n**Install**\n\nSecond panel.\n',
    )
    expect(carveToMarkdown('::: note\nAn admonition body.\n:::\n')).toBe('An admonition body.\n')
    expect(carveToMarkdown('::: wrapper\nA generic div.\n:::\n')).toBe('A generic div.\n')
    expect(carveToMarkdown('::: note "a --> b"\nBody.\n:::\n')).toBe('**a → b**\n\nBody.\n')
  })

  it('a document with no element-less container gains no comment either way', () => {
    for (const out of [carveToMarkdown(PLAIN), carveToMarkdown(PLAIN, { carryMarkers: true })]) {
      expect(out).not.toContain('<!-- carve:')
      expect(out).toBe(PLAIN_MARKDOWN)
    }
  })

  for (const [name, carve, carrier] of CARRIED) {
    it(`the carrier mode writes the opener verbatim for ${name}`, () => {
      expect(carveToMarkdown(carve, { carryMarkers: true })).toBe(carrier)
    })

    it(`the carrier mode round-trips ${name}`, () => {
      expect(migrateMarkdown(carrier).value).toBe(carve)
    })

    it(`the mode off leaves ${name} unmarked`, () => {
      expect(carveToMarkdown(carve)).not.toContain('<!-- carve:')
    })
  }

  for (const [shape, source] of DAMAGED) {
    it(`${shape} imports as plain Markdown plus one diagnostic, never a guess`, () => {
      const { value, report } = migrateMarkdown(source)
      const damaged = report.diagnostics.filter((d) => d.code === 'carrier-markers-damaged')
      expect(damaged).toHaveLength(1)
      expect(damaged[0]!.fidelity).toBe('degraded')
      expect(damaged[0]!.confidence).toBe('fallback')
      // Never a guess: no container is reconstructed, and the markers come back
      // as the raw HTML they are.
      expect(value).not.toMatch(/^:{3,}/m)
      expect(value).toContain('```=html')
    })
  }

  it('a sound set reports no damage', () => {
    const { value, report } = migrateMarkdown(
      '<!-- carve: ::: note -->\nBody.\n\n<!-- carve: ::: -->\n',
    )
    expect(report.diagnostics.map((d) => d.code)).not.toContain('carrier-markers-damaged')
    expect(value).toBe('::: note\nBody.\n:::\n')
  })

  /**
   * A container this target DOES spell is not element-less and takes no marker:
   * an attributes-only opener is read as a paragraph, and a list table is
   * written as a pipe table.
   */
  for (const [name, carve] of [
    ['an attributes-only opener', '::: {.warning}\nx\n:::\n'],
    ['a list table', '{header-rows=1}\n::: list-table\n- - A\n  - B\n- - one\n  - x\n:::\n'],
  ] as const) {
    it(`${name} takes no marker`, () => {
      expect(carveToMarkdown(carve, { carryMarkers: true })).not.toContain('<!-- carve:')
    })
  }

  /**
   * A HOST THAT PREFIXES ITS LINES TAKES NO MARKER YET. The comment would sit
   * at the host's content column or behind its `>`, where the import does not
   * read it, so it would be written and never read back. The container degrades
   * there exactly as it does with the mode off. Reading a prefixed marker is an
   * owed follow-up on markup-carve/carve#2810, not part of this clause.
   */
  for (const [name, carve] of [
    ['inside a list item', '- item\n\n  ::: note\n  Body.\n  :::\n'],
    ['inside a block quote', '> ::: note\n> Body.\n> :::\n'],
  ] as const) {
    it(`a container ${name} takes no marker`, () => {
      const carrier = carveToMarkdown(carve, { carryMarkers: true })
      expect(carrier).not.toContain('<!-- carve:')
      expect(carrier).toBe(carveToMarkdown(carve))
      // And no marker written means no damage claimed on the way back.
      expect(migrateMarkdown(carrier).report.diagnostics.map((d) => d.code)).not.toContain(
        'carrier-markers-damaged',
      )
    })
  }

  /**
   * A MARKER INSIDE A FENCED CODE BLOCK IS NOT A MARKER: a code block's payload
   * is verbatim content, so a page documenting the mode holds marker-shaped
   * lines that record no container. Lifting one rewrote the sample inside the
   * fence, which is how this was found.
   */
  it('a marker-shaped line inside a fenced code block is left alone', () => {
    const source = 'Intro.\n\n```markdown\n<!-- carve: ::: note -->\nAn admonition body.\n<!-- carve: ::: -->\n```\n'
    const value = markdownToCarve(source)
    expect(value).toContain('<!-- carve: ::: note -->')
    expect(value).not.toMatch(/^::: note$/m)
    expect(migrateMarkdown(source).report.diagnostics.map((d) => d.code)).not.toContain(
      'carrier-markers-damaged',
    )
  })
})
