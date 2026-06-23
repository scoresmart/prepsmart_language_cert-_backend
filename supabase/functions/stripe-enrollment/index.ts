import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shared-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify shared secret — only scoresmart.au can call this
  const sharedSecret = req.headers.get("x-shared-secret");
  const expectedSecret = Deno.env.get("STRIPE_ENROLLMENT_SECRET");
  if (!sharedSecret || !expectedSecret || sharedSecret !== expectedSecret) {
    console.error("stripe-enrollment: unauthorized call — bad or missing shared secret");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: {
    email?: string;
    customer_name?: string;
    course_slug?: string;
    course_name?: string;
    stripe_session_id?: string;
    amount_paid?: number;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { email, customer_name, course_slug, course_name, stripe_session_id, amount_paid } = body;

  if (!email || !course_slug || !course_name || !stripe_session_id) {
    return new Response(JSON.stringify({ error: "Missing required fields: email, course_slug, course_name, stripe_session_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Idempotent upsert — duplicate webhook retries return the same token
  const { data, error } = await supabase
    .from("pending_enrollments")
    .upsert(
      {
        email: email.toLowerCase().trim(),
        course_slug,
        course_name,
        stripe_session_id,
        amount_paid: amount_paid ?? null,
        customer_name: customer_name ?? null,
      },
      { onConflict: "stripe_session_id" }
    )
    .select("enrollment_token, course_slug, token_expires_at")
    .single();

  if (error || !data) {
    console.error("stripe-enrollment: DB error:", error?.message);
    return new Response(JSON.stringify({ error: error?.message ?? "Insert failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const enrollmentUrl = `https://scoresmartbookings.com/auth?enroll=${data.enrollment_token}`;

  console.log(`stripe-enrollment: recorded ${email} → ${data.course_slug} (token: ${data.enrollment_token.slice(0, 8)}…)`);

  return new Response(
    JSON.stringify({
      success: true,
      enrollment_token: data.enrollment_token,
      enrollment_url: enrollmentUrl,
      token_expires_at: data.token_expires_at,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
