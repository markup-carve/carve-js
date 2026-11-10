/** carve#5856 (carve#5830 rule B) results ahead of the pinned spec submodule. */
export const RULED_5866_HTML: ReadonlyMap<string, { reason: string; html: string }> = new Map([
  ['963-a-multi-line-braced-comment-keeps-the-nested-list-open', {
    reason: 'carve#5866: a lazy comment run whose continuation misses its host body column is refused',
    html: "<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}</li>\n      <li>c</li>\n    </ul>\n  </li>\n</ul>",
  }],
  ['963-a-multi-line-braced-comment-keeps-the-nested-list-open-2', {
    reason: 'carve#5866: a lazy comment run whose continuation misses its host body column is refused',
    html: "<ul>\n  <li>a\n    <ul>\n      <li><p>b\n{% c\nd %}</p></li>\n      <li><p>c</p></li>\n    </ul>\n  </li>\n</ul>",
  }],
  ['963-a-multi-line-braced-comment-keeps-the-nested-list-open-3', {
    reason: 'carve#5866: a lazy comment run whose continuation misses its host body column is refused',
    html: "<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}\nx</li>\n      <li>c</li>\n    </ul>\n  </li>\n</ul>",
  }],
  ['963-a-multi-line-braced-comment-keeps-the-nested-list-open-4', {
    reason: 'carve#5866: a lazy comment run whose continuation misses its host body column is refused',
    html: "<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}\n        <ul>\n          <li>c</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
  }],
  ['964-a-lazy-line-after-a-comment-keeps-the-deepest-list-open-2', {
    reason: 'carve#5866: a lazy comment run whose continuation misses its host body column is refused',
    html: "<ul>\n  <li>a\n    <ul>\n      <li>mid\n        <ul>\n          <li><p>b\n{% c\nd %}\ntail</p></li>\n          <li><p>z</p></li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
  }],
])
