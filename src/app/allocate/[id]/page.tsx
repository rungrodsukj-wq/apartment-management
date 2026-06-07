'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { getRoomOccupancyIntervals, getRoomAvailability, getNextAvailableDate, getRoomAvailabilityText } from '../../../lib/availability';
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
    actual_check_in_date?: string;
    contract_start_date?: string;
    contract_end_date?: string;
}

export default function AllocateRoomPage() {
    const { profile, loading: authLoading } = useAuth();
    const params = useParams();
    const router = useRouter();
    const waitlistId = params.id as string;

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

        const { data: rData } = await supabase.from('rooms').select('*').order('room_number');
        if (rData) setRooms(rData);

        const { data: cData } = await supabase
            .from('contracts')
            .select('main_room_id, main_start_date, main_end_date, temp_room_id, temp_start_date, temp_end_date, move_to_room_id, move_start_date, move_end_date, actual_check_in_date, contract_start_date, contract_end_date')
            .neq('status', 'cancelled');
        if (cData) setAllContracts(cData);

        const { data: iData } = await supabase.from('renewal_intentions').select('*');
        if (iData) setIntentions(iData);

        setLoading(false);
    }

    

    const getSearchStartDate = () => {
        if (assignAs === 'main' && tempContractId && tempEndDate) {
            return tempEndDate;
        }
        return waitlist?.start_date ?? '';
    };

    const handleAllocate = async () => {
        if (!selectedRoomId || !waitlist) return;
        setIsSubmitting(true);

        const referenceStart = assignAs === 'main' && tempContractId && tempEndDate ? tempEndDate : waitlist.start_date;
        const { availableFrom } = getRoomAvailability(allContracts, selectedRoomId, referenceStart);
        const reqStart = new Date(referenceStart);
        const isLate = reqStart < availableFrom;

        const finalMainStartDate = isLate
            ? getNextAvailableDate(allContracts, selectedRoomId, referenceStart)
            : (assignAs === 'main' && tempContractId && tempEndDate ? referenceStart : actualCheckInDate);

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
                const { error: updateErr } = await supabase.from('contracts').update(updatePayload).eq('id', tempContractId);
                if (updateErr) {
                    alert('เกิดข้อผิดพลาดในการอัปเดตสัญญา: ' + updateErr.message);
                    setIsSubmitting(false);
                    return;
                }
                insertedContractId = tempContractId;
                await logAudit(profile, 'contracts', 'update', tempContractId, 'อัปเดตสัญญา เพิ่มห้องหลักให้กับสัญญาที่มีอยู่', updatePayload);
            } else {
                const contractPayload = { ...basePayload, main_room_id: selectedRoomId, main_start_date: finalMainStartDate, main_end_date: waitlist.end_date };
                const { data: contractData, error: contractError } = await supabase.from('contracts').insert([contractPayload]).select('id');
                if (contractError) {
                    alert('เกิดข้อผิดพลาดในการสร้างสัญญา: ' + contractError.message);
                    setIsSubmitting(false);
                    return;
                }
                insertedContractId = contractData?.[0]?.id ?? null;
                if (insertedContractId) await logAudit(profile, 'contracts', 'create', insertedContractId, 'จัดสรรห้องให้ waitlist และสร้างสัญญา', contractPayload);
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
            } else {
                const { data: contractData, error: contractError } = await supabase.from('contracts').insert([{ ...basePayload, ...tempFields }]).select('id');
                if (contractError) {
                    alert('เกิดข้อผิดพลาดในการสร้างสัญญา: ' + contractError.message);
                    setIsSubmitting(false);
                    return;
                }
                insertedContractId = contractData?.[0]?.id ?? null;
                if (insertedContractId) await logAudit(profile, 'contracts', 'create', insertedContractId, 'จัดสรรห้องชั่วคราวให้ waitlist และสร้างสัญญา (ชั่วคราว)', { ...basePayload, ...tempFields });
                setTempContractId(insertedContractId);
            }

            if (insertedContractId) {
                const room = rooms.find(r => r.id === selectedRoomId);
                const roomLabel = room ? `ห้อง ${room.room_number}` : selectedRoomId;
                const note = `จัดสรรห้องชั่วคราว: ${roomLabel}`;
                const { error: wlErr } = await supabase.from('waitlists').update({ status: 'จัดสรรชั่วคราว', allocation_note: note }).eq('id', waitlistId);
                if (!wlErr) {
                    await logAudit(profile, 'waitlists', 'update', waitlistId, 'อัปเดตสถานะ waitlist เป็นจัดสรรชั่วคราว และเพิ่มโน้ต (allocation_note)', { status: 'จัดสรรชั่วคราว', allocation_note: note, contract_id: insertedContractId });
                    setWaitlist({ ...waitlist, status: 'จัดสรรชั่วคราว', allocation_note: note });
                }
            }
        }

        alert(`✅ จัดสรร${assignAs === 'main' ? 'ห้องหลัก' : 'ห้องชั่วคราว'} และสร้างสัญญาสำเร็จ!` + (assignAs === 'temp' ? ' รายการ waitlist จะยังไม่ปิดจนกว่าจะเลือกห้องหลัก' : ''));
        router.push(assignAs === 'main' ? '/bookings' : '/waitlists');
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

    // Build locked rooms set: any contract that ends on/after searchStartDate and
    // whose intention is missing or not 'not_renew' will lock the associated room(s).
    const lockedRoomIds = (() => {
        const locked = new Set<string>();
        if (!searchStartDate) return locked;

        const byContract: Record<string, any> = {};
        intentions.forEach(i => { if (i.contract_id) byContract[i.contract_id] = i; });

        for (const c of allContracts) {
            const roomIds = [c.main_room_id, c.temp_room_id, c.move_to_room_id].filter(Boolean) as string[];
            if (roomIds.length === 0) continue;

            const endDate = c.contract_end_date || c.main_end_date || c.temp_end_date || c.move_end_date;
            if (!endDate) continue;
            if (endDate < searchStartDate) continue;

            const intent = c.id ? byContract[c.id] : undefined;
            if (!intent || intent.intention !== 'not_renew') {
                roomIds.forEach(rid => locked.add(rid));
            }
        }

        for (const intent of intentions) {
            if (intent.room_id) {
                if (!intent.intention || intent.intention !== 'not_renew') locked.add(intent.room_id);
            }
        }

        return locked;
    })();

    const roomsL = rooms.filter(r => r.building === 'L');

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
                        <h1 className="text-2xl font-bold text-gray-900 mb-1">จัดสรรห้องให้คุณ {waitlist.name}</h1>
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
                            <span className="font-bold text-blue-700">{new Date(waitlist.start_date).toLocaleDateString('th-TH')} - {new Date(waitlist.end_date).toLocaleDateString('th-TH')}</span>
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
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="col-span-1 lg:col-span-2 space-y-6">
                    <div>
                        <h2 className="text-lg font-bold text-green-600 mb-3 flex items-center gap-2">
                            <span>✨</span> ห้องว่างตรงตามกำหนด (Perfect Match)
                        </h2>
                        <div className="space-y-3">
                            {perfectMatches.length > 0 ? perfectMatches.map(room => (
                                <div
                                    key={room.id}
                                    // 🌟 เลือกให้เป็น Main Room
                                    onClick={() => { setSelectedRoomId(room.id); setAssignAs('main'); }}
                                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'}`}
                                >
                                    <div className="flex justify-between items-center">
                                        <div className="font-bold text-lg text-gray-900">ห้อง {room.room_number}</div>
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
                                </div>
                            )) : (
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
                                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-yellow-300'}`}
                                        >
                                            <div className="flex justify-between items-center">
                                                <div className="font-bold text-lg text-gray-900">ห้อง {room.room_number}</div>
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
                                    onClick={() => { setSelectedRoomId(room.id); setAssignAs('main'); }}
                                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all opacity-80 hover:opacity-100 ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-blue-300'}`}
                                >
                                    <div className="flex justify-between items-center">
                                        <div className="font-bold text-lg text-gray-900">ห้อง {room.room_number}</div>
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
                            <span>⏳</span> ห้องตรงสเปค แต่ยังติดจอง (Available Later)
                        </h2>
                        <div className="space-y-3">
                            {availableLaterMatches.length > 0 ? availableLaterMatches.map(room => {
                                const nextAvailDate = getNextAvailableDate(allContracts, room.id, waitlist.start_date);
                                return (
                                    <div
                                        key={room.id}
                                        // 🌟 เลือกให้เป็น Main Room
                                        onClick={() => { setSelectedRoomId(room.id); setAssignAs('main'); }}
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-orange-200'}`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <div className="font-bold text-lg text-gray-900">ห้อง {room.room_number}</div>
                                            <div className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-md font-bold">
                                                ว่างวันที่ {new Date(nextAvailDate).toLocaleDateString('th-TH')}
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
                <div className="col-span-1">
                    <div className="bg-white p-5 md:p-6 rounded-2xl border border-gray-200 shadow-sm sticky top-8 max-h-160 overflow-y-auto">
                        <h3 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-3 mb-5 sticky top-0 bg-white z-10">
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
                                        📅 วันที่เข้าพักจริง (Actual Check-in)
                                    </label>
                                    <input
                                        type="date"
                                        className="w-full border border-gray-300 rounded-xl p-3 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 transition-shadow outline-none"
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
                                            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500'
                                            : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'
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
                                                    <span className="block text-sm font-bold text-gray-900 flex items-center gap-2">
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
                                        <label className={`relative flex cursor-pointer rounded-xl border p-4 shadow-sm focus:outline-none transition-all ${assignAs === 'temp'
                                            ? 'bg-purple-50 border-purple-500 ring-1 ring-purple-500'
                                            : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'
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
                                    </div>
                                </div>

                                {/* 4. Timeline ห้องชั่วคราว (แสดงเฉพาะตอนเลือก Temp) */}
                                {assignAs === 'temp' && (
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
                                        className="w-full text-gray-500 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 py-3 rounded-xl text-sm font-bold transition-colors"
                                    >
                                        ยกเลิก
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal สำหรับแก้ไขการจัดสรรชั่วคราว */}
            {isEditingTempModal && tempContractId && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-gray-900">แก้ไขการจัดสรรชั่วคราวที่มีอยู่</h2>
                            <button onClick={closeTempEditModal} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                                <p className="text-xs text-amber-700 font-bold">Contract ID</p>
                                <p className="text-sm text-amber-900 font-mono mt-1">{tempContractId}</p>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-800 mb-2">📅 วันที่เริ่ม (Temp Start)</label>
                                <input
                                    type="date"
                                    className="w-full border border-gray-300 rounded-xl p-3 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                                    value={tempStartDate}
                                    onChange={(e) => setTempStartDate(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-800 mb-2">📅 วันที่สิ้นสุด (Temp End)</label>
                                <input
                                    type="date"
                                    className="w-full border border-gray-300 rounded-xl p-3 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-amber-500 outline-none transition-all"
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