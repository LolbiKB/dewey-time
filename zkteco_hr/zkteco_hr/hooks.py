app_name = "zkteco_hr"
app_title = "ZKTeco HR"
app_publisher = "ZKTeco HR"
app_description = "Attendance flags + weekly view (MVP)"
app_email = "noreply@example.com"
app_license = "MIT"

# Frappe v16 Desktop / Sidebar integration
# Provides a stable entry point for the app on the Desk desktop.
add_to_apps_screen = [
    {
        "name": "zkteco_hr",
        "title": "ZKTeco HR",
        "route": "/app/hr-attendance-calendar-react",
    }
]

# Website SPA entry (Doppio-style) for ergonomic SPA routing.
# This lets you open the app at /hr-attendance and have client-side routing work.
website_route_rules = [
    {"from_route": "/hr-attendance/<path:app_path>", "to_route": "hr-attendance"},
    {"from_route": "/hr-attendance", "to_route": "hr-attendance"},
]

# Scheduled job (closeout-only MVP)
scheduler_events = {
    "daily": [
        "zkteco_hr.attendance_engine.closeout.run_yesterday_closeout",
    ],
}

