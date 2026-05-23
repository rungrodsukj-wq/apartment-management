// src/app/ClientLayoutWrapper.tsx
"use client";

import { useState } from "react";
import SidebarNav from "../components/SidebarNav";

// 1. สร้าง Interface เพื่อกำหนด Type ให้กับ Props
interface ClientLayoutWrapperProps {
  children: React.ReactNode;
  geistSans?: string; // ใส่ ? เผื่อไว้ในกรณีที่บางหน้าไม่ได้ส่ง prop นี้มา
  geistMono?: string;
}

// 2. นำ Interface ไปครอบ Props ใน Component
export default function ClientLayoutWrapper({ 
  children, 
  geistSans, 
  geistMono 
}: ClientLayoutWrapperProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    // 💡 ข้อแนะนำเพิ่มเติม: หากคุณต้องการใช้ Font คุณต้องเอาตัวแปร geistSans/geistMono มาใส่ใน className ด้วยครับ
    // เช่น className={`flex h-screen bg-[#F0F4F8] text-slate-800 overflow-hidden ${geistSans} ${geistMono}`}
    <body className="flex h-screen bg-[#F0F4F8] text-slate-800 overflow-hidden font-sans">
      
      {/* Sidebar */}
      <aside
        className={`
          group/sidebar
          ${sidebarCollapsed ? "w-[72px]" : "w-[280px]"}
          bg-[#0A2647] flex flex-col justify-between text-slate-300 shadow-xl z-10 transition-all duration-300
          relative
        `}
      >
        {/* Toggle Button (floating, center) */}
        <button
          className={`
            absolute -right-4 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center
            bg-white/90 border border-slate-200 shadow-lg rounded-full z-20
            hover:bg-blue-100 active:bg-blue-200 transition-all
            ring-0 focus:ring-2 focus:ring-blue-400
          `}
          style={{ boxShadow: '0 2px 8px 0 rgba(10,38,71,0.10)' }}
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}
        >
          <svg
            className={`w-5 h-5 text-blue-900 transform transition-transform duration-300 ${sidebarCollapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div>
          {/* Logo */}
          <div className="h-20 flex items-center gap-3 justify-center p-6 border-b border-white/10 mb-6">
            <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-white font-bold text-xl">S</span>
            </div>
            {!sidebarCollapsed && (
              <h1 className="text-2xl font-extrabold text-white tracking-tighter">Salaya One</h1>
            )}
          </div>
          {/* SidebarNav รับ prop collapsed */}
          <SidebarNav collapsed={sidebarCollapsed} />
        </div>
        
        {/* User Info */}
        <div className={`p-4 m-4 rounded-xl bg-white/5 border border-white/10 transition-all duration-300 ${sidebarCollapsed ? "flex flex-col items-center p-2 m-2" : ""}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-400 font-bold">
              A
            </div>
            {!sidebarCollapsed && (
              <div className="flex flex-col">
                <div className="text-sm text-white font-semibold">ผู้ดูแลระบบ</div>
                <div className="text-xs text-slate-400">Salaya Branch</div>
              </div>
            )}
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="px-10 py-5 bg-white/50 backdrop-blur-md sticky top-0 z-10 flex justify-between items-center border-b border-slate-200/50">
          <div className="bg-white rounded-full px-6 py-2.5 flex items-center shadow-sm border border-slate-100 w-96">
            <span className="text-slate-400">🔍</span>
            <input type="text" placeholder="ค้นหาด่วน (ชื่อผู้เช่า, เลขห้อง)..." className="ml-3 outline-none w-full text-sm text-slate-700 bg-transparent" />
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-slate-600">
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-sm border border-slate-100 text-lg hover:bg-slate-50">🔔</button>
            <div className="bg-white px-5 py-2 rounded-full shadow-sm border border-slate-100 flex items-center gap-2">
              <span>👤</span> Dashboard Overview
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </body>
  );
}