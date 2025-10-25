export type Metric = {
  label: string;
  value: string;
  caption?: string;
};

export type FeatureHighlight = {
  title: string;
  description: string;
};

export type Review = {
  id: string;
  author: string;
  role?: string;
  rating: number;
  highlight: string;
};

export type Bundle = {
  slug: string;
  title: string;
  description: string;
  savings?: string;
};

export type FAQ = {
  question: string;
  answer: string;
};

export type GalleryItem = {
  id: string;
  title?: string;
  description?: string;
  imageUrl: string;
};

export type MarketingContent = {
  heroEyebrow?: string;
  heroSubheadline?: string;
  featureHighlights: FeatureHighlight[];
  benefits: string[];
  metrics: Metric[];
  reviews: Review[];
  bundles: Bundle[];
  faqs: FAQ[];
  gallery: GalleryItem[];
};

export const defaultMarketing: MarketingContent = {
  heroEyebrow: undefined,
  heroSubheadline:
    "SMPLAT orchestrates paid and organic experiments to compound reach, followers, and conversions.",
  featureHighlights: [],
  benefits: [],
  metrics: [],
  reviews: [],
  bundles: [],
  faqs: [],
  gallery: [],
};

export const marketingFallbacks: Record<string, MarketingContent> = {
  "instagram-growth": {
    heroEyebrow: "Instagram Growth Accelerator",
    heroSubheadline:
      "Full-service acquisition engine blending organic discovery, influencer collaborations, and analytics-led optimization.",
    featureHighlights: [
      {
        title: "Full-funnel Instagram playbook",
        description:
          "DM outreach, explore tab targeting, reels syndication, and collab drops orchestrated by seasoned strategists.",
      },
      {
        title: "Audience intelligence",
        description:
          "Signals captured from your top-performing content plus competitor benchmarking to fuel ongoing experiments.",
      },
      {
        title: "Compliance-first automation",
        description:
          "Automated workflows tuned to Instagram's latest policies to ensure sustainable, safe growth.",
      },
    ],
    benefits: [
      "Campaign kickoff call within 24 hours of purchase.",
      "Baseline analytics captured before experiment ramp-up.",
      "Weekly performance briefing with recommended actions.",
    ],
    metrics: [
      { label: "Avg follower lift (60 days)", value: "+3,850", caption: "SMB agencies across EU and US." },
      { label: "Content engagement increase", value: "+68%", caption: "Measured on likes, saves, replies." },
      { label: "Support satisfaction", value: "4.9/5", caption: "Post-campaign CSAT surveys." },
    ],
    reviews: [
      {
        id: "review-01",
        author: "Amelia Richter",
        role: "Founder, Atlas Creative Studio",
        rating: 5,
        highlight:
          "Our account finally has momentum—3.2k new followers in a month and bookings doubled. The weekly briefs make it effortless to keep stakeholders updated.",
      },
      {
        id: "review-02",
        author: "David Mensah",
        role: "Growth Lead, Nova Brands",
        rating: 5,
        highlight:
          "We tried countless vendors; SMPLAT is the first that combined experimentation, analytics, and compliance at the level a VC-backed team expects.",
      },
    ],
    bundles: [
      {
        slug: "instagram-growth+tiktok-ads",
        title: "Instagram Growth + TikTok Ads Accelerator",
        description: "Run cross-platform experiments and sync creative testing insights.",
        savings: "Save 12%",
      },
      {
        slug: "instagram-growth+ugc-lab",
        title: "Growth Campaign + UGC Lab",
        description: "Bundle organic growth with a steady pipeline of platform-native creatives.",
        savings: "Save 8%",
      },
    ],
    faqs: [
      {
        question: "Do I need to share account credentials?",
        answer:
          "We never ask for direct credentials upfront. Secure access is established via Meta Business Manager or a delegated collaborator invite after onboarding.",
      },
      {
        question: "How soon will we see results?",
        answer:
          "Most clients see uplift in reach and followers within the first 10–14 days. Full momentum occurs over 4–8 weeks as experiments compound.",
      },
      {
        question: "Can you work with regulated industries?",
        answer:
          "Yes. We adapt strategies to comply with industry and platform policies (finance, health, crypto) and provide legal review steps when needed.",
      },
    ],
    gallery: [
      {
        id: "ig-gallery-creative-brief",
        title: "Creative brief workspace",
        description: "Operators plan weekly experiment drops with collaborative checklists.",
        imageUrl: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80",
      },
      {
        id: "ig-gallery-reporting",
        title: "Performance dashboards",
        description: "Automated reporting slices results by test cohort for faster iteration.",
        imageUrl: "https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=1200&q=80",
      },
      {
        id: "ig-gallery-ugc",
        title: "UGC capture sessions",
        description: "Fresh creator assets staged for upcoming campaign pushes.",
        imageUrl: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80",
      },
    ],
  },
  "tiktok-growth": {
    heroEyebrow: "TikTok Growth Sprint",
    heroSubheadline:
      "Launch viral-native TikTok experiments without reinventing your delivery engine by pairing creative velocity with campaign analytics.",
    featureHighlights: [
      {
        title: "Hook experimentation engine",
        description:
          "Iterate on hook + CTA variations weekly using insights from your winning TikToks and cross-channel analytics.",
      },
      {
        title: "Creator collaboration desk",
        description:
          "Tap vetted creators for duet/remix campaigns managed alongside your organic posting cadence and paid amplification.",
      },
      {
        title: "Safety-first automation",
        description:
          "Workflow automation handles scheduling, moderation, and reporting while respecting TikTok's safety rails.",
      },
    ],
    benefits: [
      "Dedicated creative strategist + editor pod ready within 48h.",
      "Weekly creative retros with performance scorecards and experiment backlog.",
      "Optional paid booster layer to accelerate winning organic concepts.",
    ],
    metrics: [
      { label: "24h view velocity", value: "2.4×", caption: "Average uplift after sprint launch." },
      { label: "Creative iterations shipped", value: "18/mo", caption: "Per brand across hook + CTA combinations." },
      { label: "Audience save rate", value: "5.8%", caption: "Aggregated across retail, creator, and SaaS verticals." },
    ],
    reviews: [
      {
        id: "review-11",
        author: "Layla Hart",
        role: "Head of Content, Nova Goods",
        rating: 5,
        highlight:
          "The sprint rituals keep our feeds inspired. We finally have a predictable process for shipping new concepts every week.",
      },
      {
        id: "review-12",
        author: "Marco Gutiérrez",
        role: "Creator Partnerships, Beam Collective",
        rating: 5,
        highlight:
          "The SMPLAT pod slotted into our existing workflows and turned TikTok from a black box into a reliable growth lever.",
      },
    ],
    bundles: [
      {
        slug: "tiktok-growth+instagram-growth",
        title: "TikTok Sprint + Instagram Accelerator",
        description: "Align organic TikTok velocity with Instagram growth cadences for cross-platform lift.",
        savings: "Save 10%",
      },
      {
        slug: "tiktok-growth+ugc-lab",
        title: "TikTok Sprint + UGC Lab",
        description: "Guarantee a fresh pipeline of UGC deliverables to fuel ongoing hook experimentation.",
        savings: "Save 7%",
      },
    ],
    faqs: [
      {
        question: "Do you handle creator sourcing?",
        answer:
          "Yes. We manage sourcing, contracting, briefs, and approvals while providing transparency into budget and performance.",
      },
      {
        question: "Can we sync paid amplification?",
        answer:
          "Absolutely. We can export winning concepts to your ads team or manage Spark Ads activation for top-performing organic posts.",
      },
      {
        question: "How do you report success?",
        answer:
          "Weekly recaps include velocity metrics, audience retention, and creative insights. Dashboards refresh daily so teams stay aligned.",
      },
    ],
    gallery: [
      {
        id: "tt-gallery-storyboard",
        title: "Storyboard stand-ups",
        description: "Creative pods align on hooks, angles, and call-to-actions before production.",
        imageUrl: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80",
      },
      {
        id: "tt-gallery-production",
        title: "On-set production workflow",
        description: "Lean setups orchestrate rapid TikTok footage capture with real-time feedback loops.",
        imageUrl: "https://images.unsplash.com/photo-1522199755839-a2bacb67c546?auto=format&fit=crop&w=1200&q=80",
      },
      {
        id: "tt-gallery-analytics",
        title: "Creative analytics dashboards",
        description: "Track hook retention, watch time, and conversion signals across campaigns.",
        imageUrl: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80",
      },
    ],
  },
};
