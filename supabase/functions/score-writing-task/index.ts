import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  taskType: 'task1' | 'task2';
  questionText: string;
  studentResponse: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { taskType, questionText, studentResponse }: RequestBody = await req.json();

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    console.log('Processing writing task scoring...');
    console.log('Task type:', taskType);
    console.log('Question:', questionText?.substring(0, 100));
    console.log('Response length:', studentResponse?.length);

    const wordLimit = taskType === 'task1' ? '150-200 words' : '250-300 words';
    const wordCount = studentResponse ? studentResponse.trim().split(/\s+/).length : 0;

    const prompt = `You are an experienced and fair Language Cert exam coach and examiner. Your task is to score a student's Writing ${taskType === 'task1' ? 'Task 1' : 'Task 2'} response accurately and fairly.

## WORD LIMIT REQUIREMENT
The required word limit for this task is ${wordLimit}.
Student's word count: ${wordCount} words.

## IMPORTANT: ERROR DETECTION ACCURACY
- Only flag GENUINE errors — do NOT flag correct English as wrong
- "students' needs" is CORRECT (plural possessive) — do NOT flag it
- Singular nouns used generically (e.g. "the most significant expense", "the second-largest category") are grammatically CORRECT when referring to a category/type — do NOT flag them
- Do NOT suggest pluralizing nouns that are correctly used in singular form to refer to a category or type
- Do NOT flag stylistic preferences as errors — only flag clear grammatical mistakes, spelling errors, or wrong word usage
- If in doubt whether something is an error, do NOT include it in the errors array

## SCORING CRITERIA (Official Language Cert - 4 criteria, 25 points each = 100 total)

1. **Task Achievement (25 points)**:
   - How far the candidate has achieved/addressed the task
   - Whether the candidate has done what was asked
   - Relevance of content, word count compliance

2. **Grammar (25 points)**:
   - Range, appropriacy and accuracy of grammar appropriate to the level of the test
   - Correct use of tenses, subject-verb agreement, modals, conditionals, sentence structures
   - Only deduct for clear, unambiguous grammar mistakes

3. **Vocabulary (25 points)**:
   - Range, accuracy and appropriacy of vocabulary
   - Spelling accuracy, appropriate to the level of the test
   - Use of academic/formal vocabulary where appropriate

4. **Organisation (25 points)**:
   - How coherently ideas are linked together in the text
   - Punctuation accuracy
   - Use of linking words, logical flow, paragraph structure

## WORD COUNT PENALTIES
- Below ${taskType === 'task1' ? '140' : '240'} words: Deduct 15-20 points from Task Achievement
- Above ${taskType === 'task1' ? '220' : '320'} words: Deduct 5-10 points from Task Achievement
- Severely under (less than ${taskType === 'task1' ? '100' : '150'} words): Maximum Task Achievement score of 10

## QUESTION
${questionText || 'Not provided'}

## STUDENT RESPONSE
${studentResponse || 'No response provided'}

## REQUIRED OUTPUT FORMAT

Provide your assessment in the following JSON format exactly:
{
  "taskAchievement": {
    "score": <0-25>,
    "feedback": "<specific feedback on how well the task was addressed>"
  },
  "grammar": {
    "score": <0-25>,
    "feedback": "<specific feedback on grammar usage>"
  },
  "vocabulary": {
    "score": <0-25>,
    "feedback": "<specific feedback on vocabulary and spelling>"
  },
  "organisation": {
    "score": <0-25>,
    "feedback": "<specific feedback on coherence, linking, and punctuation>"
  },
  "wordCountPenalty": <0 or negative number>,
  "totalScore": <0-100>,
  "overallFeedback": "<2-3 sentences of constructive overall feedback with specific improvement suggestions>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "areasToImprove": ["<area 1>", "<area 2>", "<area 3>"],
  "errors": [
    {"word": "<exact wrong word/phrase as written>", "type": "spelling", "correction": "<correct spelling>"},
    {"word": "<exact wrong word/phrase>", "type": "grammar", "correction": "<correct form>"},
    {"word": "<wrong article/word>", "type": "article", "correction": "<correct usage>"}
  ]
}

IMPORTANT: Only include GENUINE errors in the "errors" array. Do NOT flag correct grammar, acceptable usage, or stylistic choices as errors. Quality over quantity — fewer accurate errors are better than many false positives. Return ONLY valid JSON, no additional text.`;

    console.log('Sending request to OpenAI for scoring...');

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
            content: 'You are an expert Language Cert examiner and English language teacher. You must return ONLY valid JSON, no markdown, no code blocks, just the JSON object. Be thorough in identifying errors and providing feedback.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    console.log('AI Response received:', aiResponse);

    // Parse the JSON response
    let scoreResult;
    try {
      const cleanedResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      scoreResult = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      throw new Error('Failed to parse scoring response');
    }

    return new Response(
      JSON.stringify(scoreResult),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in score-writing-task function:', error);
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
