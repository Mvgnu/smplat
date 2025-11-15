import type { ComponentType, ReactNode } from "react";

declare module "@payloadcms/richtext-lexical" {
  export type SerializedBlockNode<TFields = Record<string, unknown>> = {
    fields: TFields;
    children?: unknown;
  };
  export type SerializedLexicalNode = {
    type?: string;
    children?: SerializedLexicalNode[];
    [key: string]: unknown;
  };
  export type SerializedEditorState<TNode = SerializedLexicalNode> = {
    root: TNode & {
      children?: TNode[];
    };
  };
}

declare module "@payloadcms/richtext-lexical/react" {
  import type {
    SerializedBlockNode,
    SerializedEditorState,
    SerializedLexicalNode
  } from "@payloadcms/richtext-lexical";

  export type LexicalNodeConverter = (params: { node: SerializedBlockNode }) => ReactNode;
  export type JSXConverters = {
    blocks?: Record<string, LexicalNodeConverter>;
    inlineBlocks?: Record<string, LexicalNodeConverter>;
  };
  export type JSXConvertersFunction = (options: {
    defaultConverters: JSXConverters;
  }) => JSXConverters;

  export const RichText: ComponentType<{
    data: SerializedEditorState<SerializedLexicalNode>;
    converters?: JSXConverters | JSXConvertersFunction;
    className?: string;
    disableContainer?: boolean;
    disableIndent?: boolean | string[];
    disableTextAlign?: boolean | string[];
  }>;
}

declare module "framer-motion";
