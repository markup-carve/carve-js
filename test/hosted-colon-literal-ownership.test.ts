import {expect, it} from 'vitest'
import {parse, carveToHtml, renderHtml} from '../src/index.js'
import type {BlockNode, List} from '../src/ast.js'
import readerScopeFixtures from './fixtures/hosted-colon-reader-scope.json'
import neighborScopeFixtures from './fixtures/hosted-colon-neighbor-scope.json'
import review7ScopeFixtures from './fixtures/hosted-colon-review7-scope.json'
import review8ScopeFixtures from './fixtures/hosted-colon-review8-scope.json'
import review9ScopeFixtures from './fixtures/hosted-colon-review9-scope.json'
import commentDedentFixtures from './fixtures/quoted-comment-dedent-parity.json'

// Expected HTML comes from native reader 83fa84fcba4f5d7bddc923219927f8122af1a341.
for (const fixture of readerScopeFixtures) it(fixture.name, () => {
  expect(carveToHtml(fixture.source)).toBe(fixture.html)
})
for (const fixture of neighborScopeFixtures) it(fixture.id, () => {
  expect(carveToHtml(fixture.source)).toBe(fixture.html)
})
for (const fixture of review7ScopeFixtures) it(fixture.id, () => {
  expect(carveToHtml(fixture.source)).toBe(fixture.html)
})
for (const fixture of review8ScopeFixtures) it(fixture.id, () => {
  expect(carveToHtml(fixture.source)).toBe(fixture.html)
})
for (const fixture of review9ScopeFixtures) it(fixture.id, () => {
  expect(carveToHtml(fixture.source)).toBe(fixture.html)
})

for (const quote of ['', '> ', '> > ']) for (const type of ['in', '|']) {
  it(`leaves no lazy claim after a descendant ${type} closes in an outer div, quote ${quote}`, () => {
    const source = `${quote}- :::: box\n${quote}  - ::: ${type}\n${quote}    x\n${quote}    :::\nTAILX\n`
    expect(parse(source).children.map(node => node.type)).toEqual([quote ? 'block_quote' : 'list', 'paragraph'])
    expect(carveToHtml(source)).toContain('<p>TAILX</p>')
  })
}

for (const quote of ['', '> ', '> > ']) {
  for (const tail of ['TAILX', '- tail']) {
    it(`keeps a first shifted bare run in its div paragraph, quote ${quote}, tail ${tail}`, () => {
      const source = `${quote}- ::: box\n${quote}    :::\n${tail}\n`
      expect(parse(source).children).toHaveLength(1)
      expect(carveToHtml(source)).toContain(tail === '- tail' && !quote ? '<li>tail</li>' : `:::\n${tail}</p>`)
    })
  }
  for (const body of [':::', '# h']) {
    it(`rebases ${body} after a real marker-line div closer, quote ${quote}`, () => {
      const source = `${quote}- ::: box\n${quote}  :::\n${quote}    ${body}\nTAILX\n`
      expect(parse(source).children.map(node => node.type)).toEqual([quote ? 'block_quote' : 'list', 'paragraph'])
      expect(carveToHtml(source)).toContain(body === '# h' ? '<h1 id="h">h</h1>' : '<div>\n\n')
      expect(carveToHtml(source)).toContain('<p>TAILX</p>')
    })
  }
}

for (const depth of [1, 2]) {
  const quote = '> '.repeat(depth)
  for (const run of ['```', '~~~']) {
    for (const type of ['', ' box']) {
      it(`keeps shifted colon and ${run} as paragraph text in div${type} at depth ${depth}`, () => {
        const source = `${quote}- b\n${quote.trimEnd()}\n${quote}  :::${type}\n${quote}    ::: |\n${quote}    ${run}\n${quote}  :::\n${quote}  para\n${quote}  ${run}\nlazy\n`
        expect(parse(source).children).toHaveLength(1)
        expect(quotedList(source, depth).items[0]!.children.map(node => node.type)).toEqual(['paragraph', type ? 'admonition' : 'div', 'paragraph'])
        expect(carveToHtml(source)).toContain(run === '```' ? 'lazy</code>' : 'para\n~~~\nlazy')
      })
    }
    it(`admits descendant ${run} code inside a div at depth ${depth}`, () => {
      const source = `${quote}- ::: box\n${quote}  - ${run}\n${quote}    x\n${quote}    ${run}\n${quote}  :::\n- tail\n`
      expect(parse(source).children.map(node => node.type)).toEqual(['block_quote', 'list'])
      expect(carveToHtml(source)).toContain('<pre><code>x\n</code></pre>')
    })
    it(`admits a descendant line block with paired ${run} at depth ${depth}`, () => {
      const source = `${quote}- ::: box\n${quote}  - ::: |\n${quote}    ${run}\n${quote}    :::\n${quote}    ${run}\n${quote}    :::\n${quote}    :::bad\n${quote}    :::\n- tail\n`
      expect(parse(source).children).toHaveLength(1)
      expect(carveToHtml(source)).toContain(':::bad\n:::\n- tail')
      expect(carveToHtml(source)).toContain('class="line-block"')
    })
  }
  it(`keeps shifted line-block text literal without a blank at depth ${depth}`, () => {
    const source = `${quote}- b\n${quote}  ::: box\n${quote}    ::: |\n${quote}    \`\`\`\n${quote}  :::\n${quote}  para\n${quote}  \`\`\`\nlazy\n`
    expect(parse(source).children).toHaveLength(1)
    expect(carveToHtml(source)).toContain('lazy</code>')
  })
}

function quotedList(source: string, depth: number): List {
  let node: BlockNode | undefined = parse(source).children[0]
  for (let n = 0; n < depth; n++) {
    if (node?.type !== 'block_quote') throw new Error('missing quote')
    node = node.children[0]
  }
  if (node?.type !== 'list') throw new Error('missing list')
  return node
}

for (const depth of [1, 2]) for (const payload of ['x', '%%%', '```', '- marker', ':::: box']) {
  it(`keeps literal ${payload} from changing the malformed paragraph owner at depth ${depth}`, () => {
    const quote = '> '.repeat(depth)
    const source = `${quote}- ::: |\n${quote}  ${payload}\n${quote}  :::\n${quote}  :::bad\n${quote}  :::\n- tail\n`
    expect(parse(source).children).toHaveLength(1)
    const list = quotedList(source, depth)
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.children.map(node => node.type)).toEqual(['line_block', 'paragraph'])
    expect(carveToHtml(source)).toContain(':::bad\n:::\n- tail')
  })
}

for (const depth of [1, 2]) {
  const quote = '> '.repeat(depth)
  it(`retains an overindented bare colon run inside its hosted div at depth ${depth}`, () => {
    const source = `${quote}- ::: box\n${quote}  a\n${quote}    :::\n- tail\n`
    expect(parse(source).children).toHaveLength(1)
    const list = quotedList(source, depth)
    expect(list.items).toHaveLength(1)
    expect(carveToHtml(source)).toContain('a\n:::\n- tail')
  })
  it(`retains an overindented bare colon run as line-block payload at depth ${depth}`, () => {
    const source = `${quote}- ::: |\n${quote}  a\n${quote}    :::\n${quote}  b\n- tail\n`
    expect(parse(source).children).toHaveLength(2)
    const list = quotedList(source, depth)
    expect(list.items[0]!.children).toHaveLength(1)
    expect(list.items[0]!.children[0]!.type).toBe('line_block')
    expect(carveToHtml(source)).toContain(':::')
  })
  for (const closer of [2, 4]) it(`closes an authored opener at column ${closer}, depth ${depth}`, () => {
    const prefix = `${quote}- a\n${quote}    ::: box\n${quote}    x\n${quote}${' '.repeat(closer)}:::\n`
    expect(carveToHtml(prefix + '- tail\n')).toBe(carveToHtml(prefix) + '\n' + carveToHtml('- tail\n'))
  })
}

it('keeps root colon closer behavior unchanged', () => {
  expect(carveToHtml('::: box\na\n  :::\n- tail\n')).toBe('<div class="box">\n  <p>a\n:::\n- tail</p>\n</div>')
})


for (const depth of [1, 2]) for (const fence of ['%%%', '```']) {
  it(`keeps a colon closer inside a closed ${fence} span as verse at depth ${depth}`, () => {
    const quote = '> '.repeat(depth)
    const prefix = `${quote}- ::: |\n${quote}  ${fence}\n${quote}  :::\n${quote}  [r]: /target\n${quote}  ${fence}\n${quote}  :::\n`
    const source = prefix + '- tail\n'
    expect(parse(source).children).toHaveLength(2)
    expect(quotedList(source, depth).items[0]!.children.map(node => node.type)).toEqual(['line_block'])
    expect(carveToHtml(source)).toContain('[r]: /target')
  })
}

for (const [name, source, html] of [
  ['mismatched literal run', '- ::: |\n  ::::\ntail\n', '<ul>\n  <li>\n    <div class="line-block">\n      <p>::::</p>\n    </div>\n  </li>\n</ul>\n<p>tail</p>'],
  ['unclosed code payload', '> - ::: box\n>   ```\n- tail\n', '<blockquote>\n  <ul>\n    <li>\n      <div class="box">\n        <pre><code></code></pre>\n      </div>\n    </li>\n  </ul>\n</blockquote>\n<ul>\n  <li>tail</li>\n</ul>'],
  ['below-column line after an empty container', '1. ::: box\n  %% c\n  - tail\n', "<ol>\n  <li>\n    <div class=\"box\">\n\n    </div>\n  </li>\n</ol>\n<ul>\n  <li>tail</li>\n</ul>"],
  ['nested mismatched widths', '- :::\n  :::: box\n  :::\n      :::\n   :::\n', '<ul>\n  <li>\n    <div>\n      <div class="box">\n        <div>\n          <p>:::\n:::</p>\n        </div>\n      </div>\n    </div>\n  </li>\n</ul>'],
] as const) it(`preserves reader behavior for ${name}`, () => {
  expect(carveToHtml(source)).toBe(html)
})

for (const depth of [1, 2]) for (const fence of ['%%%', '```', '~~~']) {
  const quote = '> '.repeat(depth)
  it(`retains the malformed paragraph after a closed ${fence} span at depth ${depth}`, () => {
    const source = `${quote}- ::: |\n${quote}  ${fence}\n${quote}  :::\n${quote}  ${fence}\n${quote}  :::\n${quote}  :::bad\n${quote}  :::\n- tail\n`
    expect(parse(source).children).toHaveLength(1)
    expect(quotedList(source, depth).items).toHaveLength(1)
    expect(quotedList(source, depth).items[0]!.children.map(node => node.type)).toEqual(['line_block', 'paragraph'])
    expect(carveToHtml(source)).toContain(':::bad\n:::\n- tail')
  })
  it(`leaves no lazy quote claim after a closed ${fence} span in verse at depth ${depth}`, () => {
    const source = `${quote}- ::: |\n${quote}  ${fence}\n${quote}  :::\n${quote}  ${fence}\n${quote}  x\ntail\n`
    const doc = parse(source)
    expect(doc.children.map(node => node.type)).toEqual(['block_quote', 'paragraph'])
    expect(quotedList(source, depth).items[0]!.children.map(node => node.type)).toEqual(['line_block'])
    expect(carveToHtml(source)).not.toContain('&nbsp;L&nbsp;')
    expect(carveToHtml(source)).toContain('</blockquote>\n<p>tail</p>')
  })
}

for (const mode of ['box', '|']) for (const closer of [2, 4]) for (const quote of ['', '> ', '> > ']) {
  it(`restores malformed paragraph ownership after ${mode} at closer ${closer}, quote ${quote}`, () => {
    const tail = quote === '' ? 'tail' : '- tail'
    const source = `${quote}- a\n${quote}    ::: ${mode}\n${quote}    x\n${quote}${' '.repeat(closer)}:::\n${quote}  :::bad\n${quote}  :::\n${tail}\n`
    expect(parse(source).children).toHaveLength(1)
    expect(carveToHtml(source)).toContain(`:::bad\n:::\n${tail}`)
  })
}

it('preserves a blank boundary after an unfinished line block', () => {
  expect(parse('- ::: |\n  a\n\nb\n').children.map(node => node.type)).toEqual(['list', 'paragraph'])
})

it('preserves authored footnote definition handling under a marker-line div', () => {
  expect(carveToHtml('- ::: box\n    [^r]: note\n  :::\n\n[t][^r]\n')).toBe('<ul>\n  <li>\n    <div class="box">\n\n    </div>\n  </li>\n</ul>\n<p>[t][^r]</p>')
})

for (const quote of ['> ', '> > ']) {
  const depth = quote === '> ' ? 1 : 2
  it(`does not pair literal comment payload across a sibling at depth ${depth}`, () => {
    const source = `${quote}- ::: |\n${quote}  %%%\n${quote}  :::\n${quote}- b\n${quote}  %%%\n${quote}  para\nlazy\n`
    const list = quotedList(source, depth)
    expect(list.items).toHaveLength(2)
    expect(list.items[0]!.children.map(node => node.type)).toEqual(['line_block'])
    expect(carveToHtml(source)).toContain('para\nlazy')
  })
  it(`accepts a real code-span closer at the line-block host base, depth ${depth}`, () => {
    const source = `${quote}- a\n${quote}    ::: |\n${quote}    \`\`\`\n${quote}    :::\n${quote}  \`\`\`\n${quote}  :::\n${quote}  para\nlazy\n`
    const list = quotedList(source, depth)
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.children.map(node => node.type)).toEqual(['paragraph', 'line_block', 'paragraph'])
    expect(carveToHtml(source)).toContain('para\nlazy')
  })
}

for (const fixture of commentDedentFixtures) it(`quoted comment dedent ${fixture.id}`, () => {
  for (const actual of [carveToHtml(fixture.source), renderHtml(parse(fixture.source))]) {
    expect(actual.replace(/>\s+</g, '><').trim()).toBe(fixture.html)
  }
})
