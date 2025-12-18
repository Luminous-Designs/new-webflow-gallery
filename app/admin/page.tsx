'use client';

import {
  AdminProvider,
  AdminLayout,
  FreshScraperSection,
  BlacklistSection,
  ScreenshotsSection,
  SystemSection,
  AuthorsSection,
  UltraFeaturedSection,
  ImagesSection,
  VisitorsSection,
  PurchasesSection,
  StorageSection,
  SyncSection,
  SupabaseExplorerSection
} from '@/components/admin';
import type { AdminSection } from '@/components/admin';

function AdminDashboard() {
  const renderSection = (section: AdminSection) => {
    switch (section) {
      case 'fresh-scraper':
        return <FreshScraperSection />;
      case 'blacklist':
        return <BlacklistSection />;
      case 'screenshots':
        return <ScreenshotsSection />;
      case 'system':
        return <SystemSection />;
      case 'authors':
        return <AuthorsSection />;
      case 'ultra':
        return <UltraFeaturedSection />;
      case 'images':
        return <ImagesSection />;
      case 'visitors':
        return <VisitorsSection />;
      case 'purchases':
        return <PurchasesSection />;
      case 'storage':
        return <StorageSection />;
      case 'supabase-explorer':
        return <SupabaseExplorerSection />;
      case 'sync':
        return <SyncSection />;
      default:
        return null;
    }
  };

  return <AdminLayout renderSection={renderSection} />;
}

export default function AdminPage() {
  return (
    <AdminProvider>
      <AdminDashboard />
    </AdminProvider>
  );
}
