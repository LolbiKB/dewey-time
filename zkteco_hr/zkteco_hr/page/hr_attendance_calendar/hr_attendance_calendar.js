frappe.pages["hr-attendance-calendar"].on_page_load = function (wrapper) {
  const page = frappe.ui.make_app_page({
    parent: wrapper,
    title: "HR Attendance Calendar",
    single_column: true,
  });

  const state = {
    view: "month", // "month" | "week"
    employee: null,
    anchorDate: frappe.datetime.str_to_obj(frappe.datetime.get_today()), // JS Date
    cache: new Map(), // key -> payload
    loading: false,
  };

  page.main.html(`
    <div class="zk-hrcal">
      <style>
        .zk-hrcal { padding: 12px 0; }
        .zk-hrcal-toolbar {
          display: grid;
          grid-template-columns: 1fr auto auto auto;
          gap: 8px;
          align-items: end;
          margin-bottom: 12px;
        }
        .zk-hrcal-toolbar .field-area { min-width: 320px; }
        .zk-hrcal-toolbar .btn-group .btn { min-width: 88px; }
        .zk-hrcal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 8px 0 12px;
        }
        .zk-hrcal-range-title {
          font-size: 16px;
          font-weight: 600;
        }
        .zk-hrcal-grid {
          border: 1px solid var(--border-color);
          border-radius: 10px;
          overflow: hidden;
          background: var(--card-bg);
        }
        .zk-hrcal-weekdays {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          background: var(--subtle-fg);
          color: var(--text-muted);
          font-size: 12px;
          border-bottom: 1px solid var(--border-color);
        }
        .zk-hrcal-weekdays > div { padding: 10px 10px; font-weight: 600; }
        .zk-hrcal-cells.month {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          grid-auto-rows: 118px;
        }
        .zk-hrcal-cells.week {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          grid-auto-rows: 160px;
        }
        .zk-hrcal-cell {
          padding: 10px;
          border-right: 1px solid var(--border-color);
          border-bottom: 1px solid var(--border-color);
          position: relative;
        }
        .zk-hrcal-cell:nth-child(7n) { border-right: none; }
        .zk-hrcal-cell .daynum {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-color);
        }
        .zk-hrcal-cell.is-outside { background: var(--control-bg); opacity: 0.7; }
        .zk-hrcal-cell.is-today { outline: 2px solid var(--primary); outline-offset: -2px; }
        .zk-hrcal-meta {
          margin-top: 6px;
          font-size: 12px;
          color: var(--text-muted);
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .zk-hrcal-flags {
          margin-top: 8px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .zk-flag {
          cursor: pointer;
          border: 1px solid var(--border-color);
          border-radius: 999px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 600;
          background: var(--control-bg);
          color: var(--text-color);
          max-width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .zk-flag[data-sev="CRITICAL"] { border-color: var(--red-500); }
        .zk-flag[data-sev="WARNING"] { border-color: var(--orange-500); }
        .zk-flag[data-sev="INFO"] { border-color: var(--blue-500); }
        .zk-flag .status {
          margin-left: 6px;
          color: var(--text-muted);
          font-weight: 600;
        }
        .zk-hrcal-empty {
          padding: 28px;
          border: 1px dashed var(--border-color);
          border-radius: 10px;
          color: var(--text-muted);
          background: var(--control-bg);
          text-align: center;
        }
      </style>

      <div class="zk-hrcal-toolbar">
        <div class="field-area"></div>
        <div class="btn-group btn-view-toggle">
          <button class="btn btn-default btn-month">Month</button>
          <button class="btn btn-default btn-week">Week</button>
        </div>
        <button class="btn btn-default btn-today">Today</button>
        <div class="btn-group btn-nav">
          <button class="btn btn-default btn-prev">Prev</button>
          <button class="btn btn-default btn-next">Next</button>
        </div>
      </div>

      <div class="zk-hrcal-header">
        <div class="zk-hrcal-range-title"></div>
        <div class="zk-hrcal-subtitle text-muted"></div>
      </div>

      <div class="zk-hrcal-body"></div>
    </div>
  `);

  const $root = $(page.main).find(".zk-hrcal");
  const $fieldArea = $root.find(".field-area");
  const $body = $root.find(".zk-hrcal-body");
  const $title = $root.find(".zk-hrcal-range-title");
  const $subtitle = $root.find(".zk-hrcal-subtitle");

  const employeeField = frappe.ui.form.make_control({
    parent: $fieldArea.get(0),
    df: {
      fieldtype: "Link",
      label: "Employee",
      fieldname: "employee",
      options: "Employee",
      reqd: 1,
      onchange: () => {
        state.employee = employeeField.get_value() || null;
        render();
      },
    },
    render_input: true,
  });
  employeeField.refresh();

  function setView(view) {
    state.view = view;
    render();
  }

  function startOfWeek(d) {
    // Monday as start of week
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1) - day;
    x.setDate(x.getDate() + diff);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function ymd(d) {
    return frappe.datetime.obj_to_str(d);
  }

  function monthRange(anchorDate) {
    const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const gridEnd = addDays(gridStart, 41); // 6 weeks x 7 days
    return { start: gridStart, end: gridEnd };
  }

  function weekRange(anchorDate) {
    const start = startOfWeek(anchorDate);
    const end = addDays(start, 6);
    return { start, end };
  }

  function titleForRange(range) {
    const s = range.start;
    const e = range.end;
    const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
    if (state.view === "month") {
      const monthName = s.toLocaleString(undefined, { month: "long" });
      return `${monthName} ${s.getFullYear()}`;
    }
    if (sameMonth) {
      const monthName = s.toLocaleString(undefined, { month: "short" });
      return `${s.getDate()}–${e.getDate()} ${monthName} ${s.getFullYear()}`;
    }
    const sm = s.toLocaleString(undefined, { month: "short" });
    const em = e.toLocaleString(undefined, { month: "short" });
    return `${s.getDate()} ${sm} – ${e.getDate()} ${em} ${e.getFullYear()}`;
  }

  async function fetchRange(range) {
    if (!state.employee) return null;
    const key = `${state.employee}:${state.view}:${ymd(range.start)}:${ymd(range.end)}`;
    if (state.cache.has(key)) return state.cache.get(key);

    state.loading = true;
    renderLoading();
    try {
      const r = await frappe.call({
        method: "zkteco_hr.attendance_engine.hr_calendar.get_employee_calendar",
        args: {
          employee: state.employee,
          start_date: ymd(range.start),
          end_date: ymd(range.end),
        },
        freeze: false,
      });
      state.cache.set(key, r.message);
      return r.message;
    } finally {
      state.loading = false;
    }
  }

  function renderLoading() {
    $subtitle.text("Loading…");
  }

  function openFlagForm(flagName) {
    frappe.set_route("Form", "Attendance Flag", flagName);
  }

  function weekdayLabels() {
    // Monday-first
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }

  function cellHtml(dayDate, dayData, opts) {
    const today = frappe.datetime.get_today();
    const isToday = ymd(dayDate) === today;
    const dayNum = dayDate.getDate();

    const checkins = (dayData && dayData.checkins) || [];
    const firstIn = dayData && dayData.first_in ? frappe.datetime.str_to_user(dayData.first_in) : null;
    const lastOut = dayData && dayData.last_out ? frappe.datetime.str_to_user(dayData.last_out) : null;
    const grossMinutes = dayData && dayData.gross_minutes != null ? dayData.gross_minutes : null;

    const flags = (dayData && dayData.flags) || [];

    const metaParts = [];
    if (firstIn || lastOut) metaParts.push(`${firstIn || "—"} → ${lastOut || "—"}`);
    if (grossMinutes != null) metaParts.push(`${grossMinutes}m`);
    if (!metaParts.length && checkins.length) metaParts.push(`${checkins.length} punches`);

    const flagsHtml = flags
      .slice(0, state.view === "month" ? 3 : 6)
      .map((f) => {
        const sev = f.severity || "WARNING";
        const label = f.flag_code || "FLAG";
        const status = f.status ? `<span class="status">${frappe.utils.escape_html(f.status)}</span>` : "";
        return `<div class="zk-flag" data-flag="${frappe.utils.escape_html(
          f.name
        )}" data-sev="${frappe.utils.escape_html(sev)}" title="${frappe.utils.escape_html(
          label
        )}">${frappe.utils.escape_html(label)}${status}</div>`;
      })
      .join("");

    const outsideClass = opts && opts.isOutside ? "is-outside" : "";
    const todayClass = isToday ? "is-today" : "";

    return `
      <div class="zk-hrcal-cell ${outsideClass} ${todayClass}" data-date="${frappe.utils.escape_html(ymd(dayDate))}">
        <div class="daynum">${dayNum}</div>
        ${metaParts.length ? `<div class="zk-hrcal-meta">${metaParts.map((p) => `<div>${frappe.utils.escape_html(p)}</div>`).join("")}</div>` : ""}
        ${flagsHtml ? `<div class="zk-hrcal-flags">${flagsHtml}</div>` : ""}
      </div>
    `;
  }

  function buildGrid(range, payload) {
    const daysByKey = new Map();
    if (payload && payload.days) {
      for (const d of payload.days) {
        daysByKey.set(d.date, d);
      }
    }

    const labels = weekdayLabels().map((w) => `<div>${w}</div>`).join("");
    const cells = [];

    if (state.view === "month") {
      const month = state.anchorDate.getMonth();
      for (let i = 0; i < 42; i++) {
        const dt = addDays(range.start, i);
        const key = ymd(dt);
        const data = daysByKey.get(key) || null;
        const isOutside = dt.getMonth() !== month;
        cells.push(cellHtml(dt, data, { isOutside }));
      }
      return `
        <div class="zk-hrcal-grid">
          <div class="zk-hrcal-weekdays">${labels}</div>
          <div class="zk-hrcal-cells month">${cells.join("")}</div>
        </div>
      `;
    }

    // week
    for (let i = 0; i < 7; i++) {
      const dt = addDays(range.start, i);
      const key = ymd(dt);
      const data = daysByKey.get(key) || null;
      cells.push(cellHtml(dt, data, { isOutside: false }));
    }
    return `
      <div class="zk-hrcal-grid">
        <div class="zk-hrcal-weekdays">${labels}</div>
        <div class="zk-hrcal-cells week">${cells.join("")}</div>
      </div>
    `;
  }

  async function render() {
    $root.find(".btn-month").toggleClass("btn-primary", state.view === "month");
    $root.find(".btn-week").toggleClass("btn-primary", state.view === "week");

    const range = state.view === "month" ? monthRange(state.anchorDate) : weekRange(state.anchorDate);
    $title.text(titleForRange(range));
    $subtitle.text(state.employee ? state.employee : "Select an employee to begin");

    if (!state.employee) {
      $body.html(`<div class="zk-hrcal-empty">Select an employee to view attendance checkins and flags.</div>`);
      return;
    }

    const payload = await fetchRange(range);
    $subtitle.text("");

    $body.html(buildGrid(range, payload));

    // Click handlers for flag chips
    $body.find(".zk-flag").on("click", function () {
      const name = $(this).attr("data-flag");
      if (name) openFlagForm(name);
    });
  }

  // Toolbar handlers
  $root.find(".btn-month").on("click", () => setView("month"));
  $root.find(".btn-week").on("click", () => setView("week"));
  $root.find(".btn-today").on("click", () => {
    state.anchorDate = frappe.datetime.str_to_obj(frappe.datetime.get_today());
    render();
  });
  $root.find(".btn-prev").on("click", () => {
    if (state.view === "month") {
      state.anchorDate = new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth() - 1, 1);
    } else {
      state.anchorDate = addDays(state.anchorDate, -7);
    }
    render();
  });
  $root.find(".btn-next").on("click", () => {
    if (state.view === "month") {
      state.anchorDate = new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth() + 1, 1);
    } else {
      state.anchorDate = addDays(state.anchorDate, 7);
    }
    render();
  });

  // Initial render
  render();
};

