import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const compact = (html: string): string => html.replace(/>\s+</g, '><').trim()

// carve#5130, CARVE-P9-067: after a `+` every invisible line the host keeps is skipped, at its marker or content column.
describe('a plus skips every invisible line its host keeps', () => {
  it.each([
    ['- +\n  %%%\n  c\n  %%%\ntext\n', '<ul><li>text</li></ul>'],
    ['- +\n  {x}\ntext\n', '<ul><li><p x="">text</p></li></ul>'],
    ['1. +\n   %%%\n   c\n   %%%\ntext\n', '<ol><li>text</li></ol>'],
    [':: t\n: +\n  %%%\n  c\n  %%%\ntext\n', '<dl><dt>t</dt><dd>text</dd></dl>'],
    ['- +\n  %%%\n  c\n  %%%\n  {x}\ntext\n', '<ul><li><p x="">text</p></li></ul>'],
  ])('attaches past %j', (source, html) => {
    expect(compact(carveToHtml(source))).toBe(html)
  })

  it.each([
    // The visible line stands at the content column, so the `+` is refused.
    ['- +\n  %%%\n  c\n  %%%\n  text\n', '<ul><li>text</li></ul>'],
    // Below the content column the attribute line closes the item.
    ['- +\n {x}\ntext\n', '<ul><li></li></ul><p x="">text</p>'],
    // A line below the content column ends the span the item keeps.
    ['- +\n  %%%\n c\n  %%%\ntext\n', '<ul><li></li></ul><p>c</p>'],
  ])('refuses past %j as before', (source, html) => {
    expect(compact(carveToHtml(source))).toContain(html)
  })

  it('starts the skipped span at its opener', () => {
    const source = '- +\n  %%%\n  c\n  %%%\ntext\n'
    const item = parse(source).children[0]
    if (item?.type !== 'list') throw new Error('expected a list')
    const comment = item.items[0]!.children[0]
    expect(comment?.type).toBe('comment')
    expect(source.slice(comment!.pos!.startOffset, comment!.pos!.startOffset! + 3)).toBe('%%%')
  })
})
