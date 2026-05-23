'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
}

interface Room {
    id: string;
    room_number: string;
    room_type: string;
    kitchen_type: string;
    view_direction: string;
}

interface Booking {
    room_id?: string;
    actual_check_in_date?: string;
    actual_check_out_date?: string;
    contract_start_date?: string;
    contract_end_date?: string;
    // TODO: removed field - main_room_id (replaced by room_id)
    // TODO: removed field - main_start_date
    // TODO: removed field - main_end_date
    // TODO: removed field - temp_room_id
    // TODO: removed field - temp_start_date
    // TODO: removed field - temp_end_date
    // TODO: removed field - move_to_room_id
    // TODO: removed field - move_start_date
    // TODO: removed field - move_end_date
    // TODO: removed field - actual_end_date (replaced by actual_check_out_date)
}

export default function AllocateRoomPage() {
    const params = useParams();
    const router = useRouter();
    const waitlistId = params.id as string;

    const [waitlist, setWaitlist] = useState<Waitlist | null>(null);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [allBookings, setAllBookings] = useState<Booking[]>([]);

    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [actualCheckInDate, setActualCheckInDate] = useState<string>('');
    // TODO: removed field - temp_room_id (tempEndDate state removed)
    // TODO: removed field - temp_room_id (assignAs state removed — always 'main')

    useEffect(() => {
        if (waitlist) {
            setActualCheckInDate(waitlist.start_date);
        }
    }, [waitlist]);

    useEffect(() => {
        fetchData();
    }, [waitlistId]);

    // TODO: removed field - temp_room_id, temp_end_date (auto-calculate temp end date useEffect removed)

    async function fetchData() {
        setLoading(true);
        const { data: wData } = await supabase.from('waitlists').select('*').eq('id', waitlistId).single();
        if (wData) setWaitlist(wData);

        const { data: rData } = await supabase.from('rooms').select('*').order('room_number');
        if (rData) setRooms(rData);

        const { data: cData } = await supabase
            .from('bookings')
            .select('room_id, actual_check_in_date, actual_check_out_date, contract_start_date, contract_end_date')
            .neq('status', 'cancelled');
        if (cData) setAllBookings(cData);

        setLoading(false);
    }

    const getRoomOccupancyIntervals = (roomId: string, bookings: Booking[]) => {
        const intervals: { start: Date, end: Date }[] = [];

        bookings.forEach(c => {
            if (c.room_id === roomId) {
                const s = c.actual_check_in_date || c.contract_start_date;
                const e = c.actual_check_out_date || c.contract_end_date;
                if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
            }
            // TODO: removed field - temp_room_id, temp_start_date, temp_end_date (temp room interval removed)
            // TODO: removed field - move_to_room_id, move_start_date, move_end_date (move room interval removed)
        });

        return intervals;
    };

    const getRoomAvailability = (roomId: string, targetDateStr: string) => {
        const intervals = getRoomOccupancyIntervals(roomId, allBookings);

        intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
        const merged: { start: Date, end: Date }[] = [];
        intervals.forEach(curr => {
            if (merged.length === 0) {
                merged.push({ ...curr });
            } else {
                const prev = merged[merged.length - 1];
                if (curr.start <= prev.end) {
                    if (curr.end > prev.end) prev.end = curr.end;
                } else {
                    merged.push({ ...curr });
                }
            }
        });

        let availableFrom: Date;
        let availableUntil: Date | null = null;
        const target = new Date(targetDateStr);

        const overlapping = merged.find(i => target >= i.start && target < i.end);

        if (overlapping) {
            availableFrom = new Date(overlapping.end);
            const next = merged.find(i => i.start > availableFrom);
            availableUntil = next ? new Date(next.start) : null;
        } else {
            const prev = [...merged].reverse().find(i => i.end <= target);
            availableFrom = prev ? new Date(prev.end) : new Date(0);
            const next = merged.find(i => i.start > target);
            availableUntil = next ? new Date(next.start) : null;
        }

        return { availableFrom, availableUntil };
    };

    const getNextAvailableDate = (roomId: string, requestedStart: string) => {
        const intervals = getRoomOccupancyIntervals(roomId, allBookings);
        let currentStart = new Date(requestedStart);

        intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

        for (const interval of intervals) {
            if (currentStart >= interval.start && currentStart < interval.end) {
                currentStart = new Date(interval.end);
            }
        }

        const yyyy = currentStart.getFullYear();
        const mm = String(currentStart.getMonth() + 1).padStart(2, '0');
        const dd = String(currentStart.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const getRoomAvailabilityText = (roomId: string, targetDateStr: string) => {
        const { availableFrom, availableUntil } = getRoomAvailability(roomId, targetDateStr);

        const formatD = (d: Date) => d.toLocaleDateString('en-GB');
        const fromStr = availableFrom.getTime() === 0 || availableFrom <= new Date() ? 'ปัจจุบัน' : formatD(availableFrom);
        const untilStr = availableUntil ? formatD(availableUntil) : 'ไม่มีกำหนด';

        return `ว่าง : ${fromStr} - ${untilStr}`;
    };

    const handleAllocate = async () => {
        if (!selectedRoomId || !waitlist) return;
        setIsSubmitting(true);

        const bookingPayload: any = {
            waitlist_id: waitlistId,
            name: waitlist.name,
            actual_check_in_date: actualCheckInDate,
            contract_start_date: waitlist.start_date,
            contract_end_date: waitlist.end_date,
            room_id: selectedRoomId,
            status: 'active',
            // TODO: removed field - main_room_id (replaced by room_id)
            // TODO: removed field - main_start_date
            // TODO: removed field - main_end_date
            // TODO: removed field - temp_room_id, temp_start_date, temp_end_date
        };

        const { error: bookingError } = await supabase.from('bookings').insert([bookingPayload]);

        if (bookingError) {
            alert('เกิดข้อผิดพลาดในการสร้าง Booking: ' + bookingError.message);
            setIsSubmitting(false);
            return;
        }

        await supabase.from('waitlists').update({ status: 'จัดสรรห้องแล้ว' }).eq('id', waitlistId);

        alert('✅ จัดสรรห้องและสร้าง Booking สำเร็จ!');
        router.push('/bookings');
    };

    if (loading || !waitlist) return <div className="p-10 text-center text-gray-500">กำลังโหลดข้อมูล...</div>;

    const matchedRooms = rooms.filter(r =>
        (!waitlist.room_type || waitlist.room_type === 'ไม่ระบุ' || r.room_type === waitlist.room_type) &&
        (!waitlist.kitchen_type || waitlist.kitchen_type === 'ไม่ระบุ' || r.kitchen_type === waitlist.kitchen_type) &&
        (!waitlist.view_preference || waitlist.view_preference === 'ไม่ระบุ' || r.view_direction === waitlist.view_preference)
    );

    const perfectMatches: Room[] = [];
    const partialMatches: Room[] = [];
    const availableLaterMatches: Room[] = [];

    matchedRooms.forEach(room => {
        const { availableFrom, availableUntil } = getRoomAvailability(room.id, waitlist.start_date);
        const reqStart = new Date(waitlist.start_date);
        const reqEnd = new Date(waitlist.end_date);

        if (reqStart < availableFrom) {
            availableLaterMatches.push(room);
        } else if (availableUntil && reqEnd > availableUntil) {
            partialMatches.push(room);
        } else {
            perfectMatches.push(room);
        }
    });

    const otherRooms = rooms.filter(r => !matchedRooms.some(m => m.id === r.id));
    const alternativeMatches = otherRooms.filter(r => {
        const { availableFrom } = getRoomAvailability(r.id, waitlist.start_date);
        const reqStart = new Date(waitlist.start_date);
        return reqStart >= availableFrom;
    });

    let isSelectedRoomLate = false;
    let isSelectedRoomExpireEarly = false;
    let expireDateStr = '';

    if (selectedRoomId) {
        const { availableFrom, availableUntil } = getRoomAvailability(selectedRoomId, waitlist.start_date);
        const reqStart = new Date(waitlist.start_date);
        const reqEnd = new Date(waitlist.end_date);

        if (reqStart < availableFrom) {
            isSelectedRoomLate = true;
        } else if (availableUntil && reqEnd > availableUntil) {
            isSelectedRoomExpireEarly = true;
            expireDateStr = availableUntil.toLocaleDateString('en-GB');
        }
    }

    return (
        <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-8">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                    <div>
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
                            <span className="font-bold text-blue-700">{new Date(waitlist.start_date).toLocaleDateString('en-GB')} - {new Date(waitlist.end_date).toLocaleDateString('en-GB')}</span>
                        </div>
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
                                    onClick={() => { setSelectedRoomId(room.id); }}
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
                                        📅 {getRoomAvailabilityText(room.id, waitlist.start_date)}
                                    </div>
                                </div>
                            )) : (
                                <div className="p-5 text-center border border-dashed border-gray-300 rounded-xl text-gray-400 text-sm bg-gray-50">
                                    ไม่มีห้องที่ว่างตรงตามสเปคและครอบคลุมเวลาเป๊ะๆ ในขณะนี้
                                </div>
                            )}
                        </div>
                    </div>

                    {partialMatches.length > 0 && (
                        <div className="pt-4 border-t border-gray-200">
                            <h2 className="text-lg font-bold text-yellow-600 mb-3 flex items-center gap-2">
                                <span>⚠️</span> ห้องตรงสเปค ว่างพร้อมอยู่ (แต่ว่างไม่ครอบคลุมทั้งสัญญา)
                            </h2>
                            <div className="space-y-3">
                                {partialMatches.map(room => {
                                    const { availableUntil } = getRoomAvailability(room.id, waitlist.start_date);
                                    return (
                                        <div
                                            key={room.id}
                                            onClick={() => { setSelectedRoomId(room.id); }}
                                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-yellow-300'}`}
                                        >
                                            <div className="flex justify-between items-center">
                                                <div className="font-bold text-lg text-gray-900">ห้อง {room.room_number}</div>
                                                <div className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-md font-bold">
                                                    อยู่ได้ถึง {availableUntil ? availableUntil.toLocaleDateString('en-GB') : ''}
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-500 mt-2 flex gap-4">
                                                <span>🛏️ {room.room_type}</span>
                                                <span>🍳 {room.kitchen_type}</span>
                                                <span>🧭 {room.view_direction}</span>
                                            </div>
                                            <div className="text-xs font-semibold text-yellow-800 mt-3 bg-yellow-50 p-2 rounded-lg border border-yellow-100 inline-flex items-center gap-1.5 w-full">
                                                📅 {getRoomAvailabilityText(room.id, waitlist.start_date)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="pt-4 border-t border-gray-200">
                        <h2 className="text-lg font-bold text-orange-500 mb-3 flex items-center gap-2">
                            <span>⏳</span> ห้องตรงสเปค แต่ยังติดจอง (Available Later)
                        </h2>
                        <div className="space-y-3">
                            {availableLaterMatches.length > 0 ? availableLaterMatches.map(room => {
                                const nextAvailDate = getNextAvailableDate(room.id, waitlist.start_date);
                                return (
                                    <div
                                        key={room.id}
                                        onClick={() => { setSelectedRoomId(room.id); }}
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedRoomId === room.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-orange-200'}`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <div className="font-bold text-lg text-gray-900">ห้อง {room.room_number}</div>
                                            <div className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-md font-bold">
                                                ว่างวันที่ {new Date(nextAvailDate).toLocaleDateString('en-GB')}
                                            </div>
                                        </div>
                                        <div className="text-sm text-gray-500 mt-2 flex gap-4">
                                            <span>🛏️ {room.room_type}</span>
                                            <span>🍳 {room.kitchen_type}</span>
                                            <span>🧭 {room.view_direction}</span>
                                        </div>
                                        <div className="text-xs font-semibold text-orange-800 mt-3 bg-orange-50/50 p-2 rounded-lg border border-orange-100 inline-flex items-center gap-1.5 w-full">
                                            📅 {getRoomAvailabilityText(room.id, waitlist.start_date)}
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

                    <div className="pt-4 border-t border-gray-200 mt-6">
                        <h2 className="text-lg font-bold text-blue-500 mb-3 flex items-center gap-2">
                            <span>💡</span> ห้องทางเลือก (ไม่ตรงสเปค แต่เข้าอยู่ได้เลย)
                        </h2>
                        <div className="space-y-3">
                            {alternativeMatches.length > 0 ? alternativeMatches.map(room => (
                                <div
                                    key={room.id}
                                    onClick={() => { setSelectedRoomId(room.id); }}
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
                                        📅 {getRoomAvailabilityText(room.id, waitlist.start_date)}
                                    </div>
                                </div>
                            )) : (
                                <div className="p-5 text-center border border-dashed border-gray-300 rounded-xl text-gray-400 text-sm bg-gray-50">
                                    ไม่มีห้องอื่นที่ว่างในช่วงเวลานี้เลย
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* แผงควบคุมด้านขวา */}
                <div className="col-span-1">
                    <div className="bg-white p-5 md:p-6 rounded-2xl border border-gray-200 shadow-sm sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto">

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

                                {/* 2. วันที่เข้าพัก */}
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
                                        * กำหนดการตามสัญญาคือ {new Date(waitlist.start_date).toLocaleDateString('en-GB')}
                                    </p>
                                </div>

                                {/* TODO: removed field - temp_room_id (assignAs radio cards removed — always assigns as main room) */}
                                {/* TODO: removed field - temp_end_date (temp timeline section removed) */}

                                {/* Warning Messages */}
                                {isSelectedRoomLate && (
                                    <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl text-orange-800 flex gap-3">
                                        <span className="text-xl">⚠️</span>
                                        <div>
                                            <div className="font-bold text-sm">ห้องนี้ยังไม่ว่างในวันเข้าพัก!</div>
                                            <div className="text-xs mt-1 opacity-90">ห้องนี้ยังติดจองอยู่ในวันที่ลูกค้าต้องการเข้าพัก</div>
                                        </div>
                                    </div>
                                )}

                                {isSelectedRoomExpireEarly && (
                                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl text-yellow-800 flex gap-3">
                                        <span className="text-xl">⚠️</span>
                                        <div>
                                            <div className="font-bold text-sm">ระวัง! ห้องนี้ว่างไม่จบสัญญา</div>
                                            <div className="text-xs mt-1 opacity-90">ว่างถึงแค่วันที่ {expireDateStr}</div>
                                        </div>
                                    </div>
                                )}

                                {/* 3. ปุ่ม Action */}
                                <div className="pt-4 mt-4 border-t border-gray-100 space-y-3">
                                    <button
                                        onClick={handleAllocate}
                                        disabled={isSubmitting}
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
                                            'ยืนยันสร้าง Booking'
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
        </div>
    );
}