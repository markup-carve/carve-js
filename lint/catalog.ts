// C2-W-106: generated from data/lint-rules.json by lint/generate-catalog.ts. Do not edit.
export const CATALOG = {
  "a11y/image-alt": { severity: "warning", default: "on", messages: [
    "image has empty alternative text and is not marked decorative",
  ], conditions: [
    "",
  ] },
  "bare-html-tag": { severity: "warning", default: "on", messages: [
    [
      "This bare HTML tag is escaped as text; use a raw HTML block if marku",
      "p is intended.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "bidi-control-in-source": { severity: "warning", default: "on", messages: [
    [
      "Bidi override/isolate control U+${code} is preserved by canonical Ca",
      "rve but not written to the text and code of presentation output; rem",
      "ove it unless intentional.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "blank-reference-label": { severity: "warning", default: "upgrade", messages: [
    [
      "This label holds only spaces, tabs or a line break, so it is no labe",
      "l and \"${text}\" stays text; 0.1 read it as a label. Give the label a",
      " character that is not whitespace.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "block-marker-as-text": { severity: "warning", default: "on", messages: [
    [
      "This line begins like ${what} but parsed as plain text - the block d",
      "id not open. Check this line's syntax and any unterminated fence abo",
      "ve it.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "block-opener-overindented": { severity: "warning", default: "on", messages: [
    [
      "This ${kind} is indented ${past} ${columns} past the content column ",
      "of ${owner}, and it still opens a ${kind}, measured from its own lin",
      "e. Remove the indentation to make the structure explicit, or escape ",
      "the opener to keep the line as text.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "block-opener-without-blank-line": { severity: "warning", default: "on", messages: [
    [
      "This line looks like ${opener} but directly follows text, so it is p",
      "art of the paragraph or caption above it. Add a blank line before it",
      ".",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "blockquote-marker-without-space": { severity: "warning", default: "on", messages: [
    [
      "A blockquote marker must be bare `>` or followed by a space. This li",
      "ne is literal text; write `> ${text}` to quote it.",
    ].join(''),
    [
      "This line is frontmatter content, not a blockquote. Close frontmatte",
      "r before a quote and write `> ${text}`.",
    ].join(''),
  ], conditions: [
    [
      "the line is paragraph, heading, cell, term, caption or line-block te",
      "xt outside frontmatter",
    ].join(''),
    "the line is inside frontmatter",
  ] },
  "braced-comment-in-a-template-source": { severity: "warning", default: "on", messages: [
    [
      "This braced comment is a template tag. Liquid, Nunjucks, or Twig sou",
      "rce may have reached Carve as text; the tag is parsed as an invisibl",
      "e comment.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "braced-span-opener-as-text": { severity: "warning", default: "on", messages: [
    [
      "This braced span did not open: the delimiter inside it closed a span",
      " that started before it. Escape that delimiter.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "broken-crossref": { severity: "warning", default: "on", messages: [
    [
      "Cross-reference </#${target}> names the id \"${id}\", which is on a ${",
      "kind}; a cross-reference reaches only headings and numbered captions",
      ", so it renders as the literal text \"</#${target}>\". Link to it with",
      " [text](#${id}).",
    ].join(''),
    [
      "Cross-reference </#${target}> matches no id; ${caseOnlyPhrase}, and ",
      "cross-references are case-sensitive, so it renders as the literal te",
      "xt \"</#${target}>\".",
    ].join(''),
    [
      "Cross-reference </#${target}> has no matching heading id; it renders",
      " as the literal text \"</#${target}>\".",
    ].join(''),
  ], conditions: [
    [
      "the target id exists exactly but belongs to a node that is not a hea",
      "ding or numbered caption",
    ].join(''),
    [
      "no qualifying id matches exactly, but one or more qualifying ids dif",
      "fer only in case",
    ].join(''),
    [
      "no qualifying id matches exactly or only by case, and no exact id be",
      "longs to a nonqualifying node",
    ].join(''),
  ] },
  "broken-fragment-link": { severity: "warning", default: "on", messages: [
    [
      "Link to \"${href}\" matches no id; the id \"${caseOnly}\" differs only i",
      "n case, and fragment links are case-sensitive, so the link goes nowh",
      "ere.",
    ].join(''),
    [
      "Link to \"${href}\" matches no id in this document, so the link goes n",
      "owhere.",
    ].join(''),
  ], conditions: [
    [
      "a rendered id differs only in case from the fragment as written or p",
      "ercent-decoded",
    ].join(''),
    [
      "no rendered id differs only in case from either the fragment as writ",
      "ten or percent-decoded",
    ].join(''),
  ] },
  "caption-looking-paragraph": { severity: "warning", default: "on", messages: [
    [
      "This caption-looking paragraph is above the table. Move it directly ",
      "below the table and start it with `^ ` to make a caption.",
    ].join(''),
    [
      "This caption-looking paragraph sits next to a table or image-looking",
      " marker; use a ^ caption line.",
    ].join(''),
  ], conditions: [
    "a pipe table starts one or two lines below this paragraph line",
    [
      "no pipe table starts one or two lines below, and a pipe table row or",
      " an image marker `![` occurs in one of the two lines above",
    ].join(''),
  ] },
  "carve-version-unsupported": { severity: "warning", default: "on", messages: [
    [
      "The declared Carve version \"${version}\" is not a dotted numeric vers",
      "ion. Write `0.2` as the value of this declaration, or remove it.",
    ].join(''),
    [
      "This engine implements 0.2; features of the declared ${version} vers",
      "ion may be unsupported. Write `carve: 0.2` only if the source uses 0",
      ".2 features.",
    ].join(''),
  ], conditions: [
    [
      "the selected declaration has a value that is not dot-separated decim",
      "al digits",
    ].join(''),
    [
      "the selected declaration has a dotted numeric version greater than 0",
      ".2",
    ].join(''),
  ] },
  "colon-fence-length-mismatch": { severity: "warning", default: "on", messages: [
    [
      "Bare ${authoredWidth}-colon fence does not close the innermost ${exp",
      "ectedWidth}-colon ${kind} opened at ${line}:${column}; it opens an a",
      "nonymous div.",
    ].join(''),
    [
      "Bare ${authoredWidth}-colon fence does not close the innermost ${exp",
      "ectedWidth}-colon ${kind} opened at ${line}:${column}; it closes an ",
      "enclosing container and every container inside it.",
    ].join(''),
    [
      "Bare ${authoredWidth}-colon fence has a different width from the inn",
      "ermost ${expectedWidth}-colon ${kind} opened at ${line}:${column}; i",
      "t closes the container.",
    ].join(''),
  ], conditions: [
    [
      "the bare run is shorter than the innermost opener and long enough fo",
      "r no open div",
    ].join(''),
    [
      "the bare run is shorter than the innermost opener and long enough fo",
      "r an enclosing open container",
    ].join(''),
    "the bare run is longer than the innermost opener",
  ] },
  "comment-fence-closer-with-text": { severity: "warning", default: "upgrade", messages: [
    [
      "This line starts with a percent run and holds other text, so it is c",
      "ontent of the comment block and does not close it. Put the closing r",
      "un alone on its line.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "comment-in-reference-label": { severity: "warning", default: "on", messages: [
    [
      "A line comment starts inside this reference label and takes the rest",
      " of the line, so the brackets are text. Move the comment out of the ",
      "label, or escape the percent signs.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "comment-line-in-line-block": { severity: "hint", default: "on", messages: [
    "A line comment is text inside a line block. Use the braced comment.",
  ], conditions: [
    "",
  ] },
  "comment-shaped-emphasis": { severity: "hint", default: "on", messages: [
    [
      "This span looks like a C comment; use Carve comment syntax if you me",
      "ant a comment.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "comment-splits-table-row": { severity: "hint", default: "on", messages: [
    [
      "This comment stands between a table row and its continuation, so it ",
      "belongs after the whole row. Move it above the row or below the cont",
      "inuation.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "consumed-key-near-miss": { severity: "warning", default: "on", messages: [
    "\"${word}\" is not a consumed key here; did you mean {${key}}?",
  ], conditions: [
    "",
  ] },
  "continuation-reading-changed": { severity: "warning", default: "upgrade", messages: [
    [
      "This indented line continues the definition above in 0.2; in 0.1 it ",
      "started a paragraph. Remove the indent to make it a separate block a",
      "gain.",
    ].join(''),
    [
      "This indented line continues the term above in 0.2; in 0.1 it starte",
      "d a paragraph. Remove the indent to make it a separate block again.",
    ].join(''),
    [
      "This line ends the caption above in 0.2; in 0.1 it continued the cap",
      "tion. Indent it past the caret to keep it in the caption.",
    ].join(''),
  ], conditions: [
    "the line continues a link definition or an abbreviation definition",
    "the line continues a term",
    [
      "the line stands directly below a caption and is not indented past it",
      "s caret",
    ].join(''),
  ] },
  "definition-in-container": { severity: "warning", default: "on", messages: [
    [
      "A definition is recognized only at column 0 outside every container,",
      " so this line is text. Put it at column 0 outside every container.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "definition-term-block-folded": { severity: "warning", default: "on", messages: [
    [
      "A quote mark or list marker after the term mark is term text. Put th",
      "e intended block on a `: ` description line at the list column, such",
      " as `: > text` or `: - item`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "delimited-table-wide-row": { severity: "warning", default: "on", messages: [
    [
      "A CSV/TSV record has more fields than the first record; the table ke",
      "eps the extra columns.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-bare-highlight": { severity: "warning", default: "upgrade", messages: [
    "A bare equals pair is text in 0.2. Write the braced highlight.",
  ], conditions: [
    "",
  ] },
  "deprecated-bare-strike": { severity: "warning", default: "upgrade", messages: [
    "A bare tilde pair is text in 0.2. Write the braced strike.",
  ], conditions: [
    "",
  ] },
  "deprecated-bare-underline": { severity: "warning", default: "upgrade", messages: [
    [
      "A bare underscore pair is text in 0.2. Write the braced underline, o",
      "r the slash pair for emphasis.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-cell-alignment": { severity: "warning", default: "upgrade", messages: [
    [
      "The table cell alignment prefix \"${prefix}\" is the deprecated 0.1.13",
      " spelling, removed in 0.2.0. Alignment symbols now lead the cell's a",
      "ttribute block: write \"${braced}\". In 0.2 the old prefix is cell tex",
      "t, so the formatter leaves it; the upgrade tool rewrites it.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-continuation-marker": { severity: "warning", default: "upgrade", messages: [
    [
      "The plus continuation marker was removed in 0.2 and is text here. If",
      " a block was intended, write that block after a blank line.",
    ].join(''),
    [
      "The plus continuation marker was removed in 0.2 and is text inside t",
      "his list item. Put the intended block after a blank line, indented p",
      "ast the list marker so it belongs to this item.",
    ].join(''),
    [
      "The plus continuation marker was removed in 0.2 and is text here. Pu",
      "t the intended block after a blank line, indented past the list mark",
      "er so it belongs to this item.",
    ].join(''),
  ], conditions: [
    "the `+` is a standalone line outside a list item",
    [
      "the `+` is a standalone line inside a list item but not its marker l",
      "ine",
    ].join(''),
    "the `+` is the text of a list item marker line",
  ] },
  "deprecated-indented-line-under-heading": { severity: "warning", default: "upgrade", messages: [
    [
      "This indented line directly below a heading is part of the heading i",
      "n 0.2; in 0.1 it started a paragraph. Remove the indent to make it a",
      " separate block again; if it then reads as a list marker or another ",
      "opener and a paragraph is meant, escape its first character.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-loose-attribute": { severity: "warning", default: "upgrade", messages: [
    [
      "The loose attribute was removed in 0.2 and is a plain attribute here",
      ". A list is loose when a blank line stands between two of its items.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-separator-row": { severity: "warning", default: "upgrade", messages: [
    [
      "The separator row was removed in 0.2 and is a row of dashes here. Ma",
      "rk the header cells with the header mark and delete this row.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-spaced-thematic-break": { severity: "warning", default: "upgrade", messages: [
    [
      "A spaced thematic break was removed in 0.2; this line is a list item",
      " (or text). Write the unspaced star form.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-substitution-arrow": { severity: "warning", default: "upgrade", messages: [
    [
      "The substitution arrow was removed in 0.2; this is a strike span. Wr",
      "ite a deletion directly followed by an insertion.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "deprecated-table-attribute": { severity: "warning", default: "upgrade", messages: [
    [
      "`header-rows` does not apply to a pipe table in 0.2. Mark header cel",
      "ls with the header mark and write alignment on the cells.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "description-separator-below-content-column": { severity: "warning", default: "on", messages: [
    [
      "This ${name} starts at column ${column}, below the column ${host.col",
      "umn} of the definition list above, so it adds no entry to that list.",
      " Indent it to column ${host.column} to continue the list.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "description-term-multi-line": { severity: "hint", default: "on", messages: [
    [
      "This line continues the term above, so its `:` is term text and open",
      "s no description. Put the description mark at the column of the term",
      " mark.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-definition-list": { severity: "hint", default: "upgrade", messages: [
    [
      "Djot reads a line that starts with `: ` as the term of a definition ",
      "list; Carve reads it as paragraph text. Write the term as `:: term` ",
      "and the definition as `: definition` on the line below it.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-emphasis-underscore": { severity: "warning", default: "upgrade", messages: [
    [
      "Djot emphasis `_x_` is literal text in Carve. Carve emphasis is `/x/",
      "`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-emphasis-underscore-braced": { severity: "hint", default: "upgrade", messages: [
    [
      "Djot emphasis `{_x_}` is underline in Carve. Carve emphasis is `/x/`",
      " or the braced `{/x/}`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-heading-continuation": { severity: "warning", default: "upgrade", messages: [
    [
      "Djot folds the line(s) below a heading INTO it (a plain line, or one",
      " with the same number of `#`); Carve takes only lines indented past ",
      "the heading marker into the heading (C2-B-154), so a line at the mar",
      "ker column starts a separate block. A generated heading id is comput",
      "ed from the shorter Carve heading, so it can differ from Djot's id.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-highlight-braces": { severity: "warning", default: "off", messages: [
    [
      "Djot highlight `{=x=}` is also Carve highlight. The bare `=x=` is li",
      "teral text in Carve.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-intraword-underscore": { severity: "warning", default: "upgrade", messages: [
    [
      "Djot emphasizes this intraword `_x_`; the migration leaves it litera",
      "l, so the emphasis is lost. Brace it as `{/x/}` if it was meant.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-ordered-marker": { severity: "hint", default: "upgrade", messages: [
    [
      "Djot reads this line as an ordered list item; Carve reads it as para",
      "graph text. Carve has no marker in parentheses such as `(1)`, and an",
      " uppercase marker with a dot needs two spaces before its text.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-plus-bullet": { severity: "warning", default: "upgrade", messages: [
    [
      "Djot/Markdown `+` bullet is not a Carve bullet, so this line is a pa",
      "ragraph. Write `-` or `*`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-subscript-tilde": { severity: "warning", default: "upgrade", messages: [
    [
      "Djot subscript `~x~` is literal text in Carve. Carve subscript is th",
      "e braced `{,x,}`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-subscript-tilde-braced": { severity: "warning", default: "upgrade", messages: [
    "Djot subscript `{~x~}` renders as *strikethrough* in Carve.",
  ], conditions: [
    "",
  ] },
  "djot-superscript-caret": { severity: "warning", default: "upgrade", messages: [
    [
      "Djot superscript `^x^` is literal text in Carve — Carve superscript ",
      "is the braced `{^x^}` only.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-tag-mention": { severity: "hint", default: "upgrade", messages: [
    [
      "Djot reads `#word` and `@word` as text; Carve reads them as a tag or",
      " a mention. Escape the sigil as `\\#` or `\\@` to keep it as text.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "djot-typography-sign": { severity: "hint", default: "upgrade", messages: [
    [
      "Djot keeps this run as typed; Carve smart typography writes it as a ",
      "sign. Escape its punctuation characters to keep it as typed.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "duplicate-reference-url": { severity: "warning", default: "off", messages: [
    "This reference definition repeats an earlier URL.",
  ], conditions: [
    "",
  ] },
  "emphasis-as-heading": { severity: "warning", default: "off", messages: [
    "This emphasized paragraph looks like a heading.",
  ], conditions: [
    "",
  ] },
  "emphasis-marker-before-attributes": { severity: "warning", default: "on", messages: [
    [
      "This ${ch} closes no span, so it and the attribute block after it st",
      "ay text. Brace the span you mean ({${ch}text${ch}}{…}) to attach the",
      " block, or escape the ${ch} to keep both as text.",
    ].join(''),
    [
      "This ${marker} closes the ${name} span that opens at line ${line}, c",
      "olumn ${column}, so the attribute block after it attaches to that wh",
      "ole span, which also holds a literal ${marker}. Brace the span you m",
      "ean ({${marker}text${marker}}{…}) or escape the inner ${marker} to m",
      "ake the pairing explicit.",
    ].join(''),
  ], conditions: [
    "the marker is text and closes no span",
    [
      "the marker closes a bare strong or emphasis span that holds an earli",
      "er literal copy of the marker",
    ].join(''),
  ] },
  "empty-include-path": { severity: "warning", default: "on", messages: [
    [
      "This \"${text}\" looks like an include directive with no path, so it r",
      "enders as literal text. Add a path (for example {{ chapter.crv }}) o",
      "r remove the braces.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "empty-link-destination": { severity: "warning", default: "on", messages: [
    "This link has an empty destination.",
  ], conditions: [
    "",
  ] },
  "empty-reference-definition": { severity: "warning", default: "on", messages: [
    [
      "This line is a label and colon with no destination, so it is text an",
      "d defines no link. Add a destination after the colon, or remove the ",
      "line.",
    ].join(''),
    [
      "This line is a footnote label and colon with no body, so it is text ",
      "and defines no footnote. Add body content after the colon, or remove",
      " the line.",
    ].join(''),
  ], conditions: [
    "the empty definition has a link label without a leading `^`",
    "the empty definition has a footnote label beginning with `^`",
  ] },
  "fence-closer-indented": { severity: "hint", default: "on", messages: [
    [
      "This line closes the block opened on line (n) although it is indente",
      "d differently. If it is content, make the outer fence longer.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "figure-group-empty": { severity: "warning", default: "on", messages: [
    [
      "This \"::: figure\" group holds no captionable panel; the panels wrapp",
      "er renders around the preserved content only.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "figure-group-nested": { severity: "warning", default: "on", messages: [
    [
      "A \"::: figure\" inside a composite figure does not nest; it renders a",
      "s a generic container. Move it out of the enclosing group.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "figure-group-opener-metadata": { severity: "warning", default: "on", messages: [
    [
      "A \"::: figure\" opener carrying a quoted title or [label] is not a fi",
      "gure group; it is a plain container with the class \"figure\" (C2-B-12",
      "7). Drop the title or label to open a figure group, and use a captio",
      "n line below it.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "figure-group-panel-number": { severity: "warning", default: "on", messages: [
    [
      "A \"#\" placeholder in a panel caption stays literal: panels are not n",
      "umbering units, the group caption carries the number (and panel ids ",
      "resolve with its letter).",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "figure-group-single-panel": { severity: "warning", default: "on", messages: [
    [
      "This \"::: figure\" group holds a single panel; a plain captioned figu",
      "re renders the same content without the group wrapper.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "footnote-labels-differ-only-in-whitespace": { severity: "warning", default: "on", messages: [
    [
      "Footnote definition [^${label}] normalizes to the same key as [^${tw",
      "in}]; the first definition wins. Normalized key: \"${key}\".",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "footnotes-placement-in-container": { severity: "warning", default: "on", messages: [
    [
      "This \"::: footnotes\" marker is inside a container, where it does not",
      " place: it renders as a plain typed div and the endnotes section goe",
      "s where it would without the marker. Move the marker to document lev",
      "el, or delete it to accept the default position.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "frontmatter-crossref": { severity: "error", default: "on", messages: [
    [
      "Cross-reference </#${target}> names a metadata key, which has no HTM",
      "L target. Read the block through the tree instead.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "frontmatter-shaped-thematic-break": { severity: "warning", default: "on", messages: [
    [
      "Three hyphens on line 1 open frontmatter, not a thematic break. Writ",
      "e three stars for a break.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "github-alert-marker": { severity: "warning", default: "on", messages: [
    [
      "This spelling does not create a GitHub alert in Carve; use an admoni",
      "tion fence for an alert.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "glob-shaped-strong": { severity: "hint", default: "on", messages: [
    [
      "This strong span looks like a file glob; escape the asterisk if you ",
      "meant a glob.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "heading-closing-hashes": { severity: "warning", default: "on", messages: [
    [
      "The closing \"${run}\" run is heading text in Carve, not a closing mar",
      "ker. Delete it.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "heading-level-skip": { severity: "warning", default: "on", messages: [
    [
      "This heading skips from level ${previous} to ${level}; use the next ",
      "heading level for a continuous outline.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "heading-marker-mixed": { severity: "hint", default: "on", messages: [
    [
      "This document mixes the two heading markers. carve fmt rewrites the ",
      "hash to the equals sign.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "heading-trailing-attribute": { severity: "warning", default: "on", messages: [
    [
      "Trailing \"${block}\" on a heading is literal text in Carve, not an at",
      "tribute block. Move it to a \"${block}\" line directly above the headi",
      "ng.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "html-comment-renders-as-text": { severity: "warning", default: "on", messages: [
    [
      "This HTML comment renders as visible text. Use %% for one line or %%",
      "% for a comment block.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "include-attributes-unused": { severity: "warning", default: "on", messages: [
    [
      "The attributes above this include apply to nothing, because it has n",
      "o @code option. Remove them or move them into the included file.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "include-lines-table-rows-hint": { severity: "hint", default: "on", messages: [
    [
      "@lines counts physical lines. Use @rows to select records of this ta",
      "ble.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "indented-code-block": { severity: "warning", default: "on", messages: [
    [
      "Four-space indentation does not make a code block in Carve; this ren",
      "ders as a paragraph. Use a ``` fence.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "link-definition-indented-line": { severity: "hint", default: "on", messages: [
    [
      "This indented line is not a title or attribute block, so it does not",
      " continue the link definition above; it starts a new block.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "link-gap-before-destination": { severity: "warning", default: "on", messages: [
    [
      "The gap after this label prevents the parenthesized destination from",
      " attaching; write `](` with no space for an inline link. A defined s",
      "hortcut reference can still resolve the label.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "list-item-block-overindented": { severity: "warning", default: "on", messages: [
    [
      "This block opener is past the list item's canonical content column $",
      "{contentColumn}; it now parses structurally and the formatter will c",
      "anonicalize it. Dedent it to column ${contentColumn} for an explicit",
      " structural spelling, or escape the opener to preserve the literal m",
      "eaning used by older readers.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "list-item-body-below-content-column": { severity: "hint", default: "on", messages: [
    [
      "This line is indented past the list marker but short of the item's t",
      "ext, and it belongs to the item. Indent it to the text, or move it t",
      "o the column of the list to end the item.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "list-marker-below-content-column": { severity: "warning", default: "on", messages: [
    [
      "This list marker starts at column ${column}, between the columns of ",
      "two open lists, so it is read at the column of the deeper list. Star",
      "t it at column ${contentColumn} to make that explicit, or at column ",
      "${baseColumn} to put it in the outer list.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "list-marker-without-blank-line": { severity: "warning", default: "on", messages: [
    [
      "This list marker is part of the preceding paragraph; add a blank lin",
      "e before the list.",
    ].join(''),
    [
      "This list marker directly follows term or description text and is pa",
      "rt of that text; add a blank line before the list.",
    ].join(''),
  ], conditions: [
    "the marker is paragraph text",
    "the marker is term or description text",
  ] },
  "markdown-definition-paragraph": { severity: "warning", default: "on", messages: [
    [
      "This markdown definition remains paragraph text; use a :: term line ",
      "before the definition.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "markdown-strikethrough-double-tilde": { severity: "warning", default: "on", messages: [
    [
      "Markdown `~~strikethrough~~` is literal text in Carve. Carve striket",
      "hrough is the braced `{~x~}`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "markdown-strong-double-star": { severity: "warning", default: "on", messages: [
    [
      "Markdown `**strong**` is literal text in Carve, asterisks included. ",
      "Carve strong is a single `*`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "non-descriptive-link-text": { severity: "warning", default: "off", messages: [
    "Use descriptive link text or a specific aria-label.",
  ], conditions: [
    "",
  ] },
  "ordered-list-kind-split": { severity: "warning", default: "on", messages: [
    [
      "This one-letter marker fixes its list style, so the next marker star",
      "ts another list.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "ordered-marker-right-aligned": { severity: "warning", default: "on", messages: [
    [
      "This marker sits left of its list, so it is a sibling item that move",
      "s the list's column. Write the ordered markers left-aligned, as the ",
      "formatter does.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "platform-issue-reference": { severity: "warning", default: undefined, messages: [
    [
      "${host} re-linkifies a hash-number in published output, so \"${text}\"",
      " becomes a link that notifies or references something unrelated; mov",
      "e the example into a fenced code block, or rewrite it as \"item 1\" / ",
      "\"point 1\".",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "platform-mention-token": { severity: "warning", default: undefined, messages: [
    [
      "${host} re-linkifies an at-prefixed word in published output, so \"${",
      "text}\" becomes a link that notifies or references something unrelate",
      "d; move the example into a fenced code block, or strip the sigil and",
      " rephrase.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "quote-fence-ends-the-quote-above": { severity: "warning", default: "on", messages: [
    [
      "A \"::: >\" opener ENDS that quote and opens a sibling one; the two re",
      "nder as adjacent blockquotes, not one nested in the other. Write \"> ",
      "::: >\" to nest it, or leave a blank line to make two quotes delibera",
      "te.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "references-placement-in-container": { status: "void", severity: "warning", default: "on", messages: [
    [
      "This \"::: references\" marker is inside a container and does not plac",
      "e the reference list. Move it to document level, or remove it if no ",
      "placement is needed.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "region-marker-renders-as-text": { severity: "warning", default: "on", messages: [
    [
      "This line renders as text and is not a region marker for a Carve inc",
      "lude. Write `%% #region name` for a region start or `%% #endregion` ",
      "for its end.",
    ].join(''),
    [
      "This line is a comment and renders nothing, but it is not a region m",
      "arker. Write the case-sensitive keyword `%% #region name` or `%% #en",
      "dregion`.",
    ].join(''),
  ], conditions: [
    "the candidate is not a `%%` line comment",
    [
      "the candidate is a `%%` line comment with a keyword in the wrong let",
      "ter case",
    ].join(''),
  ] },
  "semantic-attribute-outside-span": { severity: "warning", default: "on", messages: [
    [
      "\"${name}\" is a semantic span attribute (PART 9 §10) and only applies",
      " to an ordinary [content]{attrs} span; on ${type} it stays a raw att",
      "ribute and is subject to HTML attribute filtering.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "semantic-attribute-value-ignored": { severity: "warning", default: "on", messages: [
    [
      "Value on the semantic attribute \"${name}\" is discarded: it selects t",
      "he <${name}> element and reaches no output. Only abbr and time carry",
      " a value (as title or datetime).",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "setext-heading-underline": { severity: "warning", default: "on", messages: [
    [
      "Carve has no underline heading: this marker run is text. Write the h",
      "eading with a leading `=`.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "sigil-after-letter": { severity: "hint", default: "upgrade", messages: [
    [
      "A mention or tag does not start directly after a letter or number. P",
      "ut a space or punctuation before it.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-attribute-invalid": { severity: "warning", default: "on", messages: [
    [
      "The value of ${key} is not valid, so the table ignores the whole att",
      "ribute. Correct every entry, or remove the attribute.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-column-arity": { severity: "warning", default: "on", messages: [
    [
      "${key} supplies ${count} column entries for a ${widest}-column table",
      "; the unset tail is valid but may be accidental.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-column-overlap": { severity: "warning", default: "on", messages: [
    [
      "Column ${n} supplies the same alignment axis both in the table and i",
      "n a table attribute; the in-table marker wins.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-marker-run-padding": { severity: "warning", default: "on", messages: [
    [
      "\"${spelling}\" attaches the cell attribute block, but the following \"",
      "${marker}\" is text and does not align the cell. Write \"${correctedPr",
      "efix}\" with the marker inside the first brace block to align it, or ",
      "\"${block} ${marker}\" to keep the mark as text.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-row-attribute-as-cell": { severity: "warning", default: "on", messages: [
    [
      "A row attribute is the brace block glued after the closing pipe. Her",
      "e it is cell content.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-row-cell-count": { severity: "warning", default: "on", messages: [
    [
      "This table row has ${cells} cells; the first row has ${width}. Add o",
      "r remove a cell to match the table.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-row-count-clamped": { severity: "hint", default: "on", messages: [
    [
      "${key}=${count} asks for more rows than the table has, so it takes $",
      "{effective}. Write ${key}=${effective}.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-row-without-closing-pipe": { status: "void", severity: "hint", default: undefined, messages: [
    [
      "This row has no closing pipe. carve fmt adds it; escape the first pi",
      "pe if the line is text.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-shaped-paragraph": { severity: "warning", default: "on", messages: [
    [
      "This table-shaped line lacks a closing pipe and stays as ${owner} te",
      "xt. If a table row was intended, write a complete row where a table ",
      "can start.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "table-span-marker-attribute": { severity: "warning", default: "on", messages: [
    [
      "This \"${marker}\" joins the cell ${direction}, so its attribute block",
      " applies to no cell and carve fmt drops it. Move the attributes to t",
      "he cell it joins, or remove them.",
    ].join(''),
    [
      "This \"${marker}\" joins the cell ${direction}, and its header mark ma",
      "kes no head row, so it marks no cell and carve fmt drops it. Remove ",
      "the \"=\", or make the row a head row.",
    ].join(''),
  ], conditions: [
    "the joining span mark has a brace block in its prefix",
    [
      "the joining span mark has a header mark in its prefix that makes no ",
      "head row, and no brace block in its prefix",
    ].join(''),
  ] },
  "table-span-marker-blocked": { severity: "warning", default: "on", messages: [
    [
      "The \"<\" span marker cannot extend a cell. There is no cell to its le",
      "ft in its row. It is a cell that holds \"<\" as text; escape it as \"\\<",
      "\" to say so, or remove it.",
    ].join(''),
    [
      "The \"<\" span marker cannot extend a cell. The cell to its left is co",
      "vered by a row span from above. It is a cell that holds \"<\" as text;",
      " escape it as \"\\<\" to say so, or remove it.",
    ].join(''),
    [
      "The \"^\" span marker cannot extend a cell. It stands in the first row",
      " of its group: head, body or foot. It is a cell that holds \"^\" as te",
      "xt; escape it as \"\\^\" to say so, or remove it.",
    ].join(''),
    [
      "The \"^\" span marker cannot extend a cell. The cell above it spans mo",
      "re than one column. It is a cell that holds \"^\" as text; escape it a",
      "s \"\\^\" to say so, or remove it.",
    ].join(''),
  ], conditions: [
    "the `<` stands in the first column",
    "the cell to the left of the `<` is covered by a row span from above",
    "the `^` stands in the first row of its group",
    "the cell above the `^` spans more than one column",
  ] },
  "table-width-total": { severity: "warning", default: "on", messages: [
    "The specified table column widths total more than 100%.",
  ], conditions: [
    "",
  ] },
  "thematic-break-spelling": { severity: "hint", default: "upgrade", messages: [
    [
      "This line of \"${raw}\" is text in Carve 0.2. Write \"***\" for a themat",
      "ic break.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "tight-list-item-with-blank-line": { severity: "hint", default: "upgrade", messages: [
    [
      "A blank line inside an item no longer makes the list loose. Put a bl",
      "ank line between the items if every item should render as a paragrap",
      "h.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "unattached-block-attribute": { severity: "warning", default: "on", messages: [
    [
      "This attribute line reaches no block: a blank line or the end of its",
      " container follows, so the line is text (C2-B-192). Move it directly",
      " above the block it describes, or delete it.",
    ].join(''),
    [
      "A blank line follows this attribute line, so it is text. Remove the ",
      "blank line if you mean to attach it to a following block.",
    ].join(''),
  ], conditions: [
    [
      "the attribute line reaches the end of its container or document with",
      "out a following blank line",
    ].join(''),
    [
      "a blank line follows the attribute line in its container, whether or",
      " not a block follows that blank line",
    ].join(''),
  ] },
  "unattached-caption": { severity: "warning", default: "on", messages: [
    [
      "This caption line is not directly below an image, table, code block,",
      " quote, math block, figure group or code include, so it is text. If ",
      "a blank line separates it from such a block, remove the blank line; ",
      "otherwise escape the caret.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "unattached-inline-attribute": { severity: "hint", default: "on", messages: [
    [
      "This attribute block is attached to nothing and renders as text. Glu",
      "e it to a span, link or code span, or escape the brace.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "unclosed-braced-comment": { severity: "warning", default: "on", messages: [
    [
      "This braced comment is not closed before the next block starts, so i",
      "t stays text. Close it inside its block, or use %% line comments.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "unclosed-inline-emphasis": { severity: "warning", default: "on", messages: [
    "This ${span} opener is unclosed in its paragraph; add a closer.",
  ], conditions: [
    "",
  ] },
  "uneven-list-indent": { severity: "warning", default: "on", messages: [
    [
      "This marker stands left of every open list and continues the list ab",
      "ove it. Align it with the markers of that list.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "unresolved-footnote": { severity: "warning", default: "on", messages: [
    [
      "Footnote reference [^${id}] has no matching definition; it renders a",
      "s literal text.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "unresolved-reference-link": { severity: "warning", default: "on", messages: [
    [
      "Reference link ${rawRef} matches no link definition or heading; ${ca",
      "seOnlyPhrase}, and reference labels are case-sensitive, so its brack",
      "ets and label remain literal, while link-text children render normal",
      "ly.",
    ].join(''),
    [
      "Reference link ${rawRef} has no matching link definition or heading;",
      " its brackets and label remain literal, while link-text children ren",
      "der normally.",
    ].join(''),
    [
      "Reference image ${rawRef} matches no link definition; ${caseOnlyPhra",
      "se}, and reference labels are case-sensitive, so its marker, bracket",
      "s, label and alt text render as literal text.",
    ].join(''),
    [
      "Reference image ${rawRef} has no matching link definition; its marke",
      "r, brackets, label and alt text render as literal text.",
    ].join(''),
  ], conditions: [
    [
      "the unresolved reference is a link and a label or heading differs fr",
      "om its key only in case",
    ].join(''),
    [
      "the unresolved reference is a link with no label or heading that dif",
      "fers only in case",
    ].join(''),
    [
      "the unresolved reference is an image and a link definition label dif",
      "fers from its key only in case",
    ].join(''),
    [
      "the unresolved reference is an image with no link definition label t",
      "hat differs only in case",
    ].join(''),
  ] },
  "unused-footnote-definition": { severity: "warning", default: "on", messages: [
    [
      "Footnote definition [^${label}] is never referenced, so it is omitte",
      "d from the rendered document.",
    ].join(''),
  ], conditions: [
    "",
  ] },
  "unused-link-reference-definition": { severity: "warning", default: "on", messages: [
    "This link reference definition is unused.",
  ], conditions: [
    "",
  ] },
} as const

export type RuleId = keyof typeof CATALOG
