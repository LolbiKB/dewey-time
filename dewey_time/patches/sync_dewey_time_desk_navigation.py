import json
import os

import frappe

NAME = "Dewey Time"
APP = "dewey_time"


def execute():
    """Restore v16 Desk navigation: Workspace shortcuts, Sidebar, and Desktop Icon."""
    base = os.path.join(frappe.get_app_path(APP), "dewey_time")
    _sync_workspace(os.path.join(base, "workspace", "dewey_time", "dewey_time.json"))
    _sync_workspace_sidebar(os.path.join(base, "workspace_sidebar", "dewey_time.json"))
    _sync_desktop_icon(os.path.join(base, "desktop_icon", "dewey_time", "dewey_time.json"))
    frappe.clear_cache()


def _load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _sync_workspace(path):
    if not os.path.isfile(path):
        return

    data = _load_json(path)
    data["app"] = APP
    data["public"] = 1

    if frappe.db.exists("Workspace", NAME):
        doc = frappe.get_doc("Workspace", NAME)
        doc.update(
            {
                "title": data.get("title", NAME),
                "label": data.get("label", NAME),
                "module": data.get("module"),
                "app": APP,
                "icon": data.get("icon"),
                "public": 1,
                "content": data.get("content"),
            }
        )
        doc.shortcuts = []
        for row in data.get("shortcuts", []):
            doc.append("shortcuts", row)
        doc.save(ignore_permissions=True)
        return

    doc = frappe.get_doc(data)
    doc.insert(ignore_permissions=True)


def _sync_workspace_sidebar(path):
    if not os.path.isfile(path):
        return

    data = _load_json(path)

    if frappe.db.exists("Workspace Sidebar", NAME):
        doc = frappe.get_doc("Workspace Sidebar", NAME)
        doc.update(
            {
                "app": data.get("app", APP),
                "title": data.get("title", NAME),
                "module": data.get("module"),
                "header_icon": data.get("header_icon"),
                "standard": data.get("standard", 1),
            }
        )
        doc.items = []
        for row in data.get("items", []):
            doc.append("items", row)
        doc.save(ignore_permissions=True)
        return

    doc = frappe.get_doc(data)
    doc.insert(ignore_permissions=True)


def _sync_desktop_icon(path):
    if not os.path.isfile(path):
        return

    data = _load_json(path)
    data["app"] = APP
    data["link_to"] = NAME
    data["link_type"] = "Workspace Sidebar"

    if frappe.db.exists("Desktop Icon", NAME):
        doc = frappe.get_doc("Desktop Icon", NAME)
        doc.update(
            {
                "label": data.get("label", NAME),
                "icon_type": data.get("icon_type", "Link"),
                "link_type": "Workspace Sidebar",
                "link_to": NAME,
                "standard": data.get("standard", 1),
                "app": APP,
                "icon": data.get("icon"),
                "logo_url": data.get("logo_url"),
                "hidden": data.get("hidden", 0),
                "bg_color": data.get("bg_color", "gray"),
            }
        )
        doc.save(ignore_permissions=True)
        return

    doc = frappe.get_doc(data)
    doc.insert(ignore_permissions=True)
