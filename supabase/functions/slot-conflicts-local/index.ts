import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConflictRequest {
  tutor_id: string;
  subject: string;
  start_local_ms: number;
  end_local_ms: number;
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
    const start_local_ms = url.searchParams.get('start_local_ms');
    const end_local_ms = url.searchParams.get('end_local_ms');

    if (!tutor_id || !start_local_ms || !end_local_ms) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: tutor_id, start_local_ms, end_local_ms' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Checking local time conflicts for:', { 
      tutor_id, 
      subject, 
      start_local_ms: Number(start_local_ms), 
      end_local_ms: Number(end_local_ms) 
    });

    // Use the local time database function to find conflicts
    const { data: conflicts, error } = await supabase
      .rpc('find_slot_conflicts_local', {
        p_tutor_id: tutor_id,
        p_subject: subject,
        p_start_local_ms: Number(start_local_ms),
        p_end_local_ms: Number(end_local_ms)
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

    // Also get all active slots for this tutor to provide context
    const { data: allSlots, error: allSlotsError } = await supabase
      .from('quad_slots')
      .select('id, starts_at, ends_at, starts_at_local_ms, ends_at_local_ms, status')
      .eq('tutor_id', tutor_id)
      .eq('subject', subject)
      .neq('status', 'cancelled')
      .order('starts_at_local_ms');

    if (allSlotsError) {
      console.error('Error fetching all slots:', allSlotsError);
    }

    const response = {
      conflicts: conflicts || [],
      conflictCount: conflicts?.length || 0,
      allActiveSlots: allSlots || [],
      activeSlotCount: allSlots?.length || 0,
      query: {
        tutor_id,
        subject,
        start_local_ms: Number(start_local_ms),
        end_local_ms: Number(end_local_ms)
      },
      debug: {
        timestamp: new Date().toISOString(),
        timezone: 'Australia/Sydney'
      }
    };

    console.log('Local conflict check result:', response);

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