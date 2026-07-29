import frappe


def execute():
    """Re-rate historical NON_PRIMARY_SITE_PUNCH flags from WARNING to INFO.

    Severity is stamped once, at insert (see AttendanceFlag.before_insert), so
    changing FLAG_SEVERITY only affects rows generated afterwards. Left alone,
    the same flag would read as a warning on last month's days and a note on
    this month's, and historical weeks would keep an inflated warning count.

    Idempotent: the `severity != 'INFO'` guard means a second run matches
    nothing rather than rewriting every row.
    """
    frappe.db.sql(
        """
        UPDATE `tabAttendance Flag`
        SET severity = 'INFO'
        WHERE flag_code = 'NON_PRIMARY_SITE_PUNCH' AND severity != 'INFO'
        """
    )
