# Import conformance

Versions: CommonMark `commonmark.json` 0.31.0; GFM `cmark-gfm` 0.29.0.gfm.13 `test/spec.txt`; Djot `@djot/djot` 0.3.2 (`fa7a699`).

HTML normalization parses with parse5, orders attributes, removes whitespace only text between tags, removes `section` wrappers and heading ids, and treats entity spelling and void closing forms equally. `same-text` requires equal visible text and equal block element structure after removing inline elements. The HTML tree ladder removes provenance, source positions, generated fields and, for `same-meaning`, attributes, paragraph role and section wrappers. `same-rendering` compares normalized HTML; `same-text` compares visible text alone.

Raw HTML dependent examples count an imported `raw_block` or `raw_inline`; comparisons render with `rawHtml: true`.

Mutation campaign: 1924 suite inputs imported without error; 100000 byte mutations returned 100000 trees and 0 typed errors.

## CommonMark

Cases: 652; canonical round trips: 652; raw HTML nodes: 72.

| Section | Same | Same text | Different |
| --- | ---: | ---: | ---: |
| Tabs | 8 | 1 | 2 |
| Backslash escapes | 12 | 1 | 0 |
| Entity and numeric character references | 13 | 3 | 1 |
| Precedence | 1 | 0 | 0 |
| Thematic breaks | 18 | 0 | 1 |
| ATX headings | 17 | 0 | 1 |
| Setext headings | 25 | 0 | 2 |
| Indented code blocks | 10 | 0 | 2 |
| Fenced code blocks | 29 | 0 | 0 |
| HTML blocks | 37 | 7 | 0 |
| Link reference definitions | 22 | 2 | 3 |
| Paragraphs | 8 | 0 | 0 |
| Blank lines | 1 | 0 | 0 |
| Block quotes | 25 | 0 | 0 |
| List items | 25 | 3 | 20 |
| Lists | 15 | 4 | 7 |
| Inlines | 1 | 0 | 0 |
| Code spans | 18 | 4 | 0 |
| Emphasis and strong emphasis | 127 | 2 | 3 |
| Links | 79 | 7 | 4 |
| Images | 5 | 0 | 17 |
| Autolinks | 17 | 1 | 1 |
| Raw HTML | 14 | 6 | 0 |
| Hard line breaks | 11 | 4 | 0 |
| Soft line breaks | 2 | 0 | 0 |
| Textual content | 3 | 0 | 0 |

Different examples by cause:

- block structure differs: CM-4, CM-98, CM-108, CM-109, CM-256, CM-258, CM-259, CM-262, CM-277, CM-300, CM-307, CM-316, CM-319, CM-325
- writer cannot spell tree field: CM-5, CM-39, CM-49, CM-79, CM-254, CM-263, CM-264, CM-270, CM-271, CM-280, CM-281, CM-282, CM-283, CM-284, CM-286, CM-287, CM-288, CM-290, CM-312, CM-315, CM-411, CM-415, CM-429, CM-489, CM-520, CM-554, CM-555, CM-572, CM-574, CM-575, CM-576, CM-577, CM-578, CM-580, CM-581, CM-582, CM-583, CM-584, CM-585, CM-586
- visible text differs: CM-96
- degraded foreign node: CM-195, CM-196, CM-200, CM-317, CM-573, CM-588, CM-589, CM-591, CM-609

## GFM

Cases: 648; canonical round trips: 648; raw HTML nodes: 71.

| Section | Same | Same text | Different |
| --- | ---: | ---: | ---: |
| Tabs | 8 | 1 | 2 |
| Precedence | 1 | 0 | 0 |
| Thematic breaks | 18 | 0 | 1 |
| ATX headings | 17 | 0 | 1 |
| Setext headings | 25 | 0 | 2 |
| Indented code blocks | 10 | 0 | 2 |
| Fenced code blocks | 29 | 0 | 0 |
| HTML blocks | 36 | 7 | 0 |
| Link reference definitions | 23 | 2 | 3 |
| Paragraphs | 8 | 0 | 0 |
| Blank lines | 1 | 0 | 0 |
| Block quotes | 25 | 0 | 0 |
| List items | 25 | 3 | 20 |
| Lists | 16 | 4 | 7 |
| Backslash escapes | 12 | 1 | 0 |
| Entity and numeric character references | 13 | 3 | 1 |
| Code spans | 18 | 4 | 0 |
| Emphasis and strong emphasis | 117 | 11 | 3 |
| Links | 76 | 7 | 4 |
| Images | 5 | 0 | 17 |
| Autolinks | 12 | 6 | 1 |
| Raw HTML | 14 | 6 | 0 |
| Hard line breaks | 11 | 4 | 0 |
| Soft line breaks | 2 | 0 | 0 |
| Textual content | 3 | 0 | 0 |

Different examples by cause:

- block structure differs: GFM-4, GFM-68, GFM-78, GFM-79, GFM-226, GFM-228, GFM-229, GFM-232, GFM-247, GFM-270, GFM-277, GFM-286, GFM-289, GFM-295
- writer cannot spell tree field: GFM-5, GFM-19, GFM-49, GFM-224, GFM-233, GFM-234, GFM-240, GFM-241, GFM-250, GFM-251, GFM-252, GFM-253, GFM-254, GFM-256, GFM-257, GFM-258, GFM-260, GFM-282, GFM-285, GFM-325, GFM-410, GFM-414, GFM-428, GFM-486, GFM-516, GFM-550, GFM-551, GFM-568, GFM-570, GFM-571, GFM-572, GFM-573, GFM-574, GFM-576, GFM-577, GFM-578, GFM-579, GFM-580, GFM-581, GFM-582
- visible text differs: GFM-66
- degraded foreign node: GFM-164, GFM-165, GFM-169, GFM-287, GFM-569, GFM-584, GFM-585, GFM-587, GFM-605

## Djot

Cases: 253; canonical round trips: 253; raw HTML nodes: 3.

| Section | Same | Same text | Different |
| --- | ---: | ---: | ---: |
| attributes.test | 14 | 19 | 0 |
| block_quote.test | 15 | 0 | 0 |
| code_blocks.test | 7 | 0 | 0 |
| definition_lists.test | 0 | 0 | 4 |
| emphasis.test | 32 | 1 | 0 |
| escapes.test | 6 | 0 | 0 |
| fenced_divs.test | 8 | 0 | 0 |
| filters.test | 0 | 0 | 2 |
| footnotes.test | 0 | 0 | 4 |
| headings.test | 14 | 1 | 1 |
| insert_delete_mark.test | 4 | 0 | 0 |
| links_and_images.test | 18 | 2 | 8 |
| lists.test | 3 | 27 | 0 |
| math.test | 0 | 6 | 0 |
| para.test | 0 | 1 | 0 |
| raw.test | 3 | 1 | 0 |
| regression.test | 4 | 1 | 0 |
| smart.test | 16 | 0 | 2 |
| spans.test | 3 | 0 | 0 |
| super_subscript.test | 4 | 0 | 0 |
| tables.test | 7 | 0 | 2 |
| task_lists.test | 0 | 2 | 0 |
| thematic_breaks.test | 4 | 0 | 0 |
| verbatim.test | 7 | 0 | 0 |

Different examples by cause:

- block structure differs: DJOT-definition_lists.test:6, DJOT-definition_lists.test:28, DJOT-tables.test:87
- writer cannot spell tree field: DJOT-definition_lists.test:49, DJOT-definition_lists.test:83, DJOT-footnotes.test:51, DJOT-headings.test:44, DJOT-links_and_images.test:9, DJOT-links_and_images.test:53, DJOT-links_and_images.test:148, DJOT-links_and_images.test:170, DJOT-links_and_images.test:200, DJOT-smart.test:112, DJOT-smart.test:145
- visible text differs: DJOT-filters.test:3, DJOT-filters.test:17, DJOT-footnotes.test:1, DJOT-footnotes.test:33, DJOT-footnotes.test:74, DJOT-links_and_images.test:86, DJOT-links_and_images.test:95, DJOT-links_and_images.test:109, DJOT-tables.test:54

## HTML rendered specification round trip

Cases: 371.

| Exact | Same meaning | Same rendering | Same text | Lossy |
| ---: | ---: | ---: | ---: | ---: |
| 103 | 4 | 217 | 34 | 13 |

Lossy examples: syntax-blocks.md:14, syntax-blocks.md:77, syntax-blocks.md:130, syntax-blocks.md:146, syntax-blocks.md:148, syntax-blocks.md:156, syntax-blocks.md:165, syntax-blocks.md:166, syntax-inline.md:88, html.md:29, html.md:13, html.md:14, html.md:26.
