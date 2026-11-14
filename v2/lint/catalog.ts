// C2-W-106: copied from spec/0.2/data/lint-rules.json.
export const CATALOG = {
  "a11y/image-alt": { severity: "warning", default: "on", messages: [
    ["image has empty alternative text and is not marked decorative"].join(''),
  ] },
  "bare-html-tag": { severity: "warning", default: "on", messages: [
    ["This bare HTML tag is escaped as text; use a raw HTML block if markup ", "is intended."].join(''),
  ] },
  "bidi-control-in-source": { severity: "warning", default: "on", messages: [
    ["Bidi override/isolate control U+${code} is preserved by canonical Carv", "e but not written to the text and code of presentation output; remove ", "it unless intentional."].join(''),
  ] },
  "block-marker-as-text": { severity: "warning", default: "on", messages: [
    ["This line begins like ${what} but parsed as plain text - the block did", " not open. Check this line's syntax and any unterminated fence above i", "t."].join(''),
  ] },
  "block-opener-overindented": { severity: "warning", default: "on", messages: [
    ["This ${kind} is indented ${past} column(s) past the content column of ", "${owner}, and it still opens a ${kind}, measured from its own line. Re", "move the indentation to make the structure explicit, or escape the ope", "ner to keep the line as text."].join(''),
  ] },
  "block-opener-without-blank-line": { severity: "warning", default: "on", messages: [
    ["This line looks like a (kind) but directly follows text, so it is part", " of the paragraph or caption above it. Add a blank line before it."].join(''),
  ] },
  "blockquote-marker-without-space": { severity: "warning", default: "on", messages: [
    ["A blockquote marker must be either bare \">\" or followed by a space. Th", "is line renders as literal text; write \"> ${text}\" to quote it."].join(''),
  ] },
  "braced-comment-in-a-template-source": { severity: "warning", default: "on", messages: [
    ["This braced comment is a template tag. Liquid, Nunjucks, or Twig sourc", "e may have reached Carve as text; the tag is parsed as an invisible co", "mment."].join(''),
  ] },
  "braced-span-opener-as-text": { severity: "warning", default: "on", messages: [
    ["This braced span did not open: the delimiter inside it closed a span t", "hat started before it. Escape that delimiter."].join(''),
  ] },
  "broken-crossref": { severity: "warning", default: "on", messages: [
    ["Cross-reference </#${target}> matches no id; ${caseOnlyPhrase}, and cr", "oss-references are case-sensitive, so it renders as the literal text \"", "</#${target}>\"."].join(''),
    ["Cross-reference </#${target}> names the id \"${id}\", which is on a ${ki", "nd}; a cross-reference reaches only headings and numbered captions, so", " it renders as the literal text \"</#${target}>\". Link to it with [text", "](#${id})."].join(''),
    ["Cross-reference </#${target}> has no matching heading id; it renders a", "s the literal text \"</#${target}>\"."].join(''),
  ] },
  "broken-fragment-link": { severity: "warning", default: "on", messages: [
    ["Link to \"${href}\" matches no id; the id \"${caseOnly}\" differs only in ", "case, and fragment links are case-sensitive, so the link goes nowhere."].join(''),
    ["Link to \"${href}\" matches no id in this document, so the link goes now", "here."].join(''),
  ] },
  "caption-looking-paragraph": { severity: "warning", default: "on", messages: [
    ["This caption-looking paragraph sits next to a table or image; use a ^ ", "caption line."].join(''),
  ] },
  "carve-version-unsupported": { severity: "warning", default: "on", messages: [
    ["document declares Carve ${version}; this engine implements ${SPEC_VERS", "ION}, so constructs added after that version will not render as intend", "ed"].join(''),
    ["document declares an unrecognized Carve version ${version}; this engin", "e implements ${SPEC_VERSION}"].join(''),
  ] },
  "colon-fence-length-mismatch": { severity: "warning", default: "on", messages: [
    ["Bare ${authoredWidth}-colon fence does not close the innermost ${expec", "tedWidth}-colon ${kind} opened at ${line}:${column}; it ${outcome}."].join(''),
  ] },
  "comment-fence-closer-with-text": { severity: "warning", default: "on", messages: [
    ["This line starts with a percent run and holds other text, so it is con", "tent of the comment block and does not close it. Put the closing run a", "lone on its line."].join(''),
  ] },
  "comment-in-reference-label": { severity: "warning", default: "on", messages: [
    ["A line comment starts inside this reference label and takes the rest o", "f the line, so the brackets are text. Move the comment out of the labe", "l, or escape the percent signs."].join(''),
  ] },
  "comment-line-in-line-block": { severity: "hint", default: "on", messages: [
    ["A line comment is text inside a line block. Use the braced comment."].join(''),
  ] },
  "comment-shaped-emphasis": { severity: "hint", default: "on", messages: [
    ["This emphasis looks like a C comment; use Carve comment syntax if you ", "meant a comment."].join(''),
  ] },
  "consumed-key-near-miss": { severity: "warning", default: "on", messages: [
    ["\"${word}\" is not a consumed key here; did you mean {${key}}?"].join(''),
  ] },
  "definition-in-container": { severity: "warning", default: "on", messages: [
    ["A definition is recognized only at column 0 outside every container, s", "o this line is text. Move it to the top level."].join(''),
  ] },
  "definition-term-block-folded": { severity: "warning", default: "on", messages: [
    ["This block opener is indented under a definition term, which has no co", "ntent column, so it folds into the term as text (a fence line or a tab", "le row does not fold: it closes the description list). Dedent it to th", "e container's content column to open the block, or put it in the term'", "s \": \" description."].join(''),
  ] },
  "delimited-table-wide-row": { severity: "warning", default: "on", messages: [
    ["A CSV/TSV record has more fields than the first record; the table keep", "s the extra columns."].join(''),
  ] },
  "deprecated-bare-highlight": { severity: "warning", default: "on", messages: [
    ["A bare equals pair is text in 0.2. Write the braced highlight."].join(''),
  ] },
  "deprecated-bare-strike": { severity: "warning", default: "on", messages: [
    ["A bare tilde pair is text in 0.2. Write the braced strike."].join(''),
  ] },
  "deprecated-bare-underline": { severity: "warning", default: "on", messages: [
    ["A bare underscore pair is text in 0.2. Write the braced underline, or ", "the slash pair for emphasis."].join(''),
  ] },
  "deprecated-cell-alignment": { severity: "warning", default: "on", messages: [
    ["The table cell alignment prefix \"${prefix}\" is the deprecated 0.1.13 s", "pelling, removed in 0.2.0. Alignment symbols now lead the cell's attri", "bute block: write \"${braced}\". In 0.2 the old prefix is cell text, so ", "the formatter leaves it; the upgrade tool rewrites it."].join(''),
  ] },
  "deprecated-continuation-marker": { severity: "warning", default: "on", messages: [
    ["The plus continuation marker was removed in 0.2 and is text here. Put ", "the block after a blank line, indented past the list marker."].join(''),
  ] },
  "deprecated-indented-line-under-heading": { severity: "warning", default: "on", messages: [
    ["This indented line directly below a heading is part of the heading in ", "0.2; in 0.1 it started a paragraph. Remove the indent to make it a sep", "arate block again; if it then reads as a list marker or another opener", " and a paragraph is meant, escape its first character."].join(''),
  ] },
  "deprecated-loose-attribute": { severity: "warning", default: "on", messages: [
    ["The loose attribute was removed in 0.2 and is a plain attribute here. ", "A list is loose when a blank line stands between two of its items."].join(''),
  ] },
  "deprecated-separator-row": { severity: "warning", default: "on", messages: [
    ["The separator row was removed in 0.2 and is a row of dashes here. Mark", " the header cells with the header mark and delete this row."].join(''),
  ] },
  "deprecated-spaced-thematic-break": { severity: "warning", default: "on", messages: [
    ["A spaced thematic break was removed in 0.2; this line is a list item (", "or text). Write the unspaced star form."].join(''),
  ] },
  "deprecated-substitution-arrow": { severity: "warning", default: "on", messages: [
    ["The substitution arrow was removed in 0.2; this is a strike span. Writ", "e a deletion directly followed by an insertion."].join(''),
  ] },
  "deprecated-table-attribute": { severity: "warning", default: "on", messages: [
    ["(key) does not apply to a pipe table in 0.2. Mark header cells with th", "e header mark and write alignment on the cells."].join(''),
  ] },
  "description-separator-below-content-column": { severity: "warning", default: "on", messages: [
    ["This ${name} starts at column ${column}, below the column ${host.colum", "n} of the definition list above, so it adds no entry to that list. Ind", "ent it to column ${host.column} to continue the list."].join(''),
  ] },
  "description-term-multi-line": { severity: "hint", default: "on", messages: [
    ["This line continues the term above. Add a blank line after the term if", " it is a paragraph."].join(''),
  ] },
  "djot-emphasis-underscore": { severity: "warning", default: "off", messages: [
    ["Djot emphasis `_x_` is literal text in Carve. Carve emphasis is `/x/`."].join(''),
  ] },
  "djot-heading-continuation": { severity: "warning", default: "off", messages: [
    ["Djot folds the line(s) below a heading INTO it (a plain line, or one w", "ith the same number of `#`); Carve takes only lines indented past the ", "heading marker into the heading (C2-B-154), so a line at the marker co", "lumn is a separate block and the heading id changes."].join(''),
  ] },
  "djot-highlight-braces": { severity: "warning", default: "off", messages: [
    ["Djot highlight `{=x=}` is also Carve highlight. The bare `=x=` is lite", "ral text in Carve."].join(''),
  ] },
  "djot-intraword-underscore": { severity: "warning", default: "off", messages: [
    ["Djot emphasizes this intraword `_x_`; the migration leaves it literal,", " so the emphasis is lost. Brace it as `{/x/}` if it was meant."].join(''),
  ] },
  "djot-plus-bullet": { severity: "warning", default: "off", messages: [
    ["Djot/Markdown `+` bullet is not a Carve bullet, so this line is a para", "graph. Write `-` or `*`."].join(''),
  ] },
  "djot-subscript-tilde": { severity: "warning", default: "off", messages: [
    ["Djot subscript `~x~` is literal text in Carve. Carve subscript is the ", "braced `{,x,}`."].join(''),
  ] },
  "djot-subscript-tilde-braced": { severity: "warning", default: "off", messages: [
    ["Djot subscript `{~x~}` renders as *strikethrough* in Carve."].join(''),
  ] },
  "djot-superscript-caret": { severity: "warning", default: "off", messages: [
    ["Djot superscript `^x^` is literal text in Carve — Carve superscript is", " the braced `{^x^}` only."].join(''),
  ] },
  "duplicate-reference-url": { severity: "warning", default: "on", messages: [
    ["This reference definition repeats an earlier URL."].join(''),
  ] },
  "emphasis-as-heading": { severity: "warning", default: "on", messages: [
    ["This emphasized paragraph looks like a heading."].join(''),
  ] },
  "emphasis-marker-before-attributes": { severity: "warning", default: "on", messages: [
    ["This ${ch} closes no span, so it and the attribute block after it stay", " text. Brace the span you mean ({${ch}text${ch}}{…}) to attach the blo", "ck, or escape the ${ch} to keep both as text."].join(''),
    ["This ${marker} closes the ${name} span that opens at line ${line}, col", "umn ${column}, so the attribute block after it attaches to that whole ", "span, which also holds a literal ${marker}. Brace the span you mean ({", "${marker}text${marker}}{…}) or escape the inner ${marker} to make the ", "pairing explicit."].join(''),
  ] },
  "empty-include-path": { severity: "warning", default: "on", messages: [
    ["This \"${text}\" looks like an include directive with no path, so it ren", "ders as literal text. Add a path (for example {{ chapter.crv }}) or re", "move the braces."].join(''),
  ] },
  "empty-link-destination": { severity: "warning", default: "on", messages: [
    ["This link has an empty destination."].join(''),
  ] },
  "empty-reference-definition": { severity: "warning", default: "on", messages: [
    ["This line is a label and a colon with nothing after it, so it is text ", "and defines nothing. Add a destination, or remove the line."].join(''),
  ] },
  "fence-closer-indented": { severity: "hint", default: "on", messages: [
    ["This line closes the block opened on line (n) although it is indented ", "differently. If it is content, make the outer fence longer."].join(''),
  ] },
  "figure-group-empty": { severity: "warning", default: "on", messages: [
    ["This \"::: figure\" group holds no captionable panel; the panels wrapper", " renders around the preserved content only."].join(''),
  ] },
  "figure-group-nested": { severity: "warning", default: "on", messages: [
    ["A \"::: figure\" inside a figure group is a figure group of its own and ", "not a panel of the outer group. Move it out of the enclosing group."].join(''),
  ] },
  "figure-group-opener-metadata": { severity: "warning", default: "on", messages: [
    ["A \"::: figure\" opener carrying a quoted title or [label] is not a figu", "re group; it is a plain container with the class \"figure\" (C2-B-127). ", "Drop the title or label to open a figure group, and use a caption line", " below it."].join(''),
  ] },
  "figure-group-panel-number": { severity: "warning", default: "on", messages: [
    ["A \"#\" placeholder in a panel caption stays literal: panels are not num", "bering units, the group caption carries the number (and panel ids reso", "lve with its letter)."].join(''),
  ] },
  "figure-group-single-panel": { severity: "warning", default: "on", messages: [
    ["This \"::: figure\" group holds a single panel; a plain captioned figure", " renders the same content without the group wrapper."].join(''),
  ] },
  "footnote-labels-differ-only-in-whitespace": { severity: "warning", default: "on", messages: [
    ["Footnote definition [^${label}] normalizes to the same key as [^${twin", "}]; the first definition wins. Normalized key: ${key}."].join(''),
  ] },
  "footnotes-placement-in-container": { severity: "warning", default: "on", messages: [
    ["This \"::: footnotes\" marker is inside a container, where it does not p", "lace: it renders as a plain typed div and the endnotes section goes wh", "ere it would without the marker. Move the marker to document level, or", " delete it to accept the default position."].join(''),
  ] },
  "frontmatter-shaped-thematic-break": { severity: "warning", default: "on", messages: [
    ["Three hyphens on line 1 open frontmatter, not a thematic break. Write ", "three stars for a break."].join(''),
  ] },
  "github-alert-marker": { severity: "warning", default: "on", messages: [
    ["This github alert marker stays literal in a Carve quote; use an admoni", "tion fence."].join(''),
  ] },
  "glob-shaped-strong": { severity: "hint", default: "on", messages: [
    ["This strong span looks like a file glob; escape the asterisk if you me", "ant a glob."].join(''),
  ] },
  "heading-closing-hashes": { severity: "warning", default: "on", messages: [
    ["The closing \"${run}\" run is heading text in Carve, not a closing marke", "r. Delete it."].join(''),
  ] },
  "heading-level-skip": { severity: "warning", default: "on", messages: [
    ["This heading skips from level ${previous} to ${level}; use the next he", "ading level for a continuous outline."].join(''),
  ] },
  "heading-marker-mixed": { severity: "hint", default: "on", messages: [
    ["This document mixes the two heading markers. carve fmt rewrites the ha", "sh to the equals sign."].join(''),
  ] },
  "heading-trailing-attribute": { severity: "warning", default: "on", messages: [
    ["Trailing \"${block}\" on a heading is literal text in Carve, not an attr", "ibute block. Move it to a \"${block}\" line directly above the heading."].join(''),
  ] },
  "html-comment-renders-as-text": { severity: "warning", default: "on", messages: [
    ["This HTML comment renders as visible text. Use %% for one line or %%% ", "for a comment block."].join(''),
  ] },
  "indented-code-block": { severity: "warning", default: "on", messages: [
    ["Four-space indentation does not make a code block in Carve; this rende", "rs as a paragraph. Use a ``` fence."].join(''),
  ] },
  "link-gap-before-destination": { severity: "warning", default: "on", messages: [
    ["The gap after this link label keeps the link as text; write ]( with no", " space."].join(''),
  ] },
  "list-item-block-overindented": { severity: "warning", default: "on", messages: [
    ["This block opener is past the list item's canonical content column ${c", "ontentColumn}; it now parses structurally and the formatter will canon", "icalize it. Dedent it to column ${contentColumn} for an explicit struc", "tural spelling, or escape the opener to preserve the literal meaning u", "sed by older readers."].join(''),
  ] },
  "list-item-body-below-content-column": { severity: "hint", default: "on", messages: [
    ["This line is indented past the list marker but short of the item's tex", "t, and it belongs to the item. Indent it to the text, or move it to th", "e column of the list to end the item."].join(''),
  ] },
  "list-marker-below-content-column": { severity: "warning", default: "on", messages: [
    ["This list marker starts at column ${column}, between the columns of tw", "o open lists, so it joins the deeper list. Start it at column ${conten", "tColumn} to make that explicit, or at column ${baseColumn} to put it i", "n the outer list."].join(''),
  ] },
  "list-marker-without-blank-line": { severity: "warning", default: "on", messages: [
    ["This list marker is part of the preceding paragraph; add a blank line ", "before the list."].join(''),
    ["This list marker directly follows term or description text and is part", " of that text; add a blank line before the list."].join(''),
  ] },
  "markdown-definition-paragraph": { severity: "warning", default: "on", messages: [
    ["This markdown definition remains paragraph text; use a :: term line be", "fore the definition."].join(''),
  ] },
  "markdown-strikethrough-double-tilde": { severity: "warning", default: "on", messages: [
    ["Markdown `~~strikethrough~~` is literal text in Carve. Carve strikethr", "ough is the braced `{~x~}`."].join(''),
  ] },
  "markdown-strong-double-star": { severity: "warning", default: "on", messages: [
    ["Markdown `**strong**` is literal text in Carve, asterisks included. Ca", "rve strong is a single `*`."].join(''),
  ] },
  "non-descriptive-link-text": { severity: "warning", default: "on", messages: [
    ["Use descriptive link text or a specific aria-label."].join(''),
  ] },
  "ordered-list-kind-split": { severity: "warning", default: "on", messages: [
    ["A lone i starts a roman list and any other single letter an alphabetic", " one, so this list splits after its first item."].join(''),
  ] },
  "ordered-marker-right-aligned": { severity: "warning", default: "on", messages: [
    ["This marker sits left of its list and is text of the item above. Order", "ed markers are left-aligned in 0.2."].join(''),
  ] },
  "platform-issue-reference": { severity: "warning", default: undefined, messages: [
    ["${host} re-linkifies a hash-number in published output, so \"${text}\" b", "ecomes a link that notifies or references something unrelated; move th", "e example into a fenced code block, or rewrite it as \"item 1\" / \"point", " 1\""].join(''),
  ] },
  "platform-mention-token": { severity: "warning", default: undefined, messages: [
    ["${host} re-linkifies ${what} in published output, so \"${text}\" becomes", " a link that notifies or references something unrelated; move the exam", "ple into a fenced code block, or strip the sigil and rephrase"].join(''),
  ] },
  "quote-fence-ends-the-quote-above": { severity: "warning", default: "on", messages: [
    ["A \"::: >\" opener at the column of the quote above it ENDS that quote a", "nd opens a sibling one; the two render as adjacent blockquotes, not on", "e nested in the other. Write \"> ::: >\" to nest it, or leave a blank li", "ne to make two quotes deliberate."].join(''),
  ] },
  "references-placement-in-container": { severity: "warning", default: "on", messages: [
    ["This \"::: references\" marker is inside a container and does not place ", "the reference list. Move it to document level, or remove it if no plac", "ement is needed."].join(''),
  ] },
  "region-marker-renders-as-text": { severity: "warning", default: "on", messages: [
    ["This line renders as text and is not a region marker for a Carve inclu", "de. Use \"%% #region name\"."].join(''),
  ] },
  "semantic-attribute-outside-span": { severity: "warning", default: "on", messages: [
    ["\"${name}\" is a semantic span attribute (PART 9 §10) and only applies t", "o an ordinary [content]{attrs} span; on ${type} it stays a raw attribu", "te and renders as ${name}=\"${value}\"."].join(''),
  ] },
  "semantic-attribute-value-ignored": { severity: "warning", default: "on", messages: [
    ["Value on the semantic attribute \"${name}\" is discarded: it selects the", " <${name}> element and reaches no output. Only abbr, dfn and time carr", "y a value (as title or datetime)."].join(''),
  ] },
  "setext-heading-underline": { severity: "warning", default: "on", messages: [
    ["Carve has no underline heading: this run of hyphens is text. Write the", " heading with a leading `=`."].join(''),
  ] },
  "sigil-after-letter": { severity: "hint", default: "on", messages: [
    ["A mention or tag does not start directly after a letter or number. Put", " a space or punctuation before it."].join(''),
  ] },
  "table-column-arity": { severity: "warning", default: "on", messages: [
    ["${key} supplies ${count} column entries for a ${widest}-column table; ", "the unset tail is valid but may be accidental."].join(''),
  ] },
  "table-column-overlap": { severity: "warning", default: "on", messages: [
    ["Column ${n} supplies the same alignment axis both in the table and in ", "a table attribute; the in-table marker wins."].join(''),
  ] },
  "table-marker-run-padding": { severity: "warning", default: "on", messages: [
    ["\"${spelling}\" writes a cell's attribute block before its alignment mar", "ker, which Carve no longer reads as one. The block is part of the cell", "'s marker run and the run ends at a space, so with the \"${marker}\" glu", "ed to it there is no run: the braces are content and the cell is neith", "er attributed nor aligned. Write \"${marker}${block} \" to align it, or ", "\"${block} ${marker}\" to keep the \"${marker}\" as content deliberately."].join(''),
  ] },
  "table-row-attribute-as-cell": { severity: "warning", default: "on", messages: [
    ["A row attribute is the brace block glued after the closing pipe. Here ", "it is cell content."].join(''),
  ] },
  "table-row-cell-count": { severity: "warning", default: "on", messages: [
    ["This table row has ${cells} cells; the header has ${width}. Add or rem", "ove a cell to match the table."].join(''),
  ] },
  "table-row-without-closing-pipe": { severity: "hint", default: undefined, messages: [
    ["This row has no closing pipe. carve fmt adds it; escape the first pipe", " if the line is text."].join(''),
  ] },
  "table-shaped-paragraph": { severity: "warning", default: "on", messages: [
    ["This table-shaped line lacks a closing pipe and renders as paragraph t", "ext; close the table row."].join(''),
  ] },
  "table-span-marker-blocked": { severity: "warning", default: "on", messages: [
    ["The \"${marker}\" span marker cannot extend a cell. ${reason} It renders", " as a cell of its own; escape it as \"\\${marker}\" to keep the character", " as text, or remove it."].join(''),
  ] },
  "table-width-total": { severity: "warning", default: "on", messages: [
    ["The specified table column widths total more than 100%."].join(''),
  ] },
  "thematic-break-spelling": { severity: "hint", default: "on", messages: [
    ["This line of \"${raw}\" is text in Carve 0.2. Write \"***\" for a thematic", " break."].join(''),
  ] },
  "tight-list-item-with-blank-line": { severity: "hint", default: "off", messages: [
    ["A blank line inside an item no longer makes the list loose. Put a blan", "k line between the items if every item should render as a paragraph."].join(''),
  ] },
  "unattached-block-attribute": { severity: "warning", default: "on", messages: [
    ["This attribute line reaches no block: a blank line or the end of its c", "ontainer follows, so the line is text (C2-B-192). Move it directly abo", "ve the block it describes, or delete it."].join(''),
    ["This attribute line is separated from its block by a blank line, so it", " is text. Remove the blank line."].join(''),
  ] },
  "unattached-caption": { severity: "warning", default: "on", messages: [
    ["This caption line is not directly below an image, table, code block, q", "uote, math block or figure group, so it is text. If a blank line separ", "ates it from such a block, remove the blank line; otherwise escape the", " caret."].join(''),
  ] },
  "unattached-inline-attribute": { severity: "hint", default: "on", messages: [
    ["This attribute block is attached to nothing and renders as text. Glue ", "it to a span, link or code span, or escape the brace."].join(''),
  ] },
  "unclosed-braced-comment": { severity: "warning", default: "on", messages: [
    ["This braced comment is not closed before the next block starts, so it ", "stays text. Close it inside its block, or use %% line comments."].join(''),
  ] },
  "unclosed-inline-emphasis": { severity: "warning", default: "on", messages: [
    ["This strong (or: emphasis) opener is unclosed in its paragraph; add a ", "closer."].join(''),
  ] },
  "uneven-list-indent": { severity: "warning", default: "on", messages: [
    ["This marker stands left of every open list and continues the list abov", "e it. Align it with the markers of that list."].join(''),
  ] },
  "unresolved-footnote": { severity: "warning", default: "on", messages: [
    ["Footnote reference [^${id}] has no matching definition; it renders as ", "literal text."].join(''),
  ] },
  "unresolved-reference-link": { severity: "warning", default: "on", messages: [
    ["Reference link ${rawRef} matches no link definition or heading; ${case", "OnlyPhrase}, and reference labels are case-sensitive, so it renders as", " literal text."].join(''),
    ["Reference link ${rawRef} has no matching link definition or heading; i", "t renders as literal text."].join(''),
    ["Reference image ${rawRef} matches no link definition; ${caseOnlyPhrase", "}, and reference labels are case-sensitive, so it renders as literal t", "ext."].join(''),
    ["Reference image ${rawRef} has no matching link definition; it renders ", "as literal text."].join(''),
  ] },
  "unused-footnote-definition": { severity: "warning", default: "on", messages: [
    ["Footnote definition [^${label}] is never referenced, so it is omitted ", "from the rendered document."].join(''),
  ] },
  "unused-link-reference-definition": { severity: "warning", default: "on", messages: [
    ["This link reference definition is unused."].join(''),
  ] },
} as const

export type RuleId = keyof typeof CATALOG
