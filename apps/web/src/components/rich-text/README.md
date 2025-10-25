# Rich Text Utilities

- `rich-text.tsx` exports a `RichText` component that renders Sanity PortableText arrays and Payload Lexical JSON.
- Payload content now flows through the official `@payloadcms/richtext-lexical/react` renderer so block nodes stay in React and can participate in future personalization experiments.
- Consumers can override lexical styling with the `lexicalClassName` prop or supply custom JSX converters via `lexicalConverters` when embedding rich text in different sections.
- The component applies SMPLAT's dark theme defaults and logs warnings when it cannot render content.
