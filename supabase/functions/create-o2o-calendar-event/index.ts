import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Token refresh failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slotId, studentName, studentEmail } = await req.json();

    console.log('Creating O2O calendar event for slot:', slotId, 'student:', studentName);

    if (!slotId) {
      return new Response(
        JSON.stringify({ error: 'slotId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get the slot details including tutor info
    const { data: slotData, error: slotError } = await supabase
      .from('one_to_one_slots')
      .select(`
        *,
        tutors:tutor_id (
          id,
          full_name,
          calendar_id,
          calendar_color
        )
      `)
      .eq('id', slotId)
      .single();

    if (slotError || !slotData) {
      console.error('Slot not found:', slotError);
      return new Response(
        JSON.stringify({ error: 'Slot not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tutorName = slotData.tutors?.full_name || 'Tutor';
    // Validate calendar_id - it should be a valid Google Calendar ID, not a color code
    const rawCalendarId = slotData.tutors?.calendar_id;
    const tutorCalendarId = rawCalendarId && !rawCalendarId.startsWith('#') ? rawCalendarId : null;
    const tutorColor = slotData.tutors?.calendar_color;

    console.log('Tutor details:', { tutorName, rawCalendarId, tutorCalendarId, tutorColor });

    // Get stored tokens (system user for admin calendar access)
    const systemUserId = '00000000-0000-0000-0000-000000000001';
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens')
      .select('*')
      .eq('user_id', systemUserId)
      .single();

    if (tokenError || !tokenData) {
      console.error('No calendar tokens found:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Google Calendar not connected. Please contact admin.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = tokenData.access_token;

    // Check if token needs refresh
    if (new Date(tokenData.token_expiry) <= new Date()) {
      console.log('Access token expired, refreshing...');
      const refreshedTokens = await refreshAccessToken(tokenData.refresh_token);
      accessToken = refreshedTokens.access_token;

      // Update stored token
      await supabase
        .from('google_calendar_tokens')
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + refreshedTokens.expires_in * 1000).toISOString(),
        })
        .eq('user_id', systemUserId);
    }

    // Format times
    const startTime = slotData.starts_at;
    const endTime = slotData.ends_at;

    // Tutor work email mapping for calendar invites
    const TUTOR_EMAIL_MAP: Record<string, string> = {
      "alisha": "alisha@scoresmartpte.com",
      "alisha jain": "alisha@scoresmartpte.com",
      "bhavneet": "bhavneet@scoresmartpte.com",
      "bhavneet virdi": "bhavneet@scoresmartpte.com",
      "nim": "nim@scoresmartpte.com",
      "nim shrestha": "nim@scoresmartpte.com",
      "syeda": "syeda@scoresmartpte.com",
    };

    const tutorWorkEmail = TUTOR_EMAIL_MAP[tutorName.trim().toLowerCase()] || null;
    console.log('Tutor work email for calendar invite:', tutorWorkEmail);

    // Build attendees list
    const attendees: { email: string }[] = [];
    if (studentEmail) attendees.push({ email: studentEmail });
    if (tutorWorkEmail) attendees.push({ email: tutorWorkEmail });

    // Create Google Calendar event with auto-generated Meet link
    const event: Record<string, unknown> = {
      summary: `1:1 Session - ${studentName || 'Student'} with ${tutorName}`,
      description: `One-to-one session\nStudent: ${studentName || 'N/A'}\nTutor: ${tutorName}\nSubject: ${slotData.subject || 'PTE'}`,
      start: {
        dateTime: startTime,
        timeZone: 'Australia/Melbourne',
      },
      end: {
        dateTime: endTime,
        timeZone: 'Australia/Melbourne',
      },
      // Add student and tutor as attendees
      ...(attendees.length > 0 ? { attendees } : {}),
      // Request Google to auto-generate a Meet link
      conferenceData: {
        createRequest: {
          requestId: `o2o-${slotId}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    // Use tutor's calendar_id if available, otherwise use default or primary
    const targetCalendarId = tutorCalendarId || tokenData.calendar_id || 'primary';
    
    console.log('Creating event on calendar:', targetCalendarId);

    // Add conferenceDataVersion=1 to enable Meet link creation
    // Send calendar invites to attendees (tutor + student)
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
    
    const calendarResponse = await fetch(calendarUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    const calendarData = await calendarResponse.json();

    if (!calendarResponse.ok) {
      console.error('Failed to create calendar event:', calendarData);
      return new Response(
        JSON.stringify({ error: 'Failed to create calendar event', details: calendarData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Calendar event created:', calendarData.id);

    // If tutor has a color preference, update the event color
    if (tutorColor && calendarData.id) {
      try {
        const colorUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events/${calendarData.id}`;
        await fetch(colorUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ colorId: tutorColor }),
        });
        console.log('Event color updated to:', tutorColor);
      } catch (colorError) {
        console.warn('Failed to set event color:', colorError);
        // Non-critical, continue anyway
      }
    }

    // Extract the auto-generated Meet link
    const generatedMeetLink = calendarData.conferenceData?.entryPoints?.find(
      (ep: { entryPointType: string }) => ep.entryPointType === 'video'
    )?.uri;

    console.log('Generated Meet link:', generatedMeetLink);

    // Update the one_to_one_slot with google_event_id and meet_link
    const updateData: Record<string, unknown> = { 
      google_event_id: calendarData.id,
      calendar_id: targetCalendarId,
    };
    if (generatedMeetLink) {
      updateData.meet_link = generatedMeetLink;
    }

    const { error: updateError } = await supabase
      .from('one_to_one_slots')
      .update(updateData)
      .eq('id', slotId);

    if (updateError) {
      console.error('Failed to update slot with calendar info:', updateError);
      // Non-critical, event was still created
    }

    // ── Per-tutor personal calendar mirror helper ────────────────────────────
    async function mirrorToTutorCalendar(
      tutorUserId: string,
      clientIdEnv: string,
      clientSecretEnv: string,
      label: string,
    ) {
      try {
        const { data: tutorTokenData, error: tutorTokenError } = await supabase
          .from('google_calendar_tokens')
          .select('*')
          .eq('user_id', tutorUserId)
          .single();

        if (tutorTokenError || !tutorTokenData) {
          console.warn(`${label} calendar not connected yet – skipping`);
          return;
        }

        let tutorAccessToken = tutorTokenData.access_token;

        if (new Date(tutorTokenData.token_expiry) <= new Date()) {
          const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: Deno.env.get(clientIdEnv)!,
              client_secret: Deno.env.get(clientSecretEnv)!,
              refresh_token: tutorTokenData.refresh_token,
              grant_type: 'refresh_token',
            }),
          });
          if (refreshResp.ok) {
            const refreshed = await refreshResp.json();
            tutorAccessToken = refreshed.access_token;
            await supabase
              .from('google_calendar_tokens')
              .update({
                access_token: tutorAccessToken,
                token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
              })
              .eq('user_id', tutorUserId);
          } else {
            console.error(`${label} token refresh failed`);
            return;
          }
        }

        const tutorEvent: Record<string, unknown> = {
          summary: `1:1 Session - ${studentName || 'Student'} with ${tutorName}`,
          description: `One-to-one session\nStudent: ${studentName || 'N/A'}\nTutor: ${tutorName}\nSubject: ${slotData.subject || 'PTE'}${generatedMeetLink ? `\nMeet: ${generatedMeetLink}` : ''}`,
          start: { dateTime: startTime, timeZone: 'Australia/Melbourne' },
          end:   { dateTime: endTime,   timeZone: 'Australia/Melbourne' },
          ...(generatedMeetLink ? {
            conferenceData: {
              entryPoints: [{ entryPointType: 'video', uri: generatedMeetLink }],
              conferenceSolution: { name: 'Google Meet' },
            }
          } : {}),
        };

        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tutorAccessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(tutorEvent),
          }
        );

        if (resp.ok) {
          const d = await resp.json();
          console.log(`${label} personal calendar event created: ${d.id}`);
        } else {
          const e = await resp.json();
          console.error(`${label} personal calendar event failed:`, e);
        }
      } catch (err) {
        console.error(`Error mirroring to ${label} calendar:`, err);
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Bhavneet's personal calendar mirror ─────────────────────────────────
    const BHAVNEET_NAMES = ['bhavneet', 'bhavneet virdi'];
    const BHAVNEET_USER_ID = '00000000-0000-0000-0000-000000000002';

    if (BHAVNEET_NAMES.includes(tutorName.trim().toLowerCase())) {
      console.log('Tutor is Bhavneet – mirroring to her personal calendar');
      await mirrorToTutorCalendar(BHAVNEET_USER_ID, 'BHAVNEET_GOOGLE_CLIENT_ID', 'BHAVNEET_GOOGLE_CLIENT_SECRET', 'Bhavneet');
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Syeda's personal calendar mirror ────────────────────────────────────
    const SYEDA_NAMES = ['syeda'];
    const SYEDA_USER_ID = '00000000-0000-0000-0000-000000000003';

    if (SYEDA_NAMES.includes(tutorName.trim().toLowerCase())) {
      console.log('Tutor is Syeda – mirroring to her personal calendar');
      await mirrorToTutorCalendar(SYEDA_USER_ID, 'SYEDA_GOOGLE_CLIENT_ID', 'SYEDA_GOOGLE_CLIENT_SECRET', 'Syeda');
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── NIM's personal calendar mirror ──────────────────────────────────────
    const NIM_NAMES = ['nim', 'nim shrestha'];
    const NIM_USER_ID = '00000000-0000-0000-0000-000000000004';

    if (NIM_NAMES.includes(tutorName.trim().toLowerCase())) {
      console.log('Tutor is NIM – mirroring to her personal calendar');
      await mirrorToTutorCalendar(NIM_USER_ID, 'NIM_GOOGLE_CLIENT_ID', 'NIM_GOOGLE_CLIENT_SECRET', 'NIM');
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Alisha's personal calendar mirror ───────────────────────────────────
    const ALISHA_NAMES = ['alisha', 'alisha jain'];
    const ALISHA_USER_ID = '00000000-0000-0000-0000-000000000005';

    if (ALISHA_NAMES.includes(tutorName.trim().toLowerCase())) {
      console.log('Tutor is Alisha – mirroring to her personal calendar');
      await mirrorToTutorCalendar(ALISHA_USER_ID, 'ALISHA_GOOGLE_CLIENT_ID', 'ALISHA_GOOGLE_CLIENT_SECRET', 'Alisha');
    }
    // ────────────────────────────────────────────────────────────────────────

    return new Response(
      JSON.stringify({ 
        success: true, 
        eventId: calendarData.id, 
        eventLink: calendarData.htmlLink,
        meetLink: generatedMeetLink,
        calendarId: targetCalendarId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error creating O2O calendar event:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
