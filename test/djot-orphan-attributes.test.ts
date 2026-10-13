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
  const { default: controls } = await import('./fixtures/djot-root-attribute-boundaries.json')
  const { parseFragment } = await import('parse5')
  type HtmlNode = import('parse5').DefaultTreeAdapterMap['node']
  const shape = (node: HtmlNode): unknown => {
    if ('value' in node) {
      let value = node.value.replace(/[\t\r\n ]+/g, ' ')
      const parent = node.parentNode
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
      expect(list.items.map(item => ({ checked: item.checked, classes: item.attrs?.classes ?? [] }))).toEqual(
        nativeAst.children[0]!.children.map(item => ({ checked: item.checkbox === 'checked', classes: 'attributes' in item ? item.attributes?.class?.split(' ') ?? [] : [] }))
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
