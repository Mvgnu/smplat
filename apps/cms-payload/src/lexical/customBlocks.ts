import type { Block } from "payload";

/**
 * Custom Component Library Blocks
 * Modern minimalist design system with light theme
 */

// ============================================================================
// HERO COMPONENTS
// ============================================================================

export const heroCenteredBlock: Block = {
  slug: "hero-centered",
  labels: {
    singular: "Hero - Centered",
    plural: "Hero - Centered"
  },
  fields: [
    {
      name: "headline",
      type: "textarea",
      required: true,
      admin: {
        description: "Main headline (supports line breaks)"
      }
    },
    {
      name: "subtitle",
      type: "textarea",
      admin: {
        description: "Subtitle text below headline"
      }
    },
    {
      name: "primaryCtaLabel",
      label: "Primary CTA Label",
      type: "text"
    },
    {
      name: "primaryCtaHref",
      label: "Primary CTA Link",
      type: "text"
    },
    {
      name: "secondaryCtaLabel",
      label: "Secondary CTA Label",
      type: "text"
    },
    {
      name: "secondaryCtaHref",
      label: "Secondary CTA Link",
      type: "text"
    },
    {
      name: "backgroundPattern",
      type: "select",
      defaultValue: "none",
      options: [
        { label: "None", value: "none" },
        { label: "Gradient", value: "gradient" },
        { label: "Dots", value: "dots" },
        { label: "Grid", value: "grid" }
      ]
    }
  ]
};

export const heroSplitBlock: Block = {
  slug: "hero-split",
  labels: {
    singular: "Hero - Split",
    plural: "Hero - Split"
  },
  fields: [
    {
      name: "headline",
      type: "textarea",
      required: true
    },
    {
      name: "subtitle",
      type: "textarea"
    },
    {
      name: "bodyText",
      type: "richText",
      admin: {
        description: "Optional supporting text"
      }
    },
    {
      name: "primaryCtaLabel",
      label: "Primary CTA Label",
      type: "text"
    },
    {
      name: "primaryCtaHref",
      label: "Primary CTA Link",
      type: "text"
    },
    {
      name: "secondaryCtaLabel",
      label: "Secondary CTA Label",
      type: "text"
    },
    {
      name: "secondaryCtaHref",
      label: "Secondary CTA Link",
      type: "text"
    },
    {
      name: "imageUrl",
      type: "text",
      admin: {
        description: "Right side image URL"
      }
    },
    {
      name: "imageAlt",
      type: "text",
      defaultValue: "Hero image"
    }
  ]
};

export const heroMinimalBlock: Block = {
  slug: "hero-minimal",
  labels: {
    singular: "Hero - Minimal",
    plural: "Hero - Minimal"
  },
  fields: [
    {
      name: "statementText",
      type: "textarea",
      required: true,
      admin: {
        description: "Large statement text (keep it concise)"
      }
    },
    {
      name: "subtitle",
      type: "text",
      admin: {
        description: "Single line subtitle"
      }
    },
    {
      name: "enableScrollAnimation",
      type: "checkbox",
      defaultValue: true,
      admin: {
        description: "Subtle animation on scroll"
      }
    }
  ]
};

// ============================================================================
// FEATURE COMPONENTS
// ============================================================================

export const featureGridEnhancedBlock: Block = {
  slug: "feature-grid-enhanced",
  labels: {
    singular: "Feature Grid",
    plural: "Feature Grids"
  },
  fields: [
    {
      name: "kicker",
      type: "text",
      admin: {
        description: "Small text above heading"
      }
    },
    {
      name: "heading",
      type: "text"
    },
    {
      name: "subheading",
      type: "textarea"
    },
    {
      name: "columns",
      type: "select",
      defaultValue: "3",
      options: [
        { label: "2 Columns", value: "2" },
        { label: "3 Columns", value: "3" },
        { label: "4 Columns", value: "4" }
      ]
    },
    {
      name: "features",
      type: "array",
      minRows: 2,
      fields: [
        {
          name: "icon",
          type: "text",
          admin: {
            description: "Emoji or icon"
          }
        },
        {
          name: "title",
          type: "text",
          required: true
        },
        {
          name: "description",
          type: "textarea",
          required: true
        },
        {
          name: "badge",
          type: "text",
          admin: {
            description: "Optional badge (e.g., 'New', 'Beta')"
          }
        }
      ]
    },
    {
      name: "showNumberBadges",
      type: "checkbox",
      defaultValue: false,
      admin: {
        description: "Show numbered badges instead of icons"
      }
    }
  ]
};

export const textImageTextBlock: Block = {
  slug: "text-image-text",
  labels: {
    singular: "Text-Image-Text Layout",
    plural: "Text-Image-Text Layouts"
  },
  fields: [
    {
      name: "kicker",
      type: "text"
    },
    {
      name: "heading",
      type: "textarea"
    },
    {
      name: "bodyText",
      type: "richText",
      required: true
    },
    {
      name: "imageUrl",
      type: "text",
      required: true
    },
    {
      name: "imageAlt",
      type: "text"
    },
    {
      name: "imageSide",
      type: "select",
      defaultValue: "right",
      options: [
        { label: "Left", value: "left" },
        { label: "Right", value: "right" }
      ]
    },
    {
      name: "imageSticky",
      type: "checkbox",
      defaultValue: false,
      admin: {
        description: "Make image sticky on scroll"
      }
    }
  ]
};

// ============================================================================
// CTA COMPONENTS
// ============================================================================

export const ctaBannerBlock: Block = {
  slug: "cta-banner",
  labels: {
    singular: "CTA Banner",
    plural: "CTA Banners"
  },
  fields: [
    {
      name: "headline",
      type: "textarea",
      required: true
    },
    {
      name: "subtext",
      type: "textarea"
    },
    {
      name: "ctaLabel",
      type: "text",
      required: true
    },
    {
      name: "ctaHref",
      type: "text",
      required: true
    },
    {
      name: "backgroundStyle",
      type: "select",
      defaultValue: "gradient",
      options: [
        { label: "Gradient", value: "gradient" },
        { label: "Solid Blue", value: "solid-blue" },
        { label: "Solid Gray", value: "solid-gray" },
        { label: "Image", value: "image" }
      ]
    },
    {
      name: "backgroundImageUrl",
      type: "text",
      admin: {
        condition: (data) => data.backgroundStyle === "image"
      }
    },
    {
      name: "stats",
      type: "array",
      admin: {
        description: "Optional stats row below text"
      },
      fields: [
        {
          name: "value",
          type: "text",
          required: true
        },
        {
          name: "label",
          type: "text",
          required: true
        }
      ]
    }
  ]
};

export const ctaCardBlock: Block = {
  slug: "cta-card",
  labels: {
    singular: "CTA Card",
    plural: "CTA Cards"
  },
  fields: [
    {
      name: "icon",
      type: "text",
      admin: {
        description: "Emoji or icon"
      }
    },
    {
      name: "heading",
      type: "text",
      required: true
    },
    {
      name: "description",
      type: "textarea",
      required: true
    },
    {
      name: "primaryCtaLabel",
      type: "text",
      required: true
    },
    {
      name: "primaryCtaHref",
      type: "text",
      required: true
    },
    {
      name: "secondaryCtaLabel",
      type: "text"
    },
    {
      name: "secondaryCtaHref",
      type: "text"
    },
    {
      name: "illustrationUrl",
      type: "text",
      admin: {
        description: "Optional illustration image"
      }
    }
  ]
};

// ============================================================================
// DATA & STATS COMPONENTS
// ============================================================================

export const statsCounterBlock: Block = {
  slug: "stats-counter",
  labels: {
    singular: "Stats Counter",
    plural: "Stats Counters"
  },
  fields: [
    {
      name: "heading",
      type: "text"
    },
    {
      name: "subheading",
      type: "textarea"
    },
    {
      name: "stats",
      type: "array",
      minRows: 2,
      maxRows: 6,
      fields: [
        {
          name: "icon",
          type: "text"
        },
        {
          name: "value",
          type: "text",
          required: true,
          admin: {
            description: "e.g., '10K+', '99%', '$5M'"
          }
        },
        {
          name: "label",
          type: "text",
          required: true
        },
        {
          name: "description",
          type: "textarea"
        }
      ]
    },
    {
      name: "layoutStyle",
      type: "select",
      defaultValue: "grid",
      options: [
        { label: "Grid", value: "grid" },
        { label: "Row", value: "row" }
      ]
    }
  ]
};

export const pricingCardsBlock: Block = {
  slug: "pricing-cards",
  labels: {
    singular: "Pricing Cards",
    plural: "Pricing Cards"
  },
  fields: [
    {
      name: "kicker",
      type: "text"
    },
    {
      name: "heading",
      type: "text"
    },
    {
      name: "subheading",
      type: "textarea"
    },
    {
      name: "enableToggle",
      type: "checkbox",
      defaultValue: true,
      admin: {
        description: "Enable annual/monthly toggle"
      }
    },
    {
      name: "plans",
      type: "array",
      minRows: 2,
      maxRows: 4,
      fields: [
        {
          name: "name",
          type: "text",
          required: true
        },
        {
          name: "badge",
          type: "text",
          admin: {
            description: "e.g., 'Popular', 'Best Value'"
          }
        },
        {
          name: "description",
          type: "textarea"
        },
        {
          name: "monthlyPrice",
          type: "number",
          required: true
        },
        {
          name: "annualPrice",
          type: "number"
        },
        {
          name: "currency",
          type: "text",
          defaultValue: "$"
        },
        {
          name: "features",
          type: "array",
          fields: [
            {
              name: "text",
              type: "text",
              required: true
            },
            {
              name: "included",
              type: "checkbox",
              defaultValue: true
            }
          ]
        },
        {
          name: "ctaLabel",
          type: "text",
          defaultValue: "Get started"
        },
        {
          name: "ctaHref",
          type: "text"
        },
        {
          name: "highlighted",
          type: "checkbox",
          defaultValue: false,
          admin: {
            description: "Highlight as recommended plan"
          }
        }
      ]
    }
  ]
};

// ============================================================================
// SOCIAL PROOF COMPONENTS
// ============================================================================

export const testimonialGridBlock: Block = {
  slug: "testimonial-grid",
  labels: {
    singular: "Testimonial Grid",
    plural: "Testimonial Grids"
  },
  fields: [
    {
      name: "kicker",
      type: "text"
    },
    {
      name: "heading",
      type: "text"
    },
    {
      name: "subheading",
      type: "textarea"
    },
    {
      name: "layout",
      type: "select",
      defaultValue: "grid",
      options: [
        { label: "Grid", value: "grid" },
        { label: "Masonry", value: "masonry" }
      ]
    },
    {
      name: "testimonials",
      type: "array",
      minRows: 3,
      fields: [
        {
          name: "quote",
          type: "textarea",
          required: true
        },
        {
          name: "author",
          type: "text",
          required: true
        },
        {
          name: "role",
          type: "text"
        },
        {
          name: "company",
          type: "text"
        },
        {
          name: "avatarUrl",
          type: "text"
        },
        {
          name: "rating",
          type: "number",
          min: 1,
          max: 5,
          admin: {
            description: "Star rating (1-5)"
          }
        },
        {
          name: "featured",
          type: "checkbox",
          defaultValue: false,
          admin: {
            description: "Highlight this testimonial"
          }
        }
      ]
    }
  ]
};

export const teamGalleryBlock: Block = {
  slug: "team-gallery",
  labels: {
    singular: "Team Gallery",
    plural: "Team Galleries"
  },
  fields: [
    {
      name: "kicker",
      type: "text"
    },
    {
      name: "heading",
      type: "text"
    },
    {
      name: "subheading",
      type: "textarea"
    },
    {
      name: "columns",
      type: "select",
      defaultValue: "3",
      options: [
        { label: "2 Columns", value: "2" },
        { label: "3 Columns", value: "3" },
        { label: "4 Columns", value: "4" }
      ]
    },
    {
      name: "members",
      type: "array",
      minRows: 1,
      fields: [
        {
          name: "name",
          type: "text",
          required: true
        },
        {
          name: "role",
          type: "text",
          required: true
        },
        {
          name: "department",
          type: "text"
        },
        {
          name: "bio",
          type: "textarea"
        },
        {
          name: "imageUrl",
          type: "text",
          required: true
        },
        {
          name: "linkedinUrl",
          type: "text"
        },
        {
          name: "twitterUrl",
          type: "text"
        },
        {
          name: "emailUrl",
          type: "text"
        }
      ]
    }
  ]
};

// Export all blocks as an array for easy registration
export const customBlocks: Block[] = [
  heroCenteredBlock,
  heroSplitBlock,
  heroMinimalBlock,
  featureGridEnhancedBlock,
  textImageTextBlock,
  ctaBannerBlock,
  ctaCardBlock,
  statsCounterBlock,
  pricingCardsBlock,
  testimonialGridBlock,
  teamGalleryBlock
];
