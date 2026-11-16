const KEY = "timelock:decrypt";

/** Where encrypted text is entered to be decrypted. */
export const DECRYPT_PATH = "/decrypt";

/**
 * Carries encrypted text from the encrypt result to the Decrypt page. It waits in this tab's session storage and is
 * never sent anywhere. If storage is blocked, the Decrypt page just opens empty.
 */
export function handOffToDecrypt(text: string, go: (path: string) => void = (path) => location.assign(path), storage?: Storage): void {
	try {
		(storage ?? sessionStorage).setItem(KEY, text);
	} catch {
		/* storage blocked */
	}
	go(DECRYPT_PATH);
}

/** The text handed off by `handOffToDecrypt`, once. */
export function takeHandOff(storage?: Storage): string | null {
	try {
		const store = storage ?? sessionStorage;
		const text = store.getItem(KEY);
		store.removeItem(KEY);
		return text || null;
	} catch {
		return null;
	}
}

/** The id in a pasted share link ("https://timelock.dev/m/<id>" or "/m/<id>"), or null if the text is anything else. */
export function shareLinkId(text: string): string | null {
	const link = /^(?:https?:\/\/[^\s/]+)?\/m\/([0-9a-f-]{36})\/?$/i.exec(text.trim());
	return link ? link[1].toLowerCase() : null;
}
