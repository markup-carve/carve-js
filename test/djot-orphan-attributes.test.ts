import type { Doc } from '@djot/djot'
import { expect, test } from 'vitest'
import { djotToCarve, carveToHtml, parse } from '../src/index.js'
import pending from './fixtures/djot-pending-attributes.json'

test.each([
  ['{#id} at beginning\n', '<p> at beginning</p>'],
  ['After {#id} space\n{.class}\n', '<p>After  space\n</p>'],
  ['not a [span] {#id}.\n', '<p>not a [span] .</p>'],
  ['{#id .class}\n\nA paragraph\n', '<p id="id" class="class">A paragraph</p>'],
  ['{.a}\n{.b}\n\npara', '<p class="a b">para</p>'],
  ['{.a}\n{.b}', ''],
  ['{.a}\n{.b}\n\n[r]: u\n\n[x][r]', '<p><a href="u" class="a b">x</a></p>'],
  ['{.a}\n{.b}\n[r]: u\n\n[x][r]', '<p><a href="u" class="a b">x</a></p>'],
  ['{.a}\n\n{.b}\n[r]: u\n\n[x][r]', '<p><a href="u" class="a b">x</a></p>'],
  ['[span]{#id}', '<p><span id="id">span</span></p>'],
  ['`x`{.c}', '<p><code class="c">x</code></p>'],
  ['<http://x.y>{.c}', '<p><a href="http://x.y" class="c">http://x.y</a></p>'],
])('Djot attribute ownership: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(expected)
})

test.each(['```\nx\n```', '::: box\nx\n:::', '***', '| a |', '[r]: /u'])('keeps pending attributes after a closed block: %s', block => {
   expect(carveToHtml(djotToCarve(`${block}\n{.c}\npara`))).toContain('<p class="c">para</p>')
 })

test.each([
  [
    "> {.a}\n> {.b}\n>\n> para",
    "<blockquote><p class=\"a b\">para</p></blockquote>"
  ],
  [
    "> {.a}\n> {.b}\n\npara",
    "<blockquote></blockquote><p class=\"a b\">para</p>"
  ],
  [
    "{.a}\n> {.b}\n\n",
    "<blockquote class=\"a\"></blockquote>"
  ],
  [
    "{.a}\n> {.b}\n>\n> para",
    "<blockquote class=\"a\"><p class=\"b\">para</p></blockquote>"
  ],
  [
    "```\n{.a}\n{.b}\n\npara\n```",
    "<pre><code>{.a}\n{.b}\n\npara\n</code></pre>"
  ]
])('keeps the container of a pending attribute run: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source)).trim().replace(/>\s+</g, '><')).toBe(expected)
})

test('matches native Djot block attribute boundaries', async () => {
  const { default: fixture } = await import('./fixtures/djot-root-attribute-boundaries.json')
  const controls = fixture as { source: string; html: string; nativeAst?: Doc }[]
  const { parseFragment } = await import('parse5')
  type HtmlNode = import('parse5').DefaultTreeAdapterMap['node']
  const shape = (node: HtmlNode): unknown => {
    if ('value' in node) {
      const parent = node.parentNode
      let ancestor = parent
      while (ancestor && ancestor.nodeName !== 'code' && ancestor.nodeName !== 'pre') ancestor = 'parentNode' in ancestor ? ancestor.parentNode : null
      let value = ancestor ? node.value : node.value.replace(/[\t\r\n ]+/g, ' ')
      if (parent && 'attrs' in parent && parent.attrs.some(attr => attr.name === 'role' && attr.value === 'doc-backlink')) value = value.replace(/\uFE0E/g, '')
      if (parent && ['p', 'li', 'blockquote', 'td', 'th'].includes(parent.nodeName)) {
        const children = parent.childNodes.filter(child => !('value' in child && /^[\t\r\n ]*$/.test(child.value)))
        if (children[0] === node) value = value.replace(/^ /, '')
        if (children.at(-1) === node) value = value.replace(/ $/, '')
      }
      return value
    }
    const children = 'childNodes' in node ? node.childNodes.filter(child => !(['#document-fragment', 'section', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr'].includes(node.nodeName) && 'value' in child && /^[\t\r\n ]*$/.test(child.value))).map(shape) : []
    if (node.nodeName === 'thead' || node.nodeName === 'tbody') return children
    const attrs = 'attrs' in node ? node.attrs.filter(attr => !(attr.name === 'scope' && attr.value === 'col') && !['data-delim', 'data-task-state', 'aria-label'].includes(attr.name)).map(attr => [attr.name, attr.value]).sort() : []
    return [node.nodeName, attrs, children.flatMap(child => Array.isArray(child) && Array.isArray(child[0]) ? child : [child])]
  }
  const failures: unknown[] = []
  for (const { source, html, nativeAst } of controls) {
    const converted = djotToCarve(source)
    if (nativeAst) {
      const document = parse(converted)
      const list = document.children[0]!
      expect(list.type).toBe('list')
      if (list.type !== 'list') continue
      const nativeList = nativeAst.children[0]!
      if (nativeList.tag !== 'bullet_list' && nativeList.tag !== 'ordered_list' && nativeList.tag !== 'task_list') throw new Error('Native control must start with a list')
      const nativeQuote = nativeList.children[0]?.children[0]
      if (nativeQuote?.tag === 'block_quote') {
        expect(list.items).toHaveLength(1)
        const quote = list.items[0]!.children[0]!
        expect(quote.type).toBe('block_quote')
        if (quote.type !== 'block_quote') continue
        expect(quote.children.map(child => ({ type: child.type, classes: child.attrs?.classes ?? [] }))).toEqual(
          nativeQuote.children.map(child => ({ type: child.tag === 'para' ? 'paragraph' : child.tag, classes: 'attributes' in child ? child.attributes?.class?.split(' ') ?? [] : [] }))
        )
        expect(carveToHtml(converted)).toContain('<p class="x">para</p>')
        continue
      }
      if (nativeList.tag !== 'task_list') throw new Error('Native checkbox control must use a task list')
      expect(list.items.map(item => ({ checked: item.checked, classes: item.attrs?.classes ?? [] }))).toEqual(
        nativeList.children.map(item => ({ checked: item.checkbox === 'checked', classes: 'attributes' in item ? item.attributes?.class?.split(' ') ?? [] : [] }))
      )
      if (source.includes('_c_')) expect(carveToHtml(converted)).toContain('<pre><code>_c_\n</code></pre>')
      continue
    }
    const actual = shape(parseFragment(carveToHtml(converted)))
    const expected = shape(parseFragment(html))
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ source, converted, actual, expected })
  }
  expect(failures).toEqual([])
})

const blockHtml = (html: string): string => html.replace(/<\/?tbody>/g, '').replace(/\s+/g, ' ').replace(/> | </g, value => value.trim()).trim()

test.each(pending)('preserves pending block attributes: $source', ({ source, html }) => {
  expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(html))
})

test('keeps a long pending value through chained quote exits', () => {
  const value = 'v'.repeat(32768)
  const classes = Array.from({ length: 63 }, (_, index) => `c${index}`)
  const source = '> '.repeat(64) + `{title="${value}"}\n` + classes.map((name, index) => '> '.repeat(63 - index) + `{.${name}}\n`).join('') + '\nword'
  const imported = djotToCarve(source)
  expect(imported.split(value)).toHaveLength(2)
  expect(imported.length).toBeLessThan(source.length * 2)
  expect(carveToHtml(imported)).toContain(`<p title="${value}" class="${classes.join(' ')}">word</p>`)
})

test('returns pending item attributes when a footnote closes', () => {
  const converted = djotToCarve('[^n]: - x\n\n        {.a}\n\np[^n]')
  const html = carveToHtml(converted).replace(/>\s+</g, '><')
  expect(converted).not.toContain('\0')
  expect(html).toContain('<p class="a">p<a')
  expect(html).toContain('<ul><li><p>x</p></li></ul>')
})

test('keeps a task list opened on a referenced footnote head', () => {
  const converted = djotToCarve('[^n]: - [ ] a\n      - [ ] b\n\nx[^n]')
  const html = carveToHtml(converted)
  expect(converted).not.toContain('\0')
  expect(html.match(/<ul(?: |>)/g)).toHaveLength(1)
  expect(html.match(/type="checkbox"/g)).toHaveLength(2)
})

test('returns nested footnote item attributes before the parent fence', () => {
  const converted = djotToCarve('[^a]: - x\n\n      [^b]: - y\n\n              {.c}\n\n      ```\n      z\n      ```\n\np[^a] q[^b]')
  const html = carveToHtml(converted)
  expect(converted).not.toContain('\0')
  expect(html).toContain('<pre class="c"><code>z\n</code></pre>')
  expect(html).not.toContain('<p class="c">')
})

test('keeps one literal quote marker in a footnote paragraph', () => {
  const html = carveToHtml(djotToCarve('[^n]: > a\n      > >\n\nx[^n]')).replace(/>\s+</g, '><')
  expect(html).toContain('<blockquote><p>a\n&gt;</p></blockquote>')
})
