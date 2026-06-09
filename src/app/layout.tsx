//src/app/layout.tsx

import type { Metadata } from "next";
import { K2D } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import ClientLayoutWrapper from "./ClientLayoutWrapper";
import { AuthProvider } from "../context/AuthContext";

const k2d = K2D({
  variable: "--font-k2d",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ระบบจัดการอพาร์ตเมนต์ | Apartment Management System",
  description: "Salaya One Premium Service Apartment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${k2d.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="h-full bg-slate-50 text-slate-800">
        <AuthProvider>
          <ClientLayoutWrapper k2dFont={k2d.variable}>
            {children}
          </ClientLayoutWrapper>
        </AuthProvider>
      </body>
    </html>
  );
}

