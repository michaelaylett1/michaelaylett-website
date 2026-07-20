# Michael Aylett — Website

A six-page Next.js 14 (App Router) + Tailwind CSS site for Michael Aylett:
professional real estate investor and founder of EcomRanx.

## Pages

- **`/` — Home** — introduces the three paths (sellers, capital partners,
  EcomRanx) and a credibility strip.
- **`/sellers`** — the primary page. Explains traditional purchases, seller
  financing, and subject-to; why sellers consider creative financing; the
  purchase process; FAQ; and a full seller intake form.
- **`/capital-partners`** — investment philosophy, target markets,
  acquisition strategy, underwriting standards, and how partnerships work.
  Deliberately avoids specific return projections or public-offering
  language.
- **`/ecomranx`** — a visually distinct sub-brand page for the Amazon
  consulting business, linking out to ecomranx.com.
- **`/about`** — background and story, from Amazon account management to
  real estate ownership.
- **`/contact`** — a topic selector (Selling a Property / Capital
  Partnership / Amazon Consulting) that swaps in the right form.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Before you launch

1. **Email** — replace the placeholder email (`michael@ecomranx.com`) in
   `components/sellers/SellerForm.tsx` and `components/contact/ContactSelector.tsx`
   with your real inbox. Forms currently submit via `mailto:` links since
   there's no backend; swap in a form service (Formspree, a serverless
   function, etc.) if you want submissions to land somewhere other than an
   email client.
2. **EcomRanx link** — confirm `https://www.ecomranx.com` is correct
   everywhere it's linked (`components/ecomranx/Hero.tsx`, `CTA.tsx`, and
   `components/home/PathCards.tsx`).
3. **LinkedIn** — confirm the URL in `components/shared/Footer.tsx`.
4. **Numbers** — the 81-room / market-count credibility stats live in
   `components/home/Credibility.tsx`. Update as your portfolio changes.
5. **EcomRanx case studies** — `components/ecomranx/CaseStudies.tsx` uses
   anonymized, illustrative examples rather than named clients or specific
   figures. Replace with real case studies (with permission) when you have
   them.

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS — real estate pages use the "ledger" palette (ink, paper,
  brass) defined in `tailwind.config.ts`; the EcomRanx page uses a separate
  graphite/signal-green palette so it reads as its own brand.
- `lucide-react` for icons
- Fonts via `next/font/google`: Fraunces (display), Inter (body/EcomRanx),
  IBM Plex Mono (data/labels)

## Content guardrails already in place

- No use of the word "PadSplit" anywhere on the site.
- No discussion of bedroom-conversion strategy.
- No specific projected returns or public-offering language on the Capital
  Partners page.
- Seller-facing copy avoids overpromising ("not every property qualifies").

## Deploying

The project deploys as-is to Vercel. No environment variables are required.
To push to your existing GitHub repo: unzip this project over (or into) your
repo, commit, and push — Vercel will pick up the new pages automatically on
the next deploy.
