// src/app/bookings/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

const pad = (value: number) => String(value).padStart(2, '0');
const parseDateFromYYYYMMDD = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
};
const formatDateInput = (date: Date) => {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const addDays = (dateStr: string, days: number) => {
    const d = parseDateFromYYYYMMDD(dateStr);
    d.setDate(d.getDate() + days);
    return formatDateInput(d);
};
const addYears = (dateStr: string, years: number) => {
    const d = parseDateFromYYYYMMDD(dateStr);
    d.setFullYear(d.getFullYear() + years);
    return formatDateInput(d);
};
const isValidDateRange = (start: string, end: string) => {
    return !!start && !!end && parseDateFromYYYYMMDD(start).getTime() <= parseDateFromYYYYMMDD(end).getTime();
};

export default function BookingsPage() {
    const [contracts, setContracts] = useState<any[]>([]);
    const [rooms, setRooms] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState<any>(null);
    const [editRoomPicker, setEditRoomPicker] = useState<'temp' | 'main' | 'move' | null>(null);

    // ── NEW: Create booking state ──
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createForm, setCreateForm] = useState<any>({
        tenant_name: '',
        actual_check_in_date: '',
        contract_start_date: '',
        contract_end_date: '',
        main_room_id: '',
        main_start_date: '',
        main_end_date: '',
        has_temp_room: false,
        temp_room_id: '',
        temp_start_date: '',
        temp_end_date: '',
        status: 'active',
    });
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [cancelContractId, setCancelContractId] = useState<string | null>(null);
    const [cancelEndDate, setCancelEndDate] = useState(formatDateInput(new Date()));
    const [cancelTenantName, setCancelTenantName] = useState('');

    const [roomFilters, setRoomFilters] = useState({
        building: '',
        floor: '',
        kitchen: '',
        view: '',
    });

    const [waitlists, setWaitlists] = useState<any[]>([]);

    const buildingOptions = Array.from(new Set(rooms.map((r: any) => r.building).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));
    const floorOptions = Array.from(new Set(rooms.map((r: any) => r.floor != null ? String(r.floor) : '').filter(Boolean))).sort((a, b) => Number(a) - Number(b));
    const kitchenOptions = Array.from(new Set(rooms.map((r: any) => r.kitchen_type).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));
    const viewOptions = Array.from(new Set(rooms.map((r: any) => r.view_direction).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));

    const applyRoomFilters = (room: any) => {
        if (roomFilters.building && room.building !== roomFilters.building) return false;
        if (roomFilters.floor && String(room.floor) !== roomFilters.floor) return false;
        if (roomFilters.kitchen && room.kitchen_type !== roomFilters.kitchen) return false;
        if (roomFilters.view && room.view_direction !== roomFilters.view) return false;
        return true;
    };

    const refreshContractStatuses = async (contractRows: any[]) => {
        const today = formatDateInput(new Date());
        const activeToCompleteIds = contractRows
            .filter((c: any) => c.status === 'active' && c.contract_end_date && c.contract_end_date < today)
            .map((c: any) => c.id);
        const upcomingToActiveIds = contractRows
            .filter((c: any) => c.status === 'upcoming' && c.contract_start_date && c.contract_start_date <= today)
            .map((c: any) => c.id);

        if (activeToCompleteIds.length === 0 && upcomingToActiveIds.length === 0) {
            return false;
        }

        if (activeToCompleteIds.length > 0) {
            const { error } = await supabase
                .from('contracts')
                .update({ status: 'completed' })
                .in('id', activeToCompleteIds);
            if (error) console.warn('Failed to complete expired contracts', error.message);
        }

        if (upcomingToActiveIds.length > 0) {
            const { error } = await supabase
                .from('contracts')
                .update({ status: 'active' })
                .in('id', upcomingToActiveIds);
            if (error) console.warn('Failed to activate upcoming contracts', error.message);
        }

        return true;
    };

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        const { data: cData } = await supabase.from('contracts').select('*').order('created_at', { ascending: false });
        const { data: rData } = await supabase.from('rooms').select('*').order('room_number');
        const { data: wData } = await supabase.from('waitlists').select('*');

        const roomData = rData || [];
        if (rData) setRooms(rData);
        if (wData) setWaitlists(wData);

        if (cData) {
            const sortedContracts = sortContractsByCurrentRoom(cData, roomData);
            setContracts(sortedContracts);
            const refreshed = await refreshContractStatuses(cData);
            if (refreshed) {
                const { data: refreshedCData } = await supabase.from('contracts').select('*').order('created_at', { ascending: false });
                if (refreshedCData) {
                    setContracts(sortContractsByCurrentRoom(refreshedCData, roomData));
                }
            }
        }
        setLoading(false);
    }

    const getRoomNumber = (roomId: string) => {
        if (!roomId) return '-';
        const room = rooms.find(r => r.id === roomId);
        if (!room) return 'ไม่ทราบ';
        return `${room.room_number} ${room.room_type ? `(${room.room_type})` : ''}`;
    };

    const getonlyRoomNumber = (roomId: string) => {
        if (!roomId) return '-';
        const room = rooms.find(r => r.id === roomId);
        if (!room) return 'ไม่ทราบ';
        return `${room.room_number}`;
    };

    const getCurrentRoomId = (contract: any) => {
        const today = formatDateInput(new Date());
        const isDateInRange = (start?: string, end?: string) => {
            return !!start && !!end && start <= today && today <= end;
        };

        if (contract.move_to_room_id && isDateInRange(contract.move_start_date, contract.move_end_date)) {
            return contract.move_to_room_id;
        }
        if (contract.temp_room_id && isDateInRange(contract.temp_start_date, contract.temp_end_date)) {
            return contract.temp_room_id;
        }
        return contract.main_room_id || '';
    };

    const sortContractsByCurrentRoom = (contractsToSort: any[], roomData: any[]) => {
        const resolveRoomKey = (roomId: string) => {
            if (!roomId) return '~~~~';
            const room = roomData.find((r: any) => r.id === roomId);
            if (!room) return 'zzzz';
            const roomNumber = String(room.room_number || '').padStart(10, '0');
            const building = room.building || '';
            const floor = room.floor != null ? String(room.floor).padStart(2, '0') : '';
            return `${roomNumber}|${building}|${floor}`;
        };

        return [...contractsToSort].sort((a, b) => {
            const roomA = getCurrentRoomId(a);
            const roomB = getCurrentRoomId(b);
            const keyA = resolveRoomKey(roomA);
            const keyB = resolveRoomKey(roomB);
            if (keyA < keyB) return -1;
            if (keyA > keyB) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
    };

    const renderRoomButtonGrid = (
        roomList: any[],
        selectedId: string | null | undefined,
        onSelect: (roomId: string) => void,
        options?: { searchStart?: string; searchEnd?: string }
    ) => {
        if (!roomList.length) {
            return <p className="text-sm text-slate-500">ไม่มีห้องให้เลือกในช่วงเวลาที่กำหนด</p>;
        }

        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {roomList.map((room) => {
                    const isSelected = selectedId === room.id;
                    const freeWindow = options?.searchStart && options?.searchEnd
                        ? getRoomFreeWindow(room.id, options.searchStart, options.searchEnd)
                        : null;
                    const formatWindowDate = (date: string) => formatDateTH(date) || null;
                    return (
                        <button
                            key={room.id}
                            type="button"
                            onClick={() => onSelect(room.id)}
                            className={`text-left rounded-3xl p-5 min-h-[150px] border transition-all ${isSelected ? 'border-[#4F81FF] bg-blue-50 shadow-lg shadow-blue-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                        >
                            <p className="text-base font-semibold text-slate-900">ห้อง {room.room_number}</p>
                            <div className="mt-3 text-sm text-slate-600 leading-6 space-y-1">
                                <p>{room.room_type || '-'} | ครัว{room.kitchen_type || '-'} | วิว{room.view_direction || '-'}</p>
                                <p>{room.building ? `ตึก ${room.building}` : 'ตึก -'} · {room.floor != null ? `ชั้น ${room.floor}` : 'ชั้น -'}</p>
                                {freeWindow && (
                                    <p className="text-xs text-slate-500">
                                        ว่าง: {formatWindowDate(freeWindow.start) ?? 'ตั้งแต่ต้น'} — {formatWindowDate(freeWindow.end) ?? 'ไม่มีกำหนด'}
                                    </p>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        );
    };

    const handleCreateStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (!raw) {
            setCreateForm({
                ...createForm,
                contract_start_date: '',
                contract_end_date: '',
                main_start_date: '',
                main_end_date: '',
            });
            return;
        }

        const [year, month] = raw.split('-');
        const startDate = `${year}-${month}-01`;
        const newEndDate = addDays(addYears(startDate, 1), -1);
        setCreateForm({
            ...createForm,
            contract_start_date: startDate,
            contract_end_date: newEndDate,
            actual_check_in_date: startDate,
            main_start_date: startDate,
            main_end_date: newEndDate,
        });
    };

    const handleEditClick = (contract: any) => {
        setEditForm({
            ...contract,
            has_temp_room: !!contract.temp_room_id
        });
        setEditRoomPicker(null);
        setIsEditModalOpen(true);
    };

    const openCancelModal = (contract: any) => {
        setCancelContractId(contract.id);
        setCancelTenantName(contract.tenant_name || '');
        setCancelEndDate(formatDateInput(new Date()));
        setIsCancelModalOpen(true);
    };

    const handleCancelContract = async () => {
        if (!cancelContractId) return;

        const { error } = await supabase
            .from('contracts')
            .update({ status: 'cancelled', actual_end_date: cancelEndDate })
            .eq('id', cancelContractId);

        if (error) {
            alert('เกิดข้อผิดพลาดในการยกเลิก: ' + error.message);
        } else {
            setIsCancelModalOpen(false);
            setCancelContractId(null);
            setCancelTenantName('');
            alert('ยกเลิกสัญญาเรียบร้อยแล้ว');
            fetchData();
        }
    };

    const handleRenewContract = async (oldContract: any) => {
        const confirmRenew = window.confirm(`ต้องการ "ต่อสัญญา" ให้คุณ ${oldContract.tenant_name} ใช่หรือไม่?`);
        if (!confirmRenew) return;

        const today = (() => {
            const d = new Date();
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        })();

        const isOldContractExpired = oldContract.contract_end_date < today;

        const newStartDate = new Date(oldContract.contract_end_date);
        newStartDate.setDate(newStartDate.getDate() + 1);
        const newStartDateStr = newStartDate.toISOString().split('T')[0];

        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);
        const newEndDateStr = newEndDate.toISOString().split('T')[0];

        const newStatus = isOldContractExpired ? 'active' : 'upcoming';

        const { error: insertError } = await supabase
            .from('contracts')
            .insert([{
                tenant_name: oldContract.tenant_name,
                parent_contract_id: oldContract.id,
                main_room_id: oldContract.main_room_id,
                actual_check_in_date: newStartDateStr,
                contract_start_date: newStartDateStr,
                contract_end_date: newEndDateStr,
                main_start_date: newStartDateStr,
                main_end_date: newEndDateStr,
                status: newStatus
            }]);

        if (insertError) {
            alert('เกิดข้อผิดพลาด: ' + insertError.message);
        } else {
            if (isOldContractExpired) {
                await supabase.from('contracts').update({ status: 'completed' }).eq('id', oldContract.id);
            }
            alert(`สร้างสัญญาใหม่เรียบร้อย!${isOldContractExpired ? '' : ' สัญญาใหม่จะเป็นสถานะ upcoming เนื่องจากยังไม่ครบกำหนดสัญญาเดิม'}`);
            fetchData();
        }
    };

    const handleMoveStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (newDate) {
            const d = new Date(newDate);
            d.setDate(d.getDate() - 1);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dayBefore = `${year}-${month}-${day}`;
            setEditForm({
                ...editForm,
                move_start_date: newDate,
                move_end_date: editForm.contract_end_date || editForm.move_end_date,
                main_end_date: dayBefore,
            });
        } else {
            setEditForm({ ...editForm, move_start_date: '' });
        }
    };

    const handleTempEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (newDate) {
            setEditForm({
                ...editForm,
                temp_end_date: newDate,
                main_start_date: (!editForm.main_start_date || editForm.main_start_date === editForm.temp_end_date)
                    ? newDate
                    : editForm.main_start_date,
            });
        } else {
            setEditForm({ ...editForm, temp_end_date: '' });
        }
    };

    const handleCreateTempEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (newDate) {
            setCreateForm({
                ...createForm,
                temp_end_date: newDate,
                main_start_date: (!createForm.main_start_date || createForm.main_start_date === createForm.temp_end_date)
                    ? newDate
                    : createForm.main_start_date,
            });
        } else {
            setCreateForm({ ...createForm, temp_end_date: '' });
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (editForm.has_temp_room && !editForm.temp_room_id) {
            alert('❌ กรุณาเลือกห้องชั่วคราว');
            return;
        }
        if (editForm.has_temp_room && (!editForm.temp_start_date || !editForm.temp_end_date)) {
            alert('❌ กรุณาระบุวันที่เริ่มต้นและวันย้ายออกของห้องชั่วคราว');
            return;
        }
        if (editForm.has_temp_room && new Date(editForm.temp_start_date) > new Date(editForm.temp_end_date)) {
            alert('❌ วันที่เริ่มต้นห้องชั่วคราวต้องไม่เกินวันที่ย้ายออก');
            return;
        }
        if (editForm.move_start_date && editForm.move_end_date && new Date(editForm.move_start_date) > new Date(editForm.move_end_date)) {
            alert('❌ วันที่เริ่มย้ายต้องไม่เกินวันที่ย้ายออก');
            return;
        }
        if (editForm.main_start_date && editForm.main_end_date && new Date(editForm.main_start_date) > new Date(editForm.main_end_date)) {
            alert('❌ วันเริ่มและสิ้นสุดของห้องหลักต้องถูกต้อง');
            return;
        }

        const { error } = await supabase
            .from('contracts')
            .update({
                tenant_name: editForm.tenant_name,
                status: editForm.status,
                contract_start_date: editForm.contract_start_date,
                contract_end_date: editForm.contract_end_date,
                actual_check_in_date: editForm.actual_check_in_date,
                main_room_id: editForm.main_room_id,
                main_start_date: editForm.main_start_date,
                main_end_date: editForm.main_end_date,
                temp_room_id: editForm.has_temp_room ? editForm.temp_room_id : null,
                temp_start_date: editForm.has_temp_room ? editForm.temp_start_date : null,
                temp_end_date: editForm.has_temp_room ? editForm.temp_end_date : null,
                move_to_room_id: editForm.move_to_room_id || null,
                move_start_date: editForm.move_start_date || null,
                move_end_date: editForm.move_end_date || null
            })
            .eq('id', editForm.id);

        if (error) {
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } else {
            setIsEditModalOpen(false);
            fetchData();
        }
    };

    // ── NEW: Handle create contract submit ──
    const handleCreateContract = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!createForm.tenant_name.trim()) {
            alert('❌ กรุณาระบุชื่อผู้เช่า');
            return;
        }
        if (!createForm.main_room_id) {
            alert('❌ กรุณาเลือกห้องพักหลัก');
            return;
        }
        if (!createForm.actual_check_in_date) {
            alert('❌ กรุณาระบุวันเข้าพักจริง');
            return;
        }
        if (!createForm.contract_start_date) {
            alert('❌ กรุณาระบุวันเริ่มต้นสัญญา');
            return;
        }
        if (!createForm.contract_end_date) {
            alert('❌ กรุณาระบุวันสิ้นสุดสัญญา');
            return;
        }
        if (!isValidDateRange(createForm.contract_start_date, createForm.contract_end_date)) {
            alert('❌ วันเริ่มต้นสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา');
            return;
        }
        if (!createForm.contract_start_date.endsWith('-01')) {
            alert('❌ วันเริ่มต้นสัญญาต้องเป็นวันที่ 1 ของเดือน');
            return;
        }
        const expectedEnd = addDays(addYears(createForm.contract_start_date, 1), -1);
        if (createForm.contract_end_date !== expectedEnd) {
            alert('❌ สัญญาต้องมีระยะเวลา 1 ปี');
            return;
        }
        const effectiveMainStart = createForm.main_start_date || createForm.contract_start_date;
        const effectiveMainEnd = createForm.main_end_date || createForm.contract_end_date;
        if (!isValidDateRange(effectiveMainStart, effectiveMainEnd)) {
            alert('❌ วันเริ่มต้นและวันสิ้นสุดของห้องหลักต้องถูกต้อง');
            return;
        }
        if (createForm.actual_check_in_date && createForm.contract_end_date && new Date(createForm.actual_check_in_date) > new Date(createForm.contract_end_date)) {
            alert('❌ วันเข้าพักจริงต้องไม่เกินวันสิ้นสุดสัญญา');
            return;
        }
        if (createForm.has_temp_room && !createForm.temp_room_id) {
            alert('❌ กรุณาเลือกห้องชั่วคราว');
            return;
        }
        if (createForm.has_temp_room && (!createForm.temp_start_date || !createForm.temp_end_date)) {
            alert('❌ กรุณาระบุวันที่เริ่มต้นและวันที่ย้ายออกของห้องชั่วคราว');
            return;
        }
        if (createForm.has_temp_room && new Date(createForm.temp_start_date) > new Date(createForm.temp_end_date)) {
            alert('❌ วันที่เริ่มต้นห้องชั่วคราวต้องไม่เกินวันที่ย้ายออก');
            return;
        }

        const payload: any = {
            tenant_name: createForm.tenant_name.trim(),
            actual_check_in_date: createForm.actual_check_in_date,
            contract_start_date: createForm.contract_start_date || createForm.actual_check_in_date,
            contract_end_date: createForm.contract_end_date || null,
            main_room_id: createForm.main_room_id,
            main_start_date: effectiveMainStart,
            main_end_date: effectiveMainEnd,
            status: 'active',
            temp_room_id: createForm.has_temp_room ? createForm.temp_room_id : null,
            temp_start_date: createForm.has_temp_room ? createForm.temp_start_date : null,
            temp_end_date: createForm.has_temp_room ? createForm.temp_end_date : null,
        };

        const { error } = await supabase.from('contracts').insert([payload]);

        if (error) {
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } else {
            setIsCreateModalOpen(false);
            setCreateForm({
                tenant_name: '',
                actual_check_in_date: '',
                contract_start_date: '',
                contract_end_date: '',
                main_room_id: '',
                main_start_date: '',
                main_end_date: '',
                has_temp_room: false,
                temp_room_id: '',
                temp_start_date: '',
                temp_end_date: '',
                status: 'active',
            });
            fetchData();
        }
    };

    const isOverlap = (start1: string, end1: string, start2: string, end2: string) => {
        if (!start1 || !end1 || !start2 || !end2) return false;
        return new Date(start1) < new Date(end2) && new Date(start2) < new Date(end1);
    };

    // ── Updated: accepts optional excludeContractId ──
    const isRoomAvailable = (roomId: string, checkStart: string, checkEnd: string, currentContractId?: string) => {
        if (!checkStart || !checkEnd) return true;
        for (const c of contracts) {
            if (currentContractId && c.id === currentContractId) continue;
            if (c.status === 'cancelled') continue;
            if (c.main_room_id === roomId && isOverlap(checkStart, checkEnd, c.main_start_date, c.main_end_date)) return false;
            if (c.temp_room_id === roomId && isOverlap(checkStart, checkEnd, c.temp_start_date, c.temp_end_date)) return false;
            if (c.move_to_room_id === roomId && isOverlap(checkStart, checkEnd, c.move_start_date, c.move_end_date)) return false;
        }
        return true;
    };

    const getRoomFreeWindow = (roomId: string, searchStart: string, searchEnd: string) => {
        const occupied = contracts
            .filter(c => c.status !== 'cancelled')
            .flatMap(c => {
                const periods: { start: string; end: string }[] = [];
                if (c.main_room_id === roomId && c.main_start_date && c.main_end_date)
                    periods.push({ start: c.main_start_date, end: c.main_end_date });
                if (c.temp_room_id === roomId && c.temp_start_date && c.temp_end_date)
                    periods.push({ start: c.temp_start_date, end: c.temp_end_date });
                if (c.move_to_room_id === roomId && c.move_start_date && c.move_end_date)
                    periods.push({ start: c.move_start_date, end: c.move_end_date });
                return periods;
            })
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

        let freeStart = '2000-01-01';
        let freeEnd = '2099-12-31';

        for (const occ of occupied) {
            if (new Date(occ.end) < new Date(searchStart)) {
                const d = new Date(occ.end);
                d.setDate(d.getDate() + 1);
                freeStart = d.toISOString().split('T')[0];
            } else if (new Date(occ.start) > new Date(searchEnd)) {
                const d = new Date(occ.start);
                d.setDate(d.getDate() - 1);
                freeEnd = d.toISOString().split('T')[0];
                break;
            }
        }

        return { start: freeStart, end: freeEnd };
    };

    const formatDateTH = (dateStr: string) => {
        if (!dateStr || dateStr === '2000-01-01' || dateStr === '2099-12-31') return null;
        return new Date(dateStr).toLocaleDateString('th-TH', {
            day: 'numeric', month: 'short', year: '2-digit'
        });
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'active':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">ACTIVE</span>;
            case 'completed':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200/60">COMPLETED</span>;
            case 'upcoming':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200/60">UPCOMING</span>;
            case 'cancelled':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-50 text-red-600 border border-red-200/60">CANCELLED</span>;
            default:
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">{status.toUpperCase()}</span>;
        }
    };

    const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all";
    const labelCls = "block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2";

    // ── Shared room selector for create modal ──
    const renderCreateRoomSelector = () => {
        const start = createForm.main_start_date || createForm.actual_check_in_date;
        const end = createForm.main_end_date || createForm.contract_end_date;

        if (!start || !end) {
            return (
                <select className={`${inputCls} cursor-pointer`} value="" disabled>
                    <option value="">⚠️ ใส่วันที่ก่อนเพื่อดูห้องว่าง</option>
                </select>
            );
        }

        const customerPref = waitlists.find(w => w.name === createForm.tenant_name) || {};
        const availableRooms = rooms.filter(r => isRoomAvailable(r.id, start, end));
        const perfectMatchRooms = availableRooms.filter(r => {
            const isMatch = (prefVal: any, roomVal: any) => {
                if (!prefVal || prefVal === 'ไม่ระบุ' || prefVal === '-') return true;
                return prefVal === roomVal;
            };
            return isMatch(customerPref.room_type, r.room_type)
                && isMatch(customerPref.kitchen_type, r.kitchen_type)
                && isMatch(customerPref.view_preference, r.view_direction);
        });
        const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));

        return (
            <select
                className={`${inputCls} cursor-pointer`}
                required
                value={createForm.main_room_id}
                onChange={(e) => setCreateForm({ ...createForm, main_room_id: e.target.value })}
            >
                <option value="">-- เลือกห้อง --</option>
                {perfectMatchRooms.length > 0 && (
                    <optgroup label="⭐️ ตรงสเปกลูกค้า">
                        {perfectMatchRooms.map(r => (
                            <option key={r.id} value={r.id}>
                                ห้อง {r.room_number} ({r.room_type || '-'} | วิว{r.view_direction || '-'} | ครัว{r.kitchen_type || '-'})
                            </option>
                        ))}
                    </optgroup>
                )}
                {otherRooms.length > 0 && (
                    <optgroup label="🏢 ห้องว่างอื่นๆ">
                        {otherRooms.map(r => (
                            <option key={r.id} value={r.id}>
                                ห้อง {r.room_number} ({r.room_type || '-'} | วิว{r.view_direction || '-'} | ครัว{r.kitchen_type || '-'})
                            </option>
                        ))}
                    </optgroup>
                )}
                {availableRooms.length === 0 && (
                    <option value="" disabled>❌ ไม่มีห้องว่างในช่วงนี้</option>
                )}
            </select>
        );
    };

    return (
        <div className="min-h-full flex flex-col bg-[#F0F4F8]">
            <div className="flex-1 p-8 md:p-10">

                {/* Header */}
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-[28px] font-bold text-[#0A2647] tracking-tight">การจอง</h1>
                        <p className="text-sm text-slate-500 mt-1">จัดการการจองและการจัดสรรห้องของลูกบ้านทั้งหมด</p>
                    </div>

                    {/* ── NEW: Create booking button ── */}
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="flex items-center gap-2 px-5 py-3 bg-[#4F81FF] hover:bg-[#3D6CE5] text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all active:scale-95"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                        </svg>
                        สร้างการจอง
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center text-2xl">📄</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">สัญญาทั้งหมด</p>
                            <p className="text-2xl font-bold text-[#0A2647]">{contracts.length} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">🟢</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">สัญญา Active</p>
                            <p className="text-2xl font-bold text-[#0A2647]">{contracts.filter(c => c.status === 'active').length} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center text-2xl">⚠️</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">ต้องดำเนินการ</p>
                            <p className="text-2xl font-bold text-[#0A2647]">
                                {contracts.filter(c => !c.main_room_id && c.status !== 'cancelled').length}{' '}
                                <span className="text-sm font-medium text-slate-500">รายการ</span>
                            </p>
                        </div>
                    </div>
                </div>

                <h2 className="text-lg font-bold text-[#0A2647] mb-4">รายการสัญญา</h2>

                {loading ? (
                    <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {contracts.map((contract) => {
                            const needsTempRoom = contract.actual_check_in_date &&
                                contract.main_start_date &&
                                new Date(contract.actual_check_in_date) < new Date(contract.main_start_date) &&
                                !contract.temp_room_id;
                            const missingMainRoom = !contract.main_room_id;

                            const getDate = (d: any) => d ? new Date(d) : null;
                            const today = new Date();
                            const inRange = (s: any, e: any) => {
                                const ss = getDate(s);
                                const ee = getDate(e);
                                return ss && ee && ss <= today && today <= ee;
                            };
                            const currentRoomId = (() => {
                                if (contract.temp_room_id && inRange(contract.temp_start_date, contract.temp_end_date)) return contract.temp_room_id;
                                if (contract.move_to_room_id && inRange(contract.move_start_date, contract.move_end_date)) return contract.move_to_room_id;
                                if (contract.main_room_id && inRange(contract.main_start_date, contract.main_end_date)) return contract.main_room_id;
                                return contract.main_room_id || contract.temp_room_id || contract.move_to_room_id || null;
                            })();

                            return (
                                <div
                                    key={contract.id}
                                    className={`bg-white rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)] border border-slate-100 transition-all group ${contract.status === 'cancelled' ? 'opacity-60' : ''}`}
                                >
                                    {/* <div className="w-12 h-10 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 font-semibold text-sm">
                                        {currentRoomId ? getonlyRoomNumber(currentRoomId) : '-'}
                                    </div> */}

                                    <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 font-semibold text-sm">
                                        {currentRoomId ? getonlyRoomNumber(currentRoomId) : '-'}
                                    </div>

                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                                        <div className="md:col-span-3">
                                            <h3 className="text-base font-bold text-slate-800">{contract.tenant_name}</h3>
                                            <div className="mt-1">{getStatusBadge(contract.status)}</div>
                                        </div>

                                        <div className="md:col-span-8">
                                            <div className="flex flex-wrap gap-2">
                                                {needsTempRoom && (
                                                    <span className="bg-red-50 text-red-600 border border-red-200/60 text-xs px-3 py-1.5 rounded-lg font-medium animate-pulse">
                                                        🚨 ต้องระบุห้องชั่วคราว
                                                    </span>
                                                )}
                                                {missingMainRoom && (
                                                    <span className="bg-amber-50 text-amber-700 border border-amber-200/60 text-xs px-3 py-1.5 rounded-lg font-medium">
                                                        ⚠️ ยังไม่ระบุห้องหลัก
                                                    </span>
                                                )}
                                            </div>

                                            <div className="mt-4 flex flex-row flex-nowrap gap-3 text-sm text-slate-700 items-start justify-start overflow-x-auto pb-2">
                                                {contract.temp_room_id && (
                                                    <div className="flex-shrink-0 w-full max-w-[180px] rounded-2xl border border-amber-200/70 bg-amber-50 p-3 min-h-[100px] flex flex-col justify-between">
                                                        <div>
                                                            <div className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">ห้องพักชั่วคราว</div>
                                                            <div className="font-semibold text-slate-900">{getRoomNumber(contract.temp_room_id)}</div>
                                                        </div>
                                                        <div className="text-xs text-slate-600 mt-1">
                                                            {formatDateTH(contract.temp_start_date) || '-'} — {formatDateTH(contract.temp_end_date) || '-'}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex-shrink-0 w-full max-w-[180px] rounded-2xl border border-slate-200 bg-slate-50 p-3 min-h-[100px] flex flex-col justify-between">
                                                    <div>
                                                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">ห้องพักหลัก</div>
                                                        <div className="font-semibold text-slate-900">
                                                            {contract.main_room_id ? getRoomNumber(contract.main_room_id) : 'ยังไม่ระบุห้องหลัก'}
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-slate-600 mt-1">
                                                        {formatDateTH(contract.main_start_date) || '-'} — {formatDateTH(contract.main_end_date) || '-'}
                                                    </div>
                                                </div>

                                                {contract.move_to_room_id && (
                                                    <div className="flex-shrink-0 w-full max-w-[180px] rounded-2xl border border-sky-200 bg-sky-50 p-3 min-h-[100px] flex flex-col justify-between">
                                                        <div>
                                                            <div className="text-xs font-semibold uppercase tracking-wider text-sky-700 mb-1">ย้ายห้อง</div>
                                                            <div className="font-semibold text-slate-900">{getRoomNumber(contract.move_to_room_id)}</div>
                                                        </div>
                                                        <div className="text-xs text-slate-600 mt-1">
                                                            {formatDateTH(contract.move_start_date) || '-'} — {formatDateTH(contract.move_end_date) || '-'}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        
                                    </div>

                                    <div className="flex items-center gap-2 md:pl-6 md:border-l border-slate-100 pt-3 md:pt-0 border-t md:border-t-0 mt-3 md:mt-0">
                                        <button
                                            onClick={() => handleEditClick(contract)}
                                            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-[#4F81FF] transition-colors"
                                            title="แก้ไข"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                        </button>

                                        {contract.status !== 'cancelled' && (
                                            <>
                                                <button
                                                    onClick={() => handleRenewContract(contract)}
                                                    className="bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-500 px-4 py-2 rounded-xl text-sm font-semibold ml-1 transition-all flex items-center gap-1.5"
                                                >
                                                    ต่อสัญญา <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                </button>
                                                <button
                                                    onClick={() => openCancelModal(contract)}
                                                    className="bg-red-50 hover:bg-red-500 text-red-600 hover:text-white border border-red-200 hover:border-red-500 px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
                                                    title="ยกเลิกสัญญา"
                                                >
                                                    ยกเลิกสัญญา
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {contracts.length === 0 && (
                            <div className="text-center py-20 text-slate-400 bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center">
                                <div className="text-5xl mb-4">📭</div>
                                <p className="font-medium text-lg text-slate-600">ยังไม่มีสัญญาเช่า</p>
                                <p className="text-sm mt-1">สัญญาจะปรากฏที่นี่หลังจากจัดสรรห้องเรียบร้อยแล้ว</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ─── Create Booking Modal ─── */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">

                        {/* Modal header */}
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-xl font-bold text-[#0A2647]">สร้างการจองใหม่</h2>
                                <p className="text-sm text-slate-500 mt-0.5">ระบุข้อมูลผู้เช่าและห้องพัก</p>
                            </div>
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Modal body */}
                        <form id="create-contract-form" onSubmit={handleCreateContract} className="p-8 space-y-6 overflow-y-auto flex-1">


                            {/* Section 1: ชื่อ + วันที่ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center text-[10px]">1</span>
                                    ข้อมูลผู้เช่า & ระยะเวลาสัญญา
                                </p>
                                <div className="mb-4">
                                    <label className={labelCls}>ชื่อผู้เช่า</label>
                                    <input
                                        type="text"
                                        className={inputCls}
                                        placeholder="กรอกชื่อผู้เช่า..."
                                        value={createForm.tenant_name}
                                        onChange={(e) => setCreateForm({ ...createForm, tenant_name: e.target.value })}
                                        required
                                    />
                                    {createForm.tenant_name && (() => {
                                        const pref = waitlists.find(w => w.name === createForm.tenant_name);
                                        return pref ? (
                                            <p className="mt-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 inline-flex items-center gap-1.5">
                                                📋 ความต้องการ: <span className="font-semibold text-slate-700">{pref.room_type} | ครัว{pref.kitchen_type} | วิว{pref.view_preference}</span>
                                            </p>
                                        ) : null;
                                    })()}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                    <div>
                                        <label className={labelCls}>วันเริ่มต้นสัญญา <span className="text-red-400">*</span></label>
                                        <input
                                            type="date"
                                            className={inputCls}
                                            value={createForm.contract_start_date}
                                            onChange={handleCreateStartDateChange}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันสิ้นสุดสัญญา (1 ปี)</label>
                                        <input
                                            type="date"
                                            className={inputCls}
                                            value={createForm.contract_end_date}
                                            readOnly
                                        />
                                        <p className="mt-2 text-[11px] text-slate-500">สัญญาจะสิ้นสุด 1 ปีถัดไปจากวันเริ่มต้น</p>
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันเข้าพักจริง</label>
                                        <input
                                            type="date"
                                            className={inputCls}
                                            value={createForm.actual_check_in_date}
                                            onChange={(e) => setCreateForm({ ...createForm, actual_check_in_date: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Section 3: Temp room (optional) */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-amber-100 text-amber-600 flex items-center justify-center text-[10px]">3</span>
                                    ห้องพักชั่วคราว (ถ้ามี)
                                </p>

                                {!createForm.has_temp_room ? (
                                    <button
                                        type="button"
                                        onClick={() => setCreateForm({
                                            ...createForm,
                                            has_temp_room: true,
                                            temp_start_date: createForm.actual_check_in_date || '',
                                            temp_end_date: createForm.main_start_date || '',
                                        })}
                                        className="w-full flex items-center justify-center gap-2 py-4 bg-amber-50 border-2 border-dashed border-amber-200 text-amber-600 rounded-2xl text-sm font-semibold hover:bg-amber-100 hover:border-amber-300 transition-all"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                        เพิ่มห้องพักชั่วคราว (กรณีเข้าพักก่อนห้องหลักพร้อม)
                                    </button>
                                ) : (
                                    <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-5 relative">
                                        <button
                                            type="button"
                                            onClick={() => setCreateForm({ ...createForm, has_temp_room: false, temp_room_id: '' })}
                                            className="absolute top-4 right-4 text-xs px-3 py-1.5 bg-white text-red-500 border border-red-200 rounded-xl font-semibold hover:bg-red-50 transition-colors"
                                        >
                                            ยกเลิก
                                        </button>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                            <div>
                                                <label className={labelCls}>เลือกห้อง</label>
                                                <select
                                                    className="w-full bg-white border border-amber-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 outline-none transition-all cursor-pointer"
                                                    value={createForm.temp_room_id}
                                                    onChange={(e) => setCreateForm({ ...createForm, temp_room_id: e.target.value })}
                                                >
                                                    <option value="">-- เลือกห้อง --</option>
                                                    {rooms.filter(r => r.id !== createForm.main_room_id).map(r => (
                                                        <option key={r.id} value={r.id}>ห้อง {r.room_number}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelCls}>เริ่มเข้าพัก</label>
                                                <input
                                                    type="date"
                                                    className="w-full bg-white border border-amber-200 rounded-xl p-3.5 text-sm outline-none focus:ring-2 focus:ring-amber-400/50 transition-all"
                                                    value={createForm.temp_start_date}
                                                    onChange={(e) => setCreateForm({ ...createForm, temp_start_date: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>ย้ายออก (ไปห้องหลัก)</label>
                                                <input
                                                    type="date"
                                                    className="w-full bg-white border border-amber-200 rounded-xl p-3.5 text-sm outline-none focus:ring-2 focus:ring-amber-400/50 transition-all"
                                                    value={createForm.temp_end_date}
                                                    onChange={handleCreateTempEndDateChange}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Section 4: Main room */}
                            {/* Section 2: Room card picker */}
                            {createForm.contract_start_date && createForm.contract_end_date && (
                                <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                        <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center text-[10px]">2</span>
                                        เลือกห้องพักหลัก <span className="text-red-400">*</span>
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
                                        <div>
                                            <label className={labelCls}>ตึก</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.building}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, building: e.target.value })}
                                            >
                                                <option value="">-- ทุกตึก --</option>
                                                {buildingOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>ชั้น</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.floor}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, floor: e.target.value })}
                                            >
                                                <option value="">-- ทุกชั้น --</option>
                                                {floorOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>ประเภทครัว</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.kitchen}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, kitchen: e.target.value })}
                                            >
                                                <option value="">-- ทุกประเภท --</option>
                                                {kitchenOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>วิว</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.view}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, view: e.target.value })}
                                            >
                                                <option value="">-- ทุกวิว --</option>
                                                {viewOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    {(() => {
                                        const start = createForm.main_start_date || createForm.contract_start_date;
                                        const end = createForm.main_end_date || createForm.contract_end_date;
                                        const customerPref = waitlists.find(w => w.name === createForm.tenant_name) || {};
                                        const availableRooms = rooms.filter(r => isRoomAvailable(r.id, start, end) && applyRoomFilters(r));
                                        const isMatch = (prefVal: any, roomVal: any) => {
                                            if (!prefVal || prefVal === 'ไม่ระบุ' || prefVal === '-') return true;
                                            return prefVal === roomVal;
                                        };
                                        const perfectMatchRooms = availableRooms.filter(r =>
                                            isMatch(customerPref.room_type, r.room_type) &&
                                            isMatch(customerPref.kitchen_type, r.kitchen_type) &&
                                            isMatch(customerPref.view_preference, r.view_direction)
                                        );
                                        const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));

                                        if (availableRooms.length === 0) {
                                            return (
                                                <div className="flex items-center gap-3 bg-red-50 border border-red-200/60 rounded-2xl px-4 py-4 text-sm text-red-600 font-medium">
                                                    <span className="text-xl">❌</span> ไม่มีห้องว่างในช่วงเวลานี้
                                                </div>
                                            );
                                        }

                                        const RoomCard = ({ room, isMatchRoom }: { room: any; isMatchRoom: boolean }) => {
                                            const isSelected = createForm.main_room_id === room.id;
                                            const fw = getRoomFreeWindow(room.id, start, end);
                                            const fmtDate = (d: string) =>
                                                (!d || d === '2000-01-01' || d === '2099-12-31')
                                                    ? null
                                                    : new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

                                            return (
                                                <button
                                                    type="button"
                                                    onClick={() => setCreateForm({ ...createForm, main_room_id: room.id })}
                                                    className={`relative text-left rounded-2xl p-4 border transition-all w-full ${isSelected
                                                        ? 'border-[#4F81FF] bg-blue-50 ring-2 ring-[#4F81FF]/20'
                                                        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50'
                                                        }`}
                                                >
                                                    {isMatchRoom && <span className="absolute top-2.5 right-2.5 text-[10px]">⭐</span>}
                                                    <p className={`text-base font-bold mb-2 ${isSelected ? 'text-[#4F81FF]' : 'text-slate-800'}`}>
                                                        ห้อง {room.room_number}
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                                        {room.room_type && (
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isSelected ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200/60'}`}>
                                                                {room.room_type}
                                                            </span>
                                                        )}
                                                        {room.view_direction && (
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isSelected ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200/60'}`}>
                                                                วิว{room.view_direction}
                                                            </span>
                                                        )}
                                                        {room.kitchen_type && (
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isSelected ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200/60'}`}>
                                                                ครัว{room.kitchen_type}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className={`flex items-center gap-1 text-[10px] font-medium ${isSelected ? 'text-blue-500' : 'text-emerald-600'}`}>
                                                        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                        ว่าง: {fmtDate(fw.start) ?? 'ตั้งแต่ต้น'} — {fmtDate(fw.end) ?? 'ไม่มีกำหนด'}
                                                    </div>
                                                </button>
                                            );
                                        };

                                        return (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between text-xs text-slate-500">
                                                    <span>ห้องว่าง <span className="font-bold text-slate-700">{availableRooms.length}</span> ห้อง</span>
                                                    {perfectMatchRooms.length > 0 && (
                                                        <span className="bg-amber-50 text-amber-700 border border-amber-200/60 px-3 py-1 rounded-full font-semibold text-[11px]">
                                                            ⭐ ตรงสเปก {perfectMatchRooms.length} ห้อง
                                                        </span>
                                                    )}
                                                </div>
                                                {perfectMatchRooms.length > 0 && (
                                                    <div>
                                                        <p className="text-[11px] font-bold text-amber-600 mb-2">⭐ ตรงสเปกลูกค้า</p>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                                                            {perfectMatchRooms.map(r => <RoomCard key={r.id} room={r} isMatchRoom={true} />)}
                                                        </div>
                                                    </div>
                                                )}
                                                {otherRooms.length > 0 && (
                                                    <div>
                                                        <p className="text-[11px] font-bold text-slate-500 mb-2">🏢 ห้องว่างอื่นๆ</p>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                                                            {otherRooms.map(r => <RoomCard key={r.id} room={r} isMatchRoom={false} />)}
                                                        </div>
                                                    </div>
                                                )}
                                                {createForm.main_room_id && (() => {
                                                    const room = rooms.find(r => r.id === createForm.main_room_id);
                                                    return room ? (
                                                        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200/60 rounded-2xl px-4 py-3">
                                                            <div className="w-8 h-8 bg-[#4F81FF] rounded-xl flex items-center justify-center text-white text-sm shrink-0">🔑</div>
                                                            <div>
                                                                <p className="text-sm font-bold text-blue-800">ห้อง {room.room_number} — เลือกแล้ว</p>
                                                                <p className="text-xs text-blue-600">
                                                                    {[room.room_type, room.view_direction ? `วิว${room.view_direction}` : null, room.kitchen_type ? `ครัว${room.kitchen_type}` : null].filter(Boolean).join(' · ')}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ) : null;
                                                })()}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </form>

                        {/* Modal footer */}
                        <div className="px-8 py-5 border-t border-slate-100 flex gap-4 shrink-0">
                            <button
                                type="button"
                                onClick={() => setIsCreateModalOpen(false)}
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="submit"
                                form="create-contract-form"
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-[#4F81FF] rounded-2xl hover:bg-[#3D6CE5] shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                                </svg>
                                ยืนยันการจอง
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isCancelModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-xl font-bold text-[#0A2647]">ยกเลิกสัญญา</h2>
                                <p className="text-sm text-slate-500 mt-0.5">เลือกวันที่ย้ายออกจริงโดยใช้ปฏิทิน</p>
                            </div>
                            <button
                                onClick={() => setIsCancelModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div>
                                <p className="text-sm font-semibold text-slate-600 mb-2">สัญญาของ: {cancelTenantName || '-'}</p>
                                <label className={labelCls}>วันที่ย้ายออกจริง</label>
                                <input
                                    type="date"
                                    className={inputCls}
                                    value={cancelEndDate}
                                    onChange={(e) => setCancelEndDate(e.target.value)}
                                />
                                <p className="mt-2 text-sm text-slate-500">{cancelEndDate ? new Date(cancelEndDate).toLocaleDateString('th-TH') : '-'}</p>
                            </div>
                        </div>
                        <div className="px-8 py-5 border-t border-slate-100 flex gap-4 shrink-0">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCancelModalOpen(false);
                                    setCancelContractId(null);
                                    setCancelTenantName('');
                                }}
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all"
                            >
                                ย้อนกลับ
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelContract}
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-red-600 rounded-2xl hover:bg-red-700 shadow-lg shadow-red-500/20 transition-all"
                            >
                                ยืนยันยกเลิก
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Edit Modal (unchanged) ─── */}
            {isEditModalOpen && editForm && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-xl font-bold text-[#0A2647]">แก้ไขสัญญาเช่า</h2>
                                {(() => {
                                    const pref = waitlists.find(w => w.name === editForm.tenant_name) || {};
                                    return (
                                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                            <p className="text-sm text-slate-500">
                                                ผู้เช่า: <span className="text-[#4F81FF] font-bold">{editForm.tenant_name}</span>
                                            </p>
                                            {pref.room_type && (
                                                <span className="text-[11px] font-semibold bg-slate-50 text-slate-600 px-3 py-1 rounded-lg border border-slate-200/60">
                                                    {pref.room_type} | ครัว{pref.kitchen_type} | วิว{pref.view_preference}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                            <div className="flex items-center gap-3">
                                <select
                                    className={`border rounded-xl py-2 pl-3 pr-8 text-xs font-bold outline-none cursor-pointer transition-colors
                                        ${editForm.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            editForm.status === 'completed' ? 'bg-slate-50 text-slate-500 border-slate-200' :
                                                editForm.status === 'upcoming' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                                                    'bg-red-50 text-red-600 border-red-200'}`}
                                    value={editForm.status}
                                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                                >
                                    <option value="active">🟢 Active</option>
                                    <option value="upcoming">🔵 Upcoming</option>
                                    <option value="completed">⚪ Completed</option>
                                    <option value="cancelled">🔴 Cancelled</option>
                                </select>
                                <button
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        <form id="edit-contract-form" onSubmit={handleSaveEdit} className="p-8 space-y-6 overflow-y-auto flex-1">
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    ระยะเวลาสัญญา & วันเข้าพัก
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                    <div>
                                        <label className={labelCls}>วันเข้าพักจริง (Check-in)</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.actual_check_in_date || ''}
                                            onChange={(e) => setEditForm({ ...editForm, actual_check_in_date: e.target.value })}
                                            required />
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันเริ่มสัญญา</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.contract_start_date || ''}
                                            onChange={(e) => setEditForm({ ...editForm, contract_start_date: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันสิ้นสุดสัญญา</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.contract_end_date || ''}
                                            onChange={(e) => setEditForm({ ...editForm, contract_end_date: e.target.value })} />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-amber-100 text-amber-600 flex items-center justify-center text-[10px]">1</span>
                                    ห้องพักชั่วคราว (ถ้ามี)
                                </p>
                                {!editForm.has_temp_room ? (
                                    <button
                                        type="button"
                                        onClick={() => setEditForm({ ...editForm, has_temp_room: true, temp_start_date: editForm.actual_check_in_date || '', temp_end_date: editForm.main_start_date || '' })}
                                        className="w-full flex items-center justify-center gap-2 py-4 bg-amber-50 border-2 border-dashed border-amber-200 text-amber-600 rounded-2xl text-sm font-semibold hover:bg-amber-100 hover:border-amber-300 transition-all"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                        เพิ่มห้องพักชั่วคราว (กรณีเข้าพักก่อนห้องหลักพร้อม)
                                    </button>
                                ) : (
                                    <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-5 relative">
                                        <button
                                            type="button"
                                            onClick={() => setEditForm({ ...editForm, has_temp_room: false, temp_room_id: null })}
                                            className="absolute top-4 right-4 text-xs px-3 py-1.5 bg-white text-red-500 border border-red-200 rounded-xl font-semibold hover:bg-red-50 transition-colors"
                                        >
                                            ยกเลิก
                                        </button>
                                        <div className="grid grid-cols-1 gap-4">
                                            <div className="space-y-3">
                                                <label className={labelCls}>เลือกห้อง</label>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditRoomPicker('temp')}
                                                    className="w-full inline-flex items-center justify-between rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:border-amber-300 hover:bg-amber-50 transition-all"
                                                >
                                                    <span>{editForm.temp_room_id ? `ห้อง ${getRoomNumber(editForm.temp_room_id)}` : 'เลือกห้อง'}</span>
                                                    <span className="text-amber-500">เลือก</span>
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                <div>
                                                    <label className={labelCls}>เริ่มเข้าพัก</label>
                                                    <input type="date" className="w-full bg-white border border-amber-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-amber-400/50 outline-none transition-all"
                                                        value={editForm.temp_start_date || ''}
                                                        onChange={(e) => setEditForm({ ...editForm, temp_start_date: e.target.value })} />
                                                </div>
                                                <div>
                                                    <label className={labelCls}>ย้ายออก (ไปห้องหลัก)</label>
                                                    <input type="date" className="w-full bg-white border border-amber-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-amber-400/50 outline-none transition-all"
                                                        value={editForm.temp_end_date || ''}
                                                        onChange={handleTempEndDateChange} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center text-[10px]">2</span>
                                    ห้องพักหลัก (Main Room)
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="flex gap-4">
                                        <div className="flex-1">
                                            <label className={labelCls}>วันที่เริ่มอยู่</label>
                                            <input type="date" className={inputCls}
                                                value={editForm.main_start_date || ''}
                                                onChange={(e) => setEditForm({ ...editForm, main_start_date: e.target.value })} />
                                        </div>
                                        <div className="flex-1">
                                            <label className={labelCls}>วันที่ย้ายออก</label>
                                            <input type="date" className={inputCls}
                                                value={editForm.main_end_date || ''}
                                                onChange={(e) => setEditForm({ ...editForm, main_end_date: e.target.value })} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className={labelCls}>เลือกห้องพัก</label>
                                        {!editForm.main_start_date || !editForm.main_end_date ? (
                                            <p className="py-4 px-3 rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 text-sm">
                                                ⚠️ ใส่วันที่ก่อนเพื่อดูห้องว่าง
                                            </p>
                                        ) : (() => {
                                            const customerPref = waitlists.find(w => w.name === editForm.tenant_name) || {};
                                            const availableRooms = rooms.filter(r => isRoomAvailable(r.id, editForm.main_start_date, editForm.main_end_date, editForm.id));
                                            const perfectMatchRooms = availableRooms.filter(r => {
                                                const isMatch = (prefVal: any, roomVal: any) => {
                                                    if (!prefVal || prefVal === 'ไม่ระบุ' || prefVal === '-') return true;
                                                    return prefVal === roomVal;
                                                };
                                                return isMatch(customerPref.room_type, r.room_type)
                                                    && isMatch(customerPref.kitchen_type, r.kitchen_type)
                                                    && isMatch(customerPref.view_preference, r.view_direction);
                                            });
                                            const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));
                                            return (
                                                <div className="space-y-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditRoomPicker('main')}
                                                        className="w-full inline-flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:border-slate-300 hover:bg-slate-50 transition-all"
                                                    >
                                                        <span>{editForm.main_room_id ? `ห้อง ${getRoomNumber(editForm.main_room_id)}` : 'เลือกห้อง'}</span>
                                                        <span>เลือก</span>
                                                    </button>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-purple-100 text-purple-600 flex items-center justify-center text-[10px]">3</span>
                                    ย้ายห้อง (ถ้ามี)
                                </p>
                                <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-5">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        <div>
                                            <label className={labelCls}>วันที่ย้ายเข้าห้องใหม่</label>
                                            <input type="date" className={inputCls}
                                                value={editForm.move_start_date || ''}
                                                onChange={handleMoveStartDateChange} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>ถึงวันที่</label>
                                            <input type="date" className={inputCls}
                                                value={editForm.move_end_date || ''}
                                                onChange={(e) => setEditForm({ ...editForm, move_end_date: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>เลือกห้องใหม่</label>
                                            {(!editForm.move_start_date || !editForm.move_end_date) ? (
                                                <p className="py-4 px-3 rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 text-sm">
                                                    ⚠️ ใส่วันที่ก่อนเพื่อดูห้องว่าง
                                                </p>
                                            ) : (
                                                <div className="space-y-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditRoomPicker('move')}
                                                        className="w-full inline-flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:border-slate-300 hover:bg-slate-50 transition-all"
                                                    >
                                                        <span>{editForm.move_to_room_id ? `ห้อง ${getRoomNumber(editForm.move_to_room_id)}` : 'เลือกห้องใหม่'}</span>
                                                        <span>เลือก</span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>

                        <div className="px-8 py-5 border-t border-slate-100 flex gap-4 shrink-0">
                            <button
                                type="button"
                                onClick={() => setIsEditModalOpen(false)}
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="submit"
                                form="edit-contract-form"
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-[#4F81FF] rounded-2xl hover:bg-[#3D6CE5] shadow-lg shadow-blue-500/30 transition-all"
                            >
                                บันทึกการเปลี่ยนแปลง
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editRoomPicker && editForm && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-60 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">
                                    {editRoomPicker === 'temp' ? 'เลือกห้องพักชั่วคราว' : editRoomPicker === 'main' ? 'เลือกห้องพักหลัก' : 'เลือกห้องย้ายใหม่'}
                                </h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    {editRoomPicker === 'temp'
                                        ? 'เลือกห้องชั่วคราวที่ไม่ใช่ห้องหลัก'
                                        : editRoomPicker === 'main'
                                            ? 'เลือกห้องหลักตามวันที่กำหนด'
                                            : 'เลือกห้องใหม่สำหรับช่วงย้ายห้อง'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditRoomPicker(null)}
                                className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-600"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-8 overflow-y-auto flex-1 space-y-5">
                            {editRoomPicker === 'temp' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                        <div>
                                            <label className={labelCls}>ตึก</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.building}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, building: e.target.value })}
                                            >
                                                <option value="">-- ทุกตึก --</option>
                                                {buildingOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>ชั้น</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.floor}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, floor: e.target.value })}
                                            >
                                                <option value="">-- ทุกชั้น --</option>
                                                {floorOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>ประเภทครัว</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.kitchen}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, kitchen: e.target.value })}
                                            >
                                                <option value="">-- ทุกประเภท --</option>
                                                {kitchenOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>วิว</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.view}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, view: e.target.value })}
                                            >
                                                <option value="">-- ทุกวิว --</option>
                                                {viewOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    {renderRoomButtonGrid(
                                        rooms.filter(r => r.id !== editForm.main_room_id && applyRoomFilters(r)),
                                        editForm.temp_room_id,
                                        (roomId) => {
                                            setEditForm({ ...editForm, temp_room_id: roomId });
                                            setEditRoomPicker(null);
                                        },
                                        { searchStart: editForm.temp_start_date, searchEnd: editForm.temp_end_date }
                                    )}
                                </div>
                            )}

                            {editRoomPicker === 'main' && (
                                <div className="space-y-4">
                                    {(!editForm.main_start_date || !editForm.main_end_date) ? (
                                        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                                            ⚠️ กรุณาระบุวันที่เริ่มและวันที่ย้ายออกของห้องหลักก่อน
                                        </p>
                                    ) : (() => {
                                        const customerPref = waitlists.find(w => w.name === editForm.tenant_name) || {};
                                        const availableRooms = rooms.filter(r => isRoomAvailable(r.id, editForm.main_start_date, editForm.main_end_date, editForm.id) && applyRoomFilters(r));
                                        const isMatch = (prefVal: any, roomVal: any) => {
                                            if (!prefVal || prefVal === 'ไม่ระบุ' || prefVal === '-') return true;
                                            return prefVal === roomVal;
                                        };
                                        const perfectMatchRooms = availableRooms.filter(r =>
                                            isMatch(customerPref.room_type, r.room_type) &&
                                            isMatch(customerPref.kitchen_type, r.kitchen_type) &&
                                            isMatch(customerPref.view_preference, r.view_direction)
                                        );
                                        const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));
                                        return (
                                            <>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                                    <div>
                                                        <label className={labelCls}>ตึก</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.building}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, building: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกตึก --</option>
                                                            {buildingOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>ชั้น</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.floor}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, floor: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกชั้น --</option>
                                                            {floorOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>ประเภทครัว</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.kitchen}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, kitchen: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกประเภท --</option>
                                                            {kitchenOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>วิว</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.view}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, view: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกวิว --</option>
                                                            {viewOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                {perfectMatchRooms.length > 0 && (
                                                    <div className="space-y-3">
                                                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">⭐️ ตรงสเปกลูกค้า</p>
                                                        {renderRoomButtonGrid(perfectMatchRooms, editForm.main_room_id, (roomId) => {
                                                            setEditForm({ ...editForm, main_room_id: roomId });
                                                            setEditRoomPicker(null);
                                                        }, { searchStart: editForm.main_start_date, searchEnd: editForm.main_end_date })}
                                                    </div>
                                                )}
                                                {otherRooms.length > 0 && (
                                                    <div className="space-y-3">
                                                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">🏢 ห้องว่างอื่นๆ</p>
                                                        {renderRoomButtonGrid(otherRooms, editForm.main_room_id, (roomId) => {
                                                            setEditForm({ ...editForm, main_room_id: roomId });
                                                            setEditRoomPicker(null);
                                                        }, { searchStart: editForm.main_start_date, searchEnd: editForm.main_end_date })}
                                                    </div>
                                                )}
                                                {availableRooms.length === 0 && (
                                                    <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                                                        ❌ ไม่มีห้องว่างในช่วงนี้
                                                    </p>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            {editRoomPicker === 'move' && (
                                <div className="space-y-4">
                                    {(!editForm.move_start_date || !editForm.move_end_date) ? (
                                        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                                            ⚠️ กรุณาระบุวันที่ย้ายก่อนเพื่อดูห้องว่าง
                                        </p>
                                    ) : (() => {
                                        const availableRooms = rooms.filter(r => isRoomAvailable(r.id, editForm.move_start_date, editForm.move_end_date, editForm.id) && applyRoomFilters(r));
                                        return availableRooms.length > 0 ? (
                                            <>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                                    <div>
                                                        <label className={labelCls}>ตึก</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.building}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, building: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกตึก --</option>
                                                            {buildingOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>ชั้น</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.floor}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, floor: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกชั้น --</option>
                                                            {floorOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>ประเภทครัว</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.kitchen}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, kitchen: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกประเภท --</option>
                                                            {kitchenOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>วิว</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.view}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, view: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกวิว --</option>
                                                            {viewOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                {renderRoomButtonGrid(availableRooms, editForm.move_to_room_id, (roomId) => {
                                                    setEditForm({ ...editForm, move_to_room_id: roomId });
                                                    setEditRoomPicker(null);
                                                }, { searchStart: editForm.move_start_date, searchEnd: editForm.move_end_date })}
                                            </>
                                        ) : (
                                            <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                                                ❌ ไม่มีห้องว่างในช่วงนี้
                                            </p>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}