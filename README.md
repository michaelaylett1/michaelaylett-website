# Michael Aylett — Personal Website

A Next.js 14 (App Router) + Tailwind CSS site for Michael Aylett: co-living
real estate investor and founder of EcomRanx.

## Sections

- **Hero** — headline, positioning, and top-line portfolio stats
- **About Me** — background, credibility, service history
- **Current Portfolio** — 83-door portfolio snapshot + featured property case study
- **Investment Strategy** — the PadSplit/co-living model, stabilization timeline, risk mitigation
- **Capital Raising** — deal terms for capital partners
- **Amazon Consulting (EcomRanx)** — Amazon growth consulting offer
- **Contact** — investor application, LinkedIn, email, contact form

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Before you launch

1. **Email** — replace the placeholder email in `components/Contact.tsx`
   (`const EMAIL = "michael@ecomranx.com"`) with your real inbox.
2. **Investor form link** — `INVESTOR_FORM` in `components/Contact.tsx` points
   to the Jotform mentioned in your deck; swap it for whichever form you want
   live.
3. **LinkedIn** — confirm the `LINKEDIN` URL in the same file.
4. **Portfolio numbers** — `components/Hero.tsx` and `components/Portfolio.tsx`
   hold the headline stats (doors, monthly revenue, COC return). Update as
   your numbers change.
5. **Photos** — the design currently ships photo-free and relies on
   typography/data. If you want to add property or headshot photography,
   drop images into `public/` and swap them into `Hero.tsx` / `Portfolio.tsx`.

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS (custom design tokens in `tailwind.config.ts`)
- `lucide-react` for icons
- Fonts via `next/font/google`: Fraunces (display), Inter (body), IBM Plex Mono (data/labels)

## Design notes

The visual language is built around the idea of a deal ledger / underwriting
sheet: alternating dark ink and warm paper sections, a brass accent used for
key figures, and a mix of serif display type with a monospace face for
numbers and labels. The stabilization timeline in the Strategy section is
a direct visualization of the rehab → stabilizing → payouts phases described
in your investor deck.

## Deploying

The project deploys as-is to Vercel, Netlify, or any Node host that supports
Next.js. No environment variables are required.
