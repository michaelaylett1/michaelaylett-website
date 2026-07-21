import { HONEYPOT_FIELD_NAME } from "@/lib/forms/spam";

/**
 * Hidden field that real visitors never see or fill in. Bots that
 * auto-fill every input on a page will fill it, which the server uses to
 * silently discard the submission. Visually hidden (not `display: none`,
 * which some bots skip) and pulled out of tab order / screen readers.
 */
export default function FormHoneypot() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-5000px",
        width: "1px",
        height: "1px",
        overflow: "hidden",
      }}
    >
      <label htmlFor={HONEYPOT_FIELD_NAME}>Leave this field empty</label>
      <input
        type="text"
        id={HONEYPOT_FIELD_NAME}
        name={HONEYPOT_FIELD_NAME}
        tabIndex={-1}
        autoComplete="off"
      />
    </div>
  );
}
