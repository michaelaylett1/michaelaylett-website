import {
  put,
  issueSignedToken,
  presignUrl,
  BlobAccessError,
  BlobContentTypeNotAllowedError,
  BlobFileTooLargeError,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
} from "@vercel/blob";

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
 * Requires a PRIVATE Blob store connected to this exact Vercel project (adds
 * the necessary auth automatically at runtime). For local development, run
 * `vercel env pull .env.local` after connecting a store, or set
 * BLOB_READ_WRITE_TOKEN manually. See README.md "Email notifications and
 * file uploads" for the full, exact setup steps and how to read the
 * diagnostic logs this file writes when something goes wrong.
 */

const LINK_VALID_MS = 7 * 24 * 60 * 60 * 1000; // 7 days: the max Vercel allows.
export const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB per file.
export const MAX_FILES_PER_SUBMISSION = 5;

// Extension -> accepted MIME types. Browsers don't always set a MIME type
// (some send an empty string, particularly for less common formats saved
// from certain apps), so an empty `file.type` is allowed through on the
// assumption the extension check already narrows things down; when a MIME
// type IS present, it must match, which blocks the common "renamed .exe to
// .pdf" style spoof.
const ALLOWED_MIME_TYPES_BY_EXTENSION: Record<string, string[]> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip", // some browsers report xlsx as a generic zip container
  ],
  xls: ["application/vnd.ms-excel"],
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
  ],
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(ALLOWED_MIME_TYPES_BY_EXTENSION));

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
 * Logs a diagnosable, non-sensitive summary of a storage failure. Never
 * logs file contents. Logs the original filename (useful for correlating
 * "which submission, which file" when debugging) but not its bytes.
 */
function logBlobFailure(stage: "upload" | "sign-token" | "presign-url", file: File, err: unknown) {
  let reason = "Unknown error";
  let hint = "Check the Vercel Storage tab and Function logs for more detail.";

  if (err instanceof BlobStoreNotFoundError) {
    reason = "BlobStoreNotFoundError";
    hint =
      "No Blob store is connected to this project (or the connection didn't propagate). " +
      "In Vercel: Storage tab > your Blob store > Projects > Connect to Project, then redeploy.";
  } else if (err instanceof BlobAccessError) {
    reason = "BlobAccessError";
    hint =
      "The credentials used (OIDC token or BLOB_READ_WRITE_TOKEN) don't have access to this store. " +
      "Confirm the store is connected to THIS project/environment and that you redeployed after connecting it.";
  } else if (err instanceof BlobStoreSuspendedError) {
    reason = "BlobStoreSuspendedError";
    hint = "The Blob store is suspended (often a billing/usage issue). Check the Vercel Storage dashboard.";
  } else if (err instanceof BlobServiceNotAvailable) {
    reason = "BlobServiceNotAvailable";
    hint = "Vercel Blob service was temporarily unavailable. This is usually transient; try again.";
  } else if (err instanceof BlobServiceRateLimited) {
    reason = "BlobServiceRateLimited";
    hint = "Vercel Blob rate-limited this request. Try again shortly.";
  } else if (err instanceof BlobContentTypeNotAllowedError) {
    reason = "BlobContentTypeNotAllowedError";
    hint = "The file's content type was rejected by Blob storage itself.";
  } else if (err instanceof BlobFileTooLargeError) {
    reason = "BlobFileTooLargeError";
    hint = "The file exceeded Blob storage's own size limit (separate from this app's MAX_FILE_SIZE_BYTES check).";
  } else if (err && typeof err === "object" && "message" in err) {
    reason = String((err as { message: unknown }).message).slice(0, 300);
  }

  console.error(
    `[forms:blob] ${stage} failed for "${file.name}" (${file.size} bytes, type=${file.type || "unknown"}): ${reason}. ${hint}`
  );
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

  if (file.type) {
    const allowedMimeTypes = ALLOWED_MIME_TYPES_BY_EXTENSION[extension];
    if (!allowedMimeTypes.includes(file.type)) {
      console.warn(
        `[forms:blob] Rejected "${file.name}": extension .${extension} but MIME type "${file.type}" doesn't match expected types (${allowedMimeTypes.join(", ")}).`
      );
      throw new FileUploadError(
        `"${file.name}" doesn't look like a valid .${extension} file. Please re-export or re-save it and try again.`
      );
    }
  }

  const safeName = sanitizeFilename(file.name);
  const pathname = `${folder}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

  let putResult;
  try {
    putResult = await put(pathname, file, {
      access: "private",
      addRandomSuffix: false,
      contentType: file.type || undefined,
    });
  } catch (err) {
    logBlobFailure("upload", file, err);
    throw new FileUploadError(
      `Failed to securely store "${file.name}". Please try again, or email the document directly to michael@michaelaylett.com.`
    );
  }

  try {
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
    logBlobFailure("sign-token", file, err);
    // The file itself uploaded successfully at this point; only link
    // generation failed. Surface that distinction in the log for
    // debugging, but the visitor still needs a clear, safe error since we
    // can't hand back a usable link.
    console.error(
      `[forms:blob] File "${putResult.pathname}" was stored but a secure link could not be generated.`
    );
    throw new FileUploadError(
      `"${file.name}" was uploaded but a secure link could not be generated. Please try again, or email the document directly to michael@michaelaylett.com.`
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
