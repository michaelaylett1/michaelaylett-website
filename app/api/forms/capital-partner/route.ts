import { runSpamGuards } from "@/lib/forms/guard";
import { sendNotificationEmail } from "@/lib/forms/email";
import { jsonError, jsonSuccess } from "@/lib/forms/response";
import { sanitizeString, validateContactBasics } from "@/lib/forms/validate";
import { FileUploadError, uploadFormFiles } from "@/lib/forms/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const guardResponse = runSpamGuards(formData, request);
    if (guardResponse) return guardResponse;

    const firstName = sanitizeString(formData.get("firstName"));
    const lastName = sanitizeString(formData.get("lastName"));
    const email = sanitizeString(formData.get("email"));
    const phone = sanitizeString(formData.get("phone"));
    const readyToInvest = sanitizeString(formData.get("readyToInvest"));
    const investmentRange = sanitizeString(formData.get("investmentRange"));
    const howHeard = sanitizeString(formData.get("howHeard"));
    const comments = sanitizeString(formData.get("comments"), { long: true });
    const acknowledged = formData.get("acknowledged") === "true";

    const name = `${firstName} ${lastName}`.trim();
    const fieldErrors = validateContactBasics({ name, email, phone });
    if (!firstName) fieldErrors.firstName = "Please enter your first name.";
    if (!lastName) fieldErrors.lastName = "Please enter your last name.";

    const hasFiles = formData
      .getAll("proofOfFunds")
      .some((entry) => entry instanceof File && entry.size > 0);
    if (!hasFiles) {
      fieldErrors.proofOfFunds = "Please attach at least one proof of funds document.";
    }

    if (!acknowledged) {
      fieldErrors.acknowledged =
        "Please confirm you understand this is not an investment agreement.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      return jsonError("Please fix the highlighted fields.", 400, fieldErrors);
    }

    let files;
    try {
      files = await uploadFormFiles(formData, "proofOfFunds", "capital-partner");
    } catch (err) {
      if (err instanceof FileUploadError) {
        return jsonError(err.message, 400, { proofOfFunds: err.message });
      }
      throw err;
    }

    await sendNotificationEmail({
      subject: "New Capital Partner Submission",
      formName: "Capital Partner Inquiry",
      replyTo: email,
      fields: [
        { label: "First Name", value: firstName },
        { label: "Last Name", value: lastName },
        { label: "Email", value: email },
        { label: "Phone", value: phone },
        { label: "Ready to Invest", value: readyToInvest },
        { label: "Investment Range", value: investmentRange },
        { label: "How They Heard About Michael", value: howHeard },
        { label: "Questions or Comments", value: comments },
        {
          label: "Acknowledgment",
          value: acknowledged
            ? "Confirmed this is not an investment agreement or offering."
            : "Not confirmed",
        },
      ],
      files,
    });

    return jsonSuccess();
  } catch (err) {
    console.error("Capital partner form submission failed:", err);
    return jsonError(
      "Something went wrong while sending your submission. Please try again, or email michael@michaelaylett.com directly.",
      500
    );
  }
}
