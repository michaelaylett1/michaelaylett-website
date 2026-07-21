"use client";

import { useRef, useState } from "react";
import { FORM_RENDERED_AT_FIELD_NAME } from "./spam";

export type SubmissionStatus = "idle" | "submitting" | "success" | "error";

type SubmitResult = { success: boolean };

/**
 * Shared submission logic for every form on the site: posts a FormData
 * payload to the given API route, tracks loading/success/error state, and
 * surfaces field-level validation errors returned by the server. Also
 * stamps the time-trap field used for basic spam protection.
 */
export function useFormSubmission(endpoint: string) {
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const renderedAtRef = useRef(Date.now());

  async function submit(formData: FormData): Promise<SubmitResult> {
    setStatus("submitting");
    setErrorMessage("");
    setFieldErrors({});
    formData.set(FORM_RENDERED_AT_FIELD_NAME, String(renderedAtRef.current));

    try {
      const res = await fetch(endpoint, { method: "POST", body: formData });
      let data: {
        success?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
      } = {};
      try {
        data = await res.json();
      } catch {
        // Non-JSON response (e.g. platform error page); fall through to the
        // generic error handling below.
      }

      if (!res.ok || !data.success) {
        setStatus("error");
        setErrorMessage(
          data.error || "Something went wrong. Please try again."
        );
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        return { success: false };
      }

      setStatus("success");
      return { success: true };
    } catch {
      setStatus("error");
      setErrorMessage(
        "We couldn't reach the server. Please check your connection and try again."
      );
      return { success: false };
    }
  }

  function reset() {
    setStatus("idle");
    setErrorMessage("");
    setFieldErrors({});
    renderedAtRef.current = Date.now();
  }

  return {
    status,
    isSubmitting: status === "submitting",
    isSuccess: status === "success",
    isError: status === "error",
    errorMessage,
    fieldErrors,
    submit,
    reset,
  };
}
