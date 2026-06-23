import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();

    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "missing_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up the coupon
    const { data: coupon, error: couponError } = await supabase
      .from("practice_portal_coupons")
      .select("*, profiles:student_id(name, email)")
      .eq("coupon_code", code.trim().toUpperCase())
      .maybeSingle();

    if (couponError) {
      console.error("Coupon lookup error:", couponError);
      return new Response(
        JSON.stringify({ valid: false, error: "lookup_failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!coupon) {
      return new Response(
        JSON.stringify({ valid: false, error: "invalid_code" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already used
    if (coupon.is_used) {
      return new Response(
        JSON.stringify({ valid: false, error: "already_used" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiry
    if (new Date(coupon.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ valid: false, error: "expired" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark coupon as used
    const { error: updateError } = await supabase
      .from("practice_portal_coupons")
      .update({ is_used: true, used_at: new Date().toISOString() })
      .eq("id", coupon.id);

    if (updateError) {
      console.error("Coupon update error:", updateError);
      return new Response(
        JSON.stringify({ valid: false, error: "redemption_failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const student = coupon.profiles as { name: string; email: string } | null;

    return new Response(
      JSON.stringify({
        valid: true,
        student: {
          name: student?.name ?? null,
          email: student?.email ?? null,
        },
        subscription: {
          plan: "basic",
          starts_at: new Date().toISOString(),
          expires_at: coupon.expires_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ valid: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
