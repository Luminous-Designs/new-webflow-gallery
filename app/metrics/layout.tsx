import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VPS Metrics Dashboard | Luminous Web Design",
  description: "Real-time VPS performance monitoring dashboard",
};

// This layout excludes AuthProvider since the metrics page uses its own auth
export default function MetricsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
