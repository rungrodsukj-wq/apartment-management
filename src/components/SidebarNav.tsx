//src/components/SidebarNav.tsx

'use client'; // จำเป็นสำหรับ usePathname



import Link from "next/link";

import { usePathname } from "next/navigation";





const menuItems = [

  { name: "Dashboard", href: "/", icon: "📊" },

  { name: "ผังห้องพัก", href: "/rooms", icon: "🏢" },

  { name: "จองไม่ระบุห้อง", href: "/waitlists", icon: "📝" },

  { name: "การจอง", href: "/bookings", icon: "📜" },

];



interface SidebarNavProps {

  collapsed?: boolean;

}



export default function SidebarNav({ collapsed = false }: SidebarNavProps) {

  const pathname = usePathname();



  return (

    <nav className={`flex-1 ${collapsed ? "p-2" : "p-4"} space-y-2 overflow-y-auto`}>

      {!collapsed && (

        <p className="px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 mt-4">

          เมนูหลัก

        </p>

      )}

      {menuItems.map((item) => {

        const isActive = pathname === item.href;

        return (

          <Link

            key={item.href}

            href={item.href}

            className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} px-4 py-3 rounded-xl text-sm transition-all transition-colors duration-200

              ${isActive

                ? "bg-white/10 text-white font-semibold shadow-inner border border-white/5"

                : "text-slate-300 hover:bg-white/5 hover:text-white"

              }`}

            title={item.name}

          >

            <span className={`text-lg ${isActive ? "opacity-100" : "opacity-60"}`}>{item.icon}</span>

            {!collapsed && <span>{item.name}</span>}

          </Link>

        );

      })}

    </nav>

  );

}