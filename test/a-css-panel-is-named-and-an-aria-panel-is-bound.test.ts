import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { tabs } from '../src/tabs.js'
import { codeGroup } from '../src/code-group.js'

/*
 * PART 11 §13, ruled in markup-carve/carve#1489.
 *
 * Under the `css` default nothing binds a panel to the control that reveals it:
 * every radio and label is emitted before every panel. So a `css` panel takes a
 * role and a name of its own (§13.2). An `aria` panel takes NEITHER, because it
 * is already bound by `aria-labelledby` and a second name would give one
 * element two (§13.3) - the absence is a rule, and the near-miss case below is
 * what goes red if aria panels get named too.
 *
 * The two tab expectations are the spec corpus bytes for
 * `46-tabs-css-panel-name` and `47-tabs-aria-panel-binding`. They are written
 * out here rather than read from `spec/`, because this engine goes first: the
 * pinned submodule does not carry those fixtures yet, and the corpus runner
 * asserts the same bytes once the pin catches up.
 *
 * Case 47's control gained `type="button"` in markup-carve/carve#1504
 * (Extensions §13.3), so the bytes below are spec main's, not the ones that PR
 * replaced. §13.5, the other half of that ruling, is pinned in
 * `a-tab-control-is-a-button-and-one-item-is-selected.test.ts`.
 */

const TAB_SOURCE = [
  ':::: tabs',
  '::: tab [First]',
  'Content one.',
  ':::',
  '::: tab [R&D "core" <x>]',
  'Content two.',
  ':::',
  '::::',
  '',
].join('\n')

const CODE_GROUP_SOURCE = [
  '::: code-group',
  '``` js [Node]',
  'console.log(1)',
  '```',
  '',
  '``` python',
  'print(1)',
  '```',
  ':::',
  '',
].join('\n')

describe('a css-mode panel carries its tab name', () => {
  it('renders corpus case 46 byte for byte', () => {
    expect(carveToHtml(TAB_SOURCE, { extensions: [tabs()] })).toBe([
      '<div class="tabs" role="group" aria-label="Tabs">',
      '<input type="radio" name="tabset-1" id="tabset-1-tab-1" class="tabs-radio" checked>',
      '<label for="tabset-1-tab-1" class="tabs-label">First</label>',
      '<input type="radio" name="tabset-1" id="tabset-1-tab-2" class="tabs-radio">',
      '<label for="tabset-1-tab-2" class="tabs-label">R&amp;D "core" &lt;x&gt;</label>',
      '<div class="tabs-panel" role="group" aria-label="First">',
      '<p>Content one.</p>',
      '</div>',
      '<div class="tabs-panel" role="group" aria-label="R&amp;D &quot;core&quot; &lt;x&gt;">',
      '<p>Content two.</p>',
      '</div>',
      '</div>',
    ].join('\n'))
  })

  it('escapes the name for an ATTRIBUTE, which the label element does not', () => {
    // The same string lands in two places with two escapings, so a fix that
    // reused `escapeHtml` for the attribute would still look right in the
    // element and put a bare quote inside `aria-label="…"`.
    const html = carveToHtml(TAB_SOURCE, { extensions: [tabs()] })
    expect(html).toContain('class="tabs-label">R&amp;D "core" &lt;x&gt;</label>')
    expect(html).toContain('aria-label="R&amp;D &quot;core&quot; &lt;x&gt;"')
  })

  it('is the default, so a page with no stylesheet still shows every panel', () => {
    // §13.1: `css` must be the default because `aria` reveals with `hidden`.
    expect(carveToHtml(TAB_SOURCE, { extensions: [tabs()] }))
      .toBe(carveToHtml(TAB_SOURCE, { extensions: [tabs({ mode: 'css' })] }))
    expect(carveToHtml(TAB_SOURCE, { extensions: [tabs()] })).not.toContain('hidden')
  })
})

describe('an aria-mode panel is bound, not named', () => {
  it('renders corpus case 47 byte for byte', () => {
    expect(carveToHtml(TAB_SOURCE, { extensions: [tabs({ mode: 'aria' })] })).toBe([
      '<div class="tabs" role="tablist" aria-label="Tabs">',
      '<button type="button" role="tab" id="tabset-1-tab-1" aria-selected="true" aria-controls="tabset-1-panel-1" class="tabs-label">First</button>',
      '<button type="button" role="tab" id="tabset-1-tab-2" aria-selected="false" aria-controls="tabset-1-panel-2" class="tabs-label" tabindex="-1">R&amp;D "core" &lt;x&gt;</button>',
      '<div role="tabpanel" id="tabset-1-panel-1" aria-labelledby="tabset-1-tab-1" class="tabs-panel">',
      '<p>Content one.</p>',
      '</div>',
      '<div role="tabpanel" id="tabset-1-panel-2" aria-labelledby="tabset-1-tab-2" class="tabs-panel" hidden>',
      '<p>Content two.</p>',
      '</div>',
      '</div>',
    ].join('\n'))
  })

  it('names no panel - the near miss', () => {
    // THE ABSENCE IS THE RULE. Stated as its own assertion so extending §13.2
    // to every panel fails here rather than silently shipping two accessible
    // names on one element.
    const html = carveToHtml(TAB_SOURCE, { extensions: [tabs({ mode: 'aria' })] })
    const panels = html.split('\n').filter((line) => line.includes('class="tabs-panel"'))
    expect(panels).toHaveLength(2)
    for (const panel of panels) {
      expect(panel).not.toContain('role="group"')
      expect(panel).not.toContain('aria-label=')
      expect(panel).toContain('aria-labelledby=')
    }
  })
})

describe('code-group carries the same mode and the same panel names', () => {
  it('names each css panel by its own label, language word where none was written', () => {
    expect(carveToHtml(CODE_GROUP_SOURCE, { extensions: [codeGroup()] })).toBe([
      '<div class="code-group" role="group" aria-label="Code examples">',
      '<input type="radio" name="codegroup-1" id="codegroup-1-tab-1" class="code-group-radio" checked>',
      '<label for="codegroup-1-tab-1" class="code-group-label">Node</label>',
      '<input type="radio" name="codegroup-1" id="codegroup-1-tab-2" class="code-group-radio">',
      '<label for="codegroup-1-tab-2" class="code-group-label">python</label>',
      '<div class="code-group-panel" role="group" aria-label="Node"><pre><code class="language-js">console.log(1)',
      '</code></pre>',
      '</div>',
      '<div class="code-group-panel" role="group" aria-label="python"><pre><code class="language-python">print(1)',
      '</code></pre>',
      '</div>',
      '</div>',
    ].join('\n'))
  })

  it('mirrors the Tabs aria shape, and names no panel there either', () => {
    const html = carveToHtml(CODE_GROUP_SOURCE, { extensions: [codeGroup({ mode: 'aria' })] })
    expect(html).toContain('<div class="code-group" role="tablist" aria-label="Code examples">')
    expect(html).toContain('<button type="button" role="tab" id="codegroup-1-tab-1" aria-selected="true" aria-controls="codegroup-1-panel-1" class="code-group-label">Node</button>')
    expect(html).toContain('<div role="tabpanel" id="codegroup-1-panel-1" aria-labelledby="codegroup-1-tab-1" class="code-group-panel">')
    expect(html).toContain('class="code-group-panel" hidden>')
    for (const line of html.split('\n').filter((l) => l.includes('role="tabpanel"'))) {
      expect(line).not.toContain('role="group"')
      expect(line).not.toContain('aria-label=')
    }
  })

  it('no longer accepts the mode and ignores it', () => {
    // The bug half: `codeGroup({ mode: 'aria' })` used to be byte-identical to
    // `codeGroup()`, which is the same defect shape as carve-js#1263.
    expect(carveToHtml(CODE_GROUP_SOURCE, { extensions: [codeGroup({ mode: 'aria' })] }))
      .not.toBe(carveToHtml(CODE_GROUP_SOURCE, { extensions: [codeGroup()] }))
  })
})

describe('an unknown mode is refused, not guessed', () => {
  it.each([
    ['Tabs', () => tabs({ mode: 'aira' as never })],
    ['CodeGroup', () => codeGroup({ mode: 'aira' as never })],
  ])('%s throws on a typo rather than rendering the default', (name, make) => {
    expect(make).toThrow(new RegExp(`Invalid ${name} mode "aira"`))
  })

  it.each([
    ['omitted', undefined],
    ['css', 'css' as const],
    ['aria', 'aria' as const],
  ])('accepts %s', (_label, mode) => {
    expect(() => tabs(mode === undefined ? {} : { mode })).not.toThrow()
    expect(() => codeGroup(mode === undefined ? {} : { mode })).not.toThrow()
  })
})

describe('a static render takes neither mode', () => {
  it.each([
    ['tabs', TAB_SOURCE, tabs],
    ['code-group', CODE_GROUP_SOURCE, codeGroup],
  ] as const)('%s renders the same static HTML under css and aria', (_name, source, make) => {
    // §13.1: `renderStatic` flattens the set to one `<section>` per panel headed
    // by its label - the heading IS the name, and no interaction survives to
    // bind, so neither mode's panel treatment applies.
    const render = (mode: 'css' | 'aria') =>
      carveToHtml(source, { extensions: [make({ mode })], mode: 'static' })
    expect(render('aria')).toBe(render('css'))
    expect(render('css')).not.toContain('role="tabpanel"')
    expect(render('css')).not.toContain('role="group" aria-label="First"')
  })
})
