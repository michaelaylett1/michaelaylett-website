import { runSpamGuards } from "@/lib/forms/guard";
import { sendNotificationEmail } from "@/lib/forms/email";
import { jsonError, jsonServerError, jsonSuccess } from "@/lib/forms/response";
import { sanitizeString, validateContactBasics } from "@/lib/forms/validate";
import { FileUploadError, uploadFormFiles } from "@/lib/forms/storage";

export const runtime = "nodejs";
// See the comment in app/api/forms/capital-partner/route.ts: this route
// also uploads files, so it gets the same higher duration ceiling.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const guardResponse = runSpamGuards(formData, request);
    if (guardResponse) return guardResponse;

    const name = sanitizeString(formData.get("name"));
    const email = sanitizeString(formData.get("email"));
    const phone = sanitizeString(formData.get("phone"));
    const propertyName = sanitizeString(formData.get("propertyName"));
    const propertyAddress = sanitizeString(formData.get("propertyAddress"));
    const askingPrice = sanitizeString(formData.get("askingPrice"));
    const existingPads = sanitizeString(formData.get("existingPads"));
    const additionalPads = sanitizeString(formData.get("additionalPads"));
    const annualRevenue = sanitizeString(formData.get("annualRevenue"));
    const annualNOI = sanitizeString(formData.get("annualNOI"));
    const occupancy = sanitizeString(formData.get("occupancy"));
    const siteMix = sanitizeString(formData.get("siteMix"));
    const mortgageBalance = sanitizeString(formData.get("mortgageBalance"));
    const interestRate = sanitizeString(formData.get("interestRate"));
    const cashAtClosing = sanitizeString(formData.get("cashAtClosing"));
    const listingLink = sanitizeString(formData.get("listingLink"));
    const sellerFinancing = sanitizeString(formData.get("sellerFinancing"));
    const comments = sanitizeString(formData.get("comments"), { long: true });

    const fieldErrors = validateContactBasics({ name, email, phone });
    if (Object.keys(fieldErrors).length > 0) {
      return jsonError("Please fix the highlighted fields.", 400, fieldErrors);
    }

    let files;
    try {
      files = await uploadFormFiles(formData, "rvDocs", "rv-park");
    } catch (err) {
      if (err instanceof FileUploadError) {
        return jsonError(err.message, 400, { rvDocs: err.message });
      }
      throw err;
    }

    await sendNotificationEmail({
      subject: "New RV Park Opportunity",
      formName: "RV Park Submission",
      replyTo: email,
      fields: [
        { label: "Name", value: name },
        { label: "Email", value: email },
        { label: "Phone", value: phone },
        { label: "Property Name", value: propertyName },
        { label: "Property Address", value: propertyAddress },
        { label: "Asking Price", value: askingPrice },
        { label: "Number of Existing RV Pads", value: existingPads },
        { label: "Additional Approved or Possible Pads", value: additionalPads },
        { label: "Annual Revenue", value: annualRevenue },
        { label: "Annual NOI", value: annualNOI },
        { label: "Occupancy", value: occupancy },
        { label: "Long-Term Versus Short-Term Site Mix", value: siteMix },
        { label: "Existing Mortgage Balance", value: mortgageBalance },
        { label: "Interest Rate", value: interestRate },
        { label: "Desired Cash at Closing", value: cashAtClosing },
        { label: "Link to Listing or Offering Memorandum", value: listingLink },
        { label: "Seller Financing Available", value: sellerFinancing },
        { label: "Additional Comments", value: comments },
      ],
      files,
    });

    return jsonSuccess();
  } catch (err) {
    return jsonServerError("rv-park", err);
  }
}
