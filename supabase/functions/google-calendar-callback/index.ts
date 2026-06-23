import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-calendar-callback`;

    // Exchange code for tokens
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
    console.log('Token exchange response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      return new Response(
        `<html><body><h1>Token Exchange Failed</h1><p>${JSON.stringify(tokenData)}</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Store tokens in database using service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);

    // Use a system user ID for admin-level calendar access
    const systemUserId = '00000000-0000-0000-0000-000000000001';

    const { error: upsertError } = await supabase
      .from('google_calendar_tokens')
      .upsert({
        user_id: systemUserId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expiry: tokenExpiry.toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('Failed to store tokens:', upsertError);
      return new Response(
        `<html><body><h1>Failed to store tokens</h1><p>${upsertError.message}</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    console.log('Google Calendar tokens stored successfully');

    return new Response(
      `<html>
        <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f0f0;">
          <div style="text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: #22c55e;">✓ Google Calendar Connected!</h1>
            <p>You can close this window now.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </div>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (error: unknown) {
    console.error('Callback error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      `<html><body><h1>Error</h1><p>${message}</p></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
});
