import { NextResponse } from "next/server";

export const runtime = "nodejs";

// The password is compared entirely on the server so its literal value is
// never included in the client-side JavaScript bundle shipped to visitors.
// This is intentionally a lightweight access gate meant to keep casual
// visitors off a private calculator page, not a substitute for real
// authentication: anyone with server access (or who is handed the value)
// can still see it, and the check itself is a simple string comparison.
// An env var override is supported so the value can be rotated without a
// code change, but it falls back to the project's specified password.
const SHARED_HOUSING_PASSWORD = process.env.SHARED_HOUSING_CALCULATOR_PASSWORD || "padsplit";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";

    if (password.length > 0 && password === SHARED_HOUSING_PASSWORD) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    return NextResponse.json(
      { success: false, error: "Incorrect password. Please try again." },
      { status: 401 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[shared-housing-auth] Unhandled error: ${message}`);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
