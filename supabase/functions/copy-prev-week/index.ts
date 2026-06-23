import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { weekAnchor, tutorId } = await req.json();

    if (!weekAnchor) {
      return new Response(
        JSON.stringify({ error: 'weekAnchor is required (YYYY-MM-DD format, any day in the week)' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    console.log('Copying slots from previous week:', { weekAnchor, tutorId });

    // Call the safe SQL function that normalizes to Sunday and returns detailed counts
    const { data, error } = await supabase.rpc('copy_quad_slots_prev_week_safe', {
      p_any_day_in_week: weekAnchor,
      p_tutor_id: tutorId || null
    });

    if (error) {
      console.error('Error copying slots:', error);
      throw new Error(`Failed to copy slots: ${error.message}`);
    }

    const result = data && data.length > 0 ? data[0] : { 
      inserted: 0, 
      skipped_conflicts: 0, 
      skipped_overlap: 0,
      skipped_invalid: 0,
      skipped_saturday: 0,
      source_rows: 0,
      normalized_week_start: weekAnchor
    };
    
    console.log('Copy result:', result);

    return new Response(JSON.stringify({
      success: true,
      inserted: result.inserted || 0,
      skippedConflicts: result.skipped_conflicts || 0,
      skippedOverlap: result.skipped_overlap || 0,
      skippedInvalid: result.skipped_invalid || 0,
      skippedSaturday: result.skipped_saturday || 0,
      sourceRows: result.source_rows || 0,
      normalizedWeekStart: result.normalized_week_start
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error in copy-prev-week:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
