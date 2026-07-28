/**
 * lib/renderArticlePage.js — Renders a published post into a standalone,
 * fully self-contained static HTML page matching the site's existing
 * article template (see public/chili-oil-101-adding-heat-to-sushi-night.html),
 * extended with a hero image and per-schema-type JSON-LD.
 *
 * This closes a gap in the original scheduler pipeline: commitToGit() only
 * wrote content/posts/<slug>.md + content/index.json, neither of which is
 * rendered into a routable page anywhere in the build (src/pages/ is empty
 * and build.mjs just copies public/ + content/ as-is). Without this
 * renderer, a "published" post was never actually visitable on the site.
 *
 * Cloudflare Workers compatible: no filesystem access, pure string building.
 */

const SITE = 'https://www.rawsushibar.com';
const BRAND = 'Raw Sushi Bar';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} post - post record (see content/campaign/*.mjs for shape)
 * @returns {string} full HTML document
 */
export function renderArticlePage(post) {
  const url = `${SITE}/${post.slug}.html`;
  const imagePath = post.image ? `/images/${post.image}` : '';
  const imageUrl = imagePath ? `${SITE}${imagePath}` : '';
  const title = escapeHtml(post.title);
  const desc = escapeHtml(post.meta_description || post.excerpt || '');
  const publishedDate = (post.publish_at || post.published_at || new Date().toISOString());
  // dateModified must be deterministic across scheduled<->publishing<->scheduled
  // state retries — post.updated_at is stamped by the store on EVERY write,
  // including pure state transitions with no editorial change, so using it
  // here made the rendered page (and therefore the Git commit) differ between
  // retries of the exact same content. content_updated_at is set only when
  // the post's actual content/metadata changes (never by the scheduler's own
  // state machine); if a record predates that field, publishedDate itself is
  // used — stable across retries, unlike post.updated_at or new Date().
  const modifiedDate = post.content_updated_at || publishedDate;

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description || post.excerpt || '',
    image: imageUrl || undefined,
    datePublished: publishedDate,
    dateModified: modifiedDate,
    author: { '@type': 'Organization', name: BRAND },
    publisher: { '@type': 'Organization', name: BRAND },
    mainEntityOfPage: url,
  };

  // Optional FAQPage schema for posts explicitly tagged schema_type: 'FAQPage'
  // with an faq[] array of { q, a } pairs actually present in the visible body.
  let faqLdScript = '';
  if (post.schema_type === 'FAQPage' && Array.isArray(post.faq) && post.faq.length) {
    const faqLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: post.faq.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    };
    faqLdScript = `\n    <script type="application/ld+json">${JSON.stringify(faqLd)}</script>`;
  }

  const heroImg = imagePath
    ? `<img src="${imagePath}" width="1200" height="630" alt="${escapeHtml(post.image_alt || post.title)}" style="width:100%;height:auto;max-height:420px;object-fit:cover;border-radius:6px;margin-top:24px" loading="eager">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${desc}">
    <meta name="keywords" content="${escapeHtml([post.primary_keyword, ...(post.secondary_keywords || [])].filter(Boolean).join(', '))}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${url}">
    <title>${title} | Raw Sushi Bar</title>
    <meta property="og:type" content="article">
    <meta property="og:title" content="${title} | Raw Sushi Bar">
    <meta property="og:description" content="${desc}">
    <meta property="og:url" content="${url}">
    ${imageUrl ? `<meta property="og:image" content="${imageUrl}">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">` : ''}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${desc}">
    ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ''}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
    <style>:root{--red:#C41E3A;--ink:#201f1d;--muted:#5b5650;--cream:#faf8f5;--line:#e7ddd2}*{box-sizing:border-box}body{margin:0;font-family:Inter,sans-serif;color:var(--ink);background:var(--cream);line-height:1.7}.nav{background:#171615;color:white;padding:18px clamp(18px,4vw,56px);display:flex;gap:24px;align-items:center;justify-content:space-between}.brand{font-weight:800;letter-spacing:.08em;color:white;text-decoration:none}.nav-links{display:flex;gap:18px;flex-wrap:wrap}.nav-links a{color:white;text-decoration:none;font-weight:600}.hero{padding:clamp(52px,8vw,96px) clamp(20px,6vw,88px);background:linear-gradient(135deg,#241f1c 0%,#3b1c21 100%);color:white}.hero p{max-width:760px;font-size:1.18rem;color:#f5e9dc}h1{font-family:"Playfair Display",serif;font-size:clamp(2.4rem,6vw,4.5rem);line-height:1.05;margin:0 0 20px}h2{font-family:"Playfair Display",serif;font-size:clamp(1.6rem,3vw,2.2rem);margin-top:42px}main article{max-width:860px;margin:0 auto;padding:54px 20px 72px}.eyebrow{color:var(--red);font-weight:800;text-transform:uppercase;letter-spacing:.08em}a{color:var(--red);font-weight:700}.cta{margin-top:34px;padding:26px;border:1px solid var(--line);background:white}.button{display:inline-block;background:var(--red);color:white;text-decoration:none;padding:13px 18px;border-radius:4px}footer{padding:28px 20px;text-align:center;color:var(--muted);border-top:1px solid var(--line)}</style>
    <script type="application/ld+json">${JSON.stringify(articleLd)}</script>${faqLdScript}
</head>
<body>
    <nav class="nav" aria-label="Main navigation"><a class="brand" href="/">RAW SUSHI BAR</a><div class="nav-links"><a href="/">Home</a><a href="/menu/stockton/">Menu</a><a href="/stockton/">Stockton</a><a href="/order/stockton/">Order</a></div></nav>
    <header class="hero"><p class="eyebrow">Local Guide</p><h1>${title}</h1><p>${desc}</p></header>
    <main><article>
        ${heroImg}
        ${post.body}
    </article></main>
    <footer>&copy; 2026 Raw Sushi Bar. All rights reserved.</footer>
</body>
</html>`;
}

/**
 * Build a <url> entry for public/sitemap.xml.
 */
export function buildSitemapEntry(post) {
  const url = `${SITE}/${post.slug}.html`;
  const lastmod = (post.publish_at || new Date().toISOString()).slice(0, 10);
  return `  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
}

/**
 * Insert a new <url> block into an existing sitemap.xml string, just before
 * </urlset>. No-op (returns unchanged) if the URL is already present.
 */
export function addUrlToSitemap(sitemapXml, post) {
  const url = `${SITE}/${post.slug}.html`;
  if (sitemapXml.includes(`<loc>${url}</loc>`)) return sitemapXml;
  const entry = buildSitemapEntry(post);
  if (sitemapXml.includes('</urlset>')) {
    return sitemapXml.replace('</urlset>', `${entry}\n</urlset>`);
  }
  // No existing sitemap — create a minimal valid one.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entry}\n</urlset>\n`;
}

/**
 * Add a newly-published post's routes to the committed
 * functions/_validPaths.mjs manifest (see scripts/generate-valid-paths.mjs).
 * _middleware.js checks every request path against this manifest to decide
 * real-page vs. real-404 — without this, a freshly-published article would
 * 404 until the next full `node scripts/generate-valid-paths.mjs` run.
 *
 * Cloudflare Workers compatible: no filesystem access, pure string/regex.
 * Parses the existing generated file's VALID_PATHS array rather than
 * regenerating it from scratch, so this stays a minimal diff no matter how
 * large public/ has grown.
 */
export function addPathsToValidPathsManifest(manifestSource, post) {
  const newPaths = [`/${post.slug}.html`, `/${post.slug}`];
  const match = manifestSource.match(/VALID_PATHS = new Set\((\[[\s\S]*?\])\);/);
  const existing = match ? JSON.parse(match[1]) : ['/'];
  const merged = [...new Set([...existing, ...newPaths])].sort();
  return `/**\n * functions/_validPaths.mjs — GENERATED by scripts/generate-valid-paths.mjs.\n * Do not hand-edit; re-run the generator (or let build.mjs / the scheduler\n * publish step do it) after adding or publishing a page.\n */\nexport const VALID_PATHS = new Set(${JSON.stringify(merged, null, 2)});\n`;
}
