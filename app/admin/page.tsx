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
  VisitorsSection,
  PurchasesSection,
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
      case 'visitors':
        return <VisitorsSection />;
      case 'purchases':
        return <PurchasesSection />;
      case 'supabase-explorer':
        return <SupabaseExplorerSection />;
      default:
        return null;
    }
  };

  return (
    <AdminLayout
      renderSection={(section, onNavigate) => {
        void onNavigate;
        return renderSection(section);
      }}
    />
  );
}

export default function AdminPage() {
  return (
    <AdminProvider>
      <AdminDashboard />
    </AdminProvider>
  );
}
