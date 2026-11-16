// Checks the routes that share an address or moved when Decrypt got its own page.
// Usage: node scripts/check-routes.mjs [base URL], against a running `npm run preview`.
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:4328";
const fixture = readFileSync(new URL("../test/fixtures/rust-tlock-age-0.0.5.age", import.meta.url));

let failures = 0;
function check(name, ok, detail = "") {
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
}
const type = (res) => res.headers.get("Content-Type") ?? "";

{
	const res = await fetch(new URL("/decrypt", base), { redirect: "manual" });
	const html = await res.text();
	check("GET /decrypt is the Decrypt page", res.status === 200 && type(res).startsWith("text/html"), `${res.status} ${type(res)}`);
	check("the Decrypt page has the form", html.includes('id="decrypt-form"') && html.includes('id="decrypt-input"'));
	check("the Decrypt page marks itself as current in the nav", /<a href="\/decrypt" aria-current="page"/.test(html));
}
{
	const res = await fetch(new URL("/decrypt", base), { method: "POST", body: "garbage" });
	check("POST /decrypt with garbage answers 422 in plain text", res.status === 422 && type(res).startsWith("text/plain"), `${res.status} ${type(res)}`);
	check("POST /decrypt allows cross-origin callers", res.headers.get("Access-Control-Allow-Origin") === "*");
}
{
	const res = await fetch(new URL("/decrypt", base), { method: "POST", body: fixture });
	const body = new Uint8Array(await res.arrayBuffer());
	check("POST /decrypt returns the message as raw bytes", res.status === 200 && type(res) === "application/octet-stream" && body.byteLength > 0, `${res.status} ${type(res)}`);
}
{
	const res = await fetch(new URL("/decrypt", base), { method: "PUT", body: "garbage" });
	check("other methods on /decrypt answer 405", res.status === 405, `${res.status}`);
}
{
	const res = await fetch(new URL("/", base));
	const html = await res.text();
	check("the homepage links to the Decrypt page", html.includes('<a href="/decrypt">'));
	check("the homepage forwards the old #decrypt anchor", html.includes('location.hash === "#decrypt"') && html.includes('location.replace("/decrypt")'));
	check("the homepage no longer contains the decrypt form", !html.includes('id="decrypt-form"'));
	check("the homepage keeps the #encrypt and #activity anchors", html.includes('id="encrypt"') && html.includes('id="activity"'));
}
{
	const res = await fetch(new URL("/m/00000000-0000-4000-8000-000000000000", base));
	check("an unknown share link answers 404 and is never cached", res.status === 404 && res.headers.get("Cache-Control") === "no-store", `${res.status}`);
}

if (failures) {
	console.error(`${failures} route check(s) failed.`);
	process.exit(1);
}
console.log("All route checks passed.");
