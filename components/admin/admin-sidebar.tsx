'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdmin } from './admin-context';
import {
  Download,
  HardDrive,
  Users,
  ShoppingCart,
  Sparkles,
  Camera,
  Server,
  Database,
  Image as ImageIcon,
  Star,
  ChevronLeft,
  ChevronRight,
  LogOut,
  LayoutDashboard,
  Folder,
  BarChart3,
  Settings,
  Loader2,
  Ban,
  FolderSync
} from 'lucide-react';

export type AdminSection =
  | 'overview'
  | 'fresh-scraper'
  | 'blacklist'
  | 'screenshots'
  | 'images'
  | 'authors'
  | 'ultra'
  | 'system'
  | 'storage'
  | 'supabase-explorer'
  | 'sync'
  | 'visitors'
  | 'purchases';

interface NavItem {
  id: AdminSection;
  label: string;
  icon: React.ElementType;
  badge?: () => React.ReactNode;
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

interface AdminSidebarProps {
  currentSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function AdminSidebar({
  currentSection,
  onSectionChange,
  collapsed,
  onCollapsedChange
}: AdminSidebarProps) {
  const { logout, thumbnailQueueCounts, stats, systemStats } = useAdmin();

  const navGroups: NavGroup[] = [
    {
      label: 'Content',
      icon: Folder,
      items: [
        {
          id: 'fresh-scraper',
          label: 'Template Scraper',
          icon: Download,
        },
        {
          id: 'blacklist',
          label: 'Blacklist',
          icon: Ban,
        },
        {
          id: 'screenshots',
          label: 'Screenshots',
          icon: Camera,
        },
        {
          id: 'images',
          label: 'Images',
          icon: ImageIcon,
          badge: () => {
            const running = thumbnailQueueCounts.running;
            const pending = thumbnailQueueCounts.pending;
            if (running > 0) {
              return (
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-xs bg-blue-100 text-blue-700">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  {running}
                </Badge>
              );
            }
            if (pending > 0) {
              return (
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-xs bg-amber-100 text-amber-700">
                  {pending}
                </Badge>
              );
            }
            return null;
          }
        },
      ],
    },
    {
      label: 'Featured',
      icon: Star,
      items: [
        {
          id: 'authors',
          label: 'Authors',
          icon: Users,
        },
        {
          id: 'ultra',
          label: 'Ultra Featured',
          icon: Sparkles,
        },
      ],
    },
    {
      label: 'Analytics',
      icon: BarChart3,
      items: [
        {
          id: 'visitors',
          label: 'Visitors',
          icon: Users,
          badge: () => {
            const count = Array.isArray(stats?.activeVisitors)
              ? stats.activeVisitors.length
              : stats?.activeVisitorsCount || 0;
            if (count > 0) {
              return (
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-xs bg-green-100 text-green-700">
                  {count}
                </Badge>
              );
            }
            return null;
          }
        },
        {
          id: 'purchases',
          label: 'Purchases',
          icon: ShoppingCart,
        },
      ],
    },
    {
      label: 'System',
      icon: Settings,
      items: [
        {
          id: 'system',
          label: 'Resources',
          icon: Server,
        },
        {
          id: 'supabase-explorer',
          label: 'Supabase Explorer',
          icon: Database,
        },
        {
          id: 'storage',
          label: 'Storage',
          icon: HardDrive,
          badge: () => {
            if (systemStats?.storage?.total) {
              const formatBytes = (bytes: number) => {
                if (bytes < 1024) return `${bytes} B`;
                if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
                if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
              };
              return (
                <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px] text-gray-500">
                  {formatBytes(systemStats.storage.total)}
                </Badge>
              );
            }
            return null;
          }
        },
        {
          id: 'sync',
          label: 'VPS Sync',
          icon: FolderSync,
        },
      ],
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-white border-r border-gray-200 transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
              <LayoutDashboard className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-gray-900">Admin</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 w-8 p-0", collapsed && "mx-auto")}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Overview Button */}
      <div className="p-2">
        <Button
          variant={currentSection === 'overview' ? 'secondary' : 'ghost'}
          className={cn(
            "w-full justify-start gap-3 h-10",
            collapsed && "justify-center px-0"
          )}
          onClick={() => onSectionChange('overview')}
        >
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Overview</span>}
        </Button>
      </div>

      {/* Navigation Groups */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-4 py-2">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <div className="flex items-center gap-2 px-3 py-2">
                  <group.icon className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
              )}
              {collapsed && (
                <div className="flex justify-center py-2">
                  <div className="w-8 h-px bg-gray-200" />
                </div>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = currentSection === item.id;
                  const BadgeComponent = item.badge;

                  return (
                    <Button
                      key={item.id}
                      variant={isActive ? 'secondary' : 'ghost'}
                      className={cn(
                        "w-full h-9 gap-3",
                        collapsed ? "justify-center px-0" : "justify-start",
                        isActive && "bg-purple-50 text-purple-700 hover:bg-purple-100 hover:text-purple-800"
                      )}
                      onClick={() => onSectionChange(item.id)}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-purple-600" : "text-gray-500"
                      )} />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left text-sm">{item.label}</span>
                          {BadgeComponent && <BadgeComponent />}
                        </>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Environment Badge & Logout */}
      <div className="p-2 border-t border-gray-100 space-y-2">
        {!collapsed && systemStats?.environment && (
          <div className={cn(
            "px-3 py-2 rounded-lg text-xs",
            systemStats.environment.type === 'vps'
              ? "bg-green-50 text-green-700"
              : "bg-blue-50 text-blue-700"
          )}>
            <div className="font-medium">
              {systemStats.environment.type === 'vps' ? 'Production' : 'Development'}
            </div>
            <div className="text-[10px] opacity-75 truncate">
              {systemStats.environment.name}
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          className={cn(
            "w-full gap-3 h-9 text-gray-600 hover:text-red-600 hover:bg-red-50",
            collapsed && "justify-center px-0"
          )}
          onClick={logout}
          title={collapsed ? "Logout" : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="text-sm">Logout</span>}
        </Button>
      </div>
    </div>
  );
}
