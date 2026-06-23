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
  const match = meetLink.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return match ? match[1] : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('Starting auto-sync-quad-attendance at', new Date().toISOString());

  try {
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
      console.error('No Google Calendar tokens found');
      return new Response(
        JSON.stringify({ error: 'Google Calendar not connected' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = tokenData.access_token;
    const tokenExpiry = new Date(tokenData.token_expiry);

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

    // Find quad_slots that ended between 1-2 hours ago (Melbourne time)
    // We check slots that have meet_link and haven't been synced yet
    const now = new Date();
    const melbourneOffset = 11 * 60; // AEDT is UTC+11 (summer), AEST is UTC+10
    const melbourneNow = new Date(now.getTime() + melbourneOffset * 60 * 1000);
    
    const todayMelbourne = melbourneNow.toISOString().split('T')[0];
    const yesterdayMelbourne = new Date(melbourneNow.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log('Checking slots for dates:', todayMelbourne, 'and', yesterdayMelbourne);

    // Find slots from today and yesterday that have meet links
    const { data: slots, error: slotsError } = await supabase
      .from('quad_slots')
      .select('id, meet_link, slot_date, start_time, end_time, course, subject, timezone')
      .in('slot_date', [todayMelbourne, yesterdayMelbourne])
      .not('meet_link', 'is', null)
      .eq('status', 'scheduled')
      .order('slot_date', { ascending: false })
      .order('end_time', { ascending: false });

    if (slotsError) {
      console.error('Error fetching slots:', slotsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch slots' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Found', slots?.length || 0, 'slots with meet links');

    // Filter to slots that ended 1-3 hours ago
    const oneHourAgo = new Date(melbourneNow.getTime() - 60 * 60 * 1000);
    const threeHoursAgo = new Date(melbourneNow.getTime() - 3 * 60 * 60 * 1000);

    const slotsToSync = (slots || []).filter(slot => {
      const slotEnd = new Date(`${slot.slot_date}T${slot.end_time}`);
      return slotEnd <= oneHourAgo && slotEnd >= threeHoursAgo;
    });

    console.log('Slots to sync (ended 1-3 hours ago):', slotsToSync.length);

    if (slotsToSync.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No slots to sync', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let totalSynced = 0;
    let totalErrors = 0;

    for (const slot of slotsToSync) {
      const meetingCode = extractMeetingCode(slot.meet_link);
      if (!meetingCode) {
        console.log('Could not extract meeting code for slot:', slot.id);
        continue;
      }

      console.log('Processing slot:', slot.id, 'Meeting code:', meetingCode);

      // Get all students who booked this slot
      const { data: bookings, error: bookingsError } = await supabase
        .from('quad_bookings')
        .select('student_id, profiles!inner(email)')
        .eq('slot_id', slot.id)
        .eq('status', 'scheduled');

      if (bookingsError || !bookings?.length) {
        console.log('No bookings found for slot:', slot.id);
        continue;
      }

      console.log('Found', bookings.length, 'bookings for slot:', slot.id);

      // Fetch conference records
      const filter = `space.meeting_code = "${meetingCode}"`;
      const conferenceRecordsUrl = `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}`;

      const confResponse = await fetch(conferenceRecordsUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!confResponse.ok) {
        console.error('Conference records fetch failed for slot:', slot.id);
        continue;
      }

      const confData = await confResponse.json();
      if (!confData.conferenceRecords?.length) {
        console.log('No conference records for slot:', slot.id);
        continue;
      }

      // Build participant map from all conference records
      const participantsByEmail = new Map<string, {
        totalMinutes: number;
        firstJoin: string | null;
        lastLeave: string | null;
      }>();

      for (const record of confData.conferenceRecords) {
        const recordName = record.name;

        const participantsUrl = `https://meet.googleapis.com/v2/${recordName}/participants`;
        const partResponse = await fetch(participantsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!partResponse.ok) continue;

        const partData = await partResponse.json();
        if (!partData.participants) continue;

        for (const participant of partData.participants) {
          const participantId = participant?.name;
          const rawEmail =
            participant?.signedinUser?.user?.email ||
            participant?.signedinUser?.user?.emailAddress ||
            participant?.signedinUser?.user?.primaryEmail ||
            null;
          
          if (!rawEmail) continue;
          const email = String(rawEmail).toLowerCase();

          // Fetch sessions
          const sessionsUrl = `https://meet.googleapis.com/v2/${participantId}/participantSessions`;
          const sessResponse = await fetch(sessionsUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!sessResponse.ok) continue;
          const sessData = await sessResponse.json();
          if (!sessData.participantSessions) continue;

          let firstJoin: string | null = null;
          let lastLeave: string | null = null;
          const sessions: Array<{ start: Date; end: Date }> = [];

          for (const session of sessData.participantSessions) {
            if (session.startTime && session.endTime) {
              const joinTime = new Date(session.startTime);
              const leaveTime = new Date(session.endTime);
              sessions.push({ start: joinTime, end: leaveTime });

              if (!firstJoin || joinTime < new Date(firstJoin)) {
                firstJoin = session.startTime;
              }
              if (!lastLeave || leaveTime > new Date(lastLeave)) {
                lastLeave = session.endTime;
              }
            }
          }

          // Merge overlapping intervals
          sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
          const merged: Array<{ start: Date; end: Date }> = [];
          for (const seg of sessions) {
            const last = merged[merged.length - 1];
            if (!last || seg.start.getTime() > last.end.getTime()) {
              merged.push({ ...seg });
            } else if (seg.end.getTime() > last.end.getTime()) {
              last.end = seg.end;
            }
          }

          const totalMinutes = merged.reduce((sum, seg) => {
            return sum + Math.round((seg.end.getTime() - seg.start.getTime()) / 60000);
          }, 0);

          const existing = participantsByEmail.get(email);
          if (!existing) {
            participantsByEmail.set(email, { totalMinutes, firstJoin, lastLeave });
          } else {
            existing.totalMinutes += totalMinutes;
            if (!existing.firstJoin || (firstJoin && new Date(firstJoin) < new Date(existing.firstJoin))) {
              existing.firstJoin = firstJoin;
            }
            if (!existing.lastLeave || (lastLeave && new Date(lastLeave) > new Date(existing.lastLeave))) {
              existing.lastLeave = lastLeave;
            }
          }
        }
      }

      console.log('Found', participantsByEmail.size, 'unique participants in meeting');

      // Calculate scheduled duration
      const slotStartLocal = new Date(`${slot.slot_date}T${slot.start_time}`);
      const slotEndLocal = new Date(`${slot.slot_date}T${slot.end_time}`);
      const scheduledDurationMinutes = Math.round((slotEndLocal.getTime() - slotStartLocal.getTime()) / 60000);
      const course = (slot.course || slot.subject) as string;

      // Match bookings to participants and update attendance
      for (const booking of bookings) {
        const studentEmail = ((booking.profiles as any)?.email || '').toLowerCase();
        if (!studentEmail) continue;

        const participation = participantsByEmail.get(studentEmail);
        if (!participation || participation.totalMinutes <= 0) continue;

        const attendancePercent = Math.min(100, Math.round((participation.totalMinutes / scheduledDurationMinutes) * 100));

        const attendanceMeta = {
          synced: true,
          synced_at: new Date().toISOString(),
          actual_duration_minutes: participation.totalMinutes,
          scheduled_duration_minutes: scheduledDurationMinutes,
          join_time: participation.firstJoin,
          leave_time: participation.lastLeave,
          attendance_percent: attendancePercent,
          auto_synced: true,
        };

        // Check if attendance log exists
        const { data: existingLog } = await supabase
          .from('attendance_logs')
          .select('id, source')
          .eq('student_id', booking.student_id)
          .eq('session_ref_id', slot.id)
          .eq('course', course)
          .order('joined_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingLog?.id) {
          // Skip if already synced
          const { data: checkLog } = await supabase
            .from('attendance_logs')
            .select('meta')
            .eq('id', existingLog.id)
            .single();

          if ((checkLog?.meta as any)?.synced) {
            console.log('Already synced:', booking.student_id, slot.id);
            continue;
          }

          const { error: updateError } = await supabase
            .from('attendance_logs')
            .update({
              meta: attendanceMeta,
              joined_at: participation.firstJoin || undefined,
            })
            .eq('id', existingLog.id);

          if (updateError) {
            console.error('Update error:', updateError);
            totalErrors++;
          } else {
            totalSynced++;
          }
        } else {
          const { error: insertError } = await supabase
            .from('attendance_logs')
            .insert({
              student_id: booking.student_id,
              session_ref_id: slot.id,
              course,
              source: 'auto_meet_sync',
              joined_at: participation.firstJoin,
              meta: attendanceMeta,
            });

          if (insertError) {
            console.error('Insert error:', insertError);
            totalErrors++;
          } else {
            totalSynced++;
          }
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Auto-sync completed in ${elapsed}ms. Synced: ${totalSynced}, Errors: ${totalErrors}`);

    return new Response(
      JSON.stringify({
        success: true,
        slotsProcessed: slotsToSync.length,
        attendanceSynced: totalSynced,
        errors: totalErrors,
        elapsedMs: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in auto-sync-quad-attendance:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
