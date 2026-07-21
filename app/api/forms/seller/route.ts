import { runSpamGuards } from "@/lib/forms/guard";
import { sendNotificationEmail } from "@/lib/forms/email";
import { jsonError, jsonServerError, jsonSuccess } from "@/lib/forms/response";
import { sanitizeString, validateContactBasics } from "@/lib/forms/validate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const guardResponse = runSpamGuards(formData, request);
    if (guardResponse) return guardResponse;

    const name = sanitizeString(formData.get("name"));
    const email = sanitizeString(formData.get("email"));
    const phone = sanitizeString(formData.get("phone"));
    const address = sanitizeString(formData.get("address"));
    const value = sanitizeString(formData.get("value"));
    const balance = sanitizeString(formData.get("balance"));
    const payment = sanitizeString(formData.get("payment"));
    const rate = sanitizeString(formData.get("rate"));
    const cashNeeded = sanitizeString(formData.get("cashNeeded"));
    const closingDate = sanitizeString(formData.get("closingDate"));
    const situation = sanitizeString(formData.get("situation"), { long: true });

    const fieldErrors = validateContactBasics({ name, email, phone });
    if (Object.keys(fieldErrors).length > 0) {
      return jsonError("Please fix the highlighted fields.", 400, fieldErrors);
    }

    await sendNotificationEmail({
      subject: "New Seller Property Inquiry",
      formName: "Seller Property Inquiry",
      replyTo: email,
      fields: [
        { label: "Name", value: name },
        { label: "Email", value: email },
        { label: "Phone", value: phone },
        { label: "Property Address", value: address },
        { label: "Estimated Property Value", value: value },
        { label: "Mortgage Balance", value: balance },
        { label: "Monthly Mortgage Payment", value: payment },
        { label: "Interest Rate", value: rate },
        { label: "Cash Needed at Closing", value: cashNeeded },
        { label: "Desired Closing Date", value: closingDate },
        { label: "Their Situation", value: situation },
      ],
    });

    return jsonSuccess();
  } catch (err) {
    return jsonServerError("seller", err);
  }
}
