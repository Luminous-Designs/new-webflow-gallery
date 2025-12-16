import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const subcategories = await db.allAsync(`
      SELECT s.*, COUNT(ts.template_id) as template_count
      FROM subcategories s
      LEFT JOIN template_subcategories ts ON s.id = ts.subcategory_id
      GROUP BY s.id
      ORDER BY template_count DESC
    `);

    return NextResponse.json(subcategories);

  } catch (error) {
    console.error('Subcategories API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
