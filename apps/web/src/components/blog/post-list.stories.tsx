import type { Meta, StoryObj } from "@storybook/react";

import { PostList } from "./post-list";

const posts = [
  {
    title: "Your onboarding playbook for social media retainers",
    slug: { current: "onboarding-playbook" },
    excerpt: "Streamline onboarding with standardized forms, readiness checks, and fulfillment handoffs.",
    publishedAt: new Date().toISOString()
  },
  {
    title: "Automating campaign fulfillment with SMPLAT workflows",
    slug: { current: "automation-workflows" },
    excerpt: "Design task queues and notifications to keep growth campaigns moving without manual ping-pong.",
    publishedAt: new Date().toISOString()
  }
];

const meta: Meta<typeof PostList> = {
  title: "Components/Blog/PostList",
  component: PostList,
  parameters: {
    backgrounds: {
      default: "dark"
    }
  }
};

export default meta;

type Story = StoryObj<typeof PostList>;

export const Default: Story = {
  args: {
    posts
  }
};
