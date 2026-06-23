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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    const callerId = payload.sub;

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();

    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { organization, admin, courses } = await req.json();

    // 1. Create the admin user in Supabase Auth
    const { data: newUser, error: userError } = await adminClient.auth.admin.createUser({
      email: admin.email,
      password: admin.password,
      email_confirm: true,
      user_metadata: {
        name: admin.name,
        role: "admin",
        phone: admin.phone,
        admin_created: true,
      },
    });

    if (userError) {
      console.error("User creation error:", userError);
      return new Response(JSON.stringify({ error: userError.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminUserId = newUser.user.id;

    // 2. Create the organization
    const { data: org, error: orgError } = await adminClient
      .from("organizations")
      .insert({
        name: organization.name,
        slug: organization.slug,
        owner_user_id: adminUserId,
        owner_name: admin.name || organization.name,
        owner_email: admin.email,
      })
      .select()
      .single();

    if (orgError) {
      console.error("Org creation error:", orgError);
      // Cleanup: delete the created user
      await adminClient.auth.admin.deleteUser(adminUserId);
      return new Response(JSON.stringify({ error: orgError.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Create courses
    if (courses && courses.length > 0) {
      const courseRows = courses.map((name: string) => ({
        organization_id: org.id,
        name,
      }));
      await adminClient.from("organization_courses").insert(courseRows);
    }

    // 4. Log audit
    await adminClient.from("audit_log").insert({
      action: "onboard_organization",
      actor: callerId,
      record_id: org.id,
      table_name: "organizations",
      meta: { org_name: organization.name, admin_email: admin.email },
    });

    return new Response(JSON.stringify({
      id: org.id,
      name: org.name,
      slug: org.slug,
      owner_name: org.owner_name,
      owner_email: org.owner_email,
      admin_user_id: adminUserId,
      created_at: org.created_at,
      courses,
      current_students: 0,
      current_tutors: 0,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Onboard error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
