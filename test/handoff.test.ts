import { describe, expect, it } from "vitest";
import { DECRYPT_PATH, handOffToDecrypt, shareLinkId, takeHandOff } from "../src/scripts/handoff";

function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k),
		clear: () => data.clear(),
		key: (i) => [...data.keys()][i] ?? null,
		get length() {
			return data.size;
		},
	};
}

const blocked = new Proxy({} as Storage, {
	get: () => () => {
		throw new DOMException("storage is blocked", "SecurityError");
	},
});

const BLOCK = "-----BEGIN AGE ENCRYPTED FILE-----\nAAA\n-----END AGE ENCRYPTED FILE-----\n";

describe("handing encrypted text to the Decrypt page", () => {
	it("opens /decrypt, where the text is waiting", () => {
		const storage = memoryStorage();
		const visited: string[] = [];
		handOffToDecrypt(BLOCK, (path) => visited.push(path), storage);
		expect(visited).toEqual(["/decrypt"]);
		expect(DECRYPT_PATH).toBe("/decrypt");
		expect(takeHandOff(storage)).toBe(BLOCK);
	});

	it("delivers the text once, so a later visit to Decrypt starts empty", () => {
		const storage = memoryStorage();
		handOffToDecrypt(BLOCK, () => {}, storage);
		takeHandOff(storage);
		expect(takeHandOff(storage)).toBeNull();
		expect(storage.length).toBe(0);
	});

	it("has nothing to deliver on a plain visit", () => {
		expect(takeHandOff(memoryStorage())).toBeNull();
	});

	it("still opens Decrypt when storage is blocked", () => {
		const visited: string[] = [];
		handOffToDecrypt(BLOCK, (path) => visited.push(path), blocked);
		expect(visited).toEqual(["/decrypt"]);
		expect(takeHandOff(blocked)).toBeNull();
	});
});

describe("shareLinkId", () => {
	const id = "664122ae-2a88-444a-9474-913ab68f4256";

	it("finds the id in a pasted share link", () => {
		expect(shareLinkId(`https://timelock.dev/m/${id}`)).toBe(id);
		expect(shareLinkId(`  http://localhost:4327/m/${id.toUpperCase()}/\n`)).toBe(id);
		expect(shareLinkId(`/m/${id}`)).toBe(id);
	});

	it("ignores encrypted text and other links", () => {
		expect(shareLinkId(BLOCK)).toBeNull();
		expect(shareLinkId("https://timelock.dev/decrypt")).toBeNull();
		expect(shareLinkId(`see https://timelock.dev/m/${id}`)).toBeNull();
		expect(shareLinkId("")).toBeNull();
	});
});
