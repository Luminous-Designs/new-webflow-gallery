import { supabaseAdmin } from '@/lib/supabase';

export async function trackPreviewMetric(
  templateId: number,
  sessionId: string,
  loadTimeMs: number,
  deviceType: 'desktop' | 'mobile',
  errorOccurred: boolean = false
) {
  await supabaseAdmin.from('preview_metrics').insert({
    template_id: templateId,
    session_id: sessionId,
    load_time_ms: loadTimeMs,
    device_type: deviceType,
    error_occurred: errorOccurred,
    navigation_count: 0,
    total_duration_ms: null,
  });
}

export async function updatePreviewNavigation(sessionId: string, templateId: number) {
  const { data: latest, error } = await supabaseAdmin
    .from('preview_metrics')
    .select('id, navigation_count, created_at')
    .eq('session_id', sessionId)
    .eq('template_id', templateId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !latest) return;

  const navigationCount = (latest.navigation_count || 0) + 1;
  const createdAtMs = Date.parse(latest.created_at);
  const totalDurationMs = Number.isFinite(createdAtMs) ? Math.max(0, Date.now() - createdAtMs) : null;

  await supabaseAdmin
    .from('preview_metrics')
    .update({
      navigation_count: navigationCount,
      total_duration_ms: totalDurationMs,
    })
    .eq('id', latest.id);
}

