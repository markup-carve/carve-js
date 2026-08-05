import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToHtml, carveToMarkdown, carveToPlainText } from '../src/index.js'

/*
 * The ANSI target blanks a destination PART 9 §25 denies.
 *
 * §25 binds "EVERY TARGET THAT EMITS A RESOLVABLE URL, not only to the HTML
 * renderer", and gives the reason: a scheme blanked in one target and passed
 * through in another is not blocked, it is deferred by one step. The ANSI writer
 * printed the destination verbatim in its parenthetical - `click
 * (javascript:alert(1))` - in all three engines, where Markdown already emitted
 * `[click]()`. Every current terminal emulator autolinks a URL in its output and
 * hands it to the OS handler on click, which is that one step (carve#765).
 *
 * THE DESTINATION IS BLANKED, NOT THE PARENTHETICAL DROPPED. §25 says to emit an
 * EMPTY value; the empty parenthetical distinguishes "withheld" from "the author
 * wrote none", and it is what the issue proposed.
 *
 * THE LINK TEXT IS NOT TOUCHED, in this or any other target. A denied AUTOLINK
 * has the URL as its text, so `<javascript:alert(1)>` still shows those
 * characters - HTML shows them too, inside `<a href="">`, and so do Markdown and
 * plain text. Blanking there would edit the author's words rather than a
 * destination, and the last case below pins that it does not happen.
 *
 * IMAGES were never affected: the ANSI writer prints `[img: alt]` and no
 * destination at all.
 *
 * ONE HELPER, not a third copy of the denylist. carve#385 was exactly that copy:
 * the Markdown writer's own list of four schemes let the twenty OS
 * protocol-handler schemes through, which §25 calls "not a narrower policy, [but]
 * the same sink one step removed". Markdown's sanitizer now delegates to the
 * shared one, and a case below pins that the two agree destination for
 * destination.
 */

const ESC = String.fromCharCode(27)
const strip = (s: string): string => s.split(new RegExp(`${ESC}\\[[0-9;]*m`, 'g')).join('')
const ansi = (source: string): string => strip(carveToAnsi(source)).trim()

/** Every scheme family §25 names, one per row. */
const DENIED = [
  ['javascript', '[a](javascript:alert(1))'],
  ['vbscript', '[a](vbscript:x)'],
  ['data', '[a](data:text/html,x)'],
  ['file', '[a](file:///etc/passwd)'],
  ['ms-msdt (OS handler)', '[a](ms-msdt:x)'],
  ['search-ms (OS handler)', '[a](search-ms:x)'],
]

describe('the ANSI target and the URL-scheme denylist', () => {
  for (const [name, source] of DENIED) {
    it(`blanks a ${name} destination`, () => {
      expect(ansi(`${source}\n`)).toBe('a ()')
    })
  }

  it('is case-insensitive about the scheme', () => {
    // The denylist is a scheme comparison, and a reader lowercases before
    // resolving. `JAVASCRIPT:` reaching the terminal would defeat the whole check.
    expect(ansi('[a](JAVASCRIPT:alert(1))\n')).toBe('a ()')
  })

  it('makes the same decision as the Markdown target, destination for destination', () => {
    // The invariant of sharing ONE helper, and why a third copy was not written:
    // carve#385 was a local list of four schemes in the Markdown writer letting
    // the twenty OS protocol-handler schemes through. Whatever Markdown blanks,
    // this blanks.
    //
    // Whitespace obfuscation has its own case below - not in an inline
    // destination, which cannot start with whitespace at all, but in a reference
    // DEFINITION, which can.
    const destinations = [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'ms-msdt:x',
      'jar:file:///x',
      'https://ok.test',
      'mailto:x@y.test',
      '/local/path',
    ]
    for (const destination of destinations) {
      const source = `[a](${destination})\n`
      const blankedInMarkdown = carveToMarkdown(source).trim() === '[a]()'
      const blankedInAnsi = ansi(source) === 'a ()'
      expect(blankedInAnsi, `disagreed about ${destination}`).toBe(blankedInMarkdown)
    }
  })

  it('strips obfuscating whitespace before deciding the scheme', () => {
    // The real shape, and the one corpus 121 pins for HTML: an inline `(...)`
    // destination cannot begin with whitespace, so the probe never mattered
    // there - a reference DEFINITION can, and that path reaches this target.
    //
    // A reader ignores the leading U+202F when it decides the scheme, so a check
    // that did not strip it would pass a URL the terminal still resolves.
    const NNBSP = String.fromCharCode(0x202f)
    const source = `[click][a]\n\n[a]: ${NNBSP}javascript:alert(1)\n`

    expect(ansi(source)).toBe('click ()')
    // Markdown already blanked this one, which is how the asymmetry was found.
    expect(carveToMarkdown(source).trim()).toBe('[click]()')
  })

  it('leaves an ordinary destination alone', () => {
    // The boundary, and the one that matters most: this fix must not blank the
    // destinations a terminal reader actually wants to see.
    expect(ansi('[a](https://ok.test)\n')).toBe('a (https://ok.test)')
    expect(ansi('[a](/local/path)\n')).toBe('a (/local/path)')
    expect(ansi('[a](mailto:x@y.test)\n')).toBe('a (mailto:x@y.test)')
  })

  it('still omits the parenthetical for a fragment', () => {
    // Unchanged behavior, pinned because the fix touches the same condition.
    expect(ansi('[a](#section)\n')).toBe('a')
  })

  it('does not add an empty parenthetical to a denied autolink', () => {
    // The trap in this fix. An autolink's text IS its destination, so no
    // parenthetical was ever shown; deciding from the SANITIZED destination
    // instead of the authored one produced `javascript:alert(1) ()`.
    expect(ansi('<javascript:alert(1)>\n')).toBe('javascript:alert(1)')
  })

  it('leaves images alone, which never printed a destination', () => {
    expect(ansi('![i](ms-msdt:x)\n')).toBe('[img: i]')
  })

  it('agrees with the other targets on what is withheld', () => {
    // The property §25 is really about: no target passes the scheme through.
    const source = '[a](javascript:alert(1))\n'
    for (const [target, out] of [
      ['html', carveToHtml(source)],
      ['markdown', carveToMarkdown(source)],
      ['plain', carveToPlainText(source)],
      ['ansi', strip(carveToAnsi(source))],
    ] as const) {
      expect(out, `${target} passed the scheme through`).not.toContain('javascript:')
    }
  })

  it('keeps the Markdown target byte-identical', () => {
    // The Markdown writer's own sanitizer now delegates to the shared one, so
    // its output must not have moved.
    expect(carveToMarkdown('[a](javascript:alert(1))\n\n[b](https://ok.test)\n')).toBe(
      '[a]()\n\n[b](https://ok.test)\n',
    )
  })
})
