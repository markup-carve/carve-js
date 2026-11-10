/** carve#5855 ruling A results ahead of the pinned spec submodule. */
export const RULED_5855_HTML: ReadonlyMap<string, { reason: string; html: string }> = new Map([
  ['1015-an-own-line-plus-note-fence-keeps-its-trailing-blank', {
    reason: 'carve#5855: an own-line plus fence keeps its payload columns after a blank',
    html: "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>p</p>\n      <pre><code>code\n\n  tail\n\n</code></pre>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
  }],
  ['1016-a-description-s-own-line-plus-fence-keeps-its-trailing-blank', {
    reason: 'carve#5855: an own-line plus fence keeps its payload columns after a blank',
    html: "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>p</p>\n    <pre><code>code\n\n  tail\n\n</code></pre>\n  </dd>\n</dl>\n<p>x</p>",
  }],
])
