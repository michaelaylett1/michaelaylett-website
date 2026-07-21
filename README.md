# Michael Aylett Website

A seven-page Next.js 14 (App Router) + Tailwind CSS site for Michael
Aylett: professional real estate investor and founder of EcomRanx.

## Pages

- **`/` (Home)**: introduces the paths (sellers, capital partners, RV
  parks, EcomRanx), a credibility strip (91 doors owned, multiple
  markets, long-term owner/operator, conservative underwriting), and a
  featured two-column mission section with a property photo.
- **`/sellers`**: the primary page. Explains the creative financing
  structures Michael purchases through (subject-to, seller financing, and
  subject-to with seller financing), why sellers consider creative
  financing, a dedicated long-term ownership section, the purchase
  process, an FAQ, a final call-to-action banner, and a full seller
  intake form.
- **`/capital-partners`**: investment philosophy, target markets,
  acquisition strategy, underwriting standards, a "Properties We Own and
  Operate" photo section with an investment disclaimer, and how
  partnerships work. Avoids specific return projections, public-offering
  language, and any suggestion that Michael works with only a limited
  number of partners.
- **`/rv-parks`**: a page aimed at RV park owners, brokers, and operators.
  Includes a buy box ($150K+ NOI, 35+ pads, 10% target cap rate), what
  Michael looks for, flexible acquisition structures, and a detailed
  submission form with a file upload for financials and documents.
- **`/ecomranx`**: a visually distinct sub-brand page for the Amazon
  consulting business, linking out to ecomranx.com.
- **`/about`**: background and story, from Amazon account management to
  real estate ownership, with a professional headshot and a property
  photo.
- **`/contact`**: a topic selector (Selling a Property, Capital
  Partnership, or Amazon Consulting) that swaps in the right form. The
  Capital Partnership option shows a full questionnaire, including a
  required Proof of Funds upload; see "File uploads and form services"
  below before launch.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Before you launch

1. **Email**: replace the placeholder email (`michael@ecomranx.com`) in
   `components/sellers/SellerForm.tsx`, `components/contact/ContactSelector.tsx`,
   and `components/rv-parks/RVParkForm.tsx` with your real inbox.
2. **EcomRanx link**: confirm `https://www.ecomranx.com` is correct
   everywhere it's linked (`components/ecomranx/Hero.tsx`, `CTA.tsx`, and
   `components/home/PathCards.tsx`).
3. **LinkedIn**: confirm the URL in `components/shared/Footer.tsx`.
4. **Numbers**: the 91-door / market-count credibility stats live in
   `components/home/Credibility.tsx`. The RV park buy box figures live in
   `components/rv-parks/BuyBox.tsx`. Update either as your numbers change.
5. **EcomRanx case studies**: `components/ecomranx/CaseStudies.tsx` uses
   anonymized, illustrative examples rather than named clients or specific
   figures. Replace with real case studies (with permission) when you have
   them.
6. **Property photos and headshot**: see "Real photography" below before
   adding more images, so new photos stay optimized and get accurate alt
   text.

## Real photography

The Sellers, Capital Partners, About, and Home pages use real, optimized
photos instead of stock imagery. Source files live in
`public/images/properties/` (property photos) and `public/images/profile/`
(headshot). Metadata (path, descriptive alt text, and width/height for
`next/image`) is centralized in `lib/propertyImages.ts`.

Property photos, all resized to the dimensions actually needed and
compressed as WebP (or progressive JPEG for the original batch), each
under 1MB and most well under 300KB:

- `entryway-staircase.jpg`: side image on the Sellers page (Why Sellers
  Consider Creative Financing).
- `hallway-numbered-doors.jpg`: Capital Partners hero image, the Sellers
  page final call-to-action banner, and the Properties We Own and
  Operate grid.
- `aerial-neighborhood-atlanta.jpg`: Sellers hero image, the Capital
  Partners "Target Markets" banner, and the Properties We Own and
  Operate grid. Identified on-site as Atlanta, Georgia.
- `aerial-dallas-texas.webp`: Properties We Own and Operate grid,
  identified on-site as Dallas, Texas, confirmed by the visible skyline
  in the photo.
- `kitchen-renovated.jpg`: side image on the Sellers page (Ways I
  Purchase Properties).
- `kitchen-white-renovated.webp`: small thumbnail on the Sellers Process
  section and the Properties We Own and Operate grid.
- `kitchen-classic-maintained.webp`: image banner on the About page.
- `bathroom-renovated.jpg`: Properties We Own and Operate grid.
- `dining-fireplace-common-area.webp`: the Home mission section
  (91-door section) and the Sellers Long-Term Ownership section, plus
  the wide banner in Properties We Own and Operate.

Headshot:

- `michael-aylett-profile.webp`: primary placement on the About page
  hero (two-column layout, cropped vertically to show face and upper
  torso, framed with a rounded border rather than a circular crop), and
  a small secondary placement beside the Mission label in the About page
  values section.

To add more photos: drop a resized, compressed WebP (or JPEG) into the
relevant `public/images/` subfolder, add an entry with real dimensions
and descriptive alt text to `lib/propertyImages.ts`, then reference it
with `next/image` (`fill` inside a `relative` container with a fixed
aspect ratio, or explicit `width`/`height`) so the layout doesn't shift
while it loads. Non-hero images should use `loading="lazy"`; only the
single image above the fold on a page should use `priority`.

## File uploads and form services

Three forms on this site submit via `mailto:` links, which work without a
backend but cannot carry file attachments:

- Selling a Property and Amazon Consulting (`components/contact/ContactSelector.tsx`)
- Capital Partnership (`components/contact/ContactSelector.tsx`), which
  includes a required Proof of Funds upload
- RV Park submission (`components/rv-parks/RVParkForm.tsx`), which
  includes an optional upload for financials and property documents

**File uploads are not yet wired to a working backend** on either form.
A full developer note is included as a comment at the top of each file.
In short, before launch you should either:

- Connect the relevant upload field to a real form-handling service that
  supports secure file uploads, for example Jotform, Formspree with file
  uploads enabled, Basin, or Uploadcare paired with a serverless
  function, or
- For the Capital Partnership form specifically, keep directing partners
  to the existing secure Jotform at `https://form.jotform.com/252527587810160`,
  which the on-site form already links to as a working fallback for file
  submission. No equivalent fallback link exists yet for the RV Park
  form; connect a real service before relying on that upload field.

Never commit uploaded financial documents, API keys, or real form
submissions to this repository. Do not expose Proof of Funds or RV park
financial documents publicly.

## Content guardrails in place

- No em dash characters anywhere in the project.
- Portfolio references consistently say 91 doors.
- No use of "occasionally" to describe working with capital partners, and
  no language implying Michael works with only a small number of
  partners.
- No use of the word "syndicator." Michael is described as a real estate
  investor, owner and operator, and acquisition and operating partner.
- No claim that Michael purchases property through traditional, cash, or
  conventional purchases. All purchase language on the Sellers and RV
  Parks pages describes creative financing only (subject-to, seller
  financing, and combinations of the two).
- No use of the word "PadSplit" and no bedroom-conversion detail.
- No guaranteed or specific projected returns, and no public-offering
  language.
- No stock photography on the Sellers, Capital Partners, About, or Home
  pages; all use real, optimized photos (see "Real photography" above).
  The RV Parks page intentionally uses no photos, since the photos
  provided are of owned residential properties, not RV parks, and using
  them there would misrepresent the asset type.
- A disclaimer sits beneath the Capital Partners "Properties We Own and
  Operate" grid clarifying the images are for general background only
  and are not an investment offering.

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS: real estate pages use the "ledger" palette (ink, paper,
  brass) defined in `tailwind.config.ts`; the EcomRanx page uses a
  separate graphite/signal-green palette so it reads as its own brand.
- `lucide-react` for icons
- Fonts via `next/font/google`: Fraunces (display), Inter (body/EcomRanx),
  IBM Plex Mono (data/labels)

## Deploying

The project deploys as-is to Vercel. No environment variables are
required for the site to build and run, though you'll want to add one
once you connect a real form-handling service for file uploads (see
above). To push to your existing GitHub repo: unzip this project over (or
into) your repo, commit, and push. Vercel will pick up the changes
automatically on the next deploy.
