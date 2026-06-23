import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GroupClassSlot {
  id: string;
  label: string;
  start_date: string;
  start_time: string;
  end_time: string;
  tutor_id: string;
  calendar_id: string;
  meet_link?: string;
  google_event_id?: string;
  last_created_date?: string;
}

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get slots from request body or fetch from app_settings
    let slots: GroupClassSlot[] = [];
    const body = await req.json().catch(() => ({}));
    
    if (body.slots && body.slots.length > 0) {
      slots = body.slots;
    } else {
      // Fetch from app_settings
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'group_class_slots')
        .single();
      
      if (data?.value) {
        slots = JSON.parse(data.value);
      }
    }

    if (slots.length === 0) {
      console.log('No group class slots configured');
      return new Response(
        JSON.stringify({ success: true, created: 0, message: 'No slots configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Creating recurring group class events for ${slots.length} slots`);

    // Get Google Calendar tokens - try to find admin user tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens')
      .select('*')
      .limit(1)
      .single();

    if (tokenError || !tokenData) {
      console.error('No calendar tokens found:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Google Calendar not connected. Please connect Google Calendar first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = tokenData.access_token;

    // Check if token needs refresh
    if (new Date(tokenData.token_expiry) <= new Date()) {
      console.log('Access token expired, refreshing...');
      const refreshedTokens = await refreshAccessToken(tokenData.refresh_token);
      accessToken = refreshedTokens.access_token;

      await supabase
        .from('google_calendar_tokens')
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + refreshedTokens.expires_in * 1000).toISOString(),
        })
        .eq('user_id', tokenData.user_id);
    }

    // Fetch tutor names
    const tutorIds = [...new Set(slots.map(s => s.tutor_id).filter(Boolean))];
    const { data: tutorsData } = await supabase
      .from('tutors')
      .select('id, full_name')
      .in('id', tutorIds);
    
    const tutorMap = new Map(tutorsData?.map(t => [t.id, t.full_name]) || []);

    let createdCount = 0;
    const updatedSlots = [...slots];

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];

      // Skip if already has a recurring event created
      if (slot.google_event_id) {
        console.log(`Slot ${slot.id} already has recurring event ${slot.google_event_id}, skipping`);
        continue;
      }

      if (!slot.calendar_id) {
        console.log(`Slot ${slot.id} has no calendar_id, skipping`);
        continue;
      }

      if (!slot.start_date) {
        console.log(`Slot ${slot.id} has no start_date, skipping`);
        continue;
      }

      const tutorName = tutorMap.get(slot.tutor_id) || 'Tutor';
      
      // Create datetime strings for the recurring event start date
      const startDateTime = `${slot.start_date}T${slot.start_time}:00`;
      const endDateTime = `${slot.start_date}T${slot.end_time}:00`;

      // Create a recurring event (Mon-Fri, excluding Saturday and Sunday)
      // RRULE: Recurs weekly on weekdays
      const event = {
        summary: slot.label || `Group Class - ${tutorName}`,
        description: `Daily group class session with ${tutorName}\n\nThis is a recurring event that happens every weekday.`,
        start: {
          dateTime: startDateTime,
          timeZone: 'Australia/Melbourne',
        },
        end: {
          dateTime: endDateTime,
          timeZone: 'Australia/Melbourne',
        },
        recurrence: [
          'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'  // Recur every weekday
        ],
        conferenceData: {
          createRequest: {
            requestId: `group-recurring-${slot.id}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      };

      try {
        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(slot.calendar_id)}/events?conferenceDataVersion=1`;
        
        console.log(`Creating recurring event for slot ${slot.id} on calendar ${slot.calendar_id}`);
        
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
          console.error(`Failed to create event for slot ${slot.id}:`, calendarData);
          continue;
        }

        // Extract the auto-generated Meet link
        const meetLink = calendarData.conferenceData?.entryPoints?.find(
          (ep: { entryPointType: string }) => ep.entryPointType === 'video'
        )?.uri;

        console.log(`Created recurring event for slot ${slot.id}: ${calendarData.id}, Meet: ${meetLink}`);

        // Update slot with new meet link and event ID
        updatedSlots[i] = {
          ...slot,
          meet_link: meetLink,
          google_event_id: calendarData.id,
          last_created_date: new Date().toISOString().split('T')[0],
        };

        createdCount++;
      } catch (error) {
        console.error(`Error creating event for slot ${slot.id}:`, error);
      }
    }

    // Save updated slots back to app_settings
    if (createdCount > 0) {
      await supabase
        .from('app_settings')
        .upsert({
          key: 'group_class_slots',
          value: JSON.stringify(updatedSlots),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
    }

    console.log(`Created ${createdCount} recurring events`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        created: createdCount, 
        updatedSlots 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error creating group class events:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
