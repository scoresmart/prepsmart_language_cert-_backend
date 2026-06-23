import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get user to verify they have admin access
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify admin role
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Support both query params and JSON body
    const url = new URL(req.url);
    const qpTutorId = url.searchParams.get('tutor_id');
    const qpSubject = url.searchParams.get('subject') || undefined;
    const qpStartUtc = url.searchParams.get('start_utc');
    const qpEndUtc = url.searchParams.get('end_utc');

    let body: any = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }

    const tutorId = body.tutor_id ?? qpTutorId;
    const subject = body.subject ?? qpSubject ?? 'PTE';
    const startUtc = body.start_utc ?? qpStartUtc;
    const endUtc = body.end_utc ?? qpEndUtc;

    if (!tutorId || !startUtc || !endUtc) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: tutor_id, start_utc, end_utc' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Debug slot conflicts request (Australia/Sydney):', { tutorId, subject, startUtc, endUtc });

    // Convert UTC times to local epoch milliseconds for proper conflict checking
    let startLocalMs: number, endLocalMs: number;
    
    try {
      // If the input looks like epoch milliseconds, use it directly
      if (typeof startUtc === 'string' && !isNaN(Number(startUtc)) && Number(startUtc) > 1000000000000) {
        startLocalMs = Number(startUtc);
        endLocalMs = Number(endUtc);
      } else {
        // Convert UTC timestamp strings to local epoch ms using the database function
        const { data: startMs } = await supabaseClient.rpc('utc_to_sydney_epoch_ms', {
          utc_timestamp: startUtc
        });
        const { data: endMs } = await supabaseClient.rpc('utc_to_sydney_epoch_ms', {
          utc_timestamp: endUtc
        });
        
        startLocalMs = startMs;
        endLocalMs = endMs;
      }
    } catch (e) {
      console.error('Error converting timestamps:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid timestamp format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find all slots for this tutor including local time fields
    const { data: allSlots, error: allSlotsError } = await supabaseClient
      .from('quad_slots')
      .select('id, tutor_id, subject, starts_at, ends_at, starts_at_local_ms, ends_at_local_ms, status, created_at')
      .eq('tutor_id', tutorId)
      .eq('subject', subject)
      .order('starts_at_local_ms', { ascending: true });

    if (allSlotsError) {
      console.error('Error fetching all slots:', allSlotsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch slots' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find active conflicts using the new local time function
    const { data: activeConflicts, error: conflictsError } = await supabaseClient
      .rpc('find_slot_conflicts_local', {
        p_tutor_id: tutorId,
        p_subject: subject,
        p_start_local_ms: startLocalMs,
        p_end_local_ms: endLocalMs
      });

    if (conflictsError) {
      console.error('Error finding conflicts:', conflictsError);
      return new Response(
        JSON.stringify({ error: 'Failed to check conflicts' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find cancelled slots that would have conflicted (using local time)
    const { data: cancelledConflicts, error: cancelledError } = await supabaseClient
      .from('quad_slots')
      .select('id, starts_at, ends_at, starts_at_local_ms, ends_at_local_ms, status, created_at')
      .eq('tutor_id', tutorId)
      .eq('subject', subject)
      .eq('status', 'cancelled')
      .lt('starts_at_local_ms', endLocalMs)
      .gt('ends_at_local_ms', startLocalMs);

    if (cancelledError) {
      console.error('Error fetching cancelled slots:', cancelledError);
    }

    const debugResult = {
      request: {
        tutor_id: tutorId,
        subject,
        start_utc: startUtc,
        end_utc: endUtc,
        requested_at: new Date().toISOString()
      },
      total_slots_for_tutor: allSlots?.length || 0,
      active_conflicts: activeConflicts || [],
      cancelled_conflicts: cancelledConflicts || [],
      all_slots: allSlots || [],
      analysis: {
        has_active_conflicts: (activeConflicts?.length || 0) > 0,
        would_be_blocked: (activeConflicts?.length || 0) > 0,
        cancelled_slot_count: cancelledConflicts?.length || 0
      }
    };

    console.log('Debug result:', debugResult);

    return new Response(
      JSON.stringify(debugResult, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Slot conflicts debug error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
})