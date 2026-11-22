import { expect, it } from 'vitest'
import { parseWithLayout, tabsExtensions } from '../src/index.ts'
import { growthRatio } from './support/growth.ts'

it('converts extension source positions in linear work across the layout walk', () => {
  const source = (count: number): string => '[r]: /target\n\n' + Array.from({ length: count }, (_, at) =>
    `:::: tabs\n::: tab "T${at}"\nsee [r].\n:::\n::::\n\n`).join('')
  const options = { extensions: tabsExtensions }
  const small = source(64)
  const large = source(1024)
  const { ratio, times } = growthRatio(() => { parseWithLayout(small, options) },
    () => { parseWithLayout(large, options) })
  expect(ratio, times.map((time) => time.toFixed(1)).join(', ')).toBeLessThan(25)
})
