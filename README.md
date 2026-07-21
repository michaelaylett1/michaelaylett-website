# Michael Aylett Website

A six-page Next.js 14 (App Router) + Tailwind CSS site for Michael Aylett:
professional real estate investor and founder of EcomRanx.

## Pages

- **`/` (Home)**: introduces the three paths (sellers, capital partners,
  EcomRanx) and a credibility strip (91 doors owned, multiple markets,
  long-term owner/operator, conservative underwriting).
- **`/sellers`**: the primary page. Explains the creative financing
  structures Michael purchases through (subject-to, seller financing, and
  subject-to with seller financing), why sellers consider creative
  financing, the purchase process, an FAQ, and a full seller intake form.
- **`/capital-partners`**: investment philosophy, target markets,
  acquisition strategy, underwriting standards, and how partnerships work.
  Avoids specific return projections, public-offering language, and any
  suggestion that Michael works with only a limited number of partners.
- **`/ecomranx`**: a visually distinct sub-brand page for the Amazon
  consulting business, linking out to ecomranx.com.
- **`/about`**: background and story, from Amazon account management to
  real estate ownership.
- **`/contact`**: a topic selector (Selling a Property, Capital
  Partnership, or Amazon Consulting) that swaps in the right form. The
  Capital Partnership option shows a full questionnaire, including a
  required Proof of Funds upload; see "Capital Partner Form and File
  Uploads" below before launch.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Before you launch

1. **Email**: replace the placeholder email (`michael@ecomranx.com`) in
   `components/sellers/SellerForm.tsx` and
   `components/contact/ContactSelector.tsx` with your real inbox.
2. **EcomRanx link**: confirm `https://www.ecomranx.com` is correct
   everywhere it's linked (`components/ecomranx/Hero.tsx`, `CTA.tsx`, and
   `components/home/PathCards.tsx`).
3. **LinkedIn**: confirm the URL in `components/shared/Footer.tsx`.
4. **Numbers**: the 91-door / market-count credibility stats live in
   `components/home/Credibility.tsx`. Update as your portfolio changes.
5. **EcomRanx case studies**: `components/ecomranx/CaseStudies.tsx` uses
   anonymized, illustrative examples rather than named clients or specific
   figures. Replace with real case studies (with permission) when you have
   them.
6. **Property photos**: see "Real property photography" below before
   adding more images, so new photos stay optimized and get accurate alt
   text.

## Real property photography

The Sellers and Capital Partners pages use real, optimized photos from the
portfolio instead of stock imagery. Source files live in
`public/images/properties/` and are pre-resized (longest side capped
around 2000 to 2600px) and compressed as progressive JPEGs, each well
under 600KB. Metadata (path, descriptive alt text, and width/height for
`next/image`) is centralized in `lib/propertyImages.ts`.

Where each photo is used:

- `entryway-staircase.jpg`: side image on the Sellers page (Why Sellers
  Consider Creative Financing) and in the Capital Partners Featured
  Properties grid.
- `hallway-numbered-doors.jpg`: Capital Partners hero image, the "Real
  Managed Property" banner on the Sellers page, and the Featured
  Properties grid.
- `aerial-neighborhood-atlanta.jpg`: Sellers hero image and the "Target
  Markets" banner on the Capital Partners page.
- `kitchen-renovated.jpg`: side image on the Sellers page (Ways I
  Purchase Properties) and in the Featured Properties grid.
- `bathroom-renovated.jpg`: Featured Properties grid on the Capital
  Partners page.

To add more photos: drop a resized, compressed JPEG into
`public/images/properties/`, add an entry with real dimensions and
descriptive alt text to `lib/propertyImages.ts`, then reference it with
`next/image` (`fill` inside a `relative` container with a fixed aspect
ratio, or explicit `width`/`height`) so the layout doesn't shift while it
loads. Non-hero images should use `loading="lazy"`; only the single image
above the fold on a page should use `priority`.

## Capital partner form and file uploads

The "Selling a Property" and "Amazon Consulting" contact forms submit via
a `mailto:` link, which works without a backend but cannot carry file
attachments.

The "Capital Partnership" form (`components/contact/ContactSelector.tsx`)
includes a required Proof of Funds upload. Browsers cannot attach files to
a `mailto:` link, so **file uploads are not yet wired to a working
backend**. A full developer note is included as a comment at the top of
`components/contact/ContactSelector.tsx`. In short, before launch you
should either:

- Connect the form (and especially the Proof of Funds field) to a real
  form-handling service that supports secure file uploads, for example
  Jotform, Formspree with file uploads enabled, Basin, or Uploadcare paired
  with a serverless function, or
- Keep directing capital partners to the existing secure Jotform at
  `https://form.jotform.com/252527587810160`, which the on-site form
  already links to as a working fallback for file submission.

Never commit uploaded financial documents, API keys, or real form
submissions to this repository. Do not expose Proof of Funds documents
publicly.

## Content guardrails in place

- No em dash characters anywhere in the project.
- Portfolio references consistently say 91 doors.
- No use of "occasionally" to describe working with capital partners, and
  no language implying Michael works with only a small number of
  partners.
- No use of the word "syndicator." Michael is described as a real estate
  investor, owner and operator, and acquisition and operating partner.
- No claim that Michael purchases property through traditional, cash, or
  conventional purchases. All purchase language on the Sellers page
  describes creative financing only (subject-to, seller financing, and
  subject-to with seller financing).
- No use of the word "PadSplit" and no bedroom-conversion detail.
- No guaranteed or specific projected returns, and no public-offering
  language.
- No stock photography on the Sellers or Capital Partners pages; both use
  real, optimized photos of owned and operated properties (see "Real
  property photography" above).

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS: real estate pages use the "ledger" palette (ink, paper,
  brass) defined in `tailwind.config.ts`; the EcomRanx page uses a
  separate graphite/signal-green palette so it reads as its own brand.
- `lucide-react` for icons
- Fonts via `next/font/google`: Fraunces (display), Inter (body/EcomRanx),
  IBM Plex Mono (data/labels)

## Deploying

The project deploys as-is to Vercel. No environment variables are required
for the site to build and run, though you'll want to add one once you
connect a real form-handling service for the Proof of Funds upload (see
above). To push to your existing GitHub repo: unzip this project over (or
into) your repo, commit, and push. Vercel will pick up the changes
automatically on the next deploy.
