export interface LauncherTile {
  name: string;
  app_name: string;
  title: string;
  route: string;
  icon?: string;
  tile_order: number;
  enabled: number; // 0 | 1
  is_admin: number; // 0 | 1
  gate: "hr_or_employee" | "adms" | "desk" | "roles";
}

// All four gates are now selectable; "roles" uses the Visible-to-roles picker.
export const GATE_OPTIONS: LauncherTile["gate"][] = ["hr_or_employee", "adms", "desk", "roles"];
