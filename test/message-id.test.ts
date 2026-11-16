import { describe, expect, it } from "vitest";
import { HASH_ID, ID_DOMAIN, messageId, sha256Hex } from "../src/lib/message-id";
import { canonicalArmor, decrypt, encrypt, InvalidCiphertextError } from "../src/lib/tlock";
import { findMessagePage } from "../src/scripts/find-page";
import { shareLinkId } from "../src/scripts/handoff";
import { BEACON, fakeDrand } from "./helpers";
import { readFileSync } from "node:fs";

const { client } = fakeDrand();
const armored = await encrypt(new TextEncoder().encode("the secret plan"), BEACON.round, client);
const lines = armored.trim().split("\n");
const base64 = lines.slice(1, -1).join("");
const id = await messageId(armored);

describe("canonicalArmor", () => {
	it("leaves a block made by this site as it is", () => {
		expect(canonicalArmor(armored)).toBe(armored);
	});

	it("leaves a block made by the original Rust worker as it is", () => {
		const rust = readFileSync(new URL("./fixtures/rust-tlock-age-0.0.5.age", import.meta.url), "utf8");
		expect(canonicalArmor(rust)).toBe(rust);
	});

	it("gives one form for the same block however it is wrapped, indented or surrounded", () => {
		const variants = [
			`Unlock at https://timelock.dev\nUnlocks: Sat, Nov 21, 2026\n\n${armored}\nthanks!`,
			armored.replace(/\n/g, "\r\n"),
			armored.trimEnd(),
			lines.map((line) => `  ${line}\u00a0 `).join("\n\n"),
			`${lines[0]}\n${base64.match(/.{1,76}/g)!.join("\n")}\n${lines.at(-1)}\n`,
			`${lines[0]} ${base64} ${lines.at(-1)}`,
		];
		for (const variant of variants) expect(canonicalArmor(variant)).toBe(armored);
	});

	it("still decrypts after being put in canonical form", async () => {
		const mangled = `${lines[0]}\r\n${base64.match(/.{1,30}/g)!.join("\r\n \r\n")}\r\n${lines.at(-1)}`;
		const { plaintext } = await decrypt(canonicalArmor(mangled)!, client);
		expect(new TextDecoder().decode(plaintext)).toBe("the secret plan");
	});

	it("returns null without a base64 block and rejects two blocks", () => {
		expect(canonicalArmor("just some text")).toBeNull();
		expect(canonicalArmor("")).toBeNull();
		expect(canonicalArmor(`${lines[0]}\n${lines.at(-1)}\n`)).toBeNull();
		expect(canonicalArmor(`${lines[0]}\nnot base64 <script>\n${lines.at(-1)}\n`)).toBeNull();
		expect(canonicalArmor(`${lines[0]}\n${base64.slice(0, -1)}\n${lines.at(-1)}\n`)).toBeNull();
		expect(() => canonicalArmor(`${armored}${armored}`)).toThrow(InvalidCiphertextError);
	});
});

describe("messageId", () => {
	it("is 128 bits of a domain-separated SHA-256 of the block, in hex", async () => {
		const id = await messageId(armored);
		expect(id).toMatch(HASH_ID);
		expect(id).toHaveLength(32);
		expect(id).toBe((await sha256Hex(`timelock.dev message id v1\n${armored}`)).slice(0, 32));
		expect(ID_DOMAIN).toBe("timelock.dev message id v1\n");
	});

	it("is the same every time and differs between blocks", async () => {
		const other = await encrypt(new TextEncoder().encode("the secret plan"), BEACON.round, client);
		expect(await messageId(armored)).toBe(await messageId(armored));
		expect(await messageId(other)).not.toBe(await messageId(armored));
	});

	it("cannot be read off the block's plain SHA-256", async () => {
		expect((await sha256Hex(armored)).slice(0, 32)).not.toBe(await messageId(armored));
	});
});

describe("findMessagePage", () => {
	const calls: string[] = [];
	const server = (respond: (path: string) => Response | Promise<Response>) =>
		(async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return respond(String(input));
		}) as typeof fetch;
	const hosted = (stored: { id: string; ciphertext: string }) => server((path) => (path === `/api/messages/${id}` ? Response.json(stored) : new Response("{}", { status: 404 })));

	it("finds the page of a hosted block, asking the server by derived id only", async () => {
		calls.length = 0;
		expect(await findMessagePage(armored, hosted({ id, ciphertext: armored }))).toBe(`/m/${id}`);
		expect(calls).toEqual([`/api/messages/${id}`]);
		expect(calls.join()).not.toContain("BEGIN AGE");
	});

	it("finds it through notes and odd whitespace", async () => {
		const pasted = `Unlock at https://timelock.dev\n\n${armored.replace(/\n/g, " \r\n")}`;
		expect(await findMessagePage(pasted, hosted({ id, ciphertext: armored }))).toBe(`/m/${id}`);
	});

	it("goes to the UUID page of a message hosted before ids were derived", async () => {
		const uuid = "3f0c1e9a-7b52-4d1c-9a35-0c6f1d2e8b74";
		expect(await findMessagePage(armored, hosted({ id: uuid, ciphertext: armored }))).toBe(`/m/${uuid}`);
	});

	it("returns null when nothing is hosted, so Decrypt carries on in place", async () => {
		expect(await findMessagePage(armored, server(() => new Response("{}", { status: 404 })))).toBeNull();
	});

	it("returns null when the server is down or answers nonsense", async () => {
		expect(
			await findMessagePage(
				armored,
				server(() => {
					throw new TypeError("network down");
				}),
			),
		).toBeNull();
		expect(await findMessagePage(armored, server(() => new Response("oops", { status: 500 })))).toBeNull();
		expect(await findMessagePage(armored, server(() => new Response("not json")))).toBeNull();
		expect(await findMessagePage(armored, hosted({ id: "../../evil", ciphertext: armored }))).toBeNull();
	});

	it("does not follow an answer that holds a different block", async () => {
		const other = await encrypt(new TextEncoder().encode("something else"), BEACON.round, client);
		expect(await findMessagePage(armored, hosted({ id, ciphertext: other }))).toBeNull();
	});

	it("asks nothing for text that is not an armored block", async () => {
		calls.length = 0;
		expect(await findMessagePage("hello", hosted({ id, ciphertext: armored }))).toBeNull();
		expect(await findMessagePage(`${armored}${armored}`, hosted({ id, ciphertext: armored }))).toBeNull();
		expect(calls).toEqual([]);
	});
});

describe("shareLinkId with derived ids", () => {
	it("reads both id formats from a pasted link", () => {
		expect(shareLinkId(`https://timelock.dev/m/${id}`)).toBe(id);
		expect(shareLinkId(`/m/${id.toUpperCase()}/`)).toBe(id);
		expect(shareLinkId("https://timelock.dev/m/3f0c1e9a-7b52-4d1c-9a35-0c6f1d2e8b74")).toBe("3f0c1e9a-7b52-4d1c-9a35-0c6f1d2e8b74");
	});

	it("ignores ids of the wrong shape", () => {
		expect(shareLinkId(`/m/${"a".repeat(31)}`)).toBeNull();
		expect(shareLinkId(`/m/${"a".repeat(33)}`)).toBeNull();
		expect(shareLinkId(`/m/${"-".repeat(36)}`)).toBeNull();
	});
});
