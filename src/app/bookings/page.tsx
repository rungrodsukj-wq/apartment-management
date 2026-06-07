// src/app/bookings/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { canEditPage } from '../../lib/permissions';
import { logAudit, describeChanges } from '../../lib/audit';
import { isOverlap, isRoomAvailable, getRoomFreeWindow } from '../../lib/availability';

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
    const { profile } = useAuth();
    const isEditable = canEditPage(profile, 'bookings');

    const [contracts, setContracts] = useState<any[]>([]);
    const [rooms, setRooms] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [intentions, setIntentions] = useState<any[]>([]);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState<any>(null);
    const [editRoomPicker, setEditRoomPicker] = useState<'temp' | 'main' | 'move' | null>(null);
    const [selectedRoomForDetail, setSelectedRoomForDetail] = useState<any | null>(null);


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
        monthly_rent: '',
        parent_contract_id: null,
    });
    const [isShortTermContract, setIsShortTermContract] = useState(false);
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [cancelContractId, setCancelContractId] = useState<string | null>(null);
    const [cancelEndDate, setCancelEndDate] = useState(formatDateInput(new Date()));
    const [cancelTenantName, setCancelTenantName] = useState('');

    const [roomFilters, setRoomFilters] = useState({
        building: '',
        floor: '',
        room_type: '',
        kitchen: '',
        view: '',
        search: '',
    });
    const [listFilters, setListFilters] = useState({
        building: '',
        room_type: '',
        kitchen: '',
        view: '',
        search: '',
    });

    const [waitlists, setWaitlists] = useState<any[]>([]);
    const searchParams = useSearchParams();

    const buildingOptions = Array.from(new Set(rooms.map((r: any) => r.building).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));
    const floorOptions = Array.from(new Set(rooms.map((r: any) => r.floor != null ? String(r.floor) : '').filter(Boolean))).sort((a, b) => Number(a) - Number(b));
    const roomTypeOptions = Array.from(new Set(rooms.map((r: any) => r.room_type).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));
    const kitchenOptions = Array.from(new Set(rooms.map((r: any) => r.kitchen_type).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));
    const viewOptions = Array.from(new Set(rooms.map((r: any) => r.view_direction).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));

    const applyRoomFilters = (room: any) => {
        if (roomFilters.building && room.building !== roomFilters.building) return false;
        if (roomFilters.floor && String(room.floor) !== roomFilters.floor) return false;
        if (roomFilters.room_type && room.room_type !== roomFilters.room_type) return false;
        if (roomFilters.kitchen && room.kitchen_type !== roomFilters.kitchen) return false;
        if (roomFilters.view && room.view_direction !== roomFilters.view) return false;
        if (roomFilters.search) {
            const query = roomFilters.search.toLowerCase().trim();
            if (query) {
                const matches = [
                    room.room_number ? String(room.room_number).toLowerCase() : '',
                    room.room_type ? String(room.room_type).toLowerCase() : '',
                    room.kitchen_type ? String(room.kitchen_type).toLowerCase() : '',
                    room.view_direction ? String(room.view_direction).toLowerCase() : '',
                    room.building ? String(room.building).toLowerCase() : '',
                ];
                if (!matches.some((value) => value.includes(query))) return false;
            }
        }
        return true;
    };

    const refreshContractStatuses = async (contractRows: any[]) => {
        const today = formatDateInput(new Date());
        const expiredIds = contractRows
            .filter((c: any) => c.status !== 'cancelled' && c.contract_end_date && c.contract_end_date < today)
            .map((c: any) => c.id);
        const upcomingToActiveIds = contractRows
            .filter((c: any) => c.status === 'upcoming' && c.contract_start_date && c.contract_start_date <= today && (!c.contract_end_date || c.contract_end_date >= today))
            .map((c: any) => c.id);

        if (expiredIds.length === 0 && upcomingToActiveIds.length === 0) {
            return false;
        }

        if (expiredIds.length > 0) {
            const { error } = await supabase
                .from('contracts')
                .update({ status: 'completed' })
                .in('id', expiredIds);
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

    useEffect(() => {
        if (isEditable && searchParams.get('quickAction') === 'newBooking') {
            setIsCreateModalOpen(true);
        }
    }, [searchParams, isEditable]);

    async function fetchData() {
        setLoading(true);
        const { data: cData } = await supabase.from('contracts').select('*').order('created_at', { ascending: false });
        const { data: rData } = await supabase.from('rooms').select('*').order('room_number');
        const { data: wData } = await supabase.from('waitlists').select('*');
        const { data: iData } = await supabase.from('renewal_intentions').select('*');

        const roomData = rData || [];
        if (rData) setRooms(rData);
        if (wData) setWaitlists(wData);
        if (iData) setIntentions(iData);

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
        return `${room.room_number}`;
        // return `${room.room_number} ${room.room_type ? `(${room.room_type})` : ''}`;
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

    const filteredContracts = useMemo(() => {
        return contracts.filter((contract) => {
            const currentRoomId = getCurrentRoomId(contract);
            const room = rooms.find((r: any) => r.id === currentRoomId) || null;

            if (listFilters.building && room?.building !== listFilters.building) return false;
            if (listFilters.room_type && room?.room_type !== listFilters.room_type) return false;
            if (listFilters.kitchen && room?.kitchen_type !== listFilters.kitchen) return false;
            if (listFilters.view && room?.view_direction !== listFilters.view) return false;

            if (listFilters.search.trim()) {
                const query = listFilters.search.trim().toLowerCase();
                const values = [
                    contract.tenant_name || '',
                    contract.status || '',
                    room?.room_number ? String(room.room_number) : '',
                    room?.room_type || '',
                    room?.kitchen_type || '',
                    room?.view_direction || '',
                    room?.building || '',
                    room?.floor != null ? String(room.floor) : ''
                ].map((value) => value.toLowerCase());

                if (!values.some((value) => value.includes(query))) {
                    return false;
                }
            }

            return true;
        });
    }, [contracts, rooms, listFilters]);

    const handleRoomClick = (roomId: string) => {
        const room = rooms.find(r => r.id === roomId);
        if (room) {
            setSelectedRoomForDetail(room);
        } else {
            alert('ไม่พบข้อมูลห้องพักนี้ในระบบ');
        }
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

        const statusPriority: Record<string, number> = {
            active: 0,
            upcoming: 1,
            completed: 2,
            cancelled: 3,
        };

        const getEffectiveStatus = (contract: any) => {
            if (contract.status === 'cancelled') return 'cancelled';
            if (contract.actual_check_in_date && contract.actual_check_in_date > formatDateInput(new Date())) {
                return 'upcoming';
            }
            return contract.status;
        };

        return [...contractsToSort].sort((a, b) => {
            const roomA = getCurrentRoomId(a);
            const roomB = getCurrentRoomId(b);
            const keyA = resolveRoomKey(roomA);
            const keyB = resolveRoomKey(roomB);
            if (keyA < keyB) return -1;
            if (keyA > keyB) return 1;

            const statusA = statusPriority[getEffectiveStatus(a)] ?? 4;
            const statusB = statusPriority[getEffectiveStatus(b)] ?? 4;
            if (statusA !== statusB) return statusA - statusB;

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
                        ? getRoomFreeWindow(contracts, room.id, options.searchStart, options.searchEnd)
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

    const calculateRelativeShiftedDate = (oldReference: string, targetDate: string, newReference: string) => {
        if (!oldReference || !targetDate || !newReference) return targetDate;

        const oldRefDate = parseDateFromYYYYMMDD(oldReference);
        const target = parseDateFromYYYYMMDD(targetDate);
        const newRefDate = parseDateFromYYYYMMDD(newReference);

        if (Number.isNaN(oldRefDate.getTime()) || Number.isNaN(target.getTime()) || Number.isNaN(newRefDate.getTime())) {
            return targetDate;
        }

        const deltaDays = Math.round((target.getTime() - oldRefDate.getTime()) / (1000 * 60 * 60 * 24));
        newRefDate.setDate(newRefDate.getDate() + deltaDays);
        return formatDateInput(newRefDate);
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
                actual_check_in_date: createForm.actual_check_in_date || '',
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
            main_start_date: startDate,
            main_end_date: newEndDate,
            actual_check_in_date: createForm.actual_check_in_date
                ? calculateRelativeShiftedDate(createForm.contract_start_date, createForm.actual_check_in_date, startDate)
                : startDate,
        });
    };

    const handleEditClick = (contract: any) => {
        setEditForm({
            ...contract,
            has_temp_room: !!contract.temp_room_id,
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
            .update({ status: 'cancelled', contract_end_date: cancelEndDate })
            .eq('id', cancelContractId);

        if (error) {
            alert('เกิดข้อผิดพลาดในการยกเลิก: ' + error.message);
        } else {
            await logAudit(profile, 'contracts', 'update', cancelContractId, 'ยกเลิกสัญญา', { status: 'cancelled', contract_end_date: cancelEndDate });
            setIsCancelModalOpen(false);
            setCancelContractId(null);
            setCancelTenantName('');
            alert('ยกเลิกสัญญาเรียบร้อยแล้ว');
            fetchData();
        }
    };

    const handleRenewContract = (oldContract: any) => {
        // 1. คำนวณวันเหมือนเดิม
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

        const newEndDateStr = addDays(addYears(newStartDateStr, 1), -1);

        const newStatus = isOldContractExpired ? 'active' : 'upcoming';

        // 2. โยนข้อมูลใส่ createForm เพื่อเตรียมแสดงผลบน Modal
        setCreateForm({
            tenant_name: oldContract.tenant_name,
            actual_check_in_date: newStartDateStr,
            contract_start_date: newStartDateStr,
            contract_end_date: newEndDateStr,
            main_room_id: oldContract.main_room_id, // เซ็ตค่าเริ่มต้นเป็นห้องเดิมไว้ก่อน
            main_start_date: newStartDateStr,
            main_end_date: newEndDateStr,
            has_temp_room: false,
            temp_room_id: '',
            temp_start_date: '',
            temp_end_date: '',
            status: newStatus,
            parent_contract_id: oldContract.id // เก็บรหัสสัญญาเก่าไว้เพื่อเอาไปบันทึก
        });
        setIsShortTermContract(false);

        // 3. เปิด Modal สร้างการจอง
        setIsCreateModalOpen(true);
    };

    useEffect(() => {
        if (!loading && contracts.length > 0) {
            const params = new URLSearchParams(window.location.search);
            const renewContractId = params.get('renewContractId');
            if (renewContractId) {
                const contractToRenew = contracts.find((c: any) => c.id === renewContractId);
                if (contractToRenew) {
                    handleRenewContract(contractToRenew);
                    // Clear the query parameter from the URL
                    const url = new URL(window.location.href);
                    url.searchParams.delete('renewContractId');
                    window.history.replaceState(null, '', url.pathname + url.search);
                }
            }
        }
    }, [loading, contracts]);

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

    // Move currently-selected main room into the temporary slot (for cases where user picked it by mistake)
    const moveCreateMainToTemp = () => {
        if (!createForm.main_room_id) return;
        setCreateForm({
            ...createForm,
            has_temp_room: true,
            temp_room_id: createForm.main_room_id,
            temp_start_date: createForm.temp_start_date || createForm.actual_check_in_date || createForm.main_start_date || '',
            temp_end_date: createForm.temp_end_date || createForm.main_end_date || createForm.contract_end_date || '',
            main_room_id: '',
            main_start_date: '',
            main_end_date: '',
        });
    };

    // Move currently-selected main room into the temp slot in edit form
    const moveEditMainToTemp = () => {
        if (!editForm || !editForm.main_room_id) return;
        setEditForm({
            ...editForm,
            has_temp_room: true,
            temp_room_id: editForm.main_room_id,
            temp_start_date: editForm.temp_start_date || editForm.actual_check_in_date || editForm.main_start_date || '',
            temp_end_date: editForm.temp_end_date || editForm.main_end_date || editForm.contract_end_date || '',
            main_room_id: '',
            main_start_date: '',
            main_end_date: '',
        });
    };

    // Move temp -> main for create modal
    const moveCreateTempToMain = () => {
        if (!createForm.temp_room_id) return;
        setCreateForm({
            ...createForm,
            has_temp_room: false,
            main_room_id: createForm.temp_room_id,
            main_start_date: createForm.temp_start_date || createForm.actual_check_in_date || createForm.contract_start_date || '',
            main_end_date: createForm.temp_end_date || createForm.main_end_date || createForm.contract_end_date || '',
            temp_room_id: '',
            temp_start_date: '',
            temp_end_date: '',
        });
    };

    // Move temp -> main for edit modal
    const moveEditTempToMain = () => {
        if (!editForm || !editForm.temp_room_id) return;
        setEditForm({
            ...editForm,
            has_temp_room: false,
            main_room_id: editForm.temp_room_id,
            main_start_date: editForm.temp_start_date || editForm.actual_check_in_date || editForm.contract_start_date || '',
            main_end_date: editForm.temp_end_date || editForm.main_end_date || editForm.contract_end_date || '',
            temp_room_id: null,
            temp_start_date: null,
            temp_end_date: null,
        });
    };

    const normalizeDate = (d?: string | null) => (d && d !== '') ? d : null;

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
        if (editForm.actual_check_in_date && editForm.contract_start_date && new Date(editForm.actual_check_in_date) > new Date(editForm.contract_start_date)) {
            alert('❌ วันเข้าพักก่อนเริ่มสัญญาต้องไม่เกินวันเริ่มสัญญา');
            return;
        }

        const updatePayload = {
            tenant_name: editForm.tenant_name,
            status: editForm.status,
            contract_start_date: normalizeDate(editForm.contract_start_date),
            contract_end_date: normalizeDate(editForm.contract_end_date),
            actual_check_in_date: normalizeDate(editForm.actual_check_in_date || editForm.contract_start_date),
            main_room_id: editForm.main_room_id || null,
            main_start_date: normalizeDate(editForm.main_start_date),
            main_end_date: normalizeDate(editForm.main_end_date),
            temp_room_id: editForm.has_temp_room ? (editForm.temp_room_id || null) : null,
            temp_start_date: editForm.has_temp_room ? normalizeDate(editForm.temp_start_date) : null,
            temp_end_date: editForm.has_temp_room ? normalizeDate(editForm.temp_end_date) : null,
            move_to_room_id: editForm.move_to_room_id || null,
            move_start_date: normalizeDate(editForm.move_start_date),
            move_end_date: normalizeDate(editForm.move_end_date)
        };

        const { error } = await supabase
            .from('contracts')
            .update(updatePayload)
            .eq('id', editForm.id);

        if (error) {
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } else {
            await logAudit(profile, 'contracts', 'update', editForm.id, 'แก้ไขสัญญาเช่า', describeChanges(updatePayload));
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
        if (!isShortTermContract) {
            const expectedEnd = addDays(addYears(createForm.contract_start_date, 1), -1);
            if (createForm.contract_end_date !== expectedEnd) {
                alert('❌ สัญญาต้องมีระยะเวลา 1 ปี');
                return;
            }
        }
        const effectiveMainStart = createForm.main_start_date || createForm.contract_start_date;
        const effectiveMainEnd = createForm.main_end_date || createForm.contract_end_date;
        if (!isValidDateRange(effectiveMainStart, effectiveMainEnd)) {
            alert('❌ วันเริ่มต้นและวันสิ้นสุดของห้องหลักต้องถูกต้อง');
            return;
        }
        if (createForm.actual_check_in_date && createForm.contract_start_date && new Date(createForm.actual_check_in_date) > new Date(createForm.contract_start_date)) {
            alert('❌ วันเข้าพักก่อนเริ่มสัญญาต้องไม่เกินวันเริ่มสัญญา');
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
            actual_check_in_date: normalizeDate(createForm.actual_check_in_date || createForm.contract_start_date),
            contract_start_date: normalizeDate(createForm.contract_start_date),
            contract_end_date: normalizeDate(createForm.contract_end_date),
            main_room_id: createForm.main_room_id || null,
            main_start_date: normalizeDate(effectiveMainStart),
            main_end_date: normalizeDate(effectiveMainEnd),
            monthly_rent: createForm.monthly_rent ? Number(createForm.monthly_rent) : null,

            // --- จุดที่แก้ไข 2 บรรทัดนี้ ---
            status: createForm.status || 'active',
            parent_contract_id: createForm.parent_contract_id || null,
            // -------------------------

            temp_room_id: createForm.has_temp_room ? (createForm.temp_room_id || null) : null,
            temp_start_date: createForm.has_temp_room ? normalizeDate(createForm.temp_start_date) : null,
            temp_end_date: createForm.has_temp_room ? normalizeDate(createForm.temp_end_date) : null,
        };

        const { data, error } = await supabase.from('contracts').insert([payload]).select('id');

        if (error) {
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } else {
            const newId = data?.[0]?.id ?? null;
            if (newId) {
                await logAudit(profile, 'contracts', 'create', newId, 'สร้างสัญญาเช่าใหม่', payload);

                const today = new Date();
                const surveyMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
                const intentPayload = {
                    contract_id: newId,
                    room_id: payload.main_room_id || payload.temp_room_id || payload.move_to_room_id || null,
                    tenant_name: payload.tenant_name,
                    intention: 'not_asked',
                    survey_month: surveyMonth,
                    note: '',
                };
                const { error: intentError } = await supabase.from('renewal_intentions').insert([intentPayload]);
                if (intentError) {
                    console.warn('Failed to create default renewal intention for new contract', intentError.message);
                }
            }
            setIsCreateModalOpen(false);
            setIsShortTermContract(false);
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
                monthly_rent: '',
                parent_contract_id: null, // เพิ่มตรงนี้
            });
            fetchData();
            // หากการสร้างสัญญานี้มาจาก flow การต่อสัญญา (มี parent_contract_id)
            // ให้บันทึกความตั้งใจเป็น 'renew' สำหรับสัญญาเดิม
            if (payload.parent_contract_id) {
                try {
                    const parentId = payload.parent_contract_id;
                    const { data: existing } = await supabase.from('renewal_intentions').select('*').eq('contract_id', parentId).limit(1);
                    const today = new Date();
                    const surveyMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

                    if (existing && existing.length > 0) {
                        const upd = { intention: 'renew', note: existing[0].note ?? '', updated_at: new Date().toISOString() };
                        const { error: upErr } = await supabase.from('renewal_intentions').update(upd).eq('id', existing[0].id);
                        if (!upErr) await logAudit(profile, 'renewal_intentions', 'update', existing[0].id, 'อัปเดตความตั้งใจต่อสัญญาเป็น renew (หลังสร้างสัญญาใหม่)', describeChanges(upd));
                    } else {
                        const rec = { contract_id: parentId, room_id: null, tenant_name: payload.tenant_name, intention: 'renew', survey_month: surveyMonth, note: '' };
                        const { data: ins, error: insErr } = await supabase.from('renewal_intentions').insert([rec]).select('id');
                        const newIntId = ins?.[0]?.id ?? null;
                        if (!insErr && newIntId) await logAudit(profile, 'renewal_intentions', 'create', newIntId, 'เพิ่มความตั้งใจต่อสัญญาเป็น renew (หลังสร้างสัญญาใหม่)', rec);
                    }

                    // รีเฟรช intentions ในหน้านี้ด้วย
                    const { data: iData } = await supabase.from('renewal_intentions').select('*');
                    if (iData) setIntentions(iData);
                } catch (e) {
                    console.warn('Failed to upsert renewal intention after create', e);
                }
            }
        }
    };

    // availability helpers moved to src/lib/availability.ts

    const formatDateTH = (dateStr: string) => {
        if (!dateStr || dateStr === '2000-01-01' || dateStr === '2099-12-31') return null;
        return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
            day: 'numeric', month: 'short', year: 'numeric'
        }).format(new Date(dateStr));
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

    const getIntentionBadge = (contractId: string) => {
        const intentionObj = intentions.find(i => i.contract_id === contractId);
        if (!intentionObj) return null;

        const config: any = {
            pending: { label: 'รอตอบกลับ', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', icon: '⏳' },
            renew: { label: 'ต่อสัญญา', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: '✅' },
            not_renew: { label: 'ไม่ต่อสัญญา', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', icon: '🚪' },
        };

        const cfg = config[intentionObj.intention];
        if (!cfg) return null;

        return (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg border shadow-sm ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                {cfg.icon} {cfg.label}
            </span>
        );
    };

    const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/50 focus:border-[#4F81FF] focus:bg-white outline-none transition-all";
    const labelCls = "block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2";
    const isRenewalMode = Boolean(createForm.parent_contract_id);
    const renewalRoom = rooms.find((r: any) => r.id === createForm.main_room_id);

    // ── Shared room selector for create modal ──
    const renderCreateRoomSelector = () => {
        const start = createForm.main_start_date || createForm.contract_start_date;
        const end = createForm.main_end_date || createForm.contract_end_date;

        if (!start || !end) {
            return (
                <select className={`${inputCls} cursor-pointer`} value="" disabled>
                    <option value="">⚠️ ใส่วันที่ก่อนเพื่อดูห้องว่าง</option>
                </select>
            );
        }

        const customerPref = waitlists.find(w => w.name === createForm.tenant_name) || {};
        const availableRooms = rooms.filter(r => r.building === 'L' && isRoomAvailable(contracts, intentions, r.id, start, end));
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

    const renderCreateTempRoomSelector = () => {
        if (!createForm.temp_start_date || !createForm.temp_end_date) {
            return (
                <div className="rounded-2xl bg-white border border-slate-200 p-6 text-slate-600 text-sm">
                    กรุณาระบุวันที่เริ่มเข้าพักและวันที่ย้ายออกของห้องชั่วคราว
                </div>
            );
        }

        const start = createForm.temp_start_date;
        const end = createForm.temp_end_date;
        const customerPref = waitlists.find(w => w.name === createForm.tenant_name) || {};
        const isMatch = (prefVal: any, roomVal: any) => {
            if (!prefVal || prefVal === 'ไม่ระบุ' || prefVal === '-') return true;
            return prefVal === roomVal;
        };
        const availableRooms = rooms.filter(r => r.building === 'L' && r.id !== createForm.main_room_id && isRoomAvailable(contracts, intentions, r.id, start, end) && applyRoomFilters(r));
        const perfectMatchRooms = availableRooms.filter(r =>
            isMatch(customerPref.room_type, r.room_type) &&
            isMatch(customerPref.kitchen_type, r.kitchen_type) &&
            isMatch(customerPref.view_preference, r.view_direction)
        );
        const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));

        if (availableRooms.length === 0) {
            return (
                <div className="flex items-center gap-3 bg-red-50 border border-red-200/60 rounded-2xl px-4 py-4 text-sm text-red-600 font-medium">
                    <span className="text-xl">❌</span> ไม่มีห้องชั่วคราวว่างในช่วงนี้
                </div>
            );
        }

        const RoomCard = ({ room, isMatchRoom }: { room: any; isMatchRoom: boolean }) => {
            const isSelected = createForm.temp_room_id === room.id;
            const fw = getRoomFreeWindow(contracts, room.id, start, end);
            const fmtDate = (d: string) => formatDateTH(d);

            return (
                <button
                    type="button"
                    onClick={() => setCreateForm({ ...createForm, temp_room_id: createForm.temp_room_id === room.id ? '' : room.id })}
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
                    <span>ห้องชั่วคราวว่าง <span className="font-bold text-slate-700">{availableRooms.length}</span> ห้อง</span>
                    {perfectMatchRooms.length > 0 && (
                        <span className="bg-amber-50 text-amber-700 border border-amber-200/60 px-3 py-1 rounded-full font-semibold text-[11px]">
                            ⭐ ตรงสเปก {perfectMatchRooms.length} ห้อง
                        </span>
                    )}
                </div>
                {perfectMatchRooms.length > 0 && (
                    <div>
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
                {createForm.temp_room_id && (() => {
                    const room = rooms.find(r => r.id === createForm.temp_room_id);
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
    };

    return (
        <div className="min-h-full flex flex-col bg-transparent">
            <div className="flex-1 p-8 md:p-10">

                {/* Header */}
                <div className="flex justify-between items-end mb-8">

                    {/* ── NEW: Create booking button ── */}
                    {isEditable && (
                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="flex items-center gap-2 px-5 py-3 bg-[#4F81FF] hover:bg-[#3D6CE5] text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all active:scale-95"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                            </svg>
                            สร้างการจอง
                        </button>
                    )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center text-2xl">📋</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">สัญญาที่กรองแล้ว</p>
                            <p className="text-2xl font-bold text-[#0A2647]">{filteredContracts.length} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-2xl">✅</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">สัญญา Active</p>
                            <p className="text-2xl font-bold text-[#0A2647]">{filteredContracts.filter(c => c.status === 'active').length} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center gap-5">
                        <div className="w-14 h-14 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center text-2xl">⏳</div>
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">ต้องดำเนินการ</p>
                            <p className="text-2xl font-bold text-[#0A2647]">
                                {filteredContracts.filter(c => !c.main_room_id && c.status !== 'cancelled').length}{' '}
                                <span className="text-sm font-medium text-slate-500">รายการ</span>
                            </p>
                        </div>
                    </div>
                </div>

                <h2 className="text-lg font-bold text-[#0A2647] mb-4">รายการสัญญา</h2>

                <div className="bg-white rounded-3xl p-5 mb-6 border border-slate-100 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div>
                            <label className={labelCls}>ตึก</label>
                            <select
                                className={inputCls}
                                value={listFilters.building}
                                onChange={(e) => setListFilters({ ...listFilters, building: e.target.value })}
                            >
                                <option value="">ทุกตึก</option>
                                {buildingOptions.map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>ประเภทห้อง</label>
                            <select
                                className={inputCls}
                                value={listFilters.room_type}
                                onChange={(e) => setListFilters({ ...listFilters, room_type: e.target.value })}
                            >
                                <option value="">ทุกประเภทห้อง</option>
                                {roomTypeOptions.map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>ครัว</label>
                            <select
                                className={inputCls}
                                value={listFilters.kitchen}
                                onChange={(e) => setListFilters({ ...listFilters, kitchen: e.target.value })}
                            >
                                <option value="">ทุกประเภทครัว</option>
                                {kitchenOptions.map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>ทิศ</label>
                            <select
                                className={inputCls}
                                value={listFilters.view}
                                onChange={(e) => setListFilters({ ...listFilters, view: e.target.value })}
                            >
                                <option value="">ทุกทิศ (View)</option>
                                {viewOptions.map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>ค้นหา</label>
                            <input
                                type="text"
                                className={inputCls}
                                placeholder="ค้นหา ชื่อผู้เช่า หรือ ห้อง"
                                value={listFilters.search}
                                onChange={(e) => setListFilters({ ...listFilters, search: e.target.value })}
                            />
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#4F81FF]"></div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {filteredContracts.map((contract) => {
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
                            const isBeforeCheckIn = contract.actual_check_in_date && getDate(contract.actual_check_in_date)! > today;
                            const displayStatus = contract.status === 'cancelled' ? 'cancelled' : (isBeforeCheckIn ? 'upcoming' : contract.status);
                            const currentRoomId = (() => {
                                if (contract.temp_room_id && inRange(contract.temp_start_date, contract.temp_end_date)) return contract.temp_room_id;
                                if (contract.move_to_room_id && inRange(contract.move_start_date, contract.move_end_date)) return contract.move_to_room_id;
                                if (contract.main_room_id && inRange(contract.main_start_date, contract.main_end_date)) return contract.main_room_id;
                                return contract.main_room_id || contract.temp_room_id || contract.move_to_room_id || null;
                            })();

                            return (
                                <div
                                    key={contract.id}
                                    className={`bg-white rounded-2xl p-4 lg:p-5 flex flex-col lg:flex-row gap-4 lg:gap-6 shadow-sm hover:shadow-md border border-slate-100 transition-all duration-200 group ${contract.status === 'cancelled' ? 'opacity-60 grayscale-[20%]' : ''}`}
                                >
                                    {/* 1. ไอคอนเลขห้อง (ปรับขนาดให้สมดุลกับความสูงเนื้อหา) */}
                                    <button
                                        type="button"
                                        onClick={() => currentRoomId && handleRoomClick(currentRoomId)}
                                        disabled={!currentRoomId}
                                        className={`w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 text-slate-700 flex items-center justify-center shrink-0 font-bold text-lg shadow-sm transition-all ${currentRoomId ? 'hover:bg-slate-100 hover:scale-105 active:scale-95 cursor-pointer' : 'cursor-default'}`}
                                        title={currentRoomId ? "ดูรายละเอียดห้อง" : undefined}
                                    >
                                        {currentRoomId ? getonlyRoomNumber(currentRoomId) : '-'}
                                    </button>

                                    {/* 2. เนื้อหาหลัก (ใช้ min-w-0 เพื่อป้องกันปัญหา Flex overflow ล้นจอ) */}
                                    <div className="flex-1 min-w-0 flex flex-col md:flex-row gap-4 md:gap-6 items-start md:items-center">

                                        {/* ข้อมูลผู้เช่า */}
                                        <div className="md:w-1/3 shrink-0 flex flex-col justify-center">
                                            <h3 className="text-base font-bold text-slate-800 truncate" title={contract.tenant_name}>
                                                {contract.tenant_name}
                                            </h3>

                                            {/* --- ส่วนที่เพิ่มใหม่: วันที่สัญญา --- */}
                                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                <span>{contract.contract_start_date ? formatDateTH(contract.contract_start_date) : '-'}</span>
                                                <span className="mx-1">-</span>
                                                <span>{contract.contract_end_date ? formatDateTH(contract.contract_end_date) : '-'}</span>
                                            </div>
                                            {/* ----------------------------- */}

                                            <div className="mt-2 flex items-center flex-wrap gap-2">
                                                {getStatusBadge(displayStatus)}
                                                {getIntentionBadge(contract.id)}
                                            </div>
                                        </div>

                                        {/* ข้อมูลห้องและการแจ้งเตือน */}
                                        <div className="md:w-2/3 min-w-0 flex flex-col gap-3">
                                            {/* ป้ายเตือนต่างๆ */}
                                            {(needsTempRoom || missingMainRoom) && (
                                                <div className="flex flex-wrap gap-2">
                                                    {needsTempRoom && (
                                                        <span className="bg-red-50 text-red-600 border border-red-200/60 text-xs px-3 py-1.5 rounded-lg font-medium animate-pulse flex items-center gap-1.5">
                                                            🚨 ต้องระบุห้องชั่วคราว
                                                        </span>
                                                    )}
                                                    {missingMainRoom && (
                                                        <span className="bg-amber-50 text-amber-700 border border-amber-200/60 text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5">
                                                            ⚠️ ยังไม่ระบุห้องหลัก
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {/* การ์ดห้องพัก (Scroll แนวนอนแบบไม่เห็น Scrollbar) */}
                                            <div className="flex flex-row flex-nowrap gap-3 text-sm overflow-x-auto pb-1 min-w-0 scrollbar-hide">
                                                {contract.temp_room_id && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRoomClick(contract.temp_room_id)}
                                                        className="shrink-0 w-[150px] rounded-xl border border-amber-200/70 bg-amber-50 p-3 min-h-[90px] flex flex-col justify-between text-left hover:bg-amber-100/50 hover:border-amber-300 hover:shadow-sm hover:scale-[1.02] active:scale-95 transition-all cursor-pointer outline-none focus:ring-2 focus:ring-amber-400/50"
                                                        title="คลิกเพื่อดูรายละเอียดห้องชั่วคราว"
                                                    >
                                                        <div>
                                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-0.5">ห้องพักชั่วคราว</div>
                                                            <div className="font-bold text-slate-900">{getRoomNumber(contract.temp_room_id)}</div>
                                                        </div>
                                                        <div className="text-[11px] text-slate-600 mt-2 truncate">
                                                            {formatDateTH(contract.temp_start_date) || '-'} - {formatDateTH(contract.temp_end_date) || '-'}
                                                        </div>
                                                    </button>
                                                )}

                                                {contract.main_room_id ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRoomClick(contract.main_room_id)}
                                                        className="shrink-0 w-[150px] rounded-xl border border-slate-200 bg-slate-50 p-3 min-h-[90px] flex flex-col justify-between text-left hover:bg-slate-100/80 hover:border-slate-300 hover:shadow-sm hover:scale-[1.02] active:scale-95 transition-all cursor-pointer outline-none focus:ring-2 focus:ring-slate-300"
                                                        title="คลิกเพื่อดูรายละเอียดห้องหลัก"
                                                    >
                                                        <div>
                                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">ห้องพักหลัก</div>
                                                            <div className="font-bold text-slate-900 truncate">
                                                                {getRoomNumber(contract.main_room_id)}
                                                            </div>
                                                        </div>
                                                        <div className="text-[11px] text-slate-600 mt-2 truncate">
                                                            {formatDateTH(contract.main_start_date) || '-'} - {formatDateTH(contract.main_end_date) || '-'}
                                                        </div>
                                                    </button>
                                                ) : (
                                                    <div className="shrink-0 w-[150px] rounded-xl border border-slate-200 bg-slate-50 p-3 min-h-[90px] flex flex-col justify-between opacity-60">
                                                        <div>
                                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">ห้องพักหลัก</div>
                                                            <div className="font-bold text-slate-400 truncate">
                                                                ยังไม่ระบุห้อง
                                                            </div>
                                                        </div>
                                                        <div className="text-[11px] text-slate-400 mt-2 truncate">
                                                            {formatDateTH(contract.main_start_date) || '-'} - {formatDateTH(contract.main_end_date) || '-'}
                                                        </div>
                                                    </div>
                                                )}

                                                {contract.move_to_room_id && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRoomClick(contract.move_to_room_id)}
                                                        className="shrink-0 w-[150px] rounded-xl border border-sky-200 bg-sky-50 p-3 min-h-[90px] flex flex-col justify-between text-left hover:bg-sky-100/50 hover:border-sky-300 hover:shadow-sm hover:scale-[1.02] active:scale-95 transition-all cursor-pointer outline-none focus:ring-2 focus:ring-sky-300"
                                                        title="คลิกเพื่อดูรายละเอียดห้องที่ย้ายไป"
                                                    >
                                                        <div>
                                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-700 mb-0.5">ย้ายห้องไปที่</div>
                                                            <div className="font-bold text-slate-900">{getRoomNumber(contract.move_to_room_id)}</div>
                                                        </div>
                                                        <div className="text-[11px] text-slate-600 mt-2 truncate">
                                                            {formatDateTH(contract.move_start_date) || '-'} - {formatDateTH(contract.move_end_date) || '-'}
                                                        </div>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* 3. ปุ่ม Action (จัดเรียงชิดขวา และปรับความสูงให้เท่ากันที่พิกัด 38px/40px) */}
                                    {isEditable && (
                                        <div className="flex flex-wrap items-center justify-end gap-2 lg:pl-6 lg:border-l border-slate-100 pt-4 lg:pt-0 border-t lg:border-t-0 mt-2 lg:mt-0 shrink-0">
                                            <button
                                                onClick={() => handleEditClick(contract)}
                                                className="h-[38px] w-[38px] rounded-xl border border-transparent flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
                                                title="แก้ไขข้อมูล"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                            </button>

                                            {contract.status !== 'cancelled' && (
                                                <>
                                                    <button
                                                        onClick={() => handleRenewContract(contract)}
                                                        className="h-[38px] bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-500 px-4 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5"
                                                    >
                                                        ต่อสัญญา
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                    </button>
                                                    <button
                                                        onClick={() => openCancelModal(contract)}
                                                        className="h-[38px] bg-red-50 hover:bg-red-500 text-red-600 hover:text-white border border-red-200 hover:border-red-500 px-4 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5"
                                                        title="ยกเลิกสัญญา"
                                                    >
                                                        ยกเลิกสัญญา
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Empty State */}
                        {contracts.length === 0 && (
                            <div className="text-center py-16 text-slate-400 bg-white/50 rounded-3xl border border-slate-200 border-dashed flex flex-col items-center">
                                <div className="text-5xl mb-4 opacity-50 grayscale">📭</div>
                                <p className="font-semibold text-lg text-slate-600">ยังไม่มีสัญญาเช่า</p>
                                <p className="text-sm mt-1 text-slate-500">สัญญาจะปรากฏที่นี่หลังจากจัดสรรห้องเรียบร้อยแล้ว</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ─── Create Booking Modal ─── */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-8xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">

                        {/* Modal header */}
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-xl font-bold text-[#0A2647]">สร้างการจองใหม่</h2>
                                <p className="text-sm text-slate-500 mt-0.5">ระบุข้อมูลผู้เช่าและห้องพัก</p>
                            </div>
                            <button
                                onClick={() => {
                                    setIsCreateModalOpen(false);
                                    setIsShortTermContract(false);
                                }}
                                className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Modal body */}
                        <div className="p-8 overflow-y-auto flex-1">
                            <div className="grid gap-8 xl:grid-cols-[1fr_1fr]">
                                <form id="create-contract-form" onSubmit={handleCreateContract} className="space-y-6">

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
                                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
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
                                                <label className={labelCls}>วันเข้าพักก่อนเริ่มสัญญา</label>
                                                <input
                                                    type="date"
                                                    className={inputCls}
                                                    value={createForm.actual_check_in_date}
                                                    onChange={(e) => setCreateForm({ ...createForm, actual_check_in_date: e.target.value })}
                                                />
                                            </div>
                                            <div className="lg:col-span-2">
                                                <label className={labelCls}>วันสิ้นสุดสัญญา{isShortTermContract ? '' : ' (1 ปี)'}</label>
                                                <input
                                                    type="date"
                                                    className={inputCls}
                                                    value={createForm.contract_end_date}
                                                    onChange={(e) => {
                                                        if (isShortTermContract) {
                                                            setCreateForm({ ...createForm, contract_end_date: e.target.value });
                                                        }
                                                    }}
                                                    readOnly={!isShortTermContract}
                                                    required
                                                />
                                                {createForm.parent_contract_id && (
                                                    <div className="mt-3 flex flex-wrap items-center gap-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsShortTermContract(prev => !prev)}
                                                            className={`px-4 py-2 rounded-2xl text-sm font-semibold transition ${isShortTermContract ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                                                        >
                                                            สัญญาระยะสั้น
                                                        </button>
                                                        <p className="text-xs text-slate-500">
                                                            {isShortTermContract
                                                                ? 'สามารถแก้วันสิ้นสุดสัญญาได้เองแล้ว'
                                                                : 'กดเพื่อเปิดการแก้วันที่สิ้นสุดสัญญาสำหรับการต่อสัญญา'}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                                            <div className="md:col-span-2">
                                                <label className={labelCls}>ราคาเช่าต่อเดือน</label>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    className={inputCls}
                                                    value={
                                                        createForm.monthly_rent
                                                            ? Number(createForm.monthly_rent).toLocaleString("en-US")
                                                            : ""
                                                    }
                                                    onChange={(e) => {
                                                        const value = e.target.value.replace(/,/g, "").replace(/\D/g, "");

                                                        setCreateForm({
                                                            ...createForm,
                                                            monthly_rent: value ? Number(value) : 0,
                                                        });
                                                    }}
                                                    placeholder="เช่น 17,000"
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
                                                    temp_start_date: createForm.actual_check_in_date || createForm.contract_start_date || '',
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
                                                    onClick={() => setCreateForm({ ...createForm, has_temp_room: false, temp_room_id: '', temp_start_date: '', temp_end_date: '' })}
                                                    className="absolute top-4 right-4 text-xs px-3 py-1.5 bg-white text-red-500 border border-red-200 rounded-xl font-semibold hover:bg-red-50 transition-colors"
                                                >
                                                    ยกเลิก
                                                </button>
                                                {createForm.temp_room_id && (
                                                    <button
                                                        type="button"
                                                        onClick={moveCreateTempToMain}
                                                        className="absolute top-4 right-20 text-xs px-3 py-1.5 bg-white text-emerald-700 border border-emerald-200 rounded-xl font-semibold hover:bg-emerald-50 transition-colors"
                                                    >
                                                        ตั้งเป็นห้องหลัก
                                                    </button>
                                                )}
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
                                                    <div className="hidden md:block" />
                                                </div>
                                                <div className="space-y-4 mt-5">
                                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                                        <span className="w-5 h-5 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center text-[10px]">4</span>
                                                        เลือกห้องพักชั่วคราว
                                                    </p>
                                                    {renderCreateTempRoomSelector()}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Warn if a temp room is selected but no main room chosen yet */}
                                    {createForm.has_temp_room && createForm.temp_room_id && !createForm.main_room_id && (
                                        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
                                            ⚠️ คุณเลือกห้องชั่วคราวแล้ว แต่ยังไม่ได้เลือกห้องหลัก — โปรดเลือกห้องหลักก่อนยืนยันการจอง
                                        </div>
                                    )}
                                </form>

                                <div className="space-y-6 bg-slate-50 border border-slate-200 rounded-[2rem] p-6 overflow-hidden">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">เลือกห้องพักหลัก</p>
                                            <p className="text-sm text-slate-500">ดูห้องว่างในช่วงสัญญาได้ที่นี่</p>
                                        </div>
                                        {!isRenewalMode && createForm.main_room_id && (
                                            <button
                                                type="button"
                                                onClick={moveCreateMainToTemp}
                                                className="text-xs px-3 py-1.5 bg-white text-amber-700 border border-amber-200 rounded-xl font-semibold hover:bg-amber-50 transition-colors"
                                            >
                                                ย้ายห้องที่เลือกเป็นชั่วคราว
                                            </button>
                                        )}
                                    </div>

                                    {isRenewalMode ? (
                                        <div className="rounded-2xl border border-blue-200/60 bg-blue-50 p-6">
                                            <p className="text-sm font-semibold text-slate-700">ห้องเก่าที่ต่อสัญญา</p>
                                            {renewalRoom ? (
                                                <>
                                                    <p className="mt-3 text-3xl font-bold text-blue-900">ห้อง {renewalRoom.room_number}</p>
                                                    <p className="mt-2 text-sm text-blue-600">
                                                        {[renewalRoom.room_type, renewalRoom.view_direction ? `วิว${renewalRoom.view_direction}` : null, renewalRoom.kitchen_type ? `ครัว${renewalRoom.kitchen_type}` : null]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </p>
                                                    <p className="mt-4 text-sm text-slate-600">ห้องนี้ถูกล็อกไว้สำหรับการต่อสัญญาใหม่ ไม่ต้องเลือกห้องเพิ่มเติม</p>
                                                </>
                                            ) : (
                                                <p className="mt-3 text-sm text-slate-600">ไม่พบข้อมูลห้องเดิม โปรดตรวจสอบข้อมูลสัญญา</p>
                                            )}
                                        </div>
                                    ) : createForm.contract_start_date && createForm.contract_end_date ? (
                                        (() => {
                                            const start = createForm.main_start_date || createForm.contract_start_date;
                                            const end = createForm.main_end_date || createForm.contract_end_date;
                                            const customerPref = waitlists.find(w => w.name === createForm.tenant_name) || {};
                                            const availableRooms = rooms.filter(r => r.building === 'L' && isRoomAvailable(contracts, intentions, r.id, start, end) && applyRoomFilters(r));
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
                                                const fw = getRoomFreeWindow(contracts, room.id, start, end);
                                                const fmtDate = (d: string) => formatDateTH(d);

                                                return (
                                                    <button
                                                        type="button"
                                                        onClick={() => setCreateForm({ ...createForm, main_room_id: createForm.main_room_id === room.id ? '' : room.id })}
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
                                                                ⭐{perfectMatchRooms.length} ห้อง
                                                            </span>
                                                        )}
                                                    </div>
                                                    {perfectMatchRooms.length > 0 && (
                                                        <div>
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
                                        })()
                                    ) : (
                                        <div className="rounded-2xl bg-white border border-slate-200 p-6 text-slate-600 text-sm">
                                            กรุณาเลือกวันเริ่มต้นและวันสิ้นสุดสัญญาเพื่อดูรายการห้องว่าง
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Modal footer */}
                        <div className="px-8 py-5 border-t border-slate-100 flex gap-4 shrink-0">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCreateModalOpen(false);
                                    setIsShortTermContract(false);
                                }}
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
                                {/* <p className="mt-2 text-sm text-slate-500">{cancelEndDate ? new Date(cancelEndDate).toLocaleDateString('th-TH') : '-'}</p> */}
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
                                {getStatusBadge(editForm.status)}
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
                                <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                                    <div>
                                        <label className={labelCls}>วันเข้าพักก่อนเริ่มสัญญา</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.actual_check_in_date || ''}
                                            onChange={(e) => setEditForm({ ...editForm, actual_check_in_date: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันเริ่มสัญญา</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.contract_start_date || ''}
                                            disabled
                                            onChange={(e) => setEditForm({ ...editForm, contract_start_date: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>วันสิ้นสุดสัญญา</label>
                                        <input type="date" className={inputCls}
                                            value={editForm.contract_end_date || ''}
                                            disabled
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
                                            onClick={() => setEditForm({ ...editForm, has_temp_room: false, temp_room_id: null, temp_start_date: null, temp_end_date: null })}
                                            className="absolute top-4 right-4 text-xs px-3 py-1.5 bg-white text-red-500 border border-red-200 rounded-xl font-semibold hover:bg-red-50 transition-colors"
                                        >
                                            ยกเลิก
                                        </button>
                                        {editForm.temp_room_id && (
                                            <button
                                                type="button"
                                                onClick={moveEditTempToMain}
                                                className="absolute top-4 right-20 text-xs px-3 py-1.5 bg-white text-emerald-700 border border-emerald-200 rounded-xl font-semibold hover:bg-emerald-50 transition-colors"
                                            >
                                                ตั้งเป็นห้องหลัก
                                            </button>
                                        )}
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
                                <div className="flex items-center justify-end mb-3">
                                    {editForm.main_room_id && (
                                        <button
                                            type="button"
                                            onClick={moveEditMainToTemp}
                                            className="text-xs px-3 py-1.5 bg-white text-amber-700 border border-amber-200 rounded-xl font-semibold hover:bg-amber-50 transition-colors"
                                        >
                                            ย้ายห้องหลักนี้เป็นชั่วคราว
                                        </button>
                                    )}
                                </div>
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
                                            const availableRooms = rooms.filter(r => r.building === 'L' && isRoomAvailable(contracts, intentions, r.id, editForm.main_start_date, editForm.main_end_date, editForm.id));
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
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                                            <label className={labelCls}>ประเภทห้อง</label>
                                            <select
                                                className={inputCls}
                                                value={roomFilters.room_type}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, room_type: e.target.value })}
                                            >
                                                <option value="">-- ทุกประเภทห้อง --</option>
                                                {roomTypeOptions.map((value) => (
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
                                                <option value="">-- ทุกประเภทครัว --</option>
                                                {kitchenOptions.map((value) => (
                                                    <option key={value} value={value}>{value}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>ค้นหา</label>
                                            <input
                                                type="text"
                                                className={inputCls}
                                                placeholder="ค้นหาเลขห้อง หรือ ประเภท"
                                                value={roomFilters.search}
                                                onChange={(e) => setRoomFilters({ ...roomFilters, search: e.target.value })}
                                            />
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
                                        const availableRooms = rooms.filter(r => r.building === 'L' && isRoomAvailable(contracts, intentions, r.id, editForm.main_start_date, editForm.main_end_date, editForm.id) && applyRoomFilters(r));
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
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                                                        <label className={labelCls}>ประเภทห้อง</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.room_type}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, room_type: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกประเภทห้อง --</option>
                                                            {roomTypeOptions.map((value) => (
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
                                                            <option value="">-- ทุกประเภทครัว --</option>
                                                            {kitchenOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>ค้นหา</label>
                                                        <input
                                                            type="text"
                                                            className={inputCls}
                                                            placeholder="ค้นหาเลขห้อง หรือ ประเภท"
                                                            value={roomFilters.search}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, search: e.target.value })}
                                                        />
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
                                        const availableRooms = rooms.filter(r => r.building === 'L' && isRoomAvailable(contracts, intentions, r.id, editForm.move_start_date, editForm.move_end_date, editForm.id) && applyRoomFilters(r));
                                        return availableRooms.length > 0 ? (
                                            <>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                                                        <label className={labelCls}>ประเภทห้อง</label>
                                                        <select
                                                            className={inputCls}
                                                            value={roomFilters.room_type}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, room_type: e.target.value })}
                                                        >
                                                            <option value="">-- ทุกประเภทห้อง --</option>
                                                            {roomTypeOptions.map((value) => (
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
                                                            <option value="">-- ทุกประเภทครัว --</option>
                                                            {kitchenOptions.map((value) => (
                                                                <option key={value} value={value}>{value}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>ค้นหา</label>
                                                        <input
                                                            type="text"
                                                            className={inputCls}
                                                            placeholder="ค้นหาเลขห้อง หรือ ประเภท"
                                                            value={roomFilters.search}
                                                            onChange={(e) => setRoomFilters({ ...roomFilters, search: e.target.value })}
                                                        />
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

            {/* ─── Room Details Modal ─── */}
            {selectedRoomForDetail && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-xl font-bold text-[#0A2647]">ข้อมูลห้องพัก</h2>
                                <p className="text-sm text-slate-500 mt-0.5">รายละเอียดและสิ่งอำนวยความสะดวก</p>
                            </div>
                            <button
                                onClick={() => setSelectedRoomForDetail(null)}
                                className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-8 space-y-6 overflow-y-auto">
                            {/* Main Header visual */}
                            <div className="flex items-center gap-5 bg-slate-50 border border-slate-100 rounded-3xl p-5">
                                <div className="w-16 h-16 bg-[#4F81FF] text-white rounded-2xl flex items-center justify-center font-bold text-2xl shadow-lg shadow-blue-500/20">
                                    🚪
                                </div>
                                <div>
                                    <h3 className="text-2xl font-bold text-[#0A2647]">ห้อง {selectedRoomForDetail.room_number}</h3>
                                    <p className="text-sm text-slate-500 font-medium">
                                        ตึก {selectedRoomForDetail.building || '-'} · ชั้น {selectedRoomForDetail.floor != null ? selectedRoomForDetail.floor : '-'}
                                    </p>
                                </div>
                            </div>

                            {/* Features List */}
                            <div className="space-y-4">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">คุณลักษณะของห้อง</p>

                                <div className="grid grid-cols-1 gap-3.5">
                                    {/* ประเภทห้อง */}
                                    <div className="flex items-center justify-between p-3.5 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                        <div className="flex items-center gap-3">
                                            <span className="text-lg">🛏️</span>
                                            <span className="text-sm font-semibold text-slate-500">ประเภทห้อง</span>
                                        </div>
                                        <span className="text-sm font-bold text-slate-800 bg-white border border-slate-200/60 px-3 py-1 rounded-xl">
                                            {selectedRoomForDetail.room_type || 'ไม่ระบุ'}
                                        </span>
                                    </div>

                                    {/* ประเภทครัว */}
                                    <div className="flex items-center justify-between p-3.5 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                        <div className="flex items-center gap-3">
                                            <span className="text-lg">🍳</span>
                                            <span className="text-sm font-semibold text-slate-500">ประเภทครัว</span>
                                        </div>
                                        <span className="text-sm font-bold text-slate-800 bg-white border border-slate-200/60 px-3 py-1 rounded-xl">
                                            {selectedRoomForDetail.kitchen_type || 'ไม่ระบุ'}
                                        </span>
                                    </div>

                                    {/* ทิศ / วิว */}
                                    <div className="flex items-center justify-between p-3.5 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                        <div className="flex items-center gap-3">
                                            <span className="text-lg">🌅</span>
                                            <span className="text-sm font-semibold text-slate-500">ทิศ / วิว</span>
                                        </div>
                                        <span className="text-sm font-bold text-slate-800 bg-white border border-slate-200/60 px-3 py-1 rounded-xl">
                                            {selectedRoomForDetail.view_direction || 'ไม่ระบุ'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Occupancy Status Section */}
                            <div className="pt-4 border-t border-slate-100 space-y-3">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">สถานะการใช้งานปัจจุบัน</p>
                                {(() => {
                                    const activeContract = contracts.find(
                                        c => c.status === 'active' && getCurrentRoomId(c) === selectedRoomForDetail.id
                                    );

                                    if (activeContract) {
                                        return (
                                            <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 space-y-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                                                    <span className="text-sm font-bold text-amber-800">มีผู้เข้าพักในขณะนี้</span>
                                                </div>
                                                <div className="text-xs text-amber-700 space-y-1">
                                                    <p className="font-semibold">ผู้เช่า: <span className="text-slate-900 font-bold">{activeContract.tenant_name}</span></p>
                                                    <p>
                                                        ระยะเวลาสัญญา: {formatDateTH(activeContract.contract_start_date) || '-'} - {formatDateTH(activeContract.contract_end_date) || '-'}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    } else {
                                        return (
                                            <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-4 flex items-center gap-3">
                                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                                <span className="text-sm font-bold text-emerald-800">ว่าง (ไม่มีผู้พักอาศัยในปัจจุบัน)</span>
                                            </div>
                                        );
                                    }
                                })()}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-8 py-5 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
                            <button
                                type="button"
                                onClick={() => setSelectedRoomForDetail(null)}
                                className="w-full px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all text-center"
                            >
                                ปิดหน้าต่าง
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}