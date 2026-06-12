import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/tickets
export async function listTickets(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, subject, priority } = req.query as Record<string, string>;
    const userId = req.user!.sub;
    const role = req.user!.role;

    let query = getSupabase()
      .from('tickets')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (role === 'student') {
      query = query.eq('created_by_student', userId);
    } else if (role === 'tutor') {
      query = query.eq('assigned_tutor', userId);
    }
    // admins see all

    if (status) query = query.eq('status', status);
    if (subject) query = query.eq('subject', subject);
    if (priority) query = query.eq('priority', priority);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tickets/:id
export async function getTicketById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    const role = req.user!.role;

    const { data: ticket, error: ticketError } = await getSupabase()
      .from('tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Access control
    if (role === 'student' && ticket.created_by_student !== userId) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    if (role === 'tutor' && ticket.assigned_tutor !== userId) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { data: messages, error: msgError } = await getSupabase()
      .from('ticket_messages')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (msgError) throw msgError;

    // Upsert ticket_reads for current user
    await getSupabase()
      .from('ticket_reads')
      .upsert(
        { ticket_id: id, user_id: userId, last_read_at: new Date().toISOString(), marked_unread: false },
        { onConflict: 'ticket_id,user_id' }
      );

    return res.json({ success: true, data: { ticket, messages } });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/tickets
export async function createTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub;
    const { subject, category, title } = req.body;

    if (!subject || !category || !title) {
      return res.status(400).json({ success: false, message: 'subject, category, and title are required' });
    }

    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('tickets')
      .insert({
        created_by_student: userId,
        subject,
        category,
        title,
        status: 'open',
        priority: 'normal',
        last_message_at: now,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/tickets/:id
export async function updateTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const role = req.user!.role;

    if (role !== 'admin' && role !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { status, priority, assigned_tutor } = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (assigned_tutor !== undefined) updates.assigned_tutor = assigned_tutor;

    const { data, error } = await getSupabase()
      .from('tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Ticket not found' });

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/tickets/:id/messages
export async function addMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    const role = req.user!.role;
    const { body: messageBody } = req.body;

    if (!messageBody) {
      return res.status(400).json({ success: false, message: 'body is required' });
    }

    // Verify access
    const { data: ticket, error: ticketError } = await getSupabase()
      .from('tickets')
      .select('id, created_by_student, assigned_tutor')
      .eq('id', id)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    if (role === 'student' && ticket.created_by_student !== userId) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    if (role === 'tutor' && ticket.assigned_tutor !== userId) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const now = new Date().toISOString();

    const { data: message, error: msgError } = await getSupabase()
      .from('ticket_messages')
      .insert({ ticket_id: id, sender: userId, body: messageBody, created_at: now })
      .select()
      .single();

    if (msgError) throw msgError;

    // Update ticket's last_message_at
    await getSupabase()
      .from('tickets')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', id);

    return res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/tickets/:id/pin
export async function pinTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('pinned_tickets')
      .insert({ ticket_id: id, user_id: userId, pinned_at: now })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/tickets/:id/pin
export async function unpinTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;

    const { error } = await getSupabase()
      .from('pinned_tickets')
      .delete()
      .eq('ticket_id', id)
      .eq('user_id', userId);

    if (error) throw error;

    return res.json({ success: true, message: 'Ticket unpinned' });
  } catch (error) {
    next(error);
  }
}
