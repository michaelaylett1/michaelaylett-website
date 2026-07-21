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
  required Proof of Funds upload. Selling a Property and Capital
  Partnership submit for real (see "Email notifications and file uploads"
  below); Amazon Consulting is a separate, non-real-estate business and
  intentionally still uses a `mailto:` link.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Before you launch

1. **Environment variables**: the four real estate forms (Seller,
   Capital Partner, RV Park, and the general Contact page) need
   `RESEND_API_KEY` set before they can send email, and the Capital
   Partner and RV Park forms need a private Blob store connected before
   file uploads work. See "Email notifications and file uploads" below.
   The Amazon Consulting tab on `/contact` still uses a plain `mailto:`
   link to `michael@ecomranx.com`, since it belongs to the separate
   EcomRanx business rather than the real estate lead pipeline; update
   that address in `components/contact/ContactSelector.tsx` if needed.
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

## Email notifications and file uploads

Four real estate forms submit directly to this site's own API routes,
which validate the submission server-side, upload any attached files to
private storage, and send a notification email via
[Resend](https://resend.com) to **michael@michaelaylett.com**:

| Form | Page | Route | Email subject |
| --- | --- | --- | --- |
| Seller Property Inquiry | `/sellers` | `app/api/forms/seller/route.ts` | New Seller Property Inquiry |
| General Contact (Selling a Property tab) | `/contact` | `app/api/forms/contact/route.ts` | New Website Contact |
| Capital Partner | `/contact` (Capital Partnership tab) | `app/api/forms/capital-partner/route.ts` | New Capital Partner Submission |
| RV Park Submission | `/rv-parks` | `app/api/forms/rv-park/route.ts` | New RV Park Opportunity |

The Amazon Consulting tab on `/contact` is intentionally excluded: it
belongs to the separate EcomRanx business, not real estate, and still
uses a simple `mailto:` link. No EcomRanx-specific contact form or
backend was added.

Shared logic lives in `lib/forms/`:

- `validate.ts`: trims/length-caps every field, escapes HTML before it
  goes into the email body, and validates name/email/phone.
- `spam.ts` + `guard.ts`: a hidden honeypot field, a minimum-time check
  (rejects submissions completed in under 1.5 seconds), and a best-effort
  per-instance rate limit (5 submissions/minute per IP).
- `email.ts`: builds and sends the notification email with Resend.
- `storage.ts`: uploads files to a private Vercel Blob store and creates
  time-limited signed links for the email (see below).

### 1. Create a Resend account

1. Sign up at [resend.com](https://resend.com).
2. In the dashboard, go to **API Keys** and create a new key.
3. Copy it; you'll need it for `RESEND_API_KEY` below.

### 2. Verify the sending domain

Resend's shared sandbox sender (`onboarding@resend.dev`) only delivers to
the email address on your own Resend account, which is fine for an
initial smoke test but not for real visitor submissions. Before relying
on this in production:

1. In the Resend dashboard, go to **Domains** and add `michaelaylett.com`
   (or a subdomain you're comfortable sending from, e.g. `mail.michaelaylett.com`).
2. Add the DNS records Resend shows you (SPF, DKIM, and DMARC) at your
   domain registrar or DNS host.
3. Wait for Resend to show the domain as **Verified** (usually minutes to
   a few hours, depending on DNS propagation).
4. Set `RESEND_FROM_EMAIL` (see below) to an address on that domain, for
   example `Michael Aylett Website <notifications@michaelaylett.com>`.

**Sender address currently used by this project**: `RESEND_FROM_EMAIL` if
set, otherwise the Resend sandbox address
`Michael Aylett Website <onboarding@resend.dev>` (see
`lib/forms/email.ts`). All notification emails always go **to**
`michael@michaelaylett.com`, which is hardcoded as a constant rather than
an environment variable so it can't be silently redirected by a
misconfigured setting.

### 3. Create the RESEND_API_KEY environment variable in Vercel

1. Open your project on [vercel.com](https://vercel.com).
2. Go to **Settings > Environment Variables**.
3. Add `RESEND_API_KEY` with the value from step 1, for the
   **Production** (and, if you want to test on preview deployments,
   **Preview**) environment.
4. Optionally add `RESEND_FROM_EMAIL` the same way once your domain is
   verified.
5. Redeploy so the new variables take effect.

For local development, copy `.env.example` to `.env.local` and fill in
the same values; `.env.local` is already gitignored and never committed.

### 4. Environment variables needed for file storage

The Capital Partner (required) and RV Park (optional) forms upload files.
They're stored in a **private** Vercel Blob store, never in this
repository or the public `public/` directory, so uploaded financial
documents can't end up on GitHub or be served as static site assets:

1. In the Vercel project, go to **Storage > Create Database > Blob**.
2. Set access to **Private** when creating the store.
3. Connect the store to this project (Vercel then provides the
   credentials the `@vercel/blob` SDK needs automatically in
   production, no manual token copy required).
4. For local development, run `vercel env pull .env.local` after
   connecting the store so the required token is available locally too.

Because the store is private, uploaded files are never reachable by a
guessable public URL. The notification email instead includes a signed,
time-limited link (valid 7 days, the maximum Vercel allows) generated
with Vercel's signed-URL API. Only someone with that exact link, within
the validity window, can open the file. Each file is capped at 8MB and a
submission may include up to 5 files; adjust `MAX_FILE_SIZE_BYTES` and
`MAX_FILES_PER_SUBMISSION` in `lib/forms/storage.ts` if you need
different limits (Vercel serverless functions have their own request
size limits too, so very large files may need a different upload
strategy).

### 5. How to test each form

With `RESEND_API_KEY` (and, for file uploads, a connected Blob store) set
in `.env.local`:

```bash
npm install
npm run dev
```

Then, with the dev server running at `http://localhost:3000`:

- **Seller**: visit `/sellers`, fill in the intake form at the bottom,
  and submit. Check michael@michaelaylett.com for a "New Seller Property
  Inquiry" email.
- **General contact**: visit `/contact`, stay on the default "Selling a
  Property" tab, fill it in, and submit. Check for "New Website Contact".
- **Capital partner**: visit `/contact`, switch to "Capital Partnership",
  fill in the required fields, attach at least one file, check the
  acknowledgment box, and submit. Check for "New Capital Partner
  Submission" with a working file link.
- **RV park**: visit `/rv-parks`, fill in the submission form (a file
  upload is optional here), and submit. Check for "New RV Park
  Opportunity".

For each form, also verify: leaving a required field blank shows an
inline validation message instead of submitting; the submit button
disables and shows a "Sending..."/"Submitting..." state while the request
is in flight; a success message appears after a real submission without
the page navigating or refreshing; and temporarily using an invalid
`RESEND_API_KEY` produces a visible error message instead of a silent
failure.

Never commit uploaded financial documents, API keys, or `.env.local` to
this repository.

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
- `resend` for transactional email notifications
- `@vercel/blob` for private, time-limited-link file storage

## Deploying

The project deploys to Vercel. Before (or right after) your first
production deploy, set the environment variables described in "Email
notifications and file uploads" above:

- `RESEND_API_KEY` (required for any form to send email)
- `RESEND_FROM_EMAIL` (optional until your sending domain is verified)
- A private Vercel Blob store connected to the project (required for the
  Capital Partner and RV Park file uploads)

To push to your existing GitHub repo: unzip this project over (or into)
your repo, commit, and push. Vercel will pick up the changes
automatically on the next deploy. `.env.local` and any real API keys are
gitignored and should never be committed; set them as Vercel Environment
Variables instead.

### A note on Next.js version

This project pins `next@14.2.35`, the latest 14.x patch release, to pick
up published security fixes while staying on the same major version as
the rest of the app (no breaking API changes). A newer major version
(Next.js 16) is available upstream with additional fixes; consider
evaluating an upgrade separately, as it is a larger change outside the
scope of this update.
