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

    const { tutorId, monthAnchor, startTime, endTime, capacity = 7, meetLink = null, classLevel = 'standard' } = await req.json();

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

    if (!monthAnchor) {
      return new Response(
        JSON.stringify({ error: 'monthAnchor is required (YYYY-MM-DD format)' }),
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

    console.log('Creating month slots:', { tutorId, monthAnchor, startTime, endTime, capacity, meetLink, classLevel });

    // Parse the month anchor to get first and last day of month
    const anchorDate = new Date(monthAnchor + 'T00:00:00');
    const year = anchorDate.getFullYear();
    const month = anchorDate.getMonth();
    
    // First day of the month
    const monthStart = new Date(year, month, 1);
    const monthStartStr = monthStart.toISOString().split('T')[0];
    
    // Last day of the month
    const monthEnd = new Date(year, month + 1, 0);
    const monthEndStr = monthEnd.toISOString().split('T')[0];

    console.log('Month range:', { monthStartStr, monthEndStr });

    let totalInserted = 0;
    let totalSkippedDuplicates = 0;
    let totalSkippedOverlaps = 0;

    // Loop through each week in the month
    let currentDate = new Date(monthStart);
    
    while (currentDate <= monthEnd) {
      const weekAnchor = currentDate.toISOString().split('T')[0];
      
      console.log('Processing week starting:', weekAnchor);
      
      // Call the SQL function for this week
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
        console.error('Error creating slots for week:', weekAnchor, error);
        throw new Error(`Failed to create slots for week ${weekAnchor}: ${error.message}`);
      }

      const result = data && data.length > 0 ? data[0] : { 
        inserted: 0, 
        skipped_duplicates: 0, 
        skipped_overlaps: 0
      };
      
      totalInserted += result.inserted || 0;
      totalSkippedDuplicates += result.skipped_duplicates || 0;
      totalSkippedOverlaps += result.skipped_overlaps || 0;
      
      console.log('Week result:', weekAnchor, result);
      
      // Move to next week
      currentDate.setDate(currentDate.getDate() + 7);
    }

    console.log('Month creation complete:', { 
      totalInserted, 
      totalSkippedDuplicates, 
      totalSkippedOverlaps 
    });

    return new Response(JSON.stringify({
      success: true,
      inserted: totalInserted,
      skippedDuplicates: totalSkippedDuplicates,
      skippedOverlaps: totalSkippedOverlaps,
      monthStart: monthStartStr,
      monthEnd: monthEndStr
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error in create-month-slots:', error);
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
