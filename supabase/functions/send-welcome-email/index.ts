import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WelcomeEmailRequest {
  name: string;
  email: string;
  course: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { name, email, course }: WelcomeEmailRequest = await req.json();

    console.log('Sending welcome email to:', email);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to ScoreSmart</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to ScoreSmart! 🎉</h1>
          </div>
          
          <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #667eea; margin-top: 0;">Hi ${name}! 👋</h2>
            
            <p style="font-size: 16px; margin-bottom: 20px;">
              Thank you for choosing <strong>ScoreSmart</strong> for your <strong>${course}</strong> preparation journey!
            </p>
            
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <h3 style="color: #667eea; margin-top: 0;">📋 Application Status</h3>
              <p style="margin: 10px 0;">
                Your application is currently <strong style="color: #f59e0b;">pending approval</strong> from our admin team.
              </p>
              <p style="margin: 10px 0;">
                Your account will be approved very soon! We will notify you once your account is activated.
              </p>
            </div>
            
            <div style="background: #eff6ff; border-left: 4px solid #667eea; padding: 20px; margin: 25px 0; text-align: center;">
              <h3 style="color: #667eea; margin-top: 0;">📺 Learn How to Use the Portal</h3>
              <p style="margin: 15px 0;">
                While you wait for approval, watch this tutorial video to learn how to use the ScoreSmart Portal:
              </p>
              <a href="https://youtu.be/zf8cP9-Nkho" target="_blank" style="display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 10px;">
                🎥 Watch Tutorial Video
              </a>
            </div>
            
            <div style="margin: 30px 0;">
              <h3 style="color: #667eea;">What happens next?</h3>
              <ul style="list-style: none; padding: 0;">
                <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                  ✅ <strong>Step 1:</strong> Our team reviews your application
                </li>
                <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                  ✅ <strong>Step 2:</strong> You will receive an approval email
                </li>
                <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                  ✅ <strong>Step 3:</strong> Access your personalized learning dashboard
                </li>
                <li style="padding: 10px 0;">
                  ✅ <strong>Step 4:</strong> Start your journey to success!
                </li>
              </ul>
            </div>
            
            <p style="font-size: 16px; margin-top: 30px;">
              If you have any questions, feel free to reach out to our support team.
            </p>
            
            <p style="font-size: 16px; color: #6b7280; margin-top: 30px;">
              Best regards,<br>
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
      subject: `Welcome to ScoreSmart - Application Received! 🎉`,
      html: emailHtml,
    });

    if (error) {
      console.error('Error sending email:', error);
      throw error;
    }

    console.log('Email sent successfully:', data);

    return new Response(
      JSON.stringify({ success: true, data }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in send-welcome-email function:', error);
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
