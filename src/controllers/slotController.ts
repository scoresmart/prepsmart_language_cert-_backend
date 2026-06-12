import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// ─── Quad Slots ───────────────────────────────────────────────────────────────

// GET /api/v1/slots/quad
export async function listQuadSlots(req: Request, res: Response, next: NextFunction) {
  try {
    const { subject, tutor_id, status, from, to } = req.query as Record<string, string>;

    let query = getSupabase()
      .from('quad_slots')
      .select('*')
      .order('starts_at', { ascending: true });

    if (subject) query = query.eq('subject', subject);
    if (tutor_id) query = query.eq('tutor_id', tutor_id);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('starts_at', from);
    if (to) query = query.lte('starts_at', to);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/slots/quad/:id
export async function getQuadSlotById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('quad_slots')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Quad slot not found' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/slots/quad  (admin/tutor)
export async function createQuadSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      subject,
      tutor_id,
      starts_at,
      ends_at,
      max_seats,
      meet_link,
      status,
      capacity,
      is_student_visible,
      notes,
    } = req.body;

    if (!subject || !tutor_id || !starts_at || !ends_at) {
      return res.status(400).json({ success: false, message: 'subject, tutor_id, starts_at, and ends_at are required' });
    }

    const { data, error } = await getSupabase()
      .from('quad_slots')
      .insert({
        subject,
        tutor_id,
        starts_at,
        ends_at,
        max_seats: max_seats ?? null,
        seats_taken: 0,
        meet_link: meet_link ?? null,
        status: status ?? 'scheduled',
        capacity: capacity ?? null,
        booked_count: 0,
        is_student_visible: is_student_visible ?? true,
        notes: notes ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/slots/quad/:id  (admin/tutor)
export async function updateQuadSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      subject,
      tutor_id,
      starts_at,
      ends_at,
      max_seats,
      meet_link,
      status,
      capacity,
      is_student_visible,
      notes,
    } = req.body;

    const { data, error } = await getSupabase()
      .from('quad_slots')
      .update({
        subject,
        tutor_id,
        starts_at,
        ends_at,
        max_seats,
        meet_link,
        status,
        capacity,
        is_student_visible,
        notes,
      })
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/slots/quad/:id  (admin)
export async function deleteQuadSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from('quad_slots')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    return res.json({ success: true, message: 'Quad slot deleted' });
  } catch (error) {
    next(error);
  }
}

// ─── Quad Bookings ────────────────────────────────────────────────────────────

// POST /api/v1/slots/quad/:id/book  (student)
export async function bookQuadSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const slotId = req.params.id;
    const studentId = req.user!.sub;
    const supabase = getSupabase();

    // Fetch the slot to validate capacity
    const { data: slot, error: slotError } = await supabase
      .from('quad_slots')
      .select('id, status, max_seats, booked_count, capacity')
      .eq('id', slotId)
      .single();

    if (slotError || !slot) {
      return res.status(404).json({ success: false, message: 'Quad slot not found' });
    }

    if (slot.status !== 'scheduled') {
      return res.status(400).json({ success: false, message: 'Slot is not available for booking' });
    }

    const effectiveMax = slot.capacity ?? slot.max_seats;
    if (effectiveMax !== null && slot.booked_count >= effectiveMax) {
      return res.status(400).json({ success: false, message: 'Slot is fully booked' });
    }

    // Check for existing active booking by this student
    const { data: existing } = await supabase
      .from('quad_bookings')
      .select('id')
      .eq('slot_id', slotId)
      .eq('student_id', studentId)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already booked this slot' });
    }

    // Insert booking
    const { data: booking, error: bookingError } = await supabase
      .from('quad_bookings')
      .insert({
        slot_id: slotId,
        student_id: studentId,
        status: 'confirmed',
        booked_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (bookingError) throw bookingError;

    // Increment booked_count on the slot
    const { error: updateError } = await supabase
      .from('quad_slots')
      .update({ booked_count: slot.booked_count + 1 })
      .eq('id', slotId);

    if (updateError) throw updateError;

    return res.status(201).json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/slots/quad/bookings/:bookingId/cancel
export async function cancelQuadBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookingId } = req.params;
    const supabase = getSupabase();

    // Fetch booking first
    const { data: booking, error: fetchError } = await supabase
      .from('quad_bookings')
      .select('id, student_id, slot_id, status')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Only the booking owner or an admin may cancel
    if (req.user!.role !== 'admin' && booking.student_id !== req.user!.sub) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Booking is already cancelled' });
    }

    const { cancel_reason } = req.body;

    const { data: updated, error: cancelError } = await supabase
      .from('quad_bookings')
      .update({
        status: 'cancelled',
        cancel_reason: cancel_reason ?? null,
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select('*')
      .single();

    if (cancelError) throw cancelError;

    // Decrement booked_count on the slot (floor at 0)
    const { data: slot } = await supabase
      .from('quad_slots')
      .select('booked_count')
      .eq('id', booking.slot_id)
      .single();

    if (slot && slot.booked_count > 0) {
      await supabase
        .from('quad_slots')
        .update({ booked_count: slot.booked_count - 1 })
        .eq('id', booking.slot_id);
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/slots/quad/bookings/mine
export async function listMyQuadBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('quad_bookings')
      .select('*, quad_slots(*)')
      .eq('student_id', req.user!.sub)
      .order('booked_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/slots/quad/:id/bookings  (admin/tutor)
export async function listQuadBookingsBySlot(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('quad_bookings')
      .select('*, profiles(id, name, email)')
      .eq('slot_id', req.params.id)
      .order('booked_at', { ascending: true });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── One-to-One Slots ─────────────────────────────────────────────────────────

// GET /api/v1/slots/o2o
export async function listO2OSlots(req: Request, res: Response, next: NextFunction) {
  try {
    const { tutor_id, student_id, status, from, to } = req.query as Record<string, string>;

    let query = getSupabase()
      .from('one_to_one_slots')
      .select('*')
      .order('starts_at', { ascending: true });

    if (tutor_id) query = query.eq('tutor_id', tutor_id);
    if (student_id) query = query.eq('student_id', student_id);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('starts_at', from);
    if (to) query = query.lte('starts_at', to);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/slots/o2o  (admin/tutor)
export async function createO2OSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      subject,
      tutor_id,
      student_id,
      starts_at,
      ends_at,
      meet_link,
      google_event_id,
      status,
    } = req.body;

    if (!subject || !tutor_id || !student_id || !starts_at || !ends_at) {
      return res.status(400).json({
        success: false,
        message: 'subject, tutor_id, student_id, starts_at, and ends_at are required',
      });
    }

    const { data, error } = await getSupabase()
      .from('one_to_one_slots')
      .insert({
        subject,
        tutor_id,
        student_id,
        starts_at,
        ends_at,
        meet_link: meet_link ?? null,
        google_event_id: google_event_id ?? null,
        status: status ?? 'scheduled',
      })
      .select('*')
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/slots/o2o/:id
export async function updateO2OSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      subject,
      tutor_id,
      student_id,
      starts_at,
      ends_at,
      meet_link,
      google_event_id,
      status,
    } = req.body;

    const { data, error } = await getSupabase()
      .from('one_to_one_slots')
      .update({
        subject,
        tutor_id,
        student_id,
        starts_at,
        ends_at,
        meet_link,
        google_event_id,
        status,
      })
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/slots/o2o/:id  (admin)
export async function deleteO2OSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from('one_to_one_slots')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    return res.json({ success: true, message: 'One-to-one slot deleted' });
  } catch (error) {
    next(error);
  }
}
