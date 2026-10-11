import { expect, it } from 'vitest'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'

const rows = [
  {
    "source": "**Hello**, *world*! \"Quoted\" -- literal.",
    "expected": {
      "value": "*Hello*, /world/! \\\"Quoted\\\" \\-\\- literal.",
      "losses": []
    }
  },
  {
    "source": "a**b**c",
    "expected": {
      "value": "a{*b*}c",
      "losses": []
    }
  },
  {
    "source": "a__b__c",
    "expected": {
      "value": "a__b__c",
      "losses": []
    }
  },
  {
    "source": "*a* *b*",
    "expected": {
      "value": "/a/ /b/",
      "losses": []
    }
  },
  {
    "source": "**_a_**",
    "expected": {
      "value": "*/a/*",
      "losses": []
    }
  },
  {
    "source": "***a***",
    "expected": {
      "value": "{/*a*/}",
      "losses": []
    }
  },
  {
    "source": "*a *b* c*",
    "expected": {
      "value": "{/a {/b/} c/}",
      "losses": []
    }
  },
  {
    "source": "A. *word*",
    "expected": {
      "value": "A\\. /word/",
      "losses": []
    }
  },
  {
    "source": "www.example.com",
    "expected": {
      "value": "[www.example.com](http://www.example.com)",
      "losses": []
    }
  },
  {
    "source": "a -- b---c",
    "expected": {
      "value": "a \\-\\- b\\-\\-\\-c",
      "losses": []
    }
  },
  {
    "source": "\"*word*\" and _more_.",
    "expected": {
      "value": "\\\"/word/\\\" and /more/.",
      "losses": []
    }
  },
  {
    "source": "**bold**, *italic*; plain?",
    "expected": {
      "value": "*bold*, /italic/; plain?",
      "losses": []
    }
  },
  {
    "source": "9**x**0",
    "expected": {
      "value": "9{*x*}0",
      "losses": []
    }
  },
  {
    "source": "*a**b*",
    "expected": {
      "value": "/a**b/",
      "losses": []
    }
  },
  {
    "source": "**emphasis** with `code`.",
    "expected": {
      "value": "*emphasis* with `code`.",
      "losses": []
    }
  },
  {
    "source": "*😀word* and [link](/u).",
    "expected": {
      "value": "/😀word/ and [link](/u).",
      "losses": []
    }
  }
]

it.each(rows)('preserves ordinary prose and emphasis: $source', ({ source, expected }) => {
  expect(markdownToCarveWithLosses(source)).toEqual(expected)
})
