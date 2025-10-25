# Rich Text Utilities

- `rich-text.tsx` exports a `RichText` component that renders Sanity PortableText arrays and Payload Lexical JSON.
- The component applies SMPLAT's dark theme defaults and logs warnings when it cannot render content.
- Consumers can override lexical styling with the `lexicalClassName` prop when embedding rich text in different sections.
