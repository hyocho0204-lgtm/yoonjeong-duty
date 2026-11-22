(function () {
  "use strict";

  const STORAGE_KEY = "ward-duty-system-v1";
  const SHIFTS = ["D", "E", "N", "OFF", "연차", "M"];
  const ROOMS = ["1호", "2호", "3호", "5호", "6호", "7호", "8호", "9호"];
  const SCHEDULE_PRIORITIES = [
    "필수 근무 제한 준수",
    "법적 근로시간 및 휴식시간 준수",
    "날짜별 필요 근무 인원 충족",
    "N 전담 간호사 조건 준수",
    "연속 근무 및 연속 야간 제한 준수",
    "오프 신청 최대 반영",
    "주말 및 공휴일 근무 균등 배분",
    "개인별 총 근무 횟수 균등 배분",
    "잔여 연차 소진",
    "백가은 D 근무 우선 배정"
  ];
  const ROOM_PRIORITIES = [
    "고정 호실 배정",
    "근무 형태별 앞/중/뒤 그룹 조건",
    "이전 담당 호실 유지",
    "저연차 → 고연차 인계 조건",
    "전체 호실 공백 방지",
    "담당 호실 수 균형 배분"
  ];

  function defaultState() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return {
      month,
      nurses: [
        { id: "n1", name: "손화정", enabled: true, leave: 0, senior: false, night: false, restriction: "D", weekdayD: false, dPriority: false, fixedRooms: ["1호", "2호"], specialFixedRooms: ["1호", "2호", "3호"] },
        { id: "n2", name: "박경진", enabled: true, leave: 0, senior: false, night: false, restriction: "D", weekdayD: false, dPriority: false, fixedRooms: ["8호", "9호"], specialFixedRooms: ["7B호", "8호", "9호"] },
        { id: "n3", name: "류남선", enabled: true, leave: 0, senior: false, night: false, restriction: "E,N", weekdayD: false, dPriority: false, fixedRooms: [] },
        { id: "n4", name: "강수지", enabled: true, leave: 0, senior: false, night: false, restriction: "D", weekdayD: true, dPriority: false, fixedRooms: [] },
        { id: "n5", name: "백가은", enabled: true, leave: 0, senior: false, night: false, restriction: "ALL", weekdayD: false, dPriority: true, fixedRooms: [] },
        { id: "n6", name: "김나현", enabled: true, leave: 0, senior: false, night: false, restriction: "ALL", weekdayD: false, dPriority: false, fixedRooms: ["6호", "7호"], specialFixedRooms: ["5호", "6호", "7A호"] },
        { id: "n7", name: "윤인경", enabled: true, leave: 0, senior: true, night: true, restriction: "N", weekdayD: false, dPriority: false, fixedRooms: [] },
        { id: "n8", name: "N전담2", enabled: true, leave: 0, senior: false, night: true, restriction: "N", weekdayD: false, dPriority: false, fixedRooms: [] }
      ],
      requirements: { weekdayD: 4, weekdayE: 4, weekdayN: 3, saturdayD: 3, saturdayE: 3, sundayD: 3, sundayE: 3, holidayD: 4, holidayE: 4, holidayN: 3 },
      legality: { beds: "", nurses: "", handover: "", weeklyHours: "", holidays: "" },
      holidays: [],
      offRequests: [],
      fixedCells: [],
      previous: [],
      schedule: {},
      rooms: {},
      confirmed: false,
      schedulePriority: [...SCHEDULE_PRIORITIES],
      roomPriority: [...ROOM_PRIORITIES],
      undos: [],
      dailyRequirements: {}
    };
  }

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaultState(), ...JSON.parse(raw) };
    } catch (_) {}
    return defaultState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function monthDays() {
    const [year, month] = state.month.split("-").map(Number);
    const count = new Date(year, month, 0).getDate();
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(year, month - 1, i + 1);
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return { iso, date, day: i + 1, weekday: date.getDay() };
    });
  }

  function nurseById(id) { return state.nurses.find(n => n.id === id); }
  function nurseByName(name) { return state.nurses.find(n => n.name === name); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  }
  function key(nurseId, iso) { return `${nurseId}|${iso}`; }
  function getSchedule(nurseId, iso) { return state.schedule[key(nurseId, iso)] || ""; }
  function setSchedule(nurseId, iso, value) { state.schedule[key(nurseId, iso)] = value; }

  function requirementsFor(day) {
    const override = state.dailyRequirements[day.iso];
    if (override) return override;
    if (state.holidays.includes(day.iso)) return { D: state.requirements.holidayD, E: state.requirements.holidayE, N: state.requirements.holidayN };
    if (day.weekday === 6) return { D: state.requirements.saturdayD, E: state.requirements.saturdayE, N: state.requirements.weekdayN };
    if (day.weekday === 0) return { D: state.requirements.sundayD, E: state.requirements.sundayE, N: state.requirements.weekdayN };
    return { D: state.requirements.weekdayD, E: state.requirements.weekdayE, N: state.requirements.weekdayN };
  }

  function previousCode(nurseId, iso) {
    const found = state.previous.find(p => p.nurseId === nurseId && p.iso === iso);
    return found ? found.code : "";
  }

  function getFixed(nurseId, iso) {
    return state.fixedCells.find(f => f.nurseId === nurseId && f.iso === iso);
  }

  function getOffRequest(nurseId, iso) {
    return state.offRequests.some(r => r.nurseId === nurseId && r.iso === iso);
  }

  function allowedShift(nurse, shift, day) {
    if (!nurse.enabled) return false;
    if (nurse.night) return shift === "N";
    if (nurse.restriction && nurse.restriction !== "ALL") {
      const allowed = nurse.restriction.split(",").map(s => s.trim()).filter(Boolean);
      if (!allowed.includes(shift)) return false;
    }
    if (nurse.weekdayD && shift === "D" && (day.weekday === 0 || day.weekday === 6) && !(state.requirements.saturdayD + state.requirements.sundayD > 0)) return false;
    return true;
  }

  function restViolations(nurseId, iso, proposed, days) {
    const errors = [];
    const index = days.findIndex(d => d.iso === iso);
    const codeAt = (offset) => {
      const targetIndex = index + offset;
      if (targetIndex >= 0 && targetIndex < days.length) {
        return getSchedule(nurseId, days[targetIndex].iso);
      }
      const [year, month, day] = iso.split("-").map(Number);
      const target = new Date(year, month - 1, day);
      target.setDate(target.getDate() + offset);
      const targetIso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
      return previousCode(nurseId, targetIso);
    };
    const prevCode = codeAt(-1);
    const prevPrevCode = codeAt(-2);

    if (prevCode === "E" && proposed === "D") errors.push("E 근무 다음 날 D 근무 금지");
    if (prevPrevCode === "N" && prevCode === "OFF" && proposed === "D") errors.push("N 근무 후 하루 쉬고 D 근무 금지");
    if (prevCode === "N" && prevPrevCode === "N" && proposed !== "OFF" && proposed !== "연차") errors.push("N 근무 2일 연속 후 48시간 휴식 미확보");
    if (proposed === "N") {
      const prevN = prevCode === "N";
      const prevPrevN = prevPrevCode === "N";
      if (prevN && prevPrevN) errors.push("연속 N 근무 3일 초과");
    }
    let streak = 1;
    for (let offset = -1; offset >= -62; offset--) {
      const code = codeAt(offset);
      if (code && code !== "OFF" && code !== "연차" && code !== "M") streak++;
      else break;
    }
    if (proposed !== "OFF" && proposed !== "연차" && proposed !== "M" && streak > 5) errors.push("연속 근무 5일 초초과");
    return errors;
  }

  function candidateScore(nurse, shift, day, index) {
    let score = 0;
    const count = shiftCount(nurse.id);
    score -= count[shift] || 0;
    if (nurse.dPriority && shift === "D") score += 8;
    if (nurse.night) score += shift === "N" ? 20 : -50;
    if (nurse.weekdayD && shift === "D" && day.weekday > 0 && day.weekday < 6) score += 5;
    if (nurse.weekdayD && shift === "D" && (day.weekday === 0 || day.weekday === 6)) score -= 20;
    if (getOffRequest(nurse.id, day.iso)) score += 20;
    if (getFixed(nurse.id, day.iso)) score += 20;
    if (state.previous.some(p => p.nurseId === nurse.id && p.iso === day.iso && p.code === shift)) score += 3;
    score += index % state.nurses.length === Number(nurse.id.replace(/\D/g, "")) ? 1 : 0;
    return score;
  }

  function shiftCount(nurseId) {
    const result = { D: 0, E: 0, N: 0, OFF: 0, 연차: 0, M: 0 };
    Object.keys(state.schedule).forEach(k => {
      if (k.startsWith(nurseId + "|")) result[state.schedule[k]] = (result[state.schedule[k]] || 0) + 1;
    });
    return result;
  }

  function generateSchedule() {
    state.undos.push(JSON.stringify(state.schedule));
    state.schedule = {};
    state.rooms = {};
    state.confirmed = false;
    const days = monthDays();
    const nurses = state.nurses.filter(n => n.enabled);

    for (const nurse of nurses) {
      let leaveLeft = Number(nurse.leave) || 0;
      for (const day of days) {
        if (getFixed(nurse.id, day.iso)) continue;
        if (nurse.night && !leaveLeft && countExistingOff(nurse.id) >= 15) continue;
        if (nurse.night) {
          if (countExistingOff(nurse.id) < 15 && shouldAssignNightOff(nurse.id, day, days)) setSchedule(nurse.id, day.iso, "OFF");
          continue;
        }
        if (getOffRequest(nurse.id, day.iso)) setSchedule(nurse.id, day.iso, "OFF");
        else if (leaveLeft > 0 && shouldAssignLeave(nurse, day, days)) {
          setSchedule(nurse.id, day.iso, "연차");
          leaveLeft--;
        }
      }
    }

    for (const nurse of nurses.filter(n => n.night)) {
      let offCount = countExistingOff(nurse.id);
      for (const day of [...days].sort((a, b) =>
        (b.weekday === 0 || b.weekday === 6 ? 1 : 0) - (a.weekday === 0 || a.weekday === 6 ? 1 : 0)
        || a.iso.localeCompare(b.iso))) {
        if (offCount >= 15) break;
        if (getFixed(nurse.id, day.iso) || getSchedule(nurse.id, day.iso)) continue;
        setSchedule(nurse.id, day.iso, "OFF");
        offCount++;
      }
    }

    for (const day of days) {
      for (const nurse of nurses) {
        const fixed = getFixed(nurse.id, day.iso);
        if (fixed) setSchedule(nurse.id, day.iso, fixed.code);
      }
      const req = requirementsFor(day);
      for (const shift of ["N", "D", "E"]) {
        const needed = req[shift];
        let assigned = nurses.filter(n => getSchedule(n.id, day.iso) === shift).length;
        const candidates = nurses
          .filter(n => !getSchedule(n.id, day.iso))
          .filter(n => allowedShift(n, shift, day))
          .filter(n => restViolations(n.id, day.iso, shift, days).length === 0)
          .sort((a, b) => candidateScore(b, shift, day, days.findIndex(d => d.iso === day.iso)) - candidateScore(a, shift, day, days.findIndex(d => d.iso === day.iso)) || a.name.localeCompare(b.name, "ko"));
        for (const nurse of candidates) {
          if (assigned >= needed) break;
          setSchedule(nurse.id, day.iso, shift);
          assigned++;
        }
      }
      for (const nurse of nurses) {
        if (!getSchedule(nurse.id, day.iso)) setSchedule(nurse.id, day.iso, "OFF");
      }
    }
    saveState();
    renderAll();
    toast("근무표 자동 배정을 완료했습니다.");
  }

  function countExistingOff(nurseId) {
    return Object.keys(state.schedule).filter(k => k.startsWith(nurseId + "|") && state.schedule[k] === "OFF").length;
  }

  function shouldAssignNightOff(nurseId, day, days) {
    const index = days.findIndex(d => d.iso === day.iso);
    return index % 2 === Number(nurseId.replace(/\D/g, "") || 0) % 2;
  }

  function shouldAssignLeave(nurse, day, days) {
    if (getOffRequest(nurse.id, day.iso)) return false;
    const index = days.findIndex(d => d.iso === day.iso);
    if (index % 4 !== 0) return false;
    return restViolations(nurse.id, day.iso, "연차", days).length === 0;
  }

  function validateSchedule() {
    const errors = [];
    const days = monthDays();
    const enabled = state.nurses.filter(n => n.enabled);
    const nightDedicated = state.nurses.filter(n => n.night && n.enabled);
    if (nightDedicated.length !== 2) errors.push({ level: "error", text: "N 전담 간호사는 정확히 2명이어야 합니다." });
    nightDedicated.forEach(nurse => {
      const offCount = monthDays().filter(d => getSchedule(nurse.id, d.iso) === "OFF").length;
      if (offCount !== 15) errors.push({ level: "warning", text: `${nurse.name}: N 전담 OFF는 15개여야 합니다. 현재 ${offCount}개` });
    });

    for (const day of days) {
      const req = requirementsFor(day);
      for (const shift of ["D", "E", "N"]) {
        const assigned = enabled.filter(n => getSchedule(n.id, day.iso) === shift);
        if (assigned.length < req[shift]) errors.push({ level: "error", text: `${day.iso} ${shift} 근무 인원 부족: 필요 ${req[shift]}명, 배정 ${assigned.length}명` });
        if (assigned.length > req[shift]) errors.push({ level: "error", text: `${day.iso} ${shift} 근무 인원 초과: 필요 ${req[shift]}명, 배정 ${assigned.length}명` });
      }
      for (const nurse of enabled) {
        const code = getSchedule(nurse.id, day.iso);
        if (!code) continue;
        if (!allowedShift(nurse, code, day) && code !== "OFF" && code !== "연차" && code !== "M") {
          errors.push({ level: "error", text: `${day.iso} ${nurse.name}: 근무 제한 위반 (${nurse.restriction})` });
        }
        const violations = restViolations(nurse.id, day.iso, code, days);
        violations.forEach(v => errors.push({ level: "error", text: `${day.iso} ${nurse.name}: ${v}` }));
      }
    }
    if (state.offRequests.length) {
      state.offRequests.forEach(r => {
        if (getSchedule(r.nurseId, r.iso) !== "OFF" && getSchedule(r.nurseId, r.iso) !== "연차") {
          errors.push({ level: "warning", text: `${r.iso} ${nurseById(r.nurseId)?.name || ""} 오프 신청 미반영` });
        }
      });
    }
    return errors;
  }

  function generateRooms() {
    state.rooms = {};
    const days = monthDays();
    for (const day of days) {
      ["D", "E", "N"].forEach(shift => {
        const assigned = state.nurses.filter(n => n.enabled && getSchedule(n.id, day.iso) === shift);
        const special = shift === "N" || (day.weekday === 6 && shift === "E") || (day.weekday === 0 && (shift === "D" || shift === "E"));
        let rooms = special ? ["1호", "2호", "3호", "5호", "6호", "7A호", "7B호", "8호", "9호"] : ROOMS;
        const fixedMap = {};
        assigned.forEach(nurse => {
          const candidates = special ? (nurse.specialFixedRooms || nurse.fixedRooms || []) : (nurse.fixedRooms || []);
          if (!candidates.length) return;
          for (const room of candidates) {
            if (fixedMap[room]) continue;
            if (rooms.includes(room) || (room === "7호" && rooms.includes("7A호"))) {
              fixedMap[room] = nurse.id;
              break;
            }
          }
        });
        const used = new Set(Object.keys(fixedMap));
        assigned.forEach(nurse => {
          if (Object.values(fixedMap).includes(nurse.id)) return;
          const previous = state.previous.filter(p => p.nurseId === nurse.id && p.room).sort((a, b) => b.iso.localeCompare(a.iso))[0];
          let choice = previous && rooms.includes(previous.room) && !used.has(previous.room) ? previous.room : null;
          if (!choice) choice = rooms.find(r => !used.has(r));
          if (choice) {
            fixedMap[choice] = nurse.id;
            used.add(choice);
          }
        });
        Object.entries(fixedMap).forEach(([room, nurseId]) => state.rooms[key(nurseId, day.iso + "|" + shift)] = room);
      });
    }
    saveState();
    renderAll();
    toast("호실 배정을 완료했습니다.");
  }

  function roomAssignments(day, shift) {
    return state.nurses
      .filter(n => n.enabled && getSchedule(n.id, day.iso) === shift)
      .map(n => ({ nurse: n, room: state.rooms[key(n.id, day.iso + "|" + shift)] || "" }));
  }

  function validateRooms() {
    const errors = [];
    const days = monthDays();
    for (const day of days) {
      for (const shift of ["D", "E", "N"]) {
        const assigned = state.nurses.filter(n => n.enabled && getSchedule(n.id, day.iso) === shift);
        const assignments = roomAssignments(day, shift);
        const rooms = assignments.map(a => a.room).filter(Boolean);
        if (assigned.length && rooms.length !== assigned.length) errors.push({ level: "error", text: `${day.iso} ${shift}: 호실 담당 누락` });
        if (new Set(rooms).size !== rooms.length) errors.push({ level: "error", text: `${day.iso} ${shift}: 호실 중복` });
        const special = shift === "N" || (day.weekday === 6 && shift === "E") || (day.weekday === 0 && (shift === "D" || shift === "E"));
        assignments.forEach(a => {
          if (!a.room) return;
          const fixedRooms = special ? (a.nurse.specialFixedRooms || []) : (a.nurse.fixedRooms || []);
          if (fixedRooms.length && !fixedRooms.includes(a.room) && !fixedRooms.some(room => room === "7호" && (a.room === "7A호" || a.room === "7B호"))) {
            errors.push({ level: "error", text: `${day.iso} ${shift} ${a.nurse.name}: 고정 호실 위반` });
          }
        });
      }
    }
    return errors;
  }

  function renderAll() {
    renderDashboard();
    renderSchedule();
    renderRooms();
    renderStats();
    renderSettings();
  }

  function renderDashboard() {
    const days = monthDays();
    const enabled = state.nurses.filter(n => n.enabled);
    const totals = { D: 0, E: 0, N: 0, OFF: 0, 연차: 0 };
    enabled.forEach(n => days.forEach(d => {
      const code = getSchedule(n.id, d.iso);
      if (totals[code] !== undefined) totals[code]++;
    }));
    const roomErrors = validateRooms();
    const scheduleErrors = validateSchedule();
    document.getElementById("currentMonthLabel").textContent = `${state.month.replace("-", "년 ")}월`;
    document.getElementById("dashboardCards").innerHTML = `
      <div class="card"><strong>${enabled.length}</strong><span>배정 대상 간호사</span></div>
      <div class="card"><strong>${totals.D + totals.E + totals.N}</strong><span>월간 근무 배정</span></div>
      <div class="card"><strong>${totals.OFF + totals.연차}</strong><span>OFF / 연차 배정</span></div>
      <div class="card"><strong>${scheduleErrors.filter(e => e.level === "error").length + roomErrors.length}</strong><span>확인 필요한 오류</span></div>`;

    document.getElementById("shiftChart").innerHTML = ["D", "E", "N", "OFF", "연차"].map(code => {
      const value = totals[code] || 0;
      const max = Math.max(1, ...Object.values(totals));
      return `<div class="bar-row"><strong>${code}</strong><div class="bar-track"><div class="bar-fill code-${code}" style="width:${Math.round(value / max * 100)}%"></div></div><span>${value}</span></div>`;
    }).join("");

    const combined = [...scheduleErrors, ...roomErrors].slice(0, 8);
    document.getElementById("dashboardErrors").innerHTML = combined.length
      ? combined.map(e => `<div class="message ${e.level === "error" ? "error" : ""}">${escapeHtml(e.text)}</div>`).join("")
      : '<div class="message ok">현재 배정에 감지된 필수 오류가 없습니다.</div>';
  }

  function renderSchedule() {
    const days = monthDays();
    const nurses = state.nurses.filter(n => n.enabled);
    const scheduleErrors = validateSchedule();
    const head = days.map(d => {
      const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.weekday];
      return `<th>${d.day}<br><small>${weekday}</small></th>`;
    }).join("");
    const body = nurses.map(nurse => {
      const cells = days.map(day => {
        const code = getSchedule(nurse.id, day.iso);
        const fixed = getFixed(nurse.id, day.iso);
        const violations = restViolations(nurse.id, day.iso, code, days);
        const restricted = code && !allowedShift(nurse, code, day) && !["OFF", "연차", "M"].includes(code);
        const isError = violations.length || restricted;
        return `<td class="${fixed ? "fixed " : ""}${isError ? "error " : ""}code-${code || "empty"}" title="${escapeHtml((violations.join(", ") + (restricted ? " 근무 제한 위반" : "")))}">
          <select class="schedule-cell" data-nurse="${nurse.id}" data-iso="${day.iso}" aria-label="${escapeHtml(nurse.name)} ${day.iso}">
            ${SHIFTS.map(v => `<option value="${v}" ${code === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </td>`;
      }).join("");
      return `<tr><td>${escapeHtml(nurse.name)}${nurse.night ? ' <small>(N전담)</small>' : ""}</td>${cells}</tr>`;
    }).join("");
    document.getElementById("scheduleTable").innerHTML = `<thead><tr><th>간호사</th>${head}</tr></thead><tbody>${body}</tbody>`;
    document.getElementById("scheduleMessages").innerHTML = scheduleErrors.length
      ? scheduleErrors.slice(0, 12).map(e => `<div class="message ${e.level === "error" ? "error" : ""}">${escapeHtml(e.text)}</div>`).join("")
      : '<div class="message ok">필수 근무 제한 및 인원 조건을 충족합니다.</div>';
  }

  function renderRooms() {
    const days = monthDays();
    const rows = [];
    for (const day of days) {
      for (const shift of ["D", "E", "N"]) {
        const special = shift === "N" || (day.weekday === 6 && shift === "E") || (day.weekday === 0 && (shift === "D" || shift === "E"));
        const assignments = roomAssignments(day, shift);
        if (!assignments.length) continue;
        const availableRooms = special
          ? ["1호", "2호", "3호", "5호", "6호", "7A호", "7B호", "8호", "9호"]
          : ROOMS;
        const text = assignments.map(a => {
          const room = a.room || "";
          const fixed = a.nurse.fixedRooms && a.nurse.fixedRooms.includes(room);
          const cls = room ? (fixed ? "room-fixed" : "") : "room-empty";
          const group = special ? (["1호", "2호", "3호"].includes(room) ? "room-group-front" : ["5호", "6호", "7A호", "7호"].includes(room) ? "room-group-middle" : "room-group-back") : "";
          const options = ["", ...availableRooms].map(value =>
            `<option value="${escapeHtml(value)}" ${room === value ? "selected" : ""}>${value || "미배정"}</option>`).join("");
          return `<span class="${cls} ${group}" title="${escapeHtml(a.nurse.name)}">${escapeHtml(a.nurse.name)}
            <select class="room-cell" data-nurse="${a.nurse.id}" data-iso="${day.iso}" data-shift="${shift}" aria-label="${escapeHtml(a.nurse.name)} 호실">${options}</select></span>`;
        }).join(" ");
        rows.push(`<tr><td>${day.iso}</td><td><strong>${shift}</strong></td><td>${special ? '<span class="stat-positive">앞/중/뒤 적용</span>' : "일반 호실"}</td><td>${text}</td></tr>`);
      }
    }
    document.getElementById("roomTable").innerHTML = `<thead><tr><th>날짜</th><th>근무</th><th>배정 구분</th><th>담당자 · 호실</th></tr></thead><tbody>${rows.join("")}</tbody>`;
    const errors = validateRooms();
    document.getElementById("roomMessages").innerHTML = errors.length
      ? errors.map(e => `<div class="message ${e.level === "error" ? "error" : ""}">${escapeHtml(e.text)}</div>`).join("")
      : '<div class="message ok">호실 공백 및 중복이 없습니다.</div>';
  }

  function renderStats() {
    const days = monthDays();
    const statsRows = state.nurses.filter(n => n.enabled).map(n => {
      const values = { D: 0, E: 0, N: 0, OFF: 0, 연차: 0 };
      days.forEach(d => {
        const code = getSchedule(n.id, d.iso);
        if (values[code] !== undefined) values[code]++;
      });
      const weekend = days.filter(d => d.weekday === 6 || d.weekday === 0).filter(d => getSchedule(n.id, d.iso) === "D" || getSchedule(n.id, d.iso) === "E" || getSchedule(n.id, d.iso) === "N").length;
      return `<tr><td>${escapeHtml(n.name)}</td><td>${values.D}</td><td>${values.E}</td><td>${values.N}</td><td>${values.OFF}</td><td>${values.연차}</td><td>${n.leave || 0}</td><td>${weekend}</td></tr>`;
    }).join("");
    document.getElementById("nurseStatsTable").innerHTML = `<thead><tr><th>간호사</th><th>D</th><th>E</th><th>N</th><th>OFF</th><th>연차</th><th>잔여 연차</th><th>주말 근무</th></tr></thead><tbody>${statsRows}</tbody>`;

    const checks = [
      ["주 52시간", state.legality.weeklyHours ? "충족" : "확인 필요", state.legality.weeklyHours ? "실제 주간 근로시간 설정값 기준 검토" : "실제 근로시간 입력값이 필요합니다."],
      ["주휴일", state.legality.holidays ? "충족" : "확인 필요", state.legality.holidays ? "휴일 부여 현황 설정값 기준 검토" : "휴일 부여 현황 입력값이 필요합니다."],
      ["야간근로", "확인 필요", "야간근로 시간 및 야간근로 대상 여부를 설정에서 확인해야 합니다."],
      ["연속 근무", validateSchedule().some(e => e.text && e.text.includes("연속 근무")) ? "위반" : "충족", "최대 연속 근무일은 개인별 검증 결과를 따릅니다."],
      ["연속 야간", validateSchedule().some(e => e.text && e.text.includes("연속 N")) ? "위반" : "충족", "연속 N 근무 3일 초과 여부를 검증합니다."],
      ["야간 후 휴식", validateSchedule().some(e => e.text && e.text.includes("휴식")) ? "위반" : "충족", "야간근무 후 휴식 패턴을 검증합니다."],
      ["간호사 배치 기준", state.legality.beds && state.legality.nurses ? "확인 필요" : "확인 필요", "병상 수와 간호사 수 입력이 필요합니다."],
      ["특수건강진단", "미확인", "야간작업 대상자와 검사 실시 여부 확인이 필요합니다."]
    ];
    document.getElementById("validationTable").innerHTML = `<thead><tr><th>검증 항목</th><th>결과</th><th>상세 내용</th></tr></thead><tbody>${checks.map(row => `<tr><td>${escapeHtml(row[0])}</td><td class="${row[1] === "충족" ? "stat-positive" : row[1] === "위반" ? "stat-error" : "stat-warning"}">${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td></tr>`).join("")}</tbody>`;
  }

  function renderSettings() {
    document.getElementById("monthInput").value = state.month;
    document.getElementById("staffRequirementEditor").innerHTML = `
      ${requirementInput("weekdayD", "평일 D")} ${requirementInput("weekdayE", "평일 E")} ${requirementInput("weekdayN", "평일 N")}
      ${requirementInput("saturdayD", "토요일 D")} ${requirementInput("saturdayE", "토요일 E")}
      ${requirementInput("sundayD", "일요일 D")} ${requirementInput("sundayE", "일요일 E")}
      ${requirementInput("holidayD", "공휴일 D")} ${requirementInput("holidayE", "공휴일 E")} ${requirementInput("holidayN", "공휴일 N")}`;
    document.getElementById("legalityInputs").innerHTML = `
      <label>병상 수 <input id="bedsInput" type="number" min="0" value="${escapeHtml(state.legality.beds)}"></label>
      <label>배치 간호사 수 <input id="nursesInput" type="number" min="0" value="${escapeHtml(state.legality.nurses)}"></label>
      <label>주간 근로시간 설정 <input id="weeklyHoursInput" value="${escapeHtml(state.legality.weeklyHours)}"></label>
      <label>휴일 부여 현황 <input id="holidaysInput" value="${escapeHtml(state.legality.holidays)}"></label>`;
    document.getElementById("holidayInput").value = state.holidays.join(",");
    document.getElementById("offRequestInput").value = state.offRequests.map(r => `${nurseById(r.nurseId)?.name || ""},${r.iso}`).join("\n");
    document.getElementById("fixedCellInput").value = state.fixedCells.map(f => `${nurseById(f.nurseId)?.name || ""},${f.iso},${f.code}`).join("\n");
    document.getElementById("nurseEditor").innerHTML = `<button id="addNurse" type="button">간호사 추가</button><div class="nurse-grid">${state.nurses.map(n => `
      <div class="nurse-row"><button class="edit-nurse" data-id="${n.id}">${escapeHtml(n.name)}</button><span>${n.leave || 0}연차</span><span>${n.night ? "N전담" : n.restriction}</span><span>${n.enabled ? "ON" : "OFF"}</span></div>`).join("")}</div>`;
    renderSortable("schedulePriority", state.schedulePriority);
    renderSortable("roomPriority", state.roomPriority);
    renderDailyRequirements();
  }

  function requirementInput(key, label) {
    return `<label>${label} <input class="requirement-input" data-key="${key}" type="number" min="0" value="${state.requirements[key]}"></label>`;
  }

  function renderSortable(id, items) {
    document.getElementById(id).innerHTML = items.map((item, index) => `<li draggable="true" data-index="${index}">${escapeHtml(item)}</li>`).join("");
  }

  function renderDailyRequirements() {
    const container = document.getElementById("dailyRequirementEditor");
    container.innerHTML = monthDays().map(d => {
      const value = state.dailyRequirements[d.iso] || requirementsFor(d);
      return `<label>${d.iso} D/E/N <input class="daily-requirement" data-iso="${d.iso}" value="${value.D},${value.E},${value.N}"></label>`;
    }).join("");
  }

  function showTab(tabId) {
    document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.id === tabId));
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.tab === tabId));
    document.getElementById("sidebar").classList.remove("open");
  }

  function toast(message) {
    const toastElement = document.getElementById("toast");
    toastElement.textContent = message;
    toastElement.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toastElement.style.display = "none"; }, 2600);
  }

  function setupDragAndDrop() {
    document.querySelectorAll(".sortable").forEach(list => {
      let dragged = null;
      list.addEventListener("dragstart", event => {
        dragged = event.target.closest("li");
      });
      list.addEventListener("dragover", event => event.preventDefault());
      list.addEventListener("drop", event => {
        event.preventDefault();
        const target = event.target.closest("li");
        if (!dragged || !target || dragged === target) return;
        const from = Number(dragged.dataset.index);
        const to = Number(target.dataset.index);
        const keyName = list.id === "schedulePriority" ? "schedulePriority" : "roomPriority";
        const item = state[keyName].splice(from, 1)[0];
        state[keyName].splice(to, 0, item);
        saveState();
        renderSortable(list.id, state[keyName]);
        setupDragAndDrop();
      });
    });
  }

  function saveSettingsFromUI() {
    state.month = document.getElementById("monthInput").value || state.month;
    document.querySelectorAll(".requirement-input").forEach(input => { state.requirements[input.dataset.key] = Number(input.value); });
    state.legality.beds = document.getElementById("bedsInput").value;
    state.legality.nurses = document.getElementById("nursesInput").value;
    state.legality.weeklyHours = document.getElementById("weeklyHoursInput").value;
    state.legality.holidays = document.getElementById("holidaysInput").value;
    state.holidays = document.getElementById("holidayInput").value.split(",").map(v => v.trim()).filter(Boolean);

    state.offRequests = [];
    document.getElementById("offRequestInput").value.split("\n").map(v => v.trim()).filter(Boolean).forEach(line => {
      const [name, iso] = line.split(",");
      const nurse = nurseByName(name.trim());
      if (nurse && /^\d{4}-\d{2}-\d{2}$/.test((iso || "").trim())) state.offRequests.push({ nurseId: nurse.id, iso: iso.trim() });
    });
    state.fixedCells = [];
    document.getElementById("fixedCellInput").value.split("\n").map(v => v.trim()).filter(Boolean).forEach(line => {
      const [name, iso, code] = line.split(",");
      const nurse = nurseByName(name.trim());
      if (nurse && SHIFTS.includes((code || "").trim())) state.fixedCells.push({ nurseId: nurse.id, iso: iso.trim(), code: code.trim() });
    });
    document.querySelectorAll(".daily-requirement").forEach(input => {
      const parts = input.value.split(",").map(v => Number(v.trim()));
      if (parts.length === 3 && parts.every(v => !Number.isNaN(v))) state.dailyRequirements[input.dataset.iso] = { D: parts[0], E: parts[1], N: parts[2] };
    });
    saveState();
    renderAll();
    setupDragAndDrop();
    toast("설정을 저장했습니다.");
  }

  function openNurseDialog(nurseId) {
    const nurse = nurseId ? nurseById(nurseId) : null;
    document.getElementById("nurseDialogTitle").textContent = nurse ? "간호사 정보 수정" : "간호사 추가";
    document.getElementById("nurseId").value = nurse?.id || "";
    document.getElementById("nurseName").value = nurse?.name || "";
    document.getElementById("nurseLeave").value = nurse?.leave || 0;
    document.getElementById("nurseSenior").value = nurse?.senior ? "true" : "false";
    document.getElementById("nurseEnabled").checked = nurse ? nurse.enabled : true;
    document.getElementById("nurseNight").checked = nurse?.night || false;
    document.getElementById("nurseRestriction").value = nurse?.restriction || "ALL";
    document.getElementById("nurseWeekdayD").checked = nurse?.weekdayD || false;
    document.getElementById("nurseDPriority").checked = nurse?.dPriority || false;
    document.getElementById("nurseFixedRooms").value = nurse?.fixedRooms?.join(",") || "";
    document.getElementById("nurseSpecialFixedRooms").value = nurse?.specialFixedRooms?.join(",") || "";
    document.getElementById("nurseDialog").showModal();
  }

  function saveNurseFromDialog() {
    const id = document.getElementById("nurseId").value;
    const nurse = {
      id: id || `n${Date.now()}`,
      name: document.getElementById("nurseName").value.trim(),
      leave: Number(document.getElementById("nurseLeave").value) || 0,
      senior: document.getElementById("nurseSenior").value === "true",
      enabled: document.getElementById("nurseEnabled").checked,
      night: document.getElementById("nurseNight").checked,
      restriction: document.getElementById("nurseRestriction").value.trim().toUpperCase() || "ALL",
      weekdayD: document.getElementById("nurseWeekdayD").checked,
      dPriority: document.getElementById("nurseDPriority").checked,
      fixedRooms: document.getElementById("nurseFixedRooms").value.split(",").map(v => v.trim()).filter(Boolean),
      specialFixedRooms: document.getElementById("nurseSpecialFixedRooms").value.split(",").map(v => v.trim()).filter(Boolean)
    };
    if (!nurse.name) return;
    const index = state.nurses.findIndex(n => n.id === id);
    if (index >= 0) state.nurses[index] = nurse;
    else state.nurses.push(nurse);
    saveState();
    renderAll();
  }

  function undoSchedule() {
    const previous = state.undos.pop();
    if (!previous) return;
    state.schedule = JSON.parse(previous);
    saveState();
    renderAll();
    toast("이전 근무표 상태로 되돌렸습니다.");
  }

  function confirmSchedule() {
    const errors = validateSchedule();
    const fatal = errors.filter(e => e.level === "error");
    if (fatal.length) {
      toast(`확정할 수 없습니다. 필수 오류 ${fatal.length}건`);
      showTab("schedule");
      return;
    }
    state.confirmed = true;
    saveState();
    generateRooms();
    toast("근무표를 확정하고 호실 배정을 실행했습니다.");
  }

  function importPrevious() {
    const lines = document.getElementById("previousScheduleInput").value.split("\n").map(v => v.trim()).filter(Boolean);
    state.previous = [];
    lines.forEach(line => {
      const [name, iso, code, room] = line.split(",");
      const nurse = nurseByName(name.trim());
      if (nurse && /^\d{4}-\d{2}-\d{2}$/.test((iso || "").trim())) {
        state.previous.push({ nurseId: nurse.id, iso: iso.trim(), code: (code || "").trim(), room: (room || "").trim() });
      }
    });
    saveState();
    toast(`이전 근무표 ${state.previous.length}건을 가져왔습니다.`);
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    const scheduleTable = document.getElementById("scheduleTable").outerHTML;
    const roomTable = document.getElementById("roomTable").outerHTML;
    const nurseTable = document.getElementById("nurseStatsTable").outerHTML;
    const validationTable = document.getElementById("validationTable").outerHTML;
    const offRows = state.nurses.filter(n => n.enabled).map(nurse => {
      const counts = { weekday: 0, saturday: 0, sunday: 0, holiday: 0, total: 0 };
      monthDays().forEach(day => {
        const code = getSchedule(nurse.id, day.iso);
        if (code !== "OFF" && code !== "연차") return;
        counts.total++;
        if (state.holidays.includes(day.iso)) counts.holiday++;
        else if (day.weekday === 6) counts.saturday++;
        else if (day.weekday === 0) counts.sunday++;
        else counts.weekday++;
      });
      return `<tr><td>${escapeHtml(nurse.name)}</td><td>${counts.weekday}</td><td>${counts.saturday}</td><td>${counts.sunday}</td><td>${counts.holiday}</td><td>${counts.total}</td></tr>`;
    }).join("");
    const offTable = `<table><thead><tr><th>간호사</th><th>평일 OFF</th><th>토요일 OFF</th><th>일요일 OFF</th><th>공휴일 OFF</th><th>총 OFF</th></tr></thead><tbody>${offRows}</tbody></table>`;
    const weekendRows = state.nurses.filter(n => n.enabled).map(nurse => {
      const saturday = monthDays().filter(day => day.weekday === 6 && ["D", "E", "N"].includes(getSchedule(nurse.id, day.iso))).length;
      const sunday = monthDays().filter(day => day.weekday === 0 && ["D", "E", "N"].includes(getSchedule(nurse.id, day.iso))).length;
      const holiday = monthDays().filter(day => state.holidays.includes(day.iso) && ["D", "E", "N"].includes(getSchedule(nurse.id, day.iso))).length;
      return `<tr><td>${escapeHtml(nurse.name)}</td><td>${saturday}</td><td>${sunday}</td><td>${holiday}</td></tr>`;
    }).join("");
    const weekendTable = `<table><thead><tr><th>간호사</th><th>토요일 근무</th><th>일요일 근무</th><th>공휴일 근무</th></tr></thead><tbody>${weekendRows}</tbody></table>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <h1>근무표</h1>${scheduleTable}<h1>호실 배정표</h1>${roomTable}
      <h1>간호사별 근무 통계</h1>${nurseTable}<h1>법적 기준 검증 결과</h1>${validationTable}
      <h1>OFF 및 연차 통계</h1>${offTable}<h1>주말·공휴일 근무 통계</h1>${weekendTable}
      <h1>배정 오류 및 예외 내역</h1>${validateSchedule().concat(validateRooms()).map(e => escapeHtml(e.text)).join("<br>")}</body></html>`;
    download(`근무표_${state.month}.xls`, html, "application/vnd.ms-excel");
  }

  function tableToCanvas(table, title) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const rows = Array.from(table.rows);
    const scale = 2;
    const cellWidth = 82 * scale;
    const nameWidth = 130 * scale;
    const rowHeight = 38 * scale;
    canvas.width = nameWidth + Math.max(1, rows[0].cells.length - 1) * cellWidth;
    canvas.height = (rows.length + 1) * rowHeight;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#14253d";
    ctx.font = `${16 * scale}px Malgun Gothic`;
    ctx.fillText(title, 12 * scale, 24 * scale);
    ctx.font = `${12 * scale}px Malgun Gothic`;
    rows.forEach((row, r) => {
      const y = (r + 1) * rowHeight;
      Array.from(row.cells).forEach((cell, c) => {
        const x = c === 0 ? 0 : nameWidth + (c - 1) * cellWidth;
        const width = c === 0 ? nameWidth : cellWidth;
        ctx.fillStyle = r === 0 ? "#f7f9fc" : "#ffffff";
        ctx.fillRect(x, y, width, rowHeight);
        ctx.strokeStyle = "#e6eaf0";
        ctx.strokeRect(x, y, width, rowHeight);
        ctx.fillStyle = "#26364a";
        ctx.fillText(cell.innerText.trim().replace(/\n/g, " "), x + 6 * scale, y + 23 * scale, width - 10 * scale);
      });
    });
    return canvas;
  }

  function exportPng(type) {
    const table = type === "room" ? document.getElementById("roomTable") : document.getElementById("scheduleTable");
    const canvas = tableToCanvas(table, type === "room" ? "호실 배정표" : "근무표");
    const link = document.createElement("a");
    link.download = `${type === "room" ? "호실배정표" : "근무표"}_${state.month}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function exportJson() {
    download(`병동근무_${state.month}.json`, JSON.stringify(state, null, 2), "application/json");
  }

  document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => showTab(item.dataset.tab)));
  document.getElementById("menuButton").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("quickGenerate").addEventListener("click", generateSchedule);
  document.getElementById("generateSchedule").addEventListener("click", generateSchedule);
  document.getElementById("generateRooms").addEventListener("click", generateRooms);
  document.getElementById("undoSchedule").addEventListener("click", undoSchedule);
  document.getElementById("confirmSchedule").addEventListener("click", confirmSchedule);
  document.getElementById("saveSettings").addEventListener("click", saveSettingsFromUI);
  document.getElementById("resetSettings").addEventListener("click", () => {
    if (!confirm("모든 설정을 초기값으로 복원할까요?")) return;
    state = defaultState();
    saveState();
    renderAll();
    setupDragAndDrop();
    toast("초기값으로 복원했습니다.");
  });
  document.getElementById("nurseEditor").addEventListener("click", event => {
    const button = event.target.closest(".edit-nurse");
    if (button) openNurseDialog(button.dataset.id);
    if (event.target.closest("#addNurse")) openNurseDialog();
  });
  document.getElementById("saveNurse").addEventListener("click", event => {
    event.preventDefault();
    saveNurseFromDialog();
    document.getElementById("nurseDialog").close();
  });
  document.getElementById("scheduleTable").addEventListener("change", event => {
    const select = event.target.closest(".schedule-cell");
    if (!select) return;
    state.undos.push(JSON.stringify(state.schedule));
    const nurse = nurseById(select.dataset.nurse);
    const day = monthDays().find(d => d.iso === select.dataset.iso);
    const next = select.value;
    const previous = getSchedule(nurse.id, day.iso);
    setSchedule(nurse.id, day.iso, next);
    const errors = validateSchedule();
    const related = errors.filter(e => e.text.includes(nurse.name) || e.text.includes(day.iso));
    const fatal = related.filter(e => e.level === "error");
    if (fatal.length) {
      setSchedule(nurse.id, day.iso, previous);
      state.undos.pop();
      renderSchedule();
      toast(`변경을 저장할 수 없습니다: ${fatal[0].text}`);
    } else {
      saveState();
      renderAll();
      toast("근무 셀을 변경했습니다.");
    }
  });
  document.getElementById("roomTable").addEventListener("change", event => {
    const select = event.target.closest(".room-cell");
    if (!select) return;
    const roomKey = key(select.dataset.nurse, `${select.dataset.iso}|${select.dataset.shift}`);
    const previous = state.rooms[roomKey] || "";
    state.rooms[roomKey] = select.value;
    const nurse = nurseById(select.dataset.nurse);
    const fatal = validateRooms().filter(e =>
      e.level === "error" &&
      (e.text.includes(select.dataset.iso) || e.text.includes(nurse?.name || ""))
    );
    if (fatal.length) {
      state.rooms[roomKey] = previous;
      renderRooms();
      toast(`호실 변경을 저장할 수 없습니다: ${fatal[0].text}`);
    } else {
      saveState();
      renderAll();
      toast("호실 배정을 변경했습니다.");
    }
  });
  document.getElementById("importPrevious").addEventListener("click", importPrevious);
  document.getElementById("exportExcel").addEventListener("click", exportExcel);
  document.getElementById("exportSchedulePng").addEventListener("click", () => exportPng("schedule"));
  document.getElementById("exportRoomPng").addEventListener("click", () => exportPng("room"));
  document.getElementById("exportJson").addEventListener("click", exportJson);
  document.getElementById("importJsonButton").addEventListener("click", () => document.getElementById("importJsonFile").click());
  document.getElementById("importJsonFile").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = { ...defaultState(), ...JSON.parse(reader.result) };
        saveState();
        renderAll();
        setupDragAndDrop();
        toast("JSON 데이터를 복원했습니다.");
      } catch (_) {
        toast("JSON 파일 형식을 확인할 수 없습니다.");
      }
    };
    reader.readAsText(file);
  });

  renderAll();
  setupDragAndDrop();
})();
