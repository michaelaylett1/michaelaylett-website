import { NextResponse } from "next/server";
import type { FieldErrors } from "./validate";

export function jsonSuccess(): NextResponse {
  return NextResponse.json({ success: true }, { status: 200 });
}

export function jsonError(
  message: string,
  status = 400,
  fieldErrors?: FieldErrors
): NextResponse {
  return NextResponse.json(
    { success: false, error: message, fieldErrors },
    { status }
  );
}
