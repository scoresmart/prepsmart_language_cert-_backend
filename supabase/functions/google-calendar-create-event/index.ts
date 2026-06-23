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
    const { slotId, title, description, startTime, endTime, meetLink, tutorName, calendarId } = await req.json();

    console.log('Received params:', { slotId, title, startTime, endTime, calendarId });

    // Validate required time parameters
    if (!startTime || !endTime) {
      console.error('Missing time parameters:', { startTime, endTime });
      return new Response(
        JSON.stringify({ error: 'startTime and endTime are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Creating calendar event for slot:', slotId, 'on calendar:', calendarId);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get stored tokens
    const systemUserId = '00000000-0000-0000-0000-000000000001';
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens')
      .select('*')
      .eq('user_id', systemUserId)
      .single();

    if (tokenError || !tokenData) {
      console.error('No calendar tokens found:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Google Calendar not connected. Please connect from admin settings.' }),
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

    // Create Google Calendar event with auto-generated Meet link
    const event: Record<string, unknown> = {
      summary: title || `Group Class - ${tutorName}`,
      description: description || `Group class session with ${tutorName}`,
      start: {
        dateTime: startTime,
        timeZone: 'Australia/Melbourne',
      },
      end: {
        dateTime: endTime,
        timeZone: 'Australia/Melbourne',
      },
    };

    // If meetLink provided, use it. Otherwise, request Google to create one
    if (meetLink) {
      event.conferenceData = {
        entryPoints: [{
          entryPointType: 'video',
          uri: meetLink,
          label: 'Google Meet',
        }],
        conferenceSolution: {
          key: { type: 'hangoutsMeet' },
          name: 'Google Meet',
        },
      };
    } else {
      // Request Google to auto-generate a Meet link
      event.conferenceData = {
        createRequest: {
          requestId: `slot-${slotId || Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    // Use provided calendarId or fall back to token's default or 'primary'
    const targetCalendarId = calendarId || tokenData.calendar_id || 'primary';
    
    // Add conferenceDataVersion=1 to enable Meet link creation
    // Add sendUpdates=none to disable email notifications
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events?conferenceDataVersion=1&sendUpdates=none`;
    
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

    // Extract the auto-generated Meet link
    const generatedMeetLink = calendarData.conferenceData?.entryPoints?.find(
      (ep: { entryPointType: string }) => ep.entryPointType === 'video'
    )?.uri || meetLink;

    console.log('Generated Meet link:', generatedMeetLink);

    // Update quad_slot with google_event_id and meet_link if slotId provided
    if (slotId) {
      const updateData: Record<string, unknown> = { google_event_id: calendarData.id };
      if (generatedMeetLink) {
        updateData.meet_link = generatedMeetLink;
      }
      await supabase
        .from('quad_slots')
        .update(updateData)
        .eq('id', slotId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        eventId: calendarData.id, 
        eventLink: calendarData.htmlLink,
        meetLink: generatedMeetLink 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error creating calendar event:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
