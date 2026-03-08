# Social Brain — Strategy Doc
*Last updated: February 2026*

---

## What Is Social Brain?

Social Brain is a conversational analytics tool for Instagram creators. It connects to your Instagram Business or Creator account, processes your Reels (transcripts, hooks, topics, and performance metrics), and lets you query that data through natural language inside Claude or ChatGPT via an MCP server.

Instead of digging through Instagram's native analytics, you just ask:
- *"What are my top performing reels by saves?"*
- *"Find all my content about morning routines"*
- *"Which hook styles perform best for me?"*

Social Brain stores every reel's transcript, hook, topics, views, likes, comments, shares, and saves — building a growing personal content intelligence layer that gets more valuable the longer you use it.

---

## The Problem It Solves

Personal brand creators post constantly but fly blind. Instagram's native analytics are shallow, siloed, and require manual effort to extract insight from. There's no easy way to ask "what's actually working and why?" — so most creators guess.

Social Brain turns your content history into a queryable dataset, giving you the kind of clarity that previously required a data analyst or expensive third-party tools.

---

## Who It's For

**Primary:** Personal brand creators and influencers building an audience on Instagram. They own their accounts, care deeply about growth, and post consistently enough to generate meaningful data.

**Not (yet):** UGC creators who submit content through platforms like Tribe — they don't own the IG accounts they post to, so they can't connect to Social Brain.

---

## Product

### How It Works
1. User connects their Instagram Business/Creator account via Facebook OAuth
2. Social Brain pulls and processes their Reels — extracting transcripts, hooks, topics, and metrics
3. User adds the Social Brain MCP server (`https://mcp.socialbrain.io`) to Claude or ChatGPT
4. User chats with their content data in natural language

### MCP Tools
- `list_reels` — list reels with sorting and filtering by date, views, engagement, saves, video type
- `search_reels` — search across transcripts, hooks, and topics by keyword

### Tech Stack
- Frontend: React / app.socialbrain.io
- Auth: Clerk + Facebook OAuth
- Data: Supabase (stores reel transcripts, hooks, topics, metrics per user)
- Payments: Stripe (via Clerk integration)
- Infra: Railway
- MCP Server: `mcp.socialbrain.io`

### Security
- Read-only access — cannot post, edit, or delete content
- User-scoped data — users only access their own data
- Token-based auth with 5-day expiration

---

## Business Model

| | |
|---|---|
| **Pricing** | $49/month |
| **Trial** | Free closed beta → paid with trial period |
| **Rev share** | 30% recurring to distribution partner |
| **Net per customer (after Stripe + rev share)** | ~$32.58/month |

---

## The Moat

**Today:** Head start, not a moat. The MCP server and automated reel processing are replicable.

**Building toward:**

1. **Data network effects** — as users grow, aggregate benchmarks become possible. "Your hook style is performing 40% below creators in your niche with similar follower counts." No competitor can offer this without the dataset.

2. **Brand + distribution** — being the go-to tool for personal brand creators is a real moat. First-mover advantage in a specific niche compounds.

3. **Switching costs** — every month a creator uses Social Brain, their historical data grows. Months of indexed content and pattern recognition make leaving painful.

**The move:** Get users in fast, focus on one niche, build benchmarking before a competitor does.

---

## Go-To-Market

### Target Customer
Personal brand creators building an audience on Instagram. Entrepreneurs, coaches, educators, and thought leaders who post consistently and care about growth metrics.

### Distribution Strategy
- **Primary:** Distribution partner on 30% recurring rev share with a referral code. Partner is a personal brand creator himself — ideal customer who can authentically speak to the audience.
- **Secondary:** Founder's own Instagram content documenting the build and showing Social Brain in use (not ads — authentic process content).
- **Future:** Additional distribution partners in specific creator niches (finance, fitness, real estate) once model is proven.

### Pricing Rationale
- $49/month is low enough to be an easy yes for serious creators
- High enough to filter tire kickers and generate real feedback
- 30% rev share ($14.70/customer) keeps partner motivated while protecting margins
- Revisit $99/month pricing as product matures and ROI story sharpens

---

## Roadmap to $10,000/month Gross

**Target:** 204 paying customers at $49/month

---

### Phase 1 — Validate (Now → Week 4)
**Goal:** Learn before you scale

- Onboard 2-3 hand-picked closed beta users (starting with distribution partner)
- Treat them like real users — minimal hand-holding
- Watch where they get confused or drop off
- Answer: *Why should someone pay for this in one sentence?*
- Do not scale anything until that answer is crisp

---

### Phase 2 — First Revenue (Weeks 4–8)
**Goal:** 10 paying customers

- Flip to paid with a free trial
- Direct outreach to warm contacts — newsletter list, personal network
- These don't need to be perfect customers — just people willing to pay
- Proves the model, funds itself, generates first real feedback

---

### Phase 3 — Activate Distribution Partner (Weeks 8–16)
**Goal:** 30–40 total customers

- Partner has had time to genuinely use the product and believe in it
- Activates his network and creator communities with a referral code
- 30% recurring rev share, simple written agreement, clean attribution
- Target: 20–30 customers through this channel

---

### Phase 4 — Build the Engine (Months 4–6)
**Goal:** 50–75 customers, clear ICP, repeatable acquisition

- Double down on whatever channel is working
- Founder content on Instagram becomes more natural — real results to show
- Identify creator communities, newsletters, podcasts to get into
- Start building benchmarking features as dataset grows

---

### Phase 5 — Scale to 204 (Months 6–12)
**Goal:** $10k MRR

- If distribution partner model is proven, add 1–2 more partners in different niches
- Each with their own referral code and same rev share structure
- Consider raising price to $99/month for new customers as product matures
- Benchmarking and cross-user insights become the key differentiator

---

## Unit Economics at Scale

| Customers | Gross MRR | Stripe fees (~3.5%) | Rev share (30%) | Net MRR |
|---|---|---|---|---|
| 50 | $2,450 | ~$86 | $735 | ~$1,629 |
| 100 | $4,900 | ~$172 | $1,470 | ~$3,258 |
| 150 | $7,350 | ~$257 | $2,205 | ~$4,888 |
| **204** | **$9,996** | **~$350** | **$2,999** | **~$6,647** |

*Infra and API costs are negligible at early scale and can be absorbed for first 10–20 users.*

---

## Key Risks

**Staying in beta too long** — the most common founder trap. Set a hard date to flip to paid and stick to it.

**Meta building native AI analytics** — the real existential threat. Not third-party MCP competitors. Move fast and establish brand before this happens.

**Going too broad too early** — resist the urge to serve everyone. Owning one creator niche deeply is more defensible than being average across many.

**Distribution partner misalignment** — a friend who's excited in the moment can become a liability if the work gets slow. Test the relationship through product use before formalizing equity or rev share.

---

## Open Questions

- Which creator niche to go deep on first for faster benchmark data?
- When to introduce cross-user benchmarking as a product feature?
- At what customer count does it make sense to raise prices to $99/month?
- Long-term: equity partner vs. rev share for distribution — revisit after beta

---

*Built by Travis — travis@travis.day*