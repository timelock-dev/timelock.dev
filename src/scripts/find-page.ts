import { MESSAGE_ID, messageId } from "../lib/message-id";
import { canonicalArmor } from "../lib/tlock";

/**
 * The page of the hosted message that holds exactly this encrypted block ("/m/<id>"), or null if there isn't one.
 * The server is sent only the id derived from the block, never the text. Any failure counts as "no page", so the
 * caller can carry on and decrypt in place.
 */
export async function findMessagePage(text: string, fetcher: typeof fetch = fetch): Promise<string | null> {
	try {
		const block = canonicalArmor(text);
		if (!block) return null;
		const res = await fetcher(`/api/messages/${await messageId(block)}`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		const found = (await res.json()) as { id?: unknown; ciphertext?: unknown };
		if (typeof found.id !== "string" || !MESSAGE_ID.test(found.id)) return null;
		// Compare the whole block, not just the id, before sending the reader to another page.
		if (typeof found.ciphertext !== "string" || canonicalArmor(found.ciphertext) !== block) return null;
		return `/m/${found.id}`;
	} catch {
		return null;
	}
}
