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

    console.log('Starting extend-recurring-slots job...');

    // Get current date in Melbourne timezone
    const now = new Date();
    const melbourneNow = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
    const todayStr = melbourneNow.toISOString().split('T')[0];

    // Calculate target end date (today + HORIZON_WEEKS)
    const targetEnd = new Date(melbourneNow);
    targetEnd.setDate(targetEnd.getDate() + (HORIZON_WEEKS * 7));
    const targetEndStr = targetEnd.toISOString().split('T')[0];

    console.log('Melbourne today:', todayStr);
    console.log('Target end date:', targetEndStr);

    // Get all active series
    const { data: activeSeries, error: seriesError } = await supabase
      .from('series')
      .select('id, tutor_id, horizon_weeks')
      .eq('is_student_visible', true)
      .or('end_week.is.null,end_week.gte.' + todayStr);

    if (seriesError) {
      throw new Error(`Failed to fetch active series: ${seriesError.message}`);
    }

    console.log(`Found ${activeSeries?.length || 0} active series`);

    let seriesProcessed = 0;
    const errors: string[] = [];

    for (const series of activeSeries || []) {
      try {
        // Calculate target end for this series based on its horizon_weeks
        const seriesHorizon = series.horizon_weeks || HORIZON_WEEKS;
        const seriesTargetEnd = new Date(melbourneNow);
        seriesTargetEnd.setDate(seriesTargetEnd.getDate() + (seriesHorizon * 7));
        const seriesTargetEndStr = seriesTargetEnd.toISOString().split('T')[0];

        console.log(`Processing series ${series.id}, target: ${seriesTargetEndStr}`);

        // Call SQL function to generate slots
        const { error: genError } = await supabase.rpc('gen_quad_slots', {
          series_id_param: series.id,
          target_end: seriesTargetEndStr
        });

        if (genError) {
          console.error(`Error generating slots for series ${series.id}:`, genError);
          errors.push(`Series ${series.id}: ${genError.message}`);
        } else {
          seriesProcessed++;
          console.log(`Successfully extended series ${series.id}`);
        }
      } catch (seriesErr) {
        const errorMessage = seriesErr instanceof Error ? seriesErr.message : 'Unknown error';
        console.error(`Error processing series ${series.id}:`, seriesErr);
        errors.push(`Series ${series.id}: ${errorMessage}`);
      }
    }

    const result = {
      success: true,
      seriesProcessed,
      seriesTotal: activeSeries?.length || 0,
      errors: errors.length > 0 ? errors : undefined,
      todayMelbourne: todayStr,
      targetEnd: targetEndStr
    };

    console.log('Job completed:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error in extend-recurring-slots:', error);
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
