import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, currentStep, selectedTemplateId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Check if visitor exists
    const existing = await db.getAsync<{ id: number }>(
      'SELECT id FROM visitors WHERE session_id = ?',
      [sessionId]
    );

    const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
    const ip = forwardedFor.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    const userAgent = request.headers.get('user-agent') || '';

    if (existing) {
      // Update existing visitor
      await db.runAsync(
        `UPDATE visitors SET
          current_step = ?, selected_template_id = ?, last_activity = datetime('now'),
          ip_address = ?, user_agent = ?
        WHERE id = ?`,
        [currentStep, selectedTemplateId, ip, userAgent, existing.id]
      );
    } else {
      // Create new visitor
      await db.runAsync(
        `INSERT INTO visitors (session_id, current_step, selected_template_id, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)`,
        [sessionId, currentStep, selectedTemplateId, ip, userAgent]
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Visitor update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
