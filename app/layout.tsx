import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-context";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Webflow Template Gallery | Luminous Web Design",
  description: "Curated collection of premium Webflow templates for your next project",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        <AuthProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </body>
    </html>
  );
}
