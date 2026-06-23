import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AIRTABLE_API_KEY = Deno.env.get('AIRTABLE_API_KEY');
const BASE_ID = 'appWcOAmF9qcFyv1S';
const TABLE_ID = 'tblaDluoBDO2Dw1z3';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, email, phone, username, course, signup_date } = await req.json();

    console.log('Sending signup data to Airtable:', { name, email, username, course });

    // Format data using field IDs for stability
    const airtableData = {
      records: [
        {
          fields: {
            fldfT5Vn34sBF7od4: name,           // NAME
            fldWz2r2uhwl2qqnI: email,          // MAIL
            fldgqBCGwfBKyhyYY: phone,          // PHONE NUMBER
            fldnb9a2IzvmjOFwG: username,       // USERNAME
            fld7yYLL6EfTwZgH8: course,         // COURSE
            fldcmA6MFzY2pwjGu: signup_date.split('T')[0], // Signup_date (ISO date only)
            status: 'pending'                  // STATUS - automatically set to pending
          }
        }
      ]
    };

    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(airtableData),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Airtable API error:', result);
      throw new Error(result.error?.message || 'Failed to send data to Airtable');
    }

    console.log('Successfully sent to Airtable:', result);

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error in send-to-airtable function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
