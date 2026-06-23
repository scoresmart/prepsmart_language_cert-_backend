import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ListeningAnswers {
  part1: { [key: number]: string };
  part2: { [key: number]: string };
  part3: { [key: string]: string };
  part4: { [key: number]: string };
}

interface ReadingAnswers {
  part1a: { [key: number]: string };
  part1b: { [key: number]: string };
  part2: { [key: number]: string };
  part3: { [key: number]: string };
  part4: { [key: number]: string };
}

interface WritingResponses {
  task1: string;
  task2: string;
}

interface AnswerKeys {
  listening: {
    part1: { questionIndex: number; correctAnswer: string }[];
    part2: { questionIndex: number; correctAnswer: string }[];
    part3: { answers: string[] };
    part4: { questionIndex: number; correctAnswer: number }[];
  };
  reading: {
    part1a: { questionIndex: number; correctAnswer: number }[];
    part1b: { questionIndex: number; correctAnswer: number }[];
    part2: { [key: number]: string };
    part3: { [key: number]: string };
    part4: { questionIndex: number; correctAnswer: number }[];
  };
  writing: {
    task1Question: string;
    task2Question: string;
  };
}

interface RequestBody {
  studentName: string;
  listeningAnswers: ListeningAnswers;
  readingAnswers: ReadingAnswers;
  writingResponses: WritingResponses;
  answerKeys: AnswerKeys;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      studentName, 
      listeningAnswers, 
      readingAnswers, 
      writingResponses, 
      answerKeys 
    }: RequestBody = await req.json();

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    console.log('Processing mock test scoring for:', studentName);
    console.log('Listening answers:', JSON.stringify(listeningAnswers));
    console.log('Reading answers:', JSON.stringify(readingAnswers));
    console.log('Writing responses length - Task1:', writingResponses.task1?.length, 'Task2:', writingResponses.task2?.length);

    const prompt = `You are an expert Language Cert exam coach and examiner. Your task is to score a student's mock test for 3 modules: Listening, Reading, and Writing. Speaking is excluded from this test.

## STUDENT: ${studentName}

## SCORING CRITERIA

### LISTENING (30 marks total)
For Parts 1, 2, and 4 (MCQ questions): Award 1 mark for each correct answer, 0 for incorrect.
For Part 3 (Fill in the blanks): 
- Award 1 mark per correct answer
- Words in parentheses () are OPTIONAL - if the answer key shows "construction (work)", both "construction work" and "construction" are correct
- Spelling must be correct
- Capitalization matters where appropriate

### READING (30 marks total)
All parts are objective: Award 1 mark for each correct answer, 0 for incorrect.

### WRITING (32 marks total)
Writing is marked against CEFR-aligned criteria:
- Task Achievement: How well the candidate addressed the task (0-8 marks)
- Accuracy and Range of Grammar: Range, appropriacy, and accuracy of grammar (0-8 marks)
- Accuracy and Range of Vocabulary: Range, accuracy, appropriacy of vocabulary and spelling (0-8 marks)
- Organisation (Coherence): How coherently ideas are linked and punctuation accuracy (0-8 marks)

Task 1 is weighted to 40% of Writing marks (max ~12.8 marks)
Task 2 is weighted to 60% of Writing marks (max ~19.2 marks)
Off-topic responses receive 0 marks.

## RAW SCORES CONVERSION
Total raw marks: 30 (Listening) + 30 (Reading) + 32 (Writing) = 92 marks
Convert to 0-100 scale using: (raw_score / 92) * 100

## CEFR GRADING SCALE
C2 = 90-100
C1 = 75-89
B2 = 60-74
B1 = 40-59
A2 = 20-39
A1 = 10-19
Below A1 = 0-9

## STUDENT ANSWERS AND ANSWER KEYS

### LISTENING

**Part 1 (7 MCQ questions):**
Student answers: ${JSON.stringify(listeningAnswers.part1)}
Correct answers: ${JSON.stringify(answerKeys.listening.part1)}

**Part 2 (10 MCQ questions from 5 conversations):**
Student answers: ${JSON.stringify(listeningAnswers.part2)}
Correct answers: ${JSON.stringify(answerKeys.listening.part2)}

**Part 3 (Fill in the blanks):**
Student answers: ${JSON.stringify(listeningAnswers.part3)}
Correct answers (words in parentheses are optional): ${JSON.stringify(answerKeys.listening.part3.answers)}

**Part 4 (6 MCQ questions):**
Student answers: ${JSON.stringify(listeningAnswers.part4)}
Correct answers: ${JSON.stringify(answerKeys.listening.part4)}

### READING

**Part 1a (6 MCQ questions):**
Student answers: ${JSON.stringify(readingAnswers.part1a)}
Correct answers: ${JSON.stringify(answerKeys.reading.part1a)}

**Part 1b (7 MCQ questions):**
Student answers: ${JSON.stringify(readingAnswers.part1b)}
Correct answers: ${JSON.stringify(answerKeys.reading.part1b)}

**Part 2 (Drag and drop - 6 blanks):**
Student answers: ${JSON.stringify(readingAnswers.part2)}
Correct answers: ${JSON.stringify(answerKeys.reading.part2)}

**Part 3 (Passage matching):**
Student answers: ${JSON.stringify(readingAnswers.part3)}
Correct answers: ${JSON.stringify(answerKeys.reading.part3)}

**Part 4 (MCQ questions):**
Student answers: ${JSON.stringify(readingAnswers.part4)}
Correct answers: ${JSON.stringify(answerKeys.reading.part4)}

### WRITING

**Task 1 Question:** ${answerKeys.writing.task1Question || 'Not provided'}
**Student Response Task 1:**
${writingResponses.task1 || 'No response provided'}

**Task 2 Question:** ${answerKeys.writing.task2Question || 'Not provided'}
**Student Response Task 2:**
${writingResponses.task2 || 'No response provided'}

## REQUIRED OUTPUT FORMAT

Provide your assessment in the following JSON format exactly:
{
  "listening": {
    "part1": { "correct": <number>, "total": 7, "details": "<brief explanation>" },
    "part2": { "correct": <number>, "total": 10, "details": "<brief explanation>" },
    "part3": { "correct": <number>, "total": <number of blanks>, "details": "<brief explanation>" },
    "part4": { "correct": <number>, "total": 6, "details": "<brief explanation>" },
    "rawScore": <total out of 30>,
    "scaledScore": <out of 100>
  },
  "reading": {
    "part1a": { "correct": <number>, "total": 6, "details": "<brief explanation>" },
    "part1b": { "correct": <number>, "total": 7, "details": "<brief explanation>" },
    "part2": { "correct": <number>, "total": 6, "details": "<brief explanation>" },
    "part3": { "correct": <number>, "total": <number of statements>, "details": "<brief explanation>" },
    "part4": { "correct": <number>, "total": <number of questions>, "details": "<brief explanation>" },
    "rawScore": <total out of 30>,
    "scaledScore": <out of 100>
  },
  "writing": {
    "task1": {
      "taskAchievement": <0-8>,
      "grammar": <0-8>,
      "vocabulary": <0-8>,
      "organisation": <0-8>,
      "total": <sum>,
      "weighted": <weighted to 40%>,
      "feedback": "<detailed feedback>"
    },
    "task2": {
      "taskAchievement": <0-8>,
      "grammar": <0-8>,
      "vocabulary": <0-8>,
      "organisation": <0-8>,
      "total": <sum>,
      "weighted": <weighted to 60%>,
      "feedback": "<detailed feedback>"
    },
    "rawScore": <total out of 32>,
    "scaledScore": <out of 100>
  },
  "overall": {
    "totalRawScore": <out of 92>,
    "scaledScore": <out of 100>,
    "cefrLevel": "<C2/C1/B2/B1/A2/A1/Below A1>",
    "summary": "<2-3 sentence overall feedback and recommendations>"
  }
}

Be fair but strict in your assessment. Return ONLY valid JSON, no additional text.`;

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
            content: 'You are an expert Language Cert examiner. You must return ONLY valid JSON, no markdown, no code blocks, just the JSON object.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000,
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
      // Remove any markdown code blocks if present
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
    console.error('Error in score-mock-test function:', error);
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
