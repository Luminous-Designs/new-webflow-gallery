'use client';

import { useState } from 'react';
import { AdminSidebar, type AdminSection } from './admin-sidebar';
import { AdminOverview } from './sections/admin-overview';
import { useAdmin } from './admin-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toaster } from '@/components/ui/sonner';

interface AdminLayoutProps {
  children?: React.ReactNode;
  renderSection: (section: AdminSection, onNavigate: (section: AdminSection) => void) => React.ReactNode;
}

export function AdminLayout({ renderSection }: AdminLayoutProps) {
  const { isAuthenticated, password, setPassword, authenticate } = useAdmin();
  const [currentSection, setCurrentSection] = useState<AdminSection>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 shadow-xl">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">Enter your credentials to continue</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <Input
                type="password"
                placeholder="Enter admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && authenticate()}
                className="w-full"
                autoFocus
              />
            </div>
            <Button onClick={authenticate} className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
              Sign In
            </Button>
          </div>
        </Card>
        <Toaster />
      </div>
    );
  }

  const handleNavigate = (section: AdminSection) => {
    setCurrentSection(section);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <AdminSidebar
        currentSection={currentSection}
        onSectionChange={setCurrentSection}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 capitalize">
              {currentSection === 'overview' ? 'Dashboard Overview' : currentSection.replace('-', ' ')}
            </h1>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {currentSection === 'overview' ? (
            <AdminOverview onNavigate={handleNavigate} />
          ) : (
            renderSection(currentSection, handleNavigate)
          )}
        </main>
      </div>

      <Toaster />
    </div>
  );
}
