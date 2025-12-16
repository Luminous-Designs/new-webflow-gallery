import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { promises as fs } from 'fs';
import path from 'path';

export async function DELETE(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Starting complete data cleanup...');

    // 1. Delete all templates from database
    console.log('Deleting templates from database...');
    await db.runAsync('DELETE FROM template_features');
    await db.runAsync('DELETE FROM template_styles');
    await db.runAsync('DELETE FROM template_subcategories');
    await db.runAsync('DELETE FROM templates');

    // Also clean up orphaned data
    await db.runAsync('DELETE FROM features');
    await db.runAsync('DELETE FROM styles');
    await db.runAsync('DELETE FROM subcategories');
    await db.runAsync('DELETE FROM featured_authors');

    // Reset scrape jobs
    await db.runAsync('DELETE FROM scrape_logs');
    await db.runAsync('DELETE FROM scrape_jobs');

    console.log('Database cleaned successfully');

    // 2. Delete all screenshot files
    const screenshotDir = path.join(process.cwd(), 'public', 'screenshots');
    const thumbnailDir = path.join(process.cwd(), 'public', 'thumbnails');

    // Delete screenshots
    try {
      console.log('Deleting screenshots directory...');
      const screenshotFiles = await fs.readdir(screenshotDir);
      for (const file of screenshotFiles) {
        await fs.unlink(path.join(screenshotDir, file));
      }
      console.log(`Deleted ${screenshotFiles.length} screenshot files`);
    } catch {
      console.log('Screenshots directory may not exist or is already empty');
    }

    // Delete thumbnails
    try {
      console.log('Deleting thumbnails directory...');
      const thumbnailFiles = await fs.readdir(thumbnailDir);
      for (const file of thumbnailFiles) {
        await fs.unlink(path.join(thumbnailDir, file));
      }
      console.log(`Deleted ${thumbnailFiles.length} thumbnail files`);
    } catch {
      console.log('Thumbnails directory may not exist or is already empty');
    }

    // 3. Vacuum the database to reclaim space
    console.log('Vacuuming database...');
    await db.runAsync('VACUUM');

    console.log('Complete cleanup finished successfully');

    return NextResponse.json({
      success: true,
      message: 'All templates and screenshots have been deleted successfully'
    });

  } catch (error) {
    console.error('Delete all error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to delete all data', details: message },
      { status: 500 }
    );
  }
}
