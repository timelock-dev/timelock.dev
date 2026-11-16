import { eventStats, listEvents, type EventsDb, type EventStats, type FeedEvent } from "./events";

export interface ActivityData {
	/** The latest locked messages, newest first; null when the database is unavailable. */
	events: FeedEvent[] | null;
	stats: EventStats | null;
	/** There are more locked messages than `events` holds. */
	more: boolean;
}

/**
 * What the activity list shows: the latest `limit` encryptions. Decryptions are still recorded and counted in the
 * stats, but each is only someone opening a page, so they are not rows. Never throws: a failed read is "unavailable".
 */
export async function loadActivity(db: EventsDb | undefined, limit: number, now: number): Promise<ActivityData> {
	if (!db) return { events: null, stats: null, more: false };
	try {
		const [rows, stats] = await Promise.all([listEvents(db, { limit: limit + 1, type: "encrypt" }), eventStats(db, now)]);
		return { events: rows.slice(0, limit), stats, more: rows.length > limit };
	} catch (err) {
		console.error("failed to load activity", err);
		return { events: null, stats: null, more: false };
	}
}
