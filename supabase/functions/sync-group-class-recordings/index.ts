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
    const { date } = await req.json();
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    console.log('Syncing group class recordings for date:', targetDate);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get group class slots from app_settings
    const { data: slotsData, error: slotsError } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'group_class_slots')
      .maybeSingle();

    if (slotsError || !slotsData?.value) {
      console.log('No group class slots configured');
      return new Response(
        JSON.stringify({ message: 'No group class slots configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const slots = JSON.parse(slotsData.value);
    console.log('Found slots:', slots.length);

    // Get existing recordings for this date
    const { data: existingRecordings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', `group_class_recordings_${targetDate}`)
      .maybeSingle();

    const recordings: Record<string, string> = existingRecordings?.value 
      ? JSON.parse(existingRecordings.value) 
      : {};

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

    const results: Array<{ slotId: string; status: string; recordingLink?: string; transcriptLink?: string }> = [];

    // Get existing transcripts for this date
    const { data: existingTranscripts } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', `group_class_transcripts_${targetDate}`)
      .maybeSingle();

    const transcripts: Record<string, string> = existingTranscripts?.value 
      ? JSON.parse(existingTranscripts.value) 
      : {};

    for (const slot of slots) {
      // Skip if already has both recording and transcript for this date
      if (recordings[slot.id] && transcripts[slot.id]) {
        console.log(`Slot ${slot.id} already has recording and transcript for ${targetDate}`);
        results.push({ 
          slotId: slot.id, 
          status: 'already_synced', 
          recordingLink: recordings[slot.id],
          transcriptLink: transcripts[slot.id]
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

      // Fetch conference records from Google Meet API
      const filter = `space.meeting_code = "${meetingCode}"`;
      const conferenceRecordsUrl = `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}`;

      const confResponse = await fetch(conferenceRecordsUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!confResponse.ok) {
        const error = await confResponse.text();
        console.error('Conference records fetch failed:', confResponse.status, error);
        results.push({ slotId: slot.id, status: 'api_error' });
        continue;
      }

      const confData = await confResponse.json();
      console.log('Conference records for slot:', slot.id, JSON.stringify(confData, null, 2));

      if (!confData.conferenceRecords || confData.conferenceRecords.length === 0) {
        console.log(`No conference records for slot ${slot.id}`);
        results.push({ slotId: slot.id, status: 'no_meeting_data' });
        continue;
      }

      let recordingLink: string | null = recordings[slot.id] || null;
      let transcriptLink: string | null = transcripts[slot.id] || null;

      // Check each conference record for recordings and transcripts
      for (const record of confData.conferenceRecords) {
        const recordName = record.name;
        
        // Check if conference ended on target date (in Melbourne timezone)
        if (record.endTime) {
          // Convert UTC end time to Melbourne date
          const endTimeUTC = new Date(record.endTime);
          const melbourneEndDate = endTimeUTC.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
          
          if (melbourneEndDate !== targetDate) {
            console.log(`Conference ${recordName} ended on ${melbourneEndDate} (Melbourne), not ${targetDate}`);
            continue;
          }
          console.log(`Conference ${recordName} matches target date ${targetDate} (Melbourne)`);
        }

        // Fetch recordings if not already found
        if (!recordingLink) {
          const recordingsUrl = `https://meet.googleapis.com/v2/${recordName}/recordings`;
          console.log('Fetching recordings:', recordingsUrl);

          const recResponse = await fetch(recordingsUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });

          if (recResponse.ok) {
            const recData = await recResponse.json();
            console.log('Recordings:', JSON.stringify(recData, null, 2));

            if (recData.recordings && recData.recordings.length > 0) {
              for (const recording of recData.recordings) {
                if (recording.state === 'FILE_GENERATED' && recording.driveDestination?.exportUri) {
                  recordingLink = recording.driveDestination.exportUri;
                  console.log('Recording ready:', recordingLink);
                  break;
                }
              }
            }
          }
        }

        // Fetch transcripts if not already found
        if (!transcriptLink) {
          const transcriptsUrl = `https://meet.googleapis.com/v2/${recordName}/transcripts`;
          console.log('Fetching transcripts:', transcriptsUrl);

          const transResponse = await fetch(transcriptsUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });

          if (transResponse.ok) {
            const transData = await transResponse.json();
            console.log('Transcripts:', JSON.stringify(transData, null, 2));

            if (transData.transcripts && transData.transcripts.length > 0) {
              for (const transcript of transData.transcripts) {
                if (transcript.state === 'FILE_GENERATED' && transcript.docsDestination?.exportUri) {
                  transcriptLink = transcript.docsDestination.exportUri;
                  console.log('Transcript ready:', transcriptLink);
                  break;
                }
              }
            }
          } else {
            console.log('Transcript fetch failed or no transcripts available');
          }
        }

        if (recordingLink && transcriptLink) break;
      }

      if (recordingLink) {
        recordings[slot.id] = recordingLink;
      }
      if (transcriptLink) {
        transcripts[slot.id] = transcriptLink;
      }

      results.push({ 
        slotId: slot.id, 
        status: recordingLink || transcriptLink ? 'found' : 'no_recording',
        recordingLink: recordingLink || undefined,
        transcriptLink: transcriptLink || undefined
      });
    }

    // Save updated recordings to app_settings
    if (Object.keys(recordings).length > 0) {
      await supabase
        .from('app_settings')
        .upsert({
          key: `group_class_recordings_${targetDate}`,
          value: JSON.stringify(recordings),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      console.log('Saved recordings:', JSON.stringify(recordings, null, 2));
    }

    // Save updated transcripts to app_settings
    if (Object.keys(transcripts).length > 0) {
      await supabase
        .from('app_settings')
        .upsert({
          key: `group_class_transcripts_${targetDate}`,
          value: JSON.stringify(transcripts),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      console.log('Saved transcripts:', JSON.stringify(transcripts, null, 2));
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: targetDate,
        results,
        totalRecordings: Object.keys(recordings).length,
        totalTranscripts: Object.keys(transcripts).length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in sync-group-class-recordings:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
