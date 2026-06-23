import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { classInteraction, examMotivation, homeworkCompletion, punctuality, studentName } = await req.json();

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const prompt = `You are an expert education assessor. Analyze this student's performance and provide a score out of 100.

Student: ${studentName}

Assessment Criteria:
1. Class Interaction: ${classInteraction}
2. Exam Motivation: ${examMotivation}
3. Homework/Mock Test Completion: ${homeworkCompletion}
4. Punctuality and Regular Attendance: ${punctuality}

Based on these four criteria, provide:
1. An overall performance score (0-100)
2. A brief analysis (2-3 sentences) explaining the score
3. One key recommendation for improvement

Consider that:
- Excellent responses should contribute ~25 points each
- Good responses should contribute ~20 points each
- Average responses should contribute ~15 points each
- Poor responses should contribute ~5 points each

Be fair but realistic in your assessment.`;

    console.log('Sending request to OpenAI for student assessment');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert education assessor. Provide structured, concise feedback.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    console.log('AI Assessment received:', aiResponse);

    // Extract score from AI response (looking for numbers between 0-100)
    const scoreMatch = aiResponse.match(/\b(\d{1,3})\b/);
    const score = scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : 50;

    return new Response(
      JSON.stringify({
        score,
        analysis: aiResponse,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in assess-student-performance function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
