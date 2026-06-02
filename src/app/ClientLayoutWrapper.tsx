"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import { canAccessPage } from "../lib/permissions";
import SidebarNav from "../components/SidebarNav";

interface ClientLayoutWrapperProps {
  children: React.ReactNode;
  geistSans?: string;
  geistMono?: string;
}

const roleLabels: Record<string, string> = {
  admin: "ผู้ดูแลระบบสูงสุด",
  owner: "เจ้าของหอพัก",
  staff: "พนักงาน",
  viewer: "ผู้เข้าชมข้อมูล",
};

export function getHeaderInfo(pathname: string) {
  if (pathname === "/") return { breadcrumb: "Salaya One Service Apartment / ภาพรวม", title: "ภาพรวม" };
  if (pathname === "/rooms") return { breadcrumb: "Salaya One Service Apartment / ห้องพักทั้งหมด", title: "ห้องพักทั้งหมด" };
  if (pathname === "/available-rooms") return { breadcrumb: "Salaya One Service Apartment / ห้องว่างพร้อมจอง", title: "ห้องว่างพร้อมจอง" };
  if (pathname.startsWith("/waitlists")) return { breadcrumb: "Salaya One Service Apartment / จองไม่ระบุห้อง", title: "จองไม่ระบุห้อง" };
  if (pathname.startsWith("/bookings")) return { breadcrumb: "Salaya One Service Apartment / จองระบุห้อง", title: "จองระบุห้อง" };
  if (pathname.startsWith("/renewal-check")) return { breadcrumb: "Salaya One Service Apartment / สอบถามต่อสัญญา", title: "สอบถามต่อสัญญา" };
  if (pathname.startsWith("/users")) return { breadcrumb: "Salaya One Service Apartment / จัดการสิทธิ์และผู้ใช้งาน", title: "จัดการสิทธิ์และผู้ใช้งาน" };
  if (pathname.startsWith("/activity")) return { breadcrumb: "Salaya One Service Apartment / กิจกรรมระบบ", title: "กิจกรรมระบบ" };
  if (pathname.startsWith("/allocate")) return { breadcrumb: "Salaya One Service Apartment / จัดสรรห้องพัก", title: "จัดสรรห้องพัก" };
  return { breadcrumb: "Salaya One Service Apartment / ระบบ", title: "หน้าต่างระบบ" };
}

export default function ClientLayoutWrapper({ 
  children, 
  geistSans, 
  geistMono 
}: ClientLayoutWrapperProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const quickActionRef = useRef<HTMLDivElement | null>(null);
  
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, logout } = useAuth();

  // ป้องกัน Flash หรือแสดง Layout ในหน้า Auth
  const isAuthPage = pathname === "/login" || pathname === "/register" || pathname === "/pending";

  const quickActions = [
    { label: "เพิ่มห้องพัก", href: "/rooms?quickAction=newRoom", description: "ไปที่หน้าจัดการห้องพัก" },
    { label: "จองไม่ระบุห้อง", href: "/waitlists?quickAction=newWaitlist", description: "เพิ่มรายการจองไม่ระบุห้อง" },
    { label: "เพิ่มการจองระบุห้อง", href: "/bookings?quickAction=newBooking", description: "ไปที่หน้าการจองระบุห้อง" },
  ];

  useEffect(() => {
    if (!loading) {
      if (!user && !isAuthPage) {
        router.push("/login");
      }
    }
  }, [user, loading, pathname, isAuthPage, router]);

  const routePageKeyMap: Record<string, string> = {
    '/': 'dashboard',
    '/rooms': 'rooms',
    '/available-rooms': 'available_rooms',
    '/waitlists': 'waitlists',
    '/bookings': 'bookings',
    '/renewal-check': 'renewal_check',
    '/users': 'users',
    '/activity': 'activity',
  };

  useEffect(() => {
    if (loading || !user || !profile) return;

    if (profile.status === 'pending' && pathname !== '/pending') {
      router.push('/pending');
      return;
    }

    if (profile.status === 'disabled') {
      logout();
      router.push('/login');
      return;
    }

    const pageKey = routePageKeyMap[pathname];
    if (pageKey && !canAccessPage(profile, pageKey)) {
      router.push('/');
    }
  }, [loading, user, profile, pathname, router, logout]);

  useEffect(() => {
    if (!isQuickActionOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (quickActionRef.current && !quickActionRef.current.contains(event.target as Node)) {
        setIsQuickActionOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isQuickActionOpen]);

  useEffect(() => {
    setIsQuickActionOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A2647] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4"></div>
        <p className="text-white/60 text-sm font-medium tracking-wide">กำลังเตรียมความพร้อมของระบบ...</p>
      </div>
    );
  }

  // หากเป็นหน้า login, register, หรือ pending ไม่ต้องเรนเดอร์แถบข้าง
  if (isAuthPage) {
    return <>{children}</>;
  }

  const displayName = profile?.user_name || "ผู้ใช้งาน";
  const email = profile?.email || "";
  const roleLabel = roleLabels[profile?.role || "viewer"];
  const avatarChar = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex flex-row h-screen bg-[#F4F6F8] text-slate-800 overflow-hidden font-sans w-full">
      
      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar / Drawer */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-[280px] transform ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
          lg:relative lg:translate-x-0 lg:z-10 lg:flex lg:flex-col lg:shrink-0
          ${sidebarCollapsed ? "lg:w-[72px]" : "lg:w-[280px]"}
          bg-white border-r border-slate-200 flex flex-col justify-between text-slate-700 shadow-sm transition-all duration-300
        `}
      >
        {/* Toggle Button for Desktop (floating, center) */}
        <button
          className={`
            hidden lg:flex absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 items-center justify-center
            bg-white border border-slate-200 shadow-md rounded-full z-20
            hover:bg-slate-50 active:bg-slate-100 transition-all
            ring-0 focus:ring-2 focus:ring-slate-300
          `}
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}
        >
          <svg
            className={`w-4 h-4 text-slate-600 transform transition-transform duration-300 ${sidebarCollapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Logo & Close Button */}
          <div className="h-20 flex items-center justify-between px-6 border-b border-slate-100 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#1e2538] rounded-2xl flex items-center justify-center shadow-md">
                <span className="text-white font-extrabold text-xl">S</span>
              </div>
              {(!sidebarCollapsed || isMobileOpen) && (
                <div className="flex flex-col">
                  <h1 className="text-sm font-extrabold text-slate-800 leading-tight">Salaya One Service Apartment</h1>
                  <span className="text-[11px] text-slate-400 font-medium">ระบบจัดการห้องพัก</span>
                </div>
              )}
            </div>
            
            {/* Close Button for Mobile Drawer */}
            <button 
              onClick={() => setIsMobileOpen(false)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors outline-none"
              aria-label="ปิดเมนู"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* SidebarNav */}
          <div onClick={() => setIsMobileOpen(false)}>
            <SidebarNav collapsed={sidebarCollapsed && !isMobileOpen} />
          </div>
        </div>
        
        {/* User Info & Logout Button */}
        <div className={`p-3 m-3 rounded-2xl bg-slate-50 border border-slate-100/80 transition-all duration-300 ${(sidebarCollapsed && !isMobileOpen) ? "flex flex-col items-center p-2 m-2" : ""}`}>
          <div className="flex items-center gap-3 mb-2.5">
            <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold text-sm shrink-0">
              {avatarChar}
            </div>
            {(!sidebarCollapsed || isMobileOpen) && (
              <div className="flex flex-col min-w-0">
                <div className="text-sm text-slate-800 font-bold truncate" title={displayName}>{displayName}</div>
                <div className="text-[11px] text-slate-400 font-medium truncate" title={roleLabel}>{roleLabel}</div>
              </div>
            )}
          </div>
          
          {(!sidebarCollapsed || isMobileOpen) ? (
            <div className="space-y-2 w-full">
              <Link
                href="/change-password"
                className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer border border-slate-200"
              >
                <span>🔐</span> เปลี่ยนรหัสผ่าน
              </Link>
              <button
                onClick={logout}
                className="w-full py-2 px-3 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer border border-red-100"
              >
                <span>➡️</span> ออกจากระบบ
              </button>
            </div>
          ) : (
            <div className="flex gap-2 w-full justify-center">
              <Link
                href="/change-password"
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all duration-200 cursor-pointer border border-slate-200"
                title="เปลี่ยนรหัสผ่าน"
              >
                🔐
              </Link>
              <button
                onClick={logout}
                className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-all duration-200 cursor-pointer border border-red-100"
                title="ออกจากระบบ"
              >
                ➡️
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Top Navbar */}
        <header className="lg:hidden bg-white border-b border-slate-200/80 shrink-0 shadow-sm z-20">
          {/* Action Bar */}
          <div className="h-14 flex items-center justify-between px-3 bg-[#0A2647] text-white gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button 
                onClick={() => setIsMobileOpen(true)} 
                className="p-2 text-white hover:bg-white/10 rounded-xl transition-colors outline-none shrink-0"
                aria-label="เปิดเมนู"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Breadcrumb & Title */}
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-white/60 font-medium truncate">
                  {getHeaderInfo(pathname).breadcrumb}
                </div>
                <h2 className="text-xs font-bold text-white truncate">
                  {getHeaderInfo(pathname).title}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Mobile Quick Action Menu */}
              <div className="relative" ref={quickActionRef}>
                <button
                  type="button"
                  onClick={() => setIsQuickActionOpen((open) => !open)}
                  aria-expanded={isQuickActionOpen}
                  className="p-2 text-white hover:bg-white/10 rounded-xl transition-colors outline-none"
                  title="ดำเนินการด่วน"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>

                {isQuickActionOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-3xl shadow-[0_24px_64px_rgba(15,23,42,0.12)] z-50 overflow-hidden">
                    <div className="p-3 text-xs text-slate-400 border-b border-slate-100">เลือกการดำเนินการด่วน</div>
                    <div className="flex flex-col">
                      {quickActions.map((action) => (
                        <button
                          key={action.href}
                          type="button"
                          onClick={() => {
                            setIsQuickActionOpen(false);
                            router.push(action.href);
                          }}
                          className="text-left px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0"
                        >
                          <div className="font-medium text-slate-800">{action.label}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{action.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="w-8 h-8 rounded-lg bg-slate-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                {avatarChar}
              </div>
            </div>
          </div>
        </header>

        {/* Desktop Top Header (Mockup style) */}
        <header className="hidden lg:flex h-20 bg-white border-b border-slate-200/80 items-center justify-between px-8 shrink-0">
          {/* Breadcrumbs & Title */}
          <div>
            <div className="text-xs text-slate-400 font-medium">
              {getHeaderInfo(pathname).breadcrumb}
            </div>
            <h2 className="text-lg font-bold text-slate-800 mt-0.5">
              {getHeaderInfo(pathname).title}
            </h2>
          </div>

          {/* Search, Notifications & Quick Actions */}
          <div className="flex items-center gap-4">
            {/* กดแล้วจะมีเมนูลัดขึ้นมา เช่น เพิ่มห้องพัก จองไม่ระบุห้อง จองระบุห้อง */}
            <div className="relative" ref={quickActionRef}>
              <button
                type="button"
                onClick={() => setIsQuickActionOpen((open) => !open)}
                aria-expanded={isQuickActionOpen}
                className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-all cursor-pointer shadow-sm"
              >
                <span>+</span> ดำเนินการด่วน
              </button>

              {isQuickActionOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-3xl shadow-[0_24px_64px_rgba(15,23,42,0.12)] z-20 overflow-hidden">
                  <div className="p-3 text-xs text-slate-400 border-b border-slate-100">เลือกการดำเนินการด่วน</div>
                  <div className="flex flex-col">
                    {quickActions.map((action) => (
                      <button
                        key={action.href}
                        type="button"
                        onClick={() => {
                          setIsQuickActionOpen(false);
                          router.push(action.href);
                        }}
                        className="text-left px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0"
                      >
                        <div className="font-medium text-slate-800">{action.label}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{action.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="h-6 w-px bg-slate-200"></div>

            {/* Logout icon */}
            <button
              onClick={logout}
              className="w-9 h-9 flex items-center justify-center bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200/60 rounded-full transition-colors cursor-pointer"
              title="ออกจากระบบ"
            >
              🚪
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
