import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to analyze mock scores and identify trends
function analyzeMockScores(mockScores: any[]) {
  if (!mockScores || mockScores.length === 0) {
    return null;
  }

  const modules = ['speaking', 'reading', 'writing', 'listening', 'overall'];
  const analysis: any = {
    averages: {},
    trends: {},
    weakestModules: [],
    strongestModules: [],
    improvingModules: [],
    decliningModules: [],
    stagnantModules: [],
    insights: [],
  };

  // Calculate averages for each module
  modules.forEach(module => {
    const scores = mockScores
      .map(s => parseFloat(s[module]) || 0)
      .filter(s => s > 0);
    
    if (scores.length > 0) {
      analysis.averages[module] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
  });

  // Analyze trends (if 2+ mock tests)
  if (mockScores.length >= 2) {
    modules.forEach(module => {
      const scores = mockScores
        .map(s => parseFloat(s[module]) || 0)
        .filter(s => s > 0);
      
      if (scores.length >= 2) {
        const firstHalf = scores.slice(0, Math.ceil(scores.length / 2));
        const secondHalf = scores.slice(Math.floor(scores.length / 2));
        
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        const difference = secondAvg - firstAvg;
        
        analysis.trends[module] = {
          direction: difference > 2 ? 'improving' : difference < -2 ? 'declining' : 'stable',
          change: Math.round(difference),
        };

        if (difference > 2) {
          analysis.improvingModules.push(module);
        } else if (difference < -2) {
          analysis.decliningModules.push(module);
        } else {
          analysis.stagnantModules.push(module);
        }
      }
    });
  }

  // Identify weakest and strongest modules (excluding 'overall')
  const moduleScores = Object.entries(analysis.averages)
    .filter(([key]) => key !== 'overall')
    .map(([module, avg]) => ({ module, avg: avg as number }))
    .sort((a, b) => a.avg - b.avg);

  if (moduleScores.length > 0) {
    analysis.weakestModules = moduleScores.slice(0, 2).map(m => m.module);
    analysis.strongestModules = moduleScores.slice(-2).reverse().map(m => m.module);
  }

  // Generate insights
  if (analysis.decliningModules.length > 0) {
    analysis.insights.push(`CRITICAL: ${analysis.decliningModules.join(', ')} score(s) are DECLINING. Need immediate intensive focus.`);
  }
  if (analysis.stagnantModules.length > 0) {
    analysis.insights.push(`${analysis.stagnantModules.join(', ')} score(s) are STAGNANT. Need strategy change, not just more practice.`);
  }
  if (analysis.improvingModules.length > 0) {
    analysis.insights.push(`${analysis.improvingModules.join(', ')} showing IMPROVEMENT. Current approach is working, maintain it.`);
  }

  return analysis;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { studentId, prefilled, responses } = await req.json();

    console.log('Generating study plan with data:', { studentId, prefilled, responses });

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Analyze mock scores if available
    const mockAnalysis = analyzeMockScores(responses.individualMockScores || []);
    
    // Format individual mock scores if available
    let mockScoresDetail = '';
    if (responses.hasTakenMockTest && responses.individualMockScores && responses.individualMockScores.length > 0) {
      mockScoresDetail = responses.individualMockScores.map((score: any, index: number) => {
        return `- Mock Test ${index + 1}:
    - Overall: ${score.overall || 'N/A'}
    - Speaking: ${score.speaking || 'N/A'}
    - Reading: ${score.reading || 'N/A'}
    - Writing: ${score.writing || 'N/A'}
    - Listening: ${score.listening || 'N/A'}`;
      }).join('\n');
    }

    // Format mock analysis for the prompt
    let mockAnalysisSection = '';
    if (mockAnalysis) {
      mockAnalysisSection = `
### CRITICAL MOCK SCORE ANALYSIS (AI-analyzed from student's last ${responses.individualMockScores.length} mock tests):

**Module Averages:**
${Object.entries(mockAnalysis.averages).map(([m, avg]) => `- ${m.charAt(0).toUpperCase() + m.slice(1)}: ${avg}`).join('\n')}

**Performance Trends:**
${Object.entries(mockAnalysis.trends).map(([m, t]: [string, any]) => 
  `- ${m.charAt(0).toUpperCase() + m.slice(1)}: ${t.direction.toUpperCase()} (${t.change > 0 ? '+' : ''}${t.change} points)`
).join('\n')}

**Weakest Modules (need most focus):** ${mockAnalysis.weakestModules.map((m: string) => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')}
**Strongest Modules:** ${mockAnalysis.strongestModules.map((m: string) => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')}

**Key Insights:**
${mockAnalysis.insights.map((i: string) => `⚠️ ${i}`).join('\n')}

**IMPORTANT:** 
- If a module is DECLINING, student needs DOUBLE the practice + strategy change
- If a module is STAGNANT, current approach isn't working - recommend different task types or techniques
- If a module is IMPROVING, maintain current strategy but don't reduce intensity
- Weakest modules should get 60% of practice time, strongest only 15%
`;
    }

    // Build the prompt with detailed PTE context
    const prompt = `You are an expert PTE (Pearson Test of English) study planner with deep knowledge of PTE scoring and task importance.

## CRITICAL: PERSONALIZED PLAN REQUIREMENT
You MUST create a UNIQUE, PERSONALIZED plan based on this specific student's data. 
DO NOT give generic advice. Analyze their mock scores, trends, and weak areas to create targeted recommendations.

${mockAnalysisSection}

## CRITICAL PTE TASK KNOWLEDGE:

### Speaking Tasks (Priority Order):
1. **Describe Image (DI)** - VERY IMPORTANT - Practice heavily
2. **Summarize Group Discussion (SGD)** - VERY IMPORTANT - This is a game-changer task
3. **Respond to Situation (RTS)** - VERY IMPORTANT
4. **Re-tell Lecture (RL)** - Similar to SGD, so focus MORE on SGD instead of RL
5. **Read Aloud (RA)** - NOT very important - only add a few questions occasionally
6. **Answer Short Question (ASQ)** - Medium importance
7. **Repeat Sentence (RS)** - Important for both Speaking AND Listening scores

### Reading Tasks (Priority Order):
1. **Summarize Written Text (SWT)** - EXTREMELY IMPORTANT - Worth ~40 marks, contributes to BOTH Reading AND Writing. This is a GAME CHANGER task!
2. **Reading & Writing Fill in the Blanks (RWFIB)** - VERY IMPORTANT
3. **Reading Fill in the Blanks Dropdown** - IMPORTANT
4. **Reading Drag & Drop Fill in the Blanks** - IMPORTANT  
5. **Re-order Paragraphs** - MEDIUM importance
6. **Multiple Choice Questions** - Lower priority

### Writing Tasks:
1. **Summarize Written Text (SWT)** - Covered in Reading (contributes to both)
2. **Essay Writing** - Practice at least 1 essay every few days

### Listening Tasks (Priority Order):
1. **Write from Dictation (WFD)** - VERY IMPORTANT - High scoring
2. **Summarize Spoken Text (SST)** - VERY IMPORTANT
3. **Highlight Incorrect Words (HIW)** - IMPORTANT
4. **Fill in the Blanks (Listening)** - IMPORTANT
5. **Repeat Sentence (RS)** - From Speaking module, important for Listening score too

## Student Information:

### Course Details:
- 1:1 Sessions Remaining: ${prefilled.oneToOneSessions - prefilled.oneToOneUsed} out of ${prefilled.oneToOneSessions}
- Group Class Days Available: ${prefilled.groupClassDaysLeft}
- Exam Date: ${prefilled.examDate || 'Not set'}
- Days Until Exam: ${prefilled.daysToExam || 'Not set'}
- Course Expiry Date: ${prefilled.courseExpiry || 'Not set'}
- Days Until Course Expiry: ${prefilled.daysToExpiry}
- Target Score: ${prefilled.targetScore || 'Not specified'}
- Previous Score: ${prefilled.previousScore || 'First attempt'}

### Student Responses:
- Self-practice hours available daily (excluding classes): ${responses.selfPracticeHours} hours
- Work hours per day: ${responses.workHoursPerDay} hours
- Self-reported weakest module: ${responses.weakestModule}
- Has taken mock tests: ${responses.hasTakenMockTest ? 'Yes' : 'No'}
${responses.hasTakenMockTest ? `- Number of mock tests taken: ${responses.mockTestCount}` : ''}
${mockScoresDetail ? `\n### Individual Mock Test Scores:\n${mockScoresDetail}` : ''}

## PERSONALIZATION REQUIREMENTS:

1. **Key Tips MUST be unique to this student:**
   - If their speaking is declining, give speaking-specific tips
   - If writing is stagnant, suggest specific writing techniques
   - Reference their ACTUAL scores in the tips (e.g., "Your speaking average of 52 needs to reach 65...")
   
2. **Focus Areas MUST reflect their data:**
   - Don't just say "Describe Image" for everyone
   - Say specific things like "Describe Image with focus on structure" or "WFD accuracy improvement"
   
3. **Daily Schedule MUST be weighted:**
   - Weak modules: 60% of tasks
   - Average modules: 25% of tasks  
   - Strong modules: 15% of tasks (maintenance only)

4. **If mock scores show declining trend:**
   - Add specific recovery strategies
   - Recommend technique videos before practice
   - Suggest shorter, more focused sessions

5. **Recommendations MUST be actionable and specific:**
   - BAD: "Practice more speaking"
   - GOOD: "Your speaking declined by 5 points. Focus on DI structure: Introduction + 3 body points + conclusion in exactly 40 seconds"

## STUDY PLAN STRUCTURE (MUST FOLLOW):

### Duration Calculation:
- If exam is in 20 days but course is 30 days → Give 14-day plan (based on exam)
- If exam is in 40 days but course is 30 days → Give plan based on course duration
- Calculate optimal study plan duration based on the SMALLER of exam date or course expiry

### 7-Day Cycle Structure (REPEAT THIS PATTERN):

**Days 1-4 (Module Practice Days):**
Cover ALL 4 modules within these 4 days with specific task-based questions.
ADJUST question counts based on module weakness analysis.

**Day 5 (Written Skills Day):**
- Vocabulary building
- Collocations practice
- Spelling practice
- Grammar review

**Day 6 (Spoken Skills Day):**
- Pronunciation practice
- Fluency exercises
- Word stress and intonation
- Speaking drills

**Day 7 (Mock Test Day):**
- Full mock test
- Review mistakes
- Identify weak areas for next cycle

Respond ONLY with valid JSON in exactly this format (no markdown, no code blocks):
{
  "id": "personalized",
  "summary": "A 2-3 sentence summary SPECIFIC to this student mentioning their actual weak areas and scores",
  "totalDays": number,
  "estimatedImprovementTime": "e.g., 2-3 weeks",
  "focusAreas": ["specific area 1", "specific area 2", "specific area 3"],
  "dailySchedule": [
    {
      "day": 1,
      "dayType": "Module Practice",
      "focus": "Speaking & Reading",
      "tasks": [
        {"task": "Describe Image", "module": "Speaking", "questions": 5},
        {"task": "Summarize Group Discussion", "module": "Speaking", "questions": 3}
      ]
    }
  ],
  "weeklyPattern": "Personalized explanation of the 7-day cycle for this student",
  "recommendations": ["Specific recommendation referencing their scores", "Another specific one", "Third specific one", "Fourth specific one"],
  "keyTips": [
    "Tip specific to their weakest declining module with actual score reference",
    "Technique tip for their stagnant module",
    "Strategy for improving their specific weak task types"
  ]
}

IMPORTANT: 
- Generate EXACTLY 14 days of study plan (2 complete 7-day cycles)
- Each day should have specific tasks with question counts WEIGHTED by weakness
- Follow the 7-day cycle pattern strictly
- PERSONALIZE everything - no generic tips!
- Reference actual scores in tips and recommendations
- DO NOT use weekday names (Monday, Tuesday) - use Day 1, Day 2, etc.
- Keep the JSON response concise - max 14 days`;

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
            content: `You are an expert PTE study planner who creates HIGHLY PERSONALIZED study plans. 
You MUST analyze the student's mock score trends and create unique recommendations based on:
1. Which modules are improving, declining, or stagnant
2. Their specific score averages
3. The gap between current and target scores
4. Their available practice time

NEVER give generic advice. Every tip, recommendation, and focus area must reference their actual data.
Respond with valid JSON only, no markdown.` 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    console.log('OpenAI response:', content);

    // Parse the JSON response
    let plan;
    try {
      // Remove any markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      plan = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError);
      throw new Error('Failed to parse study plan response');
    }

    // Save the plan to database
    if (studentId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { error: saveError } = await supabase
          .from('study_plans')
          .insert({
            student_id: studentId,
            plan_data: plan,
            input_data: { prefilled, responses, mockAnalysis },
          });

        if (saveError) {
          console.error('Failed to save study plan:', saveError);
        } else {
          console.log('Study plan saved successfully');
        }
      } catch (saveErr) {
        console.error('Error saving study plan:', saveErr);
      }
    }

    return new Response(JSON.stringify({ plan, mockAnalysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-study-plan function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
