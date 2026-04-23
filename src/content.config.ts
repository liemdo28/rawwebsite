import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// "Stories & Insights" is the content section (formerly named "blog").
// Static article pages live in public/ and are served directly by Cloudflare Pages.
// This collection definition is retained for schema reference only;
// src/content/stories/ directory is not currently populated.
const stories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/stories' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    author: z.string(),
    datePublished: z.string(),
    readTime: z.string(),
    category: z.string(),
    categoryColor: z.string(),
    image: z.string().optional(),
    ctaText: z.string().optional(),
    ctaUrl: z.string().optional(),
    published: z.boolean().optional(),
  }),
});

export const collections = { stories };
