import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve, migrateMarkdown } from '../src/index.js'

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
   * A COMPOSITE FIGURE'S CAPTION LINE TAKES A MARKER OF ITS OWN, directly after
   * the closer's, exactly as an attribute line above an opener takes one. The
   * caption slot hangs BELOW the closing fence, so the pair bracketing the
   * container cannot enclose it.
   *
   * THE ONE THING THE ATTRIBUTE-LINE PRECEDENT DOES NOT COVER: a caption also
   * renders as body text, so the import REPLACES that rendered paragraph
   * instead of appending a second copy of the caption.
   */
  const CAPTIONS: Array<[name: string, carve: string, carrier: string]> = [
    [
      'a figure group with a caption',
      '::: figure\n:::: panel\n![a](x.png)\n::::\n:::\n^ Group caption\n',
      '<!-- carve: ::: figure -->\n<!-- carve: :::: panel -->\n![a](x.png)\n\n' +
        '<!-- carve: :::: -->\n<!-- carve: ::: -->\n<!-- carve: ^ Group caption -->\n' +
        '**Group caption**\n',
    ],
    // GAINS NOTHING is the control on the writer half: no caption, no third
    // marker, and the bytes are the ones the clause already had.
    [
      'a figure group with no caption',
      '::: figure\n:::: panel\n![a](x.png)\n::::\n:::\n',
      '<!-- carve: ::: figure -->\n<!-- carve: :::: panel -->\n![a](x.png)\n\n' +
        '<!-- carve: :::: -->\n<!-- carve: ::: -->\n',
    ],
    [
      'a caption carrying the comment terminator',
      '::: figure\n:::: panel\n![a](x.png)\n::::\n:::\n^ A --> B\n',
      '<!-- carve: ::: figure -->\n<!-- carve: :::: panel -->\n![a](x.png)\n\n' +
        '<!-- carve: :::: -->\n<!-- carve: ::: -->\n<!-- carve: ^ A --\\> B -->\n' +
        '**A \u2192 B**\n',
    ],
    // THE CAPTION'S TEXT ALSO APPEARING AS ORDINARY BODY TEXT must not be
    // consumed: only the paragraph the marker stands directly above is the one
    // the caption replaces.
    [
      'a caption whose text is also ordinary body text',
      '::: figure\n:::: panel\n![a](x.png)\n::::\n:::\n^ Group caption\n\n*Group caption*\n',
      '<!-- carve: ::: figure -->\n<!-- carve: :::: panel -->\n![a](x.png)\n\n' +
        '<!-- carve: :::: -->\n<!-- carve: ::: -->\n<!-- carve: ^ Group caption -->\n' +
        '**Group caption**\n\n**Group caption**\n',
    ],
    [
      'a caption carrying inline strong',
      '::: figure\n:::: panel\n![a](x.png)\n::::\n:::\n^ A *strong* caption\n',
      '<!-- carve: ::: figure -->\n<!-- carve: :::: panel -->\n![a](x.png)\n\n' +
        '<!-- carve: :::: -->\n<!-- carve: ::: -->\n<!-- carve: ^ A *strong* caption -->\n' +
        '**A **strong** caption**\n',
    ],
  ]

  for (const [name, carve, carrier] of CAPTIONS) {
    it(`the carrier mode writes the caption line verbatim for ${name}`, () => {
      expect(carveToMarkdown(carve, { carryMarkers: true })).toBe(carrier)
    })

    it(`the carrier mode round-trips ${name} into its own slot`, () => {
      expect(markdownToCarve(carrier)).toBe(carve)
      // The ROLE is what was lost before this: a <figcaption> came back as
      // emphasized body text, so the HTML is where the fix is visible.
      expect(carveToHtml(markdownToCarve(carrier))).toBe(carveToHtml(carve))
    })

    it(`${name} comes back as a caption, not as body text`, () => {
      // THE IMPORT'S OWN OUTPUT, not the expectation: a check on the expected
      // Carve alone would measure the HTML renderer and never the importer.
      const html = carveToHtml(markdownToCarve(carrier))
      const count = (html.match(/<figcaption>/g) ?? []).length
      // Replaced, not joined: one figcaption where the source had a caption.
      expect(count).toBe(carve.includes('\n^ ') ? 1 : 0)
    })

    it(`${name} claims no damage`, () => {
      expect(migrateMarkdown(carrier).report.diagnostics.map((d) => d.code)).not.toContain(
        'carrier-markers-damaged',
      )
    })

    it(`the mode off leaves ${name} unmarked`, () => {
      expect(carveToMarkdown(carve)).not.toContain('<!-- carve:')
    })
  }

  /**
   * A caption marker belongs to the container the marker before it closed, so
   * one standing anywhere else has lost what it recorded and the set is
   * damaged: reported, never guessed.
   */
  for (
    const [shape, source] of Object.entries({
      'a caption marker with no closer before it':
        '<!-- carve: ^ Group caption -->\n**Group caption**\n',
      'a caption marker whose container is left open':
        '<!-- carve: ::: figure -->\n![a](x.png)\n\n<!-- carve: ^ Group caption -->\n**Group caption**\n',
      'a caption marker standing above an opener':
        '<!-- carve: ^ Group caption -->\n<!-- carve: ::: figure -->\n![a](x.png)\n\n<!-- carve: ::: -->\n',
    })
  ) {
    it(`${shape} is reported, never guessed`, () => {
      const { value, report } = migrateMarkdown(source)
      const damaged = report.diagnostics.filter((d) => d.code === 'carrier-markers-damaged')
      expect(damaged).toHaveLength(1)
      expect(damaged[0]!.fidelity).toBe('degraded')
      expect(damaged[0]!.confidence).toBe('fallback')
      expect(value).not.toMatch(/^\s*:{3,}/m)
      expect(value).toContain('```=html')
    })
  }

  /**
   * THE CONTROL ON THE CAPTION SPELLING. A `^ ...` line INSIDE the container is
   * not the caption slot: it is literal text, it renders as a paragraph rather
   * than a `<figcaption>`, and the carrier mode must leave it literal.
   */
  it('a caption line inside the container stays literal', () => {
    const carve = '::: figure\n:::: panel\n![a](x.png)\n::::\n^ Group caption\n:::\n'
    expect(carveToHtml(carve)).toContain('<p>^ Group caption</p>')
    const carrier = carveToMarkdown(carve, { carryMarkers: true })
    expect(carrier).not.toContain('<!-- carve: ^')
    expect(carrier).toContain('^ Group caption')
    expect(carveToHtml(markdownToCarve(carrier))).not.toContain('<figcaption>')
  })

  /**
   * A HOST THAT PREFIXES ITS LINES CARRIES, and byte-exactly.
   *
   * The marker stands at the host's content column or behind its `>`, and the
   * import finds it there because WHICH LINES ARE MARKERS NOW COMES FROM THE
   * BLOCK STRUCTURE this importer derives rather than from a flat scan of the
   * source lines. A flat scan cannot tell a marker at a list item's content
   * column from code text inside that item - the verbatim cases below are
   * exactly what it would have eaten - while the structure pass already carries
   * fence state, a quote's `>` prefix and an item's content column
   * (markup-carve/carve#2850).
   *
   * The two-level and quote-in-item sources are spelled TIGHT on purpose: a
   * blank line between an outer item and its nested list is lost by this target
   * whether a container is involved or not, so a loose spelling would measure
   * that instead of this.
   */
  const PREFIXED: Array<[name: string, carve: string, carrier: string]> = [
    [
      'in a list item',
      '- Item.\n\n  ::: note\n  Body.\n  :::\n',
      '- Item.\n\n  <!-- carve: ::: note -->\n  Body.\n\n  <!-- carve: ::: -->\n',
    ],
    [
      'two list levels in',
      '- Outer.\n  - Inner.\n\n    ::: note\n    Body.\n    :::\n',
      '- Outer.\n  - Inner.\n\n    <!-- carve: ::: note -->\n    Body.\n\n    <!-- carve: ::: -->\n',
    ],
    [
      'in a block quote',
      '> ::: note\n> Body.\n> :::\n',
      '> <!-- carve: ::: note -->\n> Body.\n>\n> <!-- carve: ::: -->\n',
    ],
    [
      'in a block quote in a list item',
      '- Item.\n  > ::: note\n  > Body.\n  > :::\n',
      '- Item.\n  > <!-- carve: ::: note -->\n  > Body.\n  >\n  > <!-- carve: ::: -->\n',
    ],
    // THE OPENER SHARES THE ITEM'S MARKER LINE here, so the placeholder the
    // import lifts the marker to stands behind a `-`. Leaving the token in the
    // output would be corruption rather than a missed restore, which is why the
    // prefix is read as whatever precedes the token and not as a character class.
    [
      'opening a list item',
      '- ::: note\n  Body.\n  :::\n',
      '- <!-- carve: ::: note -->\n  Body.\n\n  <!-- carve: ::: -->\n',
    ],
    // AND ITS BODY BEGINS WITH A LIST, so the closer's placeholder is a lazy
    // continuation of that inner item's paragraph and the written Carve puts it
    // at the inner content column. A closer stands at its OPENER's column.
    [
      'opening a list item, holding a list',
      '- ::: note\n  - one\n  - two\n  :::\n',
      '- <!-- carve: ::: note -->\n  - one\n  - two\n  <!-- carve: ::: -->\n',
    ],
    ['empty, opening a list item', '- ::: note\n  :::\n', '- <!-- carve: ::: note -->\n  <!-- carve: ::: -->\n'],
    // A SIBLING ITEM AFTER THE CLOSER MUST NOT GO LOOSE: a closer and what
    // follows take a blank line only where they are siblings, and the item
    // below belongs to the host above the container.
    [
      'opening a list item, with a sibling item after it',
      '- ::: note\n  - one\n  - two\n  :::\n- next\n',
      '- <!-- carve: ::: note -->\n  - one\n  - two\n  <!-- carve: ::: -->\n- next\n',
    ],
    // A TASK BOX IS INLINE CONTENT, so no HTML block can begin after it: the
    // structure pass admits this one as a task-marker line. The box is also not
    // part of the column, so the closer stands at the ITEM's content column.
    [
      'opening a task item',
      '- [ ] ::: note\n  Body.\n  :::\n',
      '- [ ] <!-- carve: ::: note -->\n  Body.\n\n  <!-- carve: ::: -->\n',
    ],
    // A BLOCK QUOTE OPENING A LIST ITEM carries both prefixes on one line.
    [
      'a block quote opening a list item',
      '- > ::: note\n  > Body.\n  > :::\n',
      '- > <!-- carve: ::: note -->\n  > Body.\n  >\n  > <!-- carve: ::: -->\n',
    ],
    // TWO ITEMS OPEN ON ONE LINE here, so the block reading has to take EVERY
    // container prefix off and not only the first.
    [
      'opening two list items at once',
      '- - ::: note\n    Body.\n    :::\n',
      '- - <!-- carve: ::: note -->\n    Body.\n\n    <!-- carve: ::: -->\n',
    ],
    // AND THREE, where the body stands six columns in. The content column is
    // the one EVERY prefix put the body at, not the one the first marker did,
    // or the closer would read as code.
    [
      'opening three list items at once',
      '- - - ::: note\n      Body.\n      :::\n',
      '- - - <!-- carve: ::: note -->\n      Body.\n\n      <!-- carve: ::: -->\n',
    ],
    // A CAPTION HANGS ON THE CLOSING FENCE, so it stands at that closer's
    // column. With a list body its placeholder is a lazy continuation of the
    // inner item just as the closer's is, and a caption at the wrong column
    // attaches to nothing.
    [
      'a figure caption, with a list body, in a list item',
      '- ::: figure\n  - one\n  - two\n  :::\n  ^ Caption\n',
      '- <!-- carve: ::: figure -->\n  - one\n  - two\n  <!-- carve: ::: -->\n' +
        '  <!-- carve: ^ Caption -->\n  **Caption**\n',
    ],
    [
      'a figure group with a caption in a list item',
      '- item\n\n  ::: figure\n  :::: panel\n  ![a](x.png)\n  ::::\n  :::\n  ^ Group caption\n',
      '- item\n\n  <!-- carve: ::: figure -->\n  <!-- carve: :::: panel -->\n  ![a](x.png)\n\n' +
        '  <!-- carve: :::: -->\n  <!-- carve: ::: -->\n  <!-- carve: ^ Group caption -->\n  **Group caption**\n',
    ],
  ]

  for (const [name, carve, carrier] of PREFIXED) {
    it(`a container ${name} takes a marker at its host's column`, () => {
      expect(carveToMarkdown(carve, { carryMarkers: true })).toBe(carrier)
    })

    it(`a container ${name} comes back`, () => {
      const restored = markdownToCarve(carrier)
      expect(restored).not.toContain('CARVECARRIER')
      expect(restored).toBe(carve)
    })

    // The bytes are the point, but so is the MEANING: a round trip that returns
    // the same text under a different element passes a byte comparison.
    it(`a container ${name} round trips to the same HTML`, () => {
      expect(carveToHtml(markdownToCarve(carrier))).toBe(carveToHtml(carve))
    })
  }

  /** A damaged set inside a prefixed host is still never guessed at. */
  for (
    const [shape, source] of Object.entries({
      'one marker deleted in a list item': '- Item.\n\n  Body.\n\n  <!-- carve: ::: -->\n',
      'two reordered in a list item':
        '- Item.\n\n  <!-- carve: ::: -->\n  Body.\n\n  <!-- carve: ::: note -->\n',
      'unbalanced in a block quote':
        '> <!-- carve: ::: note -->\n> <!-- carve: ::: wrapper -->\n> Body.\n>\n> <!-- carve: ::: -->\n',
    })
  ) {
    it(`a damaged set, ${shape}, reports and reconstructs nothing`, () => {
      const { value, report } = migrateMarkdown(source)
      const damaged = report.diagnostics.filter((d) => d.code === 'carrier-markers-damaged')
      expect(damaged).toHaveLength(1)
      expect(damaged[0]!.fidelity).toBe('degraded')
      expect(damaged[0]!.confidence).toBe('fallback')
      expect(value).not.toMatch(/^[ \t>]*:{3,}/m)
      expect(value).toContain('```=html')
    })
  }

  /**
   * A TABLE CELL STILL CARRIES NOTHING: this target flattens a cell to one line
   * and the container's body with it, so there is no line for a marker to stand
   * on (markup-carve/carve#2856).
   */
  it('a container in a table cell takes no marker either way', () => {
    const source = '{header-rows=1}\n::: list-table\n- - A\n  - B\n' +
      '- - cell one\n  - ::: note\n    Body.\n    :::\n:::\n'
    const on = carveToMarkdown(source, { carryMarkers: true })
    expect(on).not.toContain('<!-- carve:')
    expect(on).toBe(carveToMarkdown(source))
    expect(on).toContain('| cell one | Body. |')
  })

  /**
   * A MARKER INSIDE A FENCED CODE BLOCK IS NOT A MARKER: a code block's payload
   * is verbatim content, so a page documenting the mode holds marker-shaped
   * lines that record no container. Lifting one rewrote the sample inside the
   * fence, which is how this was found.
   */
  for (
    const [shape, source] of Object.entries({
      'inside a fenced code block':
        'Intro.\n\n```markdown\n<!-- carve: ::: note -->\nAn admonition body.\n<!-- carve: ::: -->\n```\n',
      'inside an indented code block': 'Intro.\n\n    <!-- carve: ::: note -->\n    body\n',
      // THE PREFIXED SHAPES, which is what carve#2850's narrowing rests on: a
      // marker is read at a line's own start, so these stay where they are.
      'inside a fenced code block in a list item':
        '- item\n\n  ```\n  <!-- carve: ::: note -->\n  Body.\n  <!-- carve: ::: -->\n  ```\n',
      'inside an indented code block in a list item':
        '- item\n\n      <!-- carve: ::: note -->\n      body\n',
      // A FENCE INDENTED PAST THREE COLUMNS is code text, not a fence.
      'inside a fence indented past three columns':
        'Intro.\n\n     ```md\n     <!-- carve: ::: note -->\n     ```\n',
      // AND A FENCE IN A QUOTE IN A LIST ITEM, which carries both host
      // prefixes. This is the shape that made the structure pass's own reading
      // have to take the nested `>` off the content: without that, the fence is
      // invisible and its payload is lifted.
      'inside a fence in a block quote in a list item':
        '- Item.\n  > ```md\n  > <!-- carve: ::: note -->\n  > Body.\n  > <!-- carve: ::: -->\n  > ```\n',
      'inside an inline code span': 'Text with `<!-- carve: ::: note -->` in it.\n',
      // A LIST MARKER INSIDE AN OPEN FENCE IS VERBATIM CONTENT. Reading the
      // nested prefixes off a line inside the fence would let this `- ````
      // read as its closer, and the comments below it would then be lifted out
      // of the payload.
      'inside a fence whose payload holds a marker-shaped fence line':
        '- ```\n  - ```\n  <!-- carve: ::: note -->\n  Body\n  <!-- carve: ::: -->\n  ```\n',
    })
  ) {
    it(`a marker-shaped line ${shape} is left alone`, () => {
      const value = markdownToCarve(source)
      expect(value).toContain('<!-- carve: ::: note -->')
      expect(value).not.toMatch(/^\s*::: note$/m)
      expect(migrateMarkdown(source).report.diagnostics.map((d) => d.code)).not.toContain(
        'carrier-markers-damaged',
      )
    })
  }
})
