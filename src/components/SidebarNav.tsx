//src/components/SidebarNav.tsx

'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { canManageUsers, canAccessPage } from "../lib/permissions";
import React from "react";

interface MenuItem {
  name: string;
  href: string;
  icon: React.ReactNode;
  key: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const menuSections: MenuSection[] = [
  {
    title: "เมนูหลัก",
    items: [
      { 
        name: "ภาพรวม", 
        href: "/", 
        key: "dashboard",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        )
      },
      { 
        name: "ห้องพักทั้งหมด", 
        href: "/rooms", 
        key: "rooms",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
        )
      },
      { 
        name: "ห้องว่างพร้อมจอง", 
        href: "/available-rooms", 
        key: "available_rooms",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      },
    ]
  },
  {
    title: "การจัดการ",
    items: [
      { 
        name: "จองไม่ระบุห้อง", 
        href: "/waitlists", 
        key: "waitlists",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
        )
      },
      { 
        name: "จองระบุห้อง", 
        href: "/bookings", 
        key: "bookings",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        )
      },
      { 
        name: "สอบถามต่อสัญญา", 
        href: "/renewal-check", 
        key: "renewal_check",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        )
      },
      { 
        name: "กิจกรรมระบบ", 
        href: "/activity", 
        key: "activity",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      },
    ]
  }
];

interface SidebarNavProps {
  collapsed?: boolean;
}

export default function SidebarNav({ collapsed = false }: SidebarNavProps) {
  const pathname = usePathname();
  const { profile } = useAuth();
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const handleToggle = () => {
    const nextDark = !isDark;
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const showUserManagement = canManageUsers(profile?.role);

  const renderLink = (item: MenuItem) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} px-4 py-2.5 rounded-xl text-sm transition-all duration-200
          ${isActive
            ? "bg-[#1e2538] text-white font-semibold shadow-sm dark:bg-[#e8d8c3]/15 dark:text-[#e8d8c3]"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
          }`}
        title={item.name}
      >
        <span className={`flex items-center justify-center ${isActive ? "opacity-100" : "opacity-80"}`}>
          {item.icon}
        </span>
        {!collapsed && <span className="font-medium">{item.name}</span>}
      </Link>
    );
  };

  return (
    <nav className={`flex-1 ${collapsed ? "p-2" : "p-4"} space-y-4 overflow-y-auto`}>
      {menuSections.map((section, sIdx) => {
        const filteredItems = section.items.filter(item => canAccessPage(profile, item.key));
        if (filteredItems.length === 0) return null;

        return (
          <div key={sIdx} className="space-y-1">
            {!collapsed && (
              <p className="px-4 text-[10px] font-bold text-slate-400 dark:text-[#e8d8c3]/50 uppercase tracking-widest mb-2">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {filteredItems.map(item => renderLink(item))}
            </div>
          </div>
        );
      })}

      {showUserManagement && (
        <div className="space-y-1 pt-2">
          {!collapsed && (
            <p className="px-4 text-[10px] font-bold text-slate-400 dark:text-[#e8d8c3]/50 uppercase tracking-widest mb-2">
              ระบบ
            </p>
          )}
          <div className="space-y-0.5">
            {renderLink({ 
              name: "จัดการผู้ใช้", 
              href: "/users", 
              key: "users",
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              )
            })}
          </div>
        </div>
      )}

      {/* เมนูเปลี่ยนธีม (Light/Dark Mode) */}
      {/* <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-white/10">
        {!collapsed && (
          <p className="px-4 text-[10px] font-bold text-slate-400 dark:text-[#e8d8c3]/50 uppercase tracking-widest mb-2">
            โหมดการแสดงผล
          </p>
        )} */}
        {/* <button
          onClick={handleToggle}
          className={`w-full flex items-center ${collapsed ? "justify-center" : "gap-3"} px-4 py-2.5 rounded-xl text-sm transition-all duration-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white cursor-pointer`}
          title={isDark ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
        >
          <span className="flex items-center justify-center opacity-80">
            {isDark ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m0 13.5V21M4.22 4.22l1.58 1.58m12.42 12.42l1.58 1.58M3 12h2.25m13.5 0H21M4.22 19.78l1.58-1.58M17.78 4.22l1.58 1.58M12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
          </span>
          {!collapsed && <span className="font-medium">{isDark ? "โหมดสว่าง " : "โหมดมืด "}</span>}
        </button> */}
      {/* </div> */}
    </nav>
  );
}