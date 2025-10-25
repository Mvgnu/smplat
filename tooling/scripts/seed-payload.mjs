#!/usr/bin/env node
import dotenv from 'dotenv';

// Load env from root and app envs
for (const path of ['.env', 'apps/web/.env', 'apps-cms-payload/.env']) {
  dotenv.config({ path, override: false });
}

const BASE_URL = process.env.PAYLOAD_URL || 'http://localhost:3050';
const TOKEN = process.env.PAYLOAD_API_TOKEN || process.env.PAYLOAD_SEED_TOKEN;
const ENVIRONMENT = process.env.CMS_ENV || (process.env.NODE_ENV === 'production' ? 'production' : process.env.PLAYWRIGHT_WORKER_ID ? 'test' : 'development');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (part.startsWith('--')) {
      const [key, value] = part.split('=');
      const name = key.replace(/^--/, '');
      if (typeof value === 'string' && value.length > 0) args[name] = value;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[name] = argv[++i];
      else args[name] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const env = args.environment || args.env || ENVIRONMENT;

async function http(method, path, body) {
  const url = new URL(path, BASE_URL).toString();
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(process.env.SEED_KEY ? { 'x-seed-key': process.env.SEED_KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} -> ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function findOne(collection, where = {}) {
  const url = new URL(`/api/${collection}`, BASE_URL);
  for (const [k, v] of Object.entries(where)) {
    url.searchParams.set(`where[${k}][equals]`, String(v));
  }
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString(), {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : undefined,
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.docs?.[0] || null;
}

async function upsert(collection, whereKey, whereValue, doc) {
  const existing = await findOne(collection, { [whereKey]: whereValue, environment: env });
  if (existing) {
    const { id } = existing;
    const updated = await http('PATCH', `/api/${collection}/${id}`, doc);
    return updated;
  }
  return await http('POST', `/api/${collection}`, doc);
}

// Seed data (mirrors tooling/scripts/seed-sanity.mjs with minor adjustments)
const seed = {
  siteSettings: {
    title: 'SMPLAT',
    tagline: 'Social media growth, engineered for agencies.',
    heroCta: { label: 'Book Discovery Call', href: '#contact' },
  },
  faqs: [
    { question: 'How quickly can we launch a storefront?', answer: 'Most agencies go live within 3-4 weeks thanks to prebuilt flows for checkout, dashboards, and bookkeeping.', category: 'Onboarding' },
    { question: 'Do you support subscriptions and one-off services?', answer: 'Yes. Products can be configured as one-time campaigns or recurring retainers using Stripe Billing integrations.', category: 'Billing' },
  ],
  caseStudy: {
    title: 'Driving 4.2x ROI for a boutique agency',
    client: 'Spotlight Social',
    industry: 'Lifestyle & Fashion',
    summary: 'By centralising checkout, reporting, and fulfillment tracking, Spotlight Social increased client retention while cutting manual work by 60%.',
    results: [
      { label: 'Retention uplift', value: '28%' },
      { label: 'Fulfillment time saved', value: '60%' },
      { label: 'New revenue streams', value: '3' },
    ],
    quote: 'SMPLAT let us deliver a premium client experience without hiring an internal dev team.',
    quoteAuthor: 'Amelia Novak, Founder',
  },
  testimonial: {
    quote: 'SMPLAT helped us launch a premium storefront in record time, letting our team focus on delivering results for clients.',
    author: 'Alex Fischer',
    role: 'Managing Director',
    company: 'GrowthWave Agency',
  },
  pricingTiers: [
    { name: 'Starter', description: 'Launch services with templated workflows.', price: 149, currency: 'EUR', features: [{ value: 'Hosted storefront' }, { value: 'Stripe checkout' }, { value: 'Email notifications' }], ctaLabel: 'Start trial', ctaHref: '#contact', highlight: false },
    { name: 'Growth', description: 'Scale automation and reporting for multi-channel agencies.', price: 349, currency: 'EUR', features: [{ value: 'Client dashboards' }, { value: 'Instagram analytics' }, { value: 'Workflow automation' }], ctaLabel: 'Talk to sales', ctaHref: '#contact', highlight: true },
    { name: 'Enterprise', description: 'Custom integrations, dedicated success, and compliance tooling.', price: 0, currency: 'EUR', features: [{ value: 'Custom SLA' }, { value: 'Lexoffice integration' }, { value: 'Dedicated success manager' }], ctaLabel: 'Request quote', ctaHref: '#contact', highlight: false },
  ],
  blogPosts: [
    { title: 'Your onboarding playbook for social media retainers', slug: 'onboarding-playbook', excerpt: 'Streamline onboarding with standardized forms, readiness checks, and fulfillment handoffs.', publishedAt: new Date().toISOString() },
    { title: 'Automating campaign fulfillment with SMPLAT workflows', slug: 'automation-workflows', excerpt: 'Design task queues and notifications to keep growth campaigns moving without manual ping-pong.', publishedAt: new Date().toISOString() },
  ],
  pages: [
    {
      title: 'Home',
      slug: 'home',
      hero: {
        eyebrow: 'Social Media Growth, Engineered for Agencies',
        headline: 'Launch a premium storefront for your social media services in weeks, not months.',
        subheadline: 'SMPLAT streamlines service purchases, automates fulfillment, and keeps bookkeeping compliant—so you can focus on scaling clients.',
        cta: { label: 'Book Discovery Call', href: '#contact' },
      },
      content: [
        { blockType: 'section', layout: 'two-column', heading: 'Purpose-built for social media agencies', subheading: 'Bundle services, automate fulfillment, and deliver transparent performance dashboards without building custom software from scratch.' },
        { blockType: 'section', layout: 'metrics', heading: 'Proven across campaigns', metrics: [ { label: 'Campaigns launched', value: '1,200+', description: 'High-performing paid and organic pushes.' }, { label: 'Average ROI uplift', value: '3.4x', description: 'Measured across retained clients.' }, { label: 'Client retention', value: '92%', description: 'Annual renewal rate post-launch.' } ] },
        { blockType: 'section', layout: 'case-study', heading: 'Case study: Spotlight Social' },
        { blockType: 'section', layout: 'faq', heading: 'Frequently asked questions' },
        { blockType: 'section', layout: 'testimonials', heading: 'Trusted by agency operators' },
        { blockType: 'section', layout: 'pricing', heading: 'Transparent pricing for every growth stage' },
        { blockType: 'section', layout: 'blog', heading: 'Insights for agency operators' },
      ],
      seoTitle: 'SMPLAT – Social Media Promotion Platform',
      seoDescription: 'Enterprise-ready storefront for social media services with automation, compliance, and analytics.',
    },
  ],
};

async function seedAll() {
  // Create base docs first to get IDs
  const faqIds = [];
  for (const faq of seed.faqs) {
    const created = await upsert('faqs', 'question', faq.question, { ...faq, environment: env });
    faqIds.push(created.id);
  }

  const cs = await upsert('case-studies', 'title', seed.caseStudy.title, { ...seed.caseStudy, environment: env });
  const testimonial = await upsert('testimonials', 'quote', seed.testimonial.quote, { ...seed.testimonial, environment: env });

  const tierIds = [];
  for (const tier of seed.pricingTiers) {
    const created = await upsert('pricing-tiers', 'name', tier.name, { ...tier, environment: env });
    tierIds.push(created.id);
  }

  const blogIds = [];
  for (const post of seed.blogPosts) {
    const created = await upsert('blog-posts', 'slug', post.slug, { ...post, environment: env });
    blogIds.push(created.id);
  }

  await upsert('site-settings', 'title', seed.siteSettings.title, { ...seed.siteSettings, environment: env });

  // Pages with relationships wired
  for (const page of seed.pages) {
    const content = page.content.map((blk) => {
      const out = { ...blk };
      if (blk.layout === 'faq') out.faqItems = faqIds;
      if (blk.layout === 'testimonials') out.testimonials = [testimonial.id];
      if (blk.layout === 'case-study') out.caseStudy = cs.id;
      if (blk.layout === 'pricing') out.pricingTiers = tierIds;
      if (blk.layout === 'blog') out.blogPosts = blogIds;
      return out;
    });
    await upsert('pages', 'slug', page.slug, { ...page, content, environment: env });
  }

  console.log(`Seeded Payload (${env}) at ${BASE_URL}`);
}

seedAll().catch((err) => {
  console.error(err);
  process.exit(1);
});


