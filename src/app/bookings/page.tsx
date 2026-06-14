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

    // ── Create booking state ──
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
                            className={`text-left rounded-3xl p-5 min-h-[150px] border transition-all ${isSelected ? 'border-[#4F81FF] bg-blue-50/70 shadow-lg shadow-blue-100/50 ring-2 ring-[#4F81FF]/20 dark:border-[#4F81FF]/20 dark:bg-[#4F81FF]/10 dark:shadow-none dark:ring-[#4F81FF]/10' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-sm'}`}
                        >
                            <p className="text-base font-bold text-slate-900">ห้อง {room.room_number}</p>
                            <div className="mt-3 text-sm text-slate-600 leading-6 space-y-1">
                                <p>{room.room_type || '-'} | ครัว{room.kitchen_type || '-'} | วิว{room.view_direction || '-'}</p>
                                <p>{room.building ? `ตึก ${room.building}` : 'ตึก -'} · {room.floor != null ? `ชั้น ${room.floor}` : 'ชั้น -'}</p>
                                {freeWindow && (
                                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
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

        setCreateForm({
            tenant_name: oldContract.tenant_name,
            actual_check_in_date: newStartDateStr,
            contract_start_date: newStartDateStr,
            contract_end_date: newEndDateStr,
            main_room_id: oldContract.move_to_room_id || oldContract.main_room_id,
            main_start_date: newStartDateStr,
            main_end_date: newEndDateStr,
            has_temp_room: false,
            temp_room_id: '',
            temp_start_date: '',
            temp_end_date: '',
            status: newStatus,
            parent_contract_id: oldContract.id
        });
        setIsShortTermContract(false);
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
                main_end_date: editForm.contract_end_date && new Date(dayBefore) > new Date(editForm.contract_end_date) ? editForm.contract_end_date : dayBefore,
            });
        } else {
            setEditForm({ ...editForm, move_start_date: '' });
        }
    };

    const handleTempEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (!editForm) return;
        if (newDate) {
            // Clamp temp_end_date to contract_end_date if present
            let clamped = newDate;
            if (editForm.contract_end_date && new Date(newDate) > new Date(editForm.contract_end_date)) {
                clamped = editForm.contract_end_date;
            }
            setEditForm({
                ...editForm,
                temp_end_date: clamped,
                main_start_date: (!editForm.main_start_date || editForm.main_start_date === editForm.temp_end_date)
                    ? clamped
                    : editForm.main_start_date,
            });
        } else {
            setEditForm({ ...editForm, temp_end_date: '' });
        }
    };

    const handleEditTempStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (!editForm) return;
        if (!newDate) {
            setEditForm({ ...editForm, temp_start_date: '' });
            return;
        }

        // main_end_date should be the day before temp_start_date
        const d = new Date(newDate);
        d.setDate(d.getDate() - 1);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        let dayBefore = `${year}-${month}-${day}`;

        // Ensure main_end_date does not exceed contract_end_date
        if (editForm.contract_end_date && new Date(dayBefore) > new Date(editForm.contract_end_date)) {
            dayBefore = editForm.contract_end_date;
        }

        // Set temp_end_date to contract_end_date (or keep empty string if not available)
        const tempEnd = editForm.contract_end_date || '';

        setEditForm({
            ...editForm,
            temp_start_date: newDate,
            temp_end_date: tempEnd,
            main_end_date: dayBefore,
        });
    };

    const handleEditMainEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (!editForm) return;
        if (!newDate) {
            setEditForm({ ...editForm, main_end_date: '' });
            return;
        }
        let clamped = newDate;
        if (editForm.contract_end_date && new Date(newDate) > new Date(editForm.contract_end_date)) {
            clamped = editForm.contract_end_date;
        }
        setEditForm({ ...editForm, main_end_date: clamped });
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

        // Ensure main_end_date and temp_end_date do not exceed contract_end_date
        if (editForm.contract_end_date && editForm.main_end_date && new Date(editForm.main_end_date) > new Date(editForm.contract_end_date)) {
            alert('❌ วันสิ้นสุดของห้องหลักต้องไม่เกินวันสิ้นสุดสัญญา');
            return;
        }
        if (editForm.has_temp_room && editForm.contract_end_date && editForm.temp_end_date && new Date(editForm.temp_end_date) > new Date(editForm.contract_end_date)) {
            alert('❌ วันที่ย้ายออกของห้องชั่วคราวต้องไม่เกินวันสิ้นสุดสัญญา');
            return;
        }

        // Re-check availability to avoid race conditions / inconsistent selections
        try {
            // main room
            if (editForm.main_room_id) {
                const mainStart = editForm.main_start_date || editForm.contract_start_date;
                const mainEnd = editForm.main_end_date || editForm.contract_end_date;
                if (!isRoomAvailable(contracts, intentions, editForm.main_room_id, mainStart, mainEnd, editForm.id)) {
                    alert('❌ ห้องหลักที่เลือกไม่ว่างในช่วงที่ระบุ');
                    return;
                }
            }

            // temp room
            if (editForm.has_temp_room && editForm.temp_room_id) {
                if (!isRoomAvailable(contracts, intentions, editForm.temp_room_id, editForm.temp_start_date, editForm.temp_end_date, editForm.id)) {
                    alert('❌ ห้องชั่วคราวที่เลือกไม่ว่างในช่วงที่ระบุ');
                    return;
                }
            }

            // move-to room
            if (editForm.move_to_room_id) {
                if (!isRoomAvailable(contracts, intentions, editForm.move_to_room_id, editForm.move_start_date, editForm.move_end_date, editForm.id)) {
                    alert('❌ ห้องย้ายที่เลือกไม่ว่างในช่วงที่ระบุ');
                    return;
                }
            }
        } catch (e) {
            console.warn('Availability re-check failed', e);
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
            status: createForm.status || 'active',
            parent_contract_id: createForm.parent_contract_id || null,
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
                parent_contract_id: null,
            });
            fetchData();
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

                    const { data: iData } = await supabase.from('renewal_intentions').select('*');
                    if (iData) setIntentions(iData);
                } catch (e) {
                    console.warn('Failed to upsert renewal intention after create', e);
                }
            }
        }
    };

    const formatDateTH = (dateStr: string) => {
        if (!dateStr || dateStr === '2000-01-01' || dateStr === '2099-12-31') return null;
        return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
            day: 'numeric', month: 'short', year: 'numeric'
        }).format(new Date(dateStr));
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'active':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 tracking-wider">ACTIVE</span>;
            case 'completed':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200/60 tracking-wider">COMPLETED</span>;
            case 'upcoming':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200/60 tracking-wider">UPCOMING</span>;
            case 'cancelled':
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-50 text-red-600 border border-red-200/60 tracking-wider">CANCELLED</span>;
            default:
                return <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60 tracking-wider">{status.toUpperCase()}</span>;
        }
    };

    const getIntentionBadge = (contractId: string) => {
        const intentionObj = intentions.find(i => i.contract_id === contractId);
        if (!intentionObj) return null;

        const config: any = {
            not_asked: { 
                label: 'ยังไม่สอบถาม', color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-300', 
                icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> 
            },
            pending: { 
                label: 'รอตอบกลับ', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', 
                icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> 
            },
            renew: { 
                label: 'ต่อสัญญาห้องเดิม', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', 
                icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> 
            },
            renew_no_room: { 
                label: 'ต่อสัญญาไม่ระบุห้อง', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', 
                icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> 
            },
            not_renew: { 
                label: 'ไม่ต่อสัญญา', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', 
                icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg> 
            },
        };

        const cfg = config[intentionObj.intention];
        if (!cfg) return null;

        return (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg border shadow-sm ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                {cfg.icon} {cfg.label}
            </span>
        );
    };

    const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:ring-2 focus:ring-[#4F81FF]/30 focus:border-[#4F81FF] focus:bg-white outline-none transition-all duration-200 font-medium";
    const labelCls = "block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2";
    const isRenewalMode = Boolean(createForm.parent_contract_id);
    const renewalRoom = rooms.find((r: any) => r.id === createForm.main_room_id);

    const renderCreateTempRoomSelector = () => {
        if (!createForm.temp_start_date || !createForm.temp_end_date) {
            return (
                <div className="rounded-2xl bg-white border border-slate-200 p-6 text-slate-600 text-sm font-medium">
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
        const availableRooms = rooms.filter(r => r.id !== createForm.main_room_id && isRoomAvailable(contracts, intentions, r.id, start, end) && applyRoomFilters(r));
        const perfectMatchRooms = availableRooms.filter(r =>
            isMatch(customerPref.room_type, r.room_type) &&
            isMatch(customerPref.kitchen_type, r.kitchen_type) &&
            isMatch(customerPref.view_preference, r.view_direction)
        );
        const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));

        if (availableRooms.length === 0) {
            return (
                <div className="flex items-center gap-3 bg-red-50 border border-red-200/60 rounded-2xl px-4 py-4 text-sm text-red-600 font-bold">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    ไม่มีห้องชั่วคราวว่างในช่วงนี้
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
                        ? 'border-[#4F81FF] bg-blue-50 ring-2 ring-[#4F81FF]/20 dark:border-[#4F81FF]/20 dark:bg-[#4F81FF]/10 dark:shadow-none dark:ring-[#4F81FF]/10'
                        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                        }`}
                >
                    {isMatchRoom && (
                        <span className="absolute top-2.5 right-2.5 text-amber-500">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                        </span>
                    )}
                    <p className={`text-base font-bold mb-2 ${isSelected ? 'text-[#4F81FF]' : 'text-slate-800'}`}>
                        ห้อง {room.room_number}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                        {room.room_type && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isSelected ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200/60'}`}>
                                {room.room_type}
                            </span>
                        )}
                        {room.view_direction && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isSelected ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200/60'}`}>
                                วิว{room.view_direction}
                            </span>
                        )}
                        {room.kitchen_type && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isSelected ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200/60'}`}>
                                ครัว{room.kitchen_type}
                            </span>
                        )}
                    </div>
                    <div className={`flex items-center gap-1 text-[10px] font-bold ${isSelected ? 'text-blue-500' : 'text-emerald-600'}`}>
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
                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                    <span>ห้องชั่วคราวว่าง <span className="text-slate-700 font-extrabold">{availableRooms.length}</span> ห้อง</span>
                    {perfectMatchRooms.length > 0 && (
                        <span className="bg-amber-50 text-amber-700 border border-amber-200/60 px-3 py-1 rounded-full text-[11px] flex items-center gap-1">
                            ตรงสเปก {perfectMatchRooms.length} ห้อง
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
                        <p className="text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-wide">🏢 ห้องว่างอื่นๆ</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                            {otherRooms.map(r => <RoomCard key={r.id} room={r} isMatchRoom={false} />)}
                        </div>
                    </div>
                )}
                {createForm.temp_room_id && (() => {
                    const room = rooms.find(r => r.id === createForm.temp_room_id);
                    return room ? (
                        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200/60 rounded-2xl px-4 py-3">
                            <div className="w-8 h-8 bg-[#4F81FF] rounded-xl flex items-center justify-center text-white text-sm shrink-0">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                            </div>
                            <div>
                                <p className="text-sm font-bold text-blue-800">ห้อง {room.room_number} — เลือกแล้ว</p>
                                <p className="text-xs text-blue-600 font-medium">
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
        <div className="min-h-full flex flex-col bg-slate-50/50 dark:bg-transparent">
            {/* ฝังฟอนต์ K2D ลงในสไตล์ชีทท้องถิ่นเพื่อรับประกันความสวยงาม */}
            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=K2D:wght@300;400;500;600;700;800&display=swap');
                div, button, input, select, h1, h2, h3, h4, p, span, label {
                    font-family: 'K2D', sans-serif !important;
                }
            `}</style>

            <div className="flex-1 p-8 md:p-10 max-w-7xl w-full mx-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-200/60">
                    <div>
                        <h1 className="text-2xl font-extrabold text-[#0A2647] tracking-tight">ระบบจัดการการจองห้องพัก</h1>
                        <p className="text-sm text-slate-500 font-medium mt-1">บริหารจัดการสัญญาเช่า สัญญาหลัก และการจัดสรรห้องพักชั่วคราว</p>
                    </div>
                    {isEditable && (
                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="flex items-center gap-2 px-6 py-3.5 bg-[#4F81FF] hover:bg-[#3D6CE5] text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all active:scale-[0.98]"
                        >
                            <svg className="w-4 h-4 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            สร้างการจองใหม่
                        </button>
                    )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-5 transition-transform hover:scale-[1.01]">
                        <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">สัญญาที่กรองแล้ว</p>
                            <p className="text-2xl font-extrabold text-[#0A2647]">{filteredContracts.length} <span className="text-sm font-bold text-slate-400">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-5 transition-transform hover:scale-[1.01]">
                        <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">สัญญา Active</p>
                            <p className="text-2xl font-extrabold text-[#0A2647]">{filteredContracts.filter(c => c.status === 'active').length} <span className="text-sm font-bold text-slate-400">รายการ</span></p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center gap-5 transition-transform hover:scale-[1.01]">
                        <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shadow-inner">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">ต้องดำเนินการ</p>
                            <p className="text-2xl font-extrabold text-[#0A2647]">
                                {filteredContracts.filter(c => !c.main_room_id && c.status !== 'cancelled').length}{' '}
                                <span className="text-sm font-bold text-slate-400">รายการ</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Filters Section */}
                <div className="bg-white rounded-3xl p-6 mb-6 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                        <h2 className="text-sm font-bold text-[#0A2647] uppercase tracking-wider">ตัวกรองข้อมูลสัญญา</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
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
                            <label className={labelCls}>ทิศ (View)</label>
                            <select
                                className={inputCls}
                                value={listFilters.view}
                                onChange={(e) => setListFilters({ ...listFilters, view: e.target.value })}
                            >
                                <option value="">ทุกทิศ</option>
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
                                placeholder="ชื่อผู้เช่า หรือ เลขห้อง..."
                                value={listFilters.search}
                                onChange={(e) => setListFilters({ ...listFilters, search: e.target.value })}
                            />
                        </div>
                    </div>
                </div>

                {/* Main List */}
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
                                    className={`bg-white rounded-2xl p-5 flex flex-col lg:flex-row gap-5 shadow-sm hover:shadow-md border border-slate-100 transition-all duration-200 ${contract.status === 'cancelled' ? 'opacity-60 grayscale-[10%]' : ''}`}
                                >
                                    {/* Room Number Box */}
                                    <button
                                        type="button"
                                        onClick={() => currentRoomId && handleRoomClick(currentRoomId)}
                                        disabled={!currentRoomId}
                                        className={`w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 text-slate-800 flex items-center justify-center shrink-0 font-extrabold text-xl shadow-inner transition-all ${currentRoomId ? 'hover:bg-slate-100 hover:scale-105 cursor-pointer' : 'cursor-default'}`}
                                    >
                                        {currentRoomId ? getonlyRoomNumber(currentRoomId) : '-'}
                                    </button>

                                    {/* Middle Content Wrapper */}
                                    <div className="flex-1 min-w-0 flex flex-col md:flex-row gap-5 items-start md:items-center">
                                        {/* Tenant Info */}
                                        <div className="md:w-1/3 shrink-0">
                                            <h3 className="text-base font-bold text-slate-900 truncate" title={contract.tenant_name}>
                                                {contract.tenant_name}
                                            </h3>
                                            <div className="text-xs font-semibold text-slate-500 mt-1 flex items-center gap-1.5">
                                                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                <span>{contract.contract_start_date ? formatDateTH(contract.contract_start_date) : '-'}</span>
                                                <span className="text-slate-300">•</span>
                                                <span>{contract.contract_end_date ? formatDateTH(contract.contract_end_date) : '-'}</span>
                                            </div>
                                            <div className="mt-2.5 flex items-center flex-wrap gap-2">
                                                {getStatusBadge(displayStatus)}
                                                {getIntentionBadge(contract.id)}
                                            </div>
                                        </div>

                                        {/* Room Assignments Grid */}
                                        <div className="md:w-2/3 min-w-0 flex flex-col gap-3">
                                            {/* Action Alerts */}
                                            {(needsTempRoom || missingMainRoom) && (
                                                <div className="flex flex-wrap gap-2">
                                                    {needsTempRoom && (
                                                        <span className="bg-red-50 text-red-600 border border-red-100 text-xs px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 animate-pulse">
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                                            ต้องระบุห้องชั่วคราว
                                                        </span>
                                                    )}
                                                    {missingMainRoom && (
                                                        <span className="bg-amber-50 text-amber-700 border border-amber-100 text-xs px-2.5 py-1 rounded-lg font-bold flex items-center gap-1">
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                                            ยังไม่ระบุห้องหลัก
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            <div className="flex flex-row flex-nowrap gap-3 text-sm overflow-x-auto pb-1 min-w-0 scrollbar-hide">
                                                {contract.temp_room_id && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRoomClick(contract.temp_room_id)}
                                                        className="shrink-0 w-[160px] rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 flex flex-col justify-between text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-all"
                                                    >
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-0.5 flex items-center gap-1">
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                ห้องชั่วคราว
                                                            </div>
                                                            <div className="font-extrabold text-slate-900 dark:text-slate-100">{getRoomNumber(contract.temp_room_id)}</div>
                                                        </div>
                                                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-2 truncate">
                                                            {formatDateTH(contract.temp_start_date) || '-'} - {formatDateTH(contract.temp_end_date) || '-'}
                                                        </div>
                                                    </button>
                                                )}

                                                {contract.main_room_id ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRoomClick(contract.main_room_id)}
                                                        className="shrink-0 w-[160px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/30 p-3 flex flex-col justify-between text-left hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-all"
                                                    >
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5 flex items-center gap-1">
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                                                                ห้องพักหลัก
                                                            </div>
                                                            <div className="font-extrabold text-slate-900 dark:text-slate-100 truncate">{getRoomNumber(contract.main_room_id)}</div>
                                                        </div>
                                                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-2 truncate">
                                                            {formatDateTH(contract.main_start_date) || '-'} - {formatDateTH(contract.main_end_date) || '-'}
                                                        </div>
                                                    </button>
                                                ) : (
                                                    <div className="shrink-0 w-[160px] rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/5 p-3 flex flex-col justify-between opacity-60">
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">ห้องพักหลัก</div>
                                                            <div className="font-bold text-slate-400 dark:text-slate-500 truncate">ยังไม่ระบุห้อง</div>
                                                        </div>
                                                        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 truncate">
                                                            {formatDateTH(contract.main_start_date) || '-'} - {formatDateTH(contract.main_end_date) || '-'}
                                                        </div>
                                                    </div>
                                                )}

                                                {contract.move_to_room_id && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRoomClick(contract.move_to_room_id)}
                                                        className="shrink-0 w-[160px] rounded-xl border border-sky-200 dark:border-sky-900/50 bg-sky-50/50 dark:bg-sky-950/20 p-3 flex flex-col justify-between text-left hover:bg-sky-100/50 dark:hover:bg-sky-900/30 transition-all"
                                                    >
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400 mb-0.5 flex items-center gap-1">
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                                                ย้ายห้องไปที่
                                                            </div>
                                                            <div className="font-extrabold text-slate-900 dark:text-slate-100">{getRoomNumber(contract.move_to_room_id)}</div>
                                                        </div>
                                                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-2 truncate">
                                                            {formatDateTH(contract.move_start_date) || '-'} - {formatDateTH(contract.move_end_date) || '-'}
                                                        </div>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    {isEditable && (
                                        <div className="flex flex-wrap items-center justify-end gap-2 lg:pl-5 lg:border-l border-slate-100 pt-4 lg:pt-0 mt-2 lg:mt-0 shrink-0">
                                            <button
                                                onClick={() => handleEditClick(contract)}
                                                className="h-[40px] w-[40px] rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                                                title="แก้ไขข้อมูล"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                            </button>

                                            {contract.status !== 'cancelled' && (
                                                <button
                                                    onClick={() => openCancelModal(contract)}
                                                    className="h-[40px] bg-red-50 hover:bg-red-500 text-red-600 hover:text-white border border-red-100 hover:border-red-500 px-4 rounded-xl text-sm font-bold transition-all flex items-center gap-1.5 shadow-sm shadow-red-500/5"
                                                    title="ยกเลิกสัญญา"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                                                    ยกเลิกสัญญา
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Empty State */}
                        {filteredContracts.length === 0 && (
                            <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 border-dashed flex flex-col items-center justify-center p-6">
                                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 mb-4 shadow-inner">
                                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                                </div>
                                <p className="font-bold text-lg text-slate-700">ไม่พบข้อมูลสัญญาเช่า</p>
                                <p className="text-sm text-slate-400 font-medium mt-1 max-w-sm">ไม่พบรายการที่ตรงกับเงื่อนไขการกรอง หรือยังไม่มีสัญญาระบบในขณะนี้</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ─── Create Booking Modal ─── */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity">
                    <div className="bg-white rounded-[2rem] w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal header */}
                        <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0 bg-slate-50/50 dark:bg-slate-900/60">
                            <div>
                                <h2 className="text-xl font-extrabold text-[#0A2647] tracking-tight">สร้างการจองใหม่</h2>
                                <p className="text-sm text-slate-500 font-medium mt-0.5">ระบุรายละเอียดสัญญา ข้อมูลผู้เข้าพัก และจัดสรรสถานะห้องพัก</p>
                            </div>
                            <button
                                onClick={() => {
                                    setIsCreateModalOpen(false);
                                    setIsShortTermContract(false);
                                }}
                                className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200/80 w-9 h-9 rounded-full flex items-center justify-center transition-colors shadow-inner"
                            >
                                <svg className="w-4 h-4 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        {/* Modal body */}
                        <div className="p-8 overflow-y-auto flex-1">
                            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                                <form id="create-contract-form" onSubmit={handleCreateContract} className="space-y-6">
                                    {/* Section 1 */}
                                    <div>
                                        <p className="text-xs font-bold text-[#4F81FF] uppercase tracking-wider mb-4 flex items-center gap-2">
                                            <span className="w-5 h-5 rounded-md bg-blue-50 flex items-center justify-center text-[10px] border border-blue-200">1</span>
                                            ข้อมูลผู้เช่า & ระยะเวลาสัญญา
                                        </p>
                                        <div className="mb-4">
                                            <label className={labelCls}>ชื่อผู้เช่า</label>
                                            <input
                                                type="text"
                                                className={inputCls}
                                                placeholder="กรอกชื่อ-นามสกุลผู้เช่า..."
                                                value={createForm.tenant_name}
                                                onChange={(e) => setCreateForm({ ...createForm, tenant_name: e.target.value })}
                                                required
                                            />
                                            {createForm.tenant_name && (() => {
                                                const pref = waitlists.find(w => w.name === createForm.tenant_name);
                                                return pref ? (
                                                    <p className="mt-2 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 inline-flex items-center gap-1.5">
                                                        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                        ความต้องการ: <span className="text-slate-800 font-bold">{pref.room_type} | ครัว{pref.kitchen_type} | วิว{pref.view_preference}</span>
                                                    </p>
                                                ) : null;
                                            })()}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelCls}>วันเริ่มต้นสัญญา <span className="text-red-500">*</span></label>
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
                                            <div className="md:col-span-2">
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
                                                    <div className="mt-3 flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsShortTermContract(prev => !prev)}
                                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${isShortTermContract ? 'bg-[#4F81FF] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                                                        >
                                                            สัญญาระยะสั้น
                                                        </button>
                                                        <p className="text-xs text-slate-500 font-medium">
                                                            {isShortTermContract ? 'เปิดสิทธิ์แก้ไขวันสิ้นสุดสัญญาอิสระแล้ว' : 'เปิดปุ่มนี้เพื่อปลดล็อกวันสิ้นสุดสัญญา'}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-4">
                                            <label className={labelCls}>ราคาเช่าต่อเดือน (บาท)</label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                className={inputCls}
                                                value={createForm.monthly_rent ? Number(createForm.monthly_rent).toLocaleString("en-US") : ""}
                                                onChange={(e) => {
                                                    const value = e.target.value.replace(/,/g, "").replace(/\D/g, "");
                                                    setCreateForm({ ...createForm, monthly_rent: value ? Number(value) : 0 });
                                                }}
                                                placeholder="เช่น 17,000"
                                                required
                                            />
                                        </div>
                                    </div>

                                    {/* Section 2: Temp Room */}
                                    <div className="pt-4 border-t border-slate-100">
                                        <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            <span className="w-5 h-5 rounded-md bg-amber-50 flex items-center justify-center text-[10px] border border-amber-200">2</span>
                                            ห้องพักชั่วคราว (Optional)
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
                                                className="w-full flex items-center justify-center gap-2 py-4 bg-amber-50/40 dark:bg-amber-900/25 border-2 border-dashed border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-2xl text-sm font-bold hover:bg-amber-50 dark:hover:bg-amber-900/40 hover:border-amber-300 dark:hover:border-amber-700 transition-all shadow-sm"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                                                ระบุห้องพักชั่วคราว (กรณีเข้าอยู่ก่อนห้องหลักพร้อมใช้งาน)
                                            </button>
                                        ) : (
                                            <div className="bg-amber-50/40 border border-amber-200/70 rounded-2xl p-5 relative">
                                                <div className="absolute top-4 right-4 flex gap-2">
                                                    {createForm.temp_room_id && (
                                                        <button
                                                            type="button"
                                                            onClick={moveCreateTempToMain}
                                                            className="text-xs px-2.5 py-1.5 bg-white text-emerald-700 border border-emerald-200 rounded-xl font-bold hover:bg-emerald-50 shadow-sm"
                                                        >
                                                            ตั้งเป็นห้องหลัก
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setCreateForm({ ...createForm, has_temp_room: false, temp_room_id: '', temp_start_date: '', temp_end_date: '' })}
                                                        className="text-xs px-2.5 py-1.5 bg-white text-red-500 border border-red-200 rounded-xl font-bold hover:bg-red-50 shadow-sm"
                                                    >
                                                        ยกเลิก
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                                                    <div>
                                                        <label className={labelCls}>เริ่มเข้าพักห้องชั่วคราว</label>
                                                        <input
                                                            type="date"
                                                            className="w-full bg-white border border-amber-200 rounded-xl p-3.5 text-sm font-medium outline-none focus:ring-2 focus:ring-amber-400/20"
                                                            value={createForm.temp_start_date}
                                                            onChange={(e) => setCreateForm({ ...createForm, temp_start_date: e.target.value })}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>ย้ายออกไปห้องหลัก</label>
                                                        <input
                                                            type="date"
                                                            className="w-full bg-white border border-amber-200 rounded-xl p-3.5 text-sm font-medium outline-none focus:ring-2 focus:ring-amber-400/20"
                                                            value={createForm.temp_end_date}
                                                            onChange={handleCreateTempEndDateChange}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-4 mt-5 pt-4 border-t border-amber-200/40">
                                                    <label className="block text-xs font-bold text-amber-800 uppercase tracking-wider">เลือกห้องพักชั่วคราวที่ว่าง</label>
                                                    {renderCreateTempRoomSelector()}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </form>

                                {/* Right Pane: Main Room Picker Display */}
                                <div className="space-y-5 bg-slate-50 border border-slate-200 rounded-[2rem] p-6 flex flex-col justify-between overflow-hidden">
                                    <div>
                                        <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200">
                                            <div>
                                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">เลือกห้องพักหลัก (Main Room)</p>
                                                <p className="text-xs text-slate-500 font-medium">ห้องที่ผูกกับสัญญาหลักตามระยะเวลาจริง</p>
                                            </div>
                                            {!isRenewalMode && createForm.main_room_id && (
                                                <button
                                                    type="button"
                                                    onClick={moveCreateMainToTemp}
                                                    className="text-xs px-2.5 py-1.5 bg-white text-amber-700 border border-amber-200 rounded-xl font-bold hover:bg-amber-50 shadow-sm"
                                                >
                                                    เปลี่ยนเป็นห้องชั่วคราว
                                                </button>
                                            )}
                                        </div>

                                        <div className="mt-4">
                                            {isRenewalMode ? (
                                                <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
                                                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">ห้องเดิมที่ใช้ต่อสัญญา</p>
                                                    {renewalRoom ? (
                                                        <>
                                                            <p className="mt-2 text-2xl font-extrabold text-blue-900">ห้อง {renewalRoom.room_number}</p>
                                                            <p className="text-xs text-blue-600 font-semibold mt-1">
                                                                {[renewalRoom.room_type, renewalRoom.view_direction ? `วิว${renewalRoom.view_direction}` : null, renewalRoom.kitchen_type ? `ครัว${renewalRoom.kitchen_type}` : null].filter(Boolean).join(' · ')}
                                                            </p>
                                                        </>
                                                    ) : (
                                                        <p className="mt-2 text-sm text-slate-500">ไม่พบข้อมูลห้องเดิม</p>
                                                    )}
                                                </div>
                                            ) : createForm.contract_start_date && createForm.contract_end_date ? (
                                                (() => {
                                                    const start = createForm.main_start_date || createForm.contract_start_date;
                                                    const end = createForm.main_end_date || createForm.contract_end_date;
                                                    const customerPref = waitlists.find(w => w.name === createForm.tenant_name) || {};
                                                    const availableRooms = rooms.filter(r => isRoomAvailable(contracts, intentions, r.id, start, end) && applyRoomFilters(r));
                                                    const isMatch = (prefVal: any, roomVal: any) => (!prefVal || prefVal === 'ไม่ระบุ' || prefVal === '-') ? true : prefVal === roomVal;
                                                    const perfectMatchRooms = availableRooms.filter(r => isMatch(customerPref.room_type, r.room_type) && isMatch(customerPref.kitchen_type, r.kitchen_type) && isMatch(customerPref.view_preference, r.view_direction));
                                                    const otherRooms = availableRooms.filter(r => !perfectMatchRooms.includes(r));

                                                    if (availableRooms.length === 0) {
                                                        return (
                                                            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-4 text-xs text-red-600 font-bold">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                ไม่มีห้องว่างในระบบในช่วงเวลาที่เลือก
                                                            </div>
                                                        );
                                                    }

                                                    const RoomCard = ({ room, isMatchRoom }: { room: any; isMatchRoom: boolean }) => {
                                                        const isSelected = createForm.main_room_id === room.id;
                                                        const fw = getRoomFreeWindow(contracts, room.id, start, end);
                                                        return (
                                                            <button
                                                                type="button"
                                                                onClick={() => setCreateForm({ ...createForm, main_room_id: createForm.main_room_id === room.id ? '' : room.id })}
                                                                className={`relative text-left rounded-xl p-3 border text-xs font-medium transition-all ${isSelected ? 'border-[#4F81FF] bg-blue-50 ring-2 ring-[#4F81FF]/20 dark:border-[#4F81FF]/20 dark:bg-[#4F81FF]/10 dark:shadow-none dark:ring-[#4F81FF]/10' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                                            >
                                                                <p className="font-bold text-sm text-slate-900">ห้อง {room.room_number}</p>
                                                                <p className="text-slate-500 font-semibold mt-1 truncate">{room.room_type || '-'}</p>
                                                                {isMatchRoom && <span className="absolute top-2 right-2 text-amber-500 text-[10px]">★</span>}
                                                            </button>
                                                        );
                                                    };

                                                    return (
                                                        <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
                                                            {perfectMatchRooms.length > 0 && (
                                                                <div>
                                                                    <p className="text-[11px] font-bold text-amber-700 mb-1.5 flex items-center gap-1">⭐ ตรงสเปกแนะนำ</p>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        {perfectMatchRooms.map(r => <RoomCard key={r.id} room={r} isMatchRoom={true} />)}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {otherRooms.length > 0 && (
                                                                <div>
                                                                    <p className="text-[11px] font-bold text-slate-400 mb-1.5 uppercase tracking-wide">ห้องว่างทั่วไป</p>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        {otherRooms.map(r => <RoomCard key={r.id} room={r} isMatchRoom={false} />)}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()
                                            ) : (
                                                <div className="text-center py-8 text-slate-400 font-medium text-xs bg-white border border-slate-200 rounded-xl border-dashed">
                                                    กรุณาระบุวันเริ่มสัญญาเพื่อระบบจะคำนวณห้องว่าง
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Footers inside right pane */}
                                    {createForm.main_room_id && (() => {
                                        const r = rooms.find(room => room.id === createForm.main_room_id);
                                        return r ? (
                                            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2">
                                                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                                <p className="text-xs font-bold text-emerald-800">จัดสรรเสร็จสิ้น: ห้องหลัก {r.room_number}</p>
                                            </div>
                                        ) : null;
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* Modal footer */}
                        <div className="px-8 py-5 border-t border-slate-100 dark:border-slate-800 flex gap-4 shrink-0 bg-slate-50 dark:bg-slate-900/60">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCreateModalOpen(false);
                                    setIsShortTermContract(false);
                                }}
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all"
                            >
                                ย้อนกลับ
                            </button>
                            <button
                                type="submit"
                                form="create-contract-form"
                                className="flex-1 px-6 py-3.5 text-sm font-bold text-white bg-[#4F81FF] rounded-2xl hover:bg-[#3D6CE5] shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-1.5"
                            >
                                <svg className="w-4 h-4 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                บันทึกการสร้างจอง
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Cancel Contract Modal ─── */}
            {isCancelModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl flex flex-col border border-slate-100">
                        <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/60">
                            <div>
                                <h2 className="text-lg font-extrabold text-[#0A2647]">ยืนยันยกเลิกสัญญา</h2>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">ระบุวันที่ผู้เช่าย้ายออกจริงออกจากห้องพัก</p>
                            </div>
                            <button onClick={() => setIsCancelModalOpen(false)} className="text-slate-400 hover:text-slate-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>
                        <div className="p-8 space-y-4">
                            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                                <p className="text-xs font-bold text-red-800">คุณกำลังยกเลิกสัญญาของ:</p>
                                <p className="text-sm font-extrabold text-slate-900 mt-0.5">{cancelTenantName}</p>
                            </div>
                            <div>
                                <label className={labelCls}>วันที่ย้ายออกจริง</label>
                                <input
                                    type="date"
                                    className={inputCls}
                                    value={cancelEndDate}
                                    onChange={(e) => setCancelEndDate(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="px-8 py-5 border-t border-slate-100 dark:border-slate-800 flex gap-3 bg-slate-50 dark:bg-slate-900/60">
                            <button
                                type="button"
                                onClick={() => setIsCancelModalOpen(false)}
                                className="flex-1 px-4 py-3 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                            >
                                ปิดหน้าต่าง
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelContract}
                                className="flex-1 px-4 py-3 text-xs font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 shadow-md shadow-red-600/10"
                            >
                                ยืนยันยกเลิกสัญญา
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Edit Modal ─── */}
            {isEditModalOpen && editForm && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] border border-slate-100">
                        <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/60">
                            <div>
                                <h2 className="text-lg font-extrabold text-[#0A2647]">แก้ไขสัญญาเช่าพัก</h2>
                                <p className="text-xs text-slate-500 font-semibold mt-0.5">ผู้เช่า: <span className="text-[#4F81FF]">{editForm.tenant_name}</span></p>
                            </div>
                            <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>

                        <form id="edit-contract-form" onSubmit={handleSaveEdit} className="p-8 space-y-6 overflow-y-auto flex-1">
                            <div>
                                <label className={labelCls}>วันเข้าพักก่อนเริ่มสัญญาจริง</label>
                                <input type="date" className={inputCls} value={editForm.actual_check_in_date || ''} onChange={(e) => setEditForm({ ...editForm, actual_check_in_date: e.target.value })} />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelCls}>วันเริ่มสัญญา (Read Only)</label>
                                    <input type="date" className={`${inputCls} bg-slate-100 cursor-not-allowed`} value={editForm.contract_start_date || ''} disabled />
                                </div>
                                <div>
                                    <label className={labelCls}>วันสิ้นสุดสัญญา (Read Only)</label>
                                    <input type="date" className={`${inputCls} bg-slate-100 cursor-not-allowed`} value={editForm.contract_end_date || ''} disabled />
                                </div>
                            </div>

                            {/* Temp Room section inside Edit */}
                            <div className="pt-4 border-t border-slate-100">
                                <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-3">การจัดสรรห้องพักชั่วคราว</p>
                                {!editForm.has_temp_room ? (
                                    <button
                                        type="button"
                                        onClick={() => setEditForm({ ...editForm, has_temp_room: true, temp_start_date: editForm.actual_check_in_date || '', temp_end_date: editForm.main_start_date || '' })}
                                        className="w-full py-3 bg-amber-50 text-amber-800 font-bold text-xs border border-dashed border-amber-300 rounded-xl hover:bg-amber-100/70"
                                    >
                                        + เพิ่มการใช้งานห้องชั่วคราว
                                    </button>
                                ) : (
                                    <div className="bg-amber-50/40 border border-amber-200 rounded-xl p-4 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <button type="button" onClick={() => setEditRoomPicker('temp')} className="px-3 py-1.5 bg-white border border-amber-300 text-xs font-bold rounded-xl text-slate-800">
                                                {editForm.temp_room_id ? `ห้องที่เลือก: ${getRoomNumber(editForm.temp_room_id)}` : 'คลิกเพื่อเลือกห้องชั่วคราว'}
                                            </button>
                                            <button type="button" onClick={() => setEditForm({ ...editForm, has_temp_room: false, temp_room_id: null, temp_start_date: null, temp_end_date: null })} className="text-xs font-bold text-red-500">ลบออก</button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <input type="date" className="p-2 text-xs bg-white border border-amber-200 rounded-lg" value={editForm.temp_start_date || ''} onChange={handleEditTempStartDateChange} />
                                            <input type="date" className="p-2 text-xs bg-white border border-amber-200 rounded-lg" value={editForm.temp_end_date || ''} onChange={handleTempEndDateChange} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Main Room selector inside Edit */}
                            <div className="pt-4 border-t border-slate-100">
                                <div className="flex justify-between items-center mb-2">
                                    <label className={labelCls}>ห้องพักหลัก (Main Room)</label>
                                    <button type="button" onClick={() => setEditRoomPicker('main')} className="px-3 py-1 bg-white border border-slate-200 text-xs font-bold rounded-lg hover:bg-slate-50">
                                        {editForm.main_room_id ? `ห้องหลัก: ${getRoomNumber(editForm.main_room_id)}` : 'จัดสรรห้องหลักใหม่'}
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <input type="date" className="p-2 text-xs bg-white border border-slate-200 rounded-lg" value={editForm.main_start_date || ''} onChange={(e) => setEditForm({ ...editForm, main_start_date: e.target.value })} />
                                    <input type="date" className="p-2 text-xs bg-white border border-slate-200 rounded-lg" value={editForm.main_end_date || ''} onChange={handleEditMainEndDateChange} />
                                </div>
                            </div>

                            {/* Move Room section inside Edit */}
                            <div className="pt-4 border-t border-slate-100">
                                <p className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-3">ย้ายห้อง (ถ้ามี)</p>
                                <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4">
                                        <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <label className={labelCls}>วันที่ย้ายเข้าห้องใหม่</label>
                                            <input type="date" className="p-2 text-xs bg-white border border-slate-200 rounded-lg w-full"
                                                value={editForm.move_start_date || ''}
                                                onChange={handleMoveStartDateChange} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>ถึงวันที่</label>
                                            <input type="date" className="p-2 text-xs bg-white border border-slate-200 rounded-lg w-full"
                                                value={editForm.move_end_date || ''}
                                                onChange={(e) => setEditForm({ ...editForm, move_end_date: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>เลือกห้องใหม่</label>
                                            {(!editForm.move_start_date || !editForm.move_end_date) ? (
                                                <p className="py-2 px-3 rounded-xl border border-slate-200 bg-white text-slate-500 text-xs">
                                                    ⚠️ ใส่วันที่ก่อน
                                                </p>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setEditRoomPicker('move')}
                                                    className="w-full inline-flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:border-purple-300 hover:bg-purple-50 transition-all"
                                                >
                                                    <span>{editForm.move_to_room_id ? `ห้อง ${getRoomNumber(editForm.move_to_room_id)}` : 'เลือกห้องใหม่'}</span>
                                                    <span className="text-purple-500">เลือก</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>

                        <div className="px-8 py-5 border-t border-slate-100 dark:border-slate-800 flex gap-3 bg-slate-50 dark:bg-slate-900/60">
                            <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50">ยกเลิก</button>
                            <button type="submit" form="edit-contract-form" className="flex-1 py-3 bg-[#4F81FF] text-white rounded-xl text-xs font-bold hover:bg-[#3D6CE5]">บันทึกการเปลี่ยนแปลง</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Edit Room Picker Inner Sub-Modal ─── */}
            {editRoomPicker && editForm && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col border border-slate-100">
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/60">
                            <p className="font-bold text-sm text-[#0A2647]">เลือกรายการห้องพักที่ว่างเข้าระบบ</p>
                            <button onClick={() => setEditRoomPicker(null)} className="text-slate-400 hover:text-slate-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1">
                            {editRoomPicker === 'temp' && renderRoomButtonGrid(
                                rooms.filter(r => r.id !== editForm.main_room_id && isRoomAvailable(contracts, intentions, r.id, editForm.temp_start_date, editForm.temp_end_date, editForm.id) && applyRoomFilters(r)),
                                editForm.temp_room_id,
                                (roomId) => { setEditForm({ ...editForm, temp_room_id: roomId }); setEditRoomPicker(null); },
                                { searchStart: editForm.temp_start_date, searchEnd: editForm.temp_end_date }
                            )}
                            {editRoomPicker === 'main' && renderRoomButtonGrid(
                                rooms.filter(r => isRoomAvailable(contracts, intentions, r.id, editForm.main_start_date, editForm.main_end_date, editForm.id) && applyRoomFilters(r)),
                                editForm.main_room_id,
                                (roomId) => { setEditForm({ ...editForm, main_room_id: roomId }); setEditRoomPicker(null); },
                                { searchStart: editForm.main_start_date, searchEnd: editForm.main_end_date }
                            )}
                            {editRoomPicker === 'move' && renderRoomButtonGrid(
                                rooms.filter(r => isRoomAvailable(contracts, intentions, r.id, editForm.move_start_date, editForm.move_end_date, editForm.id) && applyRoomFilters(r)),
                                editForm.move_to_room_id,
                                (roomId) => { setEditForm({ ...editForm, move_to_room_id: roomId }); setEditRoomPicker(null); },
                                { searchStart: editForm.move_start_date, searchEnd: editForm.move_end_date }
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}