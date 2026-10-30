import { expect, it } from 'vitest'
import { parse as parseDjot, renderHTML } from '@djot/djot'
import { parse, renderHtml, djotToCarve } from '../src/index.js'
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'

const structure = (html: string): unknown => {
  const walk = (node: DefaultTreeAdapterTypes.ChildNode): unknown[] => {
    if (!('childNodes' in node)) return []
    const children = node.childNodes.flatMap(walk)
    if ('tagName' in node && ['ul', 'ol', 'li'].includes(node.tagName)) {
      const empty = node.tagName === 'li' && !node.childNodes.some((child: DefaultTreeAdapterTypes.ChildNode) =>
        child.nodeName !== 'input' && (child.nodeName !== '#text' || ('value' in child && child.value.trim() !== '')),
      )
      return [{ tag: node.tagName, empty, children }]
    }
    return children
  }
  return parseFragment(html).childNodes.flatMap(walk)
}

it.each([
  '- a\n-\n- c\n',
  '-\n- b\n-\n',
  '* a\n*\n* c\n',
  '+ a\n+\n+ c\n',
  '1. a\n2.\n3. c\n',
  '1) a\n2)\n3) c\n',
  'a. a\nb.\nc. c\n',
  'A) a\nB)\nC) c\n',
  'i. a\nii.\niii. c\n',
  'I) a\nII)\nIII) c\n',
  '(1) a\n(2)\n(3) c\n',
  '- [ ] a\n- [ ]\n- [x] c\n',
  '- [X]\n- [ ] b\n- [x]\n',
  '- a\n\n-\n\n- c\n',
  '- a\n  - b\n  -\n  - d\n- e\n',
  '> - a\n> -\n> - c\n',
  '> -\n>\n> - b\n>\n> -\n',
  '> 1. a\n> 2.\n> 3. c\n',
  '- a\n  1. b\n  2.\n  3. d\n- e\n',
  'text\n-\ntext\n',
  '-\ntext\n',
  '1.\ntext\n',
  '> -\n> text\n',
  '- a\n-\ntext\n',
  '- a\n  -\n\n  - c\n- d\n',
  '- [ ]\n  text\n',
  'text\n1.\ntext\n',
  'text\na.\ntext\n',
  '-\n\n  child\n',
  '-\n  -\n',
  '```\n-\n1.\n```\n',
  '- \n- b\n- \n',
  '- a\n\n\n\n-\n\n\n\n- c\n',
  '- a\n  -\n  child\n',
  '> text\n> 1.\n',
  'text\n> -\n',
  '1. [ ]\n2. [x]\n',
  '-  [ ]\n-  [x]\n',
])('preserves Djot list structure for %j', source => {
  expect(structure(renderHtml(parse(djotToCarve(source))))).toEqual(structure(renderHTML(parseDjot(source))))
})

it.each([
  ['- a\n-\n- c\n', '- a\n- {empty}\n- c\n'],
  ['-', '- {empty}'],
  ['1.', '1. {empty}'],
  ['a.', 'a. {empty}'],
])('writes %j as %j', (source, expected) => {
  expect(djotToCarve(source)).toBe(expected)
})

it('keeps a lazy continuation after an initially empty item body', () => {
  const source = '-\n  x\ny\n'
  const normalize = (html: string) => html.replace(/>\s+/g, '>').replace(/\s+</g, '<').trim()
  expect(normalize(renderHtml(parse(djotToCarve(source))))).toBe(normalize(renderHTML(parseDjot(source))))
})
