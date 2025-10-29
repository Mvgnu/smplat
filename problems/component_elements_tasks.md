The component library is lackluster and needs to be aggressively refined, expanded, and supplied with elements befitting theme and allowing for creation of variable and refreshing interesting multitude of frontend pages.

# CMS Component Library Specification
## Modern Minimalistic Design System for NextJS + Payload CMS

---

## 🎨 Design Guidance & Code Examples

### Core Design Principles
- **Typography**: Clean, high-contrast text with generous whitespace
- **Colors**: Blue accent (#4B8BF5), pure whites, deep blacks/grays
- **Spacing**: Generous padding, asymmetric layouts, breathing room
- **Effects**: Subtle shadows, smooth transitions, occasional gradients
- **Philosophy**: "Less is more" with strategic bold statements

### Base Styles (Tailwind CSS)
```css
/* Typography Classes */
.heading-primary {
  @apply text-4xl md:text-6xl font-bold tracking-tight;
}

.heading-secondary {
  @apply text-2xl md:text-4xl font-semibold;
}

.text-accent {
  @apply text-blue-500;
}

.text-muted {
  @apply text-gray-600;
}

/* Container Classes */
.section-padding {
  @apply py-16 md:py-24 px-4 md:px-8;
}

.content-max {
  @apply max-w-7xl mx-auto;
}

/* Card Styles */
.card-base {
  @apply bg-white rounded-lg shadow-sm hover:shadow-lg transition-shadow duration-300;
}

.card-bordered {
  @apply border border-gray-100;
}

/* Button Variants */
.btn-primary {
  @apply bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors;
}

.btn-outline {
  @apply border-2 border-blue-500 text-blue-500 px-6 py-3 rounded-lg hover:bg-blue-50;
}

.btn-ghost {
  @apply text-gray-700 hover:text-blue-500 transition-colors;
}
```

---

## ✅ Component Library TODO List

### 🏠 Hero Components
- [ ] **Hero Variant 1: Centered**
  - Centered headline with gradient text
  - Subtitle below
  - Dual CTA buttons
  - Optional background pattern/gradient
  
- [ ] **Hero Variant 2: Split**
  - Left: Text content with CTAs
  - Right: Image/illustration/code preview
  - Mobile: Stack vertically
  
- [ ] **Hero Variant 3: Minimal**
  - Large statement text
  - Single line subtitle
  - Subtle animation on scroll

### 📝 Content Sections
- [ ] **Text-Image-Text Layout**
  - Alternating sides configuration
  - Image sticky option
  - Text alignment variants
  
- [ ] **Feature Grid**
  - 2/3/4 column options
  - Icon + title + description
  - Hover effects
  - Number badges option
  
- [ ] **Feature List Expanded**
  - Accordion style
  - Tab style
  - Side-by-side comparison
  
- [ ] **Services Section**
  - Card grid (3 columns)
  - Icon/emoji support
  - Hover lift effect
  - "Learn more" links

### 🎯 CTA Components
- [ ] **CTA Banner**
  - Full width background (gradient/solid/image)
  - Centered text + button
  - Optional stats row
  
- [ ] **CTA Inline**
  - Within content blocks
  - Arrow animations
  - Multiple button variants
  
- [ ] **CTA Floating**
  - Fixed position option
  - Slide-in animation
  - Dismissible variant
  
- [ ] **CTA Card**
  - Bordered container
  - Icon/illustration option
  - Multiple action buttons
  
- [ ] **CTA Split**
  - Two action paths
  - "Choose your path" style
  - Visual differentiation

### 👥 Team & Testimonials
- [ ] **Team Gallery**
  - Grid layout (2/3/4 columns)
  - Hover: show bio
  - Social links
  - Filter by department option
  
- [ ] **Testimonial Carousel**
  - Auto-play option
  - Profile pictures
  - Company logos
  - Star ratings
  
- [ ] **Testimonial Grid**
  - Masonry layout option
  - Highlight featured
  - Read more expansion

### 📊 Data & Comparison
- [ ] **Stats Counter**
  - Animated numbers
  - Icon + label
  - Grid layout
  
- [ ] **Comparison Table**
  - Sticky header
  - Highlight column
  - Check/cross icons
  - Mobile responsive
  
- [ ] **Pros/Cons List**
  - Two column layout
  - Color coding
  - Icons for each point
  
- [ ] **Pricing Cards**
  - 3 tier standard
  - Highlight recommended
  - Feature lists
  - Annual/monthly toggle

### 🗺️ Navigation & Organization
- [ ] **FAQ Accordion**
  - Smooth expand/collapse
  - Search functionality
  - Category filtering
  
- [ ] **Timeline**
  - Vertical/horizontal options
  - Milestone markers
  - Content cards
  
- [ ] **Process Steps**
  - Numbered sequence
  - Progress line
  - Icon support
  
- [ ] **Tab Content**
  - Icon tabs
  - Pill style options
  - Animated underline

### 📱 Interactive Elements
- [ ] **Newsletter Signup**
  - Inline form
  - Modal variant
  - Success animation
  
- [ ] **Quiz Component**
  - Multi-step
  - Progress indicator
  - Results display
  
- [ ] **Interactive Map**
  - Location pins
  - Info popups
  - Filter options
  
- [ ] **Event Card**
  - Date badge
  - Registration CTA
  - Countdown timer option

### 🎨 Visual Elements
- [ ] **Image Gallery**
  - Lightbox support
  - Grid/masonry layouts
  - Caption overlays
  
- [ ] **Video Section**
  - Embed support
  - Play button overlay
  - Poster image
  
- [ ] **Code Block**
  - Syntax highlighting
  - Copy button
  - Language badge
  
- [ ] **Chart Integration**
  - Chart.js wrapper
  - Responsive sizing
  - Dark mode support

### 🔧 Utility Components
- [ ] **Divider Variants**
  - Wave pattern
  - Gradient line
  - Icon separator
  
- [ ] **Badge System**
  - Status indicators
  - Category tags
  - "New" markers
  
- [ ] **Alert Banners**
  - Info/warning/success/error
  - Dismissible option
  - Icon support
  
- [ ] **Loading States**
  - Skeleton screens
  - Spinners
  - Progress bars

### 🌟 Special Sections
- [ ] **404 Page**
  - Playful illustration
  - Search suggestion
  - Popular links
  
- [ ] **Coming Soon**
  - Countdown timer
  - Email capture
  - Social links
  
- [ ] **Cookie Banner**
  - Minimal design
  - Accept/decline
  - Preferences link
  
- [ ] **Social Proof Bar**
  - Logo carousel
  - "Trusted by" section
  - Animation options

---

## 🚀 Additional Strategic Components

### Advanced Marketing
- [ ] **A/B Test Container**
  - Variant management
  - Analytics integration
  
- [ ] **Exit Intent Popup**
  - Trigger configuration
  - Offer customization
  
- [ ] **Sticky Bar**
  - Announcement/offer
  - Countdown timer
  - CTA button

### E-commerce Specific
- [ ] **Product Preview Card**
  - Quick view option
  - Add to cart
  - Wishlist toggle
  
- [ ] **Trust Badges**
  - Security icons
  - Payment methods
  - Guarantees

### Content Enhancement
- [ ] **Related Posts**
  - Card grid
  - Thumbnail + title
  - Category tags
  
- [ ] **Author Bio**
  - Avatar + description
  - Social links
  - Other articles

---

## 💻 Implementation Notes

### Payload CMS Configuration
```javascript
// Example field configuration for a Hero component
{
  name: 'hero',
  type: 'group',
  fields: [
    {
      name: 'variant',
      type: 'select',
      options: ['centered', 'split', 'minimal']
    },
    {
      name: 'headline',
      type: 'text',
      required: true
    },
    {
      name: 'subtitle',
      type: 'text'
    },
    {
      name: 'ctaPrimary',
      type: 'group',
      fields: [
        { name: 'text', type: 'text' },
        { name: 'link', type: 'text' },
        { name: 'style', type: 'select', options: ['primary', 'outline', 'ghost'] }
      ]
    }
  ]
}
```

### NextJS Component Structure
```jsx
// Modular component approach
const Hero = ({ variant, data }) => {
  const variants = {
    centered: <HeroCentered {...data} />,
    split: <HeroSplit {...data} />,
    minimal: <HeroMinimal {...data} />
  };
  
  return variants[variant] || variants.centered;
};
```

### Responsive Breakpoints
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px
- Wide: > 1440px

### Animation Guidelines
- Use Framer Motion for complex animations
- CSS transitions for simple hover states
- Intersection Observer for scroll triggers
- Keep animations under 300ms for UI elements

---

## 📋 Priority Implementation Order

1. **Phase 1 - Core** (Week 1-2)
   - Hero variants
   - Basic CTAs
   - Feature grid
   - Text-image layouts

2. **Phase 2 - Engagement** (Week 3-4)
   - Newsletter signup
   - FAQ accordion
   - Team gallery
   - Testimonials

3. **Phase 3 - Conversion** (Week 5-6)
   - Pricing cards
   - Comparison table
   - Advanced CTAs
   - Trust elements

4. **Phase 4 - Enhancement** (Week 7-8)
   - Interactive elements
   - Special sections
   - Analytics integration
   - A/B testing setup

---

## 🎯 Success Metrics
- Component reusability > 80%
- Load time < 3s
- Accessibility score > 95
- Mobile responsiveness 100%
- CMS editor satisfaction score

---

## 📚 Resources & References
- Design inspiration: Your provided screenshots
- Tailwind UI for component patterns
- Framer Motion documentation
- Payload CMS blocks documentation
- NextJS Image optimization guide

---

*This specification is a living document. Update as components are built and tested.*