"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useRouter, usePathname } from "next/navigation";

// เวลาในสภาวะปกติไม่มีการเคลื่อนไหว: 15 นาที (15 * 60 * 1000 ms)
const DEFAULT_IDLE_TIME = 60 * 60 * 1000;
// เวลาในการแจ้งเตือนนับถอยหลัง: 60 วินาที
const WARNING_TIME = 60;

export default function IdleTimeoutHandler() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARNING_TIME);

  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ตรวจจับหน้าเว็บที่เป็น Auth / ไม่ต้องตรวจจับ Idle
  const isAuthPage = pathname === "/login" || pathname === "/register" || pathname === "/pending";

  const handleLogout = async () => {
    cleanupTimers();
    setShowWarning(false);
    await logout();
    router.push("/login");
  };

  const resetIdleTimer = () => {
    if (showWarning) return; // ถ้าแสดงหน้าต่างเตือนแล้ว ไม่ต้อง Reset จากการขยับเมาส์ทั่วไป จนกว่าจะคลิกปุ่มใช้งานต่อ

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    if (user && !isAuthPage) {
      idleTimerRef.current = setTimeout(() => {
        // เมื่อครบกำหนดเวลา Idle ให้เข้าสู่ช่วงเตือน
        setShowWarning(true);
        setCountdown(WARNING_TIME);
      }, DEFAULT_IDLE_TIME);
    }
  };

  const cleanupTimers = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  };

  // 1. ตรวจจับการเคลื่อนไหวของผู้ใช้งาน
  useEffect(() => {
    if (!user || isAuthPage) {
      cleanupTimers();
      setShowWarning(false);
      return;
    }

    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];

    // ลงทะเบียน Events ตรวจจับกิจกรรม
    events.forEach((event) => {
      window.addEventListener(event, resetIdleTimer);
    });

    // เริ่มตั้งเวลาครั้งแรก
    resetIdleTimer();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, resetIdleTimer);
      });
      cleanupTimers();
    };
  }, [user, pathname, showWarning]);

  // 2. จัดการกับการนับถอยหลังตอนแสดง Warning Modal
  useEffect(() => {
    if (showWarning) {
      countdownTimerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            handleLogout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    }

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [showWarning]);

  const handleKeepWorking = () => {
    setShowWarning(false);
    resetIdleTimer();
  };

  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-[0_24px_64px_rgba(15,23,42,0.25)] overflow-hidden p-6 md:p-8 transform scale-100 transition-all duration-300">

        {/* Warning Icon with Pulse Animation */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-amber-100 dark:bg-amber-950/50 animate-ping opacity-75"></div>
            <div className="relative w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex items-center justify-center text-amber-500 dark:text-amber-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Text Content */}
        <div className="text-center space-y-2 mb-6">
          <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">
            ไม่มีการใช้งานระบบชั่วขณะ
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            คุณไม่มีการเคลื่อนไหวใดๆ เป็นเวลาสักครู่ เพื่อความปลอดภัยของข้อมูล ระบบจะนำคุณออกจากระบบโดยอัตโนมัติภายใน
          </p>
          <div className="inline-flex items-center justify-center px-4 py-2 mt-2 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-extrabold text-2xl rounded-2xl border border-amber-100 dark:border-amber-900/30">
            {countdown} วินาที
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-3 px-4 bg-slate-50 hover:bg-red-50 hover:text-red-600 dark:bg-slate-800/50 dark:hover:bg-red-950/20 text-slate-700 dark:text-slate-300 dark:hover:text-red-400 text-sm font-semibold rounded-2xl border border-slate-200 dark:border-slate-800 transition-all duration-200 cursor-pointer"
          >
            ออกจากระบบ
          </button>

          <button
            type="button"
            onClick={handleKeepWorking}
            className="w-full py-3 px-4 bg-[#0A2647] hover:bg-[#113961] dark:bg-amber-500 dark:hover:bg-amber-400 text-white dark:text-slate-950 text-sm font-semibold rounded-2xl shadow-md shadow-blue-900/10 dark:shadow-amber-500/10 hover:shadow-lg transition-all duration-200 cursor-pointer"
          >
            ใช้งานต่อ
          </button>
        </div>
      </div>
    </div>
  );
}
