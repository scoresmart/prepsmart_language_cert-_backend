import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ApprovalEmailRequest {
  name: string;
  email: string;
  username?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { name, email, username }: ApprovalEmailRequest = await req.json();

    console.log('Sending approval email to:', email);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Account Approved - ScoreSmart</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Account Approved!</h1>
          </div>
          
          <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #10b981; margin-top: 0;">Welcome aboard, ${name}! 👋</h2>
            
            <p style="font-size: 16px; margin-bottom: 20px;">
              Great news! Your ScoreSmart account has been <strong style="color: #10b981;">approved</strong> by our admin team.
            </p>
            
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #10b981;">
              <h3 style="color: #10b981; margin-top: 0;">🔐 Your Login Credentials</h3>
              ${username ? `
                <p style="margin: 10px 0;">
                  <strong>Username:</strong> <code style="background: #dcfce7; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${username}</code>
                </p>
              ` : ''}
              <p style="margin: 10px 0;">
                <strong>Email:</strong> <code style="background: #dcfce7; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${email}</code>
              </p>
              <p style="margin: 10px 0; font-size: 14px; color: #666;">
                Use your password that you set during registration
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://scoresmartbookings.com/auth" 
                 target="_blank" 
                 style="display: inline-block; background: #10b981; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                🚀 Login to Your Portal
              </a>
            </div>
            
            <div style="text-align: center; margin: 20px 0;">
              <a href="https://scoresmartbookings.com/auth" 
                 target="_blank" 
                 style="display: inline-block; background: #6366f1; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                📝 Access Practice Portal
              </a>
            </div>
            
            <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0;">
              <h3 style="color: #3b82f6; margin-top: 0;">📺 Getting Started Tutorial</h3>
              <p style="margin: 15px 0;">
                New to the portal? Watch our quick tutorial to get started:
              </p>
              <a href="https://youtu.be/zf8cP9-Nkho" target="_blank" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 10px;">
                🎥 Watch Tutorial
              </a>
            </div>
            
            <div style="margin: 30px 0;">
              <h3 style="color: #10b981;">What's Next?</h3>
              <ul style="list-style: none; padding: 0;">
                <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                  ✅ <strong>Step 1:</strong> Login to your student portal
                </li>
                <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                  ✅ <strong>Step 2:</strong> Complete your profile setup
                </li>
                <li style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                  ✅ <strong>Step 3:</strong> Browse available classes and resources
                </li>
                <li style="padding: 10px 0;">
                  ✅ <strong>Step 4:</strong> Start your learning journey!
                </li>
              </ul>
            </div>
            
            <p style="font-size: 16px; margin-top: 30px;">
              If you have any questions or need assistance, our support team is here to help!
            </p>
            
            <p style="font-size: 16px; color: #6b7280; margin-top: 30px;">
              Best regards,<br>
              <strong style="color: #10b981;">The ScoreSmart Team</strong>
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
      subject: '🎉 Your ScoreSmart Account Has Been Approved!',
      html: emailHtml,
    });

    if (error) {
      console.error('Error sending approval email:', error);
      throw error;
    }

    console.log('Approval email sent successfully:', data);

    return new Response(
      JSON.stringify({ success: true, data }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in send-approval-email function:', error);
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
