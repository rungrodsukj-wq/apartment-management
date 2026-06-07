'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { isOverlap, isRoomAvailable } from '../../lib/availability';

const pad = (value: number) => String(value).padStart(2, '0');

export default function AvailableRoomsPage() {
    const [rooms, setRooms] = useState<any[]>([]);
    const [contracts, setContracts] = useState<any[]>([]);
    const [waitlists, setWaitlists] = useState<any[]>([]);
    const [intentions, setIntentions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Default to next month
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2);

    useEffect(() => {
        if (new Date().getMonth() + 2 > 12) {
            setSelectedYear(new Date().getFullYear() + 1);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        const [{ data: rData }, { data: cData }, { data: wData }, { data: iData }] = await Promise.all([
            supabase.from('rooms').select('*').order('room_number'),
            supabase.from('contracts').select('*').neq('status', 'cancelled'),
            supabase.from('waitlists').select('*').neq('status', 'จัดสรรห้องแล้ว'),
            supabase.from('renewal_intentions').select('*'),
        ]);

        if (rData) setRooms(rData);
        if (cData) setContracts(cData);
        if (wData) setWaitlists(wData);
        if (iData) setIntentions(iData);
        setLoading(false);
    }

    const calculateEndDate = (startDate: string) => {
        const start = new Date(startDate);
        const end = new Date(start);
        end.setFullYear(start.getFullYear() + 1);
        end.setDate(end.getDate() - 1);
        return end.toISOString().split('T')[0];
    };

    const formatDateTH = (dateStr: string) => {
        if (!dateStr || dateStr === '2000-01-01' || dateStr === '2099-12-31') return null;
        return new Date(dateStr).toLocaleDateString('th-TH', {
            day: 'numeric', month: 'short', year: '2-digit'
        });
    };

    const checkStart = `${selectedYear}-${pad(selectedMonth)}-01`;
    const checkEnd = calculateEndDate(checkStart);

    // Build a set of room IDs that are locked because an existing contract
    // could reserve the room (tenant didn't explicitly mark 'not_renew').
    // Rule: any contract tied to a room that ends on/after `checkStart` and
    // whose renewal intention is missing or !== 'not_renew' should lock the room.
    const lockedRoomIds = useMemo(() => {
        const locked = new Set<string>();

        // Index intentions by contract id for quick lookup
        const byContract: Record<string, any> = {};
        intentions.forEach(i => { if (i.contract_id) byContract[i.contract_id] = i; });

        for (const c of contracts) {
            // consider main, temp and move_to room assignments
            const roomIds = [c.main_room_id, c.temp_room_id, c.move_to_room_id].filter(Boolean) as string[];
            if (roomIds.length === 0) continue;

            // determine contract end date to compare with our window
            const endDate = c.contract_end_date || c.main_end_date || c.temp_end_date || c.move_end_date;
            if (!endDate) continue;
            if (endDate < checkStart) continue;

            const intent = byContract[c.id];
            // lock if no intention or intention is not 'not_renew'
            if (!intent || intent.intention !== 'not_renew') {
                roomIds.forEach(rid => locked.add(rid));
            }
        }

        // also include any explicit intention that references a room directly
        for (const intent of intentions) {
            if (intent.room_id) {
                // if intention exists and is not 'not_renew', lock it
                if (!intent.intention || intent.intention !== 'not_renew') locked.add(intent.room_id);
            }
        }

        return locked;
    }, [intentions, contracts, checkStart]);

    const summary = useMemo(() => {
        // Exclude locked rooms (pending/renew intention) from available rooms
        const availableRooms = rooms.filter(r => isRoomAvailable(contracts, intentions, r.id, checkStart, checkEnd) && !lockedRoomIds.has(r.id));
        const overlappingWaitlists = waitlists.filter(w => isOverlap(checkStart, checkEnd, w.start_date, w.end_date));

        const roomTypes = [...new Set(rooms.map(r => r.room_type).filter(Boolean))];
        const res: Record<string, any> = {};

        for (const rt of roomTypes as string[]) {
            const rOfType = availableRooms.filter(r => r.room_type === rt);
            const wOfType = overlappingWaitlists.filter(w => w.room_type === rt);

            // Calculate breakdown by kitchen_type and view_direction
            const roomsOfTypeAll = rooms.filter(r => r.room_type === rt);
            const combos: { kitchen: string; view: string }[] = [];
            roomsOfTypeAll.forEach(r => {
                const k = r.kitchen_type || 'ไม่ระบุครัว';
                const v = r.view_direction || 'ไม่ระบุทิศ';
                if (!combos.some(c => c.kitchen === k && c.view === v)) {
                    combos.push({ kitchen: k, view: v });
                }
            });

            // Sort combos to be consistent
            combos.sort((a, b) => a.kitchen.localeCompare(b.kitchen) || a.view.localeCompare(b.view));

            const breakdown = combos.map(combo => {
                const physicalAvailable = rOfType.filter(r => (r.kitchen_type || 'ไม่ระบุครัว') === combo.kitchen && (r.view_direction || 'ไม่ระบุทิศ') === combo.view).length;
                const waitlistsMatching = wOfType.filter(w => (w.kitchen_type || 'ไม่ระบุครัว') === combo.kitchen && (w.view_preference || 'ไม่ระบุทิศ') === combo.view).length;
                const net = physicalAvailable - waitlistsMatching;
                const totalRoomsInCombo = roomsOfTypeAll.filter(r => (r.kitchen_type || 'ไม่ระบุครัว') === combo.kitchen && (r.view_direction || 'ไม่ระบุทิศ') === combo.view).length;
                return {
                    kitchen: combo.kitchen,
                    view: combo.view,
                    total: totalRoomsInCombo,
                    available: physicalAvailable,
                    waitlist: waitlistsMatching,
                    net: Math.max(0, net)
                };
            });

            res[rt] = {
                totalRooms: roomsOfTypeAll.length,
                totalAvailable: rOfType.length,
                waitlistCount: wOfType.length,
                netAvailable: rOfType.length - wOfType.length,
                rooms: rOfType,
                waitlists: wOfType,
                breakdown
            };
        }
        return res;
    }, [rooms, contracts, waitlists, checkStart, checkEnd]);

    const matrixData = useMemo(() => {
        const rowTypes = [
            { key: 'One Bedroom', display: 'ONE BEDROOM' },
            { key: 'One Bedroom Exclusive', display: 'ONE BED EXCLUSIVE' },
            { key: 'One Bedroom Suite', display: 'ONE BED SUITE' },
            { key: 'Triple Bedroom', display: 'TRIPLE BEDROOM' }
        ];

        // Also exclude locked rooms in the matrix
                const availableRooms = rooms.filter(r => isRoomAvailable(contracts, intentions, r.id, checkStart, checkEnd) && !lockedRoomIds.has(r.id));
        const overlappingWaitlists = waitlists.filter(w => isOverlap(checkStart, checkEnd, w.start_date, w.end_date));

        return rowTypes.map(rt => {
            const rOfType = rooms.filter(r => r.room_type === rt.key);
            const wOfType = overlappingWaitlists.filter(w => w.room_type === rt.key);

            const getCellData = (kitchen: string | null, view: string | null) => {
                // Handle unspecified: both kitchen and view must be null/undefined
                const isUnspecified = kitchen === null && view === null;
                
                if (isUnspecified) {
                    const total = rOfType.filter(r => !r.kitchen_type && !r.view_direction).length;
                    const physicalAvailable = availableRooms.filter(r => r.room_type === rt.key && !r.kitchen_type && !r.view_direction).length;
                    const waitlistMatches = wOfType.filter(w => !w.kitchen_type && !w.view_preference).length;
                    const net = Math.max(0, physicalAvailable - waitlistMatches);
                    return { total, available: physicalAvailable, waitlist: waitlistMatches, net };
                }

                const total = rOfType.filter(r => (r.kitchen_type || null) === kitchen && (r.view_direction || null) === view).length;
                const physicalAvailable = availableRooms.filter(r => r.room_type === rt.key && (r.kitchen_type || null) === kitchen && (r.view_direction || null) === view).length;
                const waitlistMatches = wOfType.filter(w => (w.kitchen_type || null) === kitchen && (w.view_preference || null) === view).length;
                const net = Math.max(0, physicalAvailable - waitlistMatches);
                return { total, available: physicalAvailable, waitlist: waitlistMatches, net };
            };

            const totalAvailable = availableRooms.filter(r => r.room_type === rt.key).length;
            const netQuota = Math.max(0, totalAvailable - wOfType.length);

            return {
                ...rt,
                waitlistCount: wOfType.length,
                totalAvailable,
                netQuota,
                frontWest: getCellData('ครัวหน้า', 'ทิศตะวันตก'),
                frontEast: getCellData('ครัวหน้า', 'ทิศตะวันออก'),
                backWest: getCellData('ครัวหลัง', 'ทิศตะวันตก'),
                backEast: getCellData('ครัวหลัง', 'ทิศตะวันออก'),
                unspecified: getCellData(null, null),
            };
        });
    }, [rooms, contracts, waitlists, checkStart, checkEnd]);

    const monthsTH = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];

    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear + 1, currentYear + 2];

    return (
        <div className="min-h-full flex flex-col bg-transparent">
            <div className="flex-1 p-8 md:p-10">

                {/* Date Picker Card */}
                <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 mb-8 max-w-2xl">
                    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-[#4F81FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        เลือกรอบบิลเดือนที่ลูกค้าต้องการเข้าพัก
                    </h2>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-slate-500 mb-2">เดือน</label>
                            <select
                                className="w-full bg-slate-50 border border-black rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 outline-none transition-all cursor-pointer"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                            >
                                {monthsTH.map((m, i) => (
                                    <option key={i} value={i + 1}>{m}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-slate-500 mb-2">ปี (ค.ศ.)</label>
                            <select
                                className="w-full bg-slate-50 border border-black rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 outline-none transition-all cursor-pointer"
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(Number(e.target.value))}
                            >
                                {years.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-4 bg-slate-50 p-3 rounded-lg border border-slate-100 inline-block">
                        <span className="font-semibold text-slate-600">ระยะเวลาคำนวณ 1 ปี:</span> {formatDateTH(checkStart)} - {formatDateTH(checkEnd)}
                    </p>
                </div>

                {loading ? (
                    <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div></div>
                ) : (
                    <>
                        {/* Locked rooms notice */}
                        {lockedRoomIds.size > 0 && (
                            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6">
                                <span className="text-2xl shrink-0">🔒</span>
                                <div>
                                    <p className="text-sm font-bold text-amber-800">
                                        {lockedRoomIds.size} ห้อง ถูกล็อคอยู่ — ยังไม่นำมาคำนวณ
                                    </p>
                                    <p className="text-xs text-amber-600 mt-0.5">
                                        ลูกบ้านยังไม่แจ้งความประสงค์ (Pending) หรือต้องการต่อสัญญา — ไปที่หน้า <a href="/renewal-check" className="font-bold underline hover:text-amber-800">สอบถามต่อสัญญา</a> เพื่ออัปเดตสถานะ
                                    </p>
                                </div>
                            </div>
                        )}

                        <h2 className="text-lg font-bold text-[#0A2647] mb-4">สรุปห้องว่าง (หักคิวจองล่วงหน้าแล้ว)</h2>

                        <div className="bg-white rounded-[2rem] shadow-lg border border-slate-200 overflow-hidden mb-10">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-left text-sm text-slate-700 border-collapse border border-slate-200">
                                    <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase tracking-wider">
                                        <tr>
                                            <th rowSpan={3} className="p-4 bg-gradient-to-br from-slate-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center align-middle rounded-tl-[1.5rem]">
                                                TYPE ROOM
                                            </th>
                                            <th rowSpan={3} className="p-4 bg-gradient-to-br from-amber-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center align-middle max-w-[150px]">
                                                โควต้าจองไม่ระบุห้อง<br />(Waitlists ทั้งหมด)
                                            </th>
                                            <th colSpan={2} className="p-3 bg-gradient-to-br from-sky-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center">
                                                ครัวหน้า
                                            </th>
                                            <th colSpan={2} className="p-3 bg-gradient-to-br from-rose-100 to-white text-slate-800 font-bold border-r border-slate-200 text-center">
                                                ครัวหลัง
                                            </th>
                                            <th rowSpan={3} className="p-4 bg-gradient-to-br from-purple-100 to-white text-slate-800 font-bold text-center align-middle rounded-tr-[1.5rem] border-slate-200">
                                                ไม่ระบุ<br />ครัว/ทิศ
                                            </th>
                                        </tr>
                                        <tr>
                                            <th colSpan={2} className="p-2 bg-slate-100 text-slate-600 text-xs font-bold border-r border-slate-200 text-center">
                                                View
                                            </th>
                                            <th colSpan={2} className="p-2 bg-slate-100 text-slate-600 text-xs font-bold border-r border-slate-200 text-center">
                                                View
                                            </th>
                                        </tr>
                                        <tr>
                                            <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                SALAYA ONE RESIDENCES<br />(ตะวันตก)
                                            </th>
                                            <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                ซอยตั้งสิน<br />(ตะวันออก)
                                            </th>
                                            <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                SALAYA ONE RESIDENCES<br />(ตะวันตก)
                                            </th>
                                            <th className="p-3 bg-slate-50 text-slate-700 text-[10px] font-bold border-r border-slate-200 text-center max-w-[160px]">
                                                ซอยตั้งสิน<br />(ตะวันออก)
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white">
                                        {matrixData.map((row) => {
                                            const renderCell = (cell: any) => {
                                                const isSoldOut = cell.net <= 0;
                                                return (
                                                    <td className="p-4 text-center align-top border border-slate-200">
                                                        <div className={`text-base font-black ${isSoldOut ? 'text-slate-400' : 'text-[#4F81FF]'}`}>
                                                            {cell.net} <span className="text-xs font-normal text-slate-500">ห้อง</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-1">
                                                            (ว่าง {cell.available} / ทั้งหมด {cell.total})
                                                        </div>
                                                        {cell.waitlist > 0 && (
                                                            <div className="mt-2 inline-flex items-center justify-center rounded-full bg-amber-100 px-2 py-1 text-[9px] font-semibold text-amber-700">
                                                                -{cell.waitlist} waitlist
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            };

                                            return (
                                                <tr key={row.key} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="p-4 font-bold text-slate-800 border border-slate-200 bg-slate-50/80 rounded-l-3xl">{row.display}</td>
                                                    <td className="p-4 border border-slate-200 text-center bg-slate-50/80">
                                                        <div className={`text-base font-black ${row.netQuota <= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                            {row.netQuota} <span className="text-xs font-normal text-slate-500">ห้อง</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                                            (ว่าง {row.totalAvailable} / หักจองไม่ระบุห้อง {row.waitlistCount})
                                                        </div>
                                                    </td>
                                                    {renderCell(row.frontWest)}
                                                    {renderCell(row.frontEast)}
                                                    {renderCell(row.backWest)}
                                                    {renderCell(row.backEast)}
                                                    <td className="p-4 text-center align-top border border-slate-200 rounded-r-3xl">
                                                        <div className={`text-base font-black ${row.unspecified.net <= 0 ? 'text-slate-400' : 'text-purple-600'}`}>
                                                            {row.unspecified.net} <span className="text-xs font-normal text-slate-500">ห้อง</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-1">
                                                            (ว่าง {row.unspecified.available} / ทั้งหมด {row.unspecified.total})
                                                        </div>
                                                        {row.unspecified.waitlist > 0 && (
                                                            <div className="mt-2 inline-flex items-center justify-center rounded-full bg-purple-100 px-2 py-1 text-[9px] font-semibold text-purple-700">
                                                                -{row.unspecified.waitlist} waitlist
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <h2 className="text-lg font-bold text-[#0A2647] mb-4">รายละเอียดห้องที่ว่าง</h2>
                        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-slate-600">
                                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 text-xs uppercase tracking-wider">
                                        <tr>
                                            <th className="p-5 pl-8">หมายเลขห้อง</th>
                                            <th className="p-5">ประเภทห้อง</th>
                                            <th className="p-5">รายละเอียด</th>
                                            <th className="p-5">ตึก / ชั้น</th>
                                            <th className="p-5">สถานะคิวรอ</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {Object.entries(summary).flatMap(([rt, data]: [string, any]) => {
                                            return data.rooms.map((room: any, index: number) => {
                                                // Check if this room might be consumed by waitlist
                                                const isAtRisk = index >= data.netAvailable && data.waitlistCount > 0;

                                                return (
                                                    <tr key={room.id} className={`hover:bg-slate-50/50 transition-colors ${isAtRisk ? 'bg-amber-50/30' : ''}`}>
                                                        <td className="p-5 pl-8">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-base ${isAtRisk ? 'bg-amber-100 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                                                                    {room.room_number.charAt(0)}
                                                                </div>
                                                                <span className="font-bold text-slate-800 text-lg">{room.room_number}</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-5">
                                                            <span className="bg-slate-50 text-slate-600 border border-black/60 text-xs px-3 py-1.5 rounded-lg font-medium">
                                                                🛏️ {room.room_type || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="p-5">
                                                            <div className="flex flex-col gap-1">
                                                                <span className="text-xs text-slate-500">🍳 {room.kitchen_type || '-'}</span>
                                                                <span className="text-xs text-slate-500">🌅 {room.view_direction || '-'}</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-5 font-medium text-slate-600">
                                                            ตึก {room.building || '-'} · ชั้น {room.floor || '-'}
                                                        </td>
                                                        <td className="p-5">
                                                            {isAtRisk ? (
                                                                <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-600 border border-amber-200/60 text-xs px-3 py-1.5 rounded-lg font-bold">
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                                                    อาจโดนดึงไปให้ Waitlist
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200/60 text-xs px-3 py-1.5 rounded-lg font-bold">
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                                                    ว่างพร้อมปล่อยเช่า
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            });
                                        })}
                                        {Object.values(summary).every((data: any) => data.rooms.length === 0) && (
                                            <tr>
                                                <td colSpan={5} className="p-10 text-center text-slate-500">
                                                    <div className="text-4xl mb-3">📭</div>
                                                    <p className="font-medium text-lg">ไม่มีห้องว่างในช่วงเวลานี้</p>
                                                    <p className="text-sm mt-1">ลองเปลี่ยนเดือน/ปีเพื่อค้นหาใหม่</p>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
