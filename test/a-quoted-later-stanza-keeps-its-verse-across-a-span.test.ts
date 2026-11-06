import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a lazy line after a span into a quoted second stanza', () => {
  expect(carveToHtml('> :: t\n> : ::: |\n>   x\n>\n>   y\n>   %%%\nb\n')).toBe(
    '<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>\n      <div class="line-block">\n        <p>x</p>\n        <p>y<br>\nb</p>\n      </div>\n    </dd>\n  </dl>\n</blockquote>',
  )
})

it('leaves the follower outside when the second stanza is empty', () => {
  for (const mark of ['> ', '> > ']) {
    expect(carveToHtml(`${mark}:: t\n${mark}: ::: |\n${mark}  x\n${mark.trimEnd()}\n${mark}  %%%\nb\n`)).toMatch(/<\/blockquote>\n<p>b<\/p>$/)
  }
})

it('folds the lazy line in 1,000 quoted later-stanza variants', () => {
  let checked = 0
  for (const depth of [1, 2]) {
    const mark = '> '.repeat(depth)
    for (const host of [[':: t', ': ::: |'], ['- ::: |']]) {
      for (const span of ['%%%', '%%%%', '%%% c', '%%%\n  hid', '%%%\n  %%%']) {
        for (let n = 0; n < 50; n++) {
          const rows = [...host, `  x${n}`, '', `  y${n}`, ...span.split('\n').map(r => r.startsWith('  ') ? r : `  ${r}`)]
          const source = rows.map(r => r === '' ? mark.trimEnd() : mark + r).join('\n') + `\nb${n}\n`
          expect(carveToHtml(source), source).toContain(`<p>y${n}<br>\nb${n}</p>`)
          checked++
        }
      }
    }
  }
  expect(checked).toBe(1000)
})
