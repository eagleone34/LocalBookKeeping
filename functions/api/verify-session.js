/**
 * Cloudflare Pages Function: POST /api/verify-session
 *
 * Verifies a Stripe checkout session is paid, then returns
 * a signed, time-limited download token.
 *
 * Environment variables (set in Cloudflare Pages dashboard):
 *   STRIPE_SECRET_KEY  – Stripe secret key (test or live)
 *   HMAC_SECRET        – random string used to sign download tokens
 */

export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": context.request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const { session_id } = await context.request.json();

    if (!session_id || typeof session_id !== "string") {
      return Response.json(
        { error: "Missing or invalid session_id" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify the checkout session with Stripe
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`,
      {
        headers: {
          Authorization: `Bearer ${context.env.STRIPE_SECRET_KEY}`,
        },
      }
    );

    if (!stripeRes.ok) {
      return Response.json(
        { error: "Could not verify payment. Please contact support@llmboost.ca." },
        { status: 400, headers: corsHeaders }
      );
    }

    const session = await stripeRes.json();

    if (session.payment_status !== "paid") {
      return Response.json(
        { error: "Payment has not been completed." },
        { status: 402, headers: corsHeaders }
      );
    }

    // Build a signed download token (valid for 24 hours)
    const payload = {
      sid: session_id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    };

    const token = await signToken(payload, context.env.HMAC_SECRET);

    return Response.json(
      {
        downloadUrl: `/api/download?token=${token}`,
        customerEmail: session.customer_details?.email || null,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return Response.json(
      { error: "Verification failed. Please contact support@llmboost.ca." },
      { status: 500, headers: corsHeaders }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// --- Token helpers ---

async function signToken(payload, secret) {
  const data = btoa(JSON.stringify(payload));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${sigB64}`;
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
