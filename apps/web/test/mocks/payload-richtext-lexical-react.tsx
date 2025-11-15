import React from "react";

export type JSXConverters = Record<string, unknown>;
export type JSXConvertersFunction = () => JSXConverters;

type RichTextProps = {
  data: unknown;
  converters?: JSXConverters | JSXConvertersFunction;
  [key: string]: unknown;
};

export const RichText: React.FC<RichTextProps> = ({ data }) => (
  <div data-testid="mock-payload-rich-text">{JSON.stringify(data)}</div>
);

export default {
  RichText,
};
