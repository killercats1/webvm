const RELEASE_API_URL =
	"https://api.github.com/repos/killercats1/webvm/releases/tags/ext2_image";

let cachedDiskUrl;
let cachedDiskUrlExpiresAt = 0;

async function resolveDiskUrl() {
	if (cachedDiskUrl && Date.now() < cachedDiskUrlExpiresAt) {
		return cachedDiskUrl;
	}

	const release = await fetch(RELEASE_API_URL, {
		headers: {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "webvm-disk-proxy"
		},
		redirect: "follow"
	});
	if (!release.ok) {
		throw new Error(`Failed to resolve GitHub release: ${release.status}`);
	}

	const data = await release.json();
	const assets = Array.isArray(data.assets) ? data.assets : [];
	const diskAsset = [...assets]
		.reverse()
		.find((asset) =>
			typeof asset.name === "string" &&
			asset.name.endsWith(".ext2") &&
			typeof asset.browser_download_url === "string"
		);

	if (!diskAsset) {
		throw new Error("No .ext2 asset found in the ext2_image release");
	}

	cachedDiskUrl = diskAsset.browser_download_url;
	cachedDiskUrlExpiresAt = Date.now() + 5 * 60 * 1000;
	return cachedDiskUrl;
}

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
		const diskUrl = await resolveDiskUrl();
		upstream = await fetch(diskUrl, { method: req.method, headers, redirect: "follow" });
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
