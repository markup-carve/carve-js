import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string): string => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

const cases = [
  {
    "name": "nested list marker returns to the outer description",
    "source": ":: T\n: D\n  :: t\n  :  d\n    - b\n",
    "expected": "<dl>\n<dt>T</dt>\n<dd>\n<p>D</p>\n<dl>\n<dt>t</dt>\n<dd>d</dd>\n</dl>\n<ul>\n<li>b</li>\n</ul>\n</dd>\n</dl>"
  },
  {
    "name": "marker at the outer body column opens there",
    "source": ":: t\n: d\n  :: u\n  :  e\n  1. q\n",
    "expected": "<dl>\n<dt>t</dt>\n<dd>\n<p>d</p>\n<dl>\n<dt>u</dt>\n<dd>e</dd>\n</dl>\n<ol>\n<li>q</li>\n</ol>\n</dd>\n</dl>"
  },
  {
    "name": "term below an inner item opens in its description",
    "source": "- h0\n  :: t\n  : d\n    [^n]: note\n    - a\n     :: u\n     :  e\n",
    "expected": "<ul>\n<li>h0\n<dl>\n<dt>t</dt>\n<dd>\n<p>d</p>\n<dl>\n<dt>u</dt>\n<dd>e</dd>\n</dl>\n</dd>\n</dl>\n</li>\n</ul>"
  },
  {
    "name": "quote opener returns to the quoted item",
    "source": "> - h0\n>   1. h1\n>     :: term\n>     :  detail\n>      > quote\n",
    "expected": "<blockquote>\n<ul>\n<li>h0\n<ol>\n<li>h1</li>\n</ol>\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n<blockquote><p>quote</p></blockquote>\n</li>\n</ul>\n</blockquote>"
  },
  {
    "name": "row 5 returns to its surviving owner",
    "source": "> - a\n>   :: term\n>   :  detail\n>     :: term\n>     :  detail\n>       [^n]: note\n>        q\n> 1. ordered\n",
    "expected": "<blockquote>\n<ul>\n<li>a\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n</li>\n</ul>\n<ol>\n<li>ordered</li>\n</ol>\n</blockquote>"
  },
  {
    "name": "row 6 returns to its surviving owner",
    "source": "- - a\n    :: term\n    :  detail\n      :: term\n      :  detail\n        [^n]: note\n         q\n  1. ordered\n",
    "expected": "<ul>\n<li>\n<ul>\n<li>a\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n</li>\n</ul>\n<ol>\n<li>ordered</li>\n</ol>\n</li>\n</ul>"
  },
  {
    "name": "row 8 returns to its surviving owner",
    "source": "- a\n :: term\n  :  detail\n    :: term\n    :  detail\n      [^n]: note\n       q\n1. ordered\n",
    "expected": "<ul>\n<li>a\n:: term\n:  detail\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n</li>\n</ul>\n<ol>\n<li>ordered</li>\n</ol>"
  },
  {
    "name": "row 9 returns to its surviving owner",
    "source": "- a\n  :: term\n  :  detail\n     :: term\n    :  detail\n      [^n]: note\n       q\n1. ordered\n",
    "expected": "<ul>\n<li>a\n<dl>\n<dt>term</dt>\n<dd>\n<p>detail</p>\n<dl>\n<dt>term</dt>\n</dl>\n<p>:  detail</p>\n</dd>\n</dl>\n</li>\n</ul>\n<ol>\n<li>ordered</li>\n</ol>"
  },
  {
    "name": "row 10 returns to its surviving owner",
    "source": "- a\n  :: term\n  :  detail\n    :: term\n   :  detail\n      [^n]: note\n       q\n1. ordered\n",
    "expected": "<ul>\n<li>a\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n<dt>term\n:  detail\n[^n]: note\nq</dt>\n</dl>\n</li>\n</ul>\n<ol>\n<li>ordered</li>\n</ol>"
  }
]

describe('an opener leaving a description uses the nearest surviving owner', () => {
  it.each(cases)('$name', ({ source, expected }) => {
    expect(normalize(carveToHtml(source))).toBe(expected)
  })
})
