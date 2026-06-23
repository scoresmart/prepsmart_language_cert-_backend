import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Student {
  name: string;
  email: string;
  phone: string;
}

interface AnnouncementRequest {
  slotId: string;
  tutorName: string;
  course: string;
  date: string;
  time: string;
  students: Student[];
  message: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tutorName, course, date, time, students, message }: AnnouncementRequest = await req.json();

    if (!students || students.length === 0) {
      return new Response(
        JSON.stringify({ error: "No students to notify" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const emailPromises = students.map(student => 
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "ScoreSmart <onboarding@resend.dev>",
          to: [student.email],
          subject: `Class Announcement - ${course}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #7c3aed;">Class Announcement</h2>
              
              <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Hi ${student.name},</h3>
                <p style="color: #4b5563; line-height: 1.6;">${message}</p>
              </div>

              <div style="background-color: #ede9fe; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h4 style="margin-top: 0; color: #7c3aed;">Class Details</h4>
                <p style="margin: 5px 0;"><strong>Course:</strong> ${course}</p>
                <p style="margin: 5px 0;"><strong>Tutor:</strong> ${tutorName}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${date}</p>
                <p style="margin: 5px 0;"><strong>Time:</strong> ${time}</p>
              </div>

              <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                Best regards,<br>
                <strong>ScoreSmart Team</strong>
              </p>
            </div>
          `,
        }),
      }).then(res => res.json())
    );

    const results = await Promise.allSettled(emailPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Announcement sent: ${successful} successful, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        success: true,
        sent: successful,
        failed: failed
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in send-slot-announcement function:", error);
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
