import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

interface OneToOneSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  meet_link: string | null;
  subject: string;
  student_id: string;
  tutor_id: string;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("Session reminders function invoked");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // No body provided
    }

    // Test mode
    if (body.test && body.email) {
      console.log(`Sending test email to ${body.email}`);
      const testSessionDate = new Date();
      testSessionDate.setHours(testSessionDate.getHours() + 1);
      const formattedDate = testSessionDate.toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Australia/Melbourne" });
      const formattedTime = testSessionDate.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone: "Australia/Melbourne" });

      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: "ScoreSmart <contact@update.scoresmart.au>",
          to: [body.email],
          subject: `⏰ TEST: Your PTE session starts in 1 hour!`,
          html: `<p>Test reminder email sent at ${formattedDate} ${formattedTime}</p>`,
        }),
      });
      const responseData = await emailResponse.json();
      if (!emailResponse.ok) throw new Error(responseData.message || "Failed to send test email");
      return new Response(JSON.stringify({ success: true, message: `Test email sent to ${body.email}`, response: responseData }), {
        status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const now = new Date();
    
    // Time windows
    const oneHourWindowStart = new Date(now.getTime() + 55 * 60 * 1000);
    const oneHourWindowEnd = new Date(now.getTime() + 65 * 60 * 1000);
    const thirtyMinWindowStart = new Date(now.getTime() + 25 * 60 * 1000);
    const thirtyMinWindowEnd = new Date(now.getTime() + 35 * 60 * 1000);
    // 24 hour window for tutor reminders: 23h55m to 24h05m from now
    const twentyFourHourWindowStart = new Date(now.getTime() + (24 * 60 - 5) * 60 * 1000);
    const twentyFourHourWindowEnd = new Date(now.getTime() + (24 * 60 + 5) * 60 * 1000);

    console.log("Time windows:");
    console.log("1 hour:", oneHourWindowStart.toISOString(), "-", oneHourWindowEnd.toISOString());
    console.log("30 min:", thirtyMinWindowStart.toISOString(), "-", thirtyMinWindowEnd.toISOString());
    console.log("24 hour (tutor):", twentyFourHourWindowStart.toISOString(), "-", twentyFourHourWindowEnd.toISOString());

    // Fetch sessions for each window
    const [oneHourResult, thirtyMinResult, twentyFourHourResult] = await Promise.all([
      supabase.from("one_to_one_slots").select("id, starts_at, ends_at, meet_link, subject, student_id, tutor_id")
        .eq("status", "scheduled").not("student_id", "is", null)
        .gte("starts_at", oneHourWindowStart.toISOString()).lte("starts_at", oneHourWindowEnd.toISOString()),
      supabase.from("one_to_one_slots").select("id, starts_at, ends_at, meet_link, subject, student_id, tutor_id")
        .eq("status", "scheduled").not("student_id", "is", null)
        .gte("starts_at", thirtyMinWindowStart.toISOString()).lte("starts_at", thirtyMinWindowEnd.toISOString()),
      supabase.from("one_to_one_slots").select("id, starts_at, ends_at, meet_link, subject, student_id, tutor_id")
        .eq("status", "scheduled").not("student_id", "is", null)
        .gte("starts_at", twentyFourHourWindowStart.toISOString()).lte("starts_at", twentyFourHourWindowEnd.toISOString()),
    ]);

    const emailsSent: string[] = [];
    const errors: string[] = [];

    // Process student 1-hour reminders
    if (oneHourResult.data?.length) {
      console.log(`Found ${oneHourResult.data.length} sessions in 1-hour window`);
      for (const session of oneHourResult.data as OneToOneSlot[]) {
        await sendStudentReminder(supabase, session, "1 hour", emailsSent, errors);
      }
    }

    // Process student 30-min reminders
    if (thirtyMinResult.data?.length) {
      console.log(`Found ${thirtyMinResult.data.length} sessions in 30-min window`);
      for (const session of thirtyMinResult.data as OneToOneSlot[]) {
        await sendStudentReminder(supabase, session, "30 minutes", emailsSent, errors);
      }
    }

    // Process tutor 24-hour reminders
    if (twentyFourHourResult.data?.length) {
      console.log(`Found ${twentyFourHourResult.data.length} sessions in 24-hour window`);
      for (const session of twentyFourHourResult.data as OneToOneSlot[]) {
        await sendTutorReminder(supabase, session, emailsSent, errors);
      }
    }

    const result = {
      success: true,
      emailsSent: emailsSent.length,
      emails: emailsSent,
      errors,
      timestamp: now.toISOString(),
    };

    console.log("Reminder job completed:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-session-reminders:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

async function sendStudentReminder(
  supabase: any, session: OneToOneSlot, timeframe: string, emailsSent: string[], errors: string[]
) {
  try {
    const { data: student } = await supabase.from("profiles").select("id, name, email").eq("id", session.student_id).single();
    if (!student?.email) { errors.push(`No email for student ${session.student_id}`); return; }

    const { data: tutor } = await supabase.from("tutors").select("id, full_name").eq("id", session.tutor_id).single();
    const tutorName = tutor?.full_name || "Your Tutor";

    const sessionDate = new Date(session.starts_at);
    const formattedDate = sessionDate.toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Australia/Melbourne" });
    const formattedTime = sessionDate.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone: "Australia/Melbourne" });
    const meetLink = session.meet_link || "#";

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "ScoreSmart <contact@update.scoresmart.au>",
        to: [student.email],
        subject: `⏰ Reminder: Your ${session.subject} session starts in ${timeframe}!`,
        html: `
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">⏰ Session Reminder</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Your session starts in ${timeframe}!</p>
          </div>
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="font-size: 16px;">Hi <strong>${student.name}</strong>,</p>
            <p>Your <strong>${session.subject}</strong> one-to-one session is starting soon!</p>
            <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #6b7280;">📅 Date:</td><td style="padding: 8px 0; font-weight: 600;">${formattedDate}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">⏰ Time:</td><td style="padding: 8px 0; font-weight: 600;">${formattedTime} (Melbourne)</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">👨‍🏫 Tutor:</td><td style="padding: 8px 0; font-weight: 600;">${tutorName}</td></tr>
              </table>
            </div>
            ${session.meet_link ? `<div style="text-align: center; margin: 25px 0;"><a href="${meetLink}" style="display: inline-block; background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600;">🎥 Join Session Now</a></div>` : ''}
            <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 15px;">
              <p style="margin: 0; color: #047857; font-size: 14px;">💡 Test your mic and camera beforehand. Have your materials ready.</p>
            </div>
          </div>
          <div style="background: #1f2937; padding: 20px; border-radius: 0 0 12px 12px; text-align: center;">
            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${new Date().getFullYear()} ScoreSmart. All rights reserved.</p>
          </div>
        </body></html>`,
      }),
    });

    const responseData = await emailResponse.json();
    if (!emailResponse.ok) throw new Error(responseData.message || "Failed to send email");
    emailsSent.push(`${student.email} (student ${timeframe} reminder)`);
  } catch (err: any) {
    console.error(`Failed student reminder:`, err);
    errors.push(`Student reminder ${session.id}: ${err.message}`);
  }
}

async function sendTutorReminder(
  supabase: any, session: OneToOneSlot, emailsSent: string[], errors: string[]
) {
  try {
    // Get tutor name
    const { data: tutor } = await supabase.from("tutors").select("id, full_name").eq("id", session.tutor_id).single();
    const tutorName = tutor?.full_name || "Tutor";
    const tutorWorkEmail = getTutorWorkEmail(tutorName);

    if (!tutorWorkEmail) {
      console.log(`No work email mapping for tutor: ${tutorName}`);
      return;
    }

    // Get student name
    const { data: student } = await supabase.from("profiles").select("name").eq("id", session.student_id).single();
    const studentName = student?.name || "Student";

    const sessionDate = new Date(session.starts_at);
    const formattedDate = sessionDate.toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Australia/Melbourne" });
    const formattedTime = sessionDate.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone: "Australia/Melbourne" });

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "ScoreSmart <contact@update.scoresmart.au>",
        to: [tutorWorkEmail],
        subject: `⏰ Reminder: Session with ${studentName} tomorrow at ${formattedTime}`,
        html: `
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">📅 Session Tomorrow</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">You have a session in 24 hours</p>
          </div>
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="font-size: 16px;">Hi <strong>${tutorName}</strong>,</p>
            <p>This is a reminder that you have a <strong>${session.subject}</strong> one-to-one session tomorrow.</p>
            <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #6b7280;">👤 Student:</td><td style="padding: 8px 0; font-weight: 600;">${studentName}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">📅 Date:</td><td style="padding: 8px 0; font-weight: 600;">${formattedDate}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">⏰ Time:</td><td style="padding: 8px 0; font-weight: 600;">${formattedTime} (Melbourne)</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">📚 Subject:</td><td style="padding: 8px 0; font-weight: 600;">${session.subject}</td></tr>
              </table>
            </div>
            ${session.meet_link ? `<div style="text-align: center; margin: 25px 0;"><a href="${session.meet_link}" style="display: inline-block; background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600;">🎥 Session Link</a></div>` : ''}
          </div>
          <div style="background: #1f2937; padding: 20px; border-radius: 0 0 12px 12px; text-align: center;">
            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${new Date().getFullYear()} ScoreSmart. All rights reserved.</p>
          </div>
        </body></html>`,
      }),
    });

    const responseData = await emailResponse.json();
    if (!emailResponse.ok) throw new Error(responseData.message || "Failed to send email");
    emailsSent.push(`${tutorWorkEmail} (tutor 24hr reminder)`);
    console.log(`Tutor 24hr reminder sent to ${tutorWorkEmail}`);
  } catch (err: any) {
    console.error(`Failed tutor reminder:`, err);
    errors.push(`Tutor 24hr reminder ${session.id}: ${err.message}`);
  }
}

serve(handler);
