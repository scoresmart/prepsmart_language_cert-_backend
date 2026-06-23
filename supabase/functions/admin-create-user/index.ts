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

    // Extract user ID from the JWT (token is already verified by Supabase since verify_jwt=true)
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
      console.log("Decoded user ID from JWT:", userId);
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
      .eq("id", userId)
      .single();

    console.log("Profile lookup result:", { profile, profileError });

    if (profileError || profile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Unauthorized - Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { email, password, name, phone, courses, courseAccessOptions } = await req.json();

    if (!email || !password || !name || !phone) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create user using admin API
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        phone,
        role: "student",
        admin_created: true,
      },
    });

    if (createError) {
      console.error("Error creating user:", createError);

      // Return 200 with a structured payload so the client can show a friendly toast
      // without Lovable surfacing this as a runtime/blank-screen error.
      return new Response(
        JSON.stringify({
          success: false,
          error: createError.message,
          code: (createError as any)?.code ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!newUser.user) {
      return new Response(
        JSON.stringify({ error: "Failed to create user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update profile with phone number (trigger should have created profile)
    const { error: updateProfileError } = await adminClient
      .from("profiles")
      .update({
        phone,
        name,
        approval_status: "approved",
      })
      .eq("id", newUser.user.id);

    if (updateProfileError) {
      console.error("Error updating profile:", updateProfileError);
    }

    // Create student access records for each selected course
    if (courses && courseAccessOptions) {
      for (const course of courses) {
        const options = courseAccessOptions[course];
        // For Language Cert, practice_portal_only is also valid access
        if (options && (options.allow_quad || options.allow_one_to_one || options.practice_portal_only)) {
          const accessData = {
            student_id: newUser.user.id,
            subject: course,
            allow_feedback: false,
            allow_quad: options.allow_quad || false,
            allow_one_to_one: options.allow_one_to_one || false,
            course_expiry_at: options.course_expiry_at || null,
            quad_expiry_at: options.allow_quad ? (options.quad_expiry_at || null) : null,
            one_to_one_quota: options.allow_one_to_one ? (options.one_to_one_quota || 0) : 0,
            one_to_one_start_date: options.allow_one_to_one ? (options.one_to_one_start_date || null) : null,
            one_to_one_used: 0,
            // These power the student dashboard "Days to Exam" + "Target Score"
            exam_date: options.exam_date || null,
            target_score: options.target_score || null,
            // Practice portal only flag for Language Cert
            practice_portal_only: options.practice_portal_only || false,
          };

          const { error: accessError } = await adminClient
            .from("student_access")
            .insert(accessData);

          if (accessError) {
            console.error("Error creating student access:", accessError);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: { 
          id: newUser.user.id, 
          email: newUser.user.email 
        } 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in admin-create-user:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});