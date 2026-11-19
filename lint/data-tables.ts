// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.
export const LINT_MODEL = {
  "text_leaves": [
    "caption",
    "definition_term",
    "heading",
    "line",
    "paragraph",
    "table_cell"
  ],
  "verbatim_leaves": [
    "code_block",
    "comment_block",
    "frontmatter",
    "raw_block"
  ],
  "row_leaves": [
    "table_cell",
    "table_row"
  ],
  "rules": [
    {
      "id": "block-opener-overindented",
      "over": "block",
      "types": [
        "admonition",
        "block_quote",
        "code_block",
        "definition_term",
        "directive",
        "div",
        "figure_group",
        "heading",
        "line_block",
        "raw_block",
        "table",
        "thematic_break"
      ],
      "when": {
        "all": [
          {
            "ne": [
              {
                "f": "owner.type"
              },
              "list_item"
            ]
          },
          {
            "not": {
              "f": "after_quote_mark"
            }
          },
          {
            "gt": [
              {
                "f": "column"
              },
              {
                "f": "owner.content_column"
              }
            ]
          }
        ]
      },
      "report": [
        {
          "start": {
            "f": "start"
          },
          "end": {
            "add": [
              {
                "f": "start"
              },
              {
                "if": [
                  {
                    "eq": [
                      {
                        "f": "type"
                      },
                      "definition_term"
                    ]
                  },
                  2,
                  {
                    "if": [
                      {
                        "in": [
                          {
                            "f": "type"
                          },
                          [
                            "admonition",
                            "directive",
                            "div",
                            "figure_group"
                          ]
                        ]
                      },
                      3,
                      1
                    ]
                  }
                ]
              }
            ]
          },
          "values": {
            "kind": {
              "if": [
                {
                  "eq": [
                    {
                      "f": "type"
                    },
                    "block_quote"
                  ]
                },
                "quote",
                {
                  "if": [
                    {
                      "in": [
                        {
                          "f": "type"
                        },
                        [
                          "admonition",
                          "directive",
                          "div",
                          "figure_group"
                        ]
                      ]
                    },
                    "div",
                    {
                      "words": {
                        "f": "type"
                      }
                    }
                  ]
                }
              ]
            },
            "past": {
              "sub": [
                {
                  "f": "column"
                },
                {
                  "f": "owner.content_column"
                }
              ]
            },
            "columns": {
              "if": [
                {
                  "eq": [
                    {
                      "sub": [
                        {
                          "f": "column"
                        },
                        {
                          "f": "owner.content_column"
                        }
                      ]
                    },
                    1
                  ]
                },
                "column",
                "columns"
              ]
            },
            "owner": {
              "words": {
                "f": "owner.type"
              }
            }
          }
        }
      ],
      "clauses": [
        "C2-B-003",
        "C2-B-025",
        "C2-B-028"
      ]
    },
    {
      "id": "block-opener-without-blank-line",
      "over": "line",
      "when": {
        "all": [
          {
            "has": "prev"
          },
          {
            "in": [
              {
                "f": "leaf"
              },
              [
                "caption",
                "paragraph"
              ]
            ]
          },
          {
            "eq": [
              {
                "f": "prev.leaf_id"
              },
              {
                "f": "leaf_id"
              }
            ]
          },
          {
            "not": {
              "f": "prev.blank"
            }
          }
        ]
      },
      "report": [
        {
          "when": {
            "matches": [
              {
                "f": "body"
              },
              "^(?<mark>#{1,6}|={1,6}) "
            ]
          },
          "start": {
            "match": "mark",
            "at": "start"
          },
          "end": {
            "match": "mark",
            "at": "end"
          },
          "values": {
            "opener": "a heading"
          }
        },
        {
          "when": {
            "all": [
              {
                "matches": [
                  {
                    "f": "body"
                  },
                  "^(?<mark>>)(?: |$)"
                ]
              },
              {
                "not": {
                  "all": [
                    {
                      "f": "quote_prefix"
                    },
                    {
                      "matches": [
                        {
                          "f": "prev.text"
                        },
                        "^[ \t]*> "
                      ]
                    },
                    {
                      "contains": [
                        {
                          "f": "ancestors"
                        },
                        "block_quote"
                      ]
                    }
                  ]
                }
              }
            ]
          },
          "start": {
            "match": "mark",
            "at": "start"
          },
          "end": {
            "match": "mark",
            "at": "end"
          },
          "values": {
            "opener": "a quote"
          }
        },
        {
          "when": {
            "matches": [
              {
                "f": "body"
              },
              "^(?<mark>::) "
            ]
          },
          "start": {
            "match": "mark",
            "at": "start"
          },
          "end": {
            "match": "mark",
            "at": "end"
          },
          "values": {
            "opener": "a term"
          }
        },
        {
          "when": {
            "matches": [
              {
                "f": "body"
              },
              "^(?<mark>:) "
            ]
          },
          "start": {
            "match": "mark",
            "at": "start"
          },
          "end": {
            "match": "mark",
            "at": "end"
          },
          "values": {
            "opener": "a description"
          }
        },
        {
          "when": {
            "eq": [
              {
                "f": "shape"
              },
              "attribute_line"
            ]
          },
          "start": {
            "f": "body_start"
          },
          "end": {
            "f": "body_end"
          },
          "values": {
            "opener": "an attribute line"
          }
        },
        {
          "when": {
            "all": [
              {
                "matches": [
                  {
                    "f": "body"
                  },
                  "^(?<mark>\\[.*?\\]:)"
                ]
              },
              {
                "not": {
                  "contains": [
                    {
                      "f": "ancestors"
                    },
                    "footnote"
                  ]
                }
              }
            ]
          },
          "start": {
            "match": "mark",
            "at": "start"
          },
          "end": {
            "match": "mark",
            "at": "end"
          },
          "values": {
            "opener": "a definition"
          }
        }
      ],
      "clauses": [
        "C2-B-019",
        "C2-B-024",
        "C2-B-025",
        "C2-B-200"
      ]
    },
    {
      "id": "blockquote-marker-without-space",
      "over": "line",
      "verbatim": [
        "frontmatter"
      ],
      "when": {
        "matches": [
          {
            "f": "text"
          },
          "^>[^ ]"
        ]
      },
      "report": [
        {
          "when": {
            "in": [
              {
                "f": "leaf"
              },
              "text_leaves"
            ]
          },
          "message": 0,
          "start": {
            "f": "start"
          },
          "end": {
            "add": [
              {
                "f": "start"
              },
              {
                "len": {
                  "trim_end": {
                    "f": "text"
                  }
                }
              }
            ]
          },
          "values": {
            "text": {
              "slice": [
                {
                  "trim_end": {
                    "f": "text"
                  }
                },
                1
              ]
            }
          }
        },
        {
          "when": {
            "eq": [
              {
                "f": "leaf"
              },
              "frontmatter"
            ]
          },
          "message": 1,
          "start": {
            "f": "start"
          },
          "end": {
            "add": [
              {
                "f": "start"
              },
              1
            ]
          },
          "values": {
            "text": {
              "slice": [
                {
                  "f": "text"
                },
                1
              ]
            }
          }
        }
      ],
      "clauses": [
        "C2-B-031"
      ]
    },
    {
      "id": "caption-looking-paragraph",
      "over": "line",
      "when": {
        "all": [
          {
            "eq": [
              {
                "f": "leaf"
              },
              "paragraph"
            ]
          },
          {
            "matches": [
              {
                "f": "body"
              },
              "^(?:\\*?\\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\\s+\\d+)?\\s*:|:\\s+\\S)",
              "i"
            ]
          }
        ]
      },
      "report": [
        {
          "when": {
            "any": [
              {
                "in": [
                  {
                    "f": "next.leaf"
                  },
                  "row_leaves"
                ]
              },
              {
                "in": [
                  {
                    "f": "next2.leaf"
                  },
                  "row_leaves"
                ]
              }
            ]
          },
          "message": 0,
          "start": {
            "f": "body_start"
          },
          "end": {
            "add": [
              {
                "f": "body_start"
              },
              1
            ]
          }
        },
        {
          "when": {
            "any": [
              {
                "in": [
                  {
                    "f": "prev.leaf"
                  },
                  "row_leaves"
                ]
              },
              {
                "in": [
                  {
                    "f": "prev2.leaf"
                  },
                  "row_leaves"
                ]
              },
              {
                "contains": [
                  {
                    "f": "prev.text"
                  },
                  "!["
                ]
              },
              {
                "contains": [
                  {
                    "f": "prev2.text"
                  },
                  "!["
                ]
              }
            ]
          },
          "message": 1,
          "start": {
            "f": "body_start"
          },
          "end": {
            "add": [
              {
                "f": "body_start"
              },
              1
            ]
          }
        }
      ],
      "clauses": [
        "C2-B-146",
        "C2-B-149"
      ]
    },
    {
      "id": "colon-fence-length-mismatch",
      "over": "line",
      "when": {
        "all": [
          {
            "eq": [
              {
                "f": "shape"
              },
              "div_bare_run"
            ]
          },
          {
            "has": "open_colon.0"
          },
          {
            "ne": [
              {
                "f": "open_colon.0.width"
              },
              {
                "len": {
                  "f": "body"
                }
              }
            ]
          }
        ]
      },
      "report": [
        {
          "when": {
            "gt": [
              {
                "len": {
                  "f": "body"
                }
              },
              {
                "f": "open_colon.0.width"
              }
            ]
          },
          "message": 2
        },
        {
          "when": {
            "some": {
              "in": "open_colon",
              "from": 1,
              "where": {
                "le": [
                  {
                    "f": "item.width"
                  },
                  {
                    "len": {
                      "f": "body"
                    }
                  }
                ]
              }
            }
          },
          "message": 1
        },
        {
          "message": 0
        }
      ],
      "range": {
        "start": {
          "f": "body_start"
        },
        "end": {
          "f": "body_end"
        }
      },
      "values": {
        "authoredWidth": {
          "len": {
            "f": "body"
          }
        },
        "expectedWidth": {
          "f": "open_colon.0.width"
        },
        "kind": {
          "f": "open_colon.0.kind"
        },
        "line": {
          "f": "open_colon.0.line"
        },
        "column": {
          "f": "open_colon.0.column"
        }
      },
      "clauses": [
        "C2-B-108",
        "C2-B-109",
        "C2-B-125"
      ]
    },
    {
      "id": "deprecated-spaced-thematic-break",
      "over": "line",
      "let": {
        "run_start": {
          "skip_right": [
            {
              "extend_left": [
                {
                  "f": "body_start"
                },
                {
                  "concat": [
                    " \t",
                    {
                      "slice": [
                        {
                          "f": "body"
                        },
                        0,
                        1
                      ]
                    }
                  ]
                }
              ]
            },
            " \t"
          ]
        }
      },
      "when": {
        "all": [
          {
            "any": [
              {
                "matches": [
                  {
                    "text_from": {
                      "v": "run_start"
                    }
                  },
                  "^\\*(?:[ \t]*\\*){2,}$"
                ]
              },
              {
                "matches": [
                  {
                    "text_from": {
                      "v": "run_start"
                    }
                  },
                  "^-(?:[ \t]*-){2,}$"
                ]
              },
              {
                "matches": [
                  {
                    "text_from": {
                      "v": "run_start"
                    }
                  },
                  "^_(?:[ \t]*_){2,}$"
                ]
              }
            ]
          },
          {
            "matches": [
              {
                "text_from": {
                  "v": "run_start"
                }
              },
              "[ \t]"
            ]
          }
        ]
      },
      "report": [
        {
          "start": {
            "v": "run_start"
          },
          "end": {
            "f": "body_end"
          }
        }
      ],
      "clauses": [
        "C2-B-027",
        "C2-B-058",
        "C2-B-160"
      ]
    },
    {
      "id": "list-item-block-overindented",
      "over": "block",
      "when": {
        "all": [
          {
            "eq": [
              {
                "f": "parent.type"
              },
              "list_item"
            ]
          },
          {
            "any": [
              {
                "in": [
                  {
                    "f": "type"
                  },
                  [
                    "admonition",
                    "block_quote",
                    "code_block",
                    "definition_list",
                    "directive",
                    "div",
                    "figure_group",
                    "heading",
                    "line_block",
                    "raw_block",
                    "table",
                    "thematic_break"
                  ]
                ]
              },
              {
                "f": "image_line"
              },
              {
                "f": "attributed"
              }
            ]
          },
          {
            "gt": [
              {
                "f": "opener_column"
              },
              {
                "f": "parent.content_column"
              }
            ]
          }
        ]
      },
      "report": [
        {
          "start": {
            "f": "start"
          },
          "end": {
            "f": "line.end"
          },
          "values": {
            "contentColumn": {
              "add": [
                {
                  "f": "parent.content_column"
                },
                1
              ]
            }
          }
        }
      ],
      "clauses": [
        "C2-B-025",
        "C2-B-027"
      ]
    },
    {
      "id": "list-item-body-below-content-column",
      "over": "block",
      "when": {
        "all": [
          {
            "eq": [
              {
                "f": "parent.type"
              },
              "list_item"
            ]
          },
          {
            "ge": [
              {
                "f": "index"
              },
              1
            ]
          },
          {
            "gt": [
              {
                "f": "column"
              },
              {
                "f": "parent.marker_column"
              }
            ]
          },
          {
            "lt": [
              {
                "f": "column"
              },
              {
                "f": "parent.content_column"
              }
            ]
          }
        ]
      },
      "report": [
        {
          "start": {
            "f": "start"
          },
          "end": {
            "f": "line.end"
          }
        }
      ],
      "clauses": [
        "C2-B-025",
        "C2-B-027"
      ]
    },
    {
      "id": "thematic-break-spelling",
      "over": "line",
      "when": {
        "all": [
          {
            "matches": [
              {
                "f": "body"
              },
              "^(?:-{3,}|_{3,})$"
            ]
          },
          {
            "not": {
              "all": [
                {
                  "starts": [
                    {
                      "f": "body"
                    },
                    "-"
                  ]
                },
                {
                  "eq": [
                    {
                      "f": "prev.leaf"
                    },
                    "paragraph"
                  ]
                },
                {
                  "not": {
                    "f": "prev.blank"
                  }
                }
              ]
            }
          },
          {
            "not": {
              "all": [
                {
                  "eq": [
                    {
                      "f": "number"
                    },
                    1
                  ]
                },
                {
                  "eq": [
                    {
                      "f": "body_start"
                    },
                    {
                      "f": "start"
                    }
                  ]
                },
                {
                  "eq": [
                    {
                      "f": "body"
                    },
                    "---"
                  ]
                }
              ]
            }
          }
        ]
      },
      "report": [
        {
          "start": {
            "f": "body_start"
          },
          "end": {
            "f": "body_end"
          },
          "values": {
            "raw": {
              "f": "body"
            }
          }
        }
      ],
      "clauses": [
        "C2-B-027",
        "C2-B-160",
        "C2-B-161"
      ]
    },
    {
      "id": "unattached-block-attribute",
      "over": "line",
      "when": {
        "all": [
          {
            "eq": [
              {
                "f": "leaf"
              },
              "paragraph"
            ]
          },
          {
            "f": "leaf_first"
          },
          {
            "eq": [
              {
                "f": "shape"
              },
              "attribute_line"
            ]
          },
          {
            "not": {
              "f": "attached_here"
            }
          },
          {
            "any": [
              {
                "not": {
                  "has": "next"
                }
              },
              {
                "f": "next.blank"
              },
              {
                "f": "next.closes_container"
              },
              {
                "ne": [
                  {
                    "f": "next.leaf_id"
                  },
                  {
                    "f": "leaf_id"
                  }
                ]
              }
            ]
          }
        ]
      },
      "report": [
        {
          "when": {
            "f": "next.blank"
          },
          "message": 1
        },
        {
          "message": 0
        }
      ],
      "range": {
        "start": {
          "f": "body_start"
        },
        "end": {
          "f": "body_end"
        }
      },
      "clauses": [
        "C2-B-090",
        "C2-B-092",
        "C2-B-192"
      ]
    }
  ]
} as const
