import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Tutor work email mapping
const TUTOR_EMAIL_MAP: Record<string, string> = {
  "alisha": "alisha@scoresmartpte.com",
  "alisha jain": "alisha@scoresmartpte.com",
  "bhavneet": "bhavneet@scoresmartpte.com",
  "bhavneet virdi": "bhavneet@scoresmartpte.com",
  "nim": "nim@scoresmartpte.com",
  "nim shrestha": "nim@scoresmartpte.com",
  "syeda": "syeda@scoresmartpte.com",
};

function getTutorWorkEmail(tutorName: string): string | null {
  const normalized = tutorName.trim().toLowerCase();
  return TUTOR_EMAIL_MAP[normalized] || null;
}

interface BookingConfirmationRequest {
  studentName: string;
  studentEmail: string;
  tutorName: string;
  tutorEmail?: string;
  sessionTime: string;
  sessionDate: string;
  sessionType?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { studentName, studentEmail, tutorName, tutorEmail, sessionTime, sessionDate, sessionType }: BookingConfirmationRequest = await req.json();

    console.log("Sending booking confirmation email to:", studentEmail);
    console.log("Details:", { studentName, tutorName, tutorEmail, sessionTime, sessionDate, sessionType });

    if (!studentEmail) {
      console.error("No student email provided");
      return new Response(
        JSON.stringify({ error: "Student email is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const typeLabel = sessionType || "One-to-One";

    // Send email to student
    const studentEmailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "ScoreSmart <contact@update.scoresmart.au>",
        to: [studentEmail],
        subject: `Successfully booked ${typeLabel} class with ${tutorName} at ${sessionTime}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Booking Confirmation</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
            <div style="background-color: #ffffff; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #4CAF50; margin: 0; font-size: 28px;">✅ Session Booked Successfully!</h1>
              </div>
              
              <p style="font-size: 18px; margin-bottom: 20px;">Hi <strong>${studentName}</strong>,</p>
              
              <p style="font-size: 16px; margin-bottom: 25px;">
                You have successfully booked your ${typeLabel} session with <strong>${tutorName}</strong>.
              </p>
              
              <div style="background-color: #f0f9ff; border-left: 4px solid #2196F3; padding: 20px; margin: 25px 0; border-radius: 5px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; width: 120px;">👨‍🏫 Tutor:</td>
                    <td style="padding: 8px 0; font-weight: 600;">${tutorName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">📅 Date:</td>
                    <td style="padding: 8px 0; font-weight: 600;">${sessionDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">⏰ Time:</td>
                    <td style="padding: 8px 0; font-weight: 600;">${sessionTime} (Melbourne)</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">📚 Type:</td>
                    <td style="padding: 8px 0; font-weight: 600;">${typeLabel}</td>
                  </tr>
                </table>
              </div>
              
              <div style="background-color: #e8f5e9; border-left: 4px solid #4CAF50; padding: 20px; margin: 25px 0; border-radius: 5px;">
                <h2 style="color: #2e7d32; margin-top: 0; font-size: 18px;">📋 Instructions:</h2>
                <ul style="margin: 10px 0; padding-left: 20px; color: #2e7d32;">
                  <li style="margin-bottom: 10px;">Please go to your <strong>LMS Portal</strong></li>
                  <li style="margin-bottom: 10px;">You will see your session with a <strong>JOIN button</strong> on the Dashboard</li>
                  <li style="margin-bottom: 10px;">Or go to the <strong>Booked Sessions</strong> section to see all your sessions</li>
                </ul>
              </div>
              
              <div style="background-color: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 25px 0; border-radius: 5px;">
                <p style="margin: 0; color: #e65100; font-size: 14px;">
                  <strong>⚠️ Important:</strong> Please join your session on time. If you need to cancel, please do so at least 3 hours before the session to receive a quota refund.
                </p>
              </div>
              
              <p style="font-size: 14px; color: #666; margin-top: 30px;">
                Best regards,<br>
                <strong>The ScoreSmart Team</strong>
              </p>
            </div>
            
            <p style="text-align: center; font-size: 12px; color: #999; margin-top: 20px;">
              This is an automated message. Please do not reply to this email.
            </p>
          </body>
          </html>
        `,
      }),
    });

    const studentData = await studentEmailResponse.json();
    console.log("Student email sent successfully:", studentData);

    // Send notification email to admin
    const adminEmail = "contact@scoresmartpte.com";
    const alertSubject = `Session Alert for ${tutorName} with ${studentName} - ${sessionDate} at ${sessionTime}`;
    const alertEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session Alert</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ffffff; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2196F3; margin: 0; font-size: 28px;">📅 New Session Booked</h1>
          </div>
          
          <p style="font-size: 16px; margin-bottom: 25px;">
            <strong>${studentName}</strong> has booked a ${typeLabel} session with <strong>${tutorName}</strong>.
          </p>
          
          <div style="background-color: #f0f9ff; border-left: 4px solid #2196F3; padding: 20px; margin: 20px 0; border-radius: 5px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 120px;">👤 Student:</td>
                <td style="padding: 8px 0; font-weight: 600;">${studentName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">👨‍🏫 Tutor:</td>
                <td style="padding: 8px 0; font-weight: 600;">${tutorName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">📅 Date:</td>
                <td style="padding: 8px 0; font-weight: 600;">${sessionDate}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">⏰ Time:</td>
                <td style="padding: 8px 0; font-weight: 600;">${sessionTime} (Melbourne)</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">📚 Type:</td>
                <td style="padding: 8px 0; font-weight: 600;">${typeLabel}</td>
              </tr>
            </table>
          </div>
          
          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            Regards,<br>
            <strong>Score Smart LMS</strong>
          </p>
        </div>
      </body>
      </html>
    `;

    const adminEmailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "ScoreSmart <contact@update.scoresmart.au>",
        to: [adminEmail],
        subject: alertSubject,
        html: alertEmailHtml,
      }),
    });

    const adminData = await adminEmailResponse.json();
    console.log("Admin email sent successfully:", adminData);

    // Send notification email to the tutor
    let tutorData = null;
    const tutorWorkEmail = getTutorWorkEmail(tutorName);
    if (tutorWorkEmail) {
      console.log("Sending tutor notification to:", tutorWorkEmail);
      
      const tutorEmailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Session Assigned</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background-color: #ffffff; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #0f766e; margin: 0; font-size: 28px;">📅 New Session Assigned</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">A student has booked a session with you</p>
            </div>
            
            <p style="font-size: 16px; margin-bottom: 20px;">Hi <strong>${tutorName}</strong>,</p>
            
            <p style="font-size: 16px; margin-bottom: 25px;">
              <strong>${studentName}</strong> has booked a <strong>${typeLabel}</strong> session with you. Here are the details:
            </p>
            
            <div style="background-color: #f0fdf4; border-left: 4px solid #0f766e; padding: 20px; margin: 20px 0; border-radius: 5px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 120px;">👤 Student:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${studentName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">📅 Date:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${sessionDate}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">⏰ Time:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${sessionTime} (Melbourne)</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">📚 Type:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${typeLabel}</td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #047857; font-size: 14px;">
                💡 A Google Calendar invite has also been sent. The session will appear in your calendar automatically.
              </p>
            </div>
            
            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              Best regards,<br>
              <strong>Score Smart LMS</strong>
            </p>
          </div>
          
          <p style="text-align: center; font-size: 12px; color: #999; margin-top: 20px;">
            This is an automated notification from Score Smart LMS.
          </p>
        </body>
        </html>
      `;

      const tutorEmailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "ScoreSmart <contact@update.scoresmart.au>",
          to: [tutorWorkEmail],
          subject: `📅 New Session: ${studentName} - ${sessionDate} at ${sessionTime}`,
          html: tutorEmailHtml,
        }),
      });

      tutorData = await tutorEmailResponse.json();
      console.log("Tutor email sent successfully:", tutorData);
    } else {
      console.log("No work email mapping found for tutor:", tutorName);
    }

    return new Response(JSON.stringify({ success: true, studentEmail: studentData, adminEmail: adminData, tutorEmail: tutorData }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-booking-confirmation function:", error);
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
