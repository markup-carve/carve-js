import { expect, it } from 'vitest'
import { parse, renderHTML } from '@djot/djot'
import { carveToHtml, djotToCarve } from '../src/index.js'

it.each(["{'a/'", "{'a/'.", "{'a/' b", "{'a/'?", "{'a/')"])('preserves Djot text after a slash in %s', (source) => {
  expect(carveToHtml(djotToCarve(source))).toBe(renderHTML(parse(source)).trim())
})
