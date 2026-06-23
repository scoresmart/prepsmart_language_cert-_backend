import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get the JWT from the Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract user ID from the JWT
    const jwtToken = authHeader.replace("Bearer ", "");
    let adminUserId: string;
    try {
      const payload = JSON.parse(atob(jwtToken.split(".")[1]));
      adminUserId = payload.sub;
      console.log("Admin user ID from JWT:", adminUserId);
    } catch (e) {
      console.error("Failed to decode JWT:", e);
      return new Response(
        JSON.stringify({ error: "Invalid token format" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if requesting user is admin using service role client
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", adminUserId)
      .single();

    console.log("Admin profile lookup:", { profile, profileError });

    if (profileError || profile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Unauthorized - Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { targetUserId, redirectTo } = (await req.json()) as {
      targetUserId?: string;
      redirectTo?: string;
    };

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: "Missing target user ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get target user's email
    const { data: targetUser, error: targetUserError } = await adminClient.auth.admin.getUserById(targetUserId);

    if (targetUserError || !targetUser.user) {
      console.error("Error fetching target user:", targetUserError);
      return new Response(
        JSON.stringify({ error: "Target user not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userEmail = targetUser.user.email;
    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: "Target user has no email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a magic link for the target user
    // NOTE: The supported client flow is to redirect the browser to `action_link`.
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: userEmail,
      options: {
        emailRedirectTo: redirectTo || undefined,
        redirectTo: redirectTo || undefined,
      } as any,
    });

    if (linkError || !linkData) {
      console.error("Error generating magic link:", linkError);
      return new Response(
        JSON.stringify({ error: "Failed to generate login link" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generated link data:", JSON.stringify(linkData, null, 2));

    // Log the impersonation for audit purposes
    await adminClient.from("audit_log").insert({
      action: "admin_impersonate",
      actor: adminUserId,
      record_id: targetUserId,
      table_name: "profiles",
      meta: {
        target_email: userEmail,
        impersonated_at: new Date().toISOString(),
      }
    });

    console.log("Magic link generated successfully for:", userEmail);

    const actionLink = linkData.properties?.action_link;
    if (!actionLink) {
      return new Response(
        JSON.stringify({ error: "Failed to generate action link" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Return the action_link (client will redirect to it)
    return new Response(
      JSON.stringify({ 
        success: true,
        email: userEmail,
        action_link: actionLink
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in admin-impersonate-user:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
