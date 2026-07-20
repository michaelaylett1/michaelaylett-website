export default function Footer() {
  return (
    <footer className="bg-ink border-t border-line py-10">
      <div className="mx-auto max-w-content px-6 md:px-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="font-display text-bone">Michael Aylett</span>
        <span className="eyebrow text-slate text-center">
          Co-Living Real Estate · EcomRanx · Salt Lake City, UT
        </span>
        <span className="eyebrow text-slate">
          © {new Date().getFullYear()}
        </span>
      </div>
    </footer>
  );
}
