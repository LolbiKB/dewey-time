/**
 * What HR's record says about you, and what the devices know.
 *
 * READ-ONLY, every block. The Employee doctype is HR's to edit and this app has
 * no write endpoint at all; the contact block says so in words rather than
 * offering a field that would fail.
 *
 * The roster at the bottom is MySchedulePage, mounted unchanged. It is the only
 * surface in this app that pages FORWARD — the calendar sheet is
 * `disabled={{ after: today }}` — so it survived the tab it used to own.
 */
import { endOfMonth, format, startOfMonth } from "date-fns";

import { parseDateTimeLocal } from "@/lib/attendanceTime";
import { useFormat, useT } from "@/miniapp/MiniLocale";
import { MiniErrorState, MiniState } from "@/miniapp/MiniState";
import {
  biometricBodyKey, biometricStateKey, fingerKeys, monthStats, parseDateOnly,
  serviceLength,
} from "@/miniapp/miniProfile";
import { ProfileHeading, ProfileSection } from "@/miniapp/MiniProfileRow";
import { MySchedulePage } from "@/miniapp/MySchedulePage";
import { useMiniAppCalendar, useMyProfile } from "@/miniapp/useMiniAppSession";

function Stat(props: { value: string; label: string; amber?: boolean }) {
  return (
    <div className="flex-1 border-r border-border px-2 py-2.5 text-center last:border-r-0">
      {/* Amber, never destructive — the same rule the calendar marks and the
          flags pill follow. Red is for irreversible actions. */}
      <p
        className={
          props.amber
            ? "text-lg font-semibold tabular-nums text-amber-500"
            : "text-lg font-semibold tabular-nums text-foreground"
        }
      >
        {props.value}
      </p>
      <p className="text-[10px] text-muted-foreground">{props.label}</p>
    </div>
  );
}

export function MyProfilePage(props: {
  today?: Date;
  offset?: number;
  onOffsetChange?: (next: number) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const today = props.today ?? new Date();
  const profile = useMyProfile();
  // The SAME key MiniCalendarSheet uses for the current month, so on a launch
  // where the calendar has already been opened this costs nothing.
  //
  // Not polled. The 60s interval exists for the Day tab's claim about the
  // present ("In"), and nothing on this page makes one — a month of days
  // re-fetched every minute would buy a days-worked count that changes twice a
  // day. Resuming the app invalidates this key anyway.
  const month = useMiniAppCalendar(
    format(startOfMonth(today), "yyyy-MM-dd"),
    format(endOfMonth(today), "yyyy-MM-dd"),
    { poll: false },
  );

  if (profile.isLoading) return <MiniState>{t("loadingProfile")}</MiniState>;
  if (profile.isError || !profile.data)
    return <MiniErrorState error={profile.error} fallback="errorProfile" />;

  const me = profile.data;
  const bio = me.biometric;
  const fingers = fingerKeys(bio);
  // Suppressed at zero. Somebody who started a fortnight ago has served no
  // whole months, and "0mo" under their joining date is a line that adds
  // nothing to the date directly above it. Not folded into serviceLength: null
  // there would mean "we don't know", which is a different fact.
  const span = serviceLength(me.date_of_joining, today);
  const service = span && (span.years || span.months) ? fmt.service(span) : null;
  const bodyKey = biometricBodyKey(bio.state);
  const stats = monthStats(month.data?.days ?? [], today);
  const joined = parseDateOnly(me.date_of_joining);
  const checked = bio.checked_at ? parseDateTimeLocal(bio.checked_at) : null;
  const checkedAt =
    checked && !Number.isNaN(checked.getTime())
      ? [fmt.date(checked, "d MMM"), fmt.punch(bio.checked_at)].filter(Boolean).join(" · ")
      : null;

  return (
    <div className="flex flex-col gap-4 p-3">
      <ProfileSection
        title={t("sectionRecord")}
        rows={[
          // Latin, never run through fmt.digits: an employee id is a name, not
          // a quantity. The same rule MiniIdentity follows.
          { label: t("labelEmployeeId"), value: me.employee },
          { label: t("labelDepartment"), value: me.department },
          { label: t("labelEmployment"), value: me.employment_type },
          {
            label: t("labelJoined"),
            value: joined ? (
              <>
                {fmt.date(joined, "d MMM yyyy")}
                {service ? (
                  <span className="block text-[11px] text-muted-foreground">{service}</span>
                ) : null}
              </>
            ) : null,
          },
          { label: t("labelReportsTo"), value: me.reports_to_name },
        ]}
      />

      <ProfileSection
        title={t("sectionBiometric")}
        rows={[
          { label: t("labelStatus"), value: t(biometricStateKey(bio.state)) },
          {
            // Only when we actually know. A finger count sitting under "Not
            // checked yet" would contradict the line directly above it.
            label: t("labelFingers"),
            value:
              bio.state !== "enrolled"
                ? null
                : fingers
                  ? fingers.map((key) => t(key)).join(", ")
                  : bio.fingerprint_count
                    ? t("bioRecorded").replace(
                        "{n}",
                        fmt.digits(String(bio.fingerprint_count)),
                      )
                    : null,
          },
          {
            label: t("labelFace"),
            value:
              bio.state === "enrolled"
                ? t(bio.face ? "bioEnrolled" : "bioNotEnrolled")
                : null,
          },
          // The branch, never a device serial or a PIN: WHERE the machines that
          // know this person are, not which machine.
          { label: t("labelDevicesAt"), value: me.branch },
          { label: t("labelLastChecked"), value: checkedAt },
        ]}
      >
        {bodyKey ? (
          <p className="px-3 py-2 text-[12px] leading-snug text-muted-foreground">
            {t(bodyKey)}
          </p>
        ) : null}
      </ProfileSection>

      <ProfileSection
        title={t("sectionContact")}
        rows={[
          { label: t("labelPhone"), value: me.cell_number },
          { label: t("labelEmail"), value: me.personal_email },
        ]}
      >
        {/* Conditional, not unconditional. `children` alone keeps a section
            alive, so an always-present line here would render "Wrong? Tell HR"
            under a heading with no contact details beneath it — advice about a
            block that is not on screen. */}
        {me.cell_number || me.personal_email ? (
          <p className="px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {t("contactReadOnly")}
          </p>
        ) : null}
      </ProfileSection>

      <ProfileSection title={t("sectionMonth").replace("{month}", fmt.date(today, "LLLL"))}>
        <div className="flex">
          <Stat
            value={fmt.digits(String(stats.daysWorked))}
            label={t("statDaysWorked")}
          />
          <Stat value={fmt.worked(stats.minutes) ?? "—"} label={t("statHours")} />
          <Stat
            value={fmt.digits(String(stats.flags))}
            label={t("statToCheck")}
            amber={stats.flags > 0}
          />
        </div>
      </ProfileSection>

      <section>
        <ProfileHeading>{t("sectionRoster")}</ProfileHeading>
        <MySchedulePage
          today={today}
          offset={props.offset}
          onOffsetChange={props.onOffsetChange}
        />
      </section>
    </div>
  );
}
