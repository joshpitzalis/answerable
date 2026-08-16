// ponytail: native Intl, no date library. Effect's DateTime has no relative
// formatter; swap to DateTime.distance + Duration.parts only if you need
// zone-aware arithmetic or a testable Clock.

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS = [
	["year", 31_536_000_000],
	["month", 2_592_000_000],
	["week", 604_800_000],
	["day", 86_400_000],
	["hour", 3_600_000],
	["minute", 60_000],
] as const;

/** `3 days ago`, `in 2 hours`, `just now`. */
export const formatRelative = (date: Date, now: Date = new Date()): string => {
	const diff = date.getTime() - now.getTime();
	const unit = UNITS.find(([, ms]) => Math.abs(diff) >= ms);
	if (!unit) return "just now";
	return relative.format(Math.round(diff / unit[1]), unit[0]);
};

/** `16 August 2026`. */
export const formatAbsolute = (date: Date): string =>
	date.toLocaleDateString("en-GB", { dateStyle: "long" });

const WEEK = 604_800_000;

/** Relative inside a week (`3 days ago`), absolute beyond (`16 August 2026`). */
export const humanizeDate = (date: Date, now: Date = new Date()): string =>
	Math.abs(date.getTime() - now.getTime()) < WEEK
		? formatRelative(date, now)
		: formatAbsolute(date);
