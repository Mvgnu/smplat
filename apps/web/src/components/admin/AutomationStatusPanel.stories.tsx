import type { Meta, StoryObj } from "@storybook/react";

import { AutomationStatusPanel } from "./AutomationStatusPanel";
import type { ProviderAutomationHistory, ProviderAutomationStatus } from "@/types/provider-automation";

const status: ProviderAutomationStatus = {
  replay: {
    ranAt: "2025-01-10T01:00:00.000Z",
    summary: {
      processed: 5,
      succeeded: 4,
      failed: 1,
      scheduledBacklog: 3,
      nextScheduledAt: "2025-01-10T01:30:00.000Z",
    },
  },
  alerts: {
    ranAt: "2025-01-10T01:05:00.000Z",
    summary: {
      alertsSent: 2,
      alertsDigest: [
        {
          providerId: "prov-alpha",
          providerName: "Alpha Network",
          reasons: ["guardrail fail", "replay errors"],
        },
        {
          providerId: "prov-beta",
          providerName: "Beta Ops",
          reasons: ["replay backlog spike"],
        },
      ],
    },
  },
};

const history: ProviderAutomationHistory = {
  replay: [
    {
      ranAt: "2025-01-09T23:00:00.000Z",
      summary: { processed: 8, succeeded: 8, scheduledBacklog: 1 },
    },
    {
      ranAt: "2025-01-09T21:00:00.000Z",
      summary: { processed: 6, succeeded: 5, failed: 1 },
    },
  ],
  alerts: [
    {
      ranAt: "2025-01-09T22:00:00.000Z",
      summary: { alertsSent: 0 },
    },
  ],
};

const meta = {
  title: "Admin/AutomationStatusPanel",
  component: AutomationStatusPanel,
  args: {
    status,
    history,
    refreshPath: "/admin/orders",
  },
} satisfies Meta<typeof AutomationStatusPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HistoryOnly: Story = {
  args: {
    status: null,
    history,
  },
};
