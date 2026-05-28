frappe.pages["hr-attendance-calendar-react"].on_page_load = function (wrapper) {
  const page = frappe.ui.make_app_page({
    parent: wrapper,
    title: "HR Attendance Calendar (React)",
    single_column: true,
  });

  const root = document.createElement("div");
  root.id = "root";
  page.main.get(0).appendChild(root);

  const css = "/assets/zkteco_hr/hr_attendance/assets/index.css";
  const js = "/assets/zkteco_hr/hr_attendance/assets/index.js";

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = css;
  document.head.appendChild(link);

  const script = document.createElement("script");
  script.src = js;
  script.onerror = () => {
    root.innerHTML =
      "<div class='text-muted' style='padding:16px'>HR Attendance bundle not found at <code>/assets/zkteco_hr/hr_attendance/assets/index.js</code>. Run <code>npm run build</code> in the app root, commit <code>public/hr_attendance/</code> and <code>www/hr-attendance.html</code>, then migrate the site.</div>";
  };
  document.head.appendChild(script);
};
