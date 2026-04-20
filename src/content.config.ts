import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
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

export const collections = { blog };
