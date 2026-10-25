import { expect, it } from 'vitest'
import { carveToMarkdownWithReport } from '../src/index.js'

it.each([
  {
    name: 'figure caption',
    source: '![a](u)\n^ cap[^n]\n\n[^n]: Body\n',
    caption: '![a](u)\ncap[^n]\n',
  },
  {
    name: 'table caption',
    source: '| h |\n|---|\n| x |\n^ cap[^n]\n\n[^n]: Body\n',
    caption: '| h |\n| --- |\n| x |\n\ncap[^n]\n',
  },
  {
    name: 'figure caption with repeated reference',
    source: '![a](u)\n^ cap[^n] and [^n]\n\n[^n]: Body\n',
    caption: '![a](u)\ncap[^n] and [^n]\n',
  },
  {
    name: 'table caption with repeated reference',
    source: '| h |\n|---|\n| x |\n^ cap[^n] and [^n]\n\n[^n]: Body\n',
    caption: '| h |\n| --- |\n| x |\n\ncap[^n] and [^n]\n',
  },
])('keeps footnotes in a $name', ({ source, caption }) => {
  const report = carveToMarkdownWithReport(source)
  expect(report.value).toBe(`${caption}\n[^n]: Body\n`)
  expect(report.losses.map(loss => loss.code)).toEqual(['markdown-caption-flattened'])
})
