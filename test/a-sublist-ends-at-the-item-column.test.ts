import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  {
    "source": "- ::: box\n  :::\n %% c\n  text\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul><p>text</p>"
  },
  {
    "source": "- # h\n %% c\n  text\n",
    "html": "<ul><li><h1 id=\"h\">h</h1></li></ul><p>text</p>"
  },
  {
    "source": "- ```\n  x\n  ```\n %% c\n  text\n",
    "html": "<ul><li><pre><code>x\n</code></pre></li></ul><p>text</p>"
  },
  {
    "source": "- a\n %% c\n  text\n",
    "html": "<ul><li>a\n    text\n  </li></ul>"
  },
  {
    "source": "- a\n\n %% c\n  text\n",
    "html": "<ul><li>a</li></ul><p>text</p>"
  },
  {
    "source": "- outer\n  - para\n\n  text\n\n    ```\n",
    "html": "<ul><li><p>outer</p><ul><li>para</li></ul><p>text</p><pre><code></code></pre></li></ul>"
  },
  {
    "source": "- outer\n  - para\n  > q\n\n    ```\n",
    "html": "<ul><li>outer\n    <ul><li>para</li></ul><blockquote><p>q</p></blockquote><pre><code></code></pre></li></ul>"
  },
  {
    "source": "- outer\n  - para\n\n  > q\n\n    ```\n",
    "html": "<ul><li>outer\n    <ul><li>para</li></ul><blockquote><p>q</p></blockquote><pre><code></code></pre></li></ul>"
  },
  {
    "source": "- ::: box\n  :::\n%% c\n  text\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul><p>text</p>"
  },
  {
    "source": "- # h\n%% c\n  text\n",
    "html": "<ul><li><h1 id=\"h\">h</h1></li></ul><p>text</p>"
  },
  {
    "source": "- ```\n  x\n  ```\n%% c\n  text\n",
    "html": "<ul><li><pre><code>x\n</code></pre></li></ul><p>text</p>"
  },
  {
    "source": "- a\n%% c\n  text\n",
    "html": "<ul><li>a\n    text\n  </li></ul>"
  },
  {
    "source": "- a\n\n%% c\n  text\n",
    "html": "<ul><li>a</li></ul><p>text</p>"
  },
  {
    "source": "- outer\n  - para\n\n  text\n\n    ~~~\n",
    "html": "<ul><li><p>outer</p><ul><li>para</li></ul><p>text</p><pre><code></code></pre></li></ul>"
  },
  {
    "source": "- outer\n  - para\n  > q\n\n    ~~~\n",
    "html": "<ul><li>outer\n    <ul><li>para</li></ul><blockquote><p>q</p></blockquote><pre><code></code></pre></li></ul>"
  },
  {
    "source": "- outer\n  - para\n\n  > q\n\n    ~~~\n",
    "html": "<ul><li>outer\n    <ul><li>para</li></ul><blockquote><p>q</p></blockquote><pre><code></code></pre></li></ul>"
  },
  {
    "source": "- intro\n  %% a\n %% b\ntail\n",
    "html": "<ul><li>intro</li></ul><p>tail</p>"
  },
  {
    "source": "- intro\n  %% a\n  %% b\ntail\n",
    "html": "<ul><li>intro</li></ul><p>tail</p>"
  },
  {
    "source": "[^n]: x\n %% c\n x\n %% c\n x\n %% c\n x\n",
    "html": ""
  },
  {
    "source": ":: term\n:  x\n %% c\n x\n %% c\n x\n %% c\n x\n",
    "html": "<dl><dt>term</dt><dd><p>x</p><p>x</p><p>x</p><p>x</p></dd></dl>"
  }
]

it.each(cases)('item-column blocks and X1 comments: $source', ({ source, html }) => {
  expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
})
