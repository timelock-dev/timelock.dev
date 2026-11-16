import { describe, expect, it } from "vitest";
import { ACTIVITY_FULL, ACTIVITY_PREVIEW } from "../src/lib/activity";
import { loadActivity } from "../src/lib/activity-data";
import { recordEvent, type EventsDb } from "../src/lib/events";
import { roundTime } from "../src/lib/drand";
import { makeDeps } from "./helpers";

const now = Date.UTC(2026, 10, 16, 12);

async function seed(db: EventsDb, locks: number, unlocksEach = 0) {
	for (let i = 0; i < locks; i++) {
		await recordEvent(db, { type: "encrypt", source: i % 3 ? "web" : "api", round: 1000 + i, unlockAt: roundTime(1000 + i), createdAt: now - (locks - i) * 60_000 });
		for (let j = 0; j < unlocksEach; j++) await recordEvent(db, { type: "decrypt", source: "web", round: 1000 + i, unlockAt: roundTime(1000 + i), createdAt: now - (locks - i) * 60_000 + j });
	}
}

describe("what the activity list shows", () => {
	it("shows 10 in the preview and 50 on the full page", () => {
		expect(ACTIVITY_PREVIEW).toBe(10);
		expect(ACTIVITY_FULL).toBe(50);
	});

	it("is empty, with zeroed stats, before anything is locked", async () => {
		const { db } = makeDeps();
		const data = await loadActivity(db, ACTIVITY_PREVIEW, now);
		expect(data.events).toEqual([]);
		expect(data.more).toBe(false);
		expect(data.stats).toMatchObject({ encrypted: 0, decrypted: 0, averageLockSeconds: null });
	});

	it("shows every lock when there are fewer than the limit, and offers nothing more", async () => {
		const { db } = makeDeps();
		await seed(db, 3);
		const data = await loadActivity(db, ACTIVITY_PREVIEW, now);
		expect(data.events).toHaveLength(3);
		expect(data.more).toBe(false);
	});

	it("offers nothing more at exactly the limit, and more one past it", async () => {
		const { db } = makeDeps();
		await seed(db, 10);
		expect(await loadActivity(db, ACTIVITY_PREVIEW, now)).toMatchObject({ more: false, events: { length: 10 } });
		await seed(db, 1);
		const data = await loadActivity(db, ACTIVITY_PREVIEW, now);
		expect(data.events).toHaveLength(10);
		expect(data.more).toBe(true);
	});

	it("lists locks only, newest first, however many unlocks sit between them", async () => {
		const { db } = makeDeps();
		await seed(db, 60, 4);
		const preview = await loadActivity(db, ACTIVITY_PREVIEW, now);
		expect(preview.events!.map((e) => e.type)).toEqual(Array(10).fill("encrypt"));
		expect(preview.events!.map((e) => e.round)).toEqual([1059, 1058, 1057, 1056, 1055, 1054, 1053, 1052, 1051, 1050]);
		const full = await loadActivity(db, ACTIVITY_FULL, now);
		expect(full.events).toHaveLength(50);
		expect(full.events!.every((e) => e.type === "encrypt")).toBe(true);
		expect(full.more).toBe(true);
	});

	it("keeps counting unlocks in the stats and keeps their rows", async () => {
		const { db } = makeDeps();
		await seed(db, 2, 3);
		const data = await loadActivity(db, ACTIVITY_PREVIEW, now);
		expect(data.stats).toMatchObject({ encrypted: 2, decrypted: 6 });
		expect(db.rows().filter((r) => r.type === "decrypt")).toHaveLength(6);
	});

	it("exposes nothing that could identify a message page", async () => {
		const { db } = makeDeps();
		await seed(db, 2);
		const { events } = await loadActivity(db, ACTIVITY_PREVIEW, now);
		expect(Object.keys(events![0]).sort()).toEqual(["createdAt", "id", "round", "source", "type", "unlockAt"]);
		expect(typeof events![0].id).toBe("number");
	});

	it("is 'unavailable', not an error, without a database or when the read fails", async () => {
		expect(await loadActivity(undefined, ACTIVITY_PREVIEW, now)).toEqual({ events: null, stats: null, more: false });
		const broken: EventsDb = {
			prepare: () => {
				throw new Error("D1 is down");
			},
		};
		const error = console.error;
		console.error = () => {};
		try {
			expect(await loadActivity(broken, ACTIVITY_PREVIEW, now)).toEqual({ events: null, stats: null, more: false });
		} finally {
			console.error = error;
		}
	});
});
