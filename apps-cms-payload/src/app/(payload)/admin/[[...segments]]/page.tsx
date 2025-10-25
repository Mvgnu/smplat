import type { Metadata } from "next";

import config from "@/payload.config";
import { importMap } from "@/importMap";
import { RootPage } from "@payloadcms/next/views";

export const metadata: Metadata = {
  title: "SMPLAT CMS Admin"
};

type PageProps = {
  params: { segments?: string[] };
  searchParams?: { [key: string]: string | string[] };
};

const configPromise = Promise.resolve(config);

export default async function PayloadAdminPage({ params, searchParams }: PageProps) {
  return (
    <RootPage
      config={configPromise}
      importMap={importMap}
      params={Promise.resolve({ segments: params.segments ?? [] })}
      searchParams={Promise.resolve(searchParams ?? {})}
    />
  );
}
