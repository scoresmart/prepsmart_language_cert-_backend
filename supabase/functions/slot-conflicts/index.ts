import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConflictRequest {
  tutor_id: string;
  subject: string;
  start_utc: string;
  end_utc: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const url = new URL(req.url);
    const tutor_id = url.searchParams.get('tutor_id');
    const subject = url.searchParams.get('subject') || 'PTE';
    const start_utc = url.searchParams.get('start_utc');
    const end_utc = url.searchParams.get('end_utc');

    if (!tutor_id || !start_utc || !end_utc) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: tutor_id, start_utc, end_utc' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Checking conflicts for:', { tutor_id, subject, start_utc, end_utc });

    // Use the database function to find conflicts
    const { data: conflicts, error } = await supabase
      .rpc('find_slot_conflicts', {
        p_tutor_id: tutor_id,
        p_subject: subject,
        p_start_utc: start_utc,
        p_end_utc: end_utc
      });

    if (error) {
      console.error('Database error:', error);
      return new Response(
        JSON.stringify({ error: 'Database error', details: error.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Also get all slots for this tutor to provide context
    const { data: allSlots, error: allSlotsError } = await supabase
      .from('quad_slots')
      .select('*')
      .eq('tutor_id', tutor_id)
      .eq('subject', subject)
      .order('starts_at');

    if (allSlotsError) {
      console.error('Error fetching all slots:', allSlotsError);
    }

    const response = {
      conflicts: conflicts || [],
      conflictCount: conflicts?.length || 0,
      allSlotsCount: allSlots?.length || 0,
      activeSlots: allSlots?.filter(slot => slot.status !== 'cancelled').length || 0,
      cancelledSlots: allSlots?.filter(slot => slot.status === 'cancelled').length || 0,
      query: {
        tutor_id,
        subject,
        start_utc,
        end_utc
      },
      debug: {
        timestamp: new Date().toISOString(),
        timezone: 'UTC'
      }
    };

    console.log('Conflict check result:', response);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});