import Link from "next/link";

import { PostList } from "@/components/blog/post-list";
import { getBlogPosts } from "@/server/cms/loaders";

export default async function BlogPage() {
  const posts = await getBlogPosts();

  return (
    <main className="mx-auto max-w-5xl px-6 py-24 text-white">
      <header className="mb-12 text-center">
        <p className="uppercase tracking-[0.3em] text-xs text-white/50">Insights</p>
        <h1 className="mt-3 text-4xl font-semibold">Blog & Resources</h1>
        <p className="mt-4 text-white/70">
          Playbooks, automation templates, and growth tactics for modern social media agencies.
        </p>
      </header>

      <PostList posts={posts} />

      <section className="mt-16 rounded-3xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
        <h2 className="text-2xl font-semibold">Subscribe for launch updates</h2>
        <p className="mt-3 text-white/70">
          Early access to new automations, billing integrations, and case studies.
        </p>
        <Link className="mt-6 inline-flex rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/80" href="#contact">
          Book discovery call
        </Link>
      </section>
    </main>
  );
}
