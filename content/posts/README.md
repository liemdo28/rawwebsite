# RawWebsite Content Posts

This directory stores blog posts published by AgentAI Agency.

**Publishing path:** `content/posts/{slug}.md`
**Format:** Markdown with YAML frontmatter

## Frontmatter schema

```yaml
---
title: "Post Title"
slug: post-slug
date: 2026-04-17
excerpt: "1-2 sentence excerpt"
meta_description: "SEO meta description (120-160 chars)"
image: "https://..."
primary_keyword: "target keyword"
secondary_keywords: [kw1, kw2]
post_type: viral_attention
target_audience: "who this post is for"
published: false
---
```

## Post types

- `viral_attention`   — attention / discovery post
- `conversion_order`  — order / visit intent post
- `local_discovery`  — locally relevant post
- `tourist_discovery` — visitor-targeted post
- `menu_highlight`   — signature dish post

## Loading posts

Posts are rendered as standalone articles (e.g., `blog-20-years.html`,
`blog-nigiri-art.html`). The Stories & Insights section on `index.html` is the
single discovery surface; there is no listing/index page (the legacy
`blog-posts.html` route was removed).
