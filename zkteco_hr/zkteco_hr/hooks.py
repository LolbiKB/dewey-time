from zkteco_hr.utils.sync_hr_attendance_assets import ATTENDANCE_APP_LOGO

app_name = "zkteco_hr"
app_title = "ZKTeco HR"
app_publisher = "ZKTeco HR"
app_description = "Attendance flags + weekly view (MVP)"
app_email = "noreply@example.com"
app_license = "MIT"

# Frappe v16 Desktop / Sidebar integration
# Provides a stable entry point for the app on the Desk desktop.
# Logo here + Desktop Icon logo_url only — do not set app_logo_url or
# website_context.favicon (those override site-wide Desk / login branding).
add_to_apps_screen = [
    {
        "name": "zkteco_hr",
        "title": "ZKTeco HR",
        "logo": ATTENDANCE_APP_LOGO,
        "route": "/hr-attendance",
    }
]

# Website SPA entry (Doppio-style) for ergonomic SPA routing.
# This lets you open the app at /hr-attendance and have client-side routing work.
website_route_rules = [
    {"from_route": "/hr-attendance/<path:app_path>", "to_route": "hr-attendance"},
    {"from_route": "/hr-attendance", "to_route": "hr-attendance"},
    {"from_route": "/hr-schedule/<path:app_path>", "to_route": "hr-schedule"},
    {"from_route": "/hr-schedule", "to_route": "hr-schedule"},
]

# Keep SPA assets available under sites/assets after every migrate.
after_migrate = ["zkteco_hr.utils.sync_hr_attendance_assets.sync_hr_attendance_assets"]

# Scheduled job: company fallback UNNOTIFIED_ABSENCE (~03:00 per company timezone)
scheduler_events = {
    "daily": [
        "zkteco_hr.attendance_engine.closeout.run_company_fallback_closeout",
    ],
    "cron": {
        "*/30 * * * *": [
            "zkteco_hr.attendance_engine.intraday.run_intraday_scheduler",
        ],
    },
}

doc_events = {
    "Employee Checkin": {
        "after_insert": "zkteco_hr.attendance_engine.intraday.on_employee_checkin_after_insert",
    },
}

