import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (key !== Deno.env.get('SYNC_SECRET_KEY')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get all distinct tutor names so we can see exactly what names Bhavneet's slots use
    const { data: tutors } = await supabase
      .from('tutors')
      .select('id, full_name, calendar_id, calendar_color');

    // Get ALL scheduled booked slots from today onwards with tutor name
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: slots } = await supabase
      .from('one_to_one_slots')
      .select(`
        id, starts_at, ends_at, subject, status, student_id, meet_link,
        tutors:tutor_id ( id, full_name )
      `)
      .eq('status', 'scheduled')
      .not('student_id', 'is', null)
      .gte('starts_at', todayStart.toISOString())
      .order('starts_at', { ascending: true });

    // Group by tutor name
    const byTutor: Record<string, any[]> = {};
    for (const slot of slots || []) {
      const name = (slot as any).tutors?.full_name || 'UNKNOWN';
      if (!byTutor[name]) byTutor[name] = [];
      byTutor[name].push({
        id: slot.id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        subject: slot.subject,
        has_meet: !!slot.meet_link,
      });
    }

    return new Response(
      JSON.stringify({ tutors, slotsByTutor: byTutor }, null, 2),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
