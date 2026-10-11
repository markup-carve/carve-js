import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

describe('closed colon fences in quoted items (carve#2925)', () => {
  for (const depth of [1, 2, 3]) {
    for (const width of [3, 4]) {
      for (const body of [false, true]) {
        for (const column of [0, 2]) {
          it(`puts the tail outside depth ${depth}, width ${width}, body ${body}, column ${column}`, () => {
            const prefix = '> '.repeat(depth)
            const fence = ':'.repeat(width)
            const source = `${prefix}- ${fence} box\n`
              + (body ? `${prefix}  body\n` : '')
              + `${prefix}  ${fence}\n${' '.repeat(column)}- tail\n`
            const doc = parse(source)
            expect(doc.children.map(node => node.type)).toEqual(['block_quote', 'list'])
            expect(doc.children[0]!.pos?.endLine).toBe(body ? 3 : 2)
            expect(doc.children[1]).toMatchObject({
              type: 'list',
              items: [{ children: [{ type: 'paragraph', children: [{ type: 'text', value: 'tail' }] }] }],
            })
            const html = carveToHtml(source)
            expect(html.indexOf('<li>tail</li>')).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
            const canonical = carveToCarve(source)
            expect(carveToHtml(canonical)).toBe(html)
            expect(carveToCarve(canonical)).toBe(canonical)
          })
        }
      }
    }
  }

  it('retains marker text after prose without a blank line', () => {
    expect(carveToHtml('prose\n- tail\n')).toBe('<p>prose\n- tail</p>')
    expect(carveToHtml('> prose\n- tail\n')).toBe('<blockquote><p>prose\n- tail</p></blockquote>')
  })

  it('keeps an explicitly prefixed sibling inside the quote', () => {
    const source = '> - ::: box\n>   :::\n> - tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote'])
    expect(carveToHtml(source)).toContain('<li>tail</li>')
  })

  it('attaches the following block to the quote with column-zero plus', () => {
    const source = '> - ::: box\n>   :::\n+\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote'])
    expect(carveToHtml(source)).toContain('tail')
  })

  it('leaves an unclosed marker-line candidate foldable', () => {
    const source = '> - ::: box\nlazy\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote'])
    expect(carveToHtml(source)).toContain('::: box\nlazy')
  })

  for (const source of [
    '> - prose\n>   ::: box\n>   :::\n- tail\n',
    '> - :::: box\n>   ::: inner\n>   :::\n>   :::: \n- tail\n',
    '> - ::: box\n>   ```\n>   :::\n>   ```\n>   :::\n- tail\n',
    '> - ::: box\n>   %%%\n>   :::\n>   %%%\n>   :::\n- tail\n',
    '> - ::: box\n>\n>   :::\n- tail\n',
    '> - ::: box\n>   body\nlazy\n>   :::\n- tail\n',
  ]) {
    it(`ends ownership after the actual container closes: ${JSON.stringify(source)}`, () => {
      expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
      const html = carveToHtml(source)
      expect(html.indexOf('<li>tail</li>')).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
      expect(carveToHtml(carveToCarve(source))).toBe(html)
    })
  }

  it('forgets a marker-line candidate when a sibling item replaces its host', () => {
    const source = '> - ::: box\n> - prose\n>   :::bad\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote'])
    expect(carveToHtml(source)).toContain(':::bad\n:::\n- tail')
  })

  it('forgets a candidate after its item dedents into quoted prose', () => {
    const source = '> - ::: box\n>\n> para\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote'])
    expect(carveToHtml(source)).toContain('para\n:::\n- tail')
  })

  it('forgets a marker-line candidate demoted by an unprefixed lazy body', () => {
    const source = '> - ::: box\nlazy\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
    expect(carveToHtml(source)).toContain('::: box\nlazy')
    expect(carveToHtml(source)).not.toContain('class="box"')
    expect(carveToHtml(source)).toContain('<div>')
  })
})
