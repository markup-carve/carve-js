import { expect, it } from 'vitest'
import { parse, renderHTML } from '@djot/djot'
import { carveToHtml, djotToCarve } from '../src/index.js'

it.each(["{'a/'", "{'a/'.", "{'a/' b", "{'a/'?", "{'a/')"])('preserves Djot text after a slash in %s', (source) => {
  expect(carveToHtml(djotToCarve(source))).toBe(renderHTML(parse(source)).trim())
})

it.each([
  ["{'x 'a/'", '<p>‘x ‘a/’</p>'],
  ["{'x 'a b/'.", '<p>‘x ‘a b/’.</p>'],
])('keeps a plain quote pair in %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toBe(expected)
})

it('keeps an outer plain quote open after an inner pair', () => {
  expect(djotToCarve("{'x 'a 'b' c/'")).toBe("‘x 'a 'b' c/'")
})

it('keeps a plain quote pair across a soft line break', () => {
  expect(carveToHtml(djotToCarve("{'x 'a\nb/'"))).toBe('<p>‘x ‘a\nb/’</p>')
})

it.each(["- 'a\n- {'b/'", "| 'a | {'b/' |\n| --- | --- |"])(
  'clears a plain quote opener at the next block or cell in %s',
  (source) => {
    expect(carveToHtml(djotToCarve(source))).toContain('‘b/‘')
  },
)

it.each(["- 'a\n  c\n- {'b/'", "> - 'a\n> - {'b/'"])(
  'clears a quote opener before a sibling list item in %s',
  (source) => {
    expect(carveToHtml(djotToCarve(source))).toContain('‘b/‘')
  },
)

it.each(["> 'a\n>\n> {'b/'", "::: d\n'a\n:::\n{'b/'"])(
  'does not carry a plain quote opener into the next inline block in %s',
  (source) => {
    expect(carveToHtml(djotToCarve(source))).toContain('‘b/‘')
  },
)
