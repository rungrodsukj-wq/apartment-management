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

type Intention = 'pending' | 'not_asked' | 'renew' | 'renew_no_room' | 'not_renew';

export default function RenewalCheckPage() {
    const router = useRouter();
    const { profile } = useAuth();
    const userCanEdit = canEditPage(profile, 'renewal_check');
    const [contracts, setContracts] = useState<any[]>([]);
    const [rooms, setRooms] = useState<any[]>([]);
    const [intentions, setIntentions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    // Month filter: how many months ahead to look ('all' for no upper bound)
    const [monthsAhead, setMonthsAhead] = useState('3');
    // View mode: group by month or sort by room
    const [viewMode, setViewMode] = useState<'byMonth' | 'byRoom'>('byMonth');

    // Search filter: room number or tenant name
    const [searchQuery, setSearchQuery] = useState('');

    // Intention filter: filter by renewal intention status
    const [intentionFilter, setIntentionFilter] = useState<Intention | 'all'>('all');

    // Modals state
    const [noteModal, setNoteModal] = useState<{ contractId: string; roomId: string; tenantName: string; currentNote: string } | null>(null);
    const [noteInput, setNoteInput] = useState('');

    // Move out date edit modal state
    const [editMoveOutDateModal, setEditMoveOutDateModal] = useState<{ contractId: string; currentMoveOutDate: string; maxDate: string } | null>(null);
    const [editMoveOutDate, setEditMoveOutDate] = useState('');
    const [editMoveOutDateError, setEditMoveOutDateError] = useState<string | null>(null);

    // Confirmation Modal state
    const [confirmModal, setConfirmModal] = useState<{
        contractId: string;
        roomId: string;
        tenantName: string;
        intention: Intention;
    } | null>(null);
    const [notRenewMoveOutDate, setNotRenewMoveOutDate] = useState('');
    const [notRenewDateError, setNotRenewDateError] = useState<string | null>(null);

    const getContractById = (contractId: string) => contracts.find(c => c.id === contractId);
    const isMoveOutDateValid = (date: string, maxDate: string) => {
        if (!date || !maxDate) return false;
        const parsed = new Date(date);
        const max = new Date(maxDate);
        parsed.setHours(0, 0, 0, 0);
        max.setHours(0, 0, 0, 0);
        return parsed.getTime() <= max.getTime();
    };

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

        if (cData && iData) {
            const existingContractIds = new Set(iData.map((item: any) => item.contract_id));
            const missingContracts = cData.filter((contract: any) => contract.id && !existingContractIds.has(contract.id));
            if (missingContracts.length > 0) {
                const today = new Date();
                const surveyMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
                const inserts = missingContracts.map((contract: any) => ({
                    contract_id: contract.id,
                    room_id: contract.main_room_id || contract.temp_room_id || contract.move_to_room_id || null,
                    tenant_name: contract.tenant_name || '',
                    intention: 'not_asked',
                    survey_month: surveyMonth,
                    note: '',
                }));
                const { error: insertError } = await supabase.from('renewal_intentions').insert(inserts);
                if (insertError) {
                    console.warn('Failed to backfill renewal intentions', insertError.message);
                } else {
                    const { data: refreshed } = await supabase.from('renewal_intentions').select('*');
                    if (refreshed) setIntentions(refreshed);
                }
            }
        }

        setLoading(false);
    }

    const getRoom = (roomId: string) => rooms.find(r => r.id === roomId);

    const getIntention = (contractId: string): any | null => {
        return intentions.find(i => i.contract_id === contractId) || null;
    };

    // Filter contracts that expire within X months (or all upcoming if 'all')
    const expiringContracts = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const monthsAheadNum = monthsAhead === 'all' ? null : Number(monthsAhead);
        const cutoff = monthsAheadNum !== null ? new Date(today) : null;
        if (cutoff && monthsAheadNum !== null) cutoff.setMonth(cutoff.getMonth() + monthsAheadNum);

        return contracts
            .filter(c => {
                if (!c.contract_end_date) return false;
                const end = new Date(c.contract_end_date);
                end.setHours(0, 0, 0, 0);
                if (monthsAheadNum === null) {
                    // 'all' -> include any contract that ends on/after today
                    return end >= today;
                }
                return end >= today && end <= (cutoff as Date);
            })
            .filter(c => {
                // Apply intention filter
                if (intentionFilter === 'all') return true;
                const intention = getIntention(c.id)?.intention || 'not_asked';
                return intention === intentionFilter;
            })
            .filter(c => {
                const query = searchQuery.trim().toLowerCase();
                if (!query) return true;
                const roomNumber = String(getRoom(c.main_room_id)?.room_number ?? '').toLowerCase();
                const tenantName = String(c.tenant_name ?? '').toLowerCase();
                return roomNumber.includes(query) || tenantName.includes(query);
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
    }, [contracts, monthsAhead, rooms, intentions, intentionFilter, searchQuery]);

    const deleteRenewalChildContracts = async (parentContractId: string) => {
        const { data: childContracts, error: fetchError } = await supabase
            .from('contracts')
            .select('id')
            .eq('parent_contract_id', parentContractId);
        if (fetchError) {
            alert('เกิดข้อผิดพลาดเมื่อค้นหาสัญญาต่ออายุเพื่อจะลบ: ' + fetchError.message);
            return false;
        }
        if (!childContracts || childContracts.length === 0) return true;

        const childIds = childContracts.map((c: any) => c.id);
        const { error: deleteError } = await supabase
            .from('contracts')
            .delete()
            .in('id', childIds);
        if (deleteError) {
            alert('เกิดข้อผิดพลาดเมื่อพยายามลบสัญญาต่ออายุที่สร้างไว้: ' + deleteError.message);
            return false;
        }

        for (const child of childContracts) {
            if (child?.id) {
                await logAudit(profile, 'contracts', 'delete', child.id, 'ลบสัญญาต่ออายุที่สร้างไว้เมื่อเปลี่ยนความตั้งใจ', null);
            }
        }
        return true;
    };

    const deleteRenewalWaitlists = async (contractId: string) => {
        const { error } = await supabase
            .from('waitlists')
            .delete()
            .eq('contract_id', contractId);
        if (error) {
            alert('เกิดข้อผิดพลาดเมื่อพยายามลบ waitlist ที่สร้างจาก renewal_no_room: ' + error.message);
            return false;
        }
        return true;
    };

    const upsertIntention = async (contractId: string, roomId: string, tenantName: string, intention: Intention, note?: string, plannedMoveOutDate?: string) => {
        setSaving(contractId);

        if (intention === 'not_renew' && plannedMoveOutDate) {
            const contract = getContractById(contractId);
            if (contract) {
                const fieldToUpdate = contract.move_end_date ? 'move_end_date' : 'main_end_date';
                const contractUpdate: Record<string, string> = { [fieldToUpdate]: plannedMoveOutDate };
                const { error: contractError } = await supabase
                    .from('contracts')
                    .update(contractUpdate)
                    .eq('id', contractId);
                if (contractError) {
                    alert('เกิดข้อผิดพลาดเมื่อบันทึกวันที่คาดว่าจะย้ายออก: ' + contractError.message);
                    setSaving(null);
                    return;
                }
                await logAudit(profile, 'contracts', 'update', contractId, 'ปรับวันที่คาดว่าจะย้ายออก', describeChanges(contractUpdate));
            }
        }

        const existing = getIntention(contractId);
        const shouldRemoveCreatedRenewalContract = existing &&
            (existing.intention === 'renew' || existing.intention === 'renew_no_room') &&
            (intention !== 'renew' && intention !== 'renew_no_room');

        if (shouldRemoveCreatedRenewalContract) {
            if (existing.intention === 'renew_no_room') {
                const deletedWaitlist = await deleteRenewalWaitlists(contractId);
                if (!deletedWaitlist) {
                    setSaving(null);
                    return;
                }
            }

            const deletedContract = await deleteRenewalChildContracts(contractId);
            if (!deletedContract) {
                setSaving(null);
                return;
            }
        }

        if (existing) {
            const updatePayload = { intention, note: note ?? existing.note, updated_at: new Date().toISOString() };
            const { error } = await supabase
                .from('renewal_intentions')
                .update(updatePayload)
                .eq('id', existing.id);
            if (error) {
                alert('เกิดข้อผิดพลาด: ' + error.message);
                setSaving(null);
                return;
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
                setSaving(null);
                return;
            } else {
                const newId = data?.[0]?.id ?? null;
                if (newId) await logAudit(profile, 'renewal_intentions', 'create', newId, 'เพิ่มความตั้งใจต่อสัญญา', payload);
            }
        }

        await fetchData();
        setSaving(null);
        setConfirmModal(null); // ปิด popup หลังบันทึกสำเร็จ

        // NOTE: navigation for renew / renew_no_room is handled by the caller
        // (we don't navigate here so that status changes only after a new
        // contract is actually created elsewhere in the app)
    };

    const handleSaveNote = async () => {
        if (!noteModal) return;
        const existing = getIntention(noteModal.contractId);
        await upsertIntention(
            noteModal.contractId,
            noteModal.roomId,
            noteModal.tenantName,
            existing?.intention || 'not_asked',
            noteInput
        );
        setNoteModal(null);
    };

    const handleSaveMoveOutDate = async () => {
        if (!editMoveOutDateModal) return;
        const contract = getContractById(editMoveOutDateModal.contractId);
        if (!contract) return;

        const fieldToUpdate = contract.move_end_date ? 'move_end_date' : 'main_end_date';
        const contractUpdate: Record<string, string> = { [fieldToUpdate]: editMoveOutDate };
        const { error: contractError } = await supabase
            .from('contracts')
            .update(contractUpdate)
            .eq('id', editMoveOutDateModal.contractId);
        if (contractError) {
            setEditMoveOutDateError('เกิดข้อผิดพลาดในการบันทึก: ' + contractError.message);
            return;
        }
        await logAudit(profile, 'contracts', 'update', editMoveOutDateModal.contractId, 'แก้ไขวันที่คาดว่าจะย้ายออก', describeChanges(contractUpdate));
        await fetchData();
        setEditMoveOutDateModal(null);
        setEditMoveOutDate('');
        setEditMoveOutDateError(null);
    };

    const intentionConfig: Record<Intention, { label: string; color: string; bg: string; border: string; icon: (props?: { className?: string }) => React.ReactNode; btnHover: string }> = {
        pending: { 
            label: 'รอตอบกลับ', 
            color: 'text-amber-700', 
            bg: 'bg-amber-50', 
            border: 'border-amber-300', 
            icon: (props) => (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={props?.className}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
            ), 
            btnHover: 'hover:bg-amber-500 hover:text-white hover:border-amber-500' 
        },
        not_asked: { 
            label: 'ยังไม่สอบถาม', 
            color: 'text-slate-700', 
            bg: 'bg-slate-50', 
            border: 'border-slate-300', 
            icon: (props) => (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={props?.className}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                </svg>
            ), 
            btnHover: 'hover:bg-slate-500 hover:text-white hover:border-slate-500' 
        },
        renew: { 
            label: 'ต่อสัญญาห้องเดิม', 
            color: 'text-emerald-700', 
            bg: 'bg-emerald-50', 
            border: 'border-emerald-300', 
            icon: (props) => (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={props?.className}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
            ), 
            btnHover: 'hover:bg-emerald-500 hover:text-white hover:border-emerald-500' 
        },
        renew_no_room: { 
            label: 'ต่อสัญญาไม่ระบุห้อง', 
            color: 'text-sky-700', 
            bg: 'bg-sky-50', 
            border: 'border-sky-300', 
            icon: (props) => (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={props?.className}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
            ), 
            btnHover: 'hover:bg-sky-500 hover:text-white hover:border-sky-500' 
        },
        not_renew: { 
            label: 'ไม่ต่อสัญญา', 
            color: 'text-red-700', 
            bg: 'bg-red-50', 
            border: 'border-red-300', 
            icon: (props) => (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={props?.className}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
                </svg>
            ), 
            btnHover: 'hover:bg-red-500 hover:text-white hover:border-red-500' 
        },
    };

    const stats = useMemo(() => {
        const pending = expiringContracts.filter(c => getIntention(c.id)?.intention === 'pending').length;

        // เริ่มต้นเป็น not_asked หากยังไม่มี record
        const notAsked = expiringContracts.filter(c => {
            const intention = getIntention(c.id)?.intention || 'not_asked';
            return intention === 'not_asked';
        }).length;

        const renew = expiringContracts.filter(c => {
            const intention = getIntention(c.id)?.intention;
            return intention === 'renew' || intention === 'renew_no_room';
        }).length;
        
        const notRenew = expiringContracts.filter(c => getIntention(c.id)?.intention === 'not_renew').length;
        
        // อย่าลืมส่งคืนค่า notAsked ออกไปด้วย
        return { pending, notAsked, renew, notRenew, total: expiringContracts.length };
    }, [expiringContracts, intentions]);

    const grouped = useMemo(() => {
        const overdue = expiringContracts.filter(c => getDaysUntil(c.contract_end_date) < 0);
        const urgent = expiringContracts.filter(c => { const d = getDaysUntil(c.contract_end_date); return d >= 0 && d <= 30; });
        const soon = expiringContracts.filter(c => { const d = getDaysUntil(c.contract_end_date); return d > 30 && d <= 60; });
        const upcoming = expiringContracts.filter(c => getDaysUntil(c.contract_end_date) > 60);
        return { overdue, urgent, soon, upcoming };
    }, [expiringContracts]);

    const monthBuckets = useMemo(() => {
        const map: Record<string, any[]> = {};
        expiringContracts.forEach(c => {
            const d = new Date(c.contract_end_date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!map[key]) map[key] = [];
            map[key].push(c);
        });
        // sort keys ascending
        const keys = Object.keys(map).sort();
        return keys.map(k => ({ key: k, items: map[k] }));
    }, [expiringContracts]);

    const renderContractCard = (contract: any, index: number) => {
        const room = getRoom(contract.main_room_id);
        const intention = getIntention(contract.id);
        const currentIntention: Intention = intention?.intention || 'not_asked';
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
                className={`bg-white rounded-2xl border border-slate-100 border-l-[6px] ${urgencyColor} shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 p-4 flex flex-col gap-3`}
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
                                {cfg.icon({ className: 'w-3.5 h-3.5 shrink-0' })} {cfg.label}
                            </span>
                            {isSaving && (
                                <span className="text-[11px] font-medium text-slate-400 animate-pulse bg-slate-100 px-2 py-1 rounded-full">
                                    กำลังบันทึก...
                                </span>
                            )}
                            {currentIntention === 'not_renew' && (contract.move_end_date || contract.main_end_date) && (
                                <span className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full border border-red-200">
                                    ย้ายออก: {formatDateTH(contract.move_end_date || contract.main_end_date)}
                                </span>
                            )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                            {room && (
                                <span className="flex items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 opacity-70">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75H21m-3.75 3.75H21" />
                                    </svg>
                                    {room.room_type || '-'} · {room.kitchen_type || '-'} · ชั้น {room.floor || '-'}
                                </span>
                            )}
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                            <span className="flex items-center gap-1.5">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 opacity-70">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
                                </svg>
                                {formatDateTH(contract.contract_start_date)} → {formatDateTH(contract.contract_end_date)}
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
                            <div className="mt-3 text-sm text-slate-600 bg-slate-50/80 rounded-xl px-4 py-2.5 border border-slate-100 relative before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-slate-300 before:rounded-r-md flex items-start gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 mt-0.5 text-slate-400 shrink-0">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                </svg>
                                <span>{intention.note}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom row: action buttons */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100 mt-1">
                    {userCanEdit ? (
                        <>
                            {(['not_asked', 'pending', 'renew', 'renew_no_room', 'not_renew'] as Intention[]).map((action) => {
                                const isCurrent = currentIntention === action;
                                const actionCfg = intentionConfig[action];

                                let activeClasses = "";
                                if (isCurrent) {
                                    if (action === 'pending' || action === 'not_asked') activeClasses = "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200";
                                    if (action === 'renew') activeClasses = "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-200";
                                    if (action === 'renew_no_room') activeClasses = "bg-sky-500 text-white border-sky-500 shadow-md shadow-sky-200";
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
                                                if (action === 'not_renew') {
                                                    setNotRenewMoveOutDate(contract.move_end_date || contract.main_end_date || contract.contract_end_date || '');
                                                    setNotRenewDateError(null);
                                                }
                                            }
                                        }}
                                        className={`inline-flex items-center justify-center gap-1.5 flex-1 min-w-[105px] px-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-200 ${activeClasses} disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {actionCfg.icon({ className: 'w-4 h-4 shrink-0' })}
                                        <span>{actionCfg.label}</span>
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
                                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all duration-200 disabled:opacity-50"
                                title="เพิ่มหมายเหตุ"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                </svg>
                                <span>หมายเหตุ</span>
                            </button>

                            {currentIntention === 'not_renew' && (
                                <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => {
                                        const maxDate = contract.contract_end_date || '';
                                        setEditMoveOutDateModal({
                                            contractId: contract.id,
                                            currentMoveOutDate: contract.move_end_date || contract.main_end_date || '',
                                            maxDate
                                        });
                                        setEditMoveOutDate(contract.move_end_date || contract.main_end_date || '');
                                        setEditMoveOutDateError(null);
                                    }}
                                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-red-200 text-red-500 hover:border-red-400 hover:text-red-600 hover:bg-red-50 transition-all duration-200 disabled:opacity-50"
                                    title="แก้ไขวันที่ย้ายออก"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                                    </svg>
                                    <span>แก้ไขวันที่ย้าย</span>
                                </button>
                            )}
                        </>
                    ) : (
                        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                            {cfg.icon({ className: 'w-3.5 h-3.5 shrink-0' })} {cfg.label}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderGroup = (title: string, icon: React.ReactNode, color: string, list: any[]) => {
        if (list.length === 0) return null;
        return (
            <div className="mb-10">
                <div className={`flex items-center gap-3 mb-5`}>
                    <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center">
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
                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 md:gap-6 mb-8">
                    {[
                        { 
                            label: 'ใกล้หมดทั้งหมด', 
                            value: stats.total, 
                            icon: (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.03 0 1.9.693 2.166 1.638m-7.377 0A48.536 48.536 0 0 1 12 3m0 0c-1.135 0-2.098.845-2.192 1.976a48.414 48.414 0 0 0-.123 1.829V16.5A2.25 2.25 0 0 0 12 18.75h.75m-3-15h.008v.008H9.75v-.008Zm0 3h.008v.008H9.75V6.75Z" />
                                </svg>
                            ), 
                            iconBg: 'bg-slate-100 text-slate-600' 
                        },
                        // 👇 เพิ่มบรรทัดนี้เข้าไป
                        { label: 'ยังไม่สอบถาม', value: stats.notAsked, icon: intentionConfig.not_asked.icon({ className: 'w-6 h-6' }), iconBg: 'bg-slate-100 text-slate-700' },
                        { label: 'รอตอบกลับ', value: stats.pending, icon: intentionConfig.pending.icon({ className: 'w-6 h-6' }), iconBg: 'bg-amber-100 text-amber-600' },
                        { label: 'ต่อสัญญา', value: stats.renew, icon: intentionConfig.renew.icon({ className: 'w-6 h-6' }), iconBg: 'bg-emerald-100 text-emerald-600' },
                        { label: 'ไม่ต่อสัญญา', value: stats.notRenew, icon: intentionConfig.not_renew.icon({ className: 'w-6 h-6' }), iconBg: 'bg-red-100 text-red-600' },
                    ].map(s => (
                        <div key={s.label} className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5 transition-transform hover:-translate-y-1 duration-300">
                            <div className={`w-14 h-14 rounded-2xl ${s.iconBg} flex items-center justify-center shrink-0 shadow-sm`}>{s.icon}</div>
                            <div>
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{s.label}</p>
                                <p className="text-2xl font-bold text-[#0A2647]">{s.value} <span className="text-xs font-medium text-slate-500">รายการ</span></p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Header Filters */}
                <div className="grid gap-3 lg:grid-cols-[minmax(260px,420px)_1fr] mb-4">
                    <div className="flex flex-wrap items-center gap-2 bg-white rounded-2xl p-2 border border-slate-100 shadow-sm">
                        <span className="text-sm font-semibold text-slate-600 px-2">แสดงสัญญาที่หมดภายใน:</span>
                            <select
                                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-[#4F81FF]/30 cursor-pointer transition-all"
                                value={monthsAhead}
                                onChange={e => setMonthsAhead(e.target.value)}
                            >
                                <option value="1">1 เดือน</option>
                                <option value="2">2 เดือน</option>
                                <option value="3">3 เดือน</option>
                                <option value="4">4 เดือน</option>
                                <option value="6">6 เดือน</option>
                                <option value="all">ทั้งหมด</option>
                            </select>
                    </div>

                    <div className="flex items-center gap-2 bg-white rounded-2xl p-2 border border-slate-100 shadow-sm">
                        <span className="text-sm font-semibold text-slate-600 pl-2">ค้นหา</span>
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="ค้นหาห้องหรือชื่อผู้เช่า"
                            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                        />
                    </div>
                </div>

                {/* Intention Filter */}
                <div className="flex flex-wrap gap-2 bg-white rounded-2xl p-2 border border-slate-100 shadow-sm">
                    {[
                        { 
                            value: 'all' as const, 
                            label: 'ทั้งหมด', 
                            icon: (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.03 0 1.9.693 2.166 1.638m-7.377 0A48.536 48.536 0 0 1 12 3m0 0c-1.135 0-2.098.845-2.192 1.976a48.414 48.414 0 0 0-.123 1.829V16.5A2.25 2.25 0 0 0 12 18.75h.75m-3-15h.008v.008H9.75v-.008Zm0 3h.008v.008H9.75V6.75Z" />
                                </svg>
                            ) 
                        },
                        { value: 'not_asked' as const, label: 'ยังไม่สอบถาม', icon: intentionConfig.not_asked.icon({ className: 'w-4 h-4' }) },
                        { value: 'pending' as const, label: 'รอตอบกลับ', icon: intentionConfig.pending.icon({ className: 'w-4 h-4' }) },
                        { value: 'renew' as const, label: 'ต่อสัญญาห้องเดิม', icon: intentionConfig.renew.icon({ className: 'w-4 h-4' }) },
                        { value: 'renew_no_room' as const, label: 'ต่อสัญญาไม่ระบุห้อง', icon: intentionConfig.renew_no_room.icon({ className: 'w-4 h-4' }) },
                        { value: 'not_renew' as const, label: 'ไม่ต่อสัญญา', icon: intentionConfig.not_renew.icon({ className: 'w-4 h-4' }) },
                    ].map(filter => {
                        const isActive = intentionFilter === filter.value;
                        return (
                            <button
                                key={filter.value}
                                type="button"
                                onClick={() => setIntentionFilter(filter.value)}
                                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                                    isActive
                                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 border-2 border-blue-600'
                                        : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-blue-400 hover:text-blue-600'
                                }`}
                            >
                                {filter.icon}
                                <span>{filter.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Main Content Area */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-slate-600 px-2">มุมมอง:</span>
                        <button
                            type="button"
                            onClick={() => setViewMode('byMonth')}
                            className={`px-3 py-2 rounded-xl text-sm font-semibold ${viewMode === 'byMonth' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                        >แยกเดือน</button>
                        <button
                            type="button"
                            onClick={() => setViewMode('byRoom')}
                            className={`px-3 py-2 rounded-xl text-sm font-semibold ${viewMode === 'byRoom' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                        >เรียงตามห้อง</button>
                    </div>
                    <div className="text-sm text-slate-500">แสดง {expiringContracts.length} รายการ</div>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center p-33 space-y-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-t-blue-600"></div>
                        <p className="text-slate-400 font-medium animate-pulse">กำลังโหลดข้อมูล...</p>
                    </div>
                ) : expiringContracts.length === 0 ? (
                    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-20 text-center flex flex-col items-center">
                        <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 mb-6">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 21l-.813-5.096L3 15l5.096-.813L9 9l.813 5.187L15 15l-5.187.904ZM18.063 5.25l-.563 3.5-3.5.563 3.5.562.563 3.5 3.5-3.5.562-.563-3.5-.563-.562-3.5Zm-11.25 1.5-.313 2.125-2.125.313 2.125.312.313 2.125 2.125-2.125.312-.313-2.125-.313-.312-2.125Z" />
                            </svg>
                        </div>
                        <p className="font-extrabold text-2xl text-slate-800">ไม่มีสัญญาที่ใกล้หมดในช่วงนี้</p>
                        <p className="text-slate-500 mt-2">ลองเปลี่ยนช่วงเวลาค้นหาด้านบน เพื่อดูสัญญาในอนาคต</p>
                    </div>
                ) : (
                    viewMode === 'byRoom' ? (
                        <div className="space-y-2">
                            {expiringContracts.map((c, idx) => renderContractCard(c, idx + 1))}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {monthBuckets.map((b) => {
                                const [year, month] = b.key.split('-');
                                const monthLabel = new Date(Number(year), Number(month) - 1, 1).toLocaleString('th-TH', { year: 'numeric', month: 'short' });
                                return (
                                    <div key={b.key} className="mb-8">
                                        <div className={`flex items-center gap-3 mb-4`}>
                                            <h2 className={`text-lg font-bold text-slate-800`}>{monthLabel}</h2>
                                            <span className="text-xs text-slate-500 font-semibold bg-white border border-slate-200 px-2.5 py-1 rounded-full shadow-sm">{b.items.length} รายการ</span>
                                        </div>
                                        <div className="flex flex-col gap-4">
                                            {b.items.map((c, idx) => renderContractCard(c, idx + 1))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}
            </div>

            {/* Confirm Modal */}
            {confirmModal && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden scale-in-95 duration-200">
                        <div className="p-8 text-center">
                            <div className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-5 ${intentionConfig[confirmModal.intention].bg} ${intentionConfig[confirmModal.intention].color}`}>
                                {intentionConfig[confirmModal.intention].icon({ className: 'w-10 h-10' })}
                            </div>
                            <h2 className="text-xl font-bold text-slate-800 mb-2">ยืนยันการเปลี่ยนสถานะ</h2>
                            <p className="text-slate-500 text-sm leading-relaxed">
                                คุณต้องการเปลี่ยนสถานะของห้อง <br />
                                <span className="font-bold text-slate-700">{confirmModal.tenantName}</span> <br />
                                เป็น <span className={`font-bold ${intentionConfig[confirmModal.intention].color}`}>"{intentionConfig[confirmModal.intention].label}"</span> ใช่หรือไม่?
                            </p>
                        </div>
                        {confirmModal.intention === 'not_renew' && (
                            <div className="px-8 pb-4 pt-2">
                                <label className="block text-left text-sm font-semibold text-slate-700 mb-2">วันที่คาดว่าจะย้ายออก</label>
                                <input
                                    type="date"
                                    value={notRenewMoveOutDate}
                                    onChange={(e) => {
                                        setNotRenewMoveOutDate(e.target.value);
                                        setNotRenewDateError(null);
                                    }}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200"
                                    min="2000-01-01"
                                />
                                <p className="mt-2 text-xs text-slate-500">
                                    วันที่ต้องไม่เกินวันที่สัญญาสิ้นสุด ({formatDateTH(getContractById(confirmModal.contractId)?.contract_end_date || getContractById(confirmModal.contractId)?.main_end_date || getContractById(confirmModal.contractId)?.move_end_date || '')})
                                </p>
                                {notRenewDateError && (
                                    <p className="mt-2 text-xs text-red-600 font-semibold">{notRenewDateError}</p>
                                )}
                            </div>
                        )}
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setConfirmModal(null);
                                    setNotRenewDateError(null);
                                }}
                                className="flex-1 px-4 py-3 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!confirmModal) return;
                                    // For renew actions, navigate to the creation flow but
                                    // do NOT change the intention here — the status should
                                    // be updated only after a new contract is created.
                                    if (confirmModal.intention === 'renew') {
                                        const cid = confirmModal.contractId;
                                        setConfirmModal(null);
                                        router.push(`/bookings?renewContractId=${cid}`);
                                        return;
                                    }
                                    if (confirmModal.intention === 'renew_no_room') {
                                        const tenant = confirmModal.tenantName;
                                        const cid = confirmModal.contractId;
                                        setConfirmModal(null);
                                        router.push(`/waitlists?quickAction=newWaitlist&tenantName=${encodeURIComponent(tenant)}&contractId=${cid}`);
                                        return;
                                    }

                                    if (confirmModal.intention === 'not_renew') {
                                        const contract = getContractById(confirmModal.contractId);
                                        const maxDate = contract?.contract_end_date || contract?.main_end_date || contract?.move_end_date || '';
                                        if (!notRenewMoveOutDate) {
                                            setNotRenewDateError('กรุณาระบุวันที่คาดว่าจะย้ายออก');
                                            return;
                                        }
                                        if (!isMoveOutDateValid(notRenewMoveOutDate, maxDate)) {
                                            setNotRenewDateError('วันที่ต้องไม่เกินวันที่สัญญาสิ้นสุด');
                                            return;
                                        }
                                        upsertIntention(confirmModal.contractId, confirmModal.roomId, confirmModal.tenantName, confirmModal.intention, undefined, notRenewMoveOutDate);
                                        return;
                                    }

                                    // Other intentions: upsert immediately
                                    upsertIntention(confirmModal.contractId, confirmModal.roomId, confirmModal.tenantName, confirmModal.intention);
                                }}
                                className={`flex-1 px-4 py-3 text-sm font-bold text-white rounded-xl shadow-lg transition-colors ${confirmModal.intention === 'renew' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/30' :
                                    confirmModal.intention === 'renew_no_room' ? 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/30' :
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

            {/* Edit Move Out Date Modal */}
            {editMoveOutDateModal && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-red-50/50">
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">แก้ไขวันที่ย้ายออก</h2>
                                <p className="text-sm font-medium text-slate-500 mt-0.5">วันที่ออกจากห้อง</p>
                            </div>
                            <button
                                onClick={() => {
                                    setEditMoveOutDateModal(null);
                                    setEditMoveOutDate('');
                                    setEditMoveOutDateError(null);
                                }}
                                className="text-slate-400 hover:text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 w-9 h-9 rounded-full flex items-center justify-center transition-colors shadow-sm"
                            >✕</button>
                        </div>
                        <div className="p-8 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">วันที่คาดว่าจะย้ายออก</label>
                                <input
                                    type="date"
                                    value={editMoveOutDate}
                                    onChange={(e) => {
                                        setEditMoveOutDate(e.target.value);
                                        setEditMoveOutDateError(null);
                                    }}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200"
                                    min="2000-01-01"
                                />
                                <p className="mt-2 text-xs text-slate-500">
                                    วันที่ต้องไม่เกินวันที่สัญญาสิ้นสุด ({formatDateTH(editMoveOutDateModal.maxDate)})
                                </p>
                                {editMoveOutDateError && (
                                    <p className="mt-2 text-xs text-red-600 font-semibold">{editMoveOutDateError}</p>
                                )}
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditMoveOutDateModal(null);
                                        setEditMoveOutDate('');
                                        setEditMoveOutDateError(null);
                                    }}
                                    className="flex-1 px-5 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                                >ยกเลิก</button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!editMoveOutDate) {
                                            setEditMoveOutDateError('กรุณาระบุวันที่');
                                            return;
                                        }
                                        const maxDate = editMoveOutDateModal?.maxDate || '';
                                        if (!isMoveOutDateValid(editMoveOutDate, maxDate)) {
                                            setEditMoveOutDateError('วันที่ต้องไม่เกินวันที่สัญญาสิ้นสุด');
                                            return;
                                        }
                                        handleSaveMoveOutDate();
                                    }}
                                    className="flex-1 px-5 py-3.5 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 shadow-lg shadow-red-600/30 transition-all"
                                >บันทึกวันที่</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}