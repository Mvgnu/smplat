import type { Meta, StoryObj } from "@storybook/react";

import { AccountPreviewCard } from "./MetricSourcingTestbed.client";
import type { MetricValidationResult } from "@/types/metrics";

const sampleResult: MetricValidationResult = {
  account: {
    id: "acct-1",
    platform: "instagram",
    handle: "brand",
    displayName: "Brand Studio",
    profileUrl: "https://instagram.com/brand",
    avatarUrl: "https://cdn.test/avatar.jpg",
    verificationStatus: "verified",
    verificationMethod: "scraper",
    verificationNotes: null,
    lastVerifiedAt: "2024-01-01T00:00:00.000Z",
    lastScrapedAt: "2024-01-01T00:00:00.000Z",
    baselineMetrics: { followerCount: 12000 },
    deliverySnapshots: { latest: { followerCount: 12000 } },
    targetMetrics: null,
    metadata: { note: "Storybook" },
    customerProfileId: null,
  },
  snapshot: {
    platform: "instagram",
    handle: "brand",
    metrics: {
      followerCount: 12000,
      followingCount: 430,
      avgLikes: 540,
      avgComments: 58,
      engagementRatePct: 4.2,
      lastPostAt: "2024-01-01T00:00:00.000Z",
    },
    scrapedAt: "2024-01-01T00:00:00.000Z",
    source: "scraper",
    qualityScore: 0.92,
    latencyMs: 420,
    warnings: ["sample_size_missing"],
    metadata: { raw_metrics_present: true },
    accountId: "acct-1",
    displayName: "Brand Studio",
    profileUrl: "https://instagram.com/brand",
    avatarUrl: "https://cdn.test/avatar.jpg",
  },
  created: true,
};

const meta = {
  title: "Admin/AccountPreviewCard",
  component: AccountPreviewCard,
  args: {
    result: sampleResult,
    status: "success",
  },
} satisfies Meta<typeof AccountPreviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ManualSnapshot: Story = {
  args: {
    status: "success",
    result: {
      ...sampleResult,
      snapshot: {
        ...sampleResult.snapshot,
        source: "manual",
        warnings: ["synthetic_snapshot"],
      },
    },
  },
};
