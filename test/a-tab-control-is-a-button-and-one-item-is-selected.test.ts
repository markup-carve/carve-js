import { describe, expect, it } from 'vitest'
import { carveToHtml, codeGroup, tabs } from '../src/index.js'
import type { CarveExtension } from '../src/extension.js'

/*
 * Extensions §13.3 and §13.5, ruled on markup-carve/carve-php#1537 and stated
 * in the spec by markup-carve/carve#1504. Both rules bind BOTH constructs, so
 * every case here runs against Tabs and CodeGroup alike: §13 exists to stop the
 * two renderers drifting, and a rule tested on one of them is a rule that can.
 *
 * §13.3 - the generated control is `type="button"`. A `<button>` with no `type`
 * is a SUBMIT button, so a tab set inside a `<form>` submitted the form when a
 * tab was activated, instead of switching panels.
 *
 * §13.5 - exactly one item is selected: the first one the document marks
 * `{selected}`, and the first item where it marks none. Later marks are
 * IGNORED, and over-specifying is not an error - no diagnostic, because §13 has
 * no diagnostic channel and the document is redundant rather than wrong.
 *
 * This engine behaved exactly as carve-php did on both halves, so neither was
 * an engine divergence; the port is markup-carve/carve-php#1550.
 */

/*
 * Marks the SECOND and THIRD items, never the first.
 *
 * That is the whole design of the fixture. Marking the first as well would make
 * first-wins indistinguishable from the default-the-first branch, and a
 * document where the last mark is also the winner cannot tell first-wins from
 * last-wins. Only a MIDDLE winner separates the ruling from both of the rules
 * it was chosen over.
 *
 * It is corpus case 48/49's document byte for byte - one document, two modes.
 */
const TABS_TWO_MARKED = [
  ':::: tabs',
  '::: tab [First]',
  'Content one.',
  ':::',
  '',
  '{selected}',
  '::: tab [Second]',
  'Content two.',
  ':::',
  '',
  '{selected}',
  '::: tab [Third]',
  'Content three.',
  ':::',
  '::::',
  '',
].join('\n')

const CODE_GROUP_TWO_MARKED = [
  '::: code-group',
  '``` js [Node]',
  'console.log(1)',
  '```',
  '',
  '{selected}',
  '``` python [Py]',
  'print(1)',
  '```',
  '',
  '{selected}',
  '``` ruby [Rb]',
  'puts 1',
  '```',
  ':::',
  '',
].join('\n')

const TABS_UNMARKED = [
  ':::: tabs',
  '::: tab [First]',
  'Content one.',
  ':::',
  '::: tab [Second]',
  'Content two.',
  ':::',
  '::::',
  '',
].join('\n')

const CODE_GROUP_UNMARKED = [
  '::: code-group',
  '``` js [Node]',
  'console.log(1)',
  '```',
  '``` python [Py]',
  'print(1)',
  '```',
  ':::',
  '',
].join('\n')

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

const render = (source: string, extension: CarveExtension): string =>
  carveToHtml(source, { extensions: [extension] })

describe('every generated tab control is a type="button"', () => {
  const cases: Array<[string, string, CarveExtension]> = [
    ['tabs', TABS_UNMARKED, tabs({ mode: 'aria' })],
    ['code group', CODE_GROUP_UNMARKED, codeGroup({ mode: 'aria' })],
  ]

  it.each(cases)('%s writes it on every control, not just the selected one', (_name, source, extension) => {
    const html = render(source, extension)
    // Asserted as an ABSENCE too. The positive alone passes an engine that
    // writes the attribute on the selected control and leaves the rest bare,
    // which is the shape a "fix the example in the docs" change produces.
    expect(occurrences(html, '<button type="button" role="tab"')).toBe(2)
    expect(html).not.toContain('<button role="tab"')
  })
})

describe('the css mode has no button to fix, and gains none', () => {
  // Its control is an `<input type="radio">`, which already says what it is.
  // Without this the rule could be read as "tab sets emit buttons now".
  const cases: Array<[string, string, CarveExtension]> = [
    ['tabs', TABS_UNMARKED, tabs()],
    ['code group', CODE_GROUP_UNMARKED, codeGroup()],
  ]

  it.each(cases)('%s still emits no button at all', (_name, source, extension) => {
    const html = render(source, extension)
    expect(html).not.toContain('<button')
    expect(occurrences(html, '<input type="radio"')).toBe(2)
  })
})

describe('two marked items select one tab, and the first mark wins', () => {
  const ariaCases: Array<[string, string, CarveExtension, string]> = [
    ['tabs', TABS_TWO_MARKED, tabs({ mode: 'aria' }), 'tabset-1'],
    ['code group', CODE_GROUP_TWO_MARKED, codeGroup({ mode: 'aria' }), 'codegroup-1'],
  ]

  it.each(ariaCases)('%s in aria mode', (_name, source, extension, set) => {
    const html = render(source, extension)

    // The count is the assertion that fails today: two marks gave two
    // `aria-selected="true"` tabs, a shape a single-select `tablist` has no
    // state for. The `tabindex` half goes with it - a tab that is not selected
    // is out of the tab order, so an unfixed engine also left two normal tab
    // stops in the set.
    expect(occurrences(html, 'aria-selected="true"')).toBe(1)
    expect(occurrences(html, 'aria-selected="false"')).toBe(2)
    expect(occurrences(html, 'tabindex="-1"')).toBe(2)

    // The winner is the SECOND item: not the first, which is what the default
    // would have chosen, and not the third, which is what last-wins would.
    expect(html).toContain(`id="${set}-tab-2" aria-selected="true"`)
    expect(html).toContain(`id="${set}-tab-1" aria-selected="false"`)
    expect(html).toContain(`id="${set}-tab-3" aria-selected="false"`)

    // ...and the reveal follows the selection: two panels hidden, one not.
    expect(occurrences(html, ' hidden>')).toBe(2)
  })

  const cssCases: Array<[string, string, CarveExtension, string]> = [
    ['tabs', TABS_TWO_MARKED, tabs(), 'tabset-1'],
    ['code group', CODE_GROUP_TWO_MARKED, codeGroup(), 'codegroup-1'],
  ]

  // The half that makes the ruling a ruling. A radio group cannot have two
  // checked members - the browser resolves it to one whatever the markup says -
  // so `css` never rendered the over-specified document differently, and
  // first-wins was chosen because it is what the `css` default already does
  // with `checked`. If the two modes could disagree about which tab opens,
  // there would be no reason to prefer it.
  it.each(cssCases)('%s in css mode, on the same document, selecting the same item', (_name, source, extension, set) => {
    const html = render(source, extension)

    expect(occurrences(html, ' checked>')).toBe(1)
    expect(html).toMatch(new RegExp(`id="${set}-tab-2"\\s+class="[a-z-]+" checked>`))
  })
})

describe('an unmarked set still opens its first item', () => {
  // The default branch and the first-wins branch are one statement now, so this
  // is the case that would break if the collapse were written as "drop every
  // mark after the first" without the fallback.
  const cases: Array<[string, string, CarveExtension, string]> = [
    ['tabs aria', TABS_UNMARKED, tabs({ mode: 'aria' }), 'aria-selected="true"'],
    ['tabs css', TABS_UNMARKED, tabs(), ' checked>'],
    ['code group aria', CODE_GROUP_UNMARKED, codeGroup({ mode: 'aria' }), 'aria-selected="true"'],
    ['code group css', CODE_GROUP_UNMARKED, codeGroup(), ' checked>'],
  ]

  it.each(cases)('%s', (_name, source, extension, needle) => {
    const html = render(source, extension)
    expect(occurrences(html, needle)).toBe(1)
    // The FIRST control carries it: the marker appears before the second
    // control's id does.
    expect(html.indexOf(needle)).toBeLessThan(html.indexOf('-tab-2"'))
  })
})

describe('over-specifying is not diagnosed', () => {
  // No exception, no diagnostic, no marker in the output. §13 has no diagnostic
  // channel and the document is redundant, not wrong.
  const cases: Array<[string, string, CarveExtension, string]> = [
    ['tabs', TABS_TWO_MARKED, tabs({ mode: 'aria' }), 'tabset-1'],
    ['code group', CODE_GROUP_TWO_MARKED, codeGroup({ mode: 'aria' }), 'codegroup-1'],
  ]

  it.each(cases)('%s renders the ignored item like any other', (_name, source, extension, set) => {
    const html = render(source, extension)
    expect(html).toContain(`id="${set}-tab-3"`)
    expect(html).not.toContain('data-error')
    expect(html).not.toContain('carve-error')
  })
})

describe('corpus cases 48 and 49, byte for byte', () => {
  /*
   * AHEAD OF THE PINNED CORPUS, deliberately, so the bytes are inlined.
   *
   * `48-tabs-aria-single-selection` and `49-tabs-css-single-selection` land with
   * markup-carve/carve#1504 and the spec submodule this engine pins predates
   * them - it predates `46`/`47` too. A test that read them off disk would
   * SKIP, which is a check that cannot fail, and `AHEAD_OF_PIN` in
   * `test/optional-corpus.test.ts` cannot hold them either: its own guard
   * refuses a slug the pinned manifest does not state. So the fixtures are
   * inlined from spec main, and the pin bump that catches up replaces this
   * block with the corpus runner reaching the files.
   *
   * ONE DOCUMENT, TWO MODES, because a rule whose content is "the two modes
   * agree" is not pinned by either mode alone.
   */
  it('48: the aria render', () => {
    expect(render(TABS_TWO_MARKED, tabs({ mode: 'aria' }))).toBe([
      '<div class="tabs" role="tablist" aria-label="Tabs">',
      '<button type="button" role="tab" id="tabset-1-tab-1" aria-selected="false" aria-controls="tabset-1-panel-1" class="tabs-label" tabindex="-1">First</button>',
      '<button type="button" role="tab" id="tabset-1-tab-2" aria-selected="true" aria-controls="tabset-1-panel-2" class="tabs-label">Second</button>',
      '<button type="button" role="tab" id="tabset-1-tab-3" aria-selected="false" aria-controls="tabset-1-panel-3" class="tabs-label" tabindex="-1">Third</button>',
      '<div role="tabpanel" id="tabset-1-panel-1" aria-labelledby="tabset-1-tab-1" class="tabs-panel" hidden>',
      '<p>Content one.</p>',
      '</div>',
      '<div role="tabpanel" id="tabset-1-panel-2" aria-labelledby="tabset-1-tab-2" class="tabs-panel">',
      '<p>Content two.</p>',
      '</div>',
      '<div role="tabpanel" id="tabset-1-panel-3" aria-labelledby="tabset-1-tab-3" class="tabs-panel" hidden>',
      '<p>Content three.</p>',
      '</div>',
      '</div>',
    ].join('\n'))
  })

  it('49: the css render of the same document', () => {
    expect(render(TABS_TWO_MARKED, tabs())).toBe([
      '<div class="tabs" role="group" aria-label="Tabs">',
      '<input type="radio" name="tabset-1" id="tabset-1-tab-1" class="tabs-radio">',
      '<label for="tabset-1-tab-1" class="tabs-label">First</label>',
      '<input type="radio" name="tabset-1" id="tabset-1-tab-2" class="tabs-radio" checked>',
      '<label for="tabset-1-tab-2" class="tabs-label">Second</label>',
      '<input type="radio" name="tabset-1" id="tabset-1-tab-3" class="tabs-radio">',
      '<label for="tabset-1-tab-3" class="tabs-label">Third</label>',
      '<div class="tabs-panel" role="group" aria-label="First">',
      '<p>Content one.</p>',
      '</div>',
      '<div class="tabs-panel" role="group" aria-label="Second">',
      '<p>Content two.</p>',
      '</div>',
      '<div class="tabs-panel" role="group" aria-label="Third">',
      '<p>Content three.</p>',
      '</div>',
      '</div>',
    ].join('\n'))
  })
})
