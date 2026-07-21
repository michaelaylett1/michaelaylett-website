type Props = {
  isSuccess: boolean;
  isError: boolean;
  errorMessage: string;
  successTitle?: string;
  successBody?: string;
};

export default function FormStatusMessages({
  isSuccess,
  isError,
  errorMessage,
  successTitle = "Thank you. Your information was sent.",
  successBody = "I've received your submission and will follow up personally soon.",
}: Props) {
  if (isSuccess) {
    return (
      <div
        role="status"
        className="sm:col-span-2 border border-emerald-700/40 bg-emerald-50 text-emerald-900 px-5 py-4"
      >
        <p className="font-medium">{successTitle}</p>
        <p className="mt-1 text-sm text-emerald-900/80">{successBody}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="sm:col-span-2 border border-red-700/40 bg-red-50 text-red-900 px-5 py-4"
      >
        <p className="font-medium">We couldn&apos;t send your submission.</p>
        <p className="mt-1 text-sm text-red-900/80">{errorMessage}</p>
      </div>
    );
  }

  return null;
}
