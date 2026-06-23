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
    const { eventId, calendarId } = await req.json();

    if (!eventId) {
      return new Response(
        JSON.stringify({ error: 'Event ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Deleting calendar event:', eventId, 'from calendar:', calendarId);

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
        JSON.stringify({ error: 'Google Calendar not connected' }),
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

    // Use provided calendarId or fall back to token's default or 'primary'
    const targetCalendarId = calendarId || tokenData.calendar_id || 'primary';
    
    // Add sendUpdates=none to disable email notifications
    const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;
    
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    // 404 = not found, 410 = already deleted - both mean event doesn't exist, which is fine
    if (!deleteResponse.ok && deleteResponse.status !== 404 && deleteResponse.status !== 410) {
      const errorData = await deleteResponse.text();
      console.error('Failed to delete calendar event:', errorData);
      return new Response(
        JSON.stringify({ error: 'Failed to delete calendar event', details: errorData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (deleteResponse.status === 410) {
      console.log('Calendar event already deleted:', eventId);
    }

    console.log('Calendar event deleted successfully:', eventId);

    return new Response(
      JSON.stringify({ success: true, eventId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error deleting calendar event:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
