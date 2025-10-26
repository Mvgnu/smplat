"use server";

// meta: route: admin/preview
// meta: feature: marketing-preview-cockpit

import { collectMarketingPreviewSnapshots, type MarketingPreviewSnapshot } from "@/server/cms/preview";
import { PreviewWorkbench } from "@/components/marketing/preview/PreviewWorkbench";

const loadSnapshotStates = async (): Promise<Record<"published" | "draft", MarketingPreviewSnapshot[]>> => {
  const [published, draft] = await Promise.all([
    collectMarketingPreviewSnapshots({ preview: false }),
    collectMarketingPreviewSnapshots({ preview: true })
  ]);

  return {
    published,
    draft
  };
};

export default async function AdminMarketingPreviewPage() {
  const snapshots = await loadSnapshotStates();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 text-white">
      <header className="space-y-3">
        <p className="uppercase tracking-[0.3em] text-xs text-white/50">Marketing</p>
        <h1 className="text-3xl font-semibold">Marketing preview cockpit</h1>
        <p className="text-white/70">
          Inspect deterministic Payload snapshots, compare draft and published states, and curate fallback heuristics without
          leaving the editor workflow.
        </p>
      </header>

      <PreviewWorkbench published={snapshots.published} draft={snapshots.draft} generatedAt={new Date().toISOString()} />
    </main>
  );
}
