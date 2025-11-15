"use server";

// meta: route: admin/preview
// meta: feature: marketing-preview-cockpit

import { collectMarketingPreviewSnapshotTimeline } from "@/server/cms/preview";
import { getMarketingPreviewNotes } from "@/server/cms/preview/notes";
import { PreviewWorkbench } from "@/components/marketing/preview/PreviewWorkbench";

export default async function AdminMarketingPreviewPage() {
  const [timeline, notes] = await Promise.all([
    collectMarketingPreviewSnapshotTimeline({ historyLimit: 6 }),
    getMarketingPreviewNotes()
  ]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 text-white">
      <header className="space-y-3">
        <p className="uppercase tracking-[0.3em] text-xs text-white/50">Marketing</p>
        <h1 className="text-3xl font-semibold">Marketing preview cockpit</h1>
        <p className="text-white/70">
          Inspect deterministic Payload snapshots, compare draft and published states, scrub historical manifests, and capture
          regression notes without leaving the editor workflow.
        </p>
      </header>

      <PreviewWorkbench current={timeline.current} history={timeline.history} notes={notes} />
    </main>
  );
}
