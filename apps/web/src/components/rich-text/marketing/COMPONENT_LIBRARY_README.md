# CMS Component Library

A comprehensive, modern minimalist component library for the SMPLAT CMS, built with Next.js, Payload CMS, and Tailwind CSS.

## Overview

This library provides 11 production-ready, plug-and-play components designed with modern minimalist aesthetics, full responsiveness, and tasteful animations using Framer Motion.

## Components

### Hero Components

#### 1. Hero Centered (`hero-centered`)
- **Location**: `apps/web/src/components/rich-text/marketing/hero-centered.tsx`
- **Features**:
  - Centered headline with gradient text effect on last line
  - Optional subtitle
  - Dual CTA buttons with hover animations
  - Background pattern options (none, gradient, dots, grid)
  - Animated blob backgrounds for gradient pattern
  - Fully responsive

#### 2. Hero Split (`hero-split`)
- **Location**: `apps/web/src/components/rich-text/marketing/hero-split.tsx`
- **Features**:
  - Split layout: text on left, image on right
  - Next.js Image optimization
  - Placeholder support if no image provided
  - Decorative elements
  - Dual CTA buttons
  - Stacks vertically on mobile

#### 3. Hero Minimal (`hero-minimal`)
- **Location**: `apps/web/src/components/rich-text/marketing/hero-minimal.tsx`
- **Features**:
  - Large, bold statement text
  - Single line subtitle with decorative lines
  - Optional scroll animation (parallax effect)
  - Scroll indicator with bounce animation
  - Extremely clean, minimal design

### Content Components

#### 4. Feature Grid Enhanced (`feature-grid-enhanced`)
- **Location**: `apps/web/src/components/rich-text/marketing/feature-grid-enhanced.tsx`
- **Features**:
  - Configurable columns (2, 3, or 4)
  - Icon or numbered badges per feature
  - Optional feature badges (e.g., "New", "Beta")
  - Hover effects with bottom border animation
  - Kicker text support

#### 5. Text Image Text (`text-image-text`)
- **Location**: `apps/web/src/components/rich-text/marketing/text-image-text.tsx`
- **Features**:
  - Alternating image sides (left or right)
  - Optional sticky image on scroll
  - Next.js Image optimization
  - Decorative background elements
  - Supports rich text content

### CTA Components

#### 6. CTA Banner (`cta-banner`)
- **Location**: `apps/web/src/components/rich-text/marketing/cta-banner.tsx`
- **Features**:
  - Full-width banner
  - Background options: gradient, solid colors, or custom image
  - Optional stats row below CTA
  - Decorative circular elements
  - High-contrast design for conversions

#### 7. CTA Card (`cta-card`)
- **Location**: `apps/web/src/components/rich-text/marketing/cta-card.tsx`
- **Features**:
  - Bordered card container
  - Icon or full illustration support
  - Primary and secondary CTAs
  - Decorative corner accents
  - Background patterns

### Data & Stats Components

#### 8. Stats Counter (`stats-counter`)
- **Location**: `apps/web/src/components/rich-text/marketing/stats-counter.tsx`
- **Features**:
  - Animated number counting
  - Automatic extraction and animation of numeric values
  - Icon support per stat
  - Optional descriptions
  - Grid or row layout options
  - Intersection Observer for triggering animations

#### 9. Pricing Cards (`pricing-cards`)
- **Location**: `apps/web/src/components/rich-text/marketing/pricing-cards.tsx`
- **Features**:
  - 2-4 pricing tiers
  - Annual/monthly toggle with smooth transition
  - Highlighted "recommended" plan with scale effect
  - Feature lists with checkmarks/crosses
  - Optional badges (e.g., "Popular", "Best Value")
  - Fully responsive grid

### Social Proof Components

#### 10. Testimonial Grid (`testimonial-grid`)
- **Location**: `apps/web/src/components/rich-text/marketing/testimonial-grid.tsx`
- **Features**:
  - Grid or masonry layout
  - Star ratings
  - Avatar support with fallback initials
  - Featured testimonial highlighting
  - Company and role information
  - Staggered animation on scroll

#### 11. Team Gallery (`team-gallery`)
- **Location**: `apps/web/src/components/rich-text/marketing/team-gallery.tsx`
- **Features**:
  - Configurable columns (2, 3, or 4)
  - Bio overlay on hover
  - Department badges
  - Social links (LinkedIn, Twitter, Email)
  - Image hover scale effect
  - Fully responsive

## Architecture

### File Structure

```
apps-cms-payload/
└── src/
    └── lexical/
        └── customBlocks.ts          # Payload CMS block definitions

apps/web/
└── src/
    └── components/
        └── rich-text/
            ├── custom-converters.tsx  # Block to React component converters
            ├── rich-text.tsx          # Updated to include custom converters
            └── marketing/
                ├── hero-centered.tsx
                ├── hero-split.tsx
                ├── hero-minimal.tsx
                ├── feature-grid-enhanced.tsx
                ├── text-image-text.tsx
                ├── cta-banner.tsx
                ├── cta-card.tsx
                ├── stats-counter.tsx
                ├── pricing-cards.tsx
                ├── testimonial-grid.tsx
                └── team-gallery.tsx
```

### Integration

The components are fully integrated with:

1. **Payload CMS**: Block definitions registered in `payload.config.ts`
2. **Rich Text Renderer**: Custom converters merged into the converter chain
3. **Type Safety**: Full TypeScript support with proper type definitions
4. **Animations**: Tailwind CSS animations configured in `tailwind.config.ts`

## Design System

### Colors
- **Primary Blue**: `#4B8BF5` - Main accent color
- **White**: Pure white backgrounds
- **Grays**: Deep blacks and subtle grays for text
- **Gradients**: Used sparingly for visual interest

### Typography
- **Font**: Inter (sans-serif)
- **Weights**: Light (300), Regular (400), Medium (500), Semibold (600), Bold (700)
- **Scale**: Responsive with `text-xl` to `text-7xl`

### Spacing
- **Sections**: `py-16 md:py-24` for vertical rhythm
- **Content**: `max-w-7xl` for readable content width
- **Gaps**: Consistent 4, 6, 8, 12, 16 spacing scale

### Animations
- **Duration**: 300-600ms for UI elements
- **Easing**: Custom easings for smooth, natural motion
- **Triggers**: Intersection Observer for scroll-triggered animations
- **Performance**: CSS transforms for 60fps animations

## Usage in Payload CMS

1. **Create/Edit a Page**: Navigate to the Pages collection
2. **Add Rich Text Field**: Use the Lexical editor
3. **Insert Block**: Click "+" to add a block
4. **Select Component**: Choose from the custom blocks (e.g., "Hero - Centered")
5. **Configure**: Fill in the block fields in the CMS
6. **Publish**: Save and publish the page

The components will automatically render on the frontend with all styling and animations.

## Best Practices

### Content
- **Headlines**: Keep under 60 characters for optimal impact
- **Body Text**: Aim for 16-18 words per sentence
- **CTAs**: Use action-oriented language (e.g., "Get Started", "Learn More")

### Images
- **Format**: WebP with JPEG fallback
- **Size**: 1200x800px minimum for hero images
- **Optimization**: Use Next.js Image component (built-in)

### Accessibility
- All components use semantic HTML
- ARIA labels where appropriate
- Keyboard navigation support
- Screen reader friendly

### Performance
- Lazy loading with Intersection Observer
- Optimized animations using CSS transforms
- Code-split components
- Next.js Image optimization

## Technical Details

### Dependencies
- **React**: ^18.3.0
- **Next.js**: ^15.0.0
- **Framer Motion**: ^11.0.0
- **Tailwind CSS**: ^3.4.0
- **Payload CMS**: ^3.0.0

### Browser Support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Future Enhancements

The following components are planned for future releases:
- FAQ Accordion
- Timeline (horizontal variant)
- Comparison Table
- Pros/Cons List
- Newsletter Signup
- Video Section
- Image Gallery with Lightbox

## Contributing

When adding new components:
1. Create the block definition in `customBlocks.ts`
2. Create the React component in `marketing/`
3. Add the converter in `custom-converters.tsx`
4. Update this README
5. Test in Payload CMS admin
6. Verify frontend rendering

## License

Internal use for SMPLAT project.
