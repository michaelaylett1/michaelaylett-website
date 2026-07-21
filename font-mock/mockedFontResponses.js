// Local-build-only mock so `next build` doesn't need to reach
// fonts.googleapis.com from this sandbox. Not part of the shipped project.
function face(family, weight, style, unicodeRange) {
  return `
    @font-face {
      font-family: '${family}';
      font-style: ${style};
      font-weight: ${weight};
      font-display: swap;
      src: url(https://fonts.gstatic.com/mock/${family.replace(/\s+/g, "")}-${weight}-${style}.woff2) format('woff2');
      unicode-range: ${unicodeRange};
    }`;
}

const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

module.exports = {
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap": [
    face("Fraunces", 400, "normal", LATIN_RANGE),
    face("Fraunces", 500, "normal", LATIN_RANGE),
    face("Fraunces", 600, "normal", LATIN_RANGE),
    face("Fraunces", 400, "italic", LATIN_RANGE),
    face("Fraunces", 500, "italic", LATIN_RANGE),
    face("Fraunces", 600, "italic", LATIN_RANGE),
  ].join("\n"),
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap": [
    face("Inter", 400, "normal", LATIN_RANGE),
    face("Inter", 500, "normal", LATIN_RANGE),
    face("Inter", 600, "normal", LATIN_RANGE),
  ].join("\n"),
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap": [
    face("IBM Plex Mono", 400, "normal", LATIN_RANGE),
    face("IBM Plex Mono", 500, "normal", LATIN_RANGE),
  ].join("\n"),
};
