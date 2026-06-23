import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AnnouncementEmailRequest {
  announcementId: string;
  title: string;
  body: string;
  link?: string | null;
  scope: string;
  targetStudentId?: string | null;
  subjectFilter?: string | null;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      announcementId,
      title, 
      body, 
      link,
      scope,
      targetStudentId,
      subjectFilter
    }: AnnouncementEmailRequest = await req.json();

    console.log(`Processing announcement email: ${title}, scope: ${scope}, subjectFilter: ${subjectFilter}`);

    let studentIds: string[] = [];

    // If scope is subject-based, first get students enrolled in that subject
    if (scope === "subject" && subjectFilter) {
      const { data: accessData, error: accessError } = await supabase
        .from("student_access")
        .select("student_id")
        .eq("subject", subjectFilter);

      if (accessError) {
        console.error("Error fetching student access:", accessError);
        throw accessError;
      }

      studentIds = accessData?.map(a => a.student_id) || [];
      console.log(`Found ${studentIds.length} students with ${subjectFilter} access`);

      if (studentIds.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, 
          sent: 0,
          message: `No students found with ${subjectFilter} access` 
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    // Fetch students based on scope
    let studentsQuery = supabase
      .from("profiles")
      .select("id, email, name")
      .eq("role", "student")
      .eq("approval_status", "approved");

    if (scope === "individual" && targetStudentId) {
      // Only send to specific student
      studentsQuery = studentsQuery.eq("id", targetStudentId);
    } else if (scope === "subject" && studentIds.length > 0) {
      // Filter by student IDs who have access to the subject
      studentsQuery = studentsQuery.in("id", studentIds);
    }
    // For scope === "all", we fetch all approved students

    const { data: students, error: studentsError } = await studentsQuery;

    if (studentsError) {
      console.error("Error fetching students:", studentsError);
      throw studentsError;
    }

    if (!students || students.length === 0) {
      console.log("No students found to send announcement to");
      return new Response(JSON.stringify({ 
        success: true, 
        sent: 0,
        message: "No students found to send announcement to" 
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Filter out students without valid email
    const validStudents = students.filter(s => s.email && s.email.includes("@"));
    
    console.log(`Sending announcement to ${validStudents.length} students`);

    // Generate email HTML
    const generateEmailHtml = (studentName: string) => `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px; font-weight: bold;">📢 New Announcement</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">ScoreSmart Student Portal</p>
            </div>
            
            <!-- Content -->
            <div style="background-color: white; padding: 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <p style="color: #374151; font-size: 16px; margin: 0 0 20px 0;">
                Hi ${studentName || 'Student'},
              </p>
              
              <h2 style="color: #1f2937; font-size: 20px; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #e5e7eb;">
                ${title}
              </h2>
              
              <div style="background-color: #f9fafb; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #7c3aed;">
                <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0; white-space: pre-wrap;">
                  ${body}
                </p>
              </div>
              
              ${link ? `
                <div style="text-align: center; margin: 25px 0;">
                  <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #2563eb, #7c3aed); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                    View More Details →
                  </a>
                </div>
              ` : ''}
              
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
              
              <p style="color: #6b7280; font-size: 13px; margin: 0;">
                This is an automated message from ScoreSmart. Please do not reply to this email.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
              <p style="margin: 0;">© ${new Date().getFullYear()} ScoreSmart. All rights reserved.</p>
              <p style="margin: 5px 0 0 0;">Your Path to Success</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Send emails in batches to avoid rate limits
    const batchSize = 10;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < validStudents.length; i += batchSize) {
      const batch = validStudents.slice(i, i + batchSize);
      
      const emailPromises = batch.map(student => 
        resend.emails.send({
          from: "ScoreSmart <contact@update.scoresmart.au>",
          to: [student.email],
          subject: `📢 ${title}`,
          html: generateEmailHtml(student.name),
        })
      );

      const results = await Promise.allSettled(emailPromises);
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successCount++;
          console.log(`Email sent to ${batch[index].email}`);
        } else {
          failCount++;
          console.error(`Failed to send email to ${batch[index].email}:`, result.reason);
        }
      });

      // Add small delay between batches to avoid rate limits
      if (i + batchSize < validStudents.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`Announcement emails completed: ${successCount} sent, ${failCount} failed`);

    return new Response(JSON.stringify({ 
      success: true, 
      sent: successCount,
      failed: failCount,
      total: validStudents.length,
      message: `Announcement sent to ${successCount} out of ${validStudents.length} students` 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-announcement-email function:", error);
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
