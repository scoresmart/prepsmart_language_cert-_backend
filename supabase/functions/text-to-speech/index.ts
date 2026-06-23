import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { text, voice } = await req.json();
    console.log('Received TTS request for text length:', text?.length);

    if (!text) {
      throw new Error('Text is required');
    }

    // Generate speech from text using OpenAI
    console.log('Calling OpenAI TTS API...');
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice || 'nova',
        response_format: 'mp3',
        speed: 0.95,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to generate speech');
    }

    console.log('OpenAI response received, converting to base64...');
    // Convert audio buffer to base64 (handle large files in chunks)
    const arrayBuffer = await response.arrayBuffer();
    console.log('Audio buffer size:', arrayBuffer.byteLength, 'bytes');
    
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    console.log('Converting to base64...');
    const base64Audio = btoa(binary);
    console.log('TTS completed successfully, base64 length:', base64Audio.length);

    return new Response(
      JSON.stringify({ audioContent: base64Audio }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Text-to-speech error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
