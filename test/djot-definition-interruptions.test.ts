import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-definition-interruptions.json'

function shape(html: string): unknown[] {
  const result: unknown[] = [], pending: Array<[DefaultTreeAdapterMap['node'], number, boolean]> = [[parseFragment(html), 0, false]]
  while (pending.length) {
    const [node, depth, verbatim] = pending.pop()!
    if ('value' in node) {
      const text = verbatim ? node.value : node.value.replace(/[\t\r\n ]+/g, ' ').trim()
      if (text) result.push(['text', depth, text])
    } else if ('attrs' in node) {
      result.push([node.nodeName, depth, node.attrs.filter(a => !['data-delim', 'aria-label', 'data-task-state'].includes(a.name) && !(a.name === 'role' && a.value === 'math') && !(a.name === 'scope' && a.value === 'col')).map(a => [a.name, a.value]).sort()])
    }
    if ('childNodes' in node) for (const child of [...node.childNodes].reverse()) pending.push([child, depth + Number(node.nodeName !== '#document-fragment'), verbatim || node.nodeName === 'pre' || node.nodeName === 'code'])
  }
  return result
}

const termCodeAcrossLines = (source: string) => /`term >\r?\n/.test(source)

test('Djot definition block interruptions preserve Native structure', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    // A Carve term is one line (carve#4861): a code span across a Djot term's lines keeps its text, not the break.
    const termBreak = (html: string) => termCodeAcrossLines(row.source)
      ? html.replace(/<code>([^<]*)<\/code>/g, (_match, code: string) => `<code>${code.replace(/\s+/g, ' ')}</code>`) : html
    expect(shape(termBreak(carveToHtml(result.value))), row.source).toEqual(shape(termBreak(row.html)))
    expect(result.report.diagnostics.filter(d => /empty definition|definition item with an empty term/i.test(d.message)), row.source).toEqual([])
  }
})
