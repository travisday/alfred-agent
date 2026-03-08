# Social Brain

Conversational analytics for Instagram creators. Connect your account, query your Reels through natural language in Claude or ChatGPT, and get instant insights from your content data.

## What Is It?

Social Brain is a tool that turns your Instagram Reels history into a queryable dataset. Instead of digging through Instagram's native analytics, you ask:

- *"What are my top performing reels by saves?"*
- *"Find all my content about morning routines"*
- *"Which hook styles perform best for me?"*

The system processes your Reels transcripts, hooks, topics, and performance metrics — then lets you explore that data through an MCP server integrated with Claude or ChatGPT.

## The Problem

Personal brand creators post constantly but fly blind. Instagram's native analytics are shallow, siloed, and require manual effort to extract insight. Most creators guess instead of knowing what actually works and why.

Social Brain fills that gap by building a personal content intelligence layer that gets more valuable over time.

## Who It's For

**Primary:** Personal brand creators and influencers building an audience on Instagram who:
- Own their Instagram Business/Creator accounts
- Post consistently (enough to generate meaningful data)
- Care deeply about growth metrics and content optimization

**Not (yet):** UGC creators who submit through platforms like Tribe (they don't own the accounts)

## Product Details

### How It Works

1. **Connect** — User authenticates via Facebook OAuth using their Instagram Business/Creator account
2. **Sync** — Social Brain pulls Reels and extracts transcripts, hooks, topics, and metrics
3. **Query** — User adds the MCP server to Claude or ChatGPT and chats with their data in natural language

### Core Features

**MCP Tools:**
- `list_reels` — List reels with sorting and filtering by date, views, engagement, saves, video type
- `search_reels` — Search across transcripts, hooks, and topics by keyword

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React at app.socialbrain.io |
| Auth | Clerk + Facebook OAuth |
| Database | Supabase (transcripts, hooks, topics, metrics) |
| Payments | Stripe (via Clerk integration) |
| Hosting | Railway |
| MCP Server | mcp.socialbrain.io |

### Security

- **Read-only access** — Cannot post, edit, or delete content
- **User-scoped data** — Users only access their own data
- **Token-based auth** — 5-day expiration for safety

## Business Model

| Metric | Value |
|--------|-------|
| Price | $49/month |
| Trial | Free closed beta → paid with trial period |
| Revenue Share | 30% recurring to distribution partner |
| Net per Customer | ~$32.58/month (after Stripe + rev share) |

## Competitive Advantage (The Moat)

**Today:** Head start, not a moat — MCP server and reel processing are replicable.

**Building toward:**

1. **Data network effects** — As users grow, aggregate benchmarks become possible ("Your hook is 40% below your niche average"). No competitor can offer this without the dataset.

2. **Brand + Distribution** — Being the go-to tool for a specific creator niche is a real moat. First-mover advantage compounds.

3. **Switching costs** — Each month builds historical data. Months of indexed content and pattern recognition make leaving painful.

**The strategy:** Get users in fast, own one creator niche, build benchmarking before competitors do.

## Go-To-Market

### Distribution Strategy

1. **Primary:** Distribution partner on 30% recurring rev share
   - Partner is a personal brand creator (ideal customer)
   - Uses the product authentically
   - Drives referrals through his network and creator communities

2. **Secondary:** Founder's own Instagram (process content, not ads)
   - Document the build
   - Show Social Brain in use
   - Build authenticity and credibility

3. **Future:** Additional partners in specific niches (finance, fitness, real estate)

### Customer Profile

Personal brand creators and entrepreneurs building audiences on Instagram. Coaches, educators, thought leaders, entrepreneurs who post consistently and care about growth.

## Roadmap to $10,000/month Gross

Target: 204 paying customers at $49/month = $9,996 MRR

### Phase 1: Validate (Now → Week 4)
- Onboard 2-3 hand-picked closed beta users
- Treat like real users with minimal hand-holding
- Watch where they drop off
- Get crisp on: *Why should someone pay for this in one sentence?*

### Phase 2: First Revenue (Weeks 4–8)
- Flip to paid with free trial
- Direct outreach to warm contacts (newsletter, network)
- Target: 10 paying customers
- Proves model, funds itself, generates real feedback

### Phase 3: Activate Distribution Partner (Weeks 8–16)
- Partner has used the product deeply
- Activates his network with referral code
- 30% recurring rev share
- Target: 30–40 total customers

### Phase 4: Build the Engine (Months 4–6)
- Double down on working channels
- Founder content on Instagram becomes natural
- Benchmarking features launch as dataset grows
- Target: 50–75 customers

### Phase 5: Scale (Months 6–12)
- Add 1–2 more distribution partners in different niches
- Consider raising price to $99/month for new customers
- Benchmarking becomes key differentiator
- Target: 204 customers = $10k MRR

## Unit Economics at Scale

| Customers | Gross MRR | Stripe fees | Rev share | Net MRR |
|-----------|-----------|-------------|-----------|---------|
| 50 | $2,450 | ~$86 | $735 | ~$1,629 |
| 100 | $4,900 | ~$172 | $1,470 | ~$3,258 |
| 150 | $7,350 | ~$257 | $2,205 | ~$4,888 |
| **204** | **$9,996** | **~$350** | **$2,999** | **~$6,647** |

*Infra and API costs negligible at early scale, absorbable for first 10–20 users.*

## Key Risks

| Risk | Mitigation |
|------|-----------|
| Staying in beta too long | Set a hard date to flip to paid and stick to it |
| Meta building native AI analytics | Move fast, establish brand before it happens |
| Going too broad too early | Own one creator niche deeply, not average across many |
| Distribution partner misalignment | Test relationship through product use before formalizing |

## Open Questions

- Which creator niche to prioritize first for faster benchmark data?
- When to introduce cross-user benchmarking as a feature?
- At what customer count to raise price to $99/month?
- Long-term: equity partnership vs. rev share? (Revisit after beta)

## Key Documents

- **[social-brain.md](./social-brain.md)** — Full strategy document
- **[closed-beta.md](./closed-beta.md)** — Beta user tracking

## Status

In closed beta. Preparing for Phase 1 validation with hand-picked users before moving to paid tier and broader distribution.
