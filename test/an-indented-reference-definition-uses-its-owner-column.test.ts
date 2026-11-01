import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 S3: a definition at or past its owner's content column is a block,
// including an indented document-level definition after a container ends.
it.each([
  ['document', ' [r]: /url\n\nSee [r][].\n'],
  ['after a nested note', '[^f]: outer\n   [^g]: mid\n  [r]: /url\n\nSee [r][].\n'],
  ['after a note description', '[^f]: b\n* \n  :: t\n  : d\n   [r]: /url\n\nSee [r][].\n'],
  ['after a note caption', '- a\n  [^f]: t\n[^f]: a\n^ cap\n     [r]: /url\n\nSee [r][].\n'],
  ['inside a description item', ':: t\n     ``\n:  - a\n     [r]: /url\n     ```\n\nSee [r][].\n'],
])('registers an indented reference definition in %s', (_label, source) => {
  expect(carveToHtml(source, { positions: true })).toContain('See <a href="/url">r</a>.')
})

it('does not register a definition held by an opaque fence', () => {
  expect(carveToHtml('```\n  [r]: /url\n```\n\nSee [r][].\n', { positions: true }))
    .toContain('See [r][].')
})
