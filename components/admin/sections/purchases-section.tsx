/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Card } from '@/components/ui/card';
import { useAdmin } from '../admin-context';
import { ShoppingCart, DollarSign } from 'lucide-react';

export function PurchasesSection() {
  const { stats } = useAdmin();

  const purchases = stats?.recentPurchases || [];
  const totalRevenue = purchases.reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Purchases</p>
              <p className="text-2xl font-bold">{stats?.completedPurchases || 0}</p>
            </div>
            <ShoppingCart className="h-8 w-8 text-purple-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Recent Revenue</p>
              <p className="text-2xl font-bold">${totalRevenue.toFixed(2)}</p>
            </div>
            <DollarSign className="h-8 w-8 text-green-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Avg. Order Value</p>
              <p className="text-2xl font-bold">
                ${purchases.length > 0 ? (totalRevenue / purchases.length).toFixed(2) : '0.00'}
              </p>
            </div>
            <DollarSign className="h-8 w-8 text-blue-500" />
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-purple-100 rounded-lg">
            <ShoppingCart className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Recent Purchases</h2>
            <p className="text-sm text-gray-500">Latest transactions and customer details</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 text-sm font-medium text-gray-600">ID</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Customer</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Email</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Template</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Amount</th>
                <th className="text-left p-3 text-sm font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">No purchases yet</td>
                </tr>
              ) : (
                purchases.map((purchase: any) => (
                  <tr key={purchase.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 text-sm font-mono">{purchase.id}</td>
                    <td className="p-3 text-sm font-medium">{purchase.customer_name}</td>
                    <td className="p-3 text-sm text-gray-600">{purchase.customer_email}</td>
                    <td className="p-3 text-sm">{purchase.template_name}</td>
                    <td className="p-3 text-sm font-medium text-green-600">${purchase.amount}</td>
                    <td className="p-3 text-sm text-gray-500">
                      {new Date(purchase.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
