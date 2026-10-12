import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

describe('closed colon fences in quoted items (carve#2925)', () => {
  it('keeps malformed descendant fences in their absorbing paragraph', () => {
    const source = '- a\n  - b\n    - c\n      :::note\n      :::\ntail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['list'])
    expect(carveToHtml(source)).toContain('c\n:::note\n:::\ntail</li>')
  })
  for (const tail of ['tail', '- tail']) {
    it(`retains a single item's fence across a lazy marker before ${tail}`, () => {
      const source = `> - ::: box\n>   body\n>  - next\n>   :::\n${tail}\n`
      expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', tail === 'tail' ? 'paragraph' : 'list'])
      const html = carveToHtml(source)
      expect(html).toContain('<p>body\n- next</p>')
      const tailHtml = tail === 'tail' ? '<p>tail</p>' : '<li>tail</li>'
      expect(html.indexOf(tailHtml)).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
      expect(carveToHtml(carveToCarve(source))).toBe(html)
    })
  }

  it('keeps an unevenly indented sibling above its parent floor structural', () => {
    const source = '> - a\n>    - ::: box\n>      body\n>   - next\n>      :::\ntail\n'
    const html = carveToHtml(source)
    expect(html).not.toContain('<p>body\n- next</p>')
    expect(html).toContain('<li>next')
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'paragraph'])
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })

  it('tracks a closed fence after a sibling dedents left of the old marker', () => {
    const source = '>  - a\n> - next\n>   ::: b\n>   x\n>   :::\ntail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'paragraph'])
    const html = carveToHtml(source)
    expect(html.indexOf('<p>tail</p>')).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })

  for (const column of [1, 3, 4]) {
    for (const text of ['- next', 'more']) {
      it(`retains a descendant fence across lazy text at column ${column}: ${text}`, () => {
        const source = `- a\n  - ::: box\n    body\n${' '.repeat(column)}${text}\n    :::\ntail\n`
        expect(parse(source).children.map(node => node.type)).toEqual(['list', 'paragraph'])
        const html = carveToHtml(source)
        expect(html).toContain(`<p>body\n${text}</p>`)
        expect(html.indexOf('<p>tail</p>')).toBeGreaterThan(html.lastIndexOf('</ul>'))
        expect(carveToHtml(carveToCarve(source))).toBe(html)
      })
    }
  }

  it('keeps a later marker structural after the folded marker box closes', () => {
    const source = '> - a\n>   - ::: box\n>     body\n>  - next\n>     :::\n>  - again\n>     :::\ntail\n'
    const html = carveToHtml(source)
    expect(html).not.toContain('<li>again\n:::')
    expect(html.indexOf('<p>tail</p>')).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })

  it('keeps a marker left of the outermost item structural', () => {
    const source = '>  - a\n>    - ::: box\n>      body\n> - next\n>      :::\n- tail\n'
    const html = carveToHtml(source)
    expect(html).not.toContain('<p>body\n- next</p>')
    expect(html).toContain('<li>next')
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
    expect(html.indexOf('<li>tail</li>')).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })

  it('retains a fence three list levels deep across a lazy marker', () => {
    const source = '> - a\n>   - b\n>     - ::: box\n>       body\n>    - next\n>       :::\n- tail\n'
    const html = carveToHtml(source)
    expect(html).toContain('<p>body\n- next</p>')
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
    expect(html.indexOf('<li>tail</li>')).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
    expect(carveToHtml(carveToCarve(source))).toBe(html)
  })

  for (const depth of [1, 2]) {
    for (const width of [3, 4]) {
      for (const column of [0, 1, 2, 3, 4]) {
        it(`keeps the actual marker owner at depth ${depth}, width ${width}, column ${column}`, () => {
          const prefix = '> '.repeat(depth)
          const fence = ':'.repeat(width)
          const source = `${prefix}- a\n${prefix}  - ${fence} box\n${prefix}    body\n`
            + `${prefix}${' '.repeat(column)}- next\n${prefix}    ${fence}\n- tail\n`
          expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
          const html = carveToHtml(source)
          if ([1, 3, 4].includes(column)) expect(html).toContain('<p>body\n- next</p>')
          else expect(html).not.toContain('<p>body\n- next</p>')
          expect(html.indexOf('<li>tail</li>')).toBeGreaterThan(html.lastIndexOf('</blockquote>'))
          const canonical = carveToCarve(source)
          expect(carveToHtml(canonical)).toBe(html)
          expect(carveToCarve(canonical)).toBe(canonical)
        })
      }
    }
  }

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

  it('closes an empty marker-line container before unprefixed prose', () => {
    const source = '> - ::: box\nlazy\n'
    expect(parse(source).children.map(node => node.type)).toEqual(["block_quote","paragraph"])
    expect(carveToHtml(source)).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"box\">\n\n      </div>\n    </li>\n  </ul>\n</blockquote>\n<p>lazy</p>")
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
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

  it('releases unprefixed prose before a later quoted fence', () => {
    const source = '> - ::: box\nlazy\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(["block_quote","paragraph","block_quote"])
    expect(carveToHtml(source)).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"box\">\n\n      </div>\n    </li>\n  </ul>\n</blockquote>\n<p>lazy</p>\n<blockquote><p>:::\n- tail</p></blockquote>")
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
    expect(parse(source).children.map(node => node.type)).toEqual(["block_quote","paragraph","block_quote"])
    expect(carveToHtml(source)).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"box\">\n\n      </div>\n    </li>\n  </ul>\n</blockquote>\n<p>lazy</p>\n<blockquote><p>:::\n:::bad\n:::\n- tail</p></blockquote>")
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('ends the quote at an unprefixed link definition', () => {
    const source = '> - ::: box\n[x]: /u\n>   :::\n>   :::bad\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'block_quote', 'link_reference_definition'])
    expect(carveToHtml(source)).toContain('</blockquote>\n<blockquote>')
  })

  it('releases an unmarked line from the inner quote into its outer item', () => {
    const source = '- > - ::: box\n      lazy\n  >   :::\n  >   :::bad\n  >   :::\ntail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(["list"])
    expect(carveToHtml(source)).toBe("<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>\n          <div class=\"box\">\n\n          </div>\n        </li>\n      </ul>\n    </blockquote>\n    lazy\n    <blockquote><p>:::\n:::bad\n:::\ntail</p></blockquote>\n  </li>\n</ul>")
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('keeps the item column for a quoted dedented lazy paragraph', () => {
    const source = '> - ::: box\n> lazy\n>   :::\n- tail\n'
    expect(parse(source).children.map(node => node.type)).toEqual(["block_quote"])
    expect(carveToHtml(source)).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"box\">\n\n      </div>\n    </li>\n  </ul>\n  <p>lazy\n:::\n- tail</p>\n</blockquote>")
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
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
