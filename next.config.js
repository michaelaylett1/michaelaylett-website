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
    ];
  },
};

module.exports = nextConfig;
