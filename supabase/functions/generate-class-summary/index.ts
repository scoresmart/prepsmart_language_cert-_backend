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
  // Handle various Google Docs URL formats
  // https://docs.google.com/document/d/DOC_ID/edit
  // https://docs.google.com/document/d/DOC_ID/export
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function fetchDocContent(docId: string, accessToken: string): Promise<string> {
  // Export document as plain text
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

  // Truncate transcript if too long (keep first 15000 chars to stay within token limits)
  const truncatedTranscript = transcript.length > 15000 
    ? transcript.substring(0, 15000) + '...[truncated]' 
    : transcript;

  const prompt = `You are an expert educational content summarizer. Analyze the following class transcript and provide a structured summary.

TRANSCRIPT:
${truncatedTranscript}

Provide a JSON response with the following structure:
{
  "overview": "A brief 2-3 sentence overview of what this class covered",
  "topics": ["Topic 1", "Topic 2", "Topic 3"] (3-5 main topics covered),
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"] (4-6 important takeaways or tips for students)
}

Focus on practical learning points and actionable advice for students. Keep the language clear and concise.
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
        { role: 'system', content: 'You are a helpful assistant that summarizes educational content. Always respond with valid JSON only.' },
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
    // Parse the JSON response
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
    const { date, slotId } = await req.json();
    
    if (!date) {
      return new Response(
        JSON.stringify({ error: 'Date is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating summary for date:', date, 'slotId:', slotId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get transcripts for this date
    const { data: transcriptData, error: transcriptError } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', `group_class_transcripts_${date}`)
      .maybeSingle();

    if (transcriptError || !transcriptData?.value) {
      console.log('No transcripts found for date:', date);
      return new Response(
        JSON.stringify({ error: 'No transcripts available for this date' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const transcripts = JSON.parse(transcriptData.value);
    
    // Get existing summaries
    const { data: existingSummaries } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', `group_class_summaries_${date}`)
      .maybeSingle();

    const summaries: Record<string, { overview: string; topics: string[]; keyPoints: string[] }> = 
      existingSummaries?.value ? JSON.parse(existingSummaries.value) : {};

    // Get Google tokens for fetching doc content
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

    const results: Array<{ slotId: string; status: string; summary?: any }> = [];
    const slotsToProcess = slotId ? [slotId] : Object.keys(transcripts);

    for (const currentSlotId of slotsToProcess) {
      // Skip if already has summary
      if (summaries[currentSlotId]) {
        console.log(`Slot ${currentSlotId} already has summary`);
        results.push({ slotId: currentSlotId, status: 'already_exists', summary: summaries[currentSlotId] });
        continue;
      }

      const transcriptUrl = transcripts[currentSlotId];
      if (!transcriptUrl) {
        console.log(`No transcript URL for slot ${currentSlotId}`);
        results.push({ slotId: currentSlotId, status: 'no_transcript' });
        continue;
      }

      const docId = extractDocIdFromUrl(transcriptUrl);
      if (!docId) {
        console.log(`Could not extract doc ID from ${transcriptUrl}`);
        results.push({ slotId: currentSlotId, status: 'invalid_url' });
        continue;
      }

      try {
        console.log(`Fetching transcript content for slot ${currentSlotId}, docId: ${docId}`);
        const transcriptContent = await fetchDocContent(docId, accessToken);
        
        if (!transcriptContent || transcriptContent.trim().length < 100) {
          console.log(`Transcript too short for slot ${currentSlotId}`);
          results.push({ slotId: currentSlotId, status: 'transcript_too_short' });
          continue;
        }

        console.log(`Generating AI summary for slot ${currentSlotId}, transcript length: ${transcriptContent.length}`);
        const summary = await generateSummary(transcriptContent);
        
        summaries[currentSlotId] = summary;
        results.push({ slotId: currentSlotId, status: 'generated', summary });
        
        console.log(`Summary generated for slot ${currentSlotId}`);
      } catch (error) {
        console.error(`Error processing slot ${currentSlotId}:`, error);
        results.push({ slotId: currentSlotId, status: 'error', summary: undefined });
      }
    }

    // Save updated summaries
    if (Object.keys(summaries).length > 0) {
      await supabase
        .from('app_settings')
        .upsert({
          key: `group_class_summaries_${date}`,
          value: JSON.stringify(summaries),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      console.log('Saved summaries:', Object.keys(summaries).length);
    }

    return new Response(
      JSON.stringify({
        success: true,
        date,
        results,
        totalSummaries: Object.keys(summaries).length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in generate-class-summary:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
