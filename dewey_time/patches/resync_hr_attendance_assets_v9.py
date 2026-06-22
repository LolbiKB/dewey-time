from dewey_time.utils.sync_hr_attendance_assets import force_sync_hr_attendance_assets


def execute():
    """Force-copy SPA bundle after build v=1780990892 (SSA preview / weekly hours)."""
    force_sync_hr_attendance_assets()
