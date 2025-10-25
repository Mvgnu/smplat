export const payloadLexicalRichText = {
  root: {
    type: "root",
    format: "",
    indent: 0,
    version: 1,
    direction: "ltr",
    children: [
      {
        type: "heading",
        tag: "h2",
        format: "",
        indent: 0,
        version: 1,
        direction: "ltr",
        children: [
          {
            type: "text",
            text: "Lexical heading",
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            version: 1
          }
        ]
      },
      {
        type: "paragraph",
        format: "",
        indent: 0,
        version: 1,
        direction: "ltr",
        children: [
          {
            type: "text",
            text: "Intro paragraph with ",
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            version: 1
          },
          {
            type: "link",
            format: "",
            indent: 0,
            version: 1,
            direction: "ltr",
            fields: {
              linkType: "custom",
              url: "https://example.com",
              newTab: false
            },
            children: [
              {
                type: "text",
                text: "link",
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                version: 1
              }
            ]
          },
          {
            type: "text",
            text: " support.",
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            version: 1
          }
        ]
      },
      {
        type: "list",
        tag: "ul",
        listType: "bullet",
        format: "",
        indent: 0,
        version: 1,
        direction: "ltr",
        children: [
          {
            type: "listitem",
            format: "",
            indent: 0,
            version: 1,
            direction: "ltr",
            value: 1,
            checked: false,
            children: [
              {
                type: "paragraph",
                format: "",
                indent: 0,
                version: 1,
                direction: "ltr",
                children: [
                  {
                    type: "text",
                    text: "First bullet",
                    detail: 0,
                    format: 0,
                    mode: "normal",
                    style: "",
                    version: 1
                  }
                ]
              }
            ]
          },
          {
            type: "listitem",
            format: "",
            indent: 0,
            version: 1,
            direction: "ltr",
            value: 2,
            checked: false,
            children: [
              {
                type: "paragraph",
                format: "",
                indent: 0,
                version: 1,
                direction: "ltr",
                children: [
                  {
                    type: "text",
                    text: "Second bullet",
                    detail: 0,
                    format: 0,
                    mode: "normal",
                    style: "",
                    version: 1
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
} as const;
