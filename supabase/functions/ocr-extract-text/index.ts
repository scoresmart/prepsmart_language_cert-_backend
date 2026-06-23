const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, extractOptions, extractDragBlanks, extractReorder } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'Image URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing image:', imageUrl, 'extractOptions:', extractOptions, 'extractDragBlanks:', extractDragBlanks, 'extractReorder:', extractReorder);

    // Different prompts based on mode
    let promptText: string;
    
    if (extractReorder) {
      // Mode for extracting reorder paragraphs sentences
      promptText = `Analyze this image which shows numbered sentences/paragraphs for a "Reorder Paragraphs" question.

This is a question where:
- There are several numbered sentences (like "1)", "2)", "3)" or "1.", "2.", "3.")
- Each sentence is a separate paragraph or statement
- Students need to rearrange these sentences into the correct logical order
- The sentences are shown in the WRONG order and need to be reordered

Extract and return a JSON object with this exact structure:
{
  "sentences": ["sentence 1 text", "sentence 2 text", "sentence 3 text", ...],
  "correctSequence": [3, 1, 4, 2]
}

IMPORTANT:
1. For "sentences": Extract each sentence in the ORDER they appear in the image (this is the wrong/shuffled order). Do NOT include the numbers like "1)" or "2." at the start - just the sentence text.
2. For "correctSequence": If you can determine the correct logical order, provide it as an array of numbers indicating which sentence should come first, second, etc. For example, [3,1,4,2] means sentence 3 comes first, then sentence 1, then sentence 4, then sentence 2 in the correct order.
3. If you cannot determine the correct order with certainty, return an empty array [] for correctSequence
4. Return ONLY the JSON object, no other text
5. Clean up any quotation marks at the start/end of sentences but preserve internal quotes`;
    } else if (extractDragBlanks) {
      // Mode for extracting drag-and-drop blanks format (like the APEUni screenshot)
      promptText = `Analyze this reading comprehension question with drag-and-drop blanks.

This is a fill-in-the-blanks question where:
- There is a passage with blank spaces/gaps
- The answers are shown in red/colored text like "(Answer: word)" next to each blank
- At the bottom there is a pool of draggable word options (usually in colored boxes/buttons)
- There may also be an answer key at the very bottom like "1.word, 2.word, 3.word"

Extract and return a JSON object with this exact structure:
{
  "passage": "The passage text with [blank] markers where the blanks are. Replace each blank/gap with [blank]",
  "allOptions": ["option1", "option2", "option3", ...], 
  "correctAnswers": ["answer1", "answer2", "answer3", ...]
}

IMPORTANT:
1. For "passage": Extract the full passage text. Replace every blank/gap/empty box with exactly [blank]
2. For "allOptions": Extract ALL the draggable word options shown at the bottom (the word bank/pool). These are usually in colored boxes.
3. For "correctAnswers": Extract the correct answers IN ORDER for each blank. Look for:
   - Text like "(Answer: word)" shown in red/colored next to blanks
   - Or an answer key at bottom like "1.contribute, 2.reduction, 3.context"
4. Return ONLY the JSON object, no other text
5. Preserve the exact order of correct answers matching blank positions`;
    } else if (extractOptions) {
      // Mode for extracting dropdown options from a screenshot
      promptText = `Look at this image which shows dropdown options or multiple choice options for a fill-in-the-blank question.

Extract ONLY the text options shown. These are typically 3-4 word choices that appear in a dropdown or list.

Return the options as a JSON array of strings, for example:
["option1", "option2", "option3", "option4"]

IMPORTANT:
- Extract ONLY the option text, no numbers or bullets
- Return ONLY the JSON array, nothing else
- If you see less than 4 options, return what you see
- Clean up any extra whitespace`;
    } else {
      // Original mode for full text extraction
      promptText = `Extract ALL the text from this image exactly as it appears. This is a reading comprehension question with blanks/gaps that students need to fill in. 

IMPORTANT INSTRUCTIONS:
1. Extract the text EXACTLY as written, preserving all punctuation and formatting
2. Where there are blank spaces, dropdown boxes, or gaps to fill in, represent them as [blank]
3. Do NOT add any extra text, explanations, or commentary
4. Do NOT include any headers like "Question:" or "Text:"
5. Just output the raw extracted text with [blank] for the gaps

Output ONLY the extracted text, nothing else.`;
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: promptText
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', errorText);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to process image' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const extractedContent = data.choices?.[0]?.message?.content || '';

    console.log('Content extracted:', extractedContent);

    if (extractReorder) {
      // Parse the reorder data from the response
      try {
        // Try to extract JSON object from the response
        const jsonMatch = extractedContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log('Parsed reorder data:', parsed);
          
          return new Response(
            JSON.stringify({ 
              success: true, 
              reorderData: {
                sentences: parsed.sentences || [],
                correctSequence: parsed.correctSequence || []
              }
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          console.error('No JSON found in response');
          return new Response(
            JSON.stringify({ success: false, error: 'Could not parse reorder data from image' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (parseError) {
        console.error('Failed to parse reorder data:', parseError);
        return new Response(
          JSON.stringify({ success: false, error: 'Could not parse reorder data from image' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (extractDragBlanks) {
      // Parse the drag blanks data from the response
      try {
        // Try to extract JSON object from the response
        const jsonMatch = extractedContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log('Parsed drag blanks data:', parsed);
          
          return new Response(
            JSON.stringify({ 
              success: true, 
              dragBlankData: {
                passage: parsed.passage || '',
                allOptions: parsed.allOptions || [],
                correctAnswers: parsed.correctAnswers || []
              }
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          console.error('No JSON found in response');
          return new Response(
            JSON.stringify({ success: false, error: 'Could not parse drag-drop data from image' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (parseError) {
        console.error('Failed to parse drag blanks data:', parseError);
        return new Response(
          JSON.stringify({ success: false, error: 'Could not parse drag-drop data from image' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (extractOptions) {
      // Parse the options from the response
      try {
        // Try to extract JSON array from the response
        const jsonMatch = extractedContent.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const options = JSON.parse(jsonMatch[0]);
          console.log('Parsed options:', options);
          return new Response(
            JSON.stringify({ success: true, options }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          // Try to split by newlines if no JSON found
          const lines = extractedContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('[') && !l.startsWith(']'));
          console.log('Fallback lines:', lines);
          return new Response(
            JSON.stringify({ success: true, options: lines.slice(0, 4) }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (parseError) {
        console.error('Failed to parse options:', parseError);
        return new Response(
          JSON.stringify({ success: false, error: 'Could not parse options from image' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Return text extraction result
      return new Response(
        JSON.stringify({ success: true, text: extractedContent.trim() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error processing image:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process image';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
