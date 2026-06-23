import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Token refresh failed:', error);
    throw new Error('Failed to refresh access token');
  }

  return response.json();
}

function extractMeetingCode(meetLink: string): string | null {
  const match = meetLink.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return match ? match[1] : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { date, slotId } = await req.json();
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    console.log('Fetching quad recordings for date:', targetDate, 'slotId:', slotId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Build query for quad_slots
    let query = supabase
      .from('quad_slots')
      .select('id, slot_date, start_time, end_time, meet_link, recording_link, tutor_id')
      .neq('status', 'cancelled');

    if (slotId) {
      query = query.eq('id', slotId);
    } else {
      query = query.eq('slot_date', targetDate);
    }

    const { data: slots, error: slotsError } = await query;

    if (slotsError) {
      console.error('Slots fetch error:', slotsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch slots' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!slots || slots.length === 0) {
      console.log('No slots found');
      return new Response(
        JSON.stringify({ message: 'No slots found', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Found slots:', slots.length);

    // Get Google tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens')
      .select('access_token, refresh_token, token_expiry')
      .eq('user_id', SYSTEM_USER_ID)
      .single();

    if (tokenError || !tokenData) {
      console.error('Token fetch error:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Google Calendar not connected' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = tokenData.access_token;
    const tokenExpiry = new Date(tokenData.token_expiry);

    // Refresh token if expired
    if (tokenExpiry <= new Date()) {
      console.log('Token expired, refreshing...');
      const refreshed = await refreshAccessToken(tokenData.refresh_token);
      accessToken = refreshed.access_token;

      await supabase
        .from('google_calendar_tokens')
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', SYSTEM_USER_ID);
    }

    const results: Array<{ 
      slotId: string; 
      status: string; 
      recordingLink?: string;
      message?: string;
    }> = [];

    for (const slot of slots) {
      // Skip if already has recording
      if (slot.recording_link) {
        console.log(`Slot ${slot.id} already has recording`);
        results.push({ 
          slotId: slot.id, 
          status: 'already_has_recording', 
          recordingLink: slot.recording_link 
        });
        continue;
      }

      if (!slot.meet_link) {
        console.log(`Slot ${slot.id} has no meet link`);
        results.push({ slotId: slot.id, status: 'no_meet_link' });
        continue;
      }

      const meetingCode = extractMeetingCode(slot.meet_link);
      if (!meetingCode) {
        console.log(`Could not extract meeting code from ${slot.meet_link}`);
        results.push({ slotId: slot.id, status: 'invalid_meet_link' });
        continue;
      }

      console.log(`Processing slot ${slot.id}, meeting code: ${meetingCode}`);

      // Calculate slot time window (convert slot_date + start_time/end_time to timestamps)
      const slotDateStr = slot.slot_date;
      const slotStartStr = `${slotDateStr}T${slot.start_time}`;
      
      // Handle 24:00:00 end time (midnight next day)
      let slotEnd: Date;
      if (slot.end_time === '24:00:00') {
        // 24:00 means midnight of the next day
        const nextDay = new Date(new Date(slotDateStr).getTime() + 24 * 60 * 60 * 1000)
          .toISOString().split('T')[0];
        slotEnd = new Date(`${nextDay}T00:00:00+11:00`);
      } else {
        const slotEndStr = `${slotDateStr}T${slot.end_time}`;
        slotEnd = new Date(slotEndStr + '+11:00');
      }
      
      // Parse as Melbourne time
      const slotStart = new Date(slotStartStr + '+11:00'); // Melbourne is UTC+11 in summer
      const windowStart = new Date(slotStart.getTime() - 30 * 60 * 1000); // 30 min before
      const windowEnd = new Date(slotEnd.getTime() + 60 * 60 * 1000); // 60 min after
      
      console.log(`Slot window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

      // Fetch conference records from Google Meet API
      const filter = `space.meeting_code = "${meetingCode}"`;
      const conferenceRecordsUrl = `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}`;

      const confResponse = await fetch(conferenceRecordsUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!confResponse.ok) {
        const error = await confResponse.text();
        console.error('Conference records fetch failed:', confResponse.status, error);
        results.push({ slotId: slot.id, status: 'api_error', message: error });
        continue;
      }

      const confData = await confResponse.json();
      console.log('Conference records for slot:', slot.id, confData.conferenceRecords?.length || 0);

      if (!confData.conferenceRecords || confData.conferenceRecords.length === 0) {
        console.log(`No conference records for slot ${slot.id}`);
        results.push({ slotId: slot.id, status: 'no_meeting_data' });
        continue;
      }

      let recordingLink: string | null = null;
      let recordingStatus = 'not_found';

      // Check each conference record for recordings
      for (const record of confData.conferenceRecords) {
        const recordName = record.name;
        
        // Check if conference falls within our slot's time window
        const confStartTime = record.startTime ? new Date(record.startTime) : null;
        const confEndTime = record.endTime ? new Date(record.endTime) : null;

        if (confStartTime && confStartTime > windowEnd) {
          console.log('Skipping conference - starts after window');
          continue;
        }
        if (confEndTime && confEndTime < windowStart) {
          console.log('Skipping conference - ends before window');
          continue;
        }

        // Check by date in Melbourne timezone - either start or end should match the slot date
        // This handles midnight-spanning slots (e.g., 23:00-24:00 ends on next day)
        if (confStartTime && confEndTime) {
          const melbourneStartDate = confStartTime.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
          const melbourneEndDate = confEndTime.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
          
          // For midnight-spanning slots, the end date will be the next day
          // So we check if START date matches OR if END date matches (for slots ending at midnight)
          const nextDay = new Date(new Date(slotDateStr).getTime() + 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0];
          
          const isValidDate = melbourneStartDate === slotDateStr || 
                              melbourneEndDate === slotDateStr ||
                              (slot.end_time === '24:00:00' && melbourneEndDate === nextDay);
          
          if (!isValidDate) {
            console.log(`Conference dates ${melbourneStartDate}/${melbourneEndDate} don't match slot ${slotDateStr}`);
            continue;
          }
        }

        console.log(`Processing conference: ${recordName}`);

        // Fetch recordings
        const recordingsUrl = `https://meet.googleapis.com/v2/${recordName}/recordings`;
        const recResponse = await fetch(recordingsUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (recResponse.ok) {
          const recData = await recResponse.json();
          console.log('Recordings:', recData.recordings?.length || 0);

          if (recData.recordings && recData.recordings.length > 0) {
            for (const recording of recData.recordings) {
              if (recording.state === 'FILE_GENERATED' && recording.driveDestination?.exportUri) {
                recordingLink = recording.driveDestination.exportUri;
                recordingStatus = 'ready';
                console.log('Recording ready:', recordingLink);
                break;
              } else if (recording.state === 'ENDED' || recording.state === 'STARTED') {
                recordingStatus = 'processing';
                console.log('Recording still processing');
              }
            }
          }
        }

        if (recordingLink) break;
      }

      if (recordingLink) {
        // Update quad_slots with recording link
        const { error: updateError } = await supabase
          .from('quad_slots')
          .update({ 
            recording_link: recordingLink,
            last_sync_at: new Date().toISOString()
          })
          .eq('id', slot.id);

        if (updateError) {
          console.error('Failed to update slot:', updateError);
          results.push({ slotId: slot.id, status: 'update_failed', message: updateError.message });
        } else {
          console.log(`Updated slot ${slot.id} with recording`);
          results.push({ slotId: slot.id, status: 'found', recordingLink });
        }
      } else {
        results.push({ 
          slotId: slot.id, 
          status: recordingStatus === 'processing' ? 'processing' : 'no_recording' 
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: targetDate,
        results,
        foundCount: results.filter(r => r.status === 'found').length,
        totalSlots: slots.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in fetch-quad-recordings:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
