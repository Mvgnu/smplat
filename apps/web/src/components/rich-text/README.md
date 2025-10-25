# Rich Text Utilities

- `rich-text.tsx` exports a `RichText` component that renders Sanity PortableText arrays and Payload Lexical JSON.
- Payload content flows through the official `@payloadcms/richtext-lexical/react` renderer so block nodes stay in React and can participate in future personalization experiments.
- The default configuration merges SMPLAT's marketing converters so Lexical editors can drop hero callouts, metric grids, testimonial spotlights, and product cards directly into rich-text regions.
- `marketing-converters.tsx` defines the JSX converters and leaf components used by the marketing kit. Consumers can import `marketingLexicalConverters` to extend additional renderers or override behaviour.
- Consumers can override lexical styling with the `lexicalClassName` prop or supply custom JSX converters via `lexicalConverters` when embedding rich text in different sections. Custom converters are merged with the marketing defaults.
- The component applies SMPLAT's dark theme defaults and logs warnings when it cannot render content.
