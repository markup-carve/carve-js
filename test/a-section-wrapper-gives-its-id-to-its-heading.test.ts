import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

// The shared `section-wrapper-id` fixture, in the default mode.
describe('a section wrapper gives its id back to its heading', () => {
  it('keeps an authored id, drops a derived one, and lets a heading id win', () => {
    const html =
      '<section id="S1" class="ltx_section"><h2 class="t">Intro</h2><p>x</p></section>\n' +
      '<section id="Intro-2"><h2>Intro 2</h2><p>y</p></section>\n' +
      '<section id="outer"><h2 id="own">Own</h2><p>z</p></section>\n'
    const result = htmlToCarve(html)
    expect(result.value).toBe('{#S1 .t}\n## Intro\n\nx\n\n## Intro 2\n\ny\n\n{#own}\n## Own\n\nz\n')
    expect(result.report.diagnostics.map((d) => [d.code, d.path, d.message])).toEqual([
      ['element-unwrapped', '/section[1]', 'Unwrapped unsupported <section> element'],
      ['attribute-dropped', '/section[1]', 'Dropped class with the unwrapped <section>: there is no element left to carry it'],
      ['element-unwrapped', '/section[3]', 'Unwrapped unsupported <section> element'],
      ['element-unwrapped', '/section[5]', 'Unwrapped unsupported <section> element'],
      ['attribute-dropped', '/section[5]', 'Dropped id with the unwrapped <section>: there is no element left to carry it'],
    ])
  })
})
