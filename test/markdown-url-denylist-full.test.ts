import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown } from '../src/index.js'

const NNBSP = ' '

/**
 * The Markdown target's link and image destinations are resolved by whatever
 * renders that Markdown, so a scheme blanked in HTML and passed through here is
 * not blocked - it is deferred by one step (PART 9 §25, carve#385).
 *
 * A local copy of the denylist listed only the four script/inline-content/local-
 * file schemes, so the twenty OS protocol-handler schemes survived into Markdown
 * in every engine. The set and probe now come from the HTML renderer.
 */
const destinationOf = (src: string): string =>
  (carveToMarkdown(src).match(/\]\(([^)]*)\)/) ?? [, '<none>'])[1] ?? ''

const linkTo = (url: string): string => `[click][a]\n\n[a]: ${url}\n`

describe('the Markdown target applies the full URL denylist', () => {
  it.each([
    ['javascript:alert(1)'],
    ['vbscript:msgbox(1)'],
    ['data:text/html,<script>x</script>'],
    ['file:///etc/passwd'],
    ['ms-msdt:/id PCWDiagnostic'],
    ['search-ms:query=x'],
    ['shell:startup'],
    ['vscode://x'],
    ['jar:http://x!/'],
  ])('blanks %s', (url) => {
    expect(destinationOf(linkTo(url))).toBe('')
  })

  it('blanks a scheme hidden behind Unicode whitespace', () => {
    expect(destinationOf(linkTo(`${NNBSP}javascript:alert(1)`))).toBe('')
  })

  it('agrees with the HTML target, which is the point', () => {
    for (const url of ['ms-msdt:/id', `${NNBSP}javascript:alert(1)`]) {
      const src = linkTo(url)
      expect(carveToHtml(src)).toContain('href=""')
      expect(destinationOf(src)).toBe('')
    }
  })

  it.each([['https://example.com/ok'], ['mailto:a@b.com'], ['tel:+15551234'], ['/relative']])(
    'leaves %s alone',
    (url) => {
      expect(destinationOf(linkTo(url))).toBe(url)
    },
  )
})
