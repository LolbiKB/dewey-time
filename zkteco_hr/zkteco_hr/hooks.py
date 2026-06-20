from zkteco_hr.utils.sync_hr_attendance_assets import (
    ATTENDANCE_APP_LOGO,
    SITE_FAVICON_LOGO,
)

app_name = "zkteco_hr"
app_title = "ZKTeco HR"
app_publisher = "ZKTeco HR"
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

# Ensure zkteco_hr's custom fields exist on install (and after every upgrade).
after_install = "zkteco_hr.setup.custom_fields.make_custom_fields"

# Keep SPA assets available under sites/assets after every migrate (+ ensure fields).
# Asset publishing runs FIRST and is internally guarded (publish_assets_after_migrate),
# so a later/failing DB handler can never starve the user-facing SPA bundle (404 on
# /assets/zkteco_hr/**). See docs/HR_ATTENDANCE_DEPLOY.md.
after_migrate = [
    "zkteco_hr.utils.publish_assets.publish_assets_after_migrate",
    "zkteco_hr.setup.custom_fields.make_custom_fields",
    "zkteco_hr.attendance_engine.dashboard_auth.ensure_adms_roles",
]

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
        "on_update": "zkteco_hr.attendance_engine.intraday.on_employee_checkin_on_update",
    },
}
