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
  const match = meetLink.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return match ? match[1] : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slotId, studentId } = await req.json();
    
    if (!slotId) {
      return new Response(
        JSON.stringify({ error: 'slotId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!studentId) {
      return new Response(
        JSON.stringify({ error: 'studentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the quad slot details
    const { data: slot, error: slotError } = await supabase
      .from('quad_slots')
      .select('id, meet_link, slot_date, start_time, end_time, tutor_id, recording_link, timezone, course, subject')
      .eq('id', slotId)
      .single();

    if (slotError || !slot) {
      console.error('Slot fetch error:', slotError);
      return new Response(
        JSON.stringify({ error: 'Quad slot not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!slot.meet_link) {
      return new Response(
        JSON.stringify({ error: 'No Meet link associated with this slot' }),
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

    console.log('Processing quad slot:', slotId, 'Student:', studentId, 'Meeting code:', meetingCode);

    // Get Google tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('google_calendar_tokens')
      .select('access_token, refresh_token, token_expiry')
      .eq('user_id', SYSTEM_USER_ID)
      .single();

    if (tokenError || !tokenData) {
      console.error('Token fetch error:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Google Calendar not connected. Please contact admin.' }),
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

    // Calculate slot start/end in UTC
    const slotDateStr = slot.slot_date;
    const startTimeStr = slot.start_time;
    const endTimeStr = slot.end_time;
    const timezone = slot.timezone || 'Australia/Melbourne';

    // For Melbourne timezone, we'll approximate the UTC offset
    // Melbourne is UTC+10 or UTC+11 during DST
    // This is a simplified approach - for production, use proper timezone library
    const slotStartLocal = new Date(`${slotDateStr}T${startTimeStr}`);
    const slotEndLocal = new Date(`${slotDateStr}T${endTimeStr}`);
    
    // Add buffer for time window matching
    const windowStart = new Date(slotStartLocal.getTime() - 60 * 60 * 1000); // 1 hour before
    const windowEnd = new Date(slotEndLocal.getTime() + 60 * 60 * 1000); // 1 hour after

    console.log('Slot time window (local):', slotStartLocal.toISOString(), 'to', slotEndLocal.toISOString());

    // Fetch student's email for matching
    const { data: studentProfile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', studentId)
      .single();

    const studentEmail = (studentProfile?.email || '').toLowerCase();
    console.log('Student email for matching:', studentEmail);

    // Fetch conference records from Google Meet API
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
    console.log('Conference records count:', confData.conferenceRecords?.length || 0);

    if (!confData.conferenceRecords || confData.conferenceRecords.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No attendance data yet - meeting may not have started or no Google Meet data available',
          attendance: null
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    type ParticipantAgg = {
      participantId: string;
      email: string | null;
      totalMinutes: number;
      firstJoin: string | null;
      lastLeave: string | null;
      sessions: Array<{ joinTime: string; leaveTime: string }>;
    };

    const participantsAgg = new Map<string, ParticipantAgg>();

    let recordingLink: string | null = slot.recording_link;
    let recordingStatus: 'ready' | 'processing' | 'not_found' = recordingLink ? 'ready' : 'not_found';

    for (const record of confData.conferenceRecords) {
      const recordName = record.name;
      const confStartTime = record.startTime ? new Date(record.startTime) : null;
      const confEndTime = record.endTime ? new Date(record.endTime) : null;

      console.log('Processing conference record:', recordName, 'Start:', confStartTime?.toISOString());

      // Fetch participants
      const participantsUrl = `https://meet.googleapis.com/v2/${recordName}/participants`;
      const partResponse = await fetch(participantsUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!partResponse.ok) {
        console.error('Participants fetch failed:', await partResponse.text());
        continue;
      }

      const partData = await partResponse.json();
      console.log('Participants count:', partData.participants?.length || 0);

      if (!partData.participants) continue;

      for (const participant of partData.participants) {
        const participantId: string = participant?.name;

        const rawEmail =
          participant?.signedinUser?.user?.email ||
          participant?.signedinUser?.user?.emailAddress ||
          participant?.signedinUser?.user?.primaryEmail ||
          null;
        const participantEmail = rawEmail ? String(rawEmail).toLowerCase() : null;

        // Only process if this is the student we're looking for
        if (studentEmail && participantEmail && participantEmail !== studentEmail) {
          continue;
        }

        // Fetch participant sessions
        const sessionsUrl = `https://meet.googleapis.com/v2/${participantId}/participantSessions`;
        const sessResponse = await fetch(sessionsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!sessResponse.ok) {
          console.error('Sessions fetch failed:', await sessResponse.text());
          continue;
        }

        const sessData = await sessResponse.json();

        if (!sessData.participantSessions) continue;

        let participantFirstJoin: string | null = null;
        let participantLastLeave: string | null = null;
        const participantSessions: Array<{ joinTime: string; leaveTime: string }> = [];

        for (const session of sessData.participantSessions) {
          if (session.startTime && session.endTime) {
            const joinTime = new Date(session.startTime);
            const leaveTime = new Date(session.endTime);

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

        // Merge overlapping intervals
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
            existing.totalMinutes += participantTotalMinutes;
            existing.sessions.push(...participantSessions);
            if (!existing.firstJoin || (participantFirstJoin && new Date(participantFirstJoin) < new Date(existing.firstJoin))) {
              existing.firstJoin = participantFirstJoin;
            }
            if (!existing.lastLeave || (participantLastLeave && new Date(participantLastLeave) > new Date(existing.lastLeave))) {
              existing.lastLeave = participantLastLeave;
            }
          }
        }
      }

      // Fetch recordings
      if (!recordingLink) {
        const recordingsUrl = `https://meet.googleapis.com/v2/${recordName}/recordings`;
        const recResponse = await fetch(recordingsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (recResponse.ok) {
          const recData = await recResponse.json();
          if (recData.recordings && recData.recordings.length > 0) {
            for (const recording of recData.recordings) {
              if (recording.state === 'FILE_GENERATED' && recording.driveDestination?.exportUri) {
                recordingLink = recording.driveDestination.exportUri;
                recordingStatus = 'ready';
                break;
              } else if (recording.state === 'ENDED' || recording.state === 'STARTED') {
                recordingStatus = 'processing';
              }
            }
          }
        }
      }
    }

    // Select best matching participant
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

    if (!selected) {
      return new Response(
        JSON.stringify({ 
          message: 'No matching attendance data found for this student in the meeting',
          attendance: null
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate scheduled duration (from slot times)
    const scheduledDurationMinutes = Math.round(
      (slotEndLocal.getTime() - slotStartLocal.getTime()) / 60000
    );

    const attendancePercent = Math.min(100, Math.round((selected.totalMinutes / scheduledDurationMinutes) * 100));

    console.log('Attendance result:', {
      studentId,
      totalMinutes: selected.totalMinutes,
      scheduledMinutes: scheduledDurationMinutes,
      percent: attendancePercent,
      firstJoin: selected.firstJoin,
      lastLeave: selected.lastLeave,
    });

    // Upsert the attendance_logs row with the synced data
    const attendanceMeta = {
      synced: true,
      synced_at: new Date().toISOString(),
      actual_duration_minutes: selected.totalMinutes,
      scheduled_duration_minutes: scheduledDurationMinutes,
      join_time: selected.firstJoin,
      leave_time: selected.lastLeave,
      attendance_percent: attendancePercent,
    };

    const course = (slot.course || slot.subject) as string;

    const { data: existingLog, error: existingLogError } = await supabase
      .from('attendance_logs')
      .select('id, source')
      .eq('student_id', studentId)
      .eq('session_ref_id', slotId)
      .eq('course', course)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingLogError) {
      console.error('Failed to check existing attendance_logs:', existingLogError);
    }

    if (existingLog?.id) {
      const { error: updateError } = await supabase
        .from('attendance_logs')
        .update({
          meta: attendanceMeta,
          joined_at: selected.firstJoin || undefined,
          source: existingLog.source || 'meet_sync',
        })
        .eq('id', existingLog.id);

      if (updateError) {
        console.error('Failed to update attendance_logs:', updateError);
      }
    } else {
      const { error: insertError } = await supabase
        .from('attendance_logs')
        .insert({
          student_id: studentId,
          session_ref_id: slotId,
          course,
          source: 'meet_sync',
          joined_at: selected.firstJoin,
          meta: attendanceMeta,
        });

      if (insertError) {
        console.error('Failed to insert attendance_logs:', insertError);
      }
    }

    // Update quad_slot recording link if found
    if (recordingLink && !slot.recording_link) {
      await supabase
        .from('quad_slots')
        .update({ recording_link: recordingLink })
        .eq('id', slotId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        attendance: {
          scheduledDurationMinutes,
          actualDurationMinutes: selected.totalMinutes,
          attendancePercent,
          joinTime: selected.firstJoin,
          leaveTime: selected.lastLeave,
          sessionsCount: selected.sessions.length,
        },
        recordingStatus,
        recordingLink,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in fetch-quad-attendance:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
