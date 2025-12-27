import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Avoid spamming client console with 500s; visitor tracking is best-effort.
      return NextResponse.json({ success: false, skipped: true });
    }

    const body = await request.json();
    const { sessionId, currentStep, selectedTemplateId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Check if visitor exists
    const { data: existing, error: selectError } = await supabaseAdmin
      .from('visitors')
      .select('id')
      .eq('session_id', sessionId)
      .single();

    const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
    const ip = forwardedFor.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
    const userAgent = request.headers.get('user-agent') || '';

    if (existing && !selectError) {
      // Update existing visitor
      const { error: updateError } = await supabaseAdmin
        .from('visitors')
        .update({
          current_step: currentStep,
          selected_template_id: selectedTemplateId,
          last_activity: new Date().toISOString(),
          ip_address: ip,
          user_agent: userAgent
        })
        .eq('id', existing.id);

      if (updateError) throw updateError;
    } else {
      // Create new visitor
      const { error: insertError } = await supabaseAdmin
        .from('visitors')
        .insert({
          session_id: sessionId,
          current_step: currentStep,
          selected_template_id: selectedTemplateId,
          ip_address: ip,
          user_agent: userAgent
        });

      if (insertError) throw insertError;
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
