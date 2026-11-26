import { expect, it } from 'vitest'
import { format, parse, render, writeWithDiagnostics } from '../src/index.ts'

// carve#6444 (ruled option b): C2-B-224 makes `\|` a literal pipe in a cell before inline parsing, so a shortcut's
// key there holds `|` (C2-I-072), while a definition label keeps its backslash (C2-I-079).
it('C2-B-224, C2-I-072: a shortcut in a cell is keyed after the pipe escape is resolved', () => {
  expect(render('| [r\\|s] |\n\n[r|s]: /u\n')).toContain('<td><a href="/u">r|s</a></td>')
  expect(render('| ![r\\|s] |\n\n[r|s]: /u\n')).toContain('<td><img src="/u" alt="r|s"></td>')
  expect(render('| [a [r\\|s]] |\n\n[r|s]: /u\n')).toContain('<td>[a <a href="/u">r|s</a>]</td>')
})

it('C2-I-079: a definition label keeps its backslash, so the shortcut in a cell does not find it', () => {
  const source = '| [r\\|s] |\n\n[r\\|s]: /u\n'
  expect(render(source)).toContain('<td>[r|s]</td>')
  expect(JSON.stringify(parse(source))).not.toContain('"type":"link"')
})

it('C2-W-088: text that would read as such a shortcut keeps its escape', () => {
  const source = '| \\[r\\|s] |\n\n[r|s]: /u\n'
  expect(format(source)).toBe(source)
  const written = writeWithDiagnostics(parse(source))
  expect(written.diagnostics).toEqual([])
  expect(render(written.source)).toContain('<td>[r|s]</td>')
})

it('C2-B-224: in a code span of the text `\\|` stays two characters, for a shortcut and a collapsed reference', () => {
  expect(render('| [`\\|`] |\n\n[`\\|`]: /u\n')).toContain('<td><a href="/u"><code>\\|</code></a></td>')
  expect(render('| [`\\|`] |\n\n[`|`]: /u\n')).toContain('<td>[<code>\\|</code>]</td>')
  expect(render('| [`\\|`][] |\n\n[`\\|`]: /u\n')).toContain('<td><a href="/u"><code>\\|</code></a></td>')
  expect(render('| [`a` \\| `b`] |\n\n[`a` | `b`]: /u\n')).toContain('<td><a href="/u"><code>a</code> | <code>b</code></a></td>')
})

it('C2-B-224, C2-I-074: an image text in a cell is its alt, so its key holds `|` in a code span too', () => {
  expect(render('| ![`\\|`] |\n\n[`|`]: /u\n')).toContain('<td><img src="/u" alt="`|`"></td>')
  expect(render('| ![`\\|`][] |\n\n[`|`]: /u\n')).toContain('<td><img src="/u" alt="`|`"></td>')
  const source = '| ![`\\|`][] |\n\n[`|`]: /u\n'
  expect(format(source)).toBe(source)
  expect(writeWithDiagnostics(parse(source)).diagnostics).toEqual([])
})

it('C2-B-224, C2-I-005: backticks in a braced comment are no code span, so its `\\|` is a literal pipe in the key', () => {
  expect(render('| [a{% `\\|` %}b] |\n\n[a{% `|` %}b]: /u\n')).toContain('<td><a href="/u">ab</a></td>')
  expect(render('| [a{% `\\|` %}b][] |\n\n[a{% `|` %}b]: /u\n')).toContain('<td><a href="/u">ab</a></td>')
  expect(render('| [a `\\|` \\| b] |\n\n[a `\\|` | b]: /u\n')).toContain('<td><a href="/u">a <code>\\|</code> | b</a></td>')
})

it('C2-B-224: an attribute block on a code span is not raw, so its `\\|` is a literal pipe in the key', () => {
  const source = '| [`c`{title="a\\|b"}][] |\n\n[`c`{title="a|b"}]: /u\n'
  expect(render(source)).toContain('<td><a href="/u"><code title="a|b">c</code></a></td>')
  expect(render('| [`c`{title="a\\|b"}] |\n\n[`c`{title="a|b"}]: /u\n')).toContain('<a href="/u">')
})
