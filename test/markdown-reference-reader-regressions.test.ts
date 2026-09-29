import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  [
    "1. >    > x\n",
    "<ol>\n  <li>\n    <blockquote>\n      <blockquote><p>x</p></blockquote>\n    </blockquote>\n  </li>\n</ol>"
  ],
  [
    "- >   > - y\n  >   >   z\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <ul>\n          <li>y z</li>\n        </ul>\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>"
  ],
  [
    "[a\\]]: /u 'say \"hi\"'\n\n[a\\]]",
    "<p><a href=\"/u\" title=\"say &quot;hi&quot;\">a]</a></p>"
  ],
  [
    "[a\\]]: /u \"ti\\\"tle\"\n\n[a\\]]",
    "<p><a href=\"/u\" title=\"ti&quot;tle\">a]</a></p>"
  ],
  [
    "[foo]: /u '\n# h\n'\n\n[foo]",
    "<p>[foo]: /u '</p>\n<section id=\"h\">\n  <h1>h</h1>\n  <p>'</p>\n  <p>[foo]</p>\n</section>"
  ],
  [
    "[foo]: /u '\n> q\n'\n\n[foo]",
    "<p>[foo]: /u '</p>\n<blockquote><p>q '</p></blockquote>\n<p>[foo]</p>"
  ],
  [
    "[a\\!\\]]: /u\n\n[a!\\]]",
    "<p>[a!]]</p>"
  ],
  [
    "[a\\]]: /one\n[a&#93;]: /two\n\n[a\\]] [a&#93;]",
    "<p><a href=\"/one\">a]</a> <a href=\"/two\">a]</a></p>"
  ],
  [
    "[a\\]]: /u\n\"unterminated\n\n[a\\]]",
    "<p>\"unterminated</p>\n<p><a href=\"/u\">a]</a></p>"
  ],
  [
    "[a\\]]: /u\n\"t\" junk\n\n[a\\]]",
    "<p>\"t\" junk</p>\n<p><a href=\"/u\">a]</a></p>"
  ],
  [
    "[foo]: /u '\n2. x\n'\n\n[foo]",
    "<p><a href=\"/u\" title=\"\n2. x\n\">foo</a></p>"
  ],
  [
    "[foo]: /u '\n* \n'\n\n[foo]",
    "<p><a href=\"/u\" title=\"\n*\n\">foo</a></p>"
  ],
  [
    "[a\\]]: /u (a\\)b)\n\n[a\\]]",
    "<p><a href=\"/u\" title=\"a)b\">a]</a></p>"
  ],
  [
    "[a\\]]: /u (a\\(b)\n\n[a\\]]",
    "<p><a href=\"/u\" title=\"a(b\">a]</a></p>"
  ],
  [
    "[a\\]]: /u (x\\\\)\n\n[a\\]]",
    "<p><a href=\"/u\" title=\"x\\\">a]</a></p>"
  ],
  [
    "[foo]: /u '\n<div>\n'\n\n[foo]",
    "<p>[foo]: /u '</p>\n<div>\n'\n<p>[foo]</p>"
  ],
  [
    "[a\\*b]: /one\n\n[a\\*b\n]: /two\n\n[a\\*b]",
    "<p><a href=\"/one\">a*b</a></p>"
  ],
  [
    "[a\\*b\n]: /one\n\n[a\\*b]: /two\n\n[a\\*b]",
    "<p><a href=\"/one\">a*b</a></p>"
  ],
  [
    "[a&amp;b]: /one\n\n[a&amp;b\n]: /two\n\n[a&amp;b]",
    "<p><a href=\"/one\">a&amp;b</a></p>"
  ],
  [
    "[foo]: /u '\n01. x\n'\n\n[foo]",
    "<p>[foo]: /u '</p>\n<ol>\n  <li>x '</li>\n</ol>\n<p>[foo]</p>"
  ]
])('preserves CommonMark reference and quote boundaries: %s', (source, expected) => {
  const normalize = (html: string) => html.replace(/\s+/g, ' ').trim()
  expect(normalize(carveToHtml(markdownToCarve(source), { smartTypography: 'source' }))).toBe(normalize(expected))
})
