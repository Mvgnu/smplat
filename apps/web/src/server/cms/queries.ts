import groq from "groq";

export const pageBySlugQuery = groq`
*[_type == "page" && slug.current == $slug][0]{
  _id,
  title,
  slug,
  hero{
    eyebrow,
    headline,
    subheadline,
    cta
  },
  content[]{
    ...,
    metrics[]{label, value, description},
    faqItems[]->{
      question,
      answer,
      category
    },
    testimonials[]->{
      quote,
      author,
      role,
      company,
      "avatarUrl": avatar.asset->url
    },
    caseStudy->{
      title,
      client,
      industry,
      summary,
      results,
      quote,
      quoteAuthor
    },
    pricingTiers[]->{
      name,
      description,
      price,
      currency,
      features,
      ctaLabel,
      ctaHref,
      highlight
    },
    blogPosts[]->{
      title,
      slug,
      excerpt,
      publishedAt
    },
    _type == "testimonial" => @->{
      quote,
      author,
      role,
      company,
      "avatarUrl": avatar.asset->url
    }
  },
  seoTitle,
  seoDescription
}
`;

export const homepageQuery = groq`
*[_type == "page" && slug.current == "home"][0]{
  _id,
  title,
  hero{
    eyebrow,
    headline,
    subheadline,
    cta
  },
  content[]{
    ...,
    metrics[]{label, value, description},
    faqItems[]->{
      question,
      answer,
      category
    },
    testimonials[]->{
      quote,
      author,
      role,
      company,
      "avatarUrl": avatar.asset->url
    },
    caseStudy->{
      title,
      client,
      industry,
      summary,
      results,
      quote,
      quoteAuthor
    },
    pricingTiers[]->{
      name,
      description,
      price,
      currency,
      features,
      ctaLabel,
      ctaHref,
      highlight
    },
    blogPosts[]->{
      title,
      slug,
      excerpt,
      publishedAt
    },
    _type == "testimonial" => @->{
      quote,
      author,
      role,
      company,
      "avatarUrl": avatar.asset->url
    }
  }
}
`;

export const blogPostsQuery = groq`
*[_type == "blogPost"] | order(publishedAt desc){
  _id,
  title,
  slug,
  excerpt,
  publishedAt
}
`;

export const blogPostBySlugQuery = groq`
*[_type == "blogPost" && slug.current == $slug][0]{
  _id,
  title,
  slug,
  excerpt,
  publishedAt,
  body
}
`;
