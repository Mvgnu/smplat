import { createClient } from '@sanity/client';
import dotenv from 'dotenv';

const envPaths = ['.env', 'apps/web/.env', 'apps/cms/.env'];
for (const path of envPaths) {
  dotenv.config({ path, override: false });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (part.startsWith('--')) {
      const [key, value] = part.split('=');
      const name = key.replace(/^--/, '');
      if (typeof value === 'string' && value.length > 0) {
        args[name] = value;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[name] = argv[++i];
      } else {
        args[name] = true;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const projectId = args.project || process.env.SANITY_PROJECT_ID || 'smplat';
const dataset = args.dataset || process.env.SANITY_DATASET || 'development';
const apiVersion = args.apiVersion || process.env.SANITY_API_VERSION || '2025-10-15';
const token = args.token || process.env.SANITY_WRITE_TOKEN || process.env.SANITY_READ_TOKEN;

const client = createClient({
  projectId,
  dataset,
  token,
  useCdn: false,
  apiVersion
});

if (!token) {
  console.error('Missing token: provide --token, SANITY_WRITE_TOKEN, or SANITY_READ_TOKEN');
  process.exit(1);
}

const docs = [
  {
    _id: 'siteSettings::default',
    _type: 'siteSettings',
    title: 'SMPLAT',
    tagline: 'Social media growth, engineered for agencies.',
    heroCta: {
      label: 'Book Discovery Call',
      href: '#contact'
    }
  },
  {
    _id: 'faq-onboarding',
    _type: 'faq',
    question: 'How quickly can we launch a storefront?',
    answer: 'Most agencies go live within 3-4 weeks thanks to prebuilt flows for checkout, dashboards, and bookkeeping.',
    category: 'Onboarding'
  },
  {
    _id: 'faq-billing',
    _type: 'faq',
    question: 'Do you support subscriptions and one-off services?',
    answer: 'Yes. Products can be configured as one-time campaigns or recurring retainers using Stripe Billing integrations.',
    category: 'Billing'
  },
  {
    _id: 'case-study-default',
    _type: 'caseStudy',
    title: 'Driving 4.2x ROI for a boutique agency',
    client: 'Spotlight Social',
    industry: 'Lifestyle & Fashion',
    summary: 'By centralising checkout, reporting, and fulfillment tracking, Spotlight Social increased client retention while cutting manual work by 60%.',
    results: [
      { label: 'Retention uplift', value: '28%' },
      { label: 'Fulfillment time saved', value: '60%' },
      { label: 'New revenue streams', value: '3' }
    ],
    quote: 'SMPLAT let us deliver a premium client experience without hiring an internal dev team.',
    quoteAuthor: 'Amelia Novak, Founder'
  },
  {
    _id: 'page-home',
    _type: 'page',
    title: 'Home',
    slug: { current: 'home' },
    hero: {
      eyebrow: 'Social Media Growth, Engineered for Agencies',
      headline: 'Launch a premium storefront for your social media services in weeks, not months.',
      subheadline: 'SMPLAT streamlines service purchases, automates fulfillment, and keeps bookkeeping compliant—so you can focus on scaling clients.',
      cta: {
        label: 'Book Discovery Call',
        href: '#contact'
      }
    },
    content: [
      {
        _type: 'section',
        _key: 'capabilities-intro',
        heading: 'Purpose-built for social media agencies',
        subheading: 'Bundle services, automate fulfillment, and deliver transparent performance dashboards without building custom software from scratch.'
      },
      {
        _type: 'section',
        _key: 'metrics',
        layout: 'metrics',
        heading: 'Proven across campaigns',
        metrics: [
          { label: 'Campaigns launched', value: '1,200+', description: 'High-performing paid and organic pushes.' },
          { label: 'Average ROI uplift', value: '3.4x', description: 'Measured across retained clients.' },
          { label: 'Client retention', value: '92%', description: 'Annual renewal rate post-launch.' }
        ]
      },
      {
        _type: 'section',
        _key: 'case-study',
        layout: 'case-study',
        heading: 'Case study: Spotlight Social',
        caseStudy: {
          _type: 'reference',
          _ref: 'case-study-default'
        }
      },
      {
        _type: 'section',
        _key: 'faq',
        layout: 'faq',
        heading: 'Frequently asked questions',
        faqItems: [
          { _type: 'reference', _ref: 'faq-onboarding' },
          { _type: 'reference', _ref: 'faq-billing' }
        ]
      },
      {
        _type: 'section',
        _key: 'testimonial-carousel',
        layout: 'testimonials',
        heading: 'Trusted by agency operators',
        testimonials: [
          { _type: 'reference', _ref: 'testimonial-default' }
        ]
      },
      {
        _type: 'section',
        _key: 'pricing-grid',
        layout: 'pricing',
        heading: 'Transparent pricing for every growth stage',
        pricingTiers: [
          { _type: 'reference', _ref: 'pricing-tier-starter' },
          { _type: 'reference', _ref: 'pricing-tier-growth' },
          { _type: 'reference', _ref: 'pricing-tier-enterprise' }
        ]
      },
      {
        _type: 'section',
        _key: 'blog-highlights',
        layout: 'blog',
        heading: 'Insights for agency operators',
        blogPosts: [
          { _type: 'reference', _ref: 'blog-onboarding-playbook' },
          { _type: 'reference', _ref: 'blog-automation' }
        ]
      }
    ],
    seoTitle: 'SMPLAT – Social Media Promotion Platform',
    seoDescription: 'Enterprise-ready storefront for social media services with automation, compliance, and analytics.'
  },
  {
    _id: 'testimonial-default',
    _type: 'testimonial',
    quote: 'SMPLAT helped us launch a premium storefront in record time, letting our team focus on delivering results for clients.',
    author: 'Alex Fischer',
    role: 'Managing Director',
    company: 'GrowthWave Agency'
  },
  {
    _id: 'pricing-tier-starter',
    _type: 'pricingTier',
    name: 'Starter',
    description: 'Launch services with templated workflows.',
    price: 149,
    currency: 'EUR',
    features: ['Hosted storefront', 'Stripe checkout', 'Email notifications'],
    ctaLabel: 'Start trial',
    ctaHref: '#contact',
    highlight: false
  },
  {
    _id: 'pricing-tier-growth',
    _type: 'pricingTier',
    name: 'Growth',
    description: 'Scale automation and reporting for multi-channel agencies.',
    price: 349,
    currency: 'EUR',
    features: ['Client dashboards', 'Instagram analytics', 'Workflow automation'],
    ctaLabel: 'Talk to sales',
    ctaHref: '#contact',
    highlight: true
  },
  {
    _id: 'pricing-tier-enterprise',
    _type: 'pricingTier',
    name: 'Enterprise',
    description: 'Custom integrations, dedicated success, and compliance tooling.',
    price: 0,
    currency: 'EUR',
    features: ['Custom SLA', 'Lexoffice integration', 'Dedicated success manager'],
    ctaLabel: 'Request quote',
    ctaHref: '#contact',
    highlight: false
  },
  {
    _id: 'blog-onboarding-playbook',
    _type: 'blogPost',
    title: 'Your onboarding playbook for social media retainers',
    slug: { current: 'onboarding-playbook' },
    excerpt: 'Streamline onboarding with standardized forms, readiness checks, and fulfillment handoffs.',
    publishedAt: new Date().toISOString()
  },
  {
    _id: 'blog-automation',
    _type: 'blogPost',
    title: 'Automating campaign fulfillment with SMPLAT workflows',
    slug: { current: 'automation-workflows' },
    excerpt: 'Design task queues and notifications to keep growth campaigns moving without manual ping-pong.',
    publishedAt: new Date().toISOString()
  },
  {
    _id: 'product-instagram-growth',
    _type: 'page',
    title: 'Instagram Growth Accelerator',
    slug: { current: 'product-instagram-growth' },
    hero: {
      eyebrow: 'Instagram Growth Accelerator',
      headline: 'Convert dormant Instagram accounts into revenue engines.',
      subheadline:
        'Launch structured growth sprints with experiment-backed content, community engagement, and analytics reporting tuned for agency retainers.',
      cta: {
        label: 'Start Growth Sprint',
        href: '#checkout'
      }
    },
    content: [
      {
        _type: 'section',
        _key: 'metrics',
        layout: 'metrics',
        heading: 'Delivery metrics our operators hit consistently',
        metrics: [
          { label: 'Avg. follower lift (90d)', value: '38%', description: 'Across consumer + creator verticals.' },
          { label: 'Weekly content cadence', value: '5 posts', description: 'Carousel + Reels mix per sprint.' },
          { label: 'Audience engagement', value: '4.8%', description: 'Measured via saves, replies, profile clicks.' }
        ]
      },
      {
        _type: 'section',
        _key: 'testimonial-sasha',
        layout: 'testimonials',
        heading: 'Operators using SMPLAT to scale social revenue',
        testimonials: [
          {
            author: 'Sasha Nguyen',
            role: 'Head of Growth, Lumen Labs',
            quote:
              'Our playbooks finally execute on schedule. Weekly insights and automated fulfillment gave us the confidence to pitch aggressive growth retainers.'
          },
          {
            author: 'Mateo Ruiz',
            role: 'Managing Partner, Orbit Agency',
            quote:
              'Bundling services with configurable add-ons helped us close 3x bigger retainers within a quarter. SMPLAT keeps fulfillment accountable.'
          }
        ]
      },
      {
        _type: 'section',
        _key: 'highlights',
        heading: 'Why agencies standardise Instagram growth on SMPLAT',
        subheading: 'Field-tested workflows so strategists can focus on creative direction, not admin.',
        content: [
          'Experiment-backed creative sprints with integrated asset briefs.',
          'Audience development cadences tuned for retention and conversion.',
          'Live analytics synced to client dashboards for weekly reporting.',
          'Optional UGC lab add-on to keep creative iterations fresh.'
        ]
      },
      {
        _type: 'section',
        _key: 'faq',
        layout: 'faq',
        heading: 'Instagram growth FAQs',
        faqItems: [
          {
            question: 'How soon do we see traction?',
            answer: 'Most retainers hit measurable reach and follower lift in 10–14 days; compounding growth arrives by week 6.'
          },
          {
            question: 'What assets do clients need to provide?',
            answer: 'A brand kit, approval guardrails, and any mandatory legal disclaimers. SMPLAT operators handle the rest.'
          },
          {
            question: 'Can we bundle this with paid campaigns?',
            answer: 'Yes. Pair with the Ads Lab bundles to sync creative testing and accelerate conversion experiments.'
          }
        ]
      }
    ],
    seoTitle: 'Instagram Growth Accelerator Service | SMPLAT',
    seoDescription:
      'Premium Instagram growth retainers with experiment-backed content, analytics, and configurable add-ons managed through SMPLAT.'
  },
  {
    _id: 'product-tiktok-growth',
    _type: 'page',
    title: 'TikTok Growth Sprint',
    slug: { current: 'product-tiktok-growth' },
    hero: {
      eyebrow: 'TikTok Growth Sprint',
      headline: 'Launch viral-native TikTok experiments without reinventing your delivery engine.',
      subheadline:
        'Pair creative iteration frameworks with storefront configurable add-ons to compound reach, followers, and community conversion.',
      cta: {
        label: 'Activate TikTok Sprint',
        href: '#checkout'
      }
    },
    content: [
      {
        _type: 'section',
        _key: 'metrics',
        layout: 'metrics',
        heading: 'Performance metrics teams unlock',
        metrics: [
          { label: 'Average view velocity', value: '2.4x', description: 'Rolling 48h view uplift post launch.' },
          { label: 'Weekly creative drops', value: '6 assets', description: 'Hook variations + CTA experiments.' },
          { label: 'Audience save rate', value: '5.8%', description: 'Across retail, creator, and SaaS verticals.' }
        ]
      },
      {
        _type: 'section',
        _key: 'testimonial-loop',
        layout: 'testimonials',
        heading: 'Agencies shipping TikTok sprints on SMPLAT',
        testimonials: [
          {
            author: 'Lina Duarte',
            role: 'Creative Director, Pulse Agency',
            quote:
              'The configurator lets clients tailor deliverables per campaign. Fulfillment keeps us honest with daily task rollups.'
          },
          {
            author: 'Jon Park',
            role: 'Co-founder, Resonance Labs',
            quote:
              'We plug in our media buyers and launch sprint bundles instantly. SMPLAT surfaces upsells our reps were missing.'
          }
        ]
      },
      {
        _type: 'section',
        _key: 'highlights',
        heading: 'Sprint ingredients your clients feel immediately',
        subheading: 'Operationalised creative testing plus retention loops orchestrated via SMPLAT.',
        content: [
          'Daily trend mining with creative briefs synced to campaign dashboards.',
          'UGC talent roster routing with automated approvals.',
          'Audience retargeting briefs delivered alongside organic performance.',
          'Structured experiment reporting ready for client check-ins.'
        ]
      },
      {
        _type: 'section',
        _key: 'faq',
        layout: 'faq',
        heading: 'TikTok sprint FAQs',
        faqItems: [
          {
            question: 'Can we add paid amplification?',
            answer: 'Yes—bundle with Ads Lab add-ons to route top-performing creatives into paid traffic.'
          },
          {
            question: 'How do you handle brand safety?',
            answer: 'We provide creative guardrails and optional legal review steps for regulated verticals.'
          },
          {
            question: 'What deliverables are standard?',
            answer: 'Default sprint includes hook matrix, 6 concepts/week, retention metrics, and a post-mortem workshop.'
          }
        ]
      }
    ],
    seoTitle: 'TikTok Growth Sprint Service | SMPLAT',
    seoDescription:
      'Experiment-driven TikTok growth sprints with configurable add-ons, automated fulfillment, and agency-ready reporting powered by SMPLAT.'
  }
];

async function seed() {
  const transaction = client.transaction();

  for (const doc of docs) {
    transaction.createOrReplace(doc);
  }

  await transaction.commit();
  console.log('Seeded Sanity dataset with baseline content.');
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
