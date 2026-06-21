'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { getRoomOccupancyIntervals, getRoomAvailability, getNextAvailableDate, getRoomAvailabilityText, isRoomAvailable, computeGapInfo } from '../../../lib/availability';
import { useAuth } from '../../../context/AuthContext';
import { canEdit } from '../../../lib/permissions';
import { logAudit, describeChanges } from '../../../lib/audit';

interface Waitlist {
    id: string;
    name: string;
    room_type: string;
    kitchen_type: string;
    view_preference: string;
    start_date: string;
    end_date: string;
    status: string;
    special_request?: string;
    allocation_note?: string;
    monthly_rent?: number;
    preferred_floors: number[];
}

interface Room {
    id: string;
    room_number: string;
    room_type: string;
    kitchen_type: string;
    view_direction: string;
    building?: string | null;
}

interface Contract {
    id?: string;
    main_room_id?: string;
    main_start_date?: string;
    main_end_date?: string;
    temp_room_id?: string;
    temp_start_date?: string;
    temp_end_date?: string;
    move_to_room_id?: string;
    move_start_date?: string;
    move_end_date?: string;
    status?: string;
    actual_check_in_date?: string;
    contract_start_date?: string;
    contract_end_date?: string;
}

export default function AllocateRoomPage() {
    const { profile, loading: authLoading } = useAuth();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const waitlistId = params.id as string;
    const isMove = searchParams.get('move') === 'true';
    const moveContractId = searchParams.get('contract_id');

    const [waitlist, setWaitlist] = useState<Waitlist | null>(null);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [allContracts, setAllContracts] = useState<Contract[]>([]);
    const [intentions, setIntentions] = useState<any[]>([]);

    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [assignAs, setAssignAs] = useState<'main' | 'temp'>('main');
    const [tempContractId, setTempContractId] = useState<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [actualCheckInDate, setActualCheckInDate] = useState<string>('');
    const [tempEndDate, setTempEndDate] = useState<string>('');
    const [tempStartDate, setTempStartDate] = useState<string>('');
    const [isEditingTempModal, setIsEditingTempModal] = useState(false);

    useEffect(() => {
        if (waitlist) {
            setActualCheckInDate(waitlist.start_date);
        }
    }, [waitlist]);

    useEffect(() => {
        fetchData();
    }, [waitlistId]);

    const openTempEditModal = () => {
        setIsEditingTempModal(true);
    };

    const closeTempEditModal = () => {
        setIsEditingTempModal(false);
    };

    useEffect(() => {
        if (assignAs === 'temp' && selectedRoomId && waitlist) {
            const defaultEndDate = new Date(waitlist.start_date);
            defaultEndDate.setMonth(defaultEndDate.getMonth() + 2);
            defaultEndDate.setDate(defaultEndDate.getDate() - 1);

            const contractEndDate = new Date(waitlist.end_date);
            if (defaultEndDate > contractEndDate) {
                defaultEndDate.setTime(contractEndDate.getTime());
            }

            const yyyy = defaultEndDate.getFullYear();
            const mm = String(defaultEndDate.getMonth() + 1).padStart(2, '0');
            const dd = String(defaultEndDate.getDate()).padStart(2, '0');
            setTempEndDate(`${yyyy}-${mm}-${dd}`);
        } else {
            setTempEndDate('');
        }
    }, [assignAs, selectedRoomId, waitlist, allContracts]);

    async function fetchData() {
        setLoading(true);
        if (waitlistId === 'move') {
            const moveStart = searchParams.get('move_start');
            const moveEnd = searchParams.get('move_end');
            if (moveContractId) {
                const { data: contract } = await supabase.from('contracts').select('*').eq('id', moveContractId).single();
                if (contract) {
                    const { data: currentRoom } = await supabase.from('rooms').select('*').eq('id', contract.main_room_id).single();
                    setWaitlist({
                        id: 'move',
                        name: contract.tenant_name || 'ไม่ระบุ',
                        room_type: currentRoom?.room_type || 'ไม่ระบุ',
                        kitchen_type: currentRoom?.kitchen_type || 'ไม่ระบุ',
                        view_preference: currentRoom?.view_direction || 'ไม่ระบุ',
                        start_date: moveStart || '',
                        end_date: moveEnd || contract.contract_end_date || '',
                        status: 'รอเลือกห้องให้',
                        special_request: 'ย้ายห้อง',
                        monthly_rent: contract.monthly_rent || 0,
                        preferred_floors: [],
                    });
                }
            }
        } else {
            const { data: wData } = await supabase.from('waitlists').select('*').eq('id', waitlistId).single();
            if (wData) setWaitlist(wData);

            // load any existing contract for this waitlist (to allow editing temp dates)
            const { data: existingContract } = await supabase.from('contracts').select('id,main_room_id,main_start_date,main_end_date,temp_room_id,temp_start_date,temp_end_date').eq('waitlist_id', waitlistId).maybeSingle();
            if (existingContract) {
                setTempContractId(existingContract.id ?? null);
                if (existingContract.temp_room_id) {
                    setSelectedRoomId(existingContract.temp_room_id);
                    setAssignAs('temp');
                    setTempStartDate(existingContract.temp_start_date || '');
                    setTempEndDate(existingContract.temp_end_date || '');
                }
                if (existingContract.main_room_id) {
                    setSelectedRoomId(existingContract.main_room_id);
                    setAssignAs('main');
                }
            }
        }

        const { data: rData } = await supabase.from('rooms').select('*').order('room_number');
        if (rData) setRooms(rData);

        const { data: cData } = await supabase
            .from('contracts')
            .select('id, main_room_id, main_start_date, main_end_date, temp_room_id, temp_start_date, temp_end_date, move_to_room_id, move_start_date, move_end_date, actual_check_in_date, contract_start_date, contract_end_date')
            .neq('status', 'cancelled');
        if (cData) setAllContracts(cData);

        const { data: iData } = await supabase.from('renewal_intentions').select('*');
        if (iData) setIntentions(iData);

        setLoading(false);
    }

    const ensureRenewalIntentionForContract = async (contractId: string, roomId: string | null, tenantName: string) => {
        if (!contractId) return;
        const { data: existing, error: existingError } = await supabase.from('renewal_intentions').select('*').eq('contract_id', contractId).limit(1);
        if (existingError) {
            console.warn('Failed to check existing renewal intention', existingError.message);
            return;
        }
        if (existing && existing.length > 0) return;

        const today = new Date();
        const surveyMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
        const intentPayload = {
            contract_id: contractId,
            room_id: roomId,
            tenant_name: tenantName,
            intention: 'not_asked',
            survey_month: surveyMonth,
            note: '',
        };
        const { error: intentError } = await supabase.from('renewal_intentions').insert([intentPayload]);
        if (intentError) {
            console.warn('Failed to create default renewal intention for contract', intentError.message);
        }
    };

    const formatGap = (from: Date | null, to: Date): string | null => {
        if (!from) return null;
        if (from.getTime() === 0) return null;
        if (from >= to) return null;
        const totalDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
        const months = Math.floor(totalDays / 30);
        const days = totalDays % 30;
        if (months > 0) return `${months} เดือน${days ? ` ${days} วัน` : ''}`;
        return `${totalDays} วัน`;
    };

    const daysBetween = (from: Date | null, to: Date | null): number => {
        if (!from || !to) return 0;
        if (from.getTime && from.getTime() === 0) return 0;
        const msPerDay = 1000 * 60 * 60 * 24;
        return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / msPerDay));
    };

    const getSearchStartDate = () => {
        return waitlist?.start_date ?? '';
    };

    const handleAllocate = async () => {
        if (!selectedRoomId || !waitlist) return;

        // เช็คว่าห้องที่เลือกว่างในช่วงวันที่ต้องการจะย้าย (actualCheckInDate) หรือไม่
        const { availableFrom } = getRoomAvailability(allContracts, selectedRoomId, actualCheckInDate);
        if (new Date(actualCheckInDate) < availableFrom) {
            alert(`ไม่สามารถย้ายเข้าได้ในวันที่เลือก! ห้องนี้จะว่างตั้งแต่วันที่ ${availableFrom.toLocaleDateString('th-TH')} เป็นต้นไป โปรดเปลี่ยน "วันที่ต้องการจะย้าย" หรือเลือกห้องอื่น`);
            return;
        }

        setIsSubmitting(true);

        const finalMainStartDate = actualCheckInDate; // ใช้วันที่ผู้ใช้ระบุมาได้เลย เพราะผ่านการตรวจสอบแล้วว่าว่าง

        const basePayload: any = {
            waitlist_id: waitlistId,
            tenant_name: waitlist.name,
            actual_check_in_date: actualCheckInDate,
            contract_start_date: waitlist.start_date,
            contract_end_date: waitlist.end_date,
            status: 'active',
            monthly_rent: waitlist.monthly_rent || null,
        };

        let insertedContractId: string | null = null;

        if (assignAs === 'main') {
            // If there's an existing contract for this waitlist, update it to include main room
            if (tempContractId) {
                const updatePayload: any = { main_room_id: selectedRoomId, main_start_date: finalMainStartDate, main_end_date: waitlist.end_date, status: 'active' };
                // ซิงค์วันที่ย้ายออกห้องชั่วคราวให้ตรงกับวันที่ห้องหลักว่าง (ตามที่ผู้ใช้ร้องขอ)
                if (finalMainStartDate) {
                    updatePayload.temp_end_date = finalMainStartDate;
                }
                const { error: updateErr } = await supabase.from('contracts').update(updatePayload).eq('id', tempContractId);
                if (updateErr) {
                    alert('เกิดข้อผิดพลาดในการอัปเดตสัญญา: ' + updateErr.message);
                    setIsSubmitting(false);
                    return;
                }
                insertedContractId = tempContractId;
                await logAudit(profile, 'contracts', 'update', tempContractId, 'อัปเดตสัญญา เพิ่มห้องหลักให้กับสัญญาที่มีอยู่', updatePayload);
                await ensureRenewalIntentionForContract(tempContractId, selectedRoomId, waitlist.name);
            } else {
                const contractPayload = { ...basePayload, main_room_id: selectedRoomId, main_start_date: finalMainStartDate, main_end_date: waitlist.end_date };
                const { data: contractData, error: contractError } = await supabase.from('contracts').insert([contractPayload]).select('id');
                if (contractError) {
                    alert('เกิดข้อผิดพลาดในการสร้างสัญญา: ' + contractError.message);
                    setIsSubmitting(false);
                    return;
                }
                insertedContractId = contractData?.[0]?.id ?? null;
                if (insertedContractId) {
                    await logAudit(profile, 'contracts', 'create', insertedContractId, 'จัดสรรห้องให้ waitlist และสร้างสัญญา', contractPayload);
                    await ensureRenewalIntentionForContract(insertedContractId, contractPayload.main_room_id || contractPayload.temp_room_id || contractPayload.move_to_room_id || null, contractPayload.tenant_name);
                }
            }

            const { error: waitlistError } = await supabase.from('waitlists').update({ status: 'จัดสรรห้องแล้ว' }).eq('id', waitlistId);
            if (!waitlistError) {
                await logAudit(profile, 'waitlists', 'update', waitlistId, 'อัปเดตสถานะ waitlist เป็นจัดสรรห้องแล้ว', { status: 'จัดสรรห้องแล้ว' });
            }

        } else {
            // temp allocation: update existing temp contract if present, else create
            const tempFields: any = { temp_room_id: selectedRoomId, temp_start_date: (tempStartDate || actualCheckInDate), temp_end_date: tempEndDate };
            if (tempContractId) {
                const { error: updateErr } = await supabase.from('contracts').update(tempFields).eq('id', tempContractId);
                if (updateErr) {
                    alert('เกิดข้อผิดพลาดในการอัปเดตสัญญาชั่วคราว: ' + updateErr.message);
                    setIsSubmitting(false);
                    return;
                }
                insertedContractId = tempContractId;
                await logAudit(profile, 'contracts', 'update', tempContractId, 'อัปเดตสัญญาชั่วคราว (temp) สำหรับ waitlist', tempFields);
                await ensureRenewalIntentionForContract(tempContractId, selectedRoomId, waitlist.name);
            } else {
                const { data: contractData, error: contractError } = await supabase.from('contracts').insert([{ ...basePayload, ...tempFields }]).select('id');
                if (contractError) {
                    alert('เกิดข้อผิดพลาดในการสร้างสัญญา: ' + contractError.message);
                    setIsSubmitting(false);
                    return;
                }
                insertedContractId = contractData?.[0]?.id ?? null;
                if (insertedContractId) {
                    await logAudit(profile, 'contracts', 'create', insertedContractId, 'จัดสรรห้องชั่วคราวให้ waitlist และสร้างสัญญา (ชั่วคราว)', { ...basePayload, ...tempFields });
                    await ensureRenewalIntentionForContract(insertedContractId, selectedRoomId, waitlist.name);
                    setTempContractId(insertedContractId);
                }
            }

            if (insertedContractId) {
                const room = rooms.find(r => r.id === selectedRoomId);
                const roomLabel = room ? `ห้อง ${room.room_number}` : selectedRoomId;
                const note = `จัดสรรห้องชั่วคราว: ${roomLabel}`;
                const { error: wlErr } = await supabase.from('waitlists').update({ status: 'จัดสรรชั่วคราว', allocation_note: note }).eq('id', waitlistId);
                if (!wlErr) {
                    await logAudit(profile, 'waitlists', 'update', waitlistId, 'อัปเดตสถานะ waitlist เป็นจัดสรรชั่วคราว และเพิ่มโน้ต (allocation_note)', { status: 'จัดสรรชั่วคร่าว', allocation_note: note, contract_id: insertedContractId });
                    setWaitlist({ ...waitlist, status: 'จัดสรรชั่วคร่าว', allocation_note: note });
                }
            }
        }

        alert(`✅ จัดสรร${assignAs === 'main' ? 'ห้องหลัก' : 'ห้องชั่วคราว'} และสร้างสัญญาสำเร็จ!` + (assignAs === 'temp' ? ' รายการ waitlist จะยังไม่ปิดจนกว่าจะเลือกห้องหลัก' : ''));
        router.push(assignAs === 'main' ? '/waitlists' : '/waitlists');
    };

    const handleMoveAllocation = async (roomId: string) => {
        if (!moveContractId || !waitlist) return;

        const room = rooms.find(r => r.id === roomId);
        if (!window.confirm(`ยืนยันการย้ายไปยังห้อง ${room?.room_number} ใช่หรือไม่?`)) return;

        setIsSubmitting(true);

        const updatePayload = {
            move_to_room_id: roomId,
            move_start_date: waitlist.start_date,
            move_end_date: waitlist.end_date,
            main_end_date: waitlist.start_date, // End main room on the move date
        };

        const { error } = await supabase.from('contracts').update(updatePayload).eq('id', moveContractId);
        if (error) {
            alert('เกิดข้อผิดพลาดในการย้ายห้อง: ' + error.message);
            setIsSubmitting(false);
            return;
        }

        await logAudit(profile, 'contracts', 'update', moveContractId, 'ทำการย้ายห้อง', updatePayload);
        
        if (waitlistId !== 'move') {
            await supabase.from('waitlists').update({ status: 'จัดสรรห้องแล้ว' }).eq('id', waitlistId);
        }

        alert('ทำรายการย้ายห้องเรียบร้อยแล้ว');
        router.push('/bookings');
    };

    if (authLoading || loading) return <div className="p-10 text-center text-gray-500">กำลังโหลดข้อมูล...</div>;

    if (!profile || !canEdit(profile.role)) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
                <div className="text-red-500 text-5xl mb-4">⚠️</div>
                <h2 className="text-2xl font-bold text-[#0A2647] mb-2">ไม่มีสิทธิ์เข้าถึง</h2>
                <p className="text-slate-500">เฉพาะผู้ดูแลระบบ เจ้าของหอพัก หรือพนักงานที่มีสิทธิ์เท่านั้นที่สามารถจัดสรรห้องได้</p>
            </div>
        );
    }

    if (!waitlist) return <div className="p-10 text-center text-gray-500">ไม่พบข้อมูลการจอง...</div>;

    const searchStartDate = getSearchStartDate();

    // Debug helper removed — cleaning up UI

    // Build locked rooms set: any contract that ends on/after searchStartDate and
    // whose intention is missing or not explicitly a non-locking intent will lock the associated room(s).
    const lockedRoomIds = (() => {
        const locked = new Set<string>();
        if (!searchStartDate) return locked;

        const nonLockIntents = ['not_renew', 'renew_no_room', 'renew'];

        const byContract: Record<string, any> = {};
        intentions.forEach(i => { if (i.contract_id) byContract[i.contract_id] = i; });

        for (const c of allContracts) {
            if (c.status === 'cancelled') continue;
            const intent = c.id ? byContract[c.id] : undefined;

            // main room
            if (c.main_room_id) {
                const endDate = c.main_end_date || c.contract_end_date;
                if (endDate && new Date(endDate) >= new Date(searchStartDate)) {
                    if (!intent || !nonLockIntents.includes(intent.intention)) locked.add(c.main_room_id);
                }
            }

            // temp room (use its explicit end date)
            if (c.temp_room_id) {
                // Temp rooms are inherently temporary and have a guaranteed end date (temp_end_date).
                // They do not require a renewal intention survey to determine if the tenant will move out.
                // Thus, we should NEVER lock a temp room. getRoomAvailability will handle the gap calculation.
            }

            // move-to room
            if (c.move_to_room_id) {
                const endDate = c.move_end_date || c.contract_end_date;
                if (endDate && new Date(endDate) >= new Date(searchStartDate)) {
                    if (!intent || !nonLockIntents.includes(intent.intention)) locked.add(c.move_to_room_id);
                }
            }
        }

        for (const intent of intentions) {
            if (intent.room_id) {
                // Ignore intents that are tied to a temp room, because temp rooms have a fixed end date.
                const c = allContracts.find(contract => contract.id === intent.contract_id);
                if (c && c.temp_room_id === intent.room_id) {
                    continue;
                }

                if (!intent.intention || !nonLockIntents.includes(intent.intention)) {
                    // If the room is already available for the requested range, don't mark it locked
                    if (!isRoomAvailable(allContracts, intentions, intent.room_id, searchStartDate, waitlist.end_date)) {
                        locked.add(intent.room_id);
                    }
                }
            }
        }

        return locked;
    })();

    const roomsL = rooms;

    const matchedRooms = roomsL.filter(r =>
        (!waitlist.room_type || waitlist.room_type === 'ไม่ระบุ' || r.room_type === waitlist.room_type) &&
        (!waitlist.kitchen_type || waitlist.kitchen_type === 'ไม่ระบุ' || r.kitchen_type === waitlist.kitchen_type) &&
        (!waitlist.view_preference || waitlist.view_preference === 'ไม่ระบุ' || r.view_direction === waitlist.view_preference) &&
        !lockedRoomIds.has(r.id)
    );

    const perfectMatches: Room[] = [];
    const partialMatches: Room[] = [];
    const availableLaterMatches: Room[] = [];

    matchedRooms.forEach(room => {
        const { availableFrom, availableUntil } = getRoomAvailability(allContracts, room.id, searchStartDate);
        const reqStart = new Date(searchStartDate);
        const reqEnd = new Date(waitlist.end_date);

        if (reqStart < availableFrom) {
            availableLaterMatches.push(room);
        } else if (availableUntil && reqEnd > availableUntil) {
            partialMatches.push(room);
        } else {
            perfectMatches.push(room);
        }
    });

    const otherRooms = roomsL.filter(r => !matchedRooms.some(m => m.id === r.id));
    const alternativeMatches = otherRooms.filter(r => {
        if (lockedRoomIds.has(r.id)) return false;
        const { availableFrom } = getRoomAvailability(allContracts, r.id, searchStartDate);
        const reqStart = new Date(searchStartDate);
        return reqStart >= availableFrom;
    });

    let isSelectedRoomLate = false;
    let isSelectedRoomExpireEarly = false;
    let expireDateStr = '';

    if (selectedRoomId) {
        const { availableFrom, availableUntil } = getRoomAvailability(allContracts, selectedRoomId, searchStartDate);
        const reqStart = new Date(searchStartDate);
        const reqEnd = new Date(waitlist.end_date);

        if (reqStart < availableFrom) {
            isSelectedRoomLate = true;
        } else if (availableUntil && reqEnd > availableUntil) {
            isSelectedRoomExpireEarly = true;
            expireDateStr = availableUntil.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
        }
    }

    return (
        <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-8">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                    <div>
                        {waitlist.allocation_note && (
                            <div className="mb-2 text-sm font-semibold text-amber-800 bg-amber-100 px-3 py-1 rounded-lg inline-block">{waitlist.allocation_note}</div>
                        )}
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">จัดสรรห้องให้คุณ {waitlist.name}</h1>
                        <p className="text-sm text-gray-500">เลือกห้องพักที่ตรงกับเงื่อนไขการจองด้านล่าง</p>
                    </div>
                    <div className="flex flex-wrap md:justify-end gap-3 text-sm w-full md:w-auto">
                        <div className="bg-gray-50 px-4 py-2 rounded-xl border border-gray-200">
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">ประเภทห้อง</span>
                            <span className="font-medium text-gray-800">{waitlist.room_type || 'ไม่ระบุ'}</span>
                        </div>
                        <div className="bg-gray-50 px-4 py-2 rounded-xl border border-gray-200">
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">ประเภทครัว</span>
                            <span className="font-medium text-gray-800">{waitlist.kitchen_type || 'ไม่ระบุ'}</span>
                        </div>
                        <div className="bg-gray-50 px-4 py-2 rounded-xl border border-gray-200">
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">ทิศ/วิว</span>
                            <span className="font-medium text-gray-800">{waitlist.view_preference || 'ไม่ระบุ'}</span>
                        </div>
                        <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
                            <span className="text-blue-400 block text-[10px] uppercase font-bold">ช่วงเวลาที่ต้องการ</span>
                            <span className="font-bold text-blue-700">{new Date(waitlist.start_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} - {new Date(waitlist.end_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                        <div className="bg-green-50 px-4 py-2 rounded-xl border border-green-100">
                            <span className="text-green-400 block text-[10px] uppercase font-bold">ชั้นที่ต้องการ</span>
                            <span className="font-bold text-green-700">{waitlist.preferred_floors?.join(', ') || 'ไม่ระบุ'}</span>
                        </div>
                        {tempContractId && (
                            <button onClick={openTempEditModal} className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm hover:bg-amber-100 transition-colors">แก้ไขการจัดสรรชั่วคราว</button>
                        )}
                    </div>
                </div>

                {waitlist.special_request && (
                    <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 w-full mt-2">
                        <span className="text-yellow-700 text-[10px] uppercase font-bold block mb-1 flex items-center gap-1">
                            📌 คำขอพิเศษ (Special Request)
                        </span>
                        <p className="text-yellow-900 text-sm">{waitlist.special_request}</p>
                    </div>
                )}
                {/* Debug panel removed */}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className={`space-y-6 ${isMove ? 'col-span-1 lg:col-span-3' : 'col-span-1 lg:col-span-2'}`}>
                    <div>
                        <h2 className="text-lg font-bold text-green-600 mb-3 flex items-center gap-2">
                            <span>✨</span> ห้องว่างตรงตามกำหนด (Perfect Match)
                        </h2>
                        <div className="space-y-3">
                            {perfectMatches.length > 0 ? perfectMatches.map(room => {
                                const { availableFrom, availableUntil } = getRoomAvailability(allContracts, room.id, searchStartDate);
                                const gap = formatGap(availableFrom, new Date(waitlist.start_date));
                                return (
                                    <div
                                        key={room.id}
                                        // 🌟 เลือกให้เป็น Main Room
                                        onClick={() => {
                                            if (isMove) {
                                                handleMoveAllocation(room.id);
                                            } else {
                                                setSelectedRoomId(room.id); setAssignAs('main');
                                            }
                                        }}
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/40 dark:text-white' : 'border-gray-200 bg-white hover:border-blue-300 dark:border-gray-700 dark:bg-neutral-800 dark:hover:border-blue-400 dark:text-gray-300 dark:opacity-60 dark:hover:opacity-100'}`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <div className="font-bold text-lg text-gray-900 dark:text-white">ห้อง {room.room_number}</div>
                                            <div className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-md font-bold">พร้อมเข้าอยู่ตรงวัน</div>
                                        </div>
                                        <div className="text-sm text-gray-500 mt-2 flex gap-4">
                                            <span>🛏️ {room.room_type}</span>
                                            <span>🍳 {room.kitchen_type}</span>
                                            <span>🧭 {room.view_direction}</span>
                                        </div>
                                        <div className="text-xs font-semibold text-gray-600 mt-3 bg-gray-50 p-2 rounded-lg border border-gray-100 inline-flex items-center gap-1.5 w-full">
                                            📅 {getRoomAvailabilityText(allContracts, room.id, searchStartDate)}
                                        </div>
                                        {(() => {
                                            const gapInfo = computeGapInfo(availableFrom, new Date(waitlist.start_date));
                                            if (!gapInfo) return null;
                                            return (
                                                <div className="text-xs text-amber-700 mt-2 font-medium">ช่องว่าง: {gapInfo.totalDays} วัน</div>
                                            );
                                        })()}
                                    </div>
                                );
                            }) : (
                                <div className="p-5 text-center border border-dashed border-gray-300 rounded-xl text-gray-400 text-sm bg-gray-50">
                                    ไม่มีห้องที่ว่างตรงตามสเปคและครอบคลุมเวลาเป๊ะๆ ในขณะนี้
                                </div>
                            )}
                        </div>
                    </div>

                    {/* {partialMatches.length > 0 && (
                        <div className="pt-4 border-t border-gray-200">
                            <h2 className="text-lg font-bold text-yellow-600 mb-3 flex items-center gap-2">
                                <span>⚠️</span> ห้องตรงสเปค ว่างพร้อมอยู่ (แต่ต้องย้ายออกทีหลัง)
                            </h2>
                            <div className="space-y-3">
                                {partialMatches.map(room => {
                                    const { availableUntil } = getRoomAvailability(allContracts, room.id, waitlist.start_date);
                                    return (
                                        <div
                                            key={room.id}
                                            // 🌟 เลือกให้เป็น Temp Room อัตโนมัติ!
                                            onClick={() => { setSelectedRoomId(room.id); setAssignAs('temp'); }}
                                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/40 dark:text-white' : 'border-gray-200 bg-white hover:border-yellow-300 dark:border-gray-700 dark:bg-neutral-800 dark:hover:border-yellow-300 dark:text-gray-300 dark:opacity-60 dark:hover:opacity-100'}`}
                                        >
                                            <div className="flex justify-between items-center">
                                                <div className="font-bold text-lg text-gray-900 dark:text-white">ห้อง {room.room_number}</div>
                                                <div className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-md font-bold">
                                                    อยู่ได้ถึง {availableUntil ? availableUntil.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-500 mt-2 flex gap-4">
                                                <span>🛏️ {room.room_type}</span>
                                                <span>🍳 {room.kitchen_type}</span>
                                                <span>🧭 {room.view_direction}</span>
                                            </div>
                                            <div className="text-xs font-semibold text-yellow-800 mt-3 bg-yellow-50 p-2 rounded-lg border border-yellow-100 inline-flex items-center gap-1.5 w-full">
                                                📅 {getRoomAvailabilityText(allContracts, room.id, searchStartDate)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )} */}

                    <div className="pt-4 border-t border-gray-200 mt-6">
                        <h2 className="text-lg font-bold text-blue-500 mb-3 flex items-center gap-2">
                            <span>💡</span> ห้องทางเลือก (ไม่ตรงสเปค แต่เข้าอยู่ได้เลย)
                        </h2>
                        <div className="space-y-3">
                            {alternativeMatches.length > 0 ? alternativeMatches.map(room => (
                                <div
                                    key={room.id}
                                    // 🌟 เลือกให้เป็น Main Room
                                    onClick={() => {
                                        if (isMove) {
                                            handleMoveAllocation(room.id);
                                        } else {
                                            setSelectedRoomId(room.id); setAssignAs('main');
                                        }
                                    }}
                                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all opacity-80 hover:opacity-100 ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30 dark:text-white' : 'border-gray-200 bg-gray-50 hover:border-blue-300 dark:border-gray-700 dark:bg-neutral-800 dark:hover:border-blue-400 dark:text-gray-300 dark:opacity-60 dark:hover:opacity-100'}`}
                                >
                                    <div className="flex justify-between items-center">
                                        <div className="font-bold text-lg text-gray-900 dark:text-white">ห้อง {room.room_number}</div>
                                        <div className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-md font-bold">สเปคอื่นที่พร้อมเข้าอยู่</div>
                                    </div>
                                    <div className="text-sm text-gray-500 mt-2 flex gap-4">
                                        <span className={waitlist.room_type && waitlist.room_type !== 'ไม่ระบุ' && waitlist.room_type !== room.room_type ? 'text-red-500' : ''}>🛏️ {room.room_type}</span>
                                        <span className={waitlist.kitchen_type && waitlist.kitchen_type !== 'ไม่ระบุ' && waitlist.kitchen_type !== room.kitchen_type ? 'text-red-500' : ''}>🍳 {room.kitchen_type}</span>
                                        <span className={waitlist.view_preference && waitlist.view_preference !== 'ไม่ระบุ' && waitlist.view_preference !== room.view_direction ? 'text-red-500' : ''}>🧭 {room.view_direction}</span>
                                    </div>
                                    <div className="text-xs font-semibold text-gray-600 mt-3 bg-white p-2 rounded-lg border border-gray-200 inline-flex items-center gap-1.5 w-full">
                                        📅 {getRoomAvailabilityText(allContracts, room.id, searchStartDate)}
                                    </div>
                                </div>
                            )) : (
                                <div className="p-5 text-center border border-dashed border-gray-300 rounded-xl text-gray-400 text-sm bg-gray-50">
                                    ไม่มีห้องอื่นที่ว่างในช่วงเวลานี้เลย
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                        <h2 className="text-lg font-bold text-orange-500 mb-3 flex items-center gap-2">
                            <span>⏳</span> ห้องต้องสเปค แต่ห้องอยู่ห้องชั่วคราว
                        </h2>
                        <div className="space-y-3">
                            {availableLaterMatches.length > 0 ? availableLaterMatches.map(room => {
                                const nextAvailDate = getNextAvailableDate(allContracts, room.id, waitlist.start_date);
                                const { availableFrom } = getRoomAvailability(allContracts, room.id, searchStartDate);
                                const tempGapInfo = computeGapInfo(new Date(waitlist.start_date), availableFrom);

                                return (
                                    <div
                                        key={room.id}
                                        // 🌟 เลือกให้เป็น Main Room และอัปเดตวันสิ้นสุดห้องชั่วคราวให้ตรงกับวันที่ห้องนี้ว่าง
                                        onClick={() => {
                                            if (isMove) {
                                                handleMoveAllocation(room.id);
                                            } else {
                                                setSelectedRoomId(room.id); 
                                                setAssignAs('main'); 
                                                setTempEndDate(nextAvailDate);
                                                setActualCheckInDate(nextAvailDate); // เปลี่ยนวันที่ย้ายเป็นวันที่ห้องว่างด้วย
                                            }
                                        }}
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/40 dark:text-white' : 'border-gray-200 bg-white hover:border-orange-200 dark:border-gray-700 dark:bg-neutral-800 dark:hover:border-orange-300 dark:text-gray-300 dark:opacity-60 dark:hover:opacity-100'}`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <div className="font-bold text-lg text-gray-900 dark:text-white">ห้อง {room.room_number}</div>
                                            <div className="flex items-center gap-2">
                                                <div className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-md font-bold">
                                                    ว่างวันที่ {new Date(nextAvailDate).toLocaleDateString('th-TH')}
                                                </div>
                                                {tempGapInfo && (
                                                    <div className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-md font-bold">
                                                        ต้องอยู่ห้องชั่วคราว {tempGapInfo.totalDays} วัน (ถึง {tempGapInfo.untilStr})
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-sm text-gray-500 mt-2 flex gap-4">
                                            <span>🛏️ {room.room_type}</span>
                                            <span>🍳 {room.kitchen_type}</span>
                                            <span>🧭 {room.view_direction}</span>
                                        </div>
                                        <div className="text-xs font-semibold text-orange-800 mt-3 bg-orange-50/50 p-2 rounded-lg border border-orange-100 inline-flex items-center gap-1.5 w-full">
                                            📅 {getRoomAvailabilityText(allContracts, room.id, searchStartDate)}
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div className="p-5 text-center border border-dashed border-gray-300 rounded-xl text-gray-400 text-sm bg-gray-50">
                                    ไม่มีห้องสำรองที่ตรงสเปค
                                </div>
                            )}
                        </div>
                    </div>


                </div>

                {/* แผงควบคุมด้านขวา (ปรับ UI ใหม่ให้เข้าใจง่ายขึ้น) */}
                {!isMove && (
                <div className="col-span-1">
                    <div className="bg-white p-5 md:p-6 rounded-2xl border border-gray-200 shadow-sm sticky top-8 max-h-160 overflow-y-auto">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 pb-3 mb-5 sticky top-0 bg-white z-10">
                            สรุปการจัดสรรห้อง
                        </h3>

                        {!selectedRoomId ? (
                            <div className="flex flex-col items-center justify-center py-12 text-gray-400 space-y-3">
                                <span className="text-4xl">👈</span>
                                <p className="text-sm">โปรดคลิกเลือกห้องพักจากรายการด้านซ้าย</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* 1. ห้องที่เลือก */}
                                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-100 flex justify-between items-center">
                                    <div>
                                        <div className="text-xs text-blue-600 font-bold mb-1 uppercase tracking-wide">ห้องที่เลือก</div>
                                        <div className="text-3xl font-black text-blue-700">
                                            {rooms.find(r => r.id === selectedRoomId)?.room_number}
                                        </div>
                                    </div>
                                    <div className="h-12 w-12 bg-white rounded-full flex items-center justify-center text-xl shadow-sm">
                                        🔑
                                    </div>
                                </div>

                                {/* 2. วันที่เข้าพัก (จำเป็นสำหรับทุกคน) */}
                                <div className="space-y-2">
                                    <label className="block text-sm font-bold text-gray-800">
                                        📅 วันที่ต้องการจะย้ายเข้า
                                    </label>
                                    <input
                                        type="date"
                                        className="w-full border border-gray-300 rounded-xl p-3 text-sm text-gray-900 dark:text-white bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-blue-500 transition-shadow outline-none"
                                        value={actualCheckInDate}
                                        onChange={(e) => setActualCheckInDate(e.target.value)}
                                        required
                                    />
                                    <p className="text-[11px] text-gray-500">
                                        * กำหนดการตามสัญญาคือ {new Date(waitlist.start_date).toLocaleDateString('th-TH')}
                                    </p>
                                </div>



                                {/* 3. รูปแบบการจัดสรร (Radio Cards) */}
                                <div className="space-y-3 pt-2">
                                    <label className="block text-sm font-bold text-gray-800">
                                        📌 รูปแบบการเข้าพักสำหรับห้องนี้
                                    </label>
                                    <div className="grid grid-cols-1 gap-3">
                                        {/* Card: ห้องหลัก */}
                                        <label className={`relative flex cursor-pointer rounded-xl border p-4 shadow-sm focus:outline-none transition-all ${assignAs === 'main'
                                            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500 dark:bg-blue-900/40 dark:border-blue-400 dark:text-white'
                                            : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300 dark:border-gray-700 dark:hover:bg-neutral-800'
                                            }`}>
                                            <input
                                                type="radio"
                                                name="assignAs"
                                                value="main"
                                                className="sr-only"
                                                checked={assignAs === 'main'}
                                                onChange={() => setAssignAs('main')}
                                            />
                                            <span className="flex flex-1">
                                                <span className="flex flex-col">
                                                    <span className="block text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                                        🏠 ให้เป็น "ห้องหลัก"
                                                    </span>
                                                    <span className="mt-1 flex items-center text-xs text-gray-500 leading-relaxed">
                                                        ลูกค้าจะอยู่ห้องนี้เป็นหลัก ยาวไปจนจบสัญญาเช่า
                                                    </span>
                                                </span>
                                            </span>
                                            {assignAs === 'main' && (
                                                <svg className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                        </label>

                                        {/* Card: ห้องชั่วคราว */}
                                        {!tempContractId && (
                                            <label className={`relative flex cursor-pointer rounded-xl border p-4 shadow-sm focus:outline-none transition-all ${assignAs === 'temp'
                                                ? 'bg-purple-50 border-purple-500 ring-1 ring-purple-500 dark:bg-purple-900/40 dark:border-purple-400 dark:text-white'
                                                : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300 dark:border-gray-700 dark:hover:bg-neutral-800'
                                                }`}>
                                                <input
                                                    type="radio"
                                                    name="assignAs"
                                                    value="temp"
                                                    className="sr-only"
                                                    checked={assignAs === 'temp'}
                                                    onChange={() => setAssignAs('temp')}
                                                />
                                                <span className="flex flex-1">
                                                    <span className="flex flex-col">
                                                        <span className="block text-sm font-bold text-purple-900 flex items-center gap-2">
                                                            🧳 ให้เป็น "ห้องพักชั่วคราว"
                                                        </span>
                                                        <span className="mt-1 flex items-center text-xs text-purple-700/70 leading-relaxed">
                                                            ให้เข้าพักชั่วคราวก่อน แล้วค่อยทำเรื่องย้ายห้องภายหลัง
                                                        </span>
                                                    </span>
                                                </span>
                                                {assignAs === 'temp' && (
                                                    <svg className="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </label>
                                        )}
                                    </div>
                                </div>

                                {/* 4. Timeline ห้องชั่วคราว (แสดงเฉพาะตอนเลือก Temp) */}
                                {assignAs === 'temp' && !tempContractId && (
                                    <div className="bg-purple-100/50 p-4 rounded-xl border border-purple-200 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <label className="block text-sm font-bold text-purple-800 mb-2">
                                            🛫 วันที่คาดว่าจะต้องย้ายออก
                                        </label>
                                        <input
                                            type="date"
                                            className="w-full border border-purple-300 rounded-xl p-3 text-sm text-purple-900 bg-white focus:ring-2 focus:ring-purple-500 transition-shadow outline-none"
                                            value={tempEndDate}
                                            onChange={(e) => setTempEndDate(e.target.value)}
                                            required
                                        />
                                        <div className="mt-3 flex gap-2 items-start text-[11px] text-purple-700 bg-purple-100 p-2.5 rounded-lg">
                                            <span className="text-sm">💡</span>
                                            <p className="leading-relaxed">
                                                ระบบได้ตั้งค่าแนะนำให้ย้ายออกหลังจากเริ่มสัญญา 2 เดือน คุณสามารถปรับเปลี่ยนได้ตามความเหมาะสม
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Warning Messages */}
                                {assignAs === 'main' && isSelectedRoomLate && (
                                    <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl text-orange-800 flex gap-3">
                                        <span className="text-xl">⚠️</span>
                                        <div>
                                            <div className="font-bold text-sm">ต้องจัดหาห้องชั่วคราวเพิ่ม!</div>
                                            <div className="text-xs mt-1 opacity-90">ห้องนี้ยังไม่ว่างในวันเข้าพัก โปรดอัปเดต "ห้องชั่วคราว" ในภายหลัง</div>
                                        </div>
                                    </div>
                                )}

                                {assignAs === 'main' && isSelectedRoomExpireEarly && (
                                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl text-yellow-800 flex gap-3">
                                        <span className="text-xl">⚠️</span>
                                        <div>
                                            <div className="font-bold text-sm">ระวัง! ห้องนี้ว่างไม่จบสัญญา</div>
                                            <div className="text-xs mt-1 opacity-90">ว่างถึงแค่วันที่ {expireDateStr} อย่าลืมทำเรื่องย้ายห้องในภายหลัง</div>
                                        </div>
                                    </div>
                                )}

                                {/* 5. ปุ่ม Action */}
                                <div className="pt-4 mt-4 border-t border-gray-100 space-y-3">
                                    <button
                                        onClick={handleAllocate}
                                        disabled={isSubmitting || (assignAs === 'temp' && !tempEndDate)}
                                        className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 text-white py-3.5 rounded-xl font-bold text-sm transition-all shadow-md hover:shadow-lg disabled:shadow-none flex justify-center items-center gap-2"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                กำลังบันทึก...
                                            </>
                                        ) : (
                                            'ยืนยันสร้างสัญญาเช่า'
                                        )}
                                    </button>
                                    <button
                                        onClick={() => router.push('/')}
                                        className="w-full text-gray-500 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 py-3 rounded-xl text-sm font-bold transition-colors dark:hover:text-white"
                                    >
                                        ยกเลิก
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                )}
            </div>

            {/* Modal สำหรับแก้ไขการจัดสรรชั่วคราว */}
            {isEditingTempModal && tempContractId && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">แก้ไขการจัดสรรชั่วคราวที่มีอยู่</h2>
                            <button onClick={closeTempEditModal} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-2">
                                <div>
                                    <p className="text-xs text-amber-700 font-bold">ห้องชั่วคราว</p>
                                    <p className="text-sm text-amber-900 font-bold mt-0.5">ห้อง {rooms.find(r => r.id === allContracts.find(c => c.id === tempContractId)?.temp_room_id)?.room_number || 'ไม่พบข้อมูล'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-amber-700 font-bold">Contract ID</p>
                                    <p className="text-sm text-amber-900 font-mono mt-0.5">{tempContractId}</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-800 mb-2">📅 วันที่เริ่ม (Temp Start)</label>
                                <input
                                    type="date"
                                    className="w-full border border-gray-300 rounded-xl p-3 text-sm text-gray-900 dark:text-white bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                                    value={tempStartDate}
                                    onChange={(e) => setTempStartDate(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-800 mb-2">📅 วันที่สิ้นสุด (Temp End)</label>
                                <input
                                    type="date"
                                    className="w-full border border-gray-300 rounded-xl p-3 text-sm text-gray-900 dark:text-white bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                                    value={tempEndDate}
                                    onChange={(e) => setTempEndDate(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
                            <button
                                onClick={closeTempEditModal}
                                className="flex-1 px-4 py-2.5 text-sm font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors"
                            >
                                ยกเลิก
                            </button>
                            <button
                                onClick={async () => {
                                    if (!tempContractId) return;
                                    setIsSubmitting(true);
                                    const upd = { temp_start_date: tempStartDate || actualCheckInDate, temp_end_date: tempEndDate };
                                    const { error } = await supabase.from('contracts').update(upd).eq('id', tempContractId);
                                    if (error) {
                                        alert('ไม่สามารถอัปเดตสัญญาชั่วคราวได้: ' + error.message);
                                    } else {
                                        await logAudit(profile, 'contracts', 'update', tempContractId, 'แก้ไขวันที่สัญญาชั่วคราว', upd);
                                        alert('อัปเดตวันที่สัญญาชั่วคราวเรียบร้อย');
                                        closeTempEditModal();
                                    }
                                    setIsSubmitting(false);
                                }}
                                disabled={isSubmitting}
                                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-amber-600 rounded-xl hover:bg-amber-700 disabled:bg-amber-300 transition-colors"
                            >
                                {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}