import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    // Get all styles with template count
    const styles = await db.allAsync(
      `SELECT
        s.id,
        s.name,
        s.slug,
        s.display_name,
        COUNT(DISTINCT ts.template_id) as template_count
       FROM styles s
       LEFT JOIN template_styles ts ON s.id = ts.style_id
       GROUP BY s.id, s.name, s.slug, s.display_name
       ORDER BY template_count DESC, s.display_name ASC`
    );

    return NextResponse.json(styles);
  } catch (error) {
    console.error('Failed to fetch styles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch styles' },
      { status: 500 }
    );
  }
}
