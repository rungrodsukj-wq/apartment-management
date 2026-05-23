//src/app/layout.tsx

import type { Metadata } from "next";



import { Geist, Geist_Mono } from "next/font/google";

import Link from "next/link";

import "./globals.css";

import ClientLayoutWrapper from "./ClientLayoutWrapper";





const geistSans = Geist({

  variable: "--font-geist-sans",

  subsets: ["latin"],

});



const geistMono = Geist_Mono({

  variable: "--font-geist-mono",

  subsets: ["latin"],

});



export const metadata: Metadata = {

  title: "ระบบจัดการอพาร์ตเมนต์ | ApartmentOSs",

  description: "Modern Apartment Management System",

};



export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html 
      lang="th" 
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <ClientLayoutWrapper geistSans={geistSans.variable} geistMono={geistMono.variable}>
          {children}
        </ClientLayoutWrapper>
      </body>
    </html>
  );
}