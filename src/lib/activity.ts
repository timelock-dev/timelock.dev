import type { EventStats, FeedEvent } from "./events";
import { iconSvg } from "./icons";
import { formatLocal, formatRelative, formatShortDate, formatSpan, formatUtc } from "./time";

/** Rows in the homepage preview and on the "See all" page. */
export const ACTIVITY_PREVIEW = 10;
export const ACTIVITY_FULL = 50;

/** The path of the "See all" page. */
export const ACTIVITY_PATH = "/activity";

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const count = (n: number) => n.toLocaleString("en-US");

/** Lock length for display: whole minutes once it's a minute or more, so the 3-second round snap doesn't show as "2 seconds". */
export function lockLength(seconds: number): string {
	const s = Math.max(0, seconds);
	return formatSpan(s >= 60 ? Math.round(s / 60) * 60 : s);
}

/** "4-day lock", "3-day 23-hour lock", "30-second lock". */
export function lockLabel(seconds: number): string {
	return `${lockLength(seconds).replace(/([\d,]+) ([a-z]+?)s?(?= |$)/g, "$1-$2")} lock`;
}

type StatsPart = { text: string; strong?: boolean; group?: boolean };

/** Sentence parts; `strong` parts are the numbers, and consecutive `group` parts should not wrap apart. */
export function statsParts(stats: EventStats): StatsPart[] {
	const window = `in the last ${stats.days} days.`;
	if (stats.encrypted === 0 && stats.decrypted === 0) return [{ text: `No messages encrypted or decrypted ${window}` }];
	const parts: StatsPart[] = [
		{ text: count(stats.encrypted), strong: true },
		{ text: ` ${stats.encrypted === 1 ? "message" : "messages"} encrypted and ` },
		{ text: count(stats.decrypted), strong: true },
		{ text: ` decrypted ${window}` },
	];
	if (stats.averageLockSeconds !== null) {
		parts.push({ text: " " }, { text: "Average lock: ", group: true }, { text: lockLength(stats.averageLockSeconds), strong: true, group: true }, { text: ".", group: true });
	}
	return parts;
}

export function statsText(stats: EventStats): string {
	return statsParts(stats)
		.map((p) => p.text)
		.join("");
}

export function statsHtml(stats: EventStats): string {
	const html = (p: StatsPart) => (p.strong ? `<strong>${escape(p.text)}</strong>` : escape(p.text));
	const parts = statsParts(stats);
	const group = parts.filter((p) => p.group);
	return (
		parts
			.filter((p) => !p.group)
			.map(html)
			.join("") + (group.length ? `<span class="nowrap">${group.map(html).join("")}</span>` : "")
	);
}

/** How a locked message reads in the list: ["4-day lock", "opens Oct 26, 1:30 PM EDT"] or ["4-day lock", "opened 2 hours ago"]. */
export function lockDetail(e: FeedEvent, now: number, timeZone?: string): [string, string] {
	const created = Date.parse(e.createdAt);
	const unlock = Date.parse(e.unlockAt);
	const lock = unlock > created ? lockLabel((unlock - created) / 1000) : "no lock";
	return [lock, unlock > now ? `opens ${formatShortDate(unlock, { timeZone, now })}` : `opened ${formatRelative(unlock, now)}`];
}

export interface RowOptions {
	/** For dates; the server passes "UTC", the browser leaves it unset for local time. */
	timeZone?: string;
	/** Show whether it was locked on the website or through the API. */
	source?: boolean;
}

/**
 * One locked message. A row is built only from the lock's times and round: there is no message id in an event, so a
 * row can't link to or identify a message page.
 */
export function lockRowHtml(e: FeedEvent, now: number, { timeZone, source = false }: RowOptions = {}): string {
	const created = Date.parse(e.createdAt);
	const unlock = Date.parse(e.unlockAt);
	const tooltip = `${unlock > now ? `Opens ${formatRelative(unlock, now)}. ` : ""}Unlock time ${formatUtc(unlock)}, drand round #${count(e.round)}`;
	const [lock, when] = lockDetail(e, now, timeZone);
	return `<li class="activity-row">
	<span class="activity-icon">${iconSvg("lock")}</span>
	<span class="activity-main" title="${escape(tooltip)}"><strong>${escape(lock)}</strong><span class="muted"><span class="activity-sep"> · </span>${escape(when)}</span></span>${source ? `\n\t<span class="Label">${e.source === "web" ? "website" : "API"}</span>` : ""}
	<time class="activity-time muted" datetime="${escape(e.createdAt)}" title="${escape(formatLocal(created, { timeZone }))}">${escape(formatRelative(created, now))}</time>
</li>`;
}

export function activityRowsHtml(events: FeedEvent[], now: number, options: RowOptions = {}): string {
	return events.map((e) => lockRowHtml(e, now, options)).join("\n");
}
