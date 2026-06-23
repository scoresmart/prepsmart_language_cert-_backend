import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AnnouncementRequest {
  sessionTitle: string;
  sessionDate: string;
  sessionTime: string;
  message: string;
  students: Array<{
    email: string;
    name: string;
  }>;
  tutorName: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      sessionTitle, 
      sessionDate, 
      sessionTime, 
      message, 
      students,
      tutorName 
    }: AnnouncementRequest = await req.json();

    console.log(`Sending announcement for ${sessionTitle} to ${students.length} students`);

    // Send individual email to each student in the batch
    const emailPromises = students.map(student => 
      resend.emails.send({
        from: "ScoreSmart <contact@update.scoresmart.au>",
        to: [student.email],
        subject: `Session Update: ${sessionTitle}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1e40af;">Session Announcement</h2>
            
            <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Class:</strong> ${sessionTitle}</p>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${sessionDate}</p>
              <p style="margin: 5px 0;"><strong>Time:</strong> ${sessionTime}</p>
            </div>
            
            <div style="background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #92400e;">Message from ${tutorName}</h3>
              <p style="white-space: pre-wrap; color: #78350f;">${message}</p>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              This announcement was sent specifically to students enrolled in this session.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            
            <p style="color: #9ca3af; font-size: 12px;">
              ScoreSmart - Your Path to Success<br>
              If you have any questions, please contact your tutor.
            </p>
          </div>
        `,
      })
    );

    const results = await Promise.allSettled(emailPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Emails sent: ${successful} successful, ${failed} failed`);

    if (failed > 0) {
      console.error("Some emails failed:", results.filter(r => r.status === 'rejected'));
    }

    return new Response(JSON.stringify({ 
      success: true, 
      sent: successful,
      failed: failed,
      message: `Announcement sent to ${successful} out of ${students.length} students` 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-session-announcement function:", error);
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
