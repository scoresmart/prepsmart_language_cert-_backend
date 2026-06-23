import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

const PRACTICE_PORTAL_FUNCTION_URL =
  "https://zjfoatvelfqcumioylgp.supabase.co/functions/v1/generate-sso-token";

// Allowed referer origins (LMS domains)
const ALLOWED_ORIGINS = [
  "scoresmartbooking.com",
  "scoresmart-uni-hub.lovable.app",
  "localhost",
  "lovable.app",
  "lovableproject.com",
];

// Rate limit: max 5 requests per user per 10 minutes
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MINUTES = 10;

/** Generic error — never reveal internal reason to client */
function genericError(requestId: string) {
  return new Response(
    JSON.stringify({
      error: "This login link is invalid or has expired. Please return to LMS and try again.",
      reference: requestId,
    }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/** Hash a string with SHA-256 (for user-agent fingerprinting) */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Extract client IP from request headers */
function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Check if referer is from an allowed origin */
function isAllowedOrigin(req: Request): boolean {
  const referer = req.headers.get("referer") || "";
  const origin = req.headers.get("origin") || "";
  const check = referer || origin;
  if (!check) return true; // Allow direct calls (e.g. from edge functions)
  return ALLOWED_ORIGINS.some((domain) => check.includes(domain));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  const clientIp = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "";
  const userAgentHash = await sha256(userAgent);
  const referer = req.headers.get("referer") || "";

  // Service role client for audit logging & rate limit checks
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  /** Log an SSO event */
  async function logEvent(
    eventType: string,
    userId: string | null,
    userEmail: string | null,
    success: boolean,
    failureReason?: string
  ) {
    try {
      await serviceClient.from("sso_audit_log").insert({
        event_type: eventType,
        user_id: userId,
        user_email: userEmail,
        ip_address: clientIp,
        user_agent_hash: userAgentHash,
        referer,
        success,
        failure_reason: failureReason || null,
        request_id: requestId,
      });
    } catch (e) {
      console.error("Failed to write audit log:", e);
    }
  }

  try {
    // 1. Origin validation
    if (!isAllowedOrigin(req)) {
      await logEvent("token_failed", null, null, false, "invalid_origin");
      console.error(`[${requestId}] Blocked request from invalid origin: ${referer}`);
      return genericError(requestId);
    }

    // 2. Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      await logEvent("token_failed", null, null, false, "missing_auth");
      return genericError(requestId);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      await logEvent("token_failed", null, null, false, "invalid_jwt");
      return genericError(requestId);
    }

    const userId = user.id;
    const userEmail = user.email;

    if (!userEmail) {
      await logEvent("token_failed", userId, null, false, "no_email");
      return genericError(requestId);
    }

    // 3. Rate limiting — max N requests per user per window
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    const { count: recentRequests } = await serviceClient
      .from("sso_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event_type", "token_generated")
      .gte("created_at", windowStart);

    if ((recentRequests ?? 0) >= RATE_LIMIT_MAX) {
      await logEvent("rate_limited", userId, userEmail, false, "rate_limit_exceeded");
      console.warn(`[${requestId}] Rate limited user ${userId}`);
      return new Response(
        JSON.stringify({
          error: "Too many requests. Please wait a few minutes and try again.",
          reference: requestId,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": "600",
          },
        }
      );
    }

    // 4. Fetch user profile (name, phone)
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("name, phone")
      .eq("id", userId)
      .single();

    // 5. Check SSO secret
    const ssoSecret = Deno.env.get("SSO_SHARED_SECRET");
    if (!ssoSecret) {
      await logEvent("token_failed", userId, userEmail, false, "sso_not_configured");
      console.error(`[${requestId}] SSO_SHARED_SECRET not configured`);
      return genericError(requestId);
    }

    // 6. Call Practice Portal's generate-sso-token endpoint
    const portalResponse = await fetch(PRACTICE_PORTAL_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sso-secret": ssoSecret,
      },
      body: JSON.stringify({
        email: userEmail,
        name: profile?.name || null,
        phone: profile?.phone || null,
        ip_address: clientIp,
        user_agent_hash: userAgentHash,
      }),
    });

    const portalData = await portalResponse.json();

    if (!portalResponse.ok || !portalData?.sso_url) {
      await logEvent("token_failed", userId, userEmail, false, `portal_error_${portalResponse.status}`);
      console.error(`[${requestId}] Practice Portal SSO error — status: ${portalResponse.status}, response:`, JSON.stringify(portalData));
      console.error(`[${requestId}] Request payload: email=${userEmail}, name=${profile?.name}, hasSecret=${!!ssoSecret}, secretLength=${ssoSecret?.length}`);
      return genericError(requestId);
    }

    // 6. Success — log and return
    await logEvent("token_generated", userId, userEmail, true);

    return new Response(JSON.stringify({ sso_url: portalData.sso_url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${requestId}] SSO token generation error:`, errMsg);
    try {
      await serviceClient.from("sso_audit_log").insert({
        event_type: "token_failed",
        ip_address: clientIp,
        user_agent_hash: userAgentHash,
        referer,
        success: false,
        failure_reason: `unhandled_exception`,
        request_id: requestId,
      });
    } catch (_) { /* best effort */ }
    return genericError(requestId);
  }
});
