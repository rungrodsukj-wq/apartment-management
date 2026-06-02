'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { canManageUsers } from '../../lib/permissions';

interface Room {
  id: string;
  room_number: string;
}

interface AuditLog {
  id: string | number;
  performed_by_name?: string | null;
  performed_by_id?: string | null;
  action: string;
  description: string;
  resource_type: string;
  resource_id?: string | null;
  performed_at?: string;
  changes?: string | null;
}

interface ActivityEntry {
  id: string | number;
  actor: string;
  action: string;
  resourceLabel: string;
  date: Date;
  displayDate: string;
}

export default function ActivityPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!profile || !canManageUsers(profile.role)) {
      router.push('/');
      return;
    }

    fetchActivityData();
  }, [authLoading, profile, router]);

  async function fetchActivityData() {
    setLoading(true);
    setError(null);

    const [{ data: roomData, error: roomError }, { data: auditData, error: auditError }] = await Promise.all([
      supabase.from('rooms').select('id, room_number'),
      supabase.from('audit_logs').select('id, performed_by_name, performed_by_id, action, description, resource_type, resource_id, performed_at, changes').order('performed_at', { ascending: false }).limit(50),
    ]);

    let combinedError = '';
    if (roomError) {
      console.error('Activity page room query error:', roomError);
      combinedError += `ไม่สามารถดึงข้อมูลห้องได้: ${roomError.message}. `;
    }

    if (auditError) {
      console.error('Activity page audit query error:', auditError);
      combinedError += `ไม่สามารถดึงข้อมูลกิจกรรมระบบได้: ${auditError.message}. `;
      combinedError += 'กรุณาตรวจสอบตาราง audit_logs และสิทธิ์การเข้าถึง';
    }

    if (combinedError) {
      setError(combinedError.trim());
    }

    if (roomData) setRooms(roomData);
    if (auditData) setLogs(auditData as AuditLog[]);
    setLoading(false);
  }

  const roomNumberMap = useMemo(() => new Map(rooms.map((room) => [room.id, room.room_number])), [rooms]);

  const activities = useMemo(() => {
    const parseDate = (value?: string) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const entries: ActivityEntry[] = [];

    logs.forEach((record: AuditLog) => {
      const actor = record.performed_by_name || record.performed_by_id || 'ไม่ระบุพนักงาน';
      const eventDate = parseDate(record.performed_at);
      if (!eventDate) return;

      const resourceLabel = record.resource_id
        ? `${record.resource_type} ${record.resource_id}`
        : record.resource_type;

      entries.push({
        id: record.id,
        actor,
        action: `${record.action} - ${record.description}`,
        resourceLabel,
        date: eventDate,
        displayDate: eventDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }),
      });
    });

    return entries
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 20);
  }, [logs]);

  return (
    <div className="flex-1 p-8 md:p-10 max-w-[1200px] mx-auto w-full space-y-8">
      <section className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.04)] p-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#0A2647]">กิจกรรมระบบ</h1>
            <p className="text-sm text-slate-500">ดูการดำเนินการล่าสุดโดยพนักงานที่บันทึกข้อมูล</p>
          </div>
          <div className="text-xs text-slate-400">ข้อมูลเฉพาะ Admin / Owner</div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {error ? (
              <div className="text-red-500">{error}</div>
            ) : activities.length === 0 ? (
              <div className="text-slate-500">ยังไม่มีข้อมูลกิจกรรมระบบในขณะนี้</div>
            ) : (
              activities.map((item) => (
                <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">{item.actor}</div>
                    <div className="text-xs text-slate-500 mt-1 truncate">{item.action} · {item.resourceLabel}</div>
                  </div>
                  <div className="text-xs text-slate-400 whitespace-nowrap">{item.displayDate}</div>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
