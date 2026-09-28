import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  [
    "a <b/> c",
    "<p>a <b/> c</p>"
  ],
  [
    "a <b > c </b > d",
    "<p>a <b > c </b > d</p>"
  ],
  [
    "x <span>a\n*b*</span>",
    "<p>x <span>a\n<em>b</em></span></p>"
  ],
  [
    "a <?x <code>q</code> ?> b",
    "<p>a <?x <code>q</code> ?> b</p>"
  ],
  [
    "a <?x [a](<b c>) ?> b",
    "<p>a <?x [a](<b c>) ?> b</p>"
  ],
  [
    "a <![CDATA[[foo](bar)]]> b",
    "<p>a <![CDATA[[foo](bar)]]> b</p>"
  ],
  [
    "<a  /><b2\ndata=\"foo\" >\n",
    "<p><a  /><b2\ndata=\"foo\" ></p>"
  ],
  [
    "<a foo=\"bar\" bam = 'baz <em>\"</em>'\n_boolean zoop:33=zoop:33 />\n",
    "<p><a foo=\"bar\" bam = 'baz <em>\"</em>'\n_boolean zoop:33=zoop:33 /></p>"
  ],
  [
    "Foo <responsive-image src=\"foo.jpg\" />\n",
    "<p>Foo <responsive-image src=\"foo.jpg\" /></p>"
  ],
  [
    "<33> <__>\n",
    "<p>&lt;33&gt; &lt;__&gt;</p>"
  ],
  [
    "<a h*#ref=\"hi\">\n",
    "<p>&lt;a h*#ref=&quot;hi&quot;&gt;</p>"
  ],
  [
    "<a href=\"hi'> <a href=hi'>\n",
    "<p>&lt;a href=&quot;hi'&gt; &lt;a href=hi'&gt;</p>"
  ],
  [
    "< a><\nfoo><bar/ >\n<foo bar=baz\nbim!bop />\n",
    "<p>&lt; a&gt;&lt;\nfoo&gt;&lt;bar/ &gt;\n&lt;foo bar=baz\nbim!bop /&gt;</p>"
  ],
  [
    "<a href='bar'title=title>\n",
    "<p>&lt;a href='bar'title=title&gt;</p>"
  ],
  [
    "</a></foo >\n",
    "<p></a></foo ></p>"
  ],
  [
    "</a href=\"foo\">\n",
    "<p>&lt;/a href=&quot;foo&quot;&gt;</p>"
  ],
  [
    "foo <!-- this is a --\ncomment - with hyphens -->\n",
    "<p>foo <!-- this is a --\ncomment - with hyphens --></p>"
  ],
  [
    "foo <!--> foo -->\n\nfoo <!---> foo -->\n",
    "<p>foo <!--> foo --&gt;</p>\n<p>foo <!---> foo --&gt;</p>"
  ],
  [
    "foo <?php echo $a; ?>\n",
    "<p>foo <?php echo $a; ?></p>"
  ],
  [
    "foo <!ELEMENT br EMPTY>\n",
    "<p>foo <!ELEMENT br EMPTY></p>"
  ],
  [
    "foo <![CDATA[>&<]]>\n",
    "<p>foo <![CDATA[>&<]]></p>"
  ],
  [
    "foo <a href=\"&ouml;\">\n",
    "<p>foo <a href=\"&ouml;\"></p>"
  ],
  [
    "foo <a href=\"\\*\">\n",
    "<p>foo <a href=\"\\*\"></p>"
  ],
  [
    "<a href=\"\\\"\">\n",
    "<p>&lt;a href=&quot;&quot;&quot;&gt;</p>"
  ],
  [
    "a <?php `x\ny` ?> b",
    "<p>a <?php `x\ny` ?> b</p>"
  ],
  [
    "a <![CDATA[`x\ny`]]> b",
    "<p>a <![CDATA[`x\ny`]]> b</p>"
  ],
  [
    "a\\ b",
    "<p>a\\ b</p>"
  ],
  [
    "a <span data-x=\"[foo][]\">y</span>\n\n[foo]: /u",
    "<p>a <span data-x=\"[foo][]\">y</span></p>"
  ],
  [
    "a <span data-x=\"[l][foo]\">y</span>",
    "<p>a <span data-x=\"[l][foo]\">y</span></p>"
  ],
  [
    "a <span title=\"<http://x.y>\">y</span>",
    "<p>a <span title=\"<http://x.y>\">y</span></p>"
  ],
  [
    "[foo <bar attr=\"][ref]\">\n\n[ref]: /uri",
    "<p>[foo <bar attr=\"][ref]\"></p>"
  ]
])('imports inline HTML using CommonMark tag boundaries: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected.replace(/&quot;/g, '"'))
})
