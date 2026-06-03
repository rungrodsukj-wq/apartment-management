'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { canEditPage } from '../../lib/permissions';
import { logAudit, describeChanges } from '../../lib/audit';

const formatDateTH = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('th-TH', {
        day: 'numeric', month: 'short', year: '2-digit'
    });
};

const getDaysUntil = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

type Intention = 'pending' | 'renew' | 'not_renew';

export default function RenewalCheckPage() {
    const router = useRouter();
    const { profile } = useAuth();
    const userCanEdit = canEditPage(profile, 'renewal_check');
    const [contracts, setContracts] = useState<any[]>([]);
    const [rooms, setRooms] = useState<any[]>([]);
    const [intentions, setIntentions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    // Month filter: how many months ahead to look
    const [monthsAhead, setMonthsAhead] = useState(3);

    // Intention filter: filter by renewal intention status
    const [intentionFilter, setIntentionFilter] = useState<Intention | 'all'>('all');

    // Modals state
    const [noteModal, setNoteModal] = useState<{ contractId: string; roomId: string; tenantName: string; currentNote: string } | null>(null);
    const [noteInput, setNoteInput] = useState('');

    // Confirmation Modal state
    const [confirmModal, setConfirmModal] = useState<{
        contractId: string;
        roomId: string;
        tenantName: string;
        intention: Intention;
    } | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        const [{ data: cData }, { data: rData }, { data: iData }] = await Promise.all([
            supabase.from('contracts').select('*').in('status', ['active', 'upcoming']).order('contract_end_date'),
            supabase.from('rooms').select('*').order('room_number'),
            supabase.from('renewal_intentions').select('*'),
        ]);
        if (cData) setContracts(cData);
        if (rData) setRooms(rData);
        if (iData) setIntentions(iData);
        setLoading(false);
    }

    const getRoom = (roomId: string) => rooms.find(r => r.id === roomId);

    const getIntention = (contractId: string): any | null => {
        return intentions.find(i => i.contract_id === contractId) || null;
    };

    // Filter contracts that expire within X months
    const expiringContracts = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoff = new Date(today);
        cutoff.setMonth(cutoff.getMonth() + monthsAhead);

        return contracts
            .filter(c => {
                if (!c.contract_end_date) return false;
                const end = new Date(c.contract_end_date);
                end.setHours(0, 0, 0, 0);
                return end >= today && end <= cutoff;
            })
            .filter(c => {
                // Apply intention filter
                if (intentionFilter === 'all') return true;
                const intention = getIntention(c.id)?.intention || 'pending';
                return intention === intentionFilter;
            })
            .sort((a, b) => {
                const roomA = getRoom(a.main_room_id)?.room_number ?? '';
                const roomB = getRoom(b.main_room_id)?.room_number ?? '';
                const numA = Number(roomA);
                const numB = Number(roomB);
                if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
                    return numA - numB;
                }
                return String(roomA).localeCompare(String(roomB), undefined, { numeric: true, sensitivity: 'base' });
            });
    }, [contracts, monthsAhead, rooms, intentions, intentionFilter]);

    const upsertIntention = async (contractId: string, roomId: string, tenantName: string, intention: Intention, note?: string) => {
        setSaving(contractId);
        const existing = getIntention(contractId);

        if (existing) {
            const updatePayload = { intention, note: note ?? existing.note, updated_at: new Date().toISOString() };
            const { error } = await supabase
                .from('renewal_intentions')
                .update(updatePayload)
                .eq('id', existing.id);
            if (error) {
                alert('เกิดข้อผิดพลาด: ' + error.message);
            } else {
                await logAudit(profile, 'renewal_intentions', 'update', existing.id, 'อัปเดตความตั้งใจต่อสัญญา', describeChanges(updatePayload));
            }
        } else {
            const today = new Date();
            const surveyMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
            const payload = { contract_id: contractId, room_id: roomId, tenant_name: tenantName, intention, survey_month: surveyMonth, note: note ?? '' };
            const { data, error } = await supabase
                .from('renewal_intentions')
                .insert([payload])
                .select('id');
            if (error) {
                alert('เกิดข้อผิดพลาด: ' + error.message);
            } else {
                const newId = data?.[0]?.id ?? null;
                if (newId) await logAudit(profile, 'renewal_intentions', 'create', newId, 'เพิ่มความตั้งใจต่อสัญญา', payload);
            }
        }

        // Refresh intentions
        const { data } = await supabase.from('renewal_intentions').select('*');
        if (data) setIntentions(data);
        setSaving(null);
        setConfirmModal(null); // ปิด popup หลังบันทึกสำเร็จ

        if (intention === 'renew') {
            router.push(`/bookings?renewContractId=${contractId}`);
        }
    };

    const handleSaveNote = async () => {
        if (!noteModal) return;
        const existing = getIntention(noteModal.contractId);
        await upsertIntention(
            noteModal.contractId,
            noteModal.roomId,
            noteModal.tenantName,
            existing?.intention || 'pending',
            noteInput
        );
        setNoteModal(null);
    };

    const intentionConfig: Record<Intention, { label: string; color: string; bg: string; border: string; icon: string; btnHover: string }> = {
        pending: { label: 'รอตอบกลับ', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', icon: '⏳', btnHover: 'hover:bg-amber-500 hover:text-white hover:border-amber-500' },
        renew: { label: 'ต่อสัญญา', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: '✅', btnHover: 'hover:bg-emerald-500 hover:text-white hover:border-emerald-500' },
        not_renew: { label: 'ไม่ต่อสัญญา', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', icon: '🚪', btnHover: 'hover:bg-red-500 hover:text-white hover:border-red-500' },
    };

    const stats = useMemo(() => {
        const pending = expiringContracts.filter(c => {
            const i = getIntention(c.id);
            return !i || i.intention === 'pending';
        }).length;
        const renew = expiringContracts.filter(c => getIntention(c.id)?.intention === 'renew').length;
        const notRenew = expiringContracts.filter(c => getIntention(c.id)?.intention === 'not_renew').length;
        return { pending, renew, notRenew, total: expiringContracts.length };
    }, [expiringContracts, intentions]);

    const grouped = useMemo(() => {
        const overdue = expiringContracts.filter(c => getDaysUntil(c.contract_end_date) < 0);
        const urgent = expiringContracts.filter(c => { const d = getDaysUntil(c.contract_end_date); return d >= 0 && d <= 30; });
        const soon = expiringContracts.filter(c => { const d = getDaysUntil(c.contract_end_date); return d > 30 && d <= 60; });
        const upcoming = expiringContracts.filter(c => getDaysUntil(c.contract_end_date) > 60);
        return { overdue, urgent, soon, upcoming };
    }, [expiringContracts]);

    const renderContractCard = (contract: any, index: number) => {
        const room = getRoom(contract.main_room_id);
        const intention = getIntention(contract.id);
        const currentIntention: Intention = intention?.intention || 'pending';
        const cfg = intentionConfig[currentIntention];
        const days = getDaysUntil(contract.contract_end_date);
        const isSaving = saving === contract.id;

        const urgencyColor = days < 0
            ? 'border-l-red-500'
            : days <= 30
                ? 'border-l-orange-400'
                : days <= 60
                    ? 'border-l-amber-400'
                    : 'border-l-blue-400';

        return (
            <div
                key={contract.id}
                className={`bg-white rounded-2xl border border-slate-100 border-l-[6px] ${urgencyColor} shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 p-5 flex flex-col gap-4`}
            >
                <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-sm">
                            {index}
                        </div>
                        {/* Room badge */}
                        <div className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center shrink-0 shadow-inner ${currentIntention === 'not_renew' ? 'bg-red-50 text-red-600' :
                            currentIntention === 'renew' ? 'bg-emerald-50 text-emerald-600' :
                                'bg-amber-50 text-amber-600'
                            }`}>
                            <span className="text-xs font-medium opacity-70 mb-[-2px]">ห้อง</span>
                            <span className="font-extrabold text-xl">{room?.room_number || '?'}</span>
                        </div>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                            <h3 className="text-lg font-bold text-slate-800">{contract.tenant_name}</h3>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border shadow-sm ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                                {cfg.icon} {cfg.label}
                            </span>
                            {isSaving && (
                                <span className="text-[11px] font-medium text-slate-400 animate-pulse bg-slate-100 px-2 py-1 rounded-full">
                                    กำลังบันทึก...
                                </span>
                            )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                            {room && (
                                <span className="flex items-center gap-1">
                                    <span className="opacity-70">🏢</span> {room.room_type || '-'} · {room.kitchen_type || '-'} · ชั้น {room.floor || '-'}
                                </span>
                            )}
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                            <span className="flex items-center gap-1">
                                <span className="opacity-70">📅</span> {formatDateTH(contract.contract_start_date)} → {formatDateTH(contract.contract_end_date)}
                            </span>
                            <span className={`font-bold px-2 py-0.5 rounded-md ${days < 0 ? 'bg-red-50 text-red-600' :
                                days <= 30 ? 'bg-orange-50 text-orange-600' :
                                    days <= 60 ? 'bg-amber-50 text-amber-600' :
                                        'bg-blue-50 text-blue-600'
                                }`}>
                                {days < 0 ? `เลยกำหนด ${Math.abs(days)} วัน` : days === 0 ? 'หมดวันนี้!' : `เหลืออีก ${days} วัน`}
                            </span>
                        </div>

                        {intention?.note && (
                            <div className="mt-3 text-sm text-slate-600 bg-slate-50/80 rounded-xl px-4 py-2.5 border border-slate-100 relative before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-slate-300 before:rounded-r-md">
                                <span className="mr-1.5">📝</span> {intention.note}
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom row: action buttons */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100 mt-1">
                    {userCanEdit ? (
                        <>
                            {(['pending', 'renew', 'not_renew'] as Intention[]).map((action) => {
                                const isCurrent = currentIntention === action;
                                const actionCfg = intentionConfig[action];

                                let activeClasses = "";
                                if (isCurrent) {
                                    if (action === 'pending') activeClasses = "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200";
                                    if (action === 'renew') activeClasses = "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-200";
                                    if (action === 'not_renew') activeClasses = "bg-red-500 text-white border-red-500 shadow-md shadow-red-200";
                                } else {
                                    activeClasses = `bg-white text-slate-500 border-slate-200 ${actionCfg.btnHover}`;
                                }

                                return (
                                    <button
                                        key={action}
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => {
                                            if (!isCurrent) {
                                                setConfirmModal({
                                                    contractId: contract.id,
                                                    roomId: contract.main_room_id,
                                                    tenantName: contract.tenant_name,
                                                    intention: action
                                                });
                                            }
                                        }}
                                        className={`flex-1 min-w-[105px] px-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-200 ${activeClasses} disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {actionCfg.icon} {actionCfg.label}
                                    </button>
                                );
                            })}

                            <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => {
                                    setNoteModal({ contractId: contract.id, roomId: contract.main_room_id, tenantName: contract.tenant_name, currentNote: intention?.note || '' });
                                    setNoteInput(intention?.note || '');
                                }}
                                className="px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all duration-200 disabled:opacity-50"
                                title="เพิ่มหมายเหตุ"
                            >
                                📝 หมายเหตุ
                            </button>
                        </>
                    ) : (
                        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                            {cfg.icon} {cfg.label}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderGroup = (title: string, icon: string, color: string, list: any[]) => {
        if (list.length === 0) return null;
        return (
            <div className="mb-10">
                <div className={`flex items-center gap-3 mb-5`}>
                    <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center text-lg">
                        {icon}
                    </div>
                    <h2 className={`text-lg font-bold ${color}`}>{title}</h2>
                    <span className="text-xs text-slate-500 font-semibold bg-white border border-slate-200 px-2.5 py-1 rounded-full shadow-sm">
                        {list.length} รายการ
                    </span>
                </div>
                <div className="flex flex-col gap-4">
                    {list.map((c, idx) => renderContractCard(c, idx + 1))}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-full flex flex-col bg-transparent">
            <div className="flex-1 p-8 md:p-10 max-w-7xl mx-auto w-full">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-8">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white rounded-2xl p-2 shrink-0 border border-slate-100 shadow-sm">
                        <span className="text-sm font-bold text-slate-600 px-2">แสดงสัญญาที่หมดภายใน:</span>
                        <select
                            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 cursor-pointer transition-all"
                            value={monthsAhead}
                            onChange={e => setMonthsAhead(Number(e.target.value))}
                        >
                            <option value={1}>1 เดือน</option>
                            <option value={2}>2 เดือน</option>
                            <option value={3}>3 เดือน</option>
                            <option value={4}>4 เดือน</option>
                            <option value={6}>6 เดือน</option>
                        </select>
                    </div>

                {/* Intention Filter */}
                <div className="flex flex-wrap gap-2 bg-white rounded-2xl p-2 border border-slate-100 shadow-sm">
                    {[
                        { value: 'all' as const, label: 'ทั้งหมด', icon: '📋' },
                        { value: 'pending' as const, label: 'รอตอบกลับ', icon: '⏳' },
                        { value: 'renew' as const, label: 'ต่อสัญญา', icon: '✅' },
                        { value: 'not_renew' as const, label: 'ไม่ต่อสัญญา', icon: '🚪' },
                    ].map(filter => {
                        const isActive = intentionFilter === filter.value;
                        return (
                            <button
                                key={filter.value}
                                type="button"
                                onClick={() => setIntentionFilter(filter.value)}
                                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                                    isActive
                                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 border-2 border-blue-600'
                                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-blue-400 hover:text-blue-600'
                                }`}
                            >
                                {filter.icon} {filter.label}
                            </button>
                        );
                    })}
                </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
                    {[
                        { label: 'ใกล้หมดทั้งหมด', value: stats.total, icon: '📋', iconBg: 'bg-slate-100 text-slate-600' },
                        { label: 'รอตอบกลับ', value: stats.pending, icon: '⏳', iconBg: 'bg-amber-100 text-amber-600' },
                        { label: 'ต่อสัญญา', value: stats.renew, icon: '✅', iconBg: 'bg-emerald-100 text-emerald-600' },
                        { label: 'ไม่ต่อสัญญา', value: stats.notRenew, icon: '🚪', iconBg: 'bg-red-100 text-red-600' },
                    ].map(s => (
                        <div key={s.label} className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5 transition-transform hover:-translate-y-1 duration-300">
                            <div className={`w-14 h-14 rounded-2xl ${s.iconBg} flex items-center justify-center text-2xl shrink-0 shadow-sm`}>{s.icon}</div>
                            <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{s.label}</p>
                                <p className="text-2xl font-bold text-[#0A2647]">{s.value} <span className="text-xs font-medium text-slate-500">รายการ</span></p>
                            </div>
                        </div>
                    ))}
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center p-32 space-y-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-t-blue-600"></div>
                        <p className="text-slate-400 font-medium animate-pulse">กำลังโหลดข้อมูล...</p>
                    </div>
                ) : expiringContracts.length === 0 ? (
                    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-20 text-center flex flex-col items-center">
                        <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center text-5xl mb-6">🎉</div>
                        <p className="font-extrabold text-2xl text-slate-800">ไม่มีสัญญาที่ใกล้หมดในช่วงนี้</p>
                        <p className="text-slate-500 mt-2">ลองเปลี่ยนช่วงเวลาค้นหาด้านบน เพื่อดูสัญญาในอนาคต</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {renderGroup('เลยกำหนด (Overdue)', '🔴', 'text-red-600', grouped.overdue)}
                        {renderGroup('ด่วน — หมดภายใน 30 วัน', '🟠', 'text-orange-600', grouped.urgent)}
                        {renderGroup('เร็วๆ นี้ — หมดภายใน 60 วัน', '🟡', 'text-amber-600', grouped.soon)}
                        {renderGroup('กำลังจะหมด — เกิน 60 วัน', '🔵', 'text-blue-600', grouped.upcoming)}
                    </div>
                )}
            </div>

            {/* Confirm Modal */}
            {confirmModal && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden scale-in-95 duration-200">
                        <div className="p-8 text-center">
                            <div className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center text-4xl mb-5 ${intentionConfig[confirmModal.intention].bg}`}>
                                {intentionConfig[confirmModal.intention].icon}
                            </div>
                            <h2 className="text-xl font-bold text-slate-800 mb-2">ยืนยันการเปลี่ยนสถานะ</h2>
                            <p className="text-slate-500 text-sm leading-relaxed">
                                คุณต้องการเปลี่ยนสถานะของห้อง <br />
                                <span className="font-bold text-slate-700">{confirmModal.tenantName}</span> <br />
                                เป็น <span className={`font-bold ${intentionConfig[confirmModal.intention].color}`}>"{intentionConfig[confirmModal.intention].label}"</span> ใช่หรือไม่?
                            </p>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                            <button
                                type="button"
                                onClick={() => setConfirmModal(null)}
                                className="flex-1 px-4 py-3 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="button"
                                onClick={() => upsertIntention(confirmModal.contractId, confirmModal.roomId, confirmModal.tenantName, confirmModal.intention)}
                                className={`flex-1 px-4 py-3 text-sm font-bold text-white rounded-xl shadow-lg transition-colors ${confirmModal.intention === 'renew' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/30' :
                                    confirmModal.intention === 'not_renew' ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30' :
                                        'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30'
                                    }`}
                            >
                                ยืนยัน
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Note Modal */}
            {noteModal && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">เพิ่มหมายเหตุ</h2>
                                <p className="text-sm font-medium text-slate-500 mt-0.5">{noteModal.tenantName}</p>
                            </div>
                            <button
                                onClick={() => setNoteModal(null)}
                                className="text-slate-400 hover:text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 w-9 h-9 rounded-full flex items-center justify-center transition-colors shadow-sm"
                            >✕</button>
                        </div>
                        <div className="p-8 space-y-6">
                            <textarea
                                rows={4}
                                className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-800 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none transition-all resize-none"
                                placeholder="เช่น ลูกบ้านบอกว่าจะตัดสินใจอีกครั้งปลายเดือน..."
                                value={noteInput}
                                onChange={e => setNoteInput(e.target.value)}
                            />
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setNoteModal(null)}
                                    className="flex-1 px-5 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                                >ยกเลิก</button>
                                <button
                                    type="button"
                                    onClick={handleSaveNote}
                                    className="flex-1 px-5 py-3.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-600/30 transition-all"
                                >บันทึกหมายเหตุ</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}