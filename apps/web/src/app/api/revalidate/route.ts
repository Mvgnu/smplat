import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

const REVALIDATE_SECRET = process.env.SANITY_REVALIDATE_SECRET;

type RevalidatePayload = {
  slug?: { current?: string };
  _type?: string;
};

const mapSlugToPath = (slug?: string) => {
  if (!slug) {
    return "/";
  }

  if (slug === "home") {
    return "/";
  }

  return `/${slug}`;
};

export async function POST(request: Request) {
  if (!REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Revalidate secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("x-sanity-signature");
  if (signature !== REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = (await request.json()) as RevalidatePayload;
  const slug = payload.slug?.current;

  const path = mapSlugToPath(slug);
  revalidatePath(path);

  return NextResponse.json({ revalidated: true, path });
}
