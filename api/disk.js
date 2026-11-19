import { Readable } from "node:stream";

const RELEASE_API_URL =
	"https://api.github.com/repos/killercats1/webvm/releases/tags/ext2_image";
const FALLBACK_DISK_URL = "https://github.com";

let cachedDiskUrl;
let cachedDiskUrlExpiresAt = 0;

async function resolveDiskUrl() {
	if (cachedDiskUrl && Date.now() < cachedDiskUrlExpiresAt) {
		return cachedDiskUrl;
	}

	try {
		const release = await fetch(RELEASE_API_URL, {
			headers: {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "webvm-proxy"
			},
			redirect: "follow"
		});

		if (release.ok) {
			const data = await release.json();
			const assets = Array.isArray(data.assets) ? data.assets : [];
			const diskAsset = assets.find((asset) =>
				typeof asset.name === "string" &&
				asset.name.toLowerCase().endsWith(".ext2") &&
				typeof asset.browser_download_url === "string"
			);

			if (diskAsset) {
				cachedDiskUrl = diskAsset.browser_download_url;
				cachedDiskUrlExpiresAt = Date.now() + 5 * 60 * 1000;
				return cachedDiskUrl;
			}
		} else {
			console.error("GitHub release lookup returned an error", {
				status: release.status,
				url: RELEASE_API_URL
			});
		}
	} catch (error) {
		console.error("GitHub release lookup failed", {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			url: RELEASE_API_URL
		});
	}

	cachedDiskUrl = FALLBACK_DISK_URL;
	cachedDiskUrlExpiresAt = Date.now() + 5 * 60 * 1000;
	return cachedDiskUrl;
}

function getHeader(headers, name) {
	if (!headers) return null;
	if (typeof headers.get === "function") {
		return headers.get(name);
	}
	const lowerName = name.toLowerCase();
	const key = Object.keys(headers).find(
		(candidate) => candidate.toLowerCase() === lowerName
	);
	return key ? headers[key] : null;
}

function parseRange(range, size) {
	if (!range || !/^bytes=/.test(range) || !Number.isFinite(size) || size < 0) {
		return null;
	}

	const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
	if (!match) return null;

	let start;
	let end;
	if (match[1] === "") {
		const suffixLength = Number(match[2]);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
		start = Math.max(size - suffixLength, 0);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] === "" ? size - 1 : Number(match[2]);
	}

	if (!Number.isInteger(start) || !Number.isInteger(end) ||
		start < 0 || end < start || start >= size) {
		return null;
	}
	end = Math.min(end, size - 1);
	return { start, end };
}

function sendError(res, status, message) {
	if (res.headersSent) {
		res.destroy();
		return;
	}
	res.statusCode = status;
	res.setHeader("Content-Type", "text/plain");
	res.end(message);
}

export default async function handler(req, res) {
	try {
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

		const upstreamHeaders = {};
		if (req.headers.range) {
			upstreamHeaders.Range = req.headers.range;
		}

		const diskUrl = await resolveDiskUrl();
		const upstream = await fetch(diskUrl, {
			method: req.method,
			headers: upstreamHeaders,
			redirect: "follow"
		});

		if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416) {
			throw new Error(
				`Disk asset fetch failed: ${upstream.status}${upstream.statusText ? ` ${upstream.statusText}` : ""}`
			);
		}

		if (upstream.status === 416) {
			const contentRange = getHeader(upstream.headers, "content-range");
			res.statusCode = 416;
			res.setHeader("Content-Type", "application/octet-stream");
			if (contentRange) res.setHeader("Content-Range", contentRange);
			res.end();
			return;
		}

		let status = upstream.status === 206 ? 206 : 200;
		let contentLength = getHeader(upstream.headers, "content-length");
		let contentRange = getHeader(upstream.headers, "content-range");

		if (req.headers.range) {
			if (upstream.status === 206) {
				status = 206;
			} else if (contentLength) {
				const size = Number(contentLength);
				const range = parseRange(req.headers.range, size);
				if (range) {
					status = 206;
					contentLength = String(range.end - range.start + 1);
					contentRange = `bytes ${range.start}-${range.end}/${size}`;
				}
			}
		}

		res.statusCode = status;
		res.setHeader("Content-Type", "application/octet-stream");
		if (contentRange) res.setHeader("Content-Range", contentRange);
		if (contentLength) res.setHeader("Content-Length", contentLength);

		const etag = getHeader(upstream.headers, "etag");
		res.setHeader("ETag", etag || '"debian-mini-ext2-v1"');

		const lastModified = getHeader(upstream.headers, "last-modified");
		res.setHeader("Last-Modified", lastModified || "Fri, 19 May 2023 00:00:00 GMT");

		if (req.method === "HEAD") {
			res.end();
			return;
		}

		if (!upstream.body) {
			res.end();
			return;
		}

		if (req.headers.range && status === 206 && upstream.status === 200) {
			const size = Number(getHeader(upstream.headers, "content-length"));
			const range = parseRange(req.headers.range, size);
			if (range && typeof upstream.arrayBuffer === "function") {
				const wholeBuffer = Buffer.from(await upstream.arrayBuffer());
				const rangeBuffer = wholeBuffer.subarray(range.start, range.end + 1);
				res.end(rangeBuffer);
				return;
			}
		}

		const nodeStream = Readable.fromWeb(upstream.body);
		nodeStream.once("error", (error) => {
			console.error("Disk image stream failed", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				url: diskUrl
			});
			if (!res.headersSent) {
				sendError(res, 502, "Failed to stream disk image");
			} else {
				res.destroy(error);
			}
		});
		nodeStream.pipe(res);

	} catch (error) {
		const details = error instanceof Error
			? { message: error.message, stack: error.stack }
			: { message: String(error) };
		console.error("Disk proxy handler failed", details);
		if (!res.headersSent) {
			sendError(res, 502, "Failed to fetch disk image");
		}
	}
}
