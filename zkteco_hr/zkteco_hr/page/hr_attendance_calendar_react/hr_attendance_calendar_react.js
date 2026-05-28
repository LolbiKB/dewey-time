frappe.pages["hr-attendance-calendar-react"].on_page_load = function (wrapper) {
  const page = frappe.ui.make_app_page({
    parent: wrapper,
    title: "HR Attendance Calendar (React)",
    single_column: true,
  });

  const root = document.createElement("div");
  root.id = "zk-hr-attendance-react-root";
  page.main.get(0).appendChild(root);

  // Load the Vite build output from /assets/zkteco_hr/hr_attendance/
  // This file will exist after running `vite build` from the frontend folder.
  // We keep this dynamic so the page doesn’t break the build if assets aren't present yet.
  const entry = "/assets/zkteco_hr/hr_attendance/assets/index.js";
  const css = "/assets/zkteco_hr/hr_attendance/assets/index.css";

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = css;
  link.onerror = () => {
    // CSS missing is non-fatal; JS will still render.
  };
  document.head.appendChild(link);

  const script = document.createElement("script");
  script.type = "module";
  script.src = entry;
  script.onerror = () => {
    root.innerHTML =
      "<div class='text-muted' style='padding:16px'>React bundle not found. Run Vite build to generate assets at <code>/assets/zkteco_hr/hr_attendance/</code>.</div>";
  };
  document.head.appendChild(script);
};

