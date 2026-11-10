import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('accepts comment continuations written past a brace on an item marker line (carve#5787)', () => {
  expect(carveToHtml('- > {% a\n  >  b\n  >  z %}\n')).toBe(
    '<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>',
  )
})

it('keeps a continuation at the brace column literal (carve#5787)', () => {
  expect(carveToHtml('- > {% a\n  > b\n  > z %}\n')).toContain('<p>{% a\nb\nz %}</p>')
})

it('uses the same source frame when an outer quote precedes the item (carve#5787)', () => {
  const wrapped = '> - > {% a\n>   >  b\n>   >  z %}\n'
  const inline = '> - > {% a b z %}\n'
  expect(carveToHtml(wrapped)).toBe(carveToHtml(inline))
})

it('keeps an outer quote indent shift out of the inner run comparison (carve#5787)', () => {
  expect(carveToHtml('> - {% a\n  >  b %}\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>{% a\nb %}</li>\n  </ul>\n</blockquote>',
  )
  expect(carveToHtml('  > - {% a\n>    b %}\n')).toBe(
    '<blockquote>\n  <ul>\n    <li></li>\n  </ul>\n</blockquote>',
  )
})

it('does not count a new quote prefix as continuation indentation (carve#5787)', () => {
  expect(carveToHtml('- {% a\n  > b %}\n')).toBe(
    '<ul>\n  <li>{% a\n    <blockquote><p>b %}</p></blockquote>\n  </li>\n</ul>',
  )
})

it('does not count a surviving outer quote prefix as indentation (carve#5787)', () => {
  expect(carveToHtml('> > - {% a\n>  b %}\n')).toBe(
    '<blockquote>\n  <blockquote>\n    <ul>\n      <li>{% a\nb %}</li>\n    </ul>\n  </blockquote>\n</blockquote>',
  )
})

it('accepts an attribute run continued past its brace in a marker-line quote (carve#5787)', () => {
  expect(carveToHtml('- > {#i\n  >  .y}\n')).toBe(carveToHtml('- > {#i .y}\n'))
  expect(carveToHtml('- > {#i\n  > .y}\n')).toContain('{<span class="tag">')
})

it('measures a note-head run in a marker-line quote from the note body (carve#5787)', () => {
  const inline = carveToHtml('- > [^q]: {%c %}\n\nx[^q]\n')
  expect(carveToHtml('- > [^q]: {%c\n  >    %}\n\nx[^q]\n')).toBe(inline)
  expect(carveToHtml('- > [^q]: {%c\n  >        %}\n\nx[^q]\n')).toBe(inline)
  expect(carveToHtml('- > [^q]: {%c\n  >  %}\n\nx[^q]\n')).toContain('{%c\n%}')
  expect(carveToHtml('- > [^q]: {#i\n  >    .y}\n\nx[^q]\n')).toBe(carveToHtml('- > [^q]: {#i .y}\n\nx[^q]\n'))
  expect(carveToHtml('- > > [^q]: {#i\n  > >    .y}\n\nx[^q]\n')).toBe(carveToHtml('- > > [^q]: {#i .y}\n\nx[^q]\n'))
})
