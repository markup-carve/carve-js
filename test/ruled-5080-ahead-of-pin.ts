/** Current carve#5080 results ahead of the pinned spec submodule. */
export const RULED_5080_HTML: ReadonlyMap<string, { reason: string; html: string }> = new Map([
  [
    "253-an-inline-attribute-block-does-not-span-lines-but-an-attribute-line-does-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.a\n.b}</p>\n<p>paragraph</p>"
    }
  ],
  [
    "274-a-quoted-attribute-value-stops-at-the-newline-4",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.a\n.b}</p>\n<p>paragraph</p>"
    }
  ],
  [
    "564-a-line-final-run-of-spaces-and-tabs-is-dropped-before-the-line-is-read",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.a\n.b}</p>\n<p>paragraph</p>"
    }
  ],
  [
    "564-a-line-final-run-of-spaces-and-tabs-is-dropped-before-the-line-is-read-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.a\n.b}</p>\n<p>paragraph</p>"
    }
  ],
  [
    "253-an-inline-attribute-block-does-not-span-lines-but-an-attribute-line-does-3",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{\n.a}</p>\n<p>first</p>\n<p>{.b\n}</p>\n<p>second</p>"
    }
  ],
  [
    "329-a-floating-attribute-is-scoped-to-the-container-that-holds-it-6",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>d\n{.k\n#x}\ntail</dd>\n</dl>"
    }
  ],
  [
    "428-a-wrapped-attribute-line-leaves-no-paragraph-open",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>{.a\n.b}\ntail</li>\n</ul>"
    }
  ],
  [
    "428-a-wrapped-attribute-line-leaves-no-paragraph-open-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>prose\n{.a\n.b}\ntail</li>\n</ul>"
    }
  ],
  [
    "458-a-wrapped-attribute-block-ends-at-its-quote-and-reaches-no-line-below-it",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<blockquote>\n  <blockquote><p>q\n{.k\n#x}\ntail</p></blockquote>\n</blockquote>"
    }
  ],
  [
    "458-a-wrapped-attribute-block-ends-at-its-quote-and-reaches-no-line-below-it-3",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<blockquote>\n  <blockquote><p>q\n{.k\n#x}\nafter</p></blockquote>\n</blockquote>"
    }
  ],
  [
    "650-a-wrapped-attribute-line-interrupts-like-a-one-line-attribute-line",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n}</li>\n</ul>\n<pre><code>y\n</code></pre>"
    }
  ],
  [
    "650-a-wrapped-attribute-line-interrupts-like-a-one-line-attribute-line-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n.d}\npara</li>\n</ul>"
    }
  ],
  [
    "650-a-wrapped-attribute-line-interrupts-like-a-one-line-attribute-line-4",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>d\n{.c\n}\npara</dd>\n</dl>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-5",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>d\n{.c\n}\npara</dd>\n</dl>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n}\npara</li>\n</ul>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n}\npara</li>\n</ul>"
    }
  ],
  [
    "793-an-indented-attribute-block-that-wraps-across-lines-is-an-attribute-line-5",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n}\npara</li>\n</ul>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-3",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n.d}\npara</li>\n</ul>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-4",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li><p>a</p>\n    <p>{.c\n}\npara</p>\n  </li>\n</ul>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-6",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b\n{.c\n}\npara</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-7",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n{.c\n}\npara</li>\n    </ul>\n  </dd>\n</dl>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-8",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <ul>\n      <li>a\n{.c\n}\npara</li>\n    </ul>\n  </dd>\n</dl>"
    }
  ],
  [
    "653-a-wrapped-attribute-line-opened-at-a-container-s-column-is-one-construct-9",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<blockquote>\n  <ul>\n    <li>a\n{.c\n}\npara</li>\n  </ul>\n</blockquote>"
    }
  ],
  [
    "740-lazy-quote-owners",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<blockquote><p>{c\n}\na</p></blockquote>"
    }
  ],
  [
    "787-a-wrapped-attribute-opener-indented-in-a-body-is-an-attribute-line",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>d\n{c\n}\na</dd>\n</dl>"
    }
  ],
  [
    "787-a-wrapped-attribute-opener-indented-in-a-body-is-an-attribute-line-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>d\n{c\n}</dd>\n</dl>"
    }
  ],
  [
    "787-a-wrapped-attribute-opener-indented-in-a-body-is-an-attribute-line-3",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>d\n{.c\n}\npara</li>\n</ul>"
    }
  ],
  [
    "787-a-wrapped-attribute-opener-indented-in-a-body-is-an-attribute-line-4",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n}\n}</li>\n</ul>"
    }
  ],
  [
    "792-a-glued-attribute-run-is-one-physical-line-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.a}{.b\n}\np</p>"
    }
  ],
  [
    "792-a-glued-attribute-run-is-one-physical-line-3",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.a\n}{.b}\np</p>"
    }
  ],
  [
    "792-a-glued-attribute-run-is-one-physical-line-4",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{k=\"\"}{c\n}</p>"
    }
  ],
  [
    "792-a-glued-attribute-run-is-one-physical-line-5",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.a\n}\np</p>"
    }
  ],
  [
    "793-an-indented-attribute-block-that-wraps-across-lines-is-an-attribute-line-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>a\n{.c\n}\npara</p>"
    }
  ],
  [
    "793-an-indented-attribute-block-that-wraps-across-lines-is-an-attribute-line-4",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p>{.c\n}\npara</p>"
    }
  ],
  [
    "793-an-indented-attribute-block-that-wraps-across-lines-is-an-attribute-line-6",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>a\n{.c\n}\npara</li>\n</ul>"
    }
  ],
  [
    "793-an-indented-attribute-block-that-wraps-across-lines-is-an-attribute-line-7",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>a\n{.c\n}\npara</dd>\n</dl>"
    }
  ],
  [
    "793-an-indented-attribute-block-that-wraps-across-lines-is-an-attribute-line-8",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<blockquote><p>a\n{.c\n}\npara</p></blockquote>"
    }
  ],
  [
    "864-a-wrapped-attribute-at-a-footnote-body-s-column-is-one-construct",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>d\n{.c\n}\nx<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "864-a-wrapped-attribute-at-a-footnote-body-s-column-is-one-construct-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>d\n{.c\n}\nx</li>\n</ul>"
    }
  ],
  [
    "922-a-wrapped-attribute-lead-is-invisible-to-list-looseness",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li><p>{x\ny}</p>\n    <p>b</p>\n  </li>\n  <li><p>a</p></li>\n</ul>"
    }
  ],
  [
    "922-a-wrapped-attribute-lead-is-invisible-to-list-looseness-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ol>\n  <li><p>{x\ny}</p>\n    <p>b</p>\n  </li>\n  <li><p>a</p></li>\n</ol>"
    }
  ],
  [
    "928-a-multi-line-paragraph-of-only-braced-comments-is-an-invisible-line-2",
    {
      "reason": "carve#5080 continuation columns, ahead of the pinned spec",
      "html": "<ul>\n  <li>{% c\nd %}\n    Body.\n  </li>\n</ul>"
    }
  ],
  [
    "650-a-wrapped-attribute-line-interrupts-like-a-one-line-attribute-line-3",
    {
      "reason": "carve#5080 supersedes the prior wrapped brace reading",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>{.c\n}\n~~~\ny\n~~~</p>"
    }
  ],
  [
    "821-an-attribute-run-after-a-lone-plus-leads-a-sublist-at-the-content-column-2",
    {
      "reason": "carve#5080 supersedes the prior wrapped brace reading",
      "html": "<ul>\n  <li>a\n    {x\ny}\n- c\n  </li>\n</ul>"
    }
  ]
])
