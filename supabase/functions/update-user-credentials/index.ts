import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UpdateCredentialsRequest {
  userId: string;
  username?: string;
  password?: string;
  email?: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Verify the requesting user is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Check if user is admin
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "admin") {
      throw new Error("Only admins can update user credentials");
    }

    // Parse request body
    const { userId, username, password, email }: UpdateCredentialsRequest = await req.json();

    if (!userId) {
      throw new Error("userId is required");
    }

    const updates: any = {};

    // Update email if provided
    if (email !== undefined && email.trim()) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error("Invalid email format");
      }

      // Check if email is already taken
      const { data: existingEmail } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .neq("id", userId)
        .maybeSingle();

      if (existingEmail) {
        throw new Error("Email is already taken");
      }

      // Get current user to check if email is changing
      const { data: currentUserData } = await supabaseAdmin.auth.admin.getUserById(userId);
      
      // Update email in auth.users and auto-confirm it (admin-created/updated)
      const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { 
          email,
          email_confirm: true  // Auto-confirm email when admin updates it
        }
      );

      if (!emailError && currentUserData?.user) {
        // If email didn't change but wasn't confirmed, confirm it now
        if (currentUserData.user.email === email && !currentUserData.user.email_confirmed_at) {
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            email_confirm: true
          });
        }
      }

      if (emailError) {
        throw new Error(`Failed to update email: ${emailError.message}`);
      }

      // Update email in profiles table
      const { error: profileEmailError } = await supabaseAdmin
        .from("profiles")
        .update({ email })
        .eq("id", userId);

      if (profileEmailError) {
        throw new Error(`Failed to update profile email: ${profileEmailError.message}`);
      }

      updates.email = true;
    }

    // Update username in profiles table if provided
    if (username !== undefined && username.trim()) {
      // Check if username is already taken
      const { data: existingUser } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("username", username)
        .neq("id", userId)
        .maybeSingle();

      if (existingUser) {
        throw new Error("Username is already taken");
      }

      const { error: usernameError } = await supabaseAdmin
        .from("profiles")
        .update({ username })
        .eq("id", userId);

      if (usernameError) {
        throw new Error(`Failed to update username: ${usernameError.message}`);
      }

      updates.username = true;
    }

    // Update password if provided
    if (password !== undefined && password.trim()) {
      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters");
      }

      const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password }
      );

      if (passwordError) {
        throw new Error(`Failed to update password: ${passwordError.message}`);
      }

      updates.password = true;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Credentials updated successfully",
        updates 
      }),
      {
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders 
        },
      }
    );
  } catch (error: any) {
    console.error("Error in update-user-credentials:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "An unexpected error occurred" 
      }),
      {
        status: 400,
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders 
        },
      }
    );
  }
});
