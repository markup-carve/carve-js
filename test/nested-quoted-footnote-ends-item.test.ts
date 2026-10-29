import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

const normalized = (html: string): string => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

// The quoted note's open paragraph takes the line lazily (carve#3885).
it('folds the line into a quoted footnote below both list levels', () => {
  expect(normalized(carveToHtml('- h0\n  1. h1\n    > quote\n    > [^n]: note\nq\n'))).toBe(
    '<ul>\n<li>h0\n<ol>\n<li>h1</li>\n</ol>\n<blockquote><p>quote</p></blockquote>\n</li>\n</ul>',
  )
})

it('folds the line into a quoted footnote body', () => {
  expect(normalized(carveToHtml('- h0\n  1. h1\n    > quote\n    > [^n]: note\n    >   more\nq\n'))).toBe(
    '<ul>\n<li>h0\n<ol>\n<li>h1</li>\n</ol>\n<blockquote><p>quote</p></blockquote>\n</li>\n</ul>',
  )
})

it('keeps a lazy line while the nested quote paragraph is still open', () => {
  expect(normalized(carveToHtml('- h0\n  1. h1\n    > quote\nq\n'))).toBe(
    '<ul>\n<li>h0\n<ol>\n<li>h1</li>\n</ol>\n<blockquote><p>quote\nq</p></blockquote>\n</li>\n</ul>',
  )
})

it('ends a nested quote after a note takes its next line', () => {
  expect(normalized(carveToHtml('- h0\n  1. h1\n    > quote\n    > [^n]: note\n    > p\nq\n'))).toBe(
    '<ul>\n<li>h0\n<ol>\n<li>h1</li>\n</ol>\n<blockquote><p>quote</p></blockquote>\n</li>\n</ul>',
  )
})

it('bounds repeated nested quoted footnote exits', () => {
  const previous = layoutWork.on
  try {
    const work = [50, 200, 400].map(count => {
      const source = ('- h0\n  1. h1\n    > quote\n    > [^n]: note\nq\n\n').repeat(count)
      layoutWork.reset()
      layoutWork.on = true
      expect(renderHtml(parse(source)).match(/<p>q<\/p>/g)).toBeNull()
      return layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets + layoutWork.closerLines
    })
    expect(work[1]!).toBeLessThanOrEqual(work[0]! * 4.5)
    expect(work[2]!).toBeLessThanOrEqual(work[1]! * 2.5)
  } finally {
    layoutWork.on = previous
    layoutWork.reset()
  }
})
