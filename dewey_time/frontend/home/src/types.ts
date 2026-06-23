export interface LauncherApp {
  name: string;
  title: string;
  route: string;
  logo: string;
  admin: boolean;
}
export interface LauncherData {
  user: { full_name: string; initials: string; image_url?: string | null };
  apps: LauncherApp[];
}
