from dewey_time.utils.sync_hr_attendance_assets import (
    ATTENDANCE_APP_LOGO,
    SITE_FAVICON_LOGO,
)

app_name = "dewey_time"
app_title = "Dewey Time"
app_publisher = "Dewey Time"
app_description = "Attendance flags + weekly view (MVP)"
app_email = "noreply@example.com"
app_license = "MIT"

app_logo_url = SITE_FAVICON_LOGO

website_context = {
    "favicon": SITE_FAVICON_LOGO,
    "splash_image": SITE_FAVICON_LOGO,
}

# Frappe v16 Desktop / Sidebar integration
add_to_apps_screen = [
    {
        "name": "dewey_time",
        "title": "Dewey Time",
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

# Ensure dewey_time's custom fields exist on install (and after every upgrade).
after_install = "dewey_time.setup.custom_fields.make_custom_fields"

# Keep SPA assets available under sites/assets after every migrate (+ ensure fields).
after_migrate = [
    "dewey_time.setup.custom_fields.make_custom_fields",
    "dewey_time.utils.sync_hr_attendance_assets.sync_hr_attendance_assets",
    "dewey_time.utils.sync_adms_assets.sync_adms_assets",
    "dewey_time.attendance_engine.dashboard_auth.ensure_adms_roles",
    "dewey_time.webpush.ensure_vapid_keys",
]

# Scheduled job: company fallback UNNOTIFIED_ABSENCE (~03:00 per company timezone)
scheduler_events = {
    "daily": [
        "dewey_time.attendance_engine.closeout.run_company_fallback_closeout",
    ],
    "cron": {
        "*/30 * * * *": [
            "dewey_time.attendance_engine.intraday.run_intraday_scheduler",
        ],
    },
}

doc_events = {
    "Employee Checkin": {
        "after_insert": "dewey_time.attendance_engine.intraday.on_employee_checkin_after_insert",
        "on_update": "dewey_time.attendance_engine.intraday.on_employee_checkin_on_update",
    },
}
