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

function extractDocIdFromUrl(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function extractMeetingCode(meetLink: string): string | null {
  const match = meetLink.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return match ? match[1] : null;
}

function toMelbourneDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
}

async function fetchMeetTranscriptLink(params: {
  accessToken: string;
  meetingCode: string;
  slotEndsAt: string;
}): Promise<{ transcriptLink: string | null; status: 'ready' | 'processing' | 'not_found' | 'api_error' }> {
  const { accessToken, meetingCode, slotEndsAt } = params;

  const slotDateMel = toMelbourneDate(slotEndsAt);
  const filter = `space.meeting_code = "${meetingCode}"`;
  const conferenceRecordsUrl = `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}`;

  const confResponse = await fetch(conferenceRecordsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!confResponse.ok) {
    const error = await confResponse.text();
    console.error('Conference records fetch failed:', confResponse.status, error);
    return { transcriptLink: null, status: 'api_error' };
  }

  const confData = await confResponse.json();
  const records: Array<any> = confData?.conferenceRecords || [];
  console.log('Conference records count:', records.length);
  if (records.length === 0) {
    return { transcriptLink: null, status: 'not_found' };
  }

  // Pick a record that matches the slot end date (Melbourne) when possible
  const matchingRecords = records.filter((r) => {
    if (!r?.endTime) return false;
    return toMelbourneDate(r.endTime) === slotDateMel;
  });

  const recordsToTry = (matchingRecords.length ? matchingRecords : records).slice(0, 10);

  let sawNonReadyTranscript = false;
  let sawPermissionError = false;

  for (const record of recordsToTry) {
    const recordName = record.name;
    const transcriptsUrl = `https://meet.googleapis.com/v2/${recordName}/transcripts`;

    const transResponse = await fetch(transcriptsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!transResponse.ok) {
      // Helpful diagnostics: most “transcript exists but we can’t access it” cases are 403s
      const body = await transResponse.text().catch(() => '');
      console.error('Transcripts fetch failed:', transResponse.status, body);
      if (transResponse.status === 401 || transResponse.status === 403) {
        sawPermissionError = true;
      }
      continue;
    }

    const transData = await transResponse.json();
    const transcripts: Array<any> = transData?.transcripts || [];
    console.log('Transcripts found for record:', recordName, transcripts.length);

    for (const transcript of transcripts) {
      console.log('Transcript state:', recordName, transcript?.state);
      if (transcript?.state === 'FILE_GENERATED' && transcript?.docsDestination?.exportUri) {
        return { transcriptLink: transcript.docsDestination.exportUri, status: 'ready' };
      }
      if (transcript?.state) sawNonReadyTranscript = true;
    }
  }

  return {
    transcriptLink: null,
    status: sawPermissionError ? 'api_error' : (sawNonReadyTranscript ? 'processing' : 'not_found'),
  };
}

async function fetchDocContent(docId: string, accessToken: string): Promise<string> {
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  
  const response = await fetch(exportUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Doc fetch failed:', response.status, error);
    throw new Error('Failed to fetch document content');
  }

  return response.text();
}

async function generateSummary(transcript: string): Promise<{ overview: string; topics: string[]; keyPoints: string[] }> {
  const openAIKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openAIKey) {
    throw new Error('OpenAI API key not configured');
  }

  const truncatedTranscript = transcript.length > 15000 
    ? transcript.substring(0, 15000) + '...[truncated]' 
    : transcript;

  const prompt = `You are an expert educational content summarizer. Analyze the following one-to-one tutoring session transcript and provide a structured summary.

TRANSCRIPT:
${truncatedTranscript}

Provide a JSON response with the following structure:
{
  "overview": "A brief 2-3 sentence overview of what this session covered and the student's progress",
  "topics": ["Topic 1", "Topic 2", "Topic 3"] (3-5 main topics or skills practiced),
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"] (4-6 important takeaways, corrections made, or areas to practice)
}

Focus on practical learning points, specific feedback given, and areas the student should focus on. Keep the language clear and actionable.
Respond ONLY with valid JSON, no additional text.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that summarizes one-to-one tutoring sessions. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API error:', response.status, error);
    throw new Error('Failed to generate summary');
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  try {
    const summary = JSON.parse(content);
    return {
      overview: summary.overview || 'No overview available',
      topics: Array.isArray(summary.topics) ? summary.topics : [],
      keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints : [],
    };
  } catch (parseError) {
    console.error('Failed to parse OpenAI response:', content);
    throw new Error('Invalid summary format from AI');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slotId } = await req.json();
    
    if (!slotId) {
      return new Response(
        JSON.stringify({ error: 'Slot ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating summary for one-to-one slot:', slotId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the slot with transcript link
    const { data: slot, error: slotError } = await supabase
      .from('one_to_one_slots')
      .select('id, transcript_link, ai_summary, meet_link, ends_at')
      .eq('id', slotId)
      .single();

    if (slotError || !slot) {
      console.error('Slot not found:', slotError);
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return existing summary if available
    if (slot.ai_summary) {
      console.log('Returning existing summary for slot:', slotId);
      return new Response(
        JSON.stringify({ success: true, summary: slot.ai_summary, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // We may be able to auto-discover the transcript link from the Meet API.
    let transcriptLink: string | null = slot.transcript_link || null;

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

    // Log granted scopes for this access token (helps confirm Meet/Drive scopes are actually present)
    try {
      const infoResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
      const infoText = await infoResp.text();
      console.log('Google tokeninfo:', infoResp.status, infoText);
    } catch (e) {
      console.error('Tokeninfo fetch failed:', e);
    }

    // If transcript link wasn't saved, try to discover it from the Meet API.
    if (!transcriptLink) {
      if (!slot.meet_link) {
        console.log('No meet link for slot; cannot discover transcript:', slotId);
        return new Response(
          JSON.stringify({ error: 'No Meet link found for this session, so the transcript cannot be retrieved automatically.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const meetingCode = extractMeetingCode(slot.meet_link);
      if (!meetingCode) {
        console.log('Invalid meet link; cannot extract meeting code:', slot.meet_link);
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid Meet link format for this session.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Transcript link missing; discovering via Meet API...', { slotId, meetingCode });
      const discovered = await fetchMeetTranscriptLink({
        accessToken,
        meetingCode,
        slotEndsAt: slot.ends_at,
      });

      if (discovered.transcriptLink) {
        transcriptLink = discovered.transcriptLink;
        await supabase
          .from('one_to_one_slots')
          .update({ transcript_link: transcriptLink })
          .eq('id', slotId);
        console.log('Discovered and saved transcript link for slot:', slotId);
      } else if (discovered.status === 'processing') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Transcript is still processing in Google Meet/Drive. Please try again in a few minutes.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else if (discovered.status === 'api_error') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Google Meet API could not access the transcript. This usually means the connected Google account does not have permission, or the Meet/Drive transcript scopes were not granted. Please reconnect Google with the correct permissions and ensure the transcript is saved to Drive and shared with that account.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Transcript was not found via Google Meet API. If Google shows a transcript, it may not be saved to Drive or not accessible by the connected Google account.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Extract doc ID and fetch content
    const docId = transcriptLink ? extractDocIdFromUrl(transcriptLink) : null;
    if (!docId) {
      console.log('Invalid transcript URL:', transcriptLink);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid transcript URL format' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching transcript content, docId:', docId);
    const transcriptContent = await fetchDocContent(docId, accessToken);

    if (!transcriptContent || transcriptContent.trim().length < 100) {
      console.log('Transcript too short');
      return new Response(
        JSON.stringify({ success: false, error: 'Transcript content is too short to generate a meaningful summary' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating AI summary, transcript length:', transcriptContent.length);
    const summary = await generateSummary(transcriptContent);

    // Save summary to database
    await supabase
      .from('one_to_one_slots')
      .update({ ai_summary: summary })
      .eq('id', slotId);

    console.log('Summary generated and saved for slot:', slotId);

    return new Response(
      JSON.stringify({ success: true, summary, cached: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in generate-o2o-summary:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
