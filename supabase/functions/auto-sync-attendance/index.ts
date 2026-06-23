import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// System user ID for Google Calendar tokens
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

interface OneToOneSlotToSync {
  id: string;
  meet_link: string;
  starts_at: string;
  ends_at: string;
  student_id: string;
  recording_link: string | null;
}

interface GroupSlotToSync {
  id: string;
  meet_link: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  recording_link: string | null;
}

// Fetch recording link from Google Meet API for a given meeting code
async function fetchRecordingFromMeet(
  accessToken: string,
  meetingCode: string,
  slotId: string
): Promise<{ recordingLink: string | null; recordingStatus: string }> {
  const filter = `space.meeting_code = "${meetingCode}"`;
  const conferenceRecordsUrl = `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}`;

  const confResponse = await fetch(conferenceRecordsUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!confResponse.ok) {
    const error = await confResponse.text();
    console.error(`Slot ${slotId}: Conference records fetch failed:`, error);
    return { recordingLink: null, recordingStatus: 'api_error' };
  }

  const confData = await confResponse.json();

  if (!confData.conferenceRecords || confData.conferenceRecords.length === 0) {
    console.log(`Slot ${slotId}: No conference records found`);
    return { recordingLink: null, recordingStatus: 'no_meeting_data' };
  }

  let recordingLink: string | null = null;
  let recordingStatus = 'not_found';

  for (const record of confData.conferenceRecords) {
    const recordName = record.name;
    const recordingsUrl = `https://meet.googleapis.com/v2/${recordName}/recordings`;
    const recResponse = await fetch(recordingsUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (recResponse.ok) {
      const recData = await recResponse.json();

      if (recData.recordings && recData.recordings.length > 0) {
        for (const recording of recData.recordings) {
          if (recording.state === 'FILE_GENERATED' && recording.driveDestination?.exportUri) {
            recordingLink = recording.driveDestination.exportUri;
            recordingStatus = 'ready';
            console.log(`Slot ${slotId}: Recording ready:`, recordingLink);
            break;
          } else if (recording.state === 'ENDED' || recording.state === 'STARTED') {
            recordingStatus = 'processing';
          }
        }
      }
    }

    if (recordingLink) break;
  }

  return { recordingLink, recordingStatus };
}

// Sync one-to-one slot attendance and recording
async function syncOneToOneSlot(
  supabase: SupabaseClient,
  accessToken: string,
  slot: OneToOneSlotToSync
): Promise<{ success: boolean; error?: string; recordingStatus?: string }> {
  const meetingCode = extractMeetingCode(slot.meet_link);
  if (!meetingCode) {
    console.log(`O2O Slot ${slot.id}: Could not extract meeting code`);
    return { success: false, error: 'Invalid meeting code' };
  }

  console.log(`Processing O2O slot ${slot.id}, meeting code: ${meetingCode}`);

  // Fetch conference records from Google Meet API
  const filter = `space.meeting_code = "${meetingCode}"`;
  const conferenceRecordsUrl = `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}`;

  const confResponse = await fetch(conferenceRecordsUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!confResponse.ok) {
    const error = await confResponse.text();
    console.error(`O2O Slot ${slot.id}: Conference records fetch failed:`, error);
    
    await supabase
      .from('one_to_one_slots')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', slot.id);
    
    return { success: false, error: 'API fetch failed' };
  }

  const confData = await confResponse.json();

  if (!confData.conferenceRecords || confData.conferenceRecords.length === 0) {
    console.log(`O2O Slot ${slot.id}: No conference records found`);
    
    await supabase
      .from('one_to_one_slots')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', slot.id);
    
    return { success: true, recordingStatus: 'no_meeting_data' };
  }

  // Collect all participant sessions
  const allSessions: Array<{ joinTime: string; leaveTime: string }> = [];
  let totalDurationMinutes = 0;
  let firstJoin: string | null = null;
  let lastLeave: string | null = null;
  let recordingLink: string | null = slot.recording_link;
  let recordingStatus = 'not_found';

  for (const record of confData.conferenceRecords) {
    const recordName = record.name;

    // Fetch participants
    const participantsUrl = `https://meet.googleapis.com/v2/${recordName}/participants`;
    const partResponse = await fetch(participantsUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (partResponse.ok) {
      const partData = await partResponse.json();

      if (partData.participants) {
        for (const participant of partData.participants) {
          const sessionsUrl = `https://meet.googleapis.com/v2/${participant.name}/participantSessions`;
          const sessResponse = await fetch(sessionsUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });

          if (sessResponse.ok) {
            const sessData = await sessResponse.json();

            if (sessData.participantSessions) {
              for (const session of sessData.participantSessions) {
                if (session.startTime && session.endTime) {
                  const joinTime = new Date(session.startTime);
                  const leaveTime = new Date(session.endTime);
                  const durationMs = leaveTime.getTime() - joinTime.getTime();
                  totalDurationMinutes += Math.round(durationMs / 60000);

                  allSessions.push({
                    joinTime: session.startTime,
                    leaveTime: session.endTime,
                  });

                  if (!firstJoin || joinTime < new Date(firstJoin)) {
                    firstJoin = session.startTime;
                  }
                  if (!lastLeave || leaveTime > new Date(lastLeave)) {
                    lastLeave = session.endTime;
                  }
                }
              }
            }
          }
        }
      }
    }

    // Fetch recordings if we don't have one yet
    if (!recordingLink) {
      const recordingsUrl = `https://meet.googleapis.com/v2/${recordName}/recordings`;
      const recResponse = await fetch(recordingsUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (recResponse.ok) {
        const recData = await recResponse.json();

        if (recData.recordings && recData.recordings.length > 0) {
          for (const recording of recData.recordings) {
            if (recording.state === 'FILE_GENERATED' && recording.driveDestination?.exportUri) {
              recordingLink = recording.driveDestination.exportUri;
              recordingStatus = 'ready';
              console.log(`O2O Slot ${slot.id}: Recording ready:`, recordingLink);
              break;
            } else if (recording.state === 'ENDED' || recording.state === 'STARTED') {
              recordingStatus = 'processing';
            }
          }
        }
      }
    } else {
      recordingStatus = 'ready';
    }
  }

  // Calculate scheduled duration
  const scheduledStart = new Date(slot.starts_at);
  const scheduledEnd = new Date(slot.ends_at);
  const scheduledDurationMinutes = Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000);

  // Update the slot with recording link and last_sync_at
  const slotUpdate: Record<string, unknown> = {
    last_sync_at: new Date().toISOString(),
  };
  if (recordingLink && !slot.recording_link) {
    slotUpdate.recording_link = recordingLink;
  }

  await supabase
    .from('one_to_one_slots')
    .update(slotUpdate)
    .eq('id', slot.id);

  // Upsert attendance record
  await supabase
    .from('session_attendance')
    .upsert({
      slot_id: slot.id,
      student_id: slot.student_id,
      scheduled_duration_minutes: scheduledDurationMinutes,
      actual_duration_minutes: totalDurationMinutes,
      join_time: firstJoin,
      leave_time: lastLeave,
      raw_sessions: allSessions,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'slot_id,student_id',
    });

  console.log(`O2O Slot ${slot.id}: Synced successfully - ${totalDurationMinutes} min, recording: ${recordingStatus}`);

  return { success: true, recordingStatus };
}

// Sync group class slot recording only (no individual attendance tracking)
async function syncGroupSlotRecording(
  supabase: SupabaseClient,
  accessToken: string,
  slot: GroupSlotToSync
): Promise<{ success: boolean; error?: string; recordingStatus?: string }> {
  const meetingCode = extractMeetingCode(slot.meet_link);
  if (!meetingCode) {
    console.log(`Group Slot ${slot.id}: Could not extract meeting code`);
    return { success: false, error: 'Invalid meeting code' };
  }

  console.log(`Processing Group slot ${slot.id}, meeting code: ${meetingCode}`);

  // If already has recording, just update sync timestamp
  if (slot.recording_link) {
    await supabase
      .from('quad_slots')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', slot.id);
    
    return { success: true, recordingStatus: 'ready' };
  }

  // Fetch recording from Google Meet API
  const { recordingLink, recordingStatus } = await fetchRecordingFromMeet(accessToken, meetingCode, slot.id);

  // Update the slot
  const updateData: Record<string, unknown> = {
    last_sync_at: new Date().toISOString(),
  };
  
  if (recordingLink) {
    updateData.recording_link = recordingLink;
  }

  await supabase
    .from('quad_slots')
    .update(updateData)
    .eq('id', slot.id);

  console.log(`Group Slot ${slot.id}: Synced - recording: ${recordingStatus}`);

  return { success: true, recordingStatus };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Auto-sync attendance & recordings starting...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const todayDate = new Date().toISOString().split('T')[0];

    // ============ SYNC ONE-TO-ONE SLOTS ============
    // Find O2O slots that need syncing:
    // 1. Ended sessions (ends_at < now)
    // 2. Have a student booked
    // 3. Have a meet link
    // 4. Either: never synced OR don't have a recording yet
    const { data: o2oSlotsToSync, error: o2oSlotsError } = await supabase
      .from('one_to_one_slots')
      .select('id, meet_link, starts_at, ends_at, student_id, recording_link, last_sync_at')
      .lt('ends_at', now)
      .not('student_id', 'is', null)
      .not('meet_link', 'is', null)
      .or(`last_sync_at.is.null,recording_link.is.null,last_sync_at.lt.${thirtyMinutesAgo}`)
      .order('ends_at', { ascending: false })
      .limit(10);

    if (o2oSlotsError) {
      console.error('Error fetching O2O slots:', o2oSlotsError);
    }

    console.log(`Found ${o2oSlotsToSync?.length || 0} O2O slots to sync`);

    const o2oResults: Array<{ slotId: string; type: string; success: boolean; recordingStatus?: string; error?: string }> = [];

    for (const slot of o2oSlotsToSync || []) {
      try {
        const result = await syncOneToOneSlot(supabase, accessToken, slot as OneToOneSlotToSync);
        o2oResults.push({ slotId: slot.id, type: 'one_to_one', ...result });
      } catch (err) {
        console.error(`Error syncing O2O slot ${slot.id}:`, err);
        o2oResults.push({ slotId: slot.id, type: 'one_to_one', success: false, error: String(err) });
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // ============ SYNC GROUP CLASS SLOTS ============
    // Find group slots that need recording sync:
    // 1. Ended sessions (slot_date + end_time < now)
    // 2. Have a meet link
    // 3. Either: never synced OR don't have a recording yet
    const { data: groupSlotsToSync, error: groupSlotsError } = await supabase
      .from('quad_slots')
      .select('id, meet_link, slot_date, start_time, end_time, recording_link, last_sync_at')
      .lte('slot_date', todayDate)
      .not('meet_link', 'is', null)
      .eq('status', 'scheduled')
      .or(`last_sync_at.is.null,recording_link.is.null,last_sync_at.lt.${thirtyMinutesAgo}`)
      .order('slot_date', { ascending: false })
      .limit(15);

    if (groupSlotsError) {
      console.error('Error fetching group slots:', groupSlotsError);
    }

    // Filter to only slots that have actually ended
    const nowTime = new Date();
    const endedGroupSlots = (groupSlotsToSync || []).filter(slot => {
      const slotEndDateTime = new Date(`${slot.slot_date}T${slot.end_time}`);
      // Assume Melbourne timezone - add 11 hours offset roughly
      return slotEndDateTime < nowTime;
    });

    console.log(`Found ${endedGroupSlots.length} Group slots to sync`);

    const groupResults: Array<{ slotId: string; type: string; success: boolean; recordingStatus?: string; error?: string }> = [];

    for (const slot of endedGroupSlots) {
      try {
        const result = await syncGroupSlotRecording(supabase, accessToken, slot as GroupSlotToSync);
        groupResults.push({ slotId: slot.id, type: 'group_class', ...result });
      } catch (err) {
        console.error(`Error syncing Group slot ${slot.id}:`, err);
        groupResults.push({ slotId: slot.id, type: 'group_class', success: false, error: String(err) });
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Combine results
    const allResults = [...o2oResults, ...groupResults];
    const successCount = allResults.filter(r => r.success).length;
    const recordingsReady = allResults.filter(r => r.recordingStatus === 'ready').length;

    console.log(`Auto-sync complete: ${successCount}/${allResults.length} successful, ${recordingsReady} recordings ready`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: allResults.length,
        successful: successCount,
        recordingsReady,
        o2oProcessed: o2oResults.length,
        groupProcessed: groupResults.length,
        results: allResults,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in auto-sync-attendance:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
