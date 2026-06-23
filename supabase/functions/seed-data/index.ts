import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create admin Supabase client
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

    console.log("Starting data seeding...");

    // Clean up existing demo data
    console.log("Cleaning up existing demo data...");

    // Remove demo users and their associated data
    const demoEmails = [
      "contact@scoresmartpte.com",
      "scoresmartpte@gmail.com", 
      "lakshaygrover216@gmail.com"
    ];

    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    
    for (const email of demoEmails) {
      const demoUser = existingUsers?.users.find(u => u.email === email);
      if (demoUser) {
        console.log(`Removing demo user: ${email}`);
        
        // Delete user data from tables
        await supabaseAdmin.from('student_access').delete().eq('student_id', demoUser.id);
        await supabaseAdmin.from('quad_slots').delete().eq('tutor_id', demoUser.id);
        await supabaseAdmin.from('sessions').delete().eq('tutor_id', demoUser.id);
        await supabaseAdmin.from('sessions').delete().eq('student_id', demoUser.id);
        await supabaseAdmin.from('tutor_tasks').delete().eq('tutor_id', demoUser.id);
        await supabaseAdmin.from('announcements').delete().eq('created_by', demoUser.id);
        await supabaseAdmin.from('tutors').delete().eq('id', demoUser.id);
        
        // Delete auth user
        await supabaseAdmin.auth.admin.deleteUser(demoUser.id);
      }
    }

    // Clean up sample data
    await supabaseAdmin.from('quad_slots').delete().like('meet_link', '%sample%');
    await supabaseAdmin.from('announcements').delete().like('title', '%Welcome to PTE Classes%');
    
    console.log("Demo data cleanup completed");

    const createdUsers = [];

    // Ensure master class settings exist (keep these as they're configuration, not dummy data)
    const masterClassSettings = [
      { subject: 'PTE', fixed_join_link: '' },
      { subject: 'NAATI', fixed_join_link: '' },
      { subject: 'IELTS', fixed_join_link: '' }
    ];

    for (const setting of masterClassSettings) {
      const { error } = await supabaseAdmin
        .from('master_class_settings')
        .upsert(setting, { onConflict: 'subject' });
      
      if (error) {
        console.error(`Error updating master class settings for ${setting.subject}:`, error);
      } else {
        console.log(`Updated master class settings for ${setting.subject}`);
      }
    }

    console.log("Demo data cleanup completed successfully!");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Demo data cleaned up successfully",
        action: "cleanup"
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );

  } catch (error) {
    console.error("Error in seed-data function:", error);
    
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        success: false
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});