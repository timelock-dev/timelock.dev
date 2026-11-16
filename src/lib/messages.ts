import { recordEvent, type EventsDb, type EventSource } from "./events";
import { HASH_ID, MESSAGE_ID, UUID_ID, messageId, sha256Hex } from "./message-id";
import { canonicalArmor } from "./tlock";

export { MESSAGE_ID, sha256Hex };

const DAY_MS = 86400_000;

export interface StoredMessage {
	/** Derived from the encrypted text (see `messageId`), or a random UUID for messages hosted before that. */
	id: string;
	/** Armored age block only. Never plaintext, never notes. */
	ciphertext: string;
	sha256: string;
	round: number;
	unlockAt: number;
	createdAt: number;
	openedAt: number | null;
}

interface Row {
	id: string;
	ciphertext: string;
	sha256: string;
	round: number;
	unlock_at: number;
	created_at: number;
	opened_at: number | null;
	content_id: string | null;
}

const COLUMNS = "id, ciphertext, sha256, round, unlock_at, created_at, opened_at, content_id";

const toMessage = (r: Row): StoredMessage => ({
	id: r.id,
	ciphertext: r.ciphertext,
	sha256: r.sha256,
	round: Number(r.round),
	unlockAt: Number(r.unlock_at),
	createdAt: Number(r.created_at),
	openedAt: r.opened_at === null ? null : Number(r.opened_at),
});

export class DailyLimitError extends Error {}

/**
 * Stores a canonical armored block under the id derived from it. The caller has already validated `ciphertext`.
 * A block that is already stored is not stored again: its existing message comes back with `created: false`.
 * Website uploads also count as the encryption event for recent activity (`recordEncrypt`).
 */
export async function createMessage(
	db: EventsDb,
	m: { ciphertext: string; round: number; unlockAt: number; source: EventSource; createdAt: number; dailyLimit: number; recordEncrypt: boolean },
): Promise<{ message: StoredMessage; created: boolean }> {
	const id = await messageId(m.ciphertext);
	const day = Math.floor(m.createdAt / DAY_MS);
	const { results } = await db.prepare("SELECT hosted FROM daily_stats WHERE day = ?").bind(day).all<{ hosted: number }>();
	if (Number(results[0]?.hosted ?? 0) >= m.dailyLimit) throw new DailyLimitError();

	const sha256 = await sha256Hex(m.ciphertext);
	const inserted = await db
		.prepare("INSERT INTO messages (id, ciphertext, sha256, round, unlock_at, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING RETURNING id")
		.bind(id, m.ciphertext, sha256, m.round, m.unlockAt, m.createdAt, m.source)
		.all<{ id: string }>();
	if (!inserted.results.length) {
		// This block is already stored: callers look first, so this is the same block arriving twice at once.
		const existing = await getMessage(db, id);
		if (existing) return { message: existing, created: false };
		throw new Error("failed to store the message");
	}
	await db
		.prepare("INSERT INTO daily_stats (day, hosted) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET hosted = hosted + 1")
		.bind(day)
		.run();
	if (m.recordEncrypt) await recordEvent(db, { type: "encrypt", source: m.source, round: m.round, unlockAt: m.unlockAt, createdAt: m.createdAt });
	return { message: { id, ciphertext: m.ciphertext, sha256, round: m.round, unlockAt: m.unlockAt, createdAt: m.createdAt, openedAt: null }, created: true };
}

async function firstRow(db: EventsDb, where: string, value: string): Promise<Row | null> {
	const { results } = await db.prepare(`SELECT ${COLUMNS} FROM messages WHERE ${where}`).bind(value).all<Row>();
	return results[0] ?? null;
}

/**
 * Records the derived id of a message hosted under a random UUID, so it is found from its encrypted text from now on.
 * The migration could not do this (SQLite has no SHA-256), so it happens the first time such a message is read.
 */
async function rememberContentId(db: EventsDb, row: Row): Promise<void> {
	try {
		const block = canonicalArmor(row.ciphertext);
		if (!block) return;
		await db.prepare("UPDATE messages SET content_id = ? WHERE id = ? AND content_id IS NULL").bind(await messageId(block), row.id).run();
	} catch (err) {
		console.error("failed to record a message's derived id", err);
	}
}

/**
 * One message by its id. A derived id also finds a message hosted earlier under a random UUID, once its derived id
 * has been recorded. There is deliberately no query that lists messages.
 */
export async function getMessage(db: EventsDb, id: string): Promise<StoredMessage | null> {
	if (!MESSAGE_ID.test(id)) return null;
	let row = await firstRow(db, "id = ?", id);
	if (!row && HASH_ID.test(id)) row = await firstRow(db, "content_id = ? ORDER BY created_at, id LIMIT 1", id);
	if (!row) return null;
	if (row.content_id === null && UUID_ID.test(row.id)) await rememberContentId(db, row);
	return toMessage(row);
}

/** A browser finished decrypting this message. Counts it and records the decrypt event, which is counted in the stats. */
export async function markOpened(db: EventsDb, message: StoredMessage, now: number): Promise<void> {
	await db.prepare("UPDATE messages SET opens = opens + 1, opened_at = COALESCE(opened_at, ?) WHERE id = ?").bind(now, message.id).run();
	await recordEvent(db, { type: "decrypt", source: "web", round: message.round, unlockAt: message.unlockAt, createdAt: now });
}
