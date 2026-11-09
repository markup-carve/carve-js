import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

describe('November 9 spec rulings', () => {
  it('tests abbreviation boundaries across eligible inline edges (carve#5670)', () => {
    const def = '\n\n*[HTML]: t\n'
    expect(carveToHtml('[w[HTML](u)]()' + def).trim()).toBe('<p><a href="">wHTML</a></p>')
    expect(carveToHtml('w{*HTML*}' + def).trim()).toBe('<p>w<strong>HTML</strong></p>')
    expect(carveToHtml('( *HTML* )' + def).trim()).toBe('<p>( <strong><abbr title="t">HTML</abbr></strong> )</p>')
    expect(carveToHtml('w{~x~>HTML~}' + def).trim()).toBe('<p>w<del>x</del><ins>HTML</ins></p>')
  })

  it('keeps a region marker between items as a sibling of both lists (carve#5671)', () => {
    const source = '- a\n%% #region x\n- b\n'
    expect(carveToHtml(source).trim()).toBe('<ul>\n  <li>a</li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>')
    expect(parse(source).children.map(node => node.type)).toEqual(['list', 'comment', 'list'])
  })

  it('bounds a cut attribute candidate by the outer bracket region (carve#5672)', () => {
    expect(carveToHtml('[t[x](/u){title="]"}y](/z)\n').trim())
      .toBe('<p>[t<a href="/u">x</a>{title=“]”}y](/z)</p>')
    expect(carveToHtml('a [t`c`{title="]"}x](/u) b\n').trim())
      .toBe('<p>a [t<code>c</code>{title=“]”}x](/u) b</p>')
  })

  it('lets a comment atom form before a failed bracket attribute tail (carve#5673)', () => {
    expect(carveToHtml('[[][[]]{#1}][]#}\n').trim())
      .toBe('<p>[[][[]]<span class="critic-comment">1}][]</span></p>')
    expect(carveToHtml('[a[b](u){#id title="#}"}c](v)\n').trim())
      .toBe('<p><a href="v">abc</a></p>')
  })
})
