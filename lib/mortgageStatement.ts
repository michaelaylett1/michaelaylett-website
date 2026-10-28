/**
 * Client-side processing for the Underwriting page's optional "Mortgage
 * Statement" upload. Everything happens locally in the browser: the
 * file is never sent to a server or stored anywhere public. Each
 * upload is converted into a list of page images (JPEG data URLs)
 * that the on-page preview and the printable report both display, so
 * the printed report shows the real statement pages -- not a filename
 * or a link -- and printing never has to wait on PDF rendering.
 *
 * Supported (and actually rendered):
 *   - PDF (every page, via PDF.js, rendered at about 200 dpi)
 *   - JPEG/JPG, PNG, WEBP, GIF, BMP, AVIF
 *   - HEIC/HEIF and TIFF ONLY where the user's browser can decode them
 *     natively (Safari does; Chrome/Firefox/Edge generally do not). If
 *     the browser cannot decode one, a clear message says so instead of
 *     pretending it is supported.
 */

export interface MortgagePage {
  id: string;
  /** JPEG data URL of the rendered page (white background). */
  dataUrl: string;
  width: number;
  height: number;
}

export interface MortgageStatementDoc {
  name: string;
  size: number;
  kind: "pdf" | "image";
  /** Object URL of the ORIGINAL uploaded file, for "View Original Document". Revoke with disposeMortgageStatement(). */
  originalUrl: string;
  pages: MortgagePage[];
}

export class MortgageStatementError extends Error {}

export const MORTGAGE_MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MORTGAGE_MAX_PDF_PAGES = 25;
const TARGET_PAGE_WIDTH_PX = 1700; // ~200 dpi on a letter-width page
const MAX_IMAGE_DIMENSION_PX = 2600;
const JPEG_QUALITY = 0.88;

export const MORTGAGE_ACCEPT_ATTRIBUTE =
  "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/gif,.gif,image/bmp,.bmp,image/avif,.avif,image/heic,image/heif,.heic,.heif,image/tiff,.tif,.tiff";

export const MORTGAGE_SUPPORTED_TEXT =
  "PDF, JPG, PNG, WEBP, GIF, BMP, and AVIF are supported everywhere. HEIC/HEIF and TIFF work only in browsers that can display them (for example Safari); otherwise convert the file to a PDF or JPG first.";

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || extensionOf(file.name) === "pdf";
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "heif", "tif", "tiff"]);
function isImageCandidate(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extensionOf(file.name));
}

function newId(): string {
  return `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function canvasToJpegPage(canvas: HTMLCanvasElement): MortgagePage {
  const page: MortgagePage = {
    id: newId(),
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width: canvas.width,
    height: canvas.height,
  };
  // Release the canvas backing store promptly.
  canvas.width = 0;
  canvas.height = 0;
  return page;
}

async function decodeImageFile(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  // createImageBitmap honors EXIF orientation and avoids a DOM round trip.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("decode failed");
  }
}

async function renderImageFile(file: File): Promise<MortgagePage[]> {
  let decoded;
  try {
    decoded = await decodeImageFile(file);
  } catch {
    const ext = extensionOf(file.name);
    if (ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif") {
      throw new MortgageStatementError(
        "This browser cannot open HEIC/HEIF images. Please convert the statement to a JPG or PDF (or use Safari) and try again."
      );
    }
    if (ext === "tif" || ext === "tiff" || file.type === "image/tiff") {
      throw new MortgageStatementError(
        "This browser cannot open TIFF images. Please convert the statement to a PDF or JPG and try again."
      );
    }
    throw new MortgageStatementError("That image could not be read. It may be corrupted or in an unsupported format.");
  }
  try {
    const { width, height } = decoded;
    if (!width || !height) throw new MortgageStatementError("That image appears to be empty.");
    const scale = Math.min(1, MAX_IMAGE_DIMENSION_PX / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new MortgageStatementError("This browser could not prepare the image for printing.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    return [canvasToJpegPage(canvas)];
  } finally {
    decoded.release();
  }
}

async function renderPdfFile(file: File): Promise<MortgagePage[]> {
  // Loaded lazily so PDF.js is only downloaded when a PDF is actually uploaded.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

  const data = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
    }).promise;
  } catch (err) {
    const name = (err as { name?: string })?.name || "";
    if (name === "PasswordException") {
      throw new MortgageStatementError(
        "This PDF is password-protected. Remove the password (or print it to a new PDF) and upload it again."
      );
    }
    if (name === "InvalidPDFException" || name === "FormatError") {
      throw new MortgageStatementError("That PDF appears to be corrupted or is not a valid PDF file.");
    }
    throw new MortgageStatementError("That PDF could not be opened. Please try a different file.");
  }

  try {
    if (pdf.numPages > MORTGAGE_MAX_PDF_PAGES) {
      throw new MortgageStatementError(
        `This PDF has ${pdf.numPages} pages. Mortgage statements are limited to ${MORTGAGE_MAX_PDF_PAGES} pages; please upload only the relevant pages.`
      );
    }
    const pages: MortgagePage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, TARGET_PAGE_WIDTH_PX / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new MortgageStatementError("This browser could not render the PDF.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push(canvasToJpegPage(canvas));
      page.cleanup();
    }
    return pages;
  } finally {
    void pdf.destroy();
  }
}

/** Converts an uploaded file into a MortgageStatementDoc, or throws a MortgageStatementError with a user-readable message. */
export async function processMortgageStatementFile(file: File): Promise<MortgageStatementDoc> {
  if (file.size === 0) throw new MortgageStatementError("That file is empty.");
  if (file.size > MORTGAGE_MAX_FILE_BYTES) {
    throw new MortgageStatementError(
      `That file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is ${MORTGAGE_MAX_FILE_BYTES / 1024 / 1024} MB.`
    );
  }
  const pdf = isPdf(file);
  if (!pdf && !isImageCandidate(file)) {
    throw new MortgageStatementError(`That file type is not supported. ${MORTGAGE_SUPPORTED_TEXT}`);
  }
  let pages: MortgagePage[];
  try {
    pages = pdf ? await renderPdfFile(file) : await renderImageFile(file);
  } catch (err) {
    if (err instanceof MortgageStatementError) throw err;
    console.error("[MortgageStatement] Unexpected processing error:", err);
    throw new MortgageStatementError("That file could not be processed. Please try a different file.");
  }
  if (pages.length === 0) throw new MortgageStatementError("No pages could be read from that file.");
  return {
    name: file.name || (pdf ? "Mortgage Statement.pdf" : "Mortgage Statement"),
    size: file.size,
    kind: pdf ? "pdf" : "image",
    originalUrl: URL.createObjectURL(file),
    pages,
  };
}

/** Releases the original file's object URL. Page images are plain data URLs (garbage-collected with the state). */
export function disposeMortgageStatement(doc: MortgageStatementDoc | null | undefined) {
  if (doc?.originalUrl) URL.revokeObjectURL(doc.originalUrl);
}

/** Resolves once every page image is decoded, so window.print() never captures a blank page. */
export async function waitForMortgagePagesReady(root: ParentNode = document): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-mortgage-page]"));
  await Promise.all(
    imgs.map((img) => (img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode().catch(() => undefined)))
  );
}
