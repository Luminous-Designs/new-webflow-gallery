/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAdmin } from '../admin-context';
import { Users, Activity } from 'lucide-react';

export function VisitorsSection() {
  const { stats } = useAdmin();

  const visitors = Array.isArray(stats?.activeVisitors) ? stats.activeVisitors : [];
  const visitorStats = stats?.visitorStats || [];

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-green-100 rounded-lg">
            <Users className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Active Visitors</h2>
            <p className="text-sm text-gray-500">Real-time visitor tracking (last 5 minutes)</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 text-sm font-medium text-gray-600">Session ID</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Current Step</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Selected Template</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {visitors.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-500">No active visitors at the moment</td>
                </tr>
              ) : (
                visitors.map((visitor) => (
                  <tr key={visitor.session_id} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-mono text-xs text-gray-600">
                      {visitor.session_id.substring(0, 8)}...
                    </td>
                    <td className="p-3">
                      <Badge variant={
                        visitor.current_step === 'checkout' ? 'default' :
                        visitor.current_step === 'pricing' ? 'secondary' :
                        'outline'
                      }>
                        {visitor.current_step || 'gallery'}
                      </Badge>
                    </td>
                    <td className="p-3 text-sm">{visitor.selected_template_id || '-'}</td>
                    <td className="p-3 text-sm text-gray-500">
                      {new Date(visitor.last_activity).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Activity className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Visitor Journey Stats (24h)</h2>
            <p className="text-sm text-gray-500">See how visitors progress through the funnel</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {['gallery', 'details', 'contract', 'pricing', 'checkout'].map((step) => {
            const stat = visitorStats.find((s: any) => s.current_step === step);
            const count = stat?.count || 0;
            const stepColors: Record<string, string> = {
              gallery: 'bg-blue-50 border-blue-200 text-blue-700',
              details: 'bg-purple-50 border-purple-200 text-purple-700',
              contract: 'bg-amber-50 border-amber-200 text-amber-700',
              pricing: 'bg-green-50 border-green-200 text-green-700',
              checkout: 'bg-emerald-50 border-emerald-200 text-emerald-700'
            };
            return (
              <div key={step} className={`text-center p-4 border rounded-lg ${stepColors[step]}`}>
                <div className="text-xs uppercase font-medium mb-1">{step}</div>
                <div className="text-2xl font-bold">{count}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
