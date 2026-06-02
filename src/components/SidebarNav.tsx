//src/components/SidebarNav.tsx

'use client'; // จำเป็นสำหรับ usePathname

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { canManageUsers, canAccessPage } from "../lib/permissions";

interface MenuItem {
  name: string;
  href: string;
  icon: string;
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
      { name: "ภาพรวม", href: "/", icon: "📊", key: "dashboard" },
      { name: "ห้องพักทั้งหมด", href: "/rooms", icon: "🏢", key: "rooms" },
      { name: "ห้องว่างพร้อมเช่า", href: "/available-rooms", icon: "🛏️", key: "available_rooms" },
    ]
  },
  {
    title: "การจัดการ",
    items: [
      { name: "จองไม่ระบุห้อง", href: "/waitlists", icon: "📝", key: "waitlists" },
      { name: "การจอง", href: "/bookings", icon: "📅", key: "bookings" },
      { name: "สอบถามต่อสัญญา", href: "/renewal-check", icon: "🔁", key: "renewal_check" },
      { name: "กิจกรรมระบบ", href: "/activity", icon: "🕒", key: "activity" },
    ]
  }
];

interface SidebarNavProps {
  collapsed?: boolean;
}

export default function SidebarNav({ collapsed = false }: SidebarNavProps) {
  const pathname = usePathname();
  const { profile } = useAuth();

  const showUserManagement = canManageUsers(profile?.role);

  const renderLink = (item: MenuItem) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} px-4 py-2.5 rounded-xl text-sm transition-all duration-200
          ${isActive
            ? "bg-[#1e2538] text-white font-semibold shadow-sm"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        title={item.name}
      >
        <span className={`text-lg ${isActive ? "opacity-100" : "opacity-80"}`}>{item.icon}</span>
        {!collapsed && <span className="font-medium">{item.name}</span>}
      </Link>
    );
  };

  return (
    <nav className={`flex-1 ${collapsed ? "p-2" : "p-4"} space-y-4 overflow-y-auto`}>
      {menuSections.map((section, sIdx) => {
        // กรองเมนูตามสิทธิ์การเข้าใช้งาน
        const filteredItems = section.items.filter(item => canAccessPage(profile, item.key));
        if (filteredItems.length === 0) return null;

        return (
          <div key={sIdx} className="space-y-1">
            {!collapsed && (
              <p className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {filteredItems.map(item => renderLink(item))}
            </div>
          </div>
        );
      })}

      {/* เมนูจัดการผู้ใช้สำหรับ Owner / Admin เท่านั้น */}
      {showUserManagement && (
        <div className="space-y-1 pt-2">
          {!collapsed && (
            <p className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              ระบบ
            </p>
          )}
          <div className="space-y-0.5">
            {renderLink({ name: "จัดการผู้ใช้", href: "/users", icon: "👥", key: "users" })}
          </div>
        </div>
      )}
    </nav>
  );
}
