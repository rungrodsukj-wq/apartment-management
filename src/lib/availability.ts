// Shared availability helpers
export const isOverlap = (start1: string, end1: string, start2: string, end2: string) => {
    if (!start1 || !end1 || !start2 || !end2) return false;
    // Treat date ranges as exclusive on transition boundaries (touching dates do not overlap).
    const s1 = new Date(start1).getTime();
    const e1 = new Date(end1).getTime();
    const s2 = new Date(start2).getTime();
    const e2 = new Date(end2).getTime();
    return s1 < e2 && s2 < e1;
};

export const getContractIntention = (intentions: any[], contractId?: string | null) => {
    if (!contractId) return null;
    const intention = intentions?.find((i: any) => i.contract_id === contractId);
    return intention?.intention ?? null;
};

export const isRoomAvailable = (
    contracts: any[],
    intentions: any[],
    roomId: string,
    checkStart: string,
    checkEnd: string,
    currentContractId?: string
) => {
    if (!checkStart || !checkEnd) return true;

    // ตัวแปรสำหรับเก็บ "วันที่หมดสัญญาล่าสุด" ที่เกิดก่อนวันเข้าพัก
    let latestEndStr: string | null = null;
    let latestPeriodType: string | null = null; // 'main' | 'temp' | 'move'

    for (const c of contracts) {
        if (currentContractId && c.id === currentContractId) continue;
        if (c.status === 'cancelled') continue;
        
        if (c.main_room_id !== roomId && c.temp_room_id !== roomId && c.move_to_room_id !== roomId) {
            continue;
        }

        const periods = [
            c.main_room_id === roomId && c.main_start_date && c.main_end_date ? { start: c.main_start_date, end: c.main_end_date, type: 'main' } : null,
            c.temp_room_id === roomId && c.temp_start_date && c.temp_end_date ? { start: c.temp_start_date, end: c.temp_end_date, type: 'temp' } : null,
            c.move_to_room_id === roomId && c.move_start_date && c.move_end_date ? { start: c.move_start_date, end: c.move_end_date, type: 'move' } : null,
        ].filter(Boolean) as { start: string; end: string; type: string }[];

            for (const period of periods) {
            // 1. ถ้ามีสัญญาช่วงเวลาทับซ้อน = ไม่ว่างแน่นอน
            if (isOverlap(checkStart, checkEnd, period.start, period.end)) return false;

            // 2. หาวันที่หมดสัญญาล่าสุด ที่เกิดก่อน checkStart
            if (new Date(period.end) < new Date(checkStart)) {
                if (!latestEndStr || new Date(period.end) > new Date(latestEndStr)) {
                    latestEndStr = period.end;
                    latestPeriodType = period.type;
                }
            }
        }

        // Determine the relevant end date for this room on this contract
        let roomRelevantEnd: string | null = null;
        if (c.main_room_id === roomId) {
            roomRelevantEnd = c.main_end_date || c.contract_end_date || null;
        } else if (c.temp_room_id === roomId) {
            roomRelevantEnd = c.temp_end_date || null;
        } else if (c.move_to_room_id === roomId) {
            roomRelevantEnd = c.move_end_date || c.contract_end_date || null;
        }

        if (roomRelevantEnd) {
            try {
                if (new Date(roomRelevantEnd) >= new Date(checkStart)) {
                    const intention = getContractIntention(intentions, c.id);
                    const nonLockIntents = ['not_renew', 'renew_no_room', 'renew'];
                    if (!nonLockIntents.includes(intention)) return false;
                }
            } catch (e) {
                const intention = getContractIntention(intentions, c.id);
                const nonLockIntents = ['not_renew', 'renew_no_room', 'renew'];
                if (!nonLockIntents.includes(intention)) return false;
            }
        }
    }

    // ถ้าช่วงล่าสุดก่อน checkStart เป็น `temp` ให้ถือว่าห้องว่างได้ทันที (ไม่ต้องเช็ค renewal_intentions)
    if (latestEndStr && latestPeriodType === 'temp') {
        return true;
    }

    // 🎯 LOGIC ใหม่: ทบยอดห้องว่างสะสม (Rollover) ป้องกันปัญหา Timezone บั๊ก
    // ปรับเป็นการเทียบระดับวัน/เดือน — หากวันหมดสัญญาล่าสุดเกิดก่อนวันที่ตรวจสอบ ให้ถือว่า "อาจว่าง"
    // ยกเว้นกรณีเป็น "leftover" (หมดสัญญาลงมาก่อน target เดือนเกิน 1 เดือน) และ target เดือนยังไม่เริ่มในโลกจริง
    if (latestEndStr) {
        const targetDate = new Date(checkStart);
        const latestEndDate = new Date(latestEndStr);
        const today = new Date();

        if (latestEndDate < targetDate) {
            const monthsDiff = (targetDate.getFullYear() - latestEndDate.getFullYear()) * 12 +
                               (targetDate.getMonth() - latestEndDate.getMonth());

            // ถ้าหมดสัญญาก่อน target เดือนเกิน 1 เดือน -> ถือเป็นค้างสต๊อก
            if (monthsDiff > 1) {
                const targetValue = targetDate.getFullYear() * 12 + targetDate.getMonth();
                const currentValue = today.getFullYear() * 12 + today.getMonth();
                // แสดงค้างสต๊อกได้ก็ต่อเมื่อ target เดือนได้เริ่มแล้วในโลกจริง (ไม่ใช่เดือนในอนาคต)
                if (targetValue > currentValue) {
                    if (currentContractId) return true; // อนุญาตถ้าเป็นการแก้ไขสัญญา
                    return false;
                }
            }
            // otherwise: same month (earlier day) หรือ เดือนก่อนหน้า -> อนุญาตให้ว่างได้
        } else {
            // สำรอง: หาก latestEndDate ไม่ได้ < targetDate (ไม่ควรเกิดจากการตั้งค่า latestEndStr)
            if (currentContractId) return true;
            return false;
        }
    } else {
        // กรณีไม่มีสัญญาใดๆ เลยในห้องนี้ (ว่างตลอดกาล)
        // ต้องการให้ว่างแค่ใน "เดือนถัดไป" เดือนเดียว (อิงตามเวลาโลกจริง)
        let hasAnyContract = false;
        for (const c of contracts) {
            if (currentContractId && c.id === currentContractId) continue;
            if (c.status === 'cancelled') continue;
            if (c.main_room_id === roomId || c.temp_room_id === roomId || c.move_to_room_id === roomId) {
                hasAnyContract = true;
                break;
            }
        }

        if (!hasAnyContract) {
            if (currentContractId) return true; // อนุญาตถ้าเป็นการแก้ไขสัญญา

            const today = new Date();
            const targetDate = new Date(checkStart);
            const targetValue = targetDate.getFullYear() * 12 + targetDate.getMonth();
            const nextMonthValue = today.getFullYear() * 12 + (today.getMonth() + 1);

            if (targetValue !== nextMonthValue) {
                return false;
            }
        }
    }

    return true;
};

export const getRoomFreeWindow = (contracts: any[], roomId: string, searchStart: string, searchEnd: string) => {
    const occupied = contracts
        .filter((c: any) => c.status !== 'cancelled')
        .flatMap((c: any) => {
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

export const getRoomOccupancyIntervals = (contracts: any[], roomId: string) => {
    const intervals: { start: Date; end: Date }[] = [];

    contracts.forEach((c: any) => {
        if (c.main_room_id === roomId) {
            const s = c.main_start_date || c.actual_check_in_date || c.contract_start_date;
            // Prefer the explicit main_end_date for when tenant moved rooms mid-contract.
            const e = c.main_end_date || c.contract_end_date;
            if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
        }
        if (c.temp_room_id === roomId) {
            const s = c.temp_start_date;
            const e = c.temp_end_date;
            if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
        }
        if (c.move_to_room_id === roomId) {
            const s = c.move_start_date;
            // Prefer the explicit move_end_date if present (more precise than contract_end_date)
            const e = c.move_end_date || c.contract_end_date;
            if (s && e) intervals.push({ start: new Date(s), end: new Date(e) });
        }
    });

    return intervals;
};

export const getEarliestVacancyBefore = (contracts: any[], roomId: string, beforeDateStr: string) => {
    const intervals = getRoomOccupancyIntervals(contracts, roomId);
    if (!intervals || intervals.length === 0) return null;

    // merge intervals
    const merged: { start: Date; end: Date }[] = [];
    intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
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

    const before = new Date(beforeDateStr);
    const addDays = (d: Date, days: number) => { const t = new Date(d); t.setDate(t.getDate() + days); return t; };

    for (let i = 0; i < merged.length; i++) {
        const candidate = addDays(merged[i].end, 1);
        if (candidate <= before) return candidate;
    }

    return null;
};

export const getRoomAvailability = (contracts: any[], roomId: string, targetDateStr: string) => {
    const intervals = getRoomOccupancyIntervals(contracts, roomId);

    intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
    const merged: { start: Date; end: Date }[] = [];
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

    const addDays = (d: Date, days: number) => {
        const t = new Date(d);
        t.setDate(t.getDate() + days);
        return t;
    };

    if (overlapping) {
        // available is the day after the current occupying interval ends
        availableFrom = addDays(new Date(overlapping.end), 1);
        const next = merged.find(i => i.start > addDays(new Date(overlapping.end), 1));
        availableUntil = next ? new Date(next.start) : null;
    } else {
        const prev = [...merged].reverse().find(i => i.end <= target);
        availableFrom = prev ? addDays(new Date(prev.end), 1) : new Date(0);
        const next = merged.find(i => i.start > target);
        availableUntil = next ? new Date(next.start) : null;
    }

    return { availableFrom, availableUntil };
};

export const getNextAvailableDate = (contracts: any[], roomId: string, requestedStart: string) => {
    const intervals = getRoomOccupancyIntervals(contracts, roomId);
    let currentStart = new Date(requestedStart);

    intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

    for (const interval of intervals) {
        if (currentStart >= interval.start && currentStart < interval.end) {
            // move to the day after the interval end
            currentStart = new Date(interval.end);
            currentStart.setDate(currentStart.getDate() + 1);
        }
    }

    const yyyy = currentStart.getFullYear();
    const mm = String(currentStart.getMonth() + 1).padStart(2, '0');
    const dd = String(currentStart.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

export const getRoomAvailabilityText = (contracts: any[], roomId: string, targetDateStr: string) => {
    const { availableFrom, availableUntil } = getRoomAvailability(contracts, roomId, targetDateStr);

    const formatD = (d: Date) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    const fromStr = availableFrom.getTime() === 0 || availableFrom <= new Date() ? 'ปัจจุบัน' : formatD(availableFrom);
    const untilStr = availableUntil ? formatD(availableUntil) : 'ไม่มีกำหนด';

    return `ว่าง : ${fromStr} - ${untilStr}`;
};

export const computeLockedRooms = (
    contracts: any[],
    intentions: any[],
    checkStart?: string,
    checkEnd?: string,
    currentContractId?: string | null
) => {
    const locked = new Set<string>();

    const startRef = checkStart && checkStart !== '' ? checkStart : (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();

    // Normalize check range strings for overlap checks
    const checkStartStr = checkStart && checkStart !== '' ? checkStart : null;
    const checkEndStr = checkEnd && checkEnd !== '' ? checkEnd : null;

    // Map intentions by contract
    const byContract: Record<string, any> = {};
    intentions.forEach(i => { if (i.contract_id) byContract[i.contract_id] = i; });

    // 1) Find latest contract per room (by start date)
    const latestContractByRoom: Record<string, { contract: any; startDate: number; role: string; endDateStr: string | null }> = {};

    const updateLatest = (roomId: string | null | undefined, role: string, specificStartDate: string | null, specificEndDate: string | null, c: any) => {
        if (!roomId) return;
        const startDateStr = specificStartDate || '';
        const startDate = startDateStr ? new Date(startDateStr).getTime() : 0;
        if (!latestContractByRoom[roomId] || latestContractByRoom[roomId].startDate < startDate) {
            latestContractByRoom[roomId] = { contract: c, startDate, role, endDateStr: specificEndDate };
        }
    };

    for (const c of contracts) {
        if (currentContractId && c.id === currentContractId) continue;
        if (c.status === 'cancelled') continue;

        updateLatest(c.main_room_id, 'main', c.main_start_date, c.main_end_date, c);
        updateLatest(c.temp_room_id, 'temp', c.temp_start_date, c.temp_end_date, c);
        updateLatest(c.move_to_room_id, 'move_to', c.move_start_date, c.move_end_date, c);
    }

    const lockedIntents = ['not_asked', 'pending'];

    // 2) Special rules for temp + intentions
    for (const roomId in latestContractByRoom) {
        const { contract: c, role, endDateStr } = latestContractByRoom[roomId];
        if (role === 'temp') {
            if (endDateStr) {
                // If a specific search range is provided, prefer precise overlap checks
                if (checkStartStr && checkEndStr) {
                    const tempStartStr = c.temp_start_date || '';
                    if (tempStartStr && isOverlap(checkStartStr, checkEndStr, tempStartStr, endDateStr)) {
                        locked.add(roomId);
                    }
                } else {
                    // Fallback to original month-based heuristic when no explicit end is provided
                    const endD = new Date(endDateStr);
                    let vacantY = endD.getFullYear();
                    let vacantM = endD.getMonth() + 1;
                    vacantM++;
                    if (vacantM > 12) { vacantM = 1; vacantY++; }
                    const vacantValue = vacantY * 12 + vacantM;

                    const viewDate = new Date(startRef);
                    const viewValue = viewDate.getFullYear() * 12 + (viewDate.getMonth() + 1);
                    const currD = new Date();
                    const currValue = currD.getFullYear() * 12 + (currD.getMonth() + 1);

                    if (viewValue > vacantValue && currValue < vacantValue) {
                        locked.add(roomId);
                    }
                }
            }
            continue;
        }

        // If this contract has a move_to room, and this room is NOT the move_to room,
        // it means the tenant is moving/has moved away from this room.
        // Therefore, the contract's renewal intention (which applies to their stay at the end of the contract)
        // should NOT lock this room.
        if (c.move_to_room_id && c.move_to_room_id !== roomId) {
            continue;
        }

        const intent = byContract[c.id];
        const intentStatus = intent?.intention || 'not_asked';
        if (lockedIntents.includes(intentStatus)) locked.add(roomId);
    }

    const nonLockIntents = ['not_renew', 'renew_no_room', 'renew'];

    // 3) Lock rooms for contracts that overlap the checkStart month
    for (const c of contracts) {
        if (currentContractId && c.id === currentContractId) continue;
        if (c.status === 'cancelled') continue;

        const checkOverlapAndLock = (roomId: string | null | undefined, periodStartStr: string | null | undefined, periodEndStr: string | null | undefined, role: string) => {
            if (!roomId) return;

            // Determine period start/end for this room role
            let periodStart = periodStartStr || null;
            let periodEnd = periodEndStr || null;
            if (!periodEnd && role !== 'temp') periodEnd = c.contract_end_date || null;

            // If caller provided an explicit search range, use precise overlap checks
            if (checkStartStr && checkEndStr && periodStart && periodEnd) {
                if (isOverlap(checkStartStr, checkEndStr, periodStart, periodEnd)) {
                    if (role === 'temp') {
                        locked.add(roomId);
                    } else {
                        const intent = byContract[c.id];
                        if (!intent || !nonLockIntents.includes(intent.intention)) locked.add(roomId);
                    }
                }
                return;
            }

            // Fallback: original month-based comparison (legacy behavior)
            if (periodEnd && new Date(periodEnd) >= new Date(startRef)) {
                if (role === 'temp') {
                    locked.add(roomId);
                } else {
                    const intent = byContract[c.id];
                    if (!intent || !nonLockIntents.includes(intent.intention)) locked.add(roomId);
                }
            }
        };

        checkOverlapAndLock(c.main_room_id, c.main_start_date || c.actual_check_in_date || c.contract_start_date, c.main_end_date, 'main');
        checkOverlapAndLock(c.temp_room_id, c.temp_start_date, c.temp_end_date, 'temp');
        checkOverlapAndLock(c.move_to_room_id, c.move_start_date, c.move_end_date || c.contract_end_date, 'move_to');
    }

    // 4) Intentions that refer directly to a room
    for (const intent of intentions) {
        if (!intent.room_id) continue;
        if (latestContractByRoom[intent.room_id]?.role === 'temp') continue;

        if (intent.intention === 'not_asked' || intent.intention === 'pending') {
            locked.add(intent.room_id);
        } else if (!intent.intention || !nonLockIntents.includes(intent.intention)) {
            locked.add(intent.room_id);
        }
    }

    return locked;
};

export const computeGapInfo = (from: Date | null, to: Date) => {
    if (!from) return null;
    if (from.getTime && from.getTime() === 0) return null;
    if (from >= to) return null;

    const msPerDay = 24 * 60 * 60 * 1000;
    const totalDays = Math.ceil((to.getTime() - from.getTime()) / msPerDay);
    const months = Math.floor(totalDays / 30);
    const days = totalDays % 30;
    const human = months > 0 ? `${months} เดือน${days ? ` ${days} วัน` : ''}` : `${totalDays} วัน`;
    const untilStr = to.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

    return { totalDays, months, days, human, untilStr };
};
