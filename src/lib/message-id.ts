/** Ids of hosted messages (/m/<id>). Shared by the server and the browser. */

/** Lowercase UUID v4. Messages hosted before ids were derived from the encrypted text have one. */
export const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 128 bits as 32 lowercase hex digits. See `messageId`. */
export const HASH_ID = /^[0-9a-f]{32}$/;

export const MESSAGE_ID = new RegExp(`${UUID_ID.source}|${HASH_ID.source}`);

/**
 * Hashed in front of the block, so the id is not a prefix of the block's plain SHA-256. People are told they can post
 * that SHA-256 publicly to prove a date, and it must not lead anyone to the message's page.
 */
export const ID_DOMAIN = "timelock.dev message id v1\n";

export async function sha256Hex(text: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The id of a hosted message: the first 128 bits of SHA-256(ID_DOMAIN + block), in hex. `block` must be canonical
 * (see `canonicalArmor`), so the same encrypted text gives the same id however it was wrapped or pasted.
 * Only someone who holds the encrypted text can compute it, and it never involves the message itself.
 */
export async function messageId(block: string): Promise<string> {
	return (await sha256Hex(ID_DOMAIN + block)).slice(0, 32);
}
