import { RichText } from "@/components/rich-text/rich-text";

type PostContentProps = {
  value?: unknown;
};

export function PostContent({ value }: PostContentProps) {
  return <RichText value={value} />;
}
