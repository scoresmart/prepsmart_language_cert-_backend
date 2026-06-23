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
    const { email, status, accessTypes, oneToOneSessions, quadExpiryDate, courseExpiryDate } = await req.json();

    console.log('=== AIRTABLE UPDATE REQUEST ===');
    console.log('Email:', email);
    console.log('Status:', status);
    console.log('Access Types:', accessTypes);
    console.log('One to One Sessions:', oneToOneSessions);
    console.log('Quad Expiry:', quadExpiryDate);
    console.log('Course Expiry:', courseExpiryDate);

    if (!email || !status) {
      throw new Error('Email and status are required');
    }

    // First, find the record by email
    const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula={MAIL}="${email}"`;
    
    const searchResponse = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const searchResult = await searchResponse.json();

    console.log('Airtable search response:', JSON.stringify(searchResult, null, 2));

    if (!searchResponse.ok) {
      console.error('Airtable search error:', searchResult);
      throw new Error(searchResult.error?.message || 'Failed to find record in Airtable');
    }

    if (!searchResult.records || searchResult.records.length === 0) {
      console.error('No record found in Airtable for email:', email);
      return new Response(
        JSON.stringify({ success: false, message: 'Record not found in Airtable' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Update the first matching record
    const recordId = searchResult.records[0].id;
    console.log('Found Airtable record ID:', recordId);
    
    // Build fields object with all provided data using exact Airtable field names
    const fields: any = {
      status: status
    };
    
    if (accessTypes && accessTypes.length > 0) {
      fields['Access'] = accessTypes; // Multi-select field
    }
    
    if (oneToOneSessions !== undefined) {
      fields['one to one sessions'] = oneToOneSessions;
    }
    
    if (quadExpiryDate) {
      fields['Quad expiry'] = quadExpiryDate;
    }
    
    if (courseExpiryDate) {
      fields['COURSE EXPIRY'] = courseExpiryDate;
    }

    console.log('Updating Airtable with fields:', JSON.stringify(fields, null, 2));
    
    const updateResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: fields
        }),
      }
    );

    const updateResult = await updateResponse.json();

    if (!updateResponse.ok) {
      console.error('Airtable update error:', JSON.stringify(updateResult, null, 2));
      throw new Error(updateResult.error?.message || 'Failed to update status in Airtable');
    }

    console.log('=== AIRTABLE UPDATE SUCCESS ===');
    console.log('Updated record:', JSON.stringify(updateResult, null, 2));

    return new Response(
      JSON.stringify({ success: true, data: updateResult }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error in update-airtable-status function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
