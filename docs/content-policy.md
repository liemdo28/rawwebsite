# Raw Sushi Bar — Social Media Content Policy

> Reference documentation extracted from `agentai-agency/src/unified/social/policy.py`
> and `store_profiles.py`. Do not push to git.

---

## 1. Brand Tone

| Location | Style | Reading Level | Emoji Usage |
|---|---|---|---|
| Stockton | friendly, modern, local, premium-casual | Simple | Light (1–2 per post) |
| Modesto | friendly, local, warm, casual | Simple | Light (1–2 per post) |

- Write conversational, **mobile-first** copy.
- Max **3 exclamation marks** per post.
- No runs of **4+ consecutive ALL-CAPS words**.
- Never fabricate facts, reviews, or specific prices.

---

## 2. What to Include

### Location mention (required — +20 pts)
Every post must name the city explicitly.

| Location | City to mention |
|---|---|
| raw_stockton | Stockton |
| raw_modesto | Modesto |

### Primary SEO keywords (required — +20 pts)
Include **1–2 naturally** from the list for the location.

**Stockton**
- sushi Stockton
- best sushi in Stockton
- Japanese restaurant Stockton

**Modesto**
- sushi Modesto
- best sushi in Modesto
- Japanese restaurant Modesto

### Secondary keywords (use when relevant)

**Stockton:** fresh sushi near me · sushi rolls Stockton · sashimi Stockton · Japanese food Stockton

**Modesto:** fresh sushi near me · sushi Modesto CA · Japanese food Modesto

### Call-to-action (required — +15 pts)
Every post needs at least one CTA verb: **order · visit · call · reserve · check · try · book**

**Target actions by location**

| Location | Preferred actions |
|---|---|
| Stockton | visit, order, reserve |
| Modesto | visit, reserve |

**CTA URLs**

| Location | Order URL | Menu URL | Location URL |
|---|---|---|---|
| Stockton | https://order.toasttab.com/online/raw-sushi-bistro-10742-trinity-pkwy-ste-d | https://www.rawsushibar.com/menu/stockton/ | https://www.rawsushibar.com/stockton/ |
| Modesto | *(no online ordering)* | https://www.rawsushibar.com/menu/modesto/ | https://www.rawsushibar.com/modesto/ |

### Post length (required — +10 pts)
Body text must be **50–280 characters** (generator targets 50–150 words for the full post).

### Hashtags
Include **3–5 hashtags** with at least one location tag (e.g. `#StocktonCA`, `#ModestoCA`).

---

## 3. What to Avoid

### Hard blocks — post is rejected immediately (score = 0)

| Rule | Detail |
|---|---|
| **Hate speech / slurs** | Any racial, ethnic, or gender-based slur. Zero tolerance. |
| **Deceptive health claims** | Phrases like "cures cancer", "prevents disease", "treats diabetes". |
| **Illegal / drug content** | Mentions of weed, marijuana, cannabis, cocaine, or drugs. |
| **Violent language** | kill · murder · shoot · bomb · attack — unless clearly idiomatic ("kill it", "bomb the vibe"). |

### Soft failures — lower score, may still pass if other checks pass

| Rule | Penalty | Detail |
|---|---|---|
| Missing city name | −20 pts | Post doesn't mention the store's city. |
| Missing primary keyword | −20 pts | No primary SEO keyword present. |
| Missing CTA verb | −15 pts | No action verb found. |
| Bad length | −10 pts | Under 50 or over 280 characters. |
| Brand tone violation | −15 pts | ≥ 4 consecutive ALL-CAPS words **or** > 3 exclamation marks. |
| Keyword stuffing | −10 pts | Any single keyword appears more than **3 times**. |
| Fake / unverifiable claims | −10 pts | "best in the world" · "only place" · "guaranteed". |

**Passing threshold: 60 / 100.** A post below 60 is flagged as `policy_failed`.

---

## 4. Social Post Format

All posts follow a four-part structure:

```
Hook → Value → CTA → Hashtags
```

### Breakdown

| Section | Field | Rules |
|---|---|---|
| **Hook** | `headline` | Under 10 words. Punchy, attention-grabbing. |
| **Value** | `body` | 50–150 words. Conversational. Mention city + 1–2 primary keywords naturally. No fake claims. |
| **CTA** | `cta` | One clear action sentence with the appropriate URL. |
| **Hashtags** | `hashtags` | 3–5 tags. Include location tags. |

### Example skeleton

```
[Headline — punchy hook under 10 words]

[Body — 50–150 words. City name. 1-2 primary keywords woven in naturally.
No fabricated facts. Light emoji use (1–2 max).]

[CTA sentence → URL]

#Hashtag1 #Hashtag2 #LocationTag
```

---

## 5. Weekly Rotation Schedule

Posts are generated twice daily at the scheduled posting hours (store local time).

| Weekday | Content Type | Business Goal | Stockton Posts | Modesto Posts |
|---|---|---|---|---|
| **Monday** | Freshness Push | Drive online orders | 11:30, 18:00 | 11:30, 17:30 |
| **Tuesday** | Local SEO Post | Local SEO | 11:30, 18:00 | 11:30, 17:30 |
| **Wednesday** | Order CTA Post | Drive online orders | 11:30, 18:00 | 11:30, 17:30 |
| **Thursday** | Social Proof | Build trust | 11:30, 18:00 | 11:30, 17:30 |
| **Friday** | Weekend Vibe | Drive group dining | 11:30, 18:00 | 11:30, 17:30 |
| **Saturday** | Menu Highlight | Drive in-store visit | 11:30, 18:00 | 11:30, 17:30 |
| **Sunday** | Review-Based | Build trust | 11:30, 18:00 | 11:30, 17:30 |

### Content type descriptions

| Content Type | Purpose |
|---|---|
| **Freshness Push** | Highlight today's fresh fish / daily specials to drive immediate orders. |
| **Local SEO Post** | Keyword-rich, city-focused copy designed to improve search visibility. |
| **Order CTA Post** | Direct conversion push — link to online ordering prominently. |
| **Social Proof** | Feature customer sentiment, accolades, or community praise. |
| **Weekend Vibe** | Group dining / date night framing to fill weekend seats. |
| **Menu Highlight** | Spotlight a specific dish or menu section to drive in-person visits. |
| **Review-Based** | Paraphrase or echo real customer experiences (never fabricate). |

---

## 6. Approval & Publishing

All posts require **human approval** before publishing (`approval_mode = APPROVAL_REQUIRED`).

Post lifecycle: `planned → generated → policy_failed | pending_approval → approved | rejected → scheduled → publishing → published | publish_failed`

Platforms: **Facebook** and **Instagram** for both locations.

---

*Source: `agentai-agency/src/unified/social/policy.py`, `store_profiles.py`, `generator.py`, `scheduler.py`, `models.py`*
