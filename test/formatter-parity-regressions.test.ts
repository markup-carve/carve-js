import { expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

it.each(['`\n\t> x\n', '~``` x\n[d]: u ```\n', '`\n``\n', '`\n``x\n', '1. [d]: u\n', '- A\n{x}\n*[A]: }\n'])(
  'preserves rendered content when formatting %j',
  (source) => {
    const formatted = renderCarve(parse(source))
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(renderCarve(parse(formatted))).toBe(formatted)
  },
)

it('ends an abbreviation prepass list at a block attribute line', () => {
  expect(carveToHtml('- A\n{x}\n*[A]: }\n')).toContain('<abbr title="}">A</abbr>')
})
