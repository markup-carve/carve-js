import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  {
    "name": "list item, below column, %% c",
    "source": "- x\n %% c\n z\n",
    "html": "<ul>\n  <li>x\n    z\n  </li>\n</ul>"
  },
  {
    "name": "list item, below column, %%%",
    "source": "- x\n %%%\n z\n",
    "html": "<ul>\n  <li>x\n    z\n  </li>\n</ul>"
  },
  {
    "name": "list item, at column, %% c",
    "source": "- x\n  %% c\n z\n",
    "html": "<ul>\n  <li>x</li>\n</ul>\n<p>z</p>"
  },
  {
    "name": "list item, at column, %%%",
    "source": "- x\n  %%%\n z\n",
    "html": "<ul>\n  <li>x</li>\n</ul>\n<p>z</p>"
  },
  {
    "name": "list item, above column, %% c",
    "source": "- x\n   %% c\n z\n",
    "html": "<ul>\n  <li>x</li>\n</ul>\n<p>z</p>"
  },
  {
    "name": "list item, above column, %%%",
    "source": "- x\n   %%%\n z\n",
    "html": "<ul>\n  <li>x</li>\n</ul>\n<p>z</p>"
  },
  {
    "name": "description body, below column, %% c",
    "source": ":: t\n:  x\n  %% c\n z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <p>z</p>\n  </dd>\n</dl>"
  },
  {
    "name": "description body, below column, %%%",
    "source": ":: t\n:  x\n  %%%\n z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <p>z</p>\n  </dd>\n</dl>"
  },
  {
    "name": "description body, at column, %% c",
    "source": ":: t\n:  x\n   %% c\n z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>"
  },
  {
    "name": "description body, at column, %%%",
    "source": ":: t\n:  x\n   %%%\n z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>"
  },
  {
    "name": "description body, above column, %% c",
    "source": ":: t\n:  x\n    %% c\n z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>"
  },
  {
    "name": "description body, above column, %%%",
    "source": ":: t\n:  x\n    %%%\n z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>"
  },
  {
    "name": "footnote body, below column, %% c",
    "source": "[^a]: x\n %% c\n z\n\nsee[^a]\n",
    "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x</p>\n      <p>z<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "name": "footnote body, below column, %%%",
    "source": "[^a]: x\n %%%\n z\n\nsee[^a]\n",
    "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x</p>\n      <p>z<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "name": "footnote body, at column, %% c",
    "source": "[^a]: x\n  %% c\n z\n\nsee[^a]\n",
    "html": "<p>z</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "name": "footnote body, at column, %%%",
    "source": "[^a]: x\n  %%%\n z\n\nsee[^a]\n",
    "html": "<p>z</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "name": "footnote body, above column, %% c",
    "source": "[^a]: x\n   %% c\n z\n\nsee[^a]\n",
    "html": "<p>z</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "name": "footnote body, above column, %%%",
    "source": "[^a]: x\n   %%%\n z\n\nsee[^a]\n",
    "html": "<p>z</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "name": "list item, clears earlier retention, follower column 1",
    "source": "- x\n%% below\n  %% at\n z\n",
    "html": "<ul>\n  <li>x</li>\n</ul>\n<p>z</p>"
  },
  {
    "name": "list item, clears earlier retention, follower column 2",
    "source": "- x\n%% below\n  %% at\n  z\n",
    "html": "<ul>\n  <li>x\n    z\n  </li>\n</ul>"
  },
  {
    "name": "description body, clears earlier retention, follower column 1",
    "source": ":: t\n:  x\n%% below\n   %% at\n z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>"
  },
  {
    "name": "description body, clears earlier retention, follower column 3",
    "source": ":: t\n:  x\n%% below\n   %% at\n   z\n",
    "html": "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <p>z</p>\n  </dd>\n</dl>"
  },
  {
    "name": "footnote body, clears earlier retention, follower column 1",
    "source": "[^a]: x\n%% below\n  %% at\n z\n\nsee[^a]\n",
    "html": "<p>z</p>\n<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  },
  {
    "name": "footnote body, clears earlier retention, follower column 2",
    "source": "[^a]: x\n%% below\n  %% at\n  z\n\nsee[^a]\n",
    "html": "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>x</p>\n      <p>z<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"
  }
]

describe('an at-column comment retains nothing', () => {
  it.each(cases)('$name', ({ source, html }) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
