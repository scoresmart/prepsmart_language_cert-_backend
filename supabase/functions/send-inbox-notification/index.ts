import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PORTAL_URL = "https://scoresmart-uni-hub.lovable.app";

interface InboxNotificationRequest {
  type: "student_message" | "tutor_reply";
  student_name: string;
  student_email: string;
  message: string;
  sender_name?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, student_name, student_email, message, sender_name }: InboxNotificationRequest = await req.json();

    if (!type || !student_name || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Skip voice messages and image-only messages for cleaner emails
    const cleanMessage = message.replace(/\|https?:\/\/\S+/g, "").trim();

    if (type === "student_message") {
      // Student sent a message → notify admin
      const emailResponse = await resend.emails.send({
        from: "ScoreSmart Portal <noreply@update.scoresmart.au>",
        to: ["contac@scoresmartpte.com"],
        subject: `${student_name} has messaged, please check`,
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h2 style="color: #ffffff; margin: 0; font-size: 20px;">📩 New Message from ${student_name}</h2>
            </div>
            
            <div style="padding: 24px 32px;">
              <div style="background-color: #f8fafc; padding: 16px 20px; border-radius: 10px; margin: 0 0 20px; border-left: 4px solid #2563eb;">
                <p style="margin: 0; white-space: pre-wrap; color: #1e293b; font-size: 15px; line-height: 1.6;">${cleanMessage}</p>
              </div>

              <a href="${PORTAL_URL}/admin/inbox" style="display: inline-block; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                Open Inbox →
              </a>

              <p style="color: #94a3b8; font-size: 12px; margin-top: 20px;">
                ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })} (Melbourne Time)
              </p>
            </div>

            <div style="background: #f8fafc; padding: 16px 32px; border-radius: 0 0 12px 12px; text-align: center;">
              <p style="color: #94a3b8; font-size: 11px; margin: 0;">ScoreSmart Portal – Inbox Notification</p>
            </div>
          </div>
        `,
      });

      console.log("Admin inbox notification sent:", emailResponse);
      return new Response(JSON.stringify(emailResponse), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (type === "tutor_reply") {
      // Tutor/admin replied → notify student
      if (!student_email) {
        console.log("No student email, skipping notification");
        return new Response(JSON.stringify({ skipped: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const replyFrom = sender_name || "your tutor";

      const emailResponse = await resend.emails.send({
        from: "ScoreSmart Portal <noreply@update.scoresmart.au>",
        to: [student_email],
        subject: `💬 ${replyFrom} just sent you a new message – Check your inbox`,
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h2 style="color: #ffffff; margin: 0; font-size: 20px;">💬 New message from ${replyFrom}</h2>
              <p style="color: #d1fae5; margin: 6px 0 0; font-size: 14px;">You have a new reply waiting in your inbox</p>
            </div>
            
            <div style="padding: 24px 32px;">
              <div style="background-color: #f0fdf4; padding: 16px 20px; border-radius: 10px; margin: 0 0 24px; border-left: 4px solid #10b981;">
                <p style="margin: 0; white-space: pre-wrap; color: #1e293b; font-size: 15px; line-height: 1.6;">${cleanMessage}</p>
              </div>

              <div style="text-align: center; margin: 24px 0;">
                <a href="${PORTAL_URL}/student/chat" style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; padding: 14px 36px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);">
                  Open Chat Now →
                </a>
              </div>

              <p style="color: #64748b; font-size: 13px; text-align: center; margin-top: 8px;">
                Log in to your ScoreSmart portal to reply
              </p>

              <p style="color: #94a3b8; font-size: 12px; margin-top: 20px;">
                ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })} (Melbourne Time)
              </p>
            </div>

            <div style="background: #f8fafc; padding: 16px 32px; border-radius: 0 0 12px 12px; text-align: center;">
              <p style="color: #94a3b8; font-size: 11px; margin: 0;">ScoreSmart Portal – Inbox Notification</p>
            </div>
          </div>
        `,
      });

      console.log("Student inbox notification sent:", emailResponse);
      return new Response(JSON.stringify(emailResponse), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(
      JSON.stringify({ error: "Invalid notification type" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-inbox-notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
