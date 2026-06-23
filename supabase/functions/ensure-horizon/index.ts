import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const HORIZON_WEEKS = 12;
const TIMEZONE = 'Australia/Melbourne';

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

    // Parse query params
    const url = new URL(req.url);
    const seriesId = url.searchParams.get('seriesId');
    const horizonWeeks = parseInt(url.searchParams.get('horizon') || `${HORIZON_WEEKS}`);

    console.log('Ensure horizon called:', { seriesId, horizonWeeks });

    // Get current date in Melbourne timezone
    const now = new Date();
    const melbourneNow = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
    
    // Calculate target end date
    const targetEnd = new Date(melbourneNow);
    targetEnd.setDate(targetEnd.getDate() + (horizonWeeks * 7));
    const targetEndStr = targetEnd.toISOString().split('T')[0];

    if (seriesId) {
      // Ensure specific series
      console.log(`Ensuring series ${seriesId} up to ${targetEndStr}`);
      
      const { error: genError } = await supabase.rpc('gen_quad_slots', {
        series_id_param: seriesId,
        target_end: targetEndStr
      });

      if (genError) {
        throw new Error(`Failed to generate slots for series ${seriesId}: ${genError.message}`);
      }

      return new Response(JSON.stringify({
        success: true,
        seriesId,
        targetEnd: targetEndStr
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    } else {
      // Ensure all active series
      const { data: activeSeries, error: seriesError } = await supabase
        .from('series')
        .select('id')
        .eq('is_student_visible', true);

      if (seriesError) {
        throw new Error(`Failed to fetch active series: ${seriesError.message}`);
      }

      let processed = 0;
      const errors: string[] = [];

      for (const series of activeSeries || []) {
        try {
          const { error: genError } = await supabase.rpc('gen_quad_slots', {
            series_id_param: series.id,
            target_end: targetEndStr
          });

          if (genError) {
            errors.push(`Series ${series.id}: ${genError.message}`);
          } else {
            processed++;
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`Series ${series.id}: ${errorMessage}`);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        seriesProcessed: processed,
        seriesTotal: activeSeries?.length || 0,
        errors: errors.length > 0 ? errors : undefined,
        targetEnd: targetEndStr
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

  } catch (error) {
    console.error('Error in ensure-horizon:', error);
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
