import { useMemo, useState } from "react";
import {
  useFrappeGetDocList,
  useFrappeCreateDoc,
  useFrappeUpdateDoc,
  useFrappeDeleteDoc,
  useFrappeGetCall,
  useFrappePostCall,
} from "frappe-react-sdk";
import {
  Card,
  Button,
  Checkbox,
  Input,
  Switch,
  Label,
  EmptyState,
  Skeleton,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lolbikb/dewey-ui";
import { LayoutGrid } from "lucide-react";
import type { LauncherTile } from "./tileTypes";
import { GATE_OPTIONS } from "./tileTypes";
import { AdminNav } from "./AdminNav";

const DT = "Launcher Tile";
const FIELDS: (keyof LauncherTile)[] = [
  "name",
  "app_name",
  "title",
  "route",
  "icon",
  "tile_order",
  "enabled",
  "is_admin",
  "gate",
];

export function AdminTiles() {
  const { data, isLoading, mutate } = useFrappeGetDocList<LauncherTile>(DT, {
    fields: FIELDS as string[],
    orderBy: { field: "tile_order", order: "asc" },
    limit: 200,
  });
  const { updateDoc } = useFrappeUpdateDoc<LauncherTile>();
  const { deleteDoc } = useFrappeDeleteDoc();
  const [editing, setEditing] = useState<Partial<LauncherTile> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tiles = useMemo(() => data ?? [], [data]);

  async function toggle(t: LauncherTile) {
    setError(null);
    try {
      await updateDoc(DT, t.name, { enabled: t.enabled ? 0 : 1 });
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function move(t: LauncherTile, dir: -1 | 1) {
    setError(null);
    const idx = tiles.findIndex((x) => x.name === t.name);
    const swap = tiles[idx + dir];
    if (!swap) return;
    try {
      await updateDoc(DT, t.name, { tile_order: swap.tile_order });
      await updateDoc(DT, swap.name, { tile_order: t.tile_order });
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(t: LauncherTile) {
    if (!confirm(`Delete tile "${t.title}"?`)) return;
    setError(null);
    try {
      await deleteDoc(DT, t.name);
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <AdminNav active="/home/admin" />
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Manage app tiles</h1>
          <p className="text-sm text-muted-foreground">
            Control which apps appear on the home launcher.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              setEditing({
                gate: "hr_or_employee",
                enabled: 1,
                is_admin: 0,
                tile_order: (tiles.at(-1)?.tile_order ?? 0) + 10,
              })
            }
          >
            New tile
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No tiles yet"
          description="Add a tile to show it on the launcher."
        />
      ) : (
        <div className="space-y-2">
          {tiles.map((t, i) => (
            <Card key={t.name} className="flex items-center gap-3 p-3">
              <img
                src={t.icon || ""}
                alt=""
                className="size-8 rounded"
                onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.route} · {t.gate}
                  {t.is_admin ? " · admin" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === 0}
                  onClick={() => move(t, -1)}
                  aria-label="Move up"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === tiles.length - 1}
                  onClick={() => move(t, 1)}
                  aria-label="Move down"
                >
                  ↓
                </Button>
                <Switch
                  checked={!!t.enabled}
                  onCheckedChange={() => toggle(t)}
                  aria-label="Enabled"
                />
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(t)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <TileDialog
          tile={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}

function TileDialog({
  tile,
  onClose,
  onSaved,
}: {
  tile: Partial<LauncherTile>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !tile.name;
  const { createDoc } = useFrappeCreateDoc<Partial<LauncherTile>>();
  const { updateDoc } = useFrappeUpdateDoc<LauncherTile>();
  const [form, setForm] = useState<Partial<LauncherTile>>(tile);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const set = (k: keyof LauncherTile, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  const ASSIGNABLE = "dewey_time.attendance_engine.access.get_assignable_roles";
  const GET_ROLES = "dewey_time.attendance_engine.access.get_tile_roles";
  const SET_ROLES = "dewey_time.attendance_engine.access.set_tile_roles";

  const { data: rolesData } = useFrappeGetCall<{ message: string[] }>(ASSIGNABLE, undefined, ASSIGNABLE);
  const allRoles = rolesData?.message ?? [];
  const { data: tileRolesData } = useFrappeGetCall<{ message: string[] }>(
    GET_ROLES, isNew ? undefined : { tile: tile.name }, isNew ? null : `${GET_ROLES}:${tile.name}`
  );
  const { call: callSetRoles } = useFrappePostCall<{ message: unknown }>(SET_ROLES);
  const [selectedRoles, setSelectedRoles] = useState<string[] | null>(null);
  // Initialize selection once existing rows load (edit), or [] for new tiles.
  const roles = selectedRoles ?? (isNew ? [] : tileRolesData?.message ?? []);
  const toggleRole = (r: string) =>
    setSelectedRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);

  async function save() {
    setDialogError(null);
    try {
      if (isNew) {
        await createDoc(DT, form);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { app_name: _ignore, ...rest } = form;
        await updateDoc(DT, tile.name!, rest);
      }
      const tileName = isNew ? form.app_name! : tile.name!;
      if (form.gate === "roles") {
        await callSetRoles({ tile: tileName, roles });
      }
      onSaved();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "New tile" : "Edit tile"}</DialogTitle>
        </DialogHeader>
        {dialogError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {dialogError}
          </p>
        )}
        <div className="space-y-3">
          {isNew && (
            <Field label="App name (id)">
              <Input
                value={form.app_name ?? ""}
                onChange={(e) => set("app_name", e.target.value)}
              />
            </Field>
          )}
          <Field label="Title">
            <Input
              value={form.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Route">
            <Input
              value={form.route ?? ""}
              onChange={(e) => set("route", e.target.value)}
              placeholder="/my-app"
            />
          </Field>
          <Field label="Icon URL">
            <Input
              value={form.icon ?? ""}
              onChange={(e) => set("icon", e.target.value)}
              placeholder="/assets/dewey_time/images/...svg"
            />
          </Field>
          <Field label="Visibility gate">
            <Select
              value={form.gate}
              onValueChange={(v) => set("gate", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GATE_OPTIONS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.gate === "roles" && (
            <Field label="Visible to roles">
              <div className="max-h-40 space-y-1.5 overflow-auto rounded-md border border-border p-2.5">
                {allRoles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Loading roles…</p>
                ) : (
                  allRoles.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={roles.includes(r)} onCheckedChange={() => toggleRole(r)} />
                      {r}
                    </label>
                  ))
                )}
              </div>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={!!form.is_admin}
              onCheckedChange={(v) => set("is_admin", v ? 1 : 0)}
            />
            Admin only
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={
              !form.title || !form.route || (isNew && !form.app_name)
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
