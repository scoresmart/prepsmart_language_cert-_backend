import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Admin email to receive notifications
const ADMIN_EMAIL = "scoresmartpte@gmail.com";
const FROM_EMAIL = "ScoreSmart Portal <contact@update.scoresmart.au>";

interface TutorActivityRequest {
  tutorName: string;
  tutorEmail: string;
  activityType: "sign_in" | "sign_out";
  timestamp: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tutorName, tutorEmail, activityType, timestamp }: TutorActivityRequest = await req.json();

    console.log(`Sending tutor ${activityType} notification for ${tutorName} (${tutorEmail})`);

    // Format timestamp for Melbourne timezone
    const formattedTime = new Date(timestamp).toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const actionLabel = activityType === "sign_in" ? "clocked in" : "clocked off";
    const subject = `${tutorName} ${actionLabel} at ${formattedTime}`;
    
    const bodyMessage = activityType === "sign_in" 
      ? `Hi Admin,\n\nThis is to notify you that ${tutorName} has started their shift.\n\nEmail: ${tutorEmail}\nTime: ${formattedTime} (Melbourne)\n\nRegards,\nScoreSmart Portal`
      : `Hi Admin,\n\nThis is to notify you that ${tutorName} has signed out at ${formattedTime}.\n\nEmail: ${tutorEmail}\n\nRegards,\nScoreSmart Portal`;

    const emailResponse = await resend.emails.send({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      subject: subject,
      text: bodyMessage,
      html: activityType === "sign_in" ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <p>Hi Admin,</p>
          <p>This is to notify you that <strong>${tutorName}</strong> has started their shift.</p>
          <table style="margin: 20px 0;">
            <tr>
              <td style="padding: 5px 10px 5px 0; font-weight: bold;">Tutor:</td>
              <td style="padding: 5px 0;">${tutorName}</td>
            </tr>
            <tr>
              <td style="padding: 5px 10px 5px 0; font-weight: bold;">Email:</td>
              <td style="padding: 5px 0;">${tutorEmail}</td>
            </tr>
            <tr>
              <td style="padding: 5px 10px 5px 0; font-weight: bold;">Time:</td>
              <td style="padding: 5px 0;">${formattedTime} (Melbourne)</td>
            </tr>
          </table>
          <p>Regards,<br>ScoreSmart Portal</p>
        </div>
      ` : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <p>Hi Admin,</p>
          <p>This is to notify you that <strong>${tutorName}</strong> has signed out at ${formattedTime}.</p>
          <table style="margin: 20px 0;">
            <tr>
              <td style="padding: 5px 10px 5px 0; font-weight: bold;">Tutor:</td>
              <td style="padding: 5px 0;">${tutorName}</td>
            </tr>
            <tr>
              <td style="padding: 5px 10px 5px 0; font-weight: bold;">Email:</td>
              <td style="padding: 5px 0;">${tutorEmail}</td>
            </tr>
          </table>
          <p>Regards,<br>ScoreSmart Portal</p>
        </div>
      `,
    });

    console.log("Tutor activity email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-tutor-activity-email function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
