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
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('absorbs bare fences after a malformed marker-line opener', () => {
    const source = '> - :::bad\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote'])
    expect(carveToHtml(source)).toContain(':::bad\n:::\n- tail')
  })

  for (const prefix of ['> - next\n>   ', '>   - next\n>     ']) {
    it(`ends malformed absorption at a new item: ${JSON.stringify(prefix)}`, () => {
      const source = '> - prose\n>   :::bad\n' + prefix + ':::\n- tail\n'
      expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
      expect(carveToHtml(source)).toContain('<div>')
    })
  }

  it('tracks a colon opener on a quoted footnote definition line', () => {
    const source = '> [^a]: ::: box\n>   :::bad\n>   :::\ntail\n\nref[^a]\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'paragraph', 'paragraph'])
    const html = carveToHtml(source)
    expect(html).toContain('</blockquote>\n<p>tail</p>')
    expect(html).toContain('<div class="box">')
  })

  it('keeps a malformed note body from creating a quoted paragraph claim', () => {
    const source = '> [^a]: :::bad\n>   :::\ntail\n\nref[^a]\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'paragraph', 'paragraph'])
    expect(carveToHtml(source)).toContain('</blockquote>\n<p>tail</p>')
  })

  it('ends ownership after a lazy body and later marked colon boundaries', () => {
    const source = '> - ::: box\nlazy\n>   :::\n>   :::bad\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
    expect(carveToHtml(source)).toContain('<div class="box">')
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('ends the quote at an unprefixed link definition', () => {
    const source = '> - ::: box\n[x]: /u\n>   :::\n>   :::bad\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'block_quote', 'link_reference_definition'])
    expect(carveToHtml(source)).toContain('</blockquote>\n<blockquote>')
  })

  it('demotes an item-hosted quote candidate for an indented unmarked line', () => {
    const source = '- > - ::: box\n      lazy\n  >   :::\n  >   :::bad\n  >   :::\ntail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['list', 'paragraph'])
    expect(carveToHtml(source)).toContain('</ul>\n<p>tail</p>')
  })

  it('keeps the item column for a quoted dedented lazy paragraph', () => {
    const source = '> - ::: box\n> lazy\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
    expect(carveToHtml(source)).not.toContain('class="box"')
    expect(carveToHtml(source)).toContain('::: box\nlazy')
    expect(carveToHtml(source)).toContain('<div>')
  })

  for (const opener of ['|']) {
    it(`keeps colon-shaped literal ${JSON.stringify(opener)} payload out of the candidate stack`, () => {
      const source = `> - ::: ${opener}\n>   :::: box\n>   :::\n>   :::bad\n>   :::\n- tail\n`
      expect(parse(source).children.map(node => node.type)).toEqual(['block_quote'])
      expect(carveToHtml(source)).toContain(':::bad\n:::\n- tail')
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })
  }

  for (const fence of ['```', '```=html']) {
    it(`keeps the quoted note's ${JSON.stringify(fence)} fence scoped to its host`, () => {
      const source = ['> [^a]: ' + fence, '>   code', '>   ```', 'tail', '', 'ref[^a]', ''].join('\n')
      expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'paragraph', 'paragraph'])
      const html = carveToHtml(source)
      expect(html).toContain('</blockquote>\n<p>tail</p>')
      const note = html.slice(html.indexOf('<section role="doc-endnotes"'))
      expect(note).toContain('code')
      if (fence === '```') expect(note).toContain('<pre><code>code\n</code></pre>')
      else expect(note).not.toContain('<pre>')
      expect(note).not.toContain('```')
      expect(carveToHtml(carveToCarve(source))).toBe(html)
    })
  }
})
