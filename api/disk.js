import { Readable } from "node:stream";

const DEBIAN_DISK_URL =
	"https://github.com/leaningtech/webvm/releases/download/ext2_image/debian_mini_20230519_5022088024.ext2";
const ALPINE_DISK_URL =
	"https://github.com/leaningtech/alpine-image/releases/download/ext2_image/alpine_20251007.ext2";

async function resolveDiskUrl(req) {
	return getHeader(req.query, "image") === "alpine"
		? ALPINE_DISK_URL
		: DEBIAN_DISK_URL;
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

function parseContentRange(contentRange) {
	if (!contentRange) return null;
	const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange.trim());
	if (!match) return null;
	return {
		start: Number(match[1]),
		end: Number(match[2]),
		size: match[3] === "*" ? null : Number(match[3])
	};
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
		const requestRange = getHeader(req.headers, "range");
		if (req.method === "GET" && requestRange) {
			upstreamHeaders.Range = requestRange;
		}

		const diskUrl = await resolveDiskUrl(req);
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
			res.setHeader("Accept-Ranges", "bytes");
			res.end();
			return;
		}

		let status = 200;
		let contentLength = getHeader(upstream.headers, "content-length");
		let contentRange = getHeader(upstream.headers, "content-range");

		if (req.method === "HEAD") {
			status = 200;
		} else if (requestRange) {
			if (upstream.status !== 206) {
				throw new Error(
					`Range request was not honored by disk asset: upstream status ${upstream.status}`
				);
			}
			status = 206;

			const parsedContentRange = parseContentRange(contentRange);
			if (!parsedContentRange) {
				throw new Error("Disk asset returned 206 without a valid Content-Range");
			}
			if (parsedContentRange.size !== null) {
				const requestedRange = parseRange(requestRange, parsedContentRange.size);
				if (!requestedRange ||
					requestedRange.start !== parsedContentRange.start ||
					requestedRange.end !== parsedContentRange.end) {
					throw new Error("Disk asset returned a mismatched 206 Content-Range");
				}
			}
			if (!contentLength) {
				contentLength = String(parsedContentRange.end - parsedContentRange.start + 1);
			}
			const expectedLength =
				parsedContentRange.end - parsedContentRange.start + 1;
			if (Number(contentLength) !== expectedLength) {
				throw new Error("Disk asset returned mismatched 206 Content-Length");
			}
		}

		if (req.method === "HEAD" && !contentLength) {
			const sizeProbe = await fetch(diskUrl, {
				method: "GET",
				headers: { Range: "bytes=0-0" },
				redirect: "follow"
			});
			if (sizeProbe.status === 206) {
				const sizeRange = parseContentRange(
					getHeader(sizeProbe.headers, "content-range")
				);
				if (sizeRange && sizeRange.size !== null) {
					contentLength = String(sizeRange.size);
				}
				await sizeProbe.arrayBuffer();
			}
		}

		if (req.method === "GET" && !requestRange && !contentLength) {
			const sizeProbe = await fetch(diskUrl, {
				method: "GET",
				headers: { Range: "bytes=0-0" },
				redirect: "follow"
			});
			if (sizeProbe.status === 206) {
				const sizeRange = parseContentRange(
					getHeader(sizeProbe.headers, "content-range")
				);
				if (sizeRange && sizeRange.size !== null) {
					contentLength = String(sizeRange.size);
				}
				if (!sizeProbe.bodyUsed) await sizeProbe.arrayBuffer();
			}
		}

		res.statusCode = status;
		res.setHeader("Content-Type", "application/octet-stream");
		if (contentRange) res.setHeader("Content-Range", contentRange);
		if (contentLength) res.setHeader("Content-Length", contentLength);

		const etag = getHeader(upstream.headers, "etag");
		res.setHeader(
			"ETag",
			etag || (diskUrl === ALPINE_DISK_URL
				? '"alpine-ext2-v1"'
				: '"debian-mini-ext2-v1"')
		);

		const lastModified = getHeader(upstream.headers, "last-modified");
		res.setHeader(
			"Last-Modified",
			lastModified || (diskUrl === ALPINE_DISK_URL
				? "Fri, 07 Oct 2025 00:00:00 GMT"
				: "Fri, 19 May 2023 00:00:00 GMT")
		);

		if (req.method === "HEAD") {
			res.end();
			return;
		}

		if (!upstream.body) {
			res.end();
			return;
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
