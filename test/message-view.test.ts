import { describe, expect, it } from "vitest";
import { countdownSegments, formatUtcShort, lockedEarlierText, messageMeta, timerHtml, timerShape } from "../src/lib/message-view";

const digits = (s: number) =>
	countdownSegments(s)
		.map((x) => `${x.value} ${x.label}`)
		.join(" | ");

describe("countdownSegments", () => {
	it("drops leading units as the unlock time gets close", () => {
		expect(digits(400 * 86400 + 3 * 3600 + 4 * 60 + 5)).toBe("1 year | 35 days | 03 hours | 04 min");
		expect(digits(2 * 86400 + 4 * 3600 + 12 * 60 + 55)).toBe("02 days | 04 hours | 12 min | 55 sec");
		expect(digits(86400 + 3600)).toBe("01 day | 01 hour | 00 min | 00 sec");
		expect(digits(86400 - 1)).toBe("23 hours | 59 min | 59 sec");
		expect(digits(3600)).toBe("01 hour | 00 min | 00 sec");
		expect(digits(3599)).toBe("59 min | 59 sec");
		expect(digits(55 * 60)).toBe("55 min | 00 sec");
	});

	it("rounds up, so it never shows zero before the unlock time", () => {
		expect(digits(0.2)).toBe("00 min | 01 sec");
		expect(digits(59.01)).toBe("01 min | 00 sec");
		expect(digits(0)).toBe("00 min | 00 sec");
		expect(digits(-5)).toBe("00 min | 00 sec");
	});
});

describe("timerHtml", () => {
	const clock = (s: number) =>
		timerHtml(countdownSegments(s))
			.replace(/<span class="timer-label">[^<]*<\/span>/g, "")
			.replace(/<[^>]+>/g, "");

	it("reads as a clock: digit groups with a colon between them", () => {
		expect(clock(3 * 60 + 54)).toBe("03:54");
		expect(clock(3600 + 3 * 60 + 54)).toBe("01:03:54");
		expect(clock(2 * 86400 + 4 * 3600 + 12 * 60 + 55)).toBe("02:04:12:55");
		expect(clock(400 * 86400 + 3 * 3600 + 4 * 60)).toBe("1:35:03:04");
	});

	it("names each unit under its group and hides the colons from screen readers", () => {
		const html = timerHtml(countdownSegments(90));
		expect(html.match(/class="timer-seg"/g)).toHaveLength(2);
		expect(html).toContain('<span class="timer-num">01</span><span class="timer-label">min</span>');
		expect(html.match(/<span class="timer-colon" aria-hidden="true">:<\/span>/g)).toHaveLength(1);
		expect(timerHtml(countdownSegments(2 * 86400)).match(/class="timer-colon"/g)).toHaveLength(3);
	});

	it("reports a width that grows with the digit count", () => {
		const k = (s: number) => Number(/--k:([\d.]+)/.exec(timerHtml(countdownSegments(s)))![1]);
		expect(k(90)).toBeLessThan(k(3600));
		expect(k(3600)).toBeLessThan(k(2 * 86400));
		expect(k(2 * 86400)).toBeLessThan(k(200 * 86400));
	});
});

describe("timerShape", () => {
	const shape = (s: number) => timerShape(countdownSegments(s));

	it("stays the same from second to second, so only the digits are rewritten", () => {
		expect(shape(234)).toBe(shape(233));
		expect(shape(3599)).toBe(shape(60));
	});

	it("changes when a unit is added or dropped, when a unit's name changes, or when a number gains a digit", () => {
		expect(shape(3600)).not.toBe(shape(3599));
		expect(shape(2 * 86400)).not.toBe(shape(86400));
		expect(shape(10 * 365 * 86400)).not.toBe(shape(9 * 365 * 86400));
	});
});

describe("message page text", () => {
	const m = { createdAt: Date.UTC(2026, 10, 14, 21, 2), unlockAt: Date.UTC(2026, 10, 21, 14, 8) };

	it("formats UTC times for link previews", () => {
		expect(formatUtcShort(m.unlockAt)).toBe("Nov 21, 2026, 2:08 PM UTC");
	});

	it("describes a locked message without anything but times", () => {
		const meta = messageMeta(m, m.unlockAt - 1);
		expect(meta.title).toBe("Locked message · opens Nov 21, 2026, 2:08 PM UTC · timelock.dev");
		expect(meta.description).toContain("Nobody can read it before Nov 21, 2026, 2:08 PM UTC");
	});

	it("describes an unlocked message from the unlock time on", () => {
		const meta = messageMeta(m, m.unlockAt);
		expect(meta.title).toBe("Unlocked message · locked Nov 14, 2026, 9:02 PM UTC · timelock.dev");
		expect(meta.description).toContain("unlocked on Nov 21, 2026, 2:08 PM UTC");
	});

	it("says how long before the unlock it was locked", () => {
		expect(lockedEarlierText(m.createdAt, m.unlockAt)).toBe("Locked 6 days 17 hours earlier, on");
		expect(lockedEarlierText(m.unlockAt, m.unlockAt)).toBe("Locked on");
	});
});
