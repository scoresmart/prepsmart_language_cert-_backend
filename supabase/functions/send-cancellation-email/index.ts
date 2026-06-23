import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CancellationEmailRequest {
  studentName: string;
  studentEmail: string;
  tutorName: string;
  sessionTime: string;
  sessionDate: string;
  isShortNotice: boolean; // cancelled less than 3 hours before
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { studentName, studentEmail, tutorName, sessionTime, sessionDate, isShortNotice }: CancellationEmailRequest = await req.json();

    console.log("Sending cancellation email to:", studentEmail);
    console.log("Details:", { studentName, tutorName, sessionTime, sessionDate, isShortNotice });

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

    // Build student email HTML based on whether it's short notice or not
    const studentSubject = `Successfully Cancelled Your Session with ${tutorName} at ${sessionDate} ${sessionTime}`;
    
    let studentEmailHtml: string;
    
    if (isShortNotice) {
      // Short notice cancellation - session will be counted
      studentEmailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Session Cancelled</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background-color: #ffffff; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #f44336; margin: 0; font-size: 28px;">❌ Session Cancelled</h1>
            </div>
            
            <p style="font-size: 18px; margin-bottom: 20px;">Hi <strong>${studentName}</strong>,</p>
            
            <p style="font-size: 16px; margin-bottom: 25px;">
              Your session with <strong>${tutorName}</strong> on <strong>${sessionDate}</strong> at <strong>${sessionTime}</strong> has been successfully cancelled.
            </p>
            
            <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 20px; margin: 25px 0; border-radius: 5px;">
              <h2 style="color: #c62828; margin-top: 0; font-size: 18px;">⚠️ Important Notice:</h2>
              <p style="margin: 10px 0; color: #c62828;">
                <strong>This session will be counted towards your quota</strong> as we have a booking policy that requires cancellations to be made at least 3 hours before the session.
              </p>
            </div>
            
            <div style="background-color: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="margin: 0; color: #e65100; font-size: 14px;">
                <strong>💡 Tip:</strong> Please try to cancel sessions as early as possible to maintain consistency. Once booked, it is very hard to get a slot on the same day. For future bookings, please book carefully to avoid cancellations.
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
      `;
    } else {
      // Normal cancellation - session refunded
      studentEmailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Session Cancelled</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background-color: #ffffff; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #ff9800; margin: 0; font-size: 28px;">🔄 Session Cancelled</h1>
            </div>
            
            <p style="font-size: 18px; margin-bottom: 20px;">Hi <strong>${studentName}</strong>,</p>
            
            <p style="font-size: 16px; margin-bottom: 25px;">
              Your session with <strong>${tutorName}</strong> on <strong>${sessionDate}</strong> at <strong>${sessionTime}</strong> has been successfully cancelled and your session quota has been refunded.
            </p>
            
            <div style="background-color: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="margin: 0; color: #e65100; font-size: 14px;">
                <strong>💡 Reminder:</strong> Please try to cancel sessions as early as possible to maintain consistency. Once booked, it is very hard to get a slot on the same day. For future bookings, please book carefully to avoid cancellations.
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
      `;
    }

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
        subject: studentSubject,
        html: studentEmailHtml,
      }),
    });

    const studentData = await studentEmailResponse.json();
    console.log("Student cancellation email sent successfully:", studentData);

    // Build admin email HTML
    const adminSubject = `Session Cancelled: ${studentName}`;
    const adminEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session Cancelled</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ffffff; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #f44336; margin: 0; font-size: 28px;">❌ Session Cancelled</h1>
          </div>
          
          <p style="font-size: 16px; margin-bottom: 25px;">
            <strong>${studentName}</strong> has cancelled their session with <strong>${tutorName}</strong>.
          </p>
          
          <div style="background-color: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Session Details:</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li><strong>Date:</strong> ${sessionDate}</li>
              <li><strong>Time:</strong> ${sessionTime}</li>
              <li><strong>Tutor:</strong> ${tutorName}</li>
              <li><strong>Short Notice (< 3 hours):</strong> ${isShortNotice ? 'Yes - Session counted' : 'No - Quota refunded'}</li>
            </ul>
          </div>
          
          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            Regards,<br>
            <strong>Score Smart LMS</strong>
          </p>
        </div>
      </body>
      </html>
    `;

    // Send notification email to admin
    const adminEmail = "contact@scoresmartpte.com";
    const adminEmailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "ScoreSmart <contact@update.scoresmart.au>",
        to: [adminEmail],
        subject: adminSubject,
        html: adminEmailHtml,
      }),
    });

    const adminData = await adminEmailResponse.json();
    console.log("Admin cancellation email sent successfully:", adminData);

    return new Response(JSON.stringify({ success: true, studentEmail: studentData, adminEmail: adminData }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-cancellation-email function:", error);
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
