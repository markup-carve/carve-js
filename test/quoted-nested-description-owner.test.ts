import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

const normalized = (html: string): string => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it('returns a quoted list marker below an inner description to the outer description', () => {
  expect(normalized(carveToHtml('> :: T\n> : D\n>   :: t\n>   : d\n>    - b\n'))).toBe(
    '<blockquote>\n<dl>\n<dt>T</dt>\n<dd>\n<p>D</p>\n<dl>\n<dt>t</dt>\n<dd>d</dd>\n</dl>\n<ul>\n<li>b</li>\n</ul>\n</dd>\n</dl>\n</blockquote>',
  )
})

it('returns an ordered marker through two quote frames', () => {
  expect(normalized(carveToHtml('> > :: T\n> > : D\n> >   :: t\n> >   : d\n> >    1. b\n'))).toBe(
    '<blockquote>\n<blockquote>\n<dl>\n<dt>T</dt>\n<dd>\n<p>D</p>\n<dl>\n<dt>t</dt>\n<dd>d</dd>\n</dl>\n<ol>\n<li>b</li>\n</ol>\n</dd>\n</dl>\n</blockquote>\n</blockquote>',
  )
})

it('keeps plain text as the inner description paragraph', () => {
  expect(normalized(carveToHtml('> :: T\n> : D\n>   :: t\n>   : d\n>    x\n'))).toBe(
    '<blockquote>\n<dl>\n<dt>T</dt>\n<dd>\n<p>D</p>\n<dl>\n<dt>t</dt>\n<dd>d\nx</dd>\n</dl>\n</dd>\n</dl>\n</blockquote>',
  )
})

it('opens a task list in an outer description held by a quoted list', () => {
  expect(normalized(carveToHtml('> - a0\n>   :: T\n>   : D\n>     :: t\n>     : d\n>      * [ ] b\n'))).toBe(
    '<blockquote>\n<ul>\n<li>a0\n<dl>\n<dt>T</dt>\n<dd>\n<p>D</p>\n<dl>\n<dt>t</dt>\n<dd>d</dd>\n</dl>\n<ul class="task-list">\n<li><input type="checkbox" disabled aria-label="b"> b</li>\n</ul>\n</dd>\n</dl>\n</li>\n</ul>\n</blockquote>',
  )
})

it('bounds repeated quoted description ownership checks', () => {
  const previous = layoutWork.on
  try {
    const work = [50, 200, 400].map(count => {
      const source = ('> :: T\n> : D\n>   :: t\n>   : d\n>    - b\n\n').repeat(count)
      layoutWork.reset()
      layoutWork.on = true
      expect(renderHtml(parse(source)).match(/<li>b<\/li>/g)?.length).toBe(count)
      return layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets + layoutWork.closerLines
    })
    expect(work[1]!).toBeLessThanOrEqual(work[0]! * 4.5)
    expect(work[2]!).toBeLessThanOrEqual(work[1]! * 2.5)
  } finally {
    layoutWork.on = previous
    layoutWork.reset()
  }
})
