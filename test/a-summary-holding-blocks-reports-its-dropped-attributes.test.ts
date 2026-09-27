import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, renderCarve } from '../src/index.js'

const attributed = '<details><summary><div class="t">Baseline</div><div class="s">Widely available</div></summary><p>body</p></details>'
const bare = '<details><summary><div>Baseline</div><div>Widely available</div></summary><p>body</p></details>'
const flattened = '::: details "Baseline Widely available"\nbody\n:::\n'
const firstDiv = '/details[1]/summary[1]/div[1]'
const secondDiv = '/details[1]/summary[1]/div[2]'

const cases = [
  ...(['safe', 'semantic'] as const).flatMap((mode) => [
    {
      mode, name: 'reports dropped classes', html: attributed, expected: flattened,
      rows: [
        ['element-unwrapped', firstDiv, 'degraded', 'info'],
        ['attribute-dropped', firstDiv, 'dropped', 'info'],
        ['element-unwrapped', secondDiv, 'degraded', 'info'],
        ['attribute-dropped', secondDiv, 'dropped', 'info'],
      ],
    },
    {
      mode, name: 'unwraps divs without attributes', html: bare, expected: flattened,
      rows: [
        ['element-unwrapped', firstDiv, 'degraded', 'info'],
        ['element-unwrapped', secondDiv, 'degraded', 'info'],
      ],
    },
  ]),
  {
    mode: 'roundtrip' as const, name: 'preserves attributed divs in the body', html: attributed,
    expected: '::: details\n`<div class="t">Baseline</div>`{=html} `<div class="s">Widely available</div>`{=html}\n\nbody\n:::\n',
    rows: [
      ['element-unwrapped', '/details[1]/summary[1]', 'degraded', 'warning'],
      ['raw-preserved', firstDiv, 'degraded', 'warning'],
      ['raw-preserved', secondDiv, 'degraded', 'warning'],
    ],
  },
  {
    mode: 'roundtrip' as const, name: 'preserves bare divs in the title', html: bare,
    expected: '::: details "`<div>Baseline</div>`{=html} `<div>Widely available</div>`{=html}"\nbody\n:::\n',
    rows: [
      ['raw-preserved', firstDiv, 'degraded', 'warning'],
      ['raw-preserved', secondDiv, 'degraded', 'warning'],
    ],
  },
]

describe('a summary holding blocks reports its dropped attributes', () => {
  describe.each(['htmlToCarve', 'htmlToAst'] as const)('%s', (entryPoint) => {
    it.each(cases)('$mode: $name', ({ mode, html, expected, rows }) => {
      const result = entryPoint === 'htmlToCarve'
        ? htmlToCarve(html, { mode })
        : htmlToAst(html, { mode })
      expect(typeof result.value === 'string' ? result.value : renderCarve(result.value)).toBe(expected)
      expect(result.report.diagnostics.map(({ code, path, fidelity, severity }) => [
        code, path, fidelity, severity,
      ])).toEqual(rows)
      if (html === bare) {
        expect(result.report.diagnostics.some(({ code }) => code === 'attribute-dropped')).toBe(false)
      }
    })
  })
})
