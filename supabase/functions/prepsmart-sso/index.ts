import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PREPSMART_API_URL = Deno.env.get("PREPSMART_API_URL") ?? "https://prepsmart.au/api/external";
const PREPSMART_API_SECRET = Deno.env.get("PREPSMART_API_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PrepSmartRequest {
  action: "create_user" | "get_login_token" | "update_subscription";
  email: string;
  name?: string;
  expiryDate?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, email, name, expiryDate }: PrepSmartRequest = await req.json();

    if (!action || !email) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: action and email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!PREPSMART_API_SECRET) {
      console.error("PREPSMART_API_SECRET is not set");
      return new Response(
        JSON.stringify({ error: "PrepSmart integration is not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let endpoint: string;
    let method: string;
    let body: Record<string, unknown>;

    if (action === "create_user") {
      endpoint = "/prepsmart-create-user";
      method = "POST";
      body = { email, name, subscription: "pro", expiryDate: expiryDate ?? null };
    } else if (action === "get_login_token") {
      endpoint = "/prepsmart-generate-token";
      method = "POST";
      body = { email };
    } else if (action === "update_subscription") {
      endpoint = "/prepsmart-update-subscription";
      method = "POST";
      body = { email, expiryDate };
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`PrepSmart SSO: action=${action}, email=${email}`);

    const response = await fetch(`${PREPSMART_API_URL}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": PREPSMART_API_SECRET,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("PrepSmart SSO error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
