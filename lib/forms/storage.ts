import { put, issueSignedToken, presignUrl } from "@vercel/blob";

/**
 * Secure file storage for form uploads (Capital Partner proof-of-funds,
 * RV Park financials/documents).
 *
 * Files are written to a PRIVATE Vercel Blob store, never a public one, and
 * never into the repository or `public/` directory. Private blobs are not
 * reachable by a plain URL; the notification email instead gets a signed,
 * time-limited link (see `LINK_VALID_MS` below) generated with Vercel's
 * signed-URL API. Only someone with that exact link, within the validity
 * window, can read the file.
 *
 * Requires a private Blob store connected to the project (adds the
 * necessary auth automatically on Vercel). For local development, run
 * `vercel env pull .env.local` after connecting a store, or set
 * BLOB_READ_WRITE_TOKEN manually. See README.md "File storage setup".
 */

const LINK_VALID_MS = 7 * 24 * 60 * 60 * 1000; // 7 days: the max Vercel allows.
export const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB per file.
export const MAX_FILES_PER_SUBMISSION = 5;

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "xlsx",
  "xls",
  "csv",
  "doc",
  "docx",
]);

export type UploadedFileLink = {
  name: string;
  url: string;
  size: number;
};

export class FileUploadError extends Error {}

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  return cleaned || "file";
}

function getExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

/**
 * Validates and uploads a single file to private Blob storage, returning a
 * time-limited signed link suitable for including in a notification email.
 */
export async function uploadPrivateFile(
  file: File,
  folder: string
): Promise<UploadedFileLink> {
  if (file.size === 0) {
    throw new FileUploadError(`"${file.name}" is empty.`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FileUploadError(
      `"${file.name}" is too large (max ${Math.floor(
        MAX_FILE_SIZE_BYTES / (1024 * 1024)
      )}MB per file).`
    );
  }
  const extension = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new FileUploadError(
      `"${file.name}" has an unsupported file type. Allowed types: ${Array.from(
        ALLOWED_EXTENSIONS
      ).join(", ")}.`
    );
  }

  const safeName = sanitizeFilename(file.name);
  const pathname = `${folder}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

  try {
    await put(pathname, file, {
      access: "private",
      addRandomSuffix: false,
    });

    const validUntil = Date.now() + LINK_VALID_MS;
    const token = await issueSignedToken({
      pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname,
      access: "private",
      validUntil,
    });

    return { name: file.name, url: presignedUrl, size: file.size };
  } catch (err) {
    if (err instanceof FileUploadError) throw err;
    throw new FileUploadError(
      `Failed to securely store "${file.name}". Please try again.`
    );
  }
}

/**
 * Uploads every File found under `fieldName` in the submitted FormData,
 * enforcing the per-submission file count limit.
 */
export async function uploadFormFiles(
  formData: FormData,
  fieldName: string,
  folder: string
): Promise<UploadedFileLink[]> {
  const files = formData
    .getAll(fieldName)
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) return [];

  if (files.length > MAX_FILES_PER_SUBMISSION) {
    throw new FileUploadError(
      `Please upload at most ${MAX_FILES_PER_SUBMISSION} files.`
    );
  }

  const uploaded: UploadedFileLink[] = [];
  for (const file of files) {
    uploaded.push(await uploadPrivateFile(file, folder));
  }
  return uploaded;
}
