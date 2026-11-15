export default function Footer() {
  // oxlint-disable-next-line react/purity -- year only; at module scope a Worker reads the clock as 1970
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-[var(--line)] px-4 pt-10 pb-14 text-[var(--sea-ink-soft)]">
      <div className="page-wrap flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <p className="m-0 text-sm">&copy; {year} Answerable</p>
      </div>
    </footer>
  );
}
