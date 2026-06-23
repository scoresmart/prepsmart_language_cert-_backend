import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SYEDA_USER_ID = '00000000-0000-0000-0000-000000000003';
const SYEDA_NAMES = ['syeda'];

async function getValidAccessToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: tokenData, error } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', SYEDA_USER_ID)
    .single();

  if (error || !tokenData) {
    throw new Error('Syeda calendar not connected. Please run the auth flow first.');
  }

  let accessToken = tokenData.access_token;

  if (new Date(tokenData.token_expiry) <= new Date()) {
    console.log('Syeda token expired, refreshing...');
    const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('SYEDA_GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('SYEDA_GOOGLE_CLIENT_SECRET')!,
        refresh_token: tokenData.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!refreshResp.ok) {
      const err = await refreshResp.json();
      throw new Error(`Token refresh failed: ${JSON.stringify(err)}`);
    }

    const refreshed = await refreshResp.json();
    accessToken = refreshed.access_token;

    await supabase
      .from('google_calendar_tokens')
      .update({
        access_token: accessToken,
        token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq('user_id', SYEDA_USER_ID);
  }

  return accessToken;
}

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

    const accessToken = await getValidAccessToken(supabase);

    // Fetch all upcoming scheduled slots from start of today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: slots, error: slotError } = await supabase
      .from('one_to_one_slots')
      .select(`
        id, student_id, starts_at, ends_at, subject, meet_link,
        tutors:tutor_id ( full_name )
      `)
      .eq('status', 'scheduled')
      .not('student_id', 'is', null)
      .gte('starts_at', todayStart.toISOString())
      .order('starts_at', { ascending: true });

    if (slotError) throw new Error(`Failed to fetch slots: ${slotError.message}`);

    const syedaSlots = (slots || []).filter((slot: any) =>
      SYEDA_NAMES.includes((slot.tutors?.full_name || '').trim().toLowerCase())
    );

    if (syedaSlots.length === 0) {
      return new Response(JSON.stringify({ message: 'No scheduled Syeda slots found.', synced: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const studentIds = [...new Set(syedaSlots.map((s: any) => s.student_id).filter(Boolean))];
    const { data: students } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', studentIds);

    const studentById = new Map((students || []).map((s: any) => [s.id, s]));

    let synced = 0;
    let failed = 0;
    const results: { slotId: string; status: string; error?: string }[] = [];

    for (const slot of syedaSlots) {
      const student = studentById.get(slot.student_id);
      const studentName = student?.name || 'Student';
      const tutorName = slot.tutors?.full_name || 'Syeda';

      try {
        const event: Record<string, unknown> = {
          summary: `1:1 Session - ${studentName} with ${tutorName}`,
          description: `One-to-one session\nStudent: ${studentName}\nTutor: ${tutorName}\nSubject: ${slot.subject || 'PTE'}${slot.meet_link ? `\nMeet: ${slot.meet_link}` : ''}`,
          start: { dateTime: slot.starts_at, timeZone: 'Australia/Melbourne' },
          end:   { dateTime: slot.ends_at,   timeZone: 'Australia/Melbourne' },
          ...(slot.meet_link ? {
            conferenceData: {
              entryPoints: [{ entryPointType: 'video', uri: slot.meet_link }],
              conferenceSolution: { name: 'Google Meet' },
            },
          } : {}),
        };

        const calResp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
          }
        );

        if (calResp.ok) {
          const calData = await calResp.json();
          console.log(`Slot ${slot.id} → Syeda event ${calData.id}`);
          synced++;
          results.push({ slotId: slot.id, status: 'synced' });
        } else {
          const calErr = await calResp.json();
          throw new Error(JSON.stringify(calErr));
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Slot ${slot.id} failed: ${msg}`);
        results.push({ slotId: slot.id, status: 'failed', error: msg });
      }
    }

    return new Response(
      JSON.stringify({ total: syedaSlots.length, synced, failed, results }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sync error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
