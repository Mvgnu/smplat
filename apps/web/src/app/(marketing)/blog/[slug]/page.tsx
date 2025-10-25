import Link from "next/link";
import { notFound } from "next/navigation";

import { PostContent } from "@/components/blog/post-content";
import { getBlogPostBySlug } from "@/server/cms/loaders";

export default async function BlogDetailPage({ params }: { params: { slug: string } }) {
  const post = await getBlogPostBySlug(params.slug);
  if (!post) {
    notFound();
  }

  const date = post.publishedAt ? new Date(post.publishedAt) : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-24 text-white">
      <Link href="/blog" className="text-sm text-white/60 hover:text-white/80">
        ← Back to blog
      </Link>
      <article className="mt-6 space-y-6">
        <header>
          <p className="text-sm uppercase tracking-widest text-white/50">
            {date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Insights"}
          </p>
          <h1 className="mt-2 text-4xl font-semibold">{post.title}</h1>
          {post.excerpt ? <p className="mt-4 text-white/70">{post.excerpt}</p> : null}
        </header>
        <PostContent value={post.body ?? []} />
      </article>
    </main>
  );
}
