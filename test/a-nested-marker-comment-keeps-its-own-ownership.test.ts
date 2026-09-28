import { it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  [
    "515-a-nested-marker-comment-keeps-its-own-ownership-2.crv",
    "- a\n  - %%%\n    hidden\n    %%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "515-a-nested-marker-comment-keeps-its-own-ownership-3.crv",
    "- a\n  - %% hidden\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "515-a-nested-marker-comment-keeps-its-own-ownership-4.crv",
    "1. a\n   1. %%%\n      hidden\n%%%\ntail\n",
    "<ol>\n  <li>a\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ol>\n<p>tail</p>\n"
  ],
  [
    "515-a-nested-marker-comment-keeps-its-own-ownership-5.crv",
    "1. a\n   1. %%%\n      hidden\n      %%%\ntail\n",
    "<ol>\n  <li>a\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ol>\n<p>tail</p>\n"
  ],
  [
    "515-a-nested-marker-comment-keeps-its-own-ownership.crv",
    "- a\n  - %%%\n    hidden\n%%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "bullet closer 0",
    "- a\n  - %%%\n    hidden\n%%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "bullet closer 1",
    "- a\n  - %%%\n    hidden\n %%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "bullet closer 4",
    "- a\n  - %%%\n    hidden\n    %%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "bullet closer 6",
    "- a\n  - %%%\n    hidden\n      %%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "ordered closer 0",
    "1. a\n   1. %%%\n      hidden\n%%%\ntail\n",
    "<ol>\n  <li>a\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ol>\n<p>tail</p>\n"
  ],
  [
    "ordered closer 1",
    "1. a\n   1. %%%\n      hidden\n %%%\ntail\n",
    "<ol>\n  <li>a\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ol>\n<p>tail</p>\n"
  ],
  [
    "ordered closer 6",
    "1. a\n   1. %%%\n      hidden\n      %%%\ntail\n",
    "<ol>\n  <li>a\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ol>\n<p>tail</p>\n"
  ],
  [
    "ordered closer 8",
    "1. a\n   1. %%%\n      hidden\n        %%%\ntail\n",
    "<ol>\n  <li>a\n    <ol>\n      <li></li>\n    </ol>\n  </li>\n</ol>\n<p>tail</p>\n"
  ],
  [
    "task closer 0",
    "- a\n  - [x] %%%\n    hidden\n%%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li><input type=\"checkbox\" checked disabled> </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "task closer 1",
    "- a\n  - [x] %%%\n    hidden\n %%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li><input type=\"checkbox\" checked disabled> </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "task closer 4",
    "- a\n  - [x] %%%\n    hidden\n    %%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li><input type=\"checkbox\" checked disabled> </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "task closer 6",
    "- a\n  - [x] %%%\n    hidden\n      %%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li><input type=\"checkbox\" checked disabled> </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "code payload",
    "- a\n  ```\n  - %%%\n  hidden\n  ```\n%%%\ntail\n",
    "<ul>\n  <li>a\n    <pre><code>- %%%\nhidden\n</code></pre>\n  </li>\n</ul>\n<p>tail</p>\n"
  ],
  [
    "below-column payload",
    "- a\n  - %%%\n  visible\n%%%\ntail\n",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n    visible\n    tail\n  </li>\n</ul>\n"
  ]
]

it.each(cases)('%s', (_name, source, expected) => {
  expect(carveToHtml(source!).trimEnd()).toBe(expected!.trimEnd())
})
