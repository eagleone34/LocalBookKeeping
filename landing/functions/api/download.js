/**
 * Cloudflare Pages Function: GET /api/download?token=...
 *
 * Validates a signed download token, enforces a per-session download cap,
 * then redirects to the installer on GitHub Releases.
 *
 * Environment variables:
 *   HMAC_SECRET  – same secret used to sign tokens
 *
 * KV namespace binding:
 *   DOWNLOADS    – tracks download counts per session_id
 */

const DOWNLOAD_URL =
  "https://github.com/eagleone34/LocalBookKeeping/releases/latest/download/LocalBooks_Setup.exe";

const MAX_DOWNLOADS_PER_SESSION = 5;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return errorPage("Missing download token.", 400);
    }

    // Verify signature and decode payload
    const payload = await verifyToken(token, context.env.HMAC_SECRET);

    if (!payload) {
      return errorPage(
        "Invalid or corrupted download link. Please return to your purchase confirmation page and try again.",
        403
      );
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) {
      return errorPage(
        "This download link has expired (24-hour limit). Please contact support@llmboost.ca for a new link.",
        410
      );
    }

    // Rate-limit: max downloads per session_id
    if (context.env.DOWNLOADS) {
      const key = `dl:${payload.sid}`;
      const count = parseInt((await context.env.DOWNLOADS.get(key)) || "0", 10);

      if (count >= MAX_DOWNLOADS_PER_SESSION) {
        return errorPage(
          "Download limit reached for this purchase. Please contact support@llmboost.ca if you need another download.",
          429
        );
      }

      await context.env.DOWNLOADS.put(key, String(count + 1), {
        expirationTtl: 86400, // auto-clean after 24 hours
      });
    }

    // Redirect to the actual installer
    return Response.redirect(DOWNLOAD_URL, 302);
  } catch (err) {
    return errorPage("Something went wrong. Please contact support@llmboost.ca.", 500);
  }
}

// --- Helpers ---

async function verifyToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [data, sigB64] = parts;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(data)
  );

  if (!valid) return null;

  try {
    return JSON.parse(atob(data));
  } catch {
    return null;
  }
}

function errorPage(message, status) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Download Error — LocalBooks</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md text-center">
    <div class="text-5xl mb-4">&#9888;&#65039;</div>
    <h1 class="text-xl font-semibold text-gray-900 mb-2">Download Unavailable</h1>
    <p class="text-gray-600 mb-6">${message}</p>
    <a href="https://llmboost.ca" class="text-blue-600 hover:underline">Back to LocalBooks</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
