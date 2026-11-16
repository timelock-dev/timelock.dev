import { describe, expect, it } from "vitest";
import { apiEncrypt, getMessageJson, getStats, LIMITS, postMessage, postMessageOpened } from "../src/lib/api";
import { roundTime } from "../src/lib/drand";
import { isApiPath, messageHeaders } from "../src/lib/http";
import { HASH_ID, MESSAGE_ID, UUID_ID, messageId, sha256Hex } from "../src/lib/message-id";
import { getMessage } from "../src/lib/messages";
import { BEACON, makeDeps, postJson } from "./helpers";

const BEFORE = roundTime(BEACON.round) - 60_000;
const AFTER = roundTime(BEACON.round) + 60_000;
const origin = { Origin: "https://timelock.dev" };
const SECRET = "the secret plan";

type Hosted = { id: string; url: string; round: number; unlockAt: string; createdAt: string; sha256: string; openedAt: string | null };

async function block(deps: ReturnType<typeof makeDeps>["deps"], round = BEACON.round) {
	const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: SECRET, round }), deps);
	return ((await res.json()) as { ciphertext: string }).ciphertext;
}

async function host(deps: ReturnType<typeof makeDeps>["deps"], headers: Record<string, string> = origin) {
	const ciphertext = await block(deps);
	const res = await postMessage(postJson("/api/messages", { ciphertext }, headers), deps);
	expect(res.status).toBe(201);
	return { ciphertext, body: (await res.json()) as Hosted };
}

describe("POST /api/messages", () => {
	it("stores the block under the id derived from it and returns the link", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const { ciphertext, body } = await host(deps);
		expect(body.id).toMatch(HASH_ID);
		expect(body.id).toBe(await messageId(ciphertext));
		expect(body.url).toBe(`https://timelock.dev/m/${body.id}`);
		expect(body.round).toBe(BEACON.round);
		expect(body.unlockAt).toBe(new Date(roundTime(BEACON.round)).toISOString());
		expect(body.createdAt).toBe(new Date(BEFORE).toISOString());
		expect(body.sha256).toBe(await sha256Hex(ciphertext));
		expect(body.openedAt).toBeNull();
		expect(db.messages()).toEqual([
			{ id: body.id, ciphertext, sha256: body.sha256, round: BEACON.round, unlock_at: roundTime(BEACON.round), created_at: BEFORE, source: "web", opened_at: null, opens: 0, content_id: null },
		]);
	});

	it("never stores plain text: notes around the block are dropped", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await block(deps);
		const res = await postMessage(postJson("/api/messages", { ciphertext: `${SECRET}\nUnlock at https://timelock.dev\n\n${ciphertext}\n${SECRET}\n` }, origin), deps);
		expect(res.status).toBe(201);
		const stored = JSON.stringify(db.messages());
		expect(stored).not.toContain(SECRET);
		expect(stored).not.toContain("Unlock at");
		expect(db.messages()[0].ciphertext).toBe(ciphertext);
	});

	it("gives every encryption its own id, even of the same message", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const ids = new Set<string>();
		for (let i = 0; i < 5; i++) ids.add((await host(deps)).body.id);
		expect(ids.size).toBe(5);
	});

	it("keeps the id apart from the block's SHA-256, which people may post publicly", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const { body } = await host(deps);
		expect(body.sha256.startsWith(body.id)).toBe(false);
		expect(body.sha256).not.toContain(body.id);
	});

	it("returns the same id and link when the same block is sent again, without storing or counting it twice", async () => {
		const { deps, db, settle } = makeDeps({ now: () => BEFORE });
		const { ciphertext, body } = await host(deps);
		await settle();
		const events = db.rows().length;
		for (const headers of [origin, {}]) {
			const res = await postMessage(postJson("/api/messages", { ciphertext }, headers), deps);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(body);
		}
		expect(db.messages()).toHaveLength(1);
		expect(db.rows()).toHaveLength(events);
	});

	it("ignores notes, line endings, line lengths and stray whitespace when deriving the id", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const { ciphertext, body } = await host(deps);
		const lines = ciphertext.trim().split("\n");
		const base64 = lines.slice(1, -1).join("");
		const variants = [
			`Unlock at https://timelock.dev\nUnlocks: whenever\n\n${ciphertext}`,
			ciphertext.replace(/\n/g, "\r\n"),
			`\n\n   ${lines.join("  \n\n\t")}\n\n`,
			`${lines[0]}\n${base64.match(/.{1,40}/g)!.join("\n")}\n${lines.at(-1)}`,
			`${lines[0]}\n${base64}\n${lines.at(-1)}\n`,
		];
		for (const variant of variants) {
			const res = await postMessage(postJson("/api/messages", { ciphertext: variant }, origin), deps);
			expect(res.status).toBe(200);
			expect(((await res.json()) as Hosted).id).toBe(body.id);
		}
		expect(db.messages()).toHaveLength(1);
		expect(db.messages()[0].ciphertext).toBe(ciphertext);
	});

	it("stores a re-wrapped block in its canonical form, so the SHA-256 is of the standard file", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await block(deps);
		const lines = ciphertext.trim().split("\n");
		const rewrapped = `${lines[0]}\r\n${lines.slice(1, -1).join("").match(/.{1,48}/g)!.join("\r\n")}\r\n${lines.at(-1)}`;
		const res = await postMessage(postJson("/api/messages", { ciphertext: rewrapped }, origin), deps);
		expect(res.status).toBe(201);
		const body = (await res.json()) as Hosted;
		expect(db.messages()[0].ciphertext).toBe(ciphertext);
		expect(body.sha256).toBe(await sha256Hex(ciphertext));
		expect(body.id).toBe(await messageId(ciphertext));
	});

	it("still returns the link of a hosted block after it has unlocked", async () => {
		let now = BEFORE;
		const { deps, db } = makeDeps({ now: () => now });
		const { ciphertext, body } = await host(deps);
		now = AFTER;
		const res = await postMessage(postJson("/api/messages", { ciphertext }, origin), deps);
		expect(res.status).toBe(200);
		expect(((await res.json()) as Hosted).url).toBe(body.url);
		expect(db.messages()).toHaveLength(1);
	});

	it("counts a website upload as the encrypt event, and an API upload as none", async () => {
		const { deps, db, settle } = makeDeps({ now: () => BEFORE });
		const ciphertext = await block(deps);
		await settle();
		expect(db.rows()).toHaveLength(1); // the /api/encrypt call above
		await postMessage(postJson("/api/messages", { ciphertext }), deps);
		expect(db.rows()).toHaveLength(1);
		const second = await block(deps);
		await settle();
		expect(db.rows()).toHaveLength(2); // the second /api/encrypt call
		await postMessage(postJson("/api/messages", { ciphertext: second }, origin), deps);
		expect(db.rows()).toHaveLength(3);
		expect(db.rows()[2].type).toBe("encrypt");
		expect(db.rows()[2].source).toBe("web");
		expect(db.messages().map((m) => m.source).sort()).toEqual(["api", "web"]);
		expect(((await (await getStats({ db, now: () => BEFORE })).json()) as { encrypted: number }).encrypted).toBe(3);
	});

	it("rejects anything that isn't a locked quicknet block", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const good = await block(deps);
		const cases: [unknown, number, string][] = [
			[{}, 400, "invalid_request"],
			[{ ciphertext: "   " }, 400, "invalid_request"],
			[{ ciphertext: "just some text" }, 422, "invalid_ciphertext"],
			[{ ciphertext: "-----BEGIN AGE ENCRYPTED FILE-----\nnot base64 <script>\n-----END AGE ENCRYPTED FILE-----\n" }, 422, "invalid_ciphertext"],
			[{ ciphertext: `-----BEGIN AGE ENCRYPTED FILE-----\n${btoa("hello world, this is not age")}\n-----END AGE ENCRYPTED FILE-----\n` }, 422, "invalid_ciphertext"],
			[{ ciphertext: `${good}${good}` }, 422, "invalid_ciphertext"],
		];
		for (const [body, status, code] of cases) {
			const res = await postMessage(postJson("/api/messages", body, origin), deps);
			expect(res.status).toBe(status);
			expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
		}
		expect(db.messages()).toHaveLength(0);
	});

	it("rejects a block that has already unlocked", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await block(deps);
		const late = { ...deps, now: () => AFTER };
		const res = await postMessage(postJson("/api/messages", { ciphertext }, origin), late);
		expect(res.status).toBe(400);
		expect(db.messages()).toHaveLength(0);
	});

	it("rejects blocks over the size limit", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "x".repeat(LIMITS.hostedCiphertextBytes), round: BEACON.round }), deps);
		const { ciphertext } = (await res.json()) as { ciphertext: string };
		expect((await postMessage(postJson("/api/messages", { ciphertext }, origin), deps)).status).toBe(413);
		expect(db.messages()).toHaveLength(0);
	});

	it("applies the per-IP rate limit before reading the body", async () => {
		const keys: string[] = [];
		const { deps, db } = makeDeps({ now: () => BEFORE, limiter: { limit: async ({ key }) => (keys.push(key), { success: keys.length <= 1 }) } });
		const ciphertext = await block(deps);
		const send = () => postMessage(postJson("/api/messages", { ciphertext }, { ...origin, "CF-Connecting-IP": "203.0.113.7" }), deps);
		expect((await send()).status).toBe(201);
		const res = await send();
		expect(res.status).toBe(429);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
		expect(keys).toEqual(["203.0.113.7", "203.0.113.7"]);
		expect(db.messages()).toHaveLength(1);
		expect(JSON.stringify(db.messages())).not.toContain("203.0.113.7");
	});

	it("stops at the daily cap and starts again the next UTC day", async () => {
		let now = Date.UTC(2023, 8, 20, 12); // a week before the fixture round unlocks
		const { deps, db } = makeDeps({ now: () => now });
		const send = (ciphertext: string) => postMessage(postJson("/api/messages", { ciphertext }), deps);
		const [first, second] = [await block(deps), await block(deps)];
		await db.prepare("INSERT INTO daily_stats (day, hosted) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET hosted = excluded.hosted").bind(Math.floor(now / 86400_000), LIMITS.hostedPerDay - 1).run();
		expect((await send(first)).status).toBe(201);
		expect((await send(second)).status).toBe(429);
		expect(db.messages()).toHaveLength(1);
		// A block that is already hosted stores nothing new, so its link is still returned at the cap.
		expect((await send(first)).status).toBe(200);
		now += 86400_000;
		expect((await send(second)).status).toBe(201);
	});

	it("answers 503 when D1 isn't bound", async () => {
		expect((await postMessage(postJson("/api/messages", { ciphertext: "x" }, origin), { ...makeDeps().deps, db: undefined })).status).toBe(503);
	});
});

describe("GET /api/messages/:id", () => {
	const url = new URL("https://timelock.dev/api/messages/x");

	it("returns the stored block before and after the unlock time", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const { ciphertext, body } = await host(deps);
		const res = await getMessageJson(url, body.id, deps);
		expect(res.status).toBe(200);
		const got = (await res.json()) as Hosted & { ciphertext: string; network: string };
		expect(got.ciphertext).toBe(ciphertext);
		expect(got.id).toBe(body.id);
		expect(got.url).toBe(body.url);
		expect(got.sha256).toBe(body.sha256);
		expect(got.network).toBe("quicknet");
	});

	it("answers 404 for unknown, malformed and injected ids, without listing anything", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const { body } = await host(deps);
		for (const id of [undefined, "", "1", "%", "' OR 1=1 --", body.id.toUpperCase(), body.id.slice(0, 31), `${body.id}0`, `${body.id} `, body.sha256, "0".repeat(32), "00000000-0000-4000-8000-000000000000"]) {
			const res = await getMessageJson(url, id, deps);
			expect(res.status).toBe(404);
			expect(await res.text()).not.toContain("BEGIN AGE");
		}
		expect(await getMessage(deps.db!, "%")).toBeNull();
	});
});

describe("messages hosted under a random UUID, before ids were derived", () => {
	const url = new URL("https://timelock.dev/api/messages/x");
	const uuid = "3f0c1e9a-7b52-4d1c-9a35-0c6f1d2e8b74";

	async function old(deps: ReturnType<typeof makeDeps>["deps"], db: ReturnType<typeof makeDeps>["db"]) {
		const ciphertext = await block(deps);
		await db
			.prepare("INSERT INTO messages (id, ciphertext, sha256, round, unlock_at, created_at, source) VALUES (?, ?, ?, ?, ?, ?, 'web')")
			.bind(uuid, ciphertext, await sha256Hex(ciphertext), BEACON.round, roundTime(BEACON.round), BEFORE - 1000)
			.run();
		return ciphertext;
	}

	it("keeps both id formats valid", () => {
		expect(uuid).toMatch(UUID_ID);
		expect(uuid).toMatch(MESSAGE_ID);
		expect("0123456789abcdef0123456789abcdef").toMatch(MESSAGE_ID);
		for (const bad of ["0123456789abcdef0123456789abcde", "0123456789ABCDEF0123456789ABCDEF", `${uuid}0`, "g".repeat(32)]) expect(bad).not.toMatch(MESSAGE_ID);
	});

	it("still opens at its UUID link", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await old(deps, db);
		const got = (await (await getMessageJson(url, uuid, deps)).json()) as Hosted & { ciphertext: string };
		expect(got.id).toBe(uuid);
		expect(got.url).toBe(`https://timelock.dev/m/${uuid}`);
		expect(got.ciphertext).toBe(ciphertext);
	});

	it("is found from its encrypted text once it has been read, and keeps its UUID link", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await old(deps, db);
		const derived = await messageId(ciphertext);
		expect((await getMessageJson(url, derived, deps)).status).toBe(404);
		expect(db.messages()[0].content_id).toBeNull();

		await getMessage(db, uuid);
		expect(db.messages()[0].content_id).toBe(derived);
		const got = (await (await getMessageJson(url, derived, deps)).json()) as Hosted;
		expect(got.id).toBe(uuid);
		expect(got.url).toBe(`https://timelock.dev/m/${uuid}`);

		const again = await postMessage(postJson("/api/messages", { ciphertext }, origin), deps);
		expect(again.status).toBe(200);
		expect(((await again.json()) as Hosted).id).toBe(uuid);
		expect(db.messages()).toHaveLength(1);
	});

	it("prefers the message whose id is the derived id over an older copy of the same block", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await old(deps, db);
		const res = await postMessage(postJson("/api/messages", { ciphertext }, origin), deps);
		expect(res.status).toBe(201);
		const derived = ((await res.json()) as Hosted).id;
		await getMessage(db, uuid);
		expect((await getMessage(db, derived))?.id).toBe(derived);
		expect((await getMessage(db, uuid))?.id).toBe(uuid);
	});
});

describe("migration 0004", () => {
	it("adds the derived-id column to a database that already holds messages, without touching them", async () => {
		const { readFileSync } = await import("node:fs");
		const { DatabaseSync } = await import("node:sqlite");
		const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
		const db = new DatabaseSync(":memory:");
		for (const m of ["0001_events.sql", "0002_daily_stats.sql", "0003_messages.sql"]) db.exec(sql(m));
		db.prepare("INSERT INTO messages (id, ciphertext, sha256, round, unlock_at, created_at, source, opened_at, opens) VALUES (?, 'block', 'hash', 7, 8, 9, 'api', 10, 2)").run("3f0c1e9a-7b52-4d1c-9a35-0c6f1d2e8b74");
		const before = db.prepare("SELECT * FROM messages").all();
		db.exec(sql("0004_message_content_id.sql"));
		expect(db.prepare("SELECT * FROM messages").all()).toEqual(before.map((row) => ({ ...row, content_id: null })));
		expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'messages_content_id'").all()).toHaveLength(1);
	});
});

describe("POST /api/messages/:id/opened", () => {
	const opened = (id: string, headers: Record<string, string> = origin) => new Request(`https://timelock.dev/api/messages/${id}/opened`, { method: "POST", headers });

	it("records the first open, counts later ones and adds a decrypt event", async () => {
		let now = BEFORE;
		const { deps, db } = makeDeps({ now: () => now });
		const { body } = await host(deps);
		expect((await postMessageOpened(opened(body.id), body.id, deps)).status).toBe(425);
		expect(db.messages()[0].opens).toBe(0);

		now = AFTER;
		expect((await postMessageOpened(opened(body.id), body.id, deps)).status).toBe(204);
		now = AFTER + 5000;
		expect((await postMessageOpened(opened(body.id), body.id, deps)).status).toBe(204);
		expect(db.messages()[0].opened_at).toBe(AFTER);
		expect(db.messages()[0].opens).toBe(2);
		expect(db.rows().filter((r) => r.type === "decrypt")).toHaveLength(2);
		const got = (await (await getMessageJson(new URL("https://timelock.dev/x"), body.id, deps)).json()) as Hosted;
		expect(got.openedAt).toBe(new Date(AFTER).toISOString());
	});

	it("is same-origin only and 404s unknown ids", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const id = "00000000-0000-4000-8000-000000000000";
		expect((await postMessageOpened(opened(id, {}), id, deps)).status).toBe(403);
		expect((await postMessageOpened(opened(id, { Origin: "https://evil.example" }), id, deps)).status).toBe(403);
		expect((await postMessageOpened(opened(id), id, deps)).status).toBe(404);
	});
});

describe("message response headers", () => {
	it("lets message pages be indexed but never cached or sent as a referrer", () => {
		expect(messageHeaders("/m/abc")).toEqual({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" });
	});

	it("keeps the message JSON API out of search", () => {
		for (const path of ["/api/messages", "/api/messages/abc", "/api/messages/abc/opened"]) {
			expect(messageHeaders(path)).toEqual({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
		}
	});

	it("leaves every other path alone", () => {
		for (const path of ["/", "/m", "/faq", "/api/events", "/api/messages-list", "/how-it-works"]) expect(messageHeaders(path)).toBeNull();
		expect(isApiPath("/api/messages")).toBe(true);
	});
});
