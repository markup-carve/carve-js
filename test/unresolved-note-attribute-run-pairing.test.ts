import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a whole attribute run after an unresolved note stays opaque to inline pairs', () => {
  it.each([
    ['{=[^n]{#id}{title="x"}', '<p>{=[^n]{#id}{title="x"}</p>'],
    ['{=[^n]{#id}{title="x"}{.c}', '<p>{=[^n]{#id}{title="x"}{.c}</p>'],
    ['{=[t][missing]{#id}{title="x"}', '<p>{=[t][missing]{#id}{title="x"}</p>'],
    ['{=![t][missing]{#id}{title="x"}', '<p>{=![t][missing]{#id}{title="x"}</p>'],
  ])('keeps %j literal', (source, expected) => {
    expect(carveToHtml(`${source}\n`).trim()).toBe(expected)
  })

  it('keeps the run attached when the note resolves', () => {
    const html = carveToHtml('[^n]{#id}{title="x"}\n\n[^n]: body\n')
    expect(html).toContain('id="id" href="#fn1" role="doc-noteref" title="x"')
  })
})
