export type SerializedLexicalNode = {
  type: string;
  [key: string]: unknown;
};

export type SerializedEditorState<TNode = SerializedLexicalNode> = {
  root: {
    type: string;
    children: TNode[];
  };
};

export type SerializedBlockNode = SerializedLexicalNode;
