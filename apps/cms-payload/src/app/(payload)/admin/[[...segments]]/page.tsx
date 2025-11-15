import type { Metadata } from "next";

import config from "@/payload.config";
import { importMap } from "@/importMap";
import { RootPage } from "@payloadcms/next/views";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "SMPLAT CMS Admin"
};

type Args = {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export default async function Page({ params, searchParams }: Args) {
  const p = await params;
  if (!p.segments || p.segments.length === 0) {
    redirect("/admin/collections/pages");
  }

  const normalizedParams = Promise.resolve({ segments: p.segments });

  return RootPage({
    config: Promise.resolve(config),
    importMap,
    params: normalizedParams,
    searchParams,
  });
}
