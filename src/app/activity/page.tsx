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
  rawDescription?: string;
  rawChanges?: string | null;
  resourceType?: string;
  resourceId?: string | null;
}

export default function ActivityPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [waitlistContracts, setWaitlistContracts] = useState<Record<string, { id?: string; main_room_id?: string | null; temp_room_id?: string | null }>>({});
  const [waitlistMap, setWaitlistMap] = useState<Record<string, { id?: string; name?: string | null }>>({});
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string | number>>(new Set());

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

    // For waitlist-related audit entries, fetch contracts and waitlist details
    try {
      const contractMap: Record<string, { id?: string; main_room_id?: string | null; temp_room_id?: string | null }> = {};
      const wlMap: Record<string, { id?: string; name?: string | null }> = {};
      if (auditData && Array.isArray(auditData)) {
        const waitlistIds = Array.from(new Set(auditData
          .filter((r: any) => r.resource_type === 'waitlists' && r.resource_id)
          .map((r: any) => r.resource_id)));

        if (waitlistIds.length > 0) {
          const [contractsRes, waitlistsRes] = await Promise.all([
            supabase
              .from('contracts')
              .select('id, main_room_id, temp_room_id, waitlist_id')
              .in('waitlist_id', waitlistIds as string[]),
            supabase
              .from('waitlists')
              .select('id, name')
              .in('id', waitlistIds as string[]),
          ]);

          const contractData = (contractsRes as any).data;
          const contractError = (contractsRes as any).error;
          const waitlistData = (waitlistsRes as any).data;
          const waitlistError = (waitlistsRes as any).error;

          if (contractError) console.error('Activity page contracts query error:', contractError);
          if (waitlistError) console.error('Activity page waitlists query error:', waitlistError);

          if (contractData && Array.isArray(contractData)) {
            contractData.forEach((c: any) => {
              if (c.waitlist_id) contractMap[c.waitlist_id] = { id: c.id, main_room_id: c.main_room_id, temp_room_id: c.temp_room_id };
            });
          }

          if (waitlistData && Array.isArray(waitlistData)) {
            waitlistData.forEach((w: any) => {
              if (w.id) wlMap[w.id] = { id: w.id, name: w.name };
            });
          }
        }
      }

      setWaitlistContracts(contractMap);
      setWaitlistMap(wlMap);
    } catch (e) {
      console.error('Error fetching waitlist contracts/details for activity page:', e);
    }

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

      let resourceLabel = record.resource_type;
      if (record.resource_id) {
        if (record.resource_type === 'rooms') {
          const rn = roomNumberMap.get(record.resource_id);
          resourceLabel = rn ? `ห้อง ${rn}` : `${record.resource_type} ${record.resource_id}`;
        } else if (record.resource_type === 'waitlists') {
          const contract = waitlistContracts[record.resource_id as string];
          const roomId = contract?.main_room_id ?? contract?.temp_room_id ?? null;
          const rn = roomId ? roomNumberMap.get(roomId) : null;
          resourceLabel = rn ? `${record.resource_type} ${record.resource_id} · ห้อง ${rn}` : `${record.resource_type} ${record.resource_id}`;
        } else {
          resourceLabel = `${record.resource_type} ${record.resource_id}`;
        }
      } else {
        resourceLabel = record.resource_type;
      }

      entries.push({
        id: record.id,
        actor,
        action: `${record.action} - ${record.description}`,
        resourceLabel,
        date: eventDate,
        displayDate: `${eventDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} ${eventDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`,
        rawDescription: record.description,
        rawChanges: record.changes ?? null,
        resourceType: record.resource_type,
        resourceId: record.resource_id ?? null,
      });
    });

    return entries
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 20);
  }, [logs, roomNumberMap, waitlistContracts]);

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
              <div className="flex items-center gap-4">
                <div className="text-red-500">{error}</div>
                <button onClick={fetchActivityData} className="text-sm text-blue-600 underline">ลองอีกครั้ง</button>
              </div>
            ) : activities.length === 0 ? (
              <div className="text-slate-500">ยังไม่มีข้อมูลกิจกรรมระบบในขณะนี้</div>
            ) : (
              activities.map((item) => (
                <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">{item.actor}</div>
                      <div className="text-xs text-slate-500 mt-1 truncate">{item.action} · {item.resourceLabel}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-slate-400 whitespace-nowrap">{item.displayDate}</div>
                      <button
                        onClick={() => {
                          setExpandedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                        className="text-xs text-slate-600 hover:text-slate-900"
                      >
                        {expandedIds.has(item.id) ? 'ซ่อนรายละเอียด' : 'รายละเอียด'}
                      </button>
                    </div>
                  </div>

                  {expandedIds.has(item.id) && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="text-sm text-slate-700">คำอธิบาย:</div>
                      <div className="text-sm text-slate-600 break-words mt-1">{item.rawDescription || '-'}</div>

                      {item.resourceType === 'waitlists' && item.resourceId ? (
                        <div className="mt-3">
                          <div className="text-sm text-slate-700">ข้อมูลการจอง:</div>
                          <div className="text-sm text-slate-600 mt-1">ชื่อ: {waitlistMap[item.resourceId]?.name ?? '-'}</div>
                          <div className="text-sm text-slate-600">ห้อง: {(() => {
                            const c = waitlistContracts[item.resourceId as string];
                            const roomId = c?.main_room_id ?? c?.temp_room_id ?? null;
                            const rn = roomId ? roomNumberMap.get(roomId) : null;
                            return rn ? `ห้อง ${rn}` : '-';
                          })()}</div>
                        </div>
                      ) : null}

                      {item.rawChanges ? (
                        (() => {
                          try {
                            const parsed = JSON.parse(item.rawChanges as string);
                            return (
                              <pre className="mt-3 p-3 bg-slate-50 rounded text-xs text-slate-700 overflow-auto">
                                {JSON.stringify(parsed, null, 2)}
                              </pre>
                            );
                          } catch {
                            return <div className="mt-3 text-xs text-slate-600">{item.rawChanges}</div>;
                          }
                        })()
                      ) : null}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
