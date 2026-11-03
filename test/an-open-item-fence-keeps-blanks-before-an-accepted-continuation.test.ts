import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 O1 and PART 9 §17 L3: an accepted marker ends the fence after
// its buffered blank payload, then attaches the next flush-left block.
const ruledHtml = new Map<string, string>([
  [
    "- ```\n\n+\n- s\n",
    "<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n  <li><p>s</p></li>\n</ul>"
  ],
  [
    "- - ```\n\n\n  +\ntail\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>\n\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "1. - ```\n     x\n\n\n   +\ntail\n",
    "<ol>\n  <li>\n    <ul>\n      <li>\n        <pre><code>x\n\n\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ol>\n<p>tail</p>"
  ],
  [
    "- - - ```\n      x\n\n\n    +\ntail\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code>x\n\n\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
  ],
  [
    "- - ```\n\n\n  +\n## heading\n",
    "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>\n\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<section id=\"heading\">\n  <h2>heading</h2>\n</section>"
  ]
])

describe('an open item fence keeps blanks before an accepted continuation', () => {
  const cases = [
    { lead: '- ```', body: '', marker: '+', follower: 'tail', blanks: 1, code: true },
    { lead: '- ```', body: '  x\n', marker: '+', follower: '> q', blanks: 2, code: true },
    { lead: '- ```', body: '', marker: '+', follower: '- s', blanks: 1, code: true },
    { lead: '- - ```', body: '', marker: '  +', follower: 'tail', blanks: 2, code: true },
    { lead: '- - ```', body: '    x\n', marker: '  +', follower: '> q', blanks: 1, code: true },
    { lead: '- [ ] ```', body: '', marker: '+', follower: 'tail', blanks: 2, code: true },
    { lead: '- 1. ```', body: '', marker: '  +', follower: '> q', blanks: 1, code: true },
    { lead: '1. - ```', body: '     x\n', marker: '   +', follower: 'tail', blanks: 2, code: true },
    { lead: '- - - ```', body: '', marker: '    +', follower: 'tail', blanks: 1, code: true },
    { lead: '- - - ```', body: '      x\n', marker: '    +', follower: 'tail', blanks: 0, code: true },
    { lead: '- - - ```', body: '      x\n', marker: '    +', follower: 'tail', blanks: 2, code: true },
    { lead: '- - - - ```', body: '        x\n', marker: '      +', follower: 'tail', blanks: 0, code: true },
    { lead: '- ```=html', body: '', marker: '+', follower: 'tail', blanks: 2, code: false },
    { lead: '- - ```=html', body: '    x\n', marker: '  +', follower: '> q', blanks: 1, code: false },
    { lead: '10. - ```=html', body: '', marker: '    +', follower: '> q', blanks: 2, code: false },
    { lead: '- - - ```=html', body: '      x\n', marker: '    +', follower: 'tail', blanks: 2, code: false },
    { lead: '- - - ```=html', body: '      x\n', marker: '    +', follower: 'tail', blanks: 0, code: false },
    { lead: '- - ```', body: '', marker: '  +', follower: '## heading', blanks: 2, code: true },
    { lead: '- - ```', body: '', marker: '  +', follower: '| a |\n| - |\n| b |', blanks: 1, code: true },
    { lead: '- - ```=html', body: '', marker: '  +', follower: '~~~\ncode\n~~~', blanks: 2, code: false },
    { lead: '- - ```=html', body: '', marker: '  +', follower: '---', blanks: 1, code: false },
  ] as const

  for (const { lead, body, marker, follower, blanks, code } of cases) {
    it(`${lead} with ${blanks} blank(s) and ${follower}`, () => {
      const source = `${lead}\n${body}${'\n'.repeat(blanks)}${marker}\n${follower}\n`
      const html = carveToHtml(source)
      if (ruledHtml.has(source)) {
        expect(html).toBe(ruledHtml.get(source))
        return
      }
      if (marker.startsWith(' ') && blanks === 2 && code) {
        expect(html).toContain(`<pre><code>${body.trim() ? 'x\n' : ''}${'\n'.repeat(blanks)}</code></pre>`)
        expect(html).toContain(follower === 'tail' ? '<p>+\ntail</p>' : '<p>+</p>')
        return
      }
      if (code) expect(html).toContain(`<pre><code>${body.trim() ? 'x\n' : ''}${'\n'.repeat(blanks)}</code></pre>`)
      else expect(html).toContain(body.trim() ? `x${'\n'.repeat(blanks)}` : '\n'.repeat(blanks))
      const attached = follower === 'tail' ? 'tail' : follower === '- s' ? '<p>+\n- s</p>'
        : follower === '> q' ? '<blockquote><p>q</p></blockquote>'
          : follower === '## heading' ? '<h2>heading</h2>'
            : follower.startsWith('|') ? '<table>'
              : follower.startsWith('~~~') ? '<pre><code>code\n</code></pre>' : '<hr>'
      expect(html).toContain(attached)
      if (lead.startsWith('- - - ') && marker === '+') {
        const followerAt = html.indexOf(attached)
        const leafOpen = html.lastIndexOf('<li', followerAt)
        expect(leafOpen).toBeGreaterThan(-1)
        expect(followerAt).toBeLessThan(html.indexOf('</li>', leafOpen))
      }
    })
  }
})
