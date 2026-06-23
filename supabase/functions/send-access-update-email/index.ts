import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AccessUpdateEmailRequest {
  name: string;
  email: string;
  subject: string;
  accessTypes: string[];
  expiryDate?: string;
  quadExpiryDate?: string;
  oneToOneQuota?: number;
  isNewAccess: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      name, 
      email, 
      subject, 
      accessTypes, 
      expiryDate,
      quadExpiryDate,
      oneToOneQuota,
      isNewAccess 
    }: AccessUpdateEmailRequest = await req.json();

    console.log('Sending access update email to:', email);

    const formatDate = (dateStr?: string) => {
      if (!dateStr) return 'Not set';
      return new Date(dateStr).toLocaleDateString('en-AU', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
    };

    const accessTypesList = accessTypes.map(type => 
      `<li style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
        <strong style="color: #667eea;">✓ ${type}</strong>
      </li>`
    ).join('');

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${isNewAccess ? 'Access Granted' : 'Access Updated'} - ScoreSmart</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">
              ${isNewAccess ? '🎉 Access Granted!' : '📝 Access Updated!'}
            </h1>
          </div>
          
          <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #667eea; margin-top: 0;">Hi ${name}! 👋</h2>
            
            <p style="font-size: 16px; margin-bottom: 20px;">
              ${isNewAccess 
                ? `Great news! You've been granted access to <strong>${subject}</strong> course materials and classes.`
                : `Your access to <strong>${subject}</strong> has been updated by our admin team.`
              }
            </p>
            
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <h3 style="color: #667eea; margin-top: 0;">📚 Your Course Access</h3>
              <p style="margin: 10px 0;">
                <strong>Course:</strong> <span style="color: #667eea; font-weight: 600;">${subject}</span>
              </p>
              
              <h4 style="color: #667eea; margin: 15px 0 10px 0;">Access Types:</h4>
              <ul style="list-style: none; padding: 0; margin: 0;">
                ${accessTypesList}
              </ul>
            </div>
            
            <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0;">
              <h3 style="color: #3b82f6; margin-top: 0;">📅 Access Details</h3>
              ${expiryDate ? `
                <p style="margin: 10px 0;">
                  <strong>Master Class Expiry:</strong> ${formatDate(expiryDate)}
                </p>
              ` : ''}
              ${quadExpiryDate ? `
                <p style="margin: 10px 0;">
                  <strong>Quad Class Expiry:</strong> ${formatDate(quadExpiryDate)}
                </p>
              ` : ''}
              ${oneToOneQuota ? `
                <p style="margin: 10px 0;">
                  <strong>One-to-One Sessions:</strong> ${oneToOneQuota} sessions available
                </p>
              ` : ''}
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovableproject.com') || 'https://cd5c4eb0-01aa-4d64-bfb7-beaea617969f.lovableproject.com'}/auth" 
                 target="_blank" 
                 style="display: inline-block; background: #667eea; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                🚀 Access Your Portal
              </a>
            </div>
            
            <div style="margin: 30px 0;">
              <h3 style="color: #667eea;">What You Can Do Now:</h3>
              <ul style="list-style: none; padding: 0;">
                ${accessTypes.includes('Feedback Class') ? `
                  <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                    📖 <strong>Feedback Class:</strong> Access study materials and resources
                  </li>
                ` : ''}
                ${accessTypes.includes('Quad Class') ? `
                  <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                    👥 <strong>Quad Class:</strong> Book and attend small group sessions
                  </li>
                ` : ''}
                ${accessTypes.includes('One to One') ? `
                  <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                    🎯 <strong>One-to-One:</strong> Schedule personalized tutoring sessions
                  </li>
                ` : ''}
                <li style="padding: 10px 0;">
                  📊 <strong>Track Progress:</strong> Monitor your performance and improvements
                </li>
              </ul>
            </div>
            
            <p style="font-size: 16px; margin-top: 30px;">
              Ready to start learning? Login to your portal and explore all the resources available to you!
            </p>
            
            <p style="font-size: 16px; color: #6b7280; margin-top: 30px;">
              Best of luck with your studies!<br>
              <strong style="color: #667eea;">The ScoreSmart Team</strong>
            </p>
          </div>
          
          <div style="text-align: center; padding: 20px; color: #6b7280; font-size: 14px;">
            <p style="margin: 5px 0;">© 2025 ScoreSmart Portal. All rights reserved.</p>
            <p style="margin: 5px 0;">Empowering students to achieve their dreams.</p>
          </div>
        </body>
      </html>
    `;

    const { data, error } = await resend.emails.send({
      from: 'ScoreSmart Portal <noreply@update.scoresmart.au>',
      to: [email],
      subject: `${isNewAccess ? '🎉' : '📝'} ${subject} Course Access ${isNewAccess ? 'Granted' : 'Updated'}!`,
      html: emailHtml,
    });

    if (error) {
      console.error('Error sending access update email:', error);
      throw error;
    }

    console.log('Access update email sent successfully:', data);

    return new Response(
      JSON.stringify({ success: true, data }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in send-access-update-email function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
