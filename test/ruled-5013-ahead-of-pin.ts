/** Current carve#5013 outputs ahead of the pinned spec submodule. */
export const RULED_5013_HTML: ReadonlyMap<string, { reason: string; html: string }> = new Map([
  [
    "226-a-definition-attached-by-a-continuation-marker-is-collected-and-the-item-keeps-no-trace",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n</ul>\n<p>see <a href=\"/u\">t</a></p>"
    }
  ],
  [
    "327-a-continuation-marker-attaches-one-block-and-the-boundary-is-that-block-s-extent-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n  <li>x</li>\n  <li>y</li>\n</ul>"
    }
  ],
  [
    "384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>"
    }
  ],
  [
    "384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x</li>\n</ul>"
    }
  ],
  [
    "384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x\n    <ul>\n      <li>L</li>\n    </ul>\n  </li>\n</ul>\n<p>p</p>"
    }
  ],
  [
    "384-a-continuation-marker-attaches-a-block-only-at-its-owner-s-marker-column",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>"
    }
  ],
  [
    "435-the-continuation-marker-s-column-gate-reaches-every-container-11",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote><p>intro</p></blockquote>\n<p>more</p>"
    }
  ],
  [
    "435-the-continuation-marker-s-column-gate-reaches-every-container-13",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>intro\n    more\n  </li>\n</ul>"
    }
  ],
  [
    "435-the-continuation-marker-s-column-gate-reaches-every-container-16",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "435-the-continuation-marker-s-column-gate-reaches-every-container-17",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "435-the-continuation-marker-s-column-gate-reaches-every-container-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>more</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>intro<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "435-the-continuation-marker-s-column-gate-reaches-every-container-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>intro</p>\n      <p>more<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "435-the-continuation-marker-s-column-gate-reaches-every-container-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>term</dt>\n  <dd>intro</dd>\n</dl>\n<p>more</p>"
    }
  ],
  [
    "436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>flush</p>"
    }
  ],
  [
    "436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>flush</p>"
    }
  ],
  [
    "436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>flush</p>"
    }
  ],
  [
    "437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>flush<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>flush<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<p>flush</p>"
    }
  ],
  [
    "437-a-first-block-marker-in-a-footnote-body-or-a-quote-attaches-only-at-its-marker-column-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<p>flush</p>"
    }
  ],
  [
    "588-a-block-quote-and-a-footnote-body-take-the-first-block-form-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>"
    }
  ],
  [
    "588-a-block-quote-and-a-footnote-body-take-the-first-block-form-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<p>after</p>"
    }
  ],
  [
    "588-a-block-quote-and-a-footnote-body-take-the-first-block-form-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "588-a-block-quote-and-a-footnote-body-take-the-first-block-form-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "588-a-block-quote-and-a-footnote-body-take-the-first-block-form-8",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code>x\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n  <li>y</li>\n</ul>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            x\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>\n\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code>x\n\n\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ol>\n      <li>\n        <pre><code>\n\n</code></pre>\n      </li>\n    </ol>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-8",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> \n        <pre><code class=\"language-js\">    x\n\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code>x\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "627-a-refused-marker-leaves-an-open-fence-s-blank-payload-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x</p>"
    }
  ],
  [
    "627-a-refused-marker-leaves-an-open-fence-s-blank-payload-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code>a\n</code></pre>\n  </li>\n</ul>\n<p>x</p>"
    }
  ],
  [
    "627-a-refused-marker-leaves-an-open-fence-s-blank-payload-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "627-a-refused-marker-leaves-an-open-fence-s-blank-payload-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "627-a-refused-marker-leaves-an-open-fence-s-blank-payload-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "627-a-refused-marker-leaves-an-open-fence-s-blank-payload-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    x\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "627-a-refused-marker-leaves-an-open-fence-s-blank-payload",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x</p>"
    }
  ],
  [
    "628-a-column-zero-marker-below-an-open-div-attaches-beside-the-div-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <div class=\"d\">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n</ul>\n<p>para</p>"
    }
  ],
  [
    "629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<p>para</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>note<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote><p>q</p></blockquote>\n</blockquote>\n<p>para</p>"
    }
  ],
  [
    "629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote><p>q</p></blockquote>\n</blockquote>"
    }
  ],
  [
    "629-a-dangling-plus-is-a-letter-and-a-nested-quote-reads-it-like-an-unnested-one",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote><p>q</p></blockquote>\n<p>para</p>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-10",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<p>q</p>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-13",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>para</p>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-14",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>para</p>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-16",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ol>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ol>\n<p>para</p>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-18",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>para</p>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener-9",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code>x\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "630-a-continuation-marker-stands-alone-at-an-open-marker-column-or-right-after-a-block-opener",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>para</p>"
    }
  ],
  [
    "631-a-task-item-takes-a-first-block-continuation-marker-after-its-checkbox-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>code\n</code></pre>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-11",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <blockquote><p>q</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-12",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"task\"> task</li>\n    </ul>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-13",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-18",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>a</p>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-19",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>a</p>\n    <ul>\n      <li>b</li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-20",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-28",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-29",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-30",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> </li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-31",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-33",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ol>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ol>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "632-a-continuation-marker-uses-its-container-column-9",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-10",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li>\n        <blockquote><p>b</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-11",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> </li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-12",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> </li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-14",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> \n        <blockquote><p>b</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-15",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-16",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-18",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ol>\n      <li></li>\n    </ol>\n    <blockquote><p>b</p></blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-19",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-20",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-22",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li>\n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-23",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-24",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-26",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> \n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-27",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-28",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"task\"> task</li>\n    </ul>\n    <ol>\n      <li>x</li>\n    </ol>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-30",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ol>\n      <li></li>\n    </ol>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-31",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-33",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-34",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n    <ol>\n      <li>x</li>\n    </ol>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-35",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"x\"> x</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-36",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li>\n        <ul>\n          <li>x</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-37",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>a</p></li>\n  <li><p>s</p></li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-38",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n  <li>s</li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-39",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n    <li>s</li>\n  </ul>\n</blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li>b\n        <ul>\n          <li>x</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column-8",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "633-a-first-block-marker-on-an-indented-opener-reads-only-its-marker-column",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n  <li>x</li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-12",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"task\"> task</li>\n    </ul>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-13",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-14",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n      <li>c</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-18",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        \n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-19",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>left</p>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-20",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-23",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-24",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>para</p>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-25",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n  <li>b</li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-26",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ol>\n  <li></li>\n</ol>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-27",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled> </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-28",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li></li>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>a</p></li>\n  <li><p>s</p></li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-30",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<p>flush</p>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-31",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n    <blockquote><p>b</p></blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-32",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>b</p></blockquote>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-33",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n    b\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-35",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<section id=\"h\">\n  <h1>h</h1>\n</section>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-36",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-37",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-38",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-39",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>\n<section id=\"h\">\n  <h1>h</h1>\n</section>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n  <li>s</li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-40",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n    <h1 id=\"h\">h</h1>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "634-a-refused-continuation-plus-remains-text",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>"
    }
  ],
  [
    "646-a-quote-prefixed-plus-takes-one-space-after-each-quote-marker-and-attaches-a-quote-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<p>q</p>"
    }
  ],
  [
    "649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>b</p>"
    }
  ],
  [
    "649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n    b\n  </li>\n</ul>"
    }
  ],
  [
    "649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n\n  </blockquote>\n  <p>q</p>\n</blockquote>"
    }
  ],
  [
    "649-a-first-block-plus-refuses-a-follower-at-an-intervening-column-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <blockquote>\n      <blockquote>\n\n      </blockquote>\n      <p>q</p>\n    </blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "649-a-first-block-plus-refuses-a-follower-at-an-intervening-column",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>b</p>"
    }
  ],
  [
    "650-a-wrapped-attribute-line-interrupts-like-a-one-line-attribute-line-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre class=\"c\"><code>y\n</code></pre>"
    }
  ],
  [
    "651-a-stacked-first-block-plus-takes-a-follower-only-at-its-innermost-opener-s-marker-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <blockquote>\n\n            </blockquote>\n          </li>\n        </ul>\n      </li>\n    </ul>\n    b\n  </li>\n</ul>"
    }
  ],
  [
    "651-a-stacked-first-block-plus-takes-a-follower-only-at-its-innermost-opener-s-marker-column",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n    b\n  </li>\n</ul>"
    }
  ],
  [
    "652-a-quote-s-first-block-plus-takes-a-list-that-carries-its-quote-prefixes-at-its-marker-column-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>\n<ul>\n  <li>s</li>\n</ul>"
    }
  ],
  [
    "652-a-quote-s-first-block-plus-takes-a-list-that-carries-its-quote-prefixes-at-its-marker-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n\n      </blockquote>\n    </blockquote>\n    <ul>\n      <li>s</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "654-a-quote-follower-below-stacked-quote-openers-in-an-item-is-read-at-its-raw-column",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "655-a-hosted-quote-s-first-block-plus-refuses-a-block-without-the-host-quote-s-prefix-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>\n<table>\n  <tbody>\n    <tr><td>c</td></tr>\n  </tbody>\n</table>"
    }
  ],
  [
    "655-a-hosted-quote-s-first-block-plus-refuses-a-block-without-the-host-quote-s-prefix-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>a</li>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>\n<section id=\"h\">\n  <h1>h</h1>\n</section>"
    }
  ],
  [
    "655-a-hosted-quote-s-first-block-plus-refuses-a-block-without-the-host-quote-s-prefix",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>\n<section id=\"h\">\n  <h1>h</h1>\n</section>"
    }
  ],
  [
    "656-the-column-of-the-quote-that-owns-a-first-block-plus-stays-eligible-at-every-depth-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n\n      </blockquote>\n    </blockquote>\n    b\n  </li>\n</ul>"
    }
  ],
  [
    "726-a-second-plus-starts-its-own-paragraph-after-attachment-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>q</p></li>\n  <li><p>r</p></li>\n</ul>"
    }
  ],
  [
    "726-a-second-plus-starts-its-own-paragraph-after-attachment-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>q</dd>\n</dl>"
    }
  ],
  [
    "726-a-second-plus-starts-its-own-paragraph-after-attachment-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>ref <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>q<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "726-a-second-plus-starts-its-own-paragraph-after-attachment",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x</li>\n</ul>\n<section id=\"h\">\n  <h1>h</h1>\n</section>"
    }
  ],
  [
    "728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x</li>\n</ul>\n<hr>"
    }
  ],
  [
    "728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x</li>\n</ul>\n<blockquote>\n\n</blockquote>"
    }
  ],
  [
    "728-a-refused-first-block-plus-folds-its-content-column-line-and-the-next-root-block-ends-the-item",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>x</li>\n</ul>\n<blockquote>\n\n</blockquote>"
    }
  ],
  [
    "733-consecutive-continuation-markers-in-a-div-hosted-quote",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<aside class=\"admonition note\" aria-label=\"Note\">\n  <blockquote><p>q</p></blockquote>\n</aside>"
    }
  ],
  [
    "734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>\n<section id=\"tail\">\n  <h1>tail</h1>\n</section>"
    }
  ],
  [
    "734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>\n<hr>"
    }
  ],
  [
    "734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>\n<aside class=\"admonition note\" aria-label=\"Note\">\n  <p>tail</p>\n</aside>"
    }
  ],
  [
    "734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>\n<dl>\n  <dt>tail</dt>\n  <dd>definition</dd>\n</dl>"
    }
  ],
  [
    "734-a-nested-item-whose-plus-is-refused-releases-the-next-root-block",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>tail</p></blockquote>"
    }
  ],
  [
    "740-lazy-quote-owners-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>\n<p>s</p>"
    }
  ],
  [
    "745-the-deepest-quoted-paragraph-takes-a-lazy-line-across-missed-prefixes-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n  </blockquote>\n  <p>tail</p>\n</blockquote>"
    }
  ],
  [
    "745-the-deepest-quoted-paragraph-takes-a-lazy-line-across-missed-prefixes",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n  </blockquote>\n  <p>s</p>\n</blockquote>"
    }
  ],
  [
    "751-a-lazy-line-keeps-its-plus-through-three-quote-levels",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n    <blockquote>\n      <ul>\n        <li>\n          <blockquote>\n\n          </blockquote>\n        </li>\n        <li>\n          <blockquote>\n\n          </blockquote>\n        </li>\n      </ul>\n    </blockquote>\n  </blockquote>\n  <p>s</p>\n</blockquote>"
    }
  ],
  [
    "757-an-intervening-column-refuses-a-description-hosted-first-block",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<section id=\"H\">\n  <h1>H</h1>\n</section>"
    }
  ],
  [
    "760-a-heading-past-a-body-hosted-item-s-marker-column-refuses-its-plus-and-opens-in-the-description",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>"
    }
  ],
  [
    "782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-10",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n  <li>b</li>\n</ul>"
    }
  ],
  [
    "782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-12",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre class=\"x\"><code>x\n</code></pre>\n  </li>\n</ul>"
    }
  ],
  [
    "782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>"
    }
  ],
  [
    "782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ul>\n      <li>\n        <pre><code>x\n``\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it-9",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n    para\n  </li>\n</ul>"
    }
  ],
  [
    "801-a-footnote-body-refuses-a-first-block-at-its-body-column-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>x</li>\n        <li>y</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "801-a-footnote-body-refuses-a-first-block-at-its-body-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>later<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "801-a-footnote-body-refuses-a-first-block-at-its-body-column-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>flush<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "801-a-footnote-body-refuses-a-first-block-at-its-body-column-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>para</p>"
    }
  ],
  [
    "801-a-footnote-body-refuses-a-first-block-at-its-body-column-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>flush</dd>\n</dl>"
    }
  ],
  [
    "801-a-footnote-body-refuses-a-first-block-at-its-body-column-8",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>flush<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "801-a-footnote-body-refuses-a-first-block-at-its-body-column",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>flush<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>para<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>x</li>\n  </ul>\n</blockquote>\n<pre><code>c\n</code></pre>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<div class=\"d\">\n  <p>x</p>\n</div>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>para<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>flush<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "802-an-unprefixed-line-does-not-reach-a-quoted-note-s-first-block",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<section id=\"H\">\n  <h1>H</h1>\n  <p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n</section>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "806-a-description-body-in-an-item-refuses-a-column-zero-block-after-its-first-block-plus-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <dl>\n          <dt>t</dt>\n          <dd></dd>\n        </dl>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "806-a-description-body-in-an-item-refuses-a-column-zero-block-after-its-first-block-plus-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ol>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd></dd>\n    </dl>\n  </li>\n</ol>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "806-a-description-body-in-an-item-refuses-a-column-zero-block-after-its-first-block-plus-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd></dd>\n    </dl>\n  </li>\n</ul>\n<section id=\"H\">\n  <h1>H</h1>\n</section>"
    }
  ],
  [
    "806-a-description-body-in-an-item-refuses-a-column-zero-block-after-its-first-block-plus-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd></dd>\n    </dl>\n  </li>\n</ul>\n<pre><code>x\n\nsee\n</code></pre>"
    }
  ],
  [
    "806-a-description-body-in-an-item-refuses-a-column-zero-block-after-its-first-block-plus",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd></dd>\n    </dl>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "806-a-marker-folds-into-the-paragraph-a-first-block-plus-took",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>b</li>\n</ul>\n<ul>\n  <li>w1</li>\n</ul>"
    }
  ],
  [
    "811-a-first-block-plus-does-not-take-the-closer-of-its-div-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<div class=\"d\">\n  <dl>\n    <dt>t</dt>\n    <dd>\n      <p>d</p>\n      <dl>\n        <dt>u</dt>\n        <dd></dd>\n      </dl>\n    </dd>\n  </dl>\n</div>\n<p>after</p>"
    }
  ],
  [
    "811-a-first-block-plus-does-not-take-the-closer-of-its-div-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<div class=\"d\">\n  <ul>\n    <li></li>\n  </ul>\n</div>\n<p>after</p>"
    }
  ],
  [
    "811-a-first-block-plus-does-not-take-the-closer-of-its-div-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<div class=\"d\">\n  <ul>\n    <li><p>d</p>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n</div>\n<p>after</p>"
    }
  ],
  [
    "811-a-first-block-plus-does-not-take-the-closer-of-its-div",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<div class=\"d\">\n  <ul>\n    <li>d\n      <ul>\n        <li></li>\n      </ul>\n    </li>\n  </ul>\n</div>\n<p>after</p>"
    }
  ],
  [
    "811-a-lazy-line-after-a-narrower-list-in-a-note-folds-into-its-item",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ol>\n        <li></li>\n      </ol>\n      <ul>\n        <li>y\ntail</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "815-a-line-below-an-empty-div-after-a-first-block-plus-is-not-lazy-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <div class=\"d\">\n\n    </div>\n  </li>\n</ul>\n<p>after</p>"
    }
  ],
  [
    "815-a-line-below-an-empty-div-after-a-first-block-plus-is-not-lazy",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<div class=\"d\">\n  <ul>\n    <li>d\n      <ul>\n        <li>e\n          <ul>\n            <li></li>\n          </ul>\n        </li>\n      </ul>\n      <div>\n\n      </div>\n    </li>\n  </ul>\n  <p>after</p>\n</div>"
    }
  ],
  [
    "821-an-attribute-run-after-a-lone-plus-leads-a-sublist-at-the-content-column-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n</ul>\n<ul x=\"\" y=\"\">\n  <li>c</li>\n</ul>"
    }
  ],
  [
    "821-an-attribute-run-after-a-lone-plus-leads-a-sublist-at-the-content-column-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n  <ul x=\"\">\n    <li>c</li>\n  </ul>\n</blockquote>"
    }
  ],
  [
    "821-an-attribute-run-after-a-lone-plus-leads-a-sublist-at-the-content-column",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n</ul>\n<ul x=\"\">\n  <li>c</li>\n</ul>"
    }
  ],
  [
    "826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>after</p>"
    }
  ],
  [
    "826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>after</p>"
    }
  ],
  [
    "826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<pre><code>z\n</code></pre>"
    }
  ],
  [
    "826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n    after\n  </li>\n</ul>"
    }
  ],
  [
    "826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n    after\n  </li>\n</ul>"
    }
  ],
  [
    "826-a-comment-or-link-definition-at-a-body-s-column-refuses-a-first-block-plus",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>after</p>"
    }
  ],
  [
    "838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>  x\n</code></pre>"
    }
  ],
  [
    "838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<pre><code>  x\n</code></pre>"
    }
  ],
  [
    "838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>      x\n</code></pre>"
    }
  ],
  [
    "838-a-column-zero-fence-below-a-refused-nested-first-block-plus-keeps-its-payload",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>  x\n</code></pre>"
    }
  ],
  [
    "838-an-item-on-a-body-s-marker-line-refuses-a-column-zero-block-after-its-plus-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>p</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "838-an-item-on-a-body-s-marker-line-refuses-a-column-zero-block-after-its-plus",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<p>p</p>"
    }
  ],
  [
    "840-a-refused-plus-reads-like-a-letter-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<ul>\n  <li>b</li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "840-a-refused-plus-reads-like-a-letter-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <blockquote><p>a</p></blockquote>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<section id=\"H\">\n  <h1>H</h1>\n</section>"
    }
  ],
  [
    "841-a-column-zero-description-is-a-sibling-after-an-indented-description-s-refused-plus-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<blockquote><p>q\n: b</p></blockquote>"
    }
  ],
  [
    "841-a-column-zero-description-is-a-sibling-after-an-indented-description-s-refused-plus-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>l\n: b</p>"
    }
  ],
  [
    "841-a-column-zero-description-is-a-sibling-after-an-indented-description-s-refused-plus-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>x</p>\n    <dl>\n      <dt>t</dt>\n      <dd></dd>\n    </dl>\n    <p>l\n: b</p>\n  </li>\n</ul>"
    }
  ],
  [
    "841-a-column-zero-description-is-a-sibling-after-an-indented-description-s-refused-plus-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd></dd>\n  </dl>\n  <p>l\n: b</p>\n</blockquote>"
    }
  ],
  [
    "841-a-column-zero-description-is-a-sibling-after-an-indented-description-s-refused-plus-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>l\n: b\np</p>"
    }
  ],
  [
    "841-a-column-zero-description-is-a-sibling-after-an-indented-description-s-refused-plus",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>l\n: b</p>"
    }
  ],
  [
    "842-a-plus-at-a-stacked-item-s-marker-column-reaches-it-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n        x\n      </li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "846-a-description-left-of-its-term-measures-its-own-plus-follower-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>h</dd>\n</dl>"
    }
  ],
  [
    "846-a-description-left-of-its-term-measures-its-own-plus-follower",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>h</p>"
    }
  ],
  [
    "848-a-description-a-plus-filled-stays-open-for-a-sibling-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>l\n: b</p>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>+\nz\n\nq\n</code></pre>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>+\nz\n</code></pre>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd></dd>\n  </dl>\n  <p>para</p>\n</blockquote>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule-7",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>para<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule-8",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<ul>\n  <li>y</li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule-9",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<section id=\"H\">\n  <h1>H</h1>\n  <p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n</section>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
    }
  ],
  [
    "851-a-first-block-plus-shape-reads-the-one-attach-rule",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<dl>\n  <dt>l</dt>\n</dl>\n<p>x</p>"
    }
  ],
  [
    "851-an-accepted-plus-needs-a-follower-that-reaches-its-host-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n\n</blockquote>"
    }
  ],
  [
    "851-an-accepted-plus-needs-a-follower-that-reaches-its-host-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote>\n      <ol>\n        <li></li>\n      </ol>\n    </blockquote>\n  </dd>\n</dl>\n<blockquote><p>x</p></blockquote>"
    }
  ],
  [
    "851-an-accepted-plus-needs-a-follower-that-reaches-its-host",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote><p>a</p></blockquote>\n<blockquote>\n\n</blockquote>"
    }
  ],
  [
    "852-a-plus-a-second-plus-follows-hands-the-quote-its-next-block-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<ul x=\"\">\n  <li>c</li>\n</ul>"
    }
  ],
  [
    "854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n</dl>\n<p x=\"\">: b</p>"
    }
  ],
  [
    "854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p x=\"\">: b</p>"
    }
  ],
  [
    "854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n</dl>\n<ul x=\"\">\n  <li>c</li>\n</ul>"
    }
  ],
  [
    "854-a-refused-plus-before-an-attribute-run-and-a-sibling-is-a-letter",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a</li>\n</ul>\n<ul x=\"\">\n  <li>c</li>\n</ul>"
    }
  ],
  [
    "855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>text</p>"
    }
  ],
  [
    "855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n  <li>b</li>\n</ul>"
    }
  ],
  [
    "855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>text</p>"
    }
  ],
  [
    "855-invisible-lines-after-a-plus-are-skipped-and-the-first-visible-line-decides",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>text</p>"
    }
  ],
  [
    "866-an-abbreviation-definition-after-a-plus-is-skipped-like-a-link-definition-6",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>text</p>\n<p><abbr title=\"b\">A</abbr></p>"
    }
  ],
  [
    "868-a-refused-plus-after-a-block-a-quote-s-plus-attached-folds-into-the-open-paragraph",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<blockquote>\n  <ol>\n    <li>e</li>\n  </ol>\n</blockquote>"
    }
  ],
  [
    "871-a-first-block-plus-whose-next-line-misses-the-opener-s-marker-column-is-a-letter-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<dl>\n  <dt>s</dt>\n  <dd>\n    <p>a</p>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<blockquote><p>q</p></blockquote>"
    }
  ],
  [
    "871-a-first-block-plus-whose-next-line-misses-the-opener-s-marker-column-is-a-letter-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n    + y\n    <ul>\n      <li>z</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "871-a-first-block-plus-whose-next-line-misses-the-opener-s-marker-column-is-a-letter",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<pre><code>  - y\n\nw\n</code></pre>"
    }
  ],
  [
    "928-a-multi-line-paragraph-of-only-braced-comments-is-an-invisible-line",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<section id=\"H\">\n  <h1>H</h1>\n</section>"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n    <h1 id=\"H\">H</h1>\n  </li>\n</ul>"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n    <blockquote class=\"c\"><p>q</p></blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>foo\n    <ol>\n      <li></li>\n    </ol>\n    <blockquote><p>b</p></blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>"
    }
  ],
  [
    "933-a-list-marker-in-an-item-ends-a-comment-only-paragraph-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>p</p>\n    <ul>\n      <li>a</li>\n    </ul>\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "933-a-list-marker-in-an-item-ends-a-comment-only-paragraph-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>p</p>\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>"
    }
  ],
  [
    "933-a-list-marker-in-an-item-ends-a-comment-only-paragraph-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li></li>\n</ul>\n<p>\n- b</p>"
    }
  ],
  [
    "933-a-list-marker-in-an-item-ends-a-comment-only-paragraph",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "html": "<ul>\n  <li><p>p</p>\n    <ul>\n      <li><p>a</p></li>\n      <li><p>b</p></li>\n    </ul>\n  </li>\n</ul>"
    }
  ]
])
export const RULED_5013_FMT: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  [
    "436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": ":: t\n: %%\n\nflush\n"
    }
  ],
  [
    "436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": ":: t\n: %%\n\nflush\n"
    }
  ],
  [
    "626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-8",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": "- - [ ] ```js\n        x\n\n    ```\n  %%\n\ntail\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": "- - %%\n\n  ```\n  x\n  ```\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-3",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": "- - %%\n\n  # H\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": "- - %%\n\n  {.c}\n  > q\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-5",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": "- foo\n  1. %%\n  > b\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": "- - %%\n\n  > q\n"
    }
  ]
])
