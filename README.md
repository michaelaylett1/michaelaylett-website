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

The exact steps, in the Vercel dashboard:

1. Open your project on [vercel.com](https://vercel.com).
2. Go to **Settings > Environment Variables**.
3. Click **Add New**.
   - **Key**: `RESEND_API_KEY`
   - **Value**: the key you copied from Resend in step 1.
   - **Environments**: check **Production**. Also check **Preview** if you
     test forms on preview deployments (e.g. pull request previews), and
     **Development** if you use `vercel dev`.
4. Click **Save**.
5. Repeat for `RESEND_FROM_EMAIL` once your domain is verified (step 2).
   Value example: `Michael Aylett Website <notifications@michaelaylett.com>`.
6. **Redeploy.** Environment variable changes do not apply to deployments
   that already exist; you must trigger a new deployment (Deployments tab
   > ... menu on the latest deployment > Redeploy, or push a new commit)
   after adding or changing a variable. This is the single most common
   reason a variable "is set" in the dashboard but the live site still
   fails as if it were missing.

For local development, copy `.env.example` to `.env.local` and fill in
the same values; `.env.local` is already gitignored and never committed.

### 4. Environment variables needed for file storage

The Capital Partner (required) and RV Park (optional) forms upload files.
They're stored in a **private** Vercel Blob store, never in this
repository or the public `public/` directory, so uploaded financial
documents can't end up on GitHub or be served as static site assets.

**This store must be connected to this exact project.** A Blob store
created in a different Vercel project, or never connected to any
project, will not work here, even if it exists in the same Vercel team.

1. In the Vercel project, go to **Storage** tab > **Create Database** >
   **Blob**.
2. Click **Continue**, then set access to **Private** (not Public; see
   "Important security requirement" below for why this matters).
3. Name the store and select **Create**.
4. On the store's page, go to the **Projects** tab and select **Connect
   to Project**. Choose this project and the environments you need
   (Production, and Preview/Development if you test there too).
5. Connecting the store adds environment variables to this project
   automatically: `BLOB_READ_WRITE_TOKEN` (a static token, used as a
   fallback) and, when connected this way, `BLOB_STORE_ID` plus
   `VERCEL_OIDC_TOKEN` (Vercel's preferred, auto-rotating credential,
   populated automatically on every deployment). You do not need to copy
   any token by hand for production.
6. **Redeploy** after connecting the store, for the same reason as step
   3 above: the credentials are injected into new deployments, not
   retroactively into ones that are already running.
7. For local development, run `vercel env pull .env.local` after
   connecting the store so `BLOB_READ_WRITE_TOKEN` (and related
   variables) are available locally too.

Because the store is private, uploaded files are never reachable by a
guessable public URL, and the code never falls back to a public store.
The notification email instead includes a signed, time-limited link
(valid 7 days, the maximum Vercel allows) generated with Vercel's
signed-URL API (`issueSignedToken` + `presignUrl` from `@vercel/blob`,
in `lib/forms/storage.ts`). Only someone with that exact link, within the
validity window, can open the file. Each file is capped at 8MB and a
submission may include up to 5 files; adjust `MAX_FILE_SIZE_BYTES` and
`MAX_FILES_PER_SUBMISSION` in `lib/forms/storage.ts` if you need
different limits (Vercel Functions have their own request size limits
too, so very large files may need a different upload strategy).

File type is checked twice: by extension (`.pdf`, `.jpg`, `.jpeg`,
`.png`, `.xlsx`, `.xls`, `.csv`, `.doc`, `.docx`) and, when the browser
provides one, by MIME type, so a file renamed to spoof its extension is
rejected. Filenames are sanitized before storage (anything other than
letters, numbers, `.`, `_`, and `-` becomes `_`), so spaces and
punctuation in the original filename are handled safely and can't affect
the storage path.

### 5. How to inspect Vercel Function logs

When a form fails in production, the visitor sees a generic message on
purpose (so technical details aren't exposed to strangers on the
internet), but the real cause is always logged server-side, tagged so
it's easy to find:

1. Open the project on [vercel.com](https://vercel.com).
2. Go to the **Deployments** tab and open the deployment that's
   currently live (or **Logs**/**Runtime Logs**, if your project has a
   dedicated tab for it).
3. Filter or search for `[forms:` — every diagnostic message this
   project logs is prefixed `[forms:email]`, `[forms:blob]`,
   `[forms:seller]`, `[forms:contact]`, `[forms:capital-partner]`, or
   `[forms:rv-park]`.
4. Reproduce the failing submission, then refresh the logs. You can also
   use the Vercel CLI: `vercel logs <deployment-url>` (or `vercel logs
   --follow` while you submit a test form) streams the same logs to your
   terminal.

None of these logs include the Resend API key, the Blob token, uploaded
file contents, or full submitted field values (name/email/phone and
message text are not logged; only operational details like file size,
file extension, error type, and Resend's own error message/name).

### 6. Diagnosing common production errors

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| Seller/Contact/Capital Partner/RV Park form: "Something went wrong while sending your submission" | `RESEND_API_KEY` missing or invalid in this environment, sending domain not verified, or `RESEND_FROM_EMAIL` not on a verified domain | Vercel log line starting `[forms:email]`. A missing key logs `RESEND_API_KEY is not set in this environment`. A Resend-side rejection (bad key, unverified domain, invalid from address) logs `Resend API error (<name>): <message>` with the exact reason from Resend. |
| Capital Partner/RV Park form: "Failed to securely store [filename]" | No private Blob store connected to this project/environment, connected but not redeployed since, or the store was created as Public instead of Private | Vercel log line starting `[forms:blob] upload failed`, which names the specific error (for example `BlobStoreNotFoundError` or `BlobAccessError`) and a one-line hint on what to check |
| "[filename] was uploaded but a secure link could not be generated" | The file itself stored successfully, but generating the signed link failed (transient Vercel Blob issue, or a store/credential problem that only affects signing) | `[forms:blob] sign-token failed` in the logs |
| Form works locally but not in production | Environment variables set locally (`.env.local`) but not added in Vercel, or added but not redeployed | Compare `.env.local` against Vercel's Environment Variables list; redeploy after adding anything |
| No `[forms:...]` log lines appear at all for a failed submission | The request may not be reaching the function (check the Network tab in your browser for the actual HTTP status of the `/api/forms/...` request), or you're looking at logs for the wrong deployment | Confirm the deployment URL you're testing matches the one whose logs you're viewing |

### 7. How to test each form

**Locally first:**

```bash
npm install
npm run dev
```

With `RESEND_API_KEY` (and, for file uploads, a connected Blob store's
credentials) in `.env.local`, exercise each form at
`http://localhost:3000` as described below.

**Then in production**, after completing the manual setup in this
section and confirming you redeployed:

- **Seller**: visit `/sellers`, fill in the intake form at the bottom
  (no file involved), and submit. Confirm the page shows a success
  message without navigating away, and that michael@michaelaylett.com
  receives a "New Seller Property Inquiry" email with every field you
  entered.
- **General contact**: visit `/contact`, stay on the default "Selling a
  Property" tab, fill it in, and submit. Confirm success on-page and a
  "New Website Contact" email.
- **Capital partner**: visit `/contact`, switch to "Capital
  Partnership", fill in the required fields, check the acknowledgment
  box, and submit three times, once each with a small PNG, a JPG, and a
  PDF attached. Confirm success on-page each time and a "New Capital
  Partner Submission" email each time, with a working, clickable secure
  link to the uploaded file (opening it should show the document; it
  should not be a plain public Blob URL).
- **RV park**: visit `/rv-parks`, fill in the submission form and attach
  a document (any allowed type), and submit. Confirm success on-page and
  a "New RV Park Opportunity" email with a working secure file link.

For every form, also confirm: leaving a required field blank shows an
inline validation message instead of submitting; the submit button
disables and shows a "Sending..."/"Submitting..." state while the
request is in flight; the page never navigates away or refreshes; and no
form on the site (other than the Amazon Consulting tab, which is
intentionally out of scope) opens your email client.

Never commit uploaded financial documents, API keys, or `.env.local` to
this repository.

### Important security requirement, reconfirmed

Proof of Funds and other financial documents are only ever written to a
**private** Vercel Blob store (`access: "private"` in
`lib/forms/storage.ts`) and are never placed in `public/` or committed
to the repository. Access requires a signed link with an expiry, not a
guessable or permanently public URL. If you inspect a store in the
Vercel dashboard and its access shows as **Public**, delete it and
recreate it as **Private**, then reconnect and redeploy; a public store
is not compatible with this code (`put()` calls request
`access: "private"` explicitly, so uploads will fail against a
public-only store rather than silently becoming public).

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

## Production failure fix: what changed and what's still manual

This section documents the round of fixes made after the forms were
reported failing in production ("Something went wrong while sending your
submission" on the Seller form, "Failed to securely store [filename]" on
the Capital Partner form). I don't have access to this project's live
Vercel deployment, account, or logs, so I could not read the actual
runtime error directly; the fixes below come from a careful audit of the
API routes, `lib/forms/`, and the current `@vercel/blob` and Resend SDKs,
targeted at exactly the two symptoms reported, plus the debugging tools
needed to pin down the real cause from your own Vercel logs.

### A. Code changes completed

- **Fixed a real bug**: `lib/forms/storage.ts` caught every file-upload
  error (auth, missing store, size limits, network) and silently
  discarded the real error before showing a generic message. Nothing was
  logged, so the Vercel Function logs would have shown nothing useful for
  the Capital Partner failure. This is fixed: the real error is now
  logged server-side (`[forms:blob]`, using `@vercel/blob`'s specific
  error classes like `BlobStoreNotFoundError` and `BlobAccessError` to
  say exactly what's wrong), while the visitor still only sees a safe,
  generic message.
- Added the same style of logging to `lib/forms/email.ts`
  (`[forms:email]`): a missing `RESEND_API_KEY` is logged explicitly, and
  a rejected send now logs Resend's own error name and message (for
  example, an unverified domain or invalid API key) instead of only
  surfacing a wrapped generic error.
- Added a shared `jsonServerError()` helper (`lib/forms/response.ts`) so
  every route's catch-all block logs consistently, tagged by form
  (`[forms:seller]`, `[forms:contact]`, `[forms:capital-partner]`,
  `[forms:rv-park]`), searchable in Vercel's Runtime Logs.
- Added MIME-type validation in `lib/forms/storage.ts` on top of the
  existing extension check, so a file with a spoofed extension is
  rejected rather than silently accepted.
- Added `maxDuration = 30` to the Capital Partner and RV Park routes,
  since file upload + signed-link generation + email together can take
  longer than the platform's 10-second default on some plans.
- Confirmed (no change needed): all four routes already declared
  `export const runtime = "nodejs"`; `RESEND_API_KEY` is read server-side
  only, inside a route handler, and is never sent to the browser;
  notifications are always sent `to: michael@michaelaylett.com` from a
  hardcoded constant; the `from` address is read from
  `RESEND_FROM_EMAIL` server-side; uploads use `access: "private"`
  exclusively; filenames are sanitized; and no logging statement anywhere
  in `lib/forms/` includes the Resend API key, the Blob token, uploaded
  file contents, or full submitted field values.
- Verified: `npm run build` succeeds, `tsc --noEmit` is clean, and every
  route handler's actual logic (validation, honeypot, rate limiting, the
  new error paths) was exercised directly with a standalone test harness
  hitting the real `POST` functions with constructed requests. I could
  not exercise a real, successful send or upload from this environment,
  since I have no network access to Resend's or Vercel's APIs and no
  credentials for your accounts.

### B. Manual setup you still need to complete

I cannot see your Vercel project, so I can't confirm which of these is
actually the cause, only that the symptoms you described are consistent
with one or more of them. Please check, in order:

1. **Resend**: an API key exists and is valid, and it's the one entered
   as `RESEND_API_KEY` in Vercel (see "3. Create the RESEND_API_KEY
   environment variable in Vercel" above).
2. **Resend sending domain**: verified in the Resend dashboard, and
   `RESEND_FROM_EMAIL` in Vercel is set to an address on that domain
   (see "2. Verify the sending domain" above). Until this is done, email
   sent from the sandbox address can fail to reach
   michael@michaelaylett.com.
3. **Vercel environment variables redeployed**: `RESEND_API_KEY` and
   `RESEND_FROM_EMAIL` must be added for the **Production** environment
   specifically (not just Preview/Development), and the project must be
   **redeployed** after adding them.
4. **Vercel Blob store**: a store exists, its access is set to
   **Private**, and it is connected to this exact project under
   **Storage > your store > Projects > Connect to Project** (see "4.
   Environment variables needed for file storage" above). Then
   **redeploy**.
5. Once the above are in place, follow "5. How to inspect Vercel
   Function logs" and "6. Diagnosing common production errors" above to
   confirm from the actual `[forms:email]` / `[forms:blob]` log lines
   which specific step is still misconfigured, if any.

I have not stated that the forms are fully working end to end in
production, because I cannot verify that from here. What I can confirm:
the code builds successfully, type-checks cleanly, and each route's
logic behaves correctly when called directly with realistic requests.
Whether email actually delivers and files actually upload in your
specific Vercel + Resend accounts depends on the manual setup above,
which only you can complete and verify.
