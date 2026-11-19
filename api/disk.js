const DISK_URL =
	"https://github.com/leaningtech/webvm/releases/download/ext2_image/debian_mini_20230519_5022088024.ext2";

export default async function handler(req, res) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Headers", "Range");
	res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
	res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified");
	res.setHeader("Accept-Ranges", "bytes");

	if (req.method === "OPTIONS") {
		res.statusCode = 204;
		res.end();
		return;
	}

	if (req.method !== "GET" && req.method !== "HEAD") {
		res.setHeader("Allow", "GET, HEAD, OPTIONS");
		res.statusCode = 405;
		res.end();
		return;
	}

	const headers = {};
	if (req.headers.range) {
		headers.Range = req.headers.range;
	}

	let upstream;
	try {
		upstream = await fetch(DISK_URL, { method: req.method, headers, redirect: "follow" });
	} catch (error) {
		console.error("Failed to fetch disk image:", error);
		res.statusCode = 502;
		res.setHeader("Content-Type", "text/plain");
		res.end("Failed to fetch disk image");
		return;
	}

	const status = upstream.status === 206 ? 206 : upstream.status === 200 ? 200 : upstream.status;
	res.statusCode = status;
	res.setHeader("Content-Type", "application/octet-stream");

	const contentRange = upstream.headers.get("content-range");
	if (contentRange) {
		res.setHeader("Content-Range", contentRange);
	}

	const contentLength = upstream.headers.get("content-length");
	if (contentLength) {
		res.setHeader("Content-Length", contentLength);
	}

	const etag = upstream.headers.get("etag");
	res.setHeader("ETag", etag || '"debian-mini-ext2-v1"');

	const lastModified = upstream.headers.get("last-modified");
	res.setHeader("Last-Modified", lastModified || "Fri, 19 May 2023 00:00:00 GMT");

	if (req.method === "HEAD") {
		res.end();
		return;
	}

	if (!upstream.body) {
		res.end();
		return;
	}

	for await (const chunk of upstream.body) {
		if (!res.write(chunk)) {
			await new Promise((resolve) => res.once("drain", resolve));
		}
	}
	res.end();
}
