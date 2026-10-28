// Copies the PDF.js worker that matches the installed pdfjs-dist version
// into /public so the Mortgage Statement uploader can load it from the
// site's own origin (no CDN, no external request). Runs on postinstall.
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.js");
const dest = path.join(__dirname, "..", "public", "pdf.worker.min.js");
// Plain recursive copy that never inherits the (possibly read-only)
// permissions of the source files, so re-running always works.
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, e.name);
    const t = path.join(to, e.name);
    if (e.isDirectory()) copyDir(f, t);
    else {
      try { fs.rmSync(t, { force: true }); } catch (_) {}
      fs.writeFileSync(t, fs.readFileSync(f));
    }
  }
}

try {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    // Standard (non-embedded) fonts and CJK cmaps, so statements that
    // rely on e.g. unembedded Helvetica still render real text.
    for (const dir of ["standard_fonts", "cmaps"]) {
      const from = path.join(__dirname, "..", "node_modules", "pdfjs-dist", dir);
      const to = path.join(__dirname, "..", "public", "pdfjs", dir);
      if (fs.existsSync(from)) copyDir(from, to);
    }
    console.log("[copy-pdf-worker] Copied pdf.worker.min.js and font data to public/");
  } else {
    console.warn("[copy-pdf-worker] pdfjs-dist worker not found; skipping.");
  }
} catch (err) {
  console.warn("[copy-pdf-worker] Could not copy worker:", err.message);
}
