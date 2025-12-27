'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Activity,
  Server,
  Container,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

// Types
interface SystemInfo {
  version: string;
  os_name: string;
  os_version: string;
  kernel_version: string;
  cores_total: string;
  ram_total: string;
  total_disk_space: string;
  architecture: string;
  hostname?: string;
  alarms: {
    normal: number;
    warning: number;
    critical: number;
  };
}

interface ChartDataPoint {
  time: number;
  value: number;
  [key: string]: number;
}

interface ContainerMetric {
  id: string;
  name: string;
  cpuChart: string | null;
  memChart: string | null;
  cpuPercent: number;
  memMB: number;
}

// Color palette for dark futuristic theme
const COLORS = {
  primary: '#00f0ff',
  secondary: '#7b61ff',
  accent: '#ff6b9d',
  success: '#00ff9d',
  warning: '#ffa726',
  danger: '#ff4757',
  background: '#0a0a0f',
  surface: '#12121a',
  surfaceLight: '#1a1a24',
  border: '#2a2a3a',
  text: '#e0e0e0',
  textMuted: '#808090',
};

const CHART_COLORS = [
  '#00f0ff',
  '#7b61ff',
  '#ff6b9d',
  '#00ff9d',
  '#ffa726',
  '#e040fb',
  '#40c4ff',
  '#69f0ae',
];

// Auth component
function AuthGate({ onAuthenticated }: { onAuthenticated: (password: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/metrics/netdata?endpoint=info', {
        headers: {
          Authorization: `Bearer ${password}`,
        },
      });

      if (response.ok) {
        localStorage.setItem('metrics_password', password);
        onAuthenticated(password);
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Connection failed');
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: COLORS.background }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md p-8 rounded-2xl border"
        style={{
          background: `linear-gradient(135deg, ${COLORS.surface} 0%, ${COLORS.background} 100%)`,
          borderColor: COLORS.border,
          boxShadow: `0 0 60px ${COLORS.primary}10`,
        }}
      >
        <div className="flex justify-center mb-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${COLORS.primary}20, ${COLORS.secondary}20)`,
              border: `1px solid ${COLORS.primary}40`,
            }}
          >
            <Lock size={32} style={{ color: COLORS.primary }} />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center mb-2" style={{ color: COLORS.text }}>
          VPS Metrics Dashboard
        </h1>
        <p className="text-center mb-8" style={{ color: COLORS.textMuted }}>
          Enter admin password to access real-time metrics
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 rounded-xl text-center text-lg tracking-widest outline-none transition-all"
              style={{
                background: COLORS.surfaceLight,
                border: `1px solid ${error ? COLORS.danger : COLORS.border}`,
                color: COLORS.text,
              }}
              autoFocus
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-sm"
              style={{ color: COLORS.danger }}
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full py-3 rounded-xl font-medium transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            style={{
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary})`,
              color: COLORS.background,
            }}
          >
            {isLoading ? 'Verifying...' : 'Access Dashboard'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// Metric Card component
function MetricCard({
  title,
  value,
  unit,
  icon: Icon,
  color,
  trend,
  subtitle,
  chartData,
}: {
  title: string;
  value: number | string;
  unit?: string;
  icon: React.ElementType;
  color: string;
  trend?: 'up' | 'down' | 'stable';
  subtitle?: string;
  chartData?: ChartDataPoint[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl p-6"
      style={{
        background: `linear-gradient(135deg, ${COLORS.surface} 0%, ${COLORS.surfaceLight} 100%)`,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      {/* Glow effect */}
      <div
        className="absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl opacity-20"
        style={{ background: color }}
      />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              background: `${color}15`,
              border: `1px solid ${color}30`,
            }}
          >
            <Icon size={24} style={{ color }} />
          </div>
          {trend && (
            <span
              className="text-xs px-2 py-1 rounded-full"
              style={{
                background: trend === 'up' ? `${COLORS.warning}20` : trend === 'down' ? `${COLORS.success}20` : `${COLORS.textMuted}20`,
                color: trend === 'up' ? COLORS.warning : trend === 'down' ? COLORS.success : COLORS.textMuted,
              }}
            >
              {trend === 'up' ? 'High' : trend === 'down' ? 'Low' : 'Stable'}
            </span>
          )}
        </div>

        <p className="text-sm mb-1" style={{ color: COLORS.textMuted }}>{title}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold" style={{ color: COLORS.text }}>
            {typeof value === 'number' ? value.toFixed(1) : value}
          </span>
          {unit && <span className="text-lg" style={{ color: COLORS.textMuted }}>{unit}</span>}
        </div>
        {subtitle && (
          <p className="text-xs mt-1" style={{ color: COLORS.textMuted }}>{subtitle}</p>
        )}

        {chartData && chartData.length > 0 && (
          <div className="mt-4 h-16 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#gradient-${title})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Container distribution chart
function ContainerDistribution({ containers, type }: { containers: ContainerMetric[]; type: 'cpu' | 'memory' }) {
  const data = containers
    .filter((c) => (type === 'cpu' ? c.cpuPercent > 0.1 : c.memMB > 1))
    .slice(0, 8)
    .map((c) => ({
      name: c.name.length > 15 ? c.name.substring(0, 15) + '...' : c.name,
      value: type === 'cpu' ? c.cpuPercent : c.memMB,
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48" style={{ color: COLORS.textMuted }}>
        No active containers
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              color: COLORS.text,
            }}
            formatter={(value: number) => [
              type === 'cpu' ? `${value.toFixed(1)}%` : `${value.toFixed(0)} MB`,
              type === 'cpu' ? 'CPU' : 'Memory',
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        {data.map((item, index) => (
          <div key={index} className="flex items-center gap-1 text-xs" style={{ color: COLORS.textMuted }}>
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span>{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Container list
function ContainerList({ containers }: { containers: ContainerMetric[] }) {
  const sortedContainers = [...containers].sort((a, b) => b.memMB - a.memMB);

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
      {sortedContainers.map((container, index) => (
        <motion.div
          key={container.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          className="p-4 rounded-xl"
          style={{
            background: COLORS.surfaceLight,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Container size={16} style={{ color: CHART_COLORS[index % CHART_COLORS.length] }} />
              <span className="font-medium text-sm" style={{ color: COLORS.text }}>
                {container.name}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span style={{ color: COLORS.textMuted }}>CPU</span>
                <span style={{ color: COLORS.primary }}>{container.cpuPercent.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${COLORS.primary}20` }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: COLORS.primary }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(container.cpuPercent, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span style={{ color: COLORS.textMuted }}>Memory</span>
                <span style={{ color: COLORS.secondary }}>{container.memMB.toFixed(0)} MB</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${COLORS.secondary}20` }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: COLORS.secondary }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((container.memMB / 1024) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// Main Dashboard component
function Dashboard({ password }: { password: string }) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [cpuData, setCpuData] = useState<ChartDataPoint[]>([]);
  const [ramData, setRamData] = useState<ChartDataPoint[]>([]);
  const [networkData, setNetworkData] = useState<ChartDataPoint[]>([]);
  const [diskData, setDiskData] = useState<ChartDataPoint[]>([]);
  const [containers, setContainers] = useState<ContainerMetric[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showLiveIndicator, setShowLiveIndicator] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Current values
  const currentCpu = cpuData.length > 0 ? cpuData[cpuData.length - 1].value : 0;
  const currentRam = ramData.length > 0 ? ramData[ramData.length - 1].value : 0;
  const currentNetwork = networkData.length > 0 ? networkData[networkData.length - 1].value : 0;
  const currentDisk = diskData.length > 0 ? diskData[diskData.length - 1].value : 0;

  const headers = useMemo(() => ({
    Authorization: `Bearer ${password}`,
    'Content-Type': 'application/json',
  }), [password]);

  const fetchSystemInfo = useCallback(async () => {
    try {
      const response = await fetch('/api/metrics/netdata?endpoint=info', { headers });
      if (response.ok) {
        const data = await response.json();
        setSystemInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch system info:', error);
    }
  }, [headers]);

  const fetchMetrics = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Fetch multiple charts in batch
      const response = await fetch('/api/metrics/netdata', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          charts: ['system.cpu', 'system.ram', 'system.net', 'disk.sda'],
          after: -60,
          points: 60,
        }),
      });

      if (response.ok) {
        const { results } = await response.json();

        for (const result of results) {
          if (result.error) continue;

          const chartData: ChartDataPoint[] = result.data.data.map((point: number[]) => {
            const values = point.slice(1);
            const sum = values.reduce((a: number, b: number) => a + (b || 0), 0);
            return { time: point[0], value: Math.abs(sum) };
          });

          switch (result.chart) {
            case 'system.cpu':
              setCpuData(chartData);
              break;
            case 'system.ram':
              // Convert to percentage
              if (systemInfo) {
                const totalRam = parseInt(systemInfo.ram_total) / (1024 * 1024 * 1024); // GB
                setRamData(
                  chartData.map((d) => ({
                    ...d,
                    value: (d.value / 1024 / totalRam) * 100,
                  }))
                );
              } else {
                setRamData(chartData);
              }
              break;
            case 'system.net':
              // Convert to Mbps
              setNetworkData(
                chartData.map((d) => ({
                  ...d,
                  value: d.value / 1000, // kbps to Mbps
                }))
              );
              break;
            case 'disk.sda':
              // Already in proper format
              setDiskData(chartData);
              break;
          }
        }
        setLastUpdate(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
    setIsRefreshing(false);
  }, [headers, systemInfo]);

  const fetchContainers = useCallback(async () => {
    try {
      const response = await fetch('/api/metrics/containers', { headers });
      if (response.ok) {
        const { containers: containerData } = await response.json();
        setContainers(containerData);
      }
    } catch (error) {
      console.error('Failed to fetch containers:', error);
    }
  }, [headers]);

  useEffect(() => {
    fetchSystemInfo();
    fetchMetrics();
    fetchContainers();

    // Set up real-time updates
    intervalRef.current = setInterval(() => {
      fetchMetrics();
      fetchContainers();
    }, 2000); // Update every 2 seconds

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchSystemInfo, fetchMetrics, fetchContainers]);

  const totalRamGB = systemInfo ? (parseInt(systemInfo.ram_total) / (1024 * 1024 * 1024)).toFixed(1) : '0';
  const totalDiskGB = systemInfo ? (parseInt(systemInfo.total_disk_space) / (1024 * 1024 * 1024)).toFixed(0) : '0';

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: COLORS.background }}>
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Server size={28} style={{ color: COLORS.primary }} />
            <h1 className="text-2xl font-bold" style={{ color: COLORS.text }}>
              VPS Metrics
            </h1>
          </div>
          {systemInfo && (
            <p className="text-sm" style={{ color: COLORS.textMuted }}>
              {systemInfo.os_name} {systemInfo.os_version} | {systemInfo.cores_total} Cores | {systemInfo.architecture}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Live indicator */}
          <button
            onClick={() => setShowLiveIndicator(!showLiveIndicator)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: showLiveIndicator ? `${COLORS.success}20` : COLORS.surfaceLight,
              border: `1px solid ${showLiveIndicator ? COLORS.success : COLORS.border}`,
            }}
          >
            {showLiveIndicator ? (
              <Eye size={16} style={{ color: COLORS.success }} />
            ) : (
              <EyeOff size={16} style={{ color: COLORS.textMuted }} />
            )}
            <span className="text-sm" style={{ color: showLiveIndicator ? COLORS.success : COLORS.textMuted }}>
              {showLiveIndicator ? 'Live' : 'Paused'}
            </span>
            {showLiveIndicator && (
              <span className="relative flex h-2 w-2">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ background: COLORS.success }}
                />
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ background: COLORS.success }}
                />
              </span>
            )}
          </button>

          {/* Refresh button */}
          <button
            onClick={() => {
              fetchMetrics();
              fetchContainers();
            }}
            className="p-2 rounded-lg transition-colors"
            style={{
              background: COLORS.surfaceLight,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <RefreshCw
              size={18}
              className={isRefreshing ? 'animate-spin' : ''}
              style={{ color: COLORS.textMuted }}
            />
          </button>

          {/* Last update time */}
          {lastUpdate && (
            <div className="flex items-center gap-2 text-sm" style={{ color: COLORS.textMuted }}>
              <Clock size={14} />
              <span>{lastUpdate.toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      </header>

      {/* Alarms banner */}
      {systemInfo && (systemInfo.alarms.warning > 0 || systemInfo.alarms.critical > 0) && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-xl flex items-center gap-3"
          style={{
            background: systemInfo.alarms.critical > 0 ? `${COLORS.danger}15` : `${COLORS.warning}15`,
            border: `1px solid ${systemInfo.alarms.critical > 0 ? COLORS.danger : COLORS.warning}40`,
          }}
        >
          <AlertTriangle
            size={20}
            style={{ color: systemInfo.alarms.critical > 0 ? COLORS.danger : COLORS.warning }}
          />
          <span style={{ color: COLORS.text }}>
            {systemInfo.alarms.critical > 0 && (
              <span style={{ color: COLORS.danger }}>{systemInfo.alarms.critical} critical </span>
            )}
            {systemInfo.alarms.warning > 0 && (
              <span style={{ color: COLORS.warning }}>{systemInfo.alarms.warning} warning </span>
            )}
            alarms active
          </span>
        </motion.div>
      )}

      {/* System health status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Normal', count: systemInfo?.alarms.normal || 0, icon: CheckCircle2, color: COLORS.success },
          { label: 'Warning', count: systemInfo?.alarms.warning || 0, icon: AlertTriangle, color: COLORS.warning },
          { label: 'Critical', count: systemInfo?.alarms.critical || 0, icon: XCircle, color: COLORS.danger },
          { label: 'Containers', count: containers.length, icon: Container, color: COLORS.primary },
        ].map((item, index) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="p-4 rounded-xl flex items-center gap-3"
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <item.icon size={20} style={{ color: item.color }} />
            <div>
              <p className="text-lg font-bold" style={{ color: COLORS.text }}>{item.count}</p>
              <p className="text-xs" style={{ color: COLORS.textMuted }}>{item.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="CPU Usage"
          value={currentCpu}
          unit="%"
          icon={Cpu}
          color={COLORS.primary}
          trend={currentCpu > 80 ? 'up' : currentCpu < 20 ? 'down' : 'stable'}
          subtitle={`${systemInfo?.cores_total || '?'} cores`}
          chartData={cpuData}
        />
        <MetricCard
          title="Memory Usage"
          value={currentRam}
          unit="%"
          icon={MemoryStick}
          color={COLORS.secondary}
          trend={currentRam > 80 ? 'up' : currentRam < 30 ? 'down' : 'stable'}
          subtitle={`${totalRamGB} GB total`}
          chartData={ramData}
        />
        <MetricCard
          title="Network I/O"
          value={currentNetwork}
          unit="Mbps"
          icon={Network}
          color={COLORS.accent}
          subtitle="Combined in/out"
          chartData={networkData}
        />
        <MetricCard
          title="Disk I/O"
          value={currentDisk / 1000}
          unit="MB/s"
          icon={HardDrive}
          color={COLORS.success}
          subtitle={`${totalDiskGB} GB total`}
          chartData={diskData}
        />
      </div>

      {/* Container section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Container CPU distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-2xl"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity size={20} style={{ color: COLORS.primary }} />
            <h2 className="font-semibold" style={{ color: COLORS.text }}>CPU by Container</h2>
          </div>
          <ContainerDistribution containers={containers} type="cpu" />
        </motion.div>

        {/* Container Memory distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <MemoryStick size={20} style={{ color: COLORS.secondary }} />
            <h2 className="font-semibold" style={{ color: COLORS.text }}>Memory by Container</h2>
          </div>
          <ContainerDistribution containers={containers} type="memory" />
        </motion.div>

        {/* Container list */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Container size={20} style={{ color: COLORS.success }} />
            <h2 className="font-semibold" style={{ color: COLORS.text }}>Active Containers</h2>
          </div>
          <ContainerList containers={containers} />
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="mt-8 text-center text-sm" style={{ color: COLORS.textMuted }}>
        Powered by Netdata | Data updates every 2 seconds
      </footer>

      {/* Custom scrollbar styles */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: ${COLORS.surfaceLight};
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${COLORS.border};
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${COLORS.textMuted};
        }
      `}</style>
    </div>
  );
}

// Main page component
export default function MetricsPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for saved password
    const savedPassword = localStorage.getItem('metrics_password');
    if (savedPassword) {
      // Verify the saved password still works
      fetch('/api/metrics/netdata?endpoint=info', {
        headers: { Authorization: `Bearer ${savedPassword}` },
      })
        .then((res) => {
          if (res.ok) {
            setPassword(savedPassword);
            setIsAuthenticated(true);
          }
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleAuthenticated = (pwd: string) => {
    setPassword(pwd);
    setIsAuthenticated(true);
  };

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: COLORS.background }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3"
        >
          <RefreshCw className="animate-spin" size={24} style={{ color: COLORS.primary }} />
          <span style={{ color: COLORS.text }}>Loading...</span>
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {isAuthenticated ? (
        <motion.div
          key="dashboard"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <Dashboard password={password} />
        </motion.div>
      ) : (
        <motion.div
          key="auth"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <AuthGate onAuthenticated={handleAuthenticated} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
