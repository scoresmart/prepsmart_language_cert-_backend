import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Dedicated system user ID for Syeda's calendar tokens
const SYEDA_USER_ID = '00000000-0000-0000-0000-000000000003';

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      console.error('OAuth error:', error);
      return new Response(
        `<html><body><h1>Authorization Failed</h1><p>${error}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!code) {
      return new Response(
        '<html><body><h1>No authorization code received</h1></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    const clientId = Deno.env.get('SYEDA_GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('SYEDA_GOOGLE_CLIENT_SECRET');
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/syeda-calendar-callback`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log('Syeda token exchange status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      return new Response(
        `<html><body><h1>Token Exchange Failed</h1><p>${JSON.stringify(tokenData)}</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);

    const { error: upsertError } = await supabase
      .from('google_calendar_tokens')
      .upsert({
        user_id: SYEDA_USER_ID,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expiry: tokenExpiry.toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('Failed to store Syeda tokens:', upsertError);
      return new Response(
        `<html><body><h1>Failed to store tokens</h1><p>${upsertError.message}</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    console.log('Syeda Google Calendar tokens stored successfully');

    return new Response(
      `<html>
        <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f0f0;">
          <div style="text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: #22c55e;">✓ Syeda's Google Calendar Connected!</h1>
            <p>Session bookings will now automatically appear in your Google Calendar.</p>
            <p>You can close this window now.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </div>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (error: unknown) {
    console.error('Syeda callback error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      `<html><body><h1>Error</h1><p>${message}</p></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
});
