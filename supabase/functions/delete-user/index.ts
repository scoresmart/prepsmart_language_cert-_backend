import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verify authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requestingUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !requestingUser) {
      console.error('Invalid token or user not found:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Verify admin role
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', requestingUser.id)
      .single();

    if (profileError || profile?.role !== 'admin') {
      console.error('User is not an admin:', requestingUser.id);
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const { userId } = await req.json();

    if (!userId) {
      throw new Error('User ID is required');
    }

    console.log('Deleting user:', userId);

    // Clear references in one_to_one_slots (cancelled_by_student_id and student_id)
    const { error: clearCancelledError } = await supabaseAdmin
      .from('one_to_one_slots')
      .update({ cancelled_by_student_id: null })
      .eq('cancelled_by_student_id', userId);

    if (clearCancelledError) {
      console.error('Error clearing cancelled_by_student_id:', clearCancelledError);
    }

    const { error: clearStudentError } = await supabaseAdmin
      .from('one_to_one_slots')
      .update({ student_id: null, status: 'cancelled' })
      .eq('student_id', userId);

    if (clearStudentError) {
      console.error('Error clearing student_id from slots:', clearStudentError);
    }

    // Clear references in quad_bookings
    const { error: deleteQuadBookingsError } = await supabaseAdmin
      .from('quad_bookings')
      .delete()
      .eq('student_id', userId);

    if (deleteQuadBookingsError) {
      console.error('Error deleting quad bookings:', deleteQuadBookingsError);
    }

    // Clear references in enrollments
    const { error: deleteEnrollmentsError } = await supabaseAdmin
      .from('enrollments')
      .delete()
      .eq('student_id', userId);

    if (deleteEnrollmentsError) {
      console.error('Error deleting enrollments:', deleteEnrollmentsError);
    }

    // Clear references in student_tutor_assignments
    const { error: deleteAssignmentsError } = await supabaseAdmin
      .from('student_tutor_assignments')
      .delete()
      .eq('student_id', userId);

    if (deleteAssignmentsError) {
      console.error('Error deleting tutor assignments:', deleteAssignmentsError);
    }

    // Clear references in attendance_logs
    const { error: deleteAttendanceError } = await supabaseAdmin
      .from('attendance_logs')
      .delete()
      .eq('student_id', userId);

    if (deleteAttendanceError) {
      console.error('Error deleting attendance logs:', deleteAttendanceError);
    }

    // Clear references in practice_attempts
    const { error: deletePracticeError } = await supabaseAdmin
      .from('practice_attempts')
      .delete()
      .eq('student_id', userId);

    if (deletePracticeError) {
      console.error('Error deleting practice attempts:', deletePracticeError);
    }

    // Clear references in study_plans
    const { error: deleteStudyPlansError } = await supabaseAdmin
      .from('study_plans')
      .delete()
      .eq('student_id', userId);

    if (deleteStudyPlansError) {
      console.error('Error deleting study plans:', deleteStudyPlansError);
    }

    // Clear references in ratings
    const { error: deleteRatingsError } = await supabaseAdmin
      .from('ratings')
      .delete()
      .eq('student_id', userId);

    if (deleteRatingsError) {
      console.error('Error deleting ratings:', deleteRatingsError);
    }

    // Delete from student_access
    const { error: accessError } = await supabaseAdmin
      .from('student_access')
      .delete()
      .eq('student_id', userId);

    if (accessError) {
      console.error('Error deleting student access:', accessError);
    }

    // Delete from profiles
    const { error: deleteProfileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (deleteProfileError) {
      console.error('Error deleting profile:', deleteProfileError);
      throw deleteProfileError;
    }

    // Delete from auth.users (this is the critical part that needs service role)
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteAuthError) {
      console.error('Error deleting auth user:', deleteAuthError);
      throw deleteAuthError;
    }

    console.log('User deleted successfully:', userId);

    return new Response(
      JSON.stringify({ success: true, message: 'User deleted successfully' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in delete-user function:', error);
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
