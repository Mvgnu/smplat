import Link from "next/link";

export type BlogSummary = {
  title?: string;
  slug?: { current?: string };
  excerpt?: string;
  publishedAt?: string;
};

type PostListProps = {
  posts: BlogSummary[];
};

export function PostList({ posts }: PostListProps) {
  if (!posts.length) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
        More stories coming soon.
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {posts.map((post, index) => {
        const slug = post.slug?.current ?? `post-${index}`;
        const href = post.slug?.current ? `/blog/${post.slug.current}` : "#";
        const date = post.publishedAt ? new Date(post.publishedAt) : null;

        return (
          <article key={slug} className="rounded-3xl border border-white/10 bg-white/5 p-6 text-left backdrop-blur transition hover:border-white/30">
            <p className="text-sm uppercase tracking-wide text-white/50">
              {date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Announcement"}
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{post.title ?? "Untitled"}</h3>
            {post.excerpt ? <p className="mt-3 text-white/70">{post.excerpt}</p> : null}
            <Link className="mt-4 inline-flex items-center text-sm font-semibold text-white hover:text-white/80" href={href}>
              Read more →
            </Link>
          </article>
        );
      })}
    </div>
  );
}
