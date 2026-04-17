# Raw Sushi Bar — Marketing Website (Static)

> Official website for a Japanese sushi restaurant chain with locations in **Stockton** and **Modesto**, California — founded in **2005** by Ông Hoang.
> Website: `www.rawsushibar.com`

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Pages & Features](#4-pages--features)
5. [Running & Deployment](#5-running--deployment)
6. [Developer Notes](#6-developer-notes)

---

## 1. Project Overview

**Raw Sushi Bar** is a marketing website for a Japanese sushi restaurant chain in California operating **2 locations**:

| Location | Address | Phone |
|---|---|---|
| **Stockton** | 1105 San Joaquin Ave, Stockton, CA 95203 | (209) 954-9729 |
| **Modesto** | 1200 I Street, Modesto, CA 95354 | (209) 566-9560 |

The website serves as: brand landing page, location pages, menu (JSON-driven), blog (12 articles), SEO pages, online ordering (Toast Tab) & delivery (DoorDash), and Schema.org JSON-LD markup.

**Domain:** `www.rawsushibar.com`
**Social Media:** Facebook `/rawsushibar/`, Instagram `/rawsushibistro/`

---

## 2. Tech Stack

This is a **static site — no build step, no complex JS framework.**

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | HTML5 + CSS3 + Vanilla JS | Each page is a standalone `.html` file |
| **Fonts** | Google Fonts | **Playfair Display** (headings) + **Inter** (body) |
| **Analytics** | GA4 | Measurement ID: `G-WNHH66NT41` |
| **Hosting** | **Cloudflare Workers** | Static files + edge middleware |
| **Deploy CLI** | Wrangler | Account ID: `d6077e27e541616287ddb50cfbbe97ac` |
| **SEO** | Schema.org JSON-LD | Restaurant, FAQPage, BlogPosting, BreadcrumbList, Organization |
| **SEO** | Open Graph + Twitter Card + sitemap.xml + robots.txt |
| **GDPR** | cookie-consent.js + cookie-consent.css | Banner + modal + localStorage consent |

---

## 3. Project Structure

```
RawWebsite/
├── index.html                  # Brand homepage
│
├── 🍽️  Location Pages
│   ├── stockton.html              # Stockton landing page
│   ├── modesto.html               # Modesto landing page
│   ├── menu-stockton.html         # Stockton menu (~97KB)
│   ├── menu-modesto.html         # Modesto menu (~80KB)
│   └── terms.html                 # Terms of service
│
├── 📦  Ordering & Services
│   ├── order-sushi-modesto.html
│   ├── order-sushi-stockton.html
│   ├── sushi-catering-modesto.html
│   ├── sushi-catering-stockton.html
│   └── sushi-delivery-stockton.html
│
├── 🔍  SEO Landing Pages (9 pages)
│   ├── best-sushi-modesto.html
│   ├── best-sushi-stockton.html
│   ├── japanese-restaurant-modesto.html
│   ├── japanese-restaurant-stockton.html
│   ├── sushi-downtown-modesto.html
│   ├── stockton-sushi.html
│   └── date-night-stockton.html
│
├── 📝  Blog (12 articles)
│   ├── blog-20-years.html
│   ├── blog-nigiri-art.html
│   ├── blog-sashimi-guide.html
│   ├── blog-sushi-etiquette.html
│   ├── blog-catering-guide.html
│   ├── blog-top-sushi-rolls.html
│   ├── blog-date-night-guide.html
│   ├── blog-modesto-dining.html
│   ├── blog-stockton-restaurants.html
│   ├── blog-sustainability.html
│   └── blog-test-publish.html     ⚠️ Test page (author="agentai-test")
│
├── ⚙️  JavaScript
│   ├── analytics.js               # GA4: clicks, scroll, forms, calls, orders
│   └── cookie-consent.js          # GDPR banner + modal + localStorage
│
├── 🎨  CSS
│   └── cookie-consent.css         # Cookie consent styles
│
├── 🗺️  SEO
│   ├── sitemap.xml                # 30+ URLs, updated 2026-04-11
│   └── robots.txt                 # Allow all
│
├── ⚡  Cloudflare Workers
│   └── functions/
│       └── _middleware.js         # 301 redirect apex → www
│
└── 🔧  Deployment Config
    └── .wrangler/                 # Wrangler account cache
```

---

## 4. Pages & Features

### 4.1 Location Pages (`stockton.html`, `modesto.html`)

- Address, phone number, operating hours
- Embedded Google Maps
- Links to reservation (Toast Tab) + delivery (DoorDash)
- Schema.org: `Restaurant` + `OpeningHoursSpecification`

### 4.2 Menu Pages

- HTML table-based menu (static, no CMS)
- Categories: Appetizers, Sushi Rolls, Signature Rolls, Sashimi, Nigiri, Teriyaki, Noodles, Bento Boxes, Kids Menu, Desserts, Drinks
- Item markers: 🌱 Vegetarian, 🌶️ Spicy, 🐟 Raw, 🍱 Chef's Choice

### 4.3 Analytics (`analytics.js`)

| Event | Trigger |
|---|---|
| `call_click` | Click on phone number (`tel:`) |
| `email_click` | Click on email (`mailto:`) |
| `order_click` | Click on Toast / DoorDash |
| `directions_click` | Click on Google Maps |
| `scroll_depth` | Scroll to 25/50/75/90% |
| `lead_submit` | Form submission with email |

**Location detection logic:** Automatically identifies Modesto/Stockton from the page URL.

### 4.4 Cookie Consent

- Banner appears after 1 second if no consent has been given
- Modal allows toggling Analytics & Marketing cookies
- Stored in `localStorage` under key: `rawSushiCookieConsent`

### 4.5 Cloudflare Middleware (`functions/_middleware.js`)

```
rawsushibar.com/*             →  301  →  www.rawsushibar.com/*
stockton.rawsushibar.com/*    →  301  →  www.rawsushibar.com/*
```

---

## 5. Running & Deployment

### 5.1 Local Preview

```bash
# Option 1: Direct file open
open index.html           # macOS
start index.html          # Windows

# Option 2: HTTP server (recommended)
npx serve .
# → http://localhost:3000

# Or Python
python3 -m http.server 8080
```

### 5.2 Deploy to Cloudflare Workers

```bash
# 1. Install Wrangler
npm install -g wrangler

# 2. Login
wrangler login

# 3. Deploy
cd /e/Project/Master/RawWebsite/
wrangler deploy
```

---

## 6. Developer Notes

### ✅ What's Good
- **No build step** — edit HTML → refresh → see results
- **No framework** — Vanilla JS/CSS, easy to read
- **Each page is self-contained** — no router, no shared state
- **Complete SEO** — every page has meta, canonical, and schema markup

### ⚠️ Points of Caution

| # | Issue | Risk |
|---|---|---|
| 1 | **Duplicate CSS** — each page has its own inline `<style>` | Changing design tokens requires updating all files |
| 2 | **Nav/footer not shared** — each page contains its own nav HTML | Changing the nav requires updating 30+ files |
| 3 | **Menu is static HTML tables** — no CMS | Updating prices/items means editing files directly |
| 4 | **GA4 `G-WNHH66NT41` is the production ID** | Testing can pollute real analytics data |
| 5 | **`blog-test-publish.html`** has author="agentai-test" | Likely a test page that should be removed |
| 6 | **No `wrangler.toml` exists** | Should be created for clear Worker config management |

### 💡 Suggested Improvements
- Extract a shared `styles.css` + JS to inject nav/footer to reduce duplication
- Create a `wrangler.toml` for explicit deployment configuration
- Set up a GA4 staging property for testing
- Add CI/CD with GitHub Actions

---

*README last updated 2026-04-14*
