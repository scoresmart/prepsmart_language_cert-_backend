import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { studentData } = await req.json();
    
    const {
      previousScore,
      targetScore,
      examDate,
      courseExpiryAt,
      courseStartDate,
      oneToOneQuota,
      oneToOneUsed,
      groupClassTotal,
      mockTestsCount,
      numberOfAttempts
    } = studentData;

    console.log('Received student data:', studentData);

    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    // Calculate days remaining
    const today = new Date();
    const expiryDate = courseExpiryAt ? new Date(courseExpiryAt) : null;
    const examDateObj = examDate ? new Date(examDate) : null;
    const startDate = courseStartDate ? new Date(courseStartDate) : today;
    
    const daysToExpiry = expiryDate ? Math.max(0, Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))) : 60;
    const daysToExam = examDateObj ? Math.max(0, Math.ceil((examDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))) : null;
    const totalCourseDays = expiryDate && startDate ? Math.ceil((expiryDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : 60;

    const remainingOneToOne = Math.max(0, (oneToOneQuota || 0) - (oneToOneUsed || 0));
    const hasOneToOne = remainingOneToOne > 0;

    const prompt = `You are an expert PTE/LanguageCert tutor creating personalized study plans. You understand student situations deeply and create realistic, achievable plans.

STUDENT PROFILE:
- Previous Score: ${previousScore || 'First attempt'}
- Target Score: ${targetScore || 'Not specified (assume 65+ for PTE)'}
- Number of Previous Attempts: ${numberOfAttempts || 0}
- Days Until Course Expiry: ${daysToExpiry} days
- Days Until Exam: ${daysToExam !== null ? daysToExam + ' days' : 'Not scheduled'}
- Total Course Duration: ${totalCourseDays} days
- Mock Tests Taken: ${mockTestsCount || 0}

RESOURCES AVAILABLE:
- One-to-One Sessions Remaining: ${remainingOneToOne} sessions (1 hour each)
- Group Class Access: ${groupClassTotal || 'Unlimited'} (2 hours per session, max 2 sessions/day = 4 hours)

COURSE STRUCTURE:
- Group classes: 2 hours per session, 2 batches available daily (morning & evening)
- One-to-One sessions: 1 hour each, personalized tutoring
- Self-practice: Student practices on their own using our practice portal

CREATE 3 STUDY PLAN OPTIONS:

1. EASY PLAN (Relaxed pace):
   - 2 hours group class daily
   - 1 hour self-practice daily
   - Less intensive, for students with more time or already close to target

2. INTERMEDIATE PLAN (Balanced):
   - 2 hours group class daily
   - 2 hours self-practice daily
   - Good balance for most students

3. EXTREME PLAN (Intensive):
   - 2-4 hours group class daily (can attend both batches)
   - 3 hours self-practice daily
   - For students with tight deadlines or significant score gaps

IMPORTANT CONSIDERATIONS:
${hasOneToOne ? `- Student has ${remainingOneToOne} one-to-one sessions. Reduce practice questions as they get personalized tutoring.` : '- No one-to-one sessions - student needs more self-practice.'}
${previousScore ? `- Previous score is ${previousScore}, adjust difficulty based on score gap to target.` : '- First attempt - include foundation building.'}
${daysToExam !== null && daysToExam < 30 ? '- URGENT: Exam in less than 30 days. Prioritize weak areas and mock tests.' : ''}

For each skill (Speaking, Reading, Writing, Listening), provide:
- Daily questions to practice (realistic numbers based on time available)
- Weekly focus areas
- Mock test frequency

Respond ONLY with a JSON object (no markdown):
{
  "plans": [
    {
      "id": "easy",
      "name": "Easy Plan",
      "description": "Relaxed pace for steady improvement",
      "dailyGroupClassHours": 2,
      "dailyPracticeHours": 1,
      "totalDailyHours": 3,
      "mockTestsPerWeek": 1,
      "weeklyOneToOneSessions": <number based on remaining sessions and course duration>,
      "skills": {
        "speaking": {
          "dailyQuestions": {
            "readAloud": <number>,
            "repeatSentence": <number>,
            "describeImage": <number>,
            "retellLecture": <number>,
            "answerShortQuestion": <number>
          },
          "weeklyTarget": "<brief weekly goal>",
          "focusAreas": ["<area1>", "<area2>"]
        },
        "reading": {
          "dailyQuestions": {
            "fillInBlanks": <number>,
            "reorderParagraphs": <number>,
            "multipleChoice": <number>,
            "readingWritingFIB": <number>
          },
          "weeklyTarget": "<brief weekly goal>",
          "focusAreas": ["<area1>", "<area2>"]
        },
        "writing": {
          "dailyQuestions": {
            "essay": <number>,
            "summarizeWrittenText": <number>
          },
          "weeklyTarget": "<brief weekly goal>",
          "focusAreas": ["<area1>", "<area2>"]
        },
        "listening": {
          "dailyQuestions": {
            "summarizeSpokenText": <number>,
            "multipleChoice": <number>,
            "fillInBlanks": <number>,
            "highlightCorrectSummary": <number>,
            "selectMissingWord": <number>,
            "highlightIncorrectWords": <number>,
            "writeFromDictation": <number>
          },
          "weeklyTarget": "<brief weekly goal>",
          "focusAreas": ["<area1>", "<area2>"]
        }
      },
      "recommendation": "<personalized recommendation for this plan>"
    },
    {
      "id": "intermediate",
      "name": "Intermediate Plan",
      "description": "Balanced approach for consistent progress",
      "dailyGroupClassHours": 2,
      "dailyPracticeHours": 2,
      "totalDailyHours": 4,
      "mockTestsPerWeek": 2,
      "weeklyOneToOneSessions": <number>,
      "skills": { /* same structure */ },
      "recommendation": "<personalized recommendation>"
    },
    {
      "id": "extreme",
      "name": "Extreme Plan",
      "description": "Intensive preparation for rapid improvement",
      "dailyGroupClassHours": 4,
      "dailyPracticeHours": 3,
      "totalDailyHours": 7,
      "mockTestsPerWeek": 3,
      "weeklyOneToOneSessions": <number>,
      "skills": { /* same structure */ },
      "recommendation": "<personalized recommendation>"
    }
  ],
  "studentSummary": {
    "daysToExpiry": ${daysToExpiry},
    "daysToExam": ${daysToExam !== null ? daysToExam : 'null'},
    "previousScore": "${previousScore || 'First attempt'}",
    "targetScore": "${targetScore || '65+'}",
    "oneToOneRemaining": ${remainingOneToOne},
    "hasGroupClassAccess": true
  },
  "aiNote": "<brief note about the student's situation and what plan you recommend>"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert PTE/LanguageCert tutor. Create realistic, achievable study plans that consider the student\'s time constraints, resources, and goals. Return only valid JSON, no markdown. Be empathetic and practical - these are real students with real constraints.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    console.log('AI Response:', content);
    
    // Parse the JSON response
    let result;
    try {
      // Remove any markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      throw new Error('Failed to parse AI calculation result');
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in calculate-study-hours function:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
