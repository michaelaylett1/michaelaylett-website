/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        // The standalone Contact page was removed (it duplicated the
        // Sellers page's contact form). Any old, bookmarked, or
        // previously-indexed link to /contact should land on the
        // Sellers page's form instead of hitting a 404.
        source: "/contact",
        destination: "/sellers#contact-form",
        permanent: true,
      },
      {
        // The Shared Housing Calculator page was renamed to Underwriting
        // and moved to /underwriting. Any old, bookmarked, or
        // previously-indexed link to the old path should land on the new
        // page instead of hitting a 404.
        source: "/shared-housing-calculator",
        destination: "/underwriting",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
