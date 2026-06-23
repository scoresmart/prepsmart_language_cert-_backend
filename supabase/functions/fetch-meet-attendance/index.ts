import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  // Extract meeting code from URLs like:
  // https://meet.google.com/abc-defg-hij
  // meet.google.com/abc-defg-hij
  const match = meetLink.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return match ? match[1] : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slotId } = await req.json();
    
    if (!slotId) {
      return new Response(
        JSON.stringify({ error: 'slotId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the slot details
    const { data: slot, error: slotError } = await supabase
      .from('one_to_one_slots')
      .select('id, meet_link, starts_at, ends_at, student_id, tutor_id, recording_link')
      .eq('id', slotId)
      .single();

    if (slotError || !slot) {
      console.error('Slot fetch error:', slotError);
      return new Response(
        JSON.stringify({ error: 'Slot not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!slot.meet_link) {
      return new Response(
        JSON.stringify({ error: 'No Meet link associated with this slot' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!slot.student_id) {
      return new Response(
        JSON.stringify({ error: 'No student booked for this slot' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const meetingCode = extractMeetingCode(slot.meet_link);
    if (!meetingCode) {
      return new Response(
        JSON.stringify({ error: 'Could not extract meeting code from Meet link' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing slot:', slotId, 'Meeting code:', meetingCode);

    // Get Google tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens')
      .select('access_token, refresh_token, token_expiry')
      .eq('user_id', SYSTEM_USER_ID)
      .single();

    if (tokenError || !tokenData) {
      console.error('Token fetch error:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Google Calendar not connected. Please reconnect in admin settings.' }),
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

      // Update token in database
      await supabase
        .from('google_calendar_tokens')
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', SYSTEM_USER_ID);
    }

    // Fetch conference records from Google Meet API
    // The filter must use correct syntax: space.meeting_code = "value" (with spaces around =)
    const filter = `space.meeting_code = "${meetingCode}"`;
    const conferenceRecordsUrl = `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}`;
    console.log('Fetching conference records:', conferenceRecordsUrl);

    const confResponse = await fetch(conferenceRecordsUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!confResponse.ok) {
      const error = await confResponse.text();
      console.error('Conference records fetch failed:', confResponse.status, error);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch meeting data from Google Meet API',
          details: error,
          status: confResponse.status
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const confData = await confResponse.json();
    console.log('Conference records:', JSON.stringify(confData, null, 2));

    if (!confData.conferenceRecords || confData.conferenceRecords.length === 0) {
      // Update last_sync_at even if no data
      await supabase
        .from('one_to_one_slots')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', slotId);

      return new Response(
        JSON.stringify({ 
          message: 'No attendance data yet - meeting may not have started',
          attendance: null,
          recordingStatus: null
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Define time window for this slot (with 30 min buffer on each side)
    const slotStart = new Date(slot.starts_at);
    const slotEnd = new Date(slot.ends_at);
    const windowStart = new Date(slotStart.getTime() - 30 * 60 * 1000); // 30 min before
    const windowEnd = new Date(slotEnd.getTime() + 60 * 60 * 1000); // 60 min after

    console.log('Slot time window:', windowStart.toISOString(), 'to', windowEnd.toISOString());

    // Fetch student's email (used to identify the correct participant)
    const { data: studentProfile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', slot.student_id)
      .single();

    const studentEmail = (studentProfile?.email || '').toLowerCase();
    if (studentEmail) console.log('Student email for matching:', studentEmail);

    type ParticipantAgg = {
      participantId: string;
      email: string | null;
      totalMinutes: number;
      firstJoin: string | null;
      lastLeave: string | null;
      sessions: Array<{ joinTime: string; leaveTime: string }>;
    };

    // IMPORTANT: We must NOT sum across all participants, otherwise time gets multiplied.
    const participantsAgg = new Map<string, ParticipantAgg>();

    let allSessions: Array<{ joinTime: string; leaveTime: string }> = [];
    let totalDurationMinutes = 0;
    let firstJoin: string | null = null;
    let lastLeave: string | null = null;
    let meetParticipantId: string | null = null;

    let recordingLink: string | null = slot.recording_link;
    let recordingStatus: 'ready' | 'processing' | 'not_found' = 'not_found';

    for (const record of confData.conferenceRecords) {
      const recordName = record.name; // e.g., "conferenceRecords/xxx"

      // Check if this conference record falls within our slot's time window
      const confStartTime = record.startTime ? new Date(record.startTime) : null;
      const confEndTime = record.endTime ? new Date(record.endTime) : null;

      // Skip conference records that are clearly outside our time window
      if (confStartTime && confStartTime > windowEnd) {
        console.log('Skipping conference record - starts after window:', confStartTime.toISOString());
        continue;
      }
      if (confEndTime && confEndTime < windowStart) {
        console.log('Skipping conference record - ends before window:', confEndTime.toISOString());
        continue;
      }

      console.log(
        'Processing conference record:',
        recordName,
        'Start:',
        confStartTime?.toISOString(),
        'End:',
        confEndTime?.toISOString(),
      );

      // Fetch participants
      const participantsUrl = `https://meet.googleapis.com/v2/${recordName}/participants`;
      console.log('Fetching participants:', participantsUrl);

      const partResponse = await fetch(participantsUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!partResponse.ok) {
        console.error('Participants fetch failed:', await partResponse.text());
        continue;
      }

      const partData = await partResponse.json();
      console.log('Participants:', JSON.stringify(partData, null, 2));

      if (!partData.participants) continue;

      for (const participant of partData.participants) {
        const participantId: string = participant?.name;

        // Best-effort email extraction (Google Meet API fields vary)
        const rawEmail =
          participant?.signedinUser?.user?.email ||
          participant?.signedinUser?.user?.emailAddress ||
          participant?.signedinUser?.user?.primaryEmail ||
          null;
        const participantEmail = rawEmail ? String(rawEmail).toLowerCase() : null;

        // Fetch participant sessions (join/leave times)
        const sessionsUrl = `https://meet.googleapis.com/v2/${participantId}/participantSessions`;
        console.log('Fetching sessions:', sessionsUrl);

        const sessResponse = await fetch(sessionsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!sessResponse.ok) {
          console.error('Sessions fetch failed:', await sessResponse.text());
          continue;
        }

        const sessData = await sessResponse.json();
        console.log('Sessions:', JSON.stringify(sessData, null, 2));

        if (!sessData.participantSessions) continue;

        let participantFirstJoin: string | null = null;
        let participantLastLeave: string | null = null;

        // Collect raw overlapping intervals (Meet can return multiple overlapping sessions for same user)
        const participantSessions: Array<{ joinTime: string; leaveTime: string }> = [];

        for (const session of sessData.participantSessions) {
          if (session.startTime && session.endTime) {
            const joinTime = new Date(session.startTime);
            const leaveTime = new Date(session.endTime);

            // Only include sessions that overlap with our slot's time window
            if (leaveTime < windowStart || joinTime > windowEnd) continue;

            participantSessions.push({
              joinTime: session.startTime,
              leaveTime: session.endTime,
            });

            if (!participantFirstJoin || joinTime < new Date(participantFirstJoin)) {
              participantFirstJoin = session.startTime;
            }
            if (!participantLastLeave || leaveTime > new Date(participantLastLeave)) {
              participantLastLeave = session.endTime;
            }
          }
        }

        // Merge overlapping intervals so we don't double-count time
        const sorted = participantSessions
          .map((s) => ({ start: new Date(s.joinTime), end: new Date(s.leaveTime) }))
          .sort((a, b) => a.start.getTime() - b.start.getTime());

        const merged: Array<{ start: Date; end: Date }> = [];
        for (const seg of sorted) {
          const last = merged[merged.length - 1];
          if (!last || seg.start.getTime() > last.end.getTime()) {
            merged.push({ ...seg });
          } else {
            if (seg.end.getTime() > last.end.getTime()) last.end = seg.end;
          }
        }

        const participantTotalMinutes = merged.reduce((sum, seg) => {
          return sum + Math.round((seg.end.getTime() - seg.start.getTime()) / 60000);
        }, 0);

        if (participantTotalMinutes > 0) {
          const existing = participantsAgg.get(participantId);
          if (!existing) {
            participantsAgg.set(participantId, {
              participantId,
              email: participantEmail,
              totalMinutes: participantTotalMinutes,
              firstJoin: participantFirstJoin,
              lastLeave: participantLastLeave,
              sessions: participantSessions,
            });
          } else {
            // Merge across conference records if necessary
            existing.totalMinutes += participantTotalMinutes;
            existing.sessions.push(...participantSessions);
            if (!existing.firstJoin || (participantFirstJoin && new Date(participantFirstJoin) < new Date(existing.firstJoin))) {
              existing.firstJoin = participantFirstJoin;
            }
            if (!existing.lastLeave || (participantLastLeave && new Date(participantLastLeave) > new Date(existing.lastLeave))) {
              existing.lastLeave = participantLastLeave;
            }
            if (!existing.email && participantEmail) existing.email = participantEmail;
          }
        }
      }

      // Fetch recordings for this conference record if we don't already have a recording link
      if (!recordingLink) {
        const recordingsUrl = `https://meet.googleapis.com/v2/${recordName}/recordings`;
        console.log('Fetching recordings:', recordingsUrl);

        const recResponse = await fetch(recordingsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (recResponse.ok) {
          const recData = await recResponse.json();
          console.log('Recordings:', JSON.stringify(recData, null, 2));

          if (recData.recordings && recData.recordings.length > 0) {
            for (const recording of recData.recordings) {
              if (recording.state === 'FILE_GENERATED' && recording.driveDestination?.exportUri) {
                recordingLink = recording.driveDestination.exportUri;
                recordingStatus = 'ready';
                console.log('Recording ready:', recordingLink);
                break;
              } else if (recording.state === 'ENDED' || recording.state === 'STARTED') {
                recordingStatus = 'processing';
                console.log('Recording still processing, state:', recording.state);
              }
            }
          }
        } else {
          console.error('Recordings fetch failed:', await recResponse.text());
        }
      } else {
        recordingStatus = 'ready';
      }
    }

    // Re-merge intervals across conference records for each participant
    // to avoid double-counting overlapping sessions from multiple conference records
    for (const [key, agg] of participantsAgg.entries()) {
      const sorted = agg.sessions
        .map((s) => ({ start: new Date(s.joinTime), end: new Date(s.leaveTime) }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      const merged: Array<{ start: Date; end: Date }> = [];
      for (const seg of sorted) {
        const last = merged[merged.length - 1];
        if (!last || seg.start.getTime() > last.end.getTime()) {
          merged.push({ ...seg });
        } else {
          if (seg.end.getTime() > last.end.getTime()) last.end = seg.end;
        }
      }

      agg.totalMinutes = merged.reduce((sum, seg) => {
        return sum + Math.round((seg.end.getTime() - seg.start.getTime()) / 60000);
      }, 0);
    }

    // Choose the correct participant:
    // 1) If we can match by student email, use that.
    // 2) Otherwise use the participant with the largest total minutes (best heuristic).
    let selected: ParticipantAgg | null = null;

    if (studentEmail) {
      for (const p of participantsAgg.values()) {
        if (p.email && p.email === studentEmail) {
          selected = p;
          break;
        }
      }
    }

    if (!selected) {
      for (const p of participantsAgg.values()) {
        if (!selected || p.totalMinutes > selected.totalMinutes) selected = p;
      }
    }

    if (selected) {
      totalDurationMinutes = selected.totalMinutes;
      firstJoin = selected.firstJoin;
      lastLeave = selected.lastLeave;
      allSessions = selected.sessions;
      meetParticipantId = selected.participantId;

      console.log('Selected participant for attendance:', {
        meetParticipantId,
        email: selected.email,
        totalDurationMinutes,
        sessionsCount: allSessions.length,
      });
    } else {
      console.log('No matching participant sessions found within time window.');
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
      .eq('id', slotId);

    // Upsert attendance record
    const { data: attendance, error: upsertError } = await supabase
      .from('session_attendance')
      .upsert({
        slot_id: slotId,
        student_id: slot.student_id,
        meet_participant_id: meetParticipantId,
        scheduled_duration_minutes: scheduledDurationMinutes,
        actual_duration_minutes: totalDurationMinutes,
        join_time: firstJoin,
        leave_time: lastLeave,
        raw_sessions: allSessions,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'slot_id,student_id',
      })
      .select()
      .single();

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save attendance data', details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Attendance saved:', attendance);

    return new Response(
      JSON.stringify({
        success: true,
        attendance: {
          scheduledDurationMinutes,
          actualDurationMinutes: totalDurationMinutes,
          joinTime: firstJoin,
          leaveTime: lastLeave,
          sessionsCount: allSessions.length,
        },
        recordingStatus,
        recordingLink,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in fetch-meet-attendance:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
