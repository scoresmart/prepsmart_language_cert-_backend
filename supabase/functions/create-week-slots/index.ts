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

    const { tutorId, weekAnchor, startTime, endTime, capacity = 7, meetLink = null, classLevel = 'standard' } = await req.json();

    // Validate required fields
    if (!tutorId) {
      return new Response(
        JSON.stringify({ error: 'tutorId is required' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    if (!weekAnchor) {
      return new Response(
        JSON.stringify({ error: 'weekAnchor is required (YYYY-MM-DD format)' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    if (!startTime || !endTime) {
      return new Response(
        JSON.stringify({ error: 'startTime and endTime are required (HH:MM format)' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    console.log('Creating week slots:', { tutorId, weekAnchor, startTime, endTime, capacity, meetLink, classLevel });

    // Call the SQL function
    const { data, error } = await supabase.rpc('create_quad_slots_for_week_simple', {
      p_tutor_id: tutorId,
      p_week_anchor: weekAnchor,
      p_start_time: startTime,
      p_end_time: endTime,
      p_capacity: capacity,
      p_meet_link: meetLink,
      p_class_level: classLevel
    });

    if (error) {
      console.error('Error creating slots:', error);
      throw new Error(`Failed to create slots: ${error.message}`);
    }

    const result = data && data.length > 0 ? data[0] : { 
      inserted: 0, 
      skipped_duplicates: 0, 
      skipped_overlaps: 0
    };
    
    console.log('Create result:', result);

    return new Response(JSON.stringify({
      success: true,
      inserted: result.inserted || 0,
      skippedDuplicates: result.skipped_duplicates || 0,
      skippedOverlaps: result.skipped_overlaps || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error in create-week-slots:', error);
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
