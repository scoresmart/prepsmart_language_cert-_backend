import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface GetUserExamResultsRequest {
  userId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST method" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const bodyText = await req.text();
    if (!bodyText) {
      throw new Error("Empty body");
    }

    let body: GetUserExamResultsRequest;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error("Invalid JSON body");
    }

    const { userId } = body;
    if (!userId) {
      throw new Error("userId is required");
    }

    const { data, error } = await supabase
      .from("user_exam_results")
      .select(
        `
          id,
          user_id,
          dialogue_id,
          segment_count,
          average_accuracy_score,
          average_language_quality_score,
          average_fluency_pronunciation_score,
          average_delivery_coherence_score,
          average_cultural_context_score,
          average_response_management_score,
          average_final_score,
          total_final_score,
          overall_feedback,
          answer_ids,
          created_at
        `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching user_exam_results:", error);
      throw new Error("Failed to fetch exam results");
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        results: data ?? [],
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("get-user-exam-results error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
