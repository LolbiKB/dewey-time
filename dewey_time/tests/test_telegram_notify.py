from datetime import datetime
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import notify  # noqa: E402


class TestCompose(unittest.TestCase):
    # Punch times are real `datetime` objects, not strings. `Employee
    # Checkin.time` is a Datetime field, so frappe.db.get_value hands back a
    # datetime in production -- and the test mock's `get_datetime` is the
    # identity function, so a string here would reach `.strftime` and blow up
    # for a reason production would never hit.
    def test_in_punch_names_the_time_and_branch(self):
        text = notify.compose("IN", datetime(2026, 8, 14, 7, 58), "DIS Iconic")
        # Twelve hour, matching the Mini App this message links into. "17:06"
        # here and "5:06 PM" one tap later is one event described two ways.
        self.assertIn("7:58 AM", text)
        self.assertNotIn("07:58", text)
        self.assertIn("DIS Iconic", text)

    def test_out_punch_reads_as_a_checkout(self):
        # Khmer by default; the English wording is pinned through the "en"
        # preference, which is the only way it is ever rendered now.
        text = notify.compose("OUT", datetime(2026, 8, 14, 17, 2), "ISBB")
        self.assertIn("បានចេញ", text)
        english = notify.compose("OUT", datetime(2026, 8, 14, 17, 2), "ISBB", None, "en")
        self.assertIn("out", english.lower())

    def test_missing_branch_still_produces_a_message(self):
        text = notify.compose("IN", datetime(2026, 8, 14, 7, 58), None)
        self.assertIn("7:58 AM", text)
        self.assertNotIn("None", text)
        self.assertNotIn("·", text, "no separator with nothing after it")

    def test_no_judgment_language(self):
        # The notification says what happened, never what it means. Lateness
        # is HR's determination and it is not final at punch time.
        text = notify.compose("IN", datetime(2026, 8, 14, 9, 45), "DIS Iconic")
        for word in ("late", "early", "flag", "violation", "absent"):
            self.assertNotIn(word, text.lower())


def _row():
    return {
        "log_type": "IN",
        "time": datetime(2026, 8, 14, 7, 58),
        "custom_device_branch": "DIS Iconic",
    }


class TestGating(unittest.TestCase):
    def test_no_send_when_telegram_is_disabled(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=False), \
             patch.object(notify.transport, "send_message") as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        send.assert_not_called()

    def test_no_send_for_an_unlinked_employee(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value=None), \
             patch.object(notify.transport, "send_message") as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        send.assert_not_called()

    def test_a_linked_employee_is_notified_whatever_the_rollout_phase(self):
        # THE LINK IS THE PERMISSION. This used to require the branch to be
        # LIVE, which is the wrong gate at the wrong granularity: the engine's
        # phase governs when its DETERMINATIONS become real, and this message
        # carries none of them -- just the punch time and the branch, true the
        # moment the row exists.
        #
        # Meanwhile the consent is already per person and explicit: a link
        # exists only because that employee sent /start or redeemed one. A
        # branch-wide date they had no part in should not silence them, and it
        # made a small pilot impossible without moving a whole branch.
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "55501"}), \
             patch.object(notify, "_checkin", return_value=_row()), \
             patch.object(notify.rollout, "phase_for_employee",
                          side_effect=AssertionError("the phase must not be consulted")), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT) as send:
            result = notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")

        self.assertEqual(result, notify.transport.SENT)
        self.assertEqual(send.call_args[0][0], "77702")

    def test_live_and_linked_sends(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "55501"}), \
             patch.object(notify, "_checkin", return_value=_row()), \
             patch.object(notify.rollout, "phase_for_employee", return_value="LIVE"), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT) as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        self.assertEqual(send.call_args[0][0], "77702")

    def test_a_blocked_recipient_disables_the_link(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "55501"}), \
             patch.object(notify, "_checkin", return_value=_row()), \
             patch.object(notify.rollout, "phase_for_employee", return_value="LIVE"), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.BLOCKED), \
             patch.object(notify, "_disable_link") as disable:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        disable.assert_called_once_with("55501")

    def test_a_successful_send_does_not_disable_the_link(self):
        # Negative control for the branch above: without this, moving
        # _disable_link out of the BLOCKED branch would go unnoticed.
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "55501"}), \
             patch.object(notify, "_checkin", return_value=_row()), \
             patch.object(notify.rollout, "phase_for_employee", return_value="LIVE"), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT), \
             patch.object(notify, "_disable_link") as disable:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        disable.assert_not_called()


class TestHook(unittest.TestCase):
    def test_the_hook_enqueues_rather_than_sending(self):
        # A Telegram outage must never fail or slow a checkin write.
        doc = type("D", (), {"employee": "HR-EMP-00001", "name": "CKIN-1"})()
        with patch.object(notify.frappe, "enqueue") as enqueue, \
             patch.object(notify.transport, "send_message") as send:
            notify.on_employee_checkin_after_insert(doc)
        send.assert_not_called()
        self.assertEqual(
            enqueue.call_args[0][0],
            "dewey_time.telegram.notify.send_checkin_notification",
        )

    def test_a_checkin_without_an_employee_enqueues_nothing(self):
        doc = type("D", (), {"employee": "", "name": "CKIN-1"})()
        with patch.object(notify.frappe, "enqueue") as enqueue:
            notify.on_employee_checkin_after_insert(doc)
        enqueue.assert_not_called()


class TestCheckinIsPlainText(unittest.TestCase):
    """The message an employee actually receives, several times a day.

    It used to carry an inline button into the Mini App. The bot now has a
    Main Mini App button on its profile and a chat menu button, both permanent
    and always in reach, so an inline copy on every check-in was a third route
    to the same place -- repeated several times a day, on the one message that
    should be glanceable and gone.
    """

    def test_the_message_never_consults_the_mini_app_url(self):
        # The whole class of failure this removes. The button path called
        # miniapp_url(), which throws when unset, and only a try/except kept
        # the notification alive -- so the message an employee depends on was
        # one bad setting away from a caught exception on every punch.
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "55501"}), \
             patch.object(notify, "_checkin", return_value=_row()), \
             patch.object(notify.rollout, "phase_for_employee", return_value="LIVE"), \
             patch.object(notify.transport, "miniapp_url",
                          side_effect=AssertionError("must not be consulted")), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT) as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")

        self.assertEqual(send.call_args[0][0], "77702")
        self.assertIn("បានចូល", send.call_args[0][1])


class TestOneLanguageNotification(unittest.TestCase):
    """One language per message, chosen on the link -- Khmer until chosen.

    The stacked-bilingual format is retired. It existed because the only
    signal then available (the phone's client language) guesses wrong for
    Khmer readers who run their phones in English; the /language chooser
    replaced the guess with the person's own answer. Khmer is the default
    because it is the language of this roster, and the default must hold for
    every link minted before the field existed.
    """

    def test_the_default_is_khmer_with_no_english_line(self):
        arrived = notify.compose("IN", datetime(2026, 8, 14, 7, 58), "DIS Iconic")
        self.assertIn("បានចូល", arrived)
        self.assertNotIn("Checked in", arrived)
        self.assertEqual(len(arrived.split("\n")), 1)

        left = notify.compose("OUT", datetime(2026, 8, 14, 17, 2), "DIS Iconic")
        self.assertIn("បានចេញ", left)
        self.assertNotIn("Checked out", left)

    def test_the_english_preference_drops_the_khmer_line(self):
        arrived = notify.compose("IN", datetime(2026, 8, 14, 7, 58), "DIS Iconic",
                                 None, "en")
        self.assertIn("Checked in", arrived)
        self.assertNotIn("បានចូល", arrived)
        self.assertEqual(len(arrived.split("\n")), 1)

    def test_anything_that_is_not_en_reads_as_khmer(self):
        # The unlosable default: blank, None, "km", and junk a future bug
        # might write must all land on Khmer, never on silence or a crash.
        for value in (None, "", "km", "KM", " en \t junk", "kh"):
            text = notify.compose("IN", datetime(2026, 8, 14, 7, 58), None,
                                  None, value)
            self.assertIn("បានចូល", text, f"language={value!r}")
            self.assertNotIn("Checked in", text, f"language={value!r}")
        # Case and whitespace on the one real alternative still count.
        text = notify.compose("IN", datetime(2026, 8, 14, 7, 58), None, None, " EN ")
        self.assertIn("Checked in", text)

    def test_in_and_out_are_never_the_same_words(self):
        # A copy-paste that left both directions saying "arrived" would be
        # invisible to every reviewer who reads only the other language.
        self.assertNotIn(
            "បានចេញ", notify.compose("IN", datetime(2026, 8, 14, 7, 58), None))
        self.assertNotIn(
            "បានចូល", notify.compose("OUT", datetime(2026, 8, 14, 17, 2), None))
        self.assertNotIn(
            "out", notify.compose("IN", datetime(2026, 8, 14, 7, 58), None,
                                  None, "en").lower())

    def test_both_languages_carry_the_same_time_and_branch(self):
        # One punch described in either language: a stamp that differed
        # between them would be a bug nobody reading one language could see.
        for language in (None, "en"):
            text = notify.compose("OUT", datetime(2026, 8, 14, 17, 6),
                                  "DIS Iconic", None, language)
            self.assertIn("5:06 PM", text)
            self.assertIn("DIS Iconic", text)


def _punch(name, time, branch="DIS Iconic", log_type=""):
    return {"name": name, "time": time, "log_type": log_type,
            "custom_device_branch": branch}


class TestDirectionIsResolvedNotAssumed(unittest.TestCase):
    """`log_type` is an OPTIONAL Select and nothing in this app writes it.

    The rule was "anything that is not OUT is an arrival", so every departure
    on an unlabelled stream announced an arrival. The first rewrite paired the
    punch against a whole-day COUNT -- still wrong two ways, both live: blind
    to campus (three punches across two sites made a 5pm departure "odd", an
    arrival) and blind to double taps (a second tap seconds after the first
    inverted every later verb that day).

    Now the day is REPLAYED under the timeline's own branch-run pairing
    (receipt.py, fixture-locked against attendancePunches.ts), and where the
    replay cannot honestly call a direction the message degrades to a neutral
    receipt instead of a confident wrong verb. The replay semantics themselves
    are covered in test_telegram_receipt.py; what this class pins is the
    WIRING -- what direction_of fetches, how it bounds the day, and the words
    that reach a phone.
    """

    def test_an_explicit_label_is_believed_without_any_query(self):
        with patch.object(notify.frappe, "get_all",
                          side_effect=AssertionError("a labelled punch needs no replay")):
            self.assertEqual(
                notify.direction_of("E1", {"log_type": "OUT", "time": "2026-08-17 17:06:00"}),
                "OUT",
            )
            self.assertEqual(
                notify.direction_of("E1", {"log_type": "in", "time": "2026-08-17 07:58:00"}),
                "IN",
            )

    def test_an_unlabelled_punch_is_replayed_against_the_day(self):
        # Fourth punch of the day at one campus is a departure; a third is a
        # lunch return.
        day = [
            _punch("P0", "2026-08-17 07:58:00"),
            _punch("P1", "2026-08-17 12:01:00"),
            _punch("P2", "2026-08-17 12:58:00"),
            _punch("P3", "2026-08-17 17:06:00"),
        ]
        with patch.object(notify.frappe, "get_all", return_value=day):
            self.assertEqual(
                notify.direction_of("E1", _punch("P3", "2026-08-17 17:06:00")), "OUT"
            )
        with patch.object(notify.frappe, "get_all", return_value=day[:3]):
            self.assertEqual(
                notify.direction_of("E1", _punch("P2", "2026-08-17 12:58:00")), "IN"
            )

    def test_the_query_is_bounded_at_this_punch_not_at_now(self):
        # The job is queued, so by the time it runs the employee may have
        # punched again. Fetching "today so far" would let a later punch flip
        # what THIS message says.
        with patch.object(notify.frappe, "get_all",
                          return_value=[_punch("P0", "2026-08-17 07:58:00")]) as get_all:
            notify.direction_of("E1", _punch("P0", "2026-08-17 07:58:00"))
        window = get_all.call_args.kwargs["filters"]["time"]
        self.assertEqual(window[0], "between")
        self.assertEqual(window[1][0], "2026-08-17 00:00:00")
        self.assertEqual(window[1][1], "2026-08-17 07:58:00")

    def test_the_query_shape_is_the_one_the_replay_depends_on(self):
        # Every direction test stubs get_all, so nothing downstream notices
        # if these kwargs rot -- and each is load-bearing. Without order_by,
        # Frappe falls back to the DocType's `modified desc` and the
        # truncation loop finds the announced punch FIRST, replaying a
        # one-punch day: the original every-departure-says-Checked-in bug,
        # restored with a green suite. Without the employee filter the replay
        # reads the whole campus; without log_type/branch in fields the
        # replay loses labels and runs.
        with patch.object(notify.frappe, "get_all",
                          return_value=[_punch("P0", "2026-08-17 07:58:00")]) as get_all:
            notify.direction_of("E1", _punch("P0", "2026-08-17 07:58:00"))
        kwargs = get_all.call_args.kwargs
        self.assertEqual(get_all.call_args.args[0], "Employee Checkin")
        self.assertEqual(kwargs["filters"]["employee"], "E1")
        self.assertEqual(kwargs["order_by"], "time asc, creation asc")
        self.assertEqual(
            set(kwargs["fields"]),
            {"name", "time", "log_type", "custom_device_branch"},
        )

    def test_a_same_second_sibling_delivered_later_is_not_replayed(self):
        # Two rows in one second: the `between` bound cannot separate them,
        # so the replay is cut at the announced punch's own row. Without the
        # cut, announcing P0 would replay P1 as the last punch and hand back
        # P1's verb.
        day = [
            _punch("P0", "2026-08-17 07:58:00"),
            _punch("P1", "2026-08-17 07:58:00"),
        ]
        with patch.object(notify.frappe, "get_all", return_value=day):
            self.assertEqual(
                notify.direction_of("E1", _punch("P0", "2026-08-17 07:58:00")), "IN"
            )
        # And the cut is by NAME, not by time: announcing the second sibling
        # must replay both rows and read the bounce as a duplicate. A
        # time-based match would truncate at P0 again and announce a
        # confident arrival for a bounced tap.
        with patch.object(notify.frappe, "get_all", return_value=day):
            self.assertEqual(
                notify.direction_of("E1", _punch("P1", "2026-08-17 07:58:00")), ""
            )

    def test_an_announced_punch_missing_from_the_fetch_replays_the_whole_window(self):
        # The documented fallback: if the announced row is not in the fetched
        # window (a mock, a deleted row, a clock skew), the replay runs over
        # everything the bound returned rather than guessing a cut. The last
        # fetched punch's verb is what comes back.
        day = [
            _punch("P0", "2026-08-17 07:58:00"),
            _punch("P1", "2026-08-17 12:01:00"),
        ]
        with patch.object(notify.frappe, "get_all", return_value=day):
            self.assertEqual(
                notify.direction_of("EX", _punch("PX", "2026-08-17 12:01:00")), "OUT"
            )

    def test_a_cross_campus_departure_says_checked_out(self):
        # The scenario the whole-day count got backwards: morning at one
        # campus cleanly paired, afternoon at another. The 5:06 punch closes
        # the afternoon arrival, whatever campus the morning happened at.
        day = [
            _punch("P0", "2026-08-17 07:58:00", branch="DIS Iconic"),
            _punch("P1", "2026-08-17 12:01:00", branch="DIS Iconic"),
            _punch("P2", "2026-08-17 13:02:00", branch="DIU"),
            _punch("P3", "2026-08-17 17:06:00", branch="DIU"),
        ]
        with patch.object(notify.frappe, "get_all", return_value=day):
            direction = notify.direction_of("E1", _punch("P3", "2026-08-17 17:06:00"))
        message = notify.compose(direction, datetime(2026, 8, 17, 17, 6), "DIU")
        self.assertIn("បានចេញ", message)
        self.assertNotIn("បានចូល", message)
        english = notify.compose(direction, datetime(2026, 8, 17, 17, 6), "DIU",
                                 None, "en")
        self.assertIn("Checked out", english)
        self.assertNotIn("Checked in", english)

    def test_an_unknowable_punch_is_recorded_not_guessed(self):
        # A full day at one campus, then a single punch at another on the way
        # out -- indistinguishable at compose time from arriving there. The
        # old count announced an arrival to someone leaving the building; now
        # the receipt is neutral in both languages and claims no direction.
        day = [
            _punch("P0", "2026-08-17 07:58:00", branch="DIS Iconic"),
            _punch("P1", "2026-08-17 17:00:00", branch="DIS Iconic"),
            _punch("P2", "2026-08-17 17:04:00", branch="DIU"),
        ]
        with patch.object(notify.frappe, "get_all", return_value=day):
            direction = notify.direction_of("E1", _punch("P2", "2026-08-17 17:04:00"))
        self.assertEqual(direction, "")
        message = notify.compose(direction, datetime(2026, 8, 17, 17, 4), "DIU")
        self.assertIn("បានកត់ត្រា", message)
        self.assertNotIn("បានចូល", message)
        self.assertNotIn("បានចេញ", message)
        english = notify.compose(direction, datetime(2026, 8, 17, 17, 4), "DIU",
                                 None, "en")
        self.assertIn("Recorded", english)
        self.assertNotIn("Checked in", english)
        self.assertNotIn("Checked out", english)
        # Still a receipt in either language: the time and the place survive.
        for text in (message, english):
            self.assertIn("5:04 PM", text)
            self.assertIn("DIU", text)

    def test_a_double_tap_no_longer_inverts_the_rest_of_the_day(self):
        # Tap, tap again three seconds later. The second tap is announced
        # neutrally, and -- the part the count got wrong -- the REAL lunch
        # departure an hour later still reads as a departure.
        day = [
            _punch("P0", "2026-08-17 07:58:00"),
            _punch("P1", "2026-08-17 07:58:03"),
            _punch("P2", "2026-08-17 12:01:00"),
        ]
        with patch.object(notify.frappe, "get_all", return_value=day[:2]):
            self.assertEqual(
                notify.direction_of("E1", _punch("P1", "2026-08-17 07:58:03")), ""
            )
        with patch.object(notify.frappe, "get_all", return_value=day):
            self.assertEqual(
                notify.direction_of("E1", _punch("P2", "2026-08-17 12:01:00")), "OUT"
            )


class TestMeaningLine(unittest.TestCase):
    """The one optional line under the verb -- and everything it refuses.

    _receipt_for is exercised directly for the gate logic, plus end-to-end
    sends proving the lines actually reach (or stay out of) the transport.
    The replay arithmetic behind so_far/is_first is test_telegram_receipt's
    job; what this class owns is the GATES: holiday above assignment, no
    roster claims off the eligible population, overnight silence, horizon
    honesty, and nothing on a neutral verb.
    """

    DAY_SHIFT = {"start_time": "07:00:00", "end_time": "17:00:00"}
    NIGHT_SHIFT = {"start_time": "21:00:00", "end_time": "06:00:00"}

    def _env(self, *, punches, employment_type="Full-time", assignments=None,
             shift_types=None, holiday=False, roster_active=False, day="2026-08-17"):
        """Patch the whole fact surface _meaning_for reads.

        `assignments` maps date string -> assignment dict (missing date =
        unrostered); `shift_types` maps shift_type name -> times row;
        `roster_active` is _roster_opined_around's underlying answer.

        The doubles ENFORCE the real call contracts rather than answering
        any shape: db.get_value must be asked with as_dict=True (a real
        bench returns a tuple otherwise, which the try/except would swallow
        into permanent silence), and the holiday lookup must be asked about
        this employee's company and the punch's own day (the real helper
        answers {} for a wrong company, which fails OPEN through the pay-
        claim gate).
        """
        from contextlib import ExitStack

        assignments = assignments if assignments is not None else {
            day: {"shift_type": "DAY"}
        }
        shift_types = shift_types if shift_types is not None else {"DAY": self.DAY_SHIFT}
        employee_row = {"company": "Dewey", "employment_type": employment_type}
        case = self

        def db_get_value(doctype, name, fields=None, as_dict=False, **kwargs):
            if doctype not in ("Employee", "Shift Type"):
                return None
            case.assertTrue(as_dict, f"{doctype} lookup must pass as_dict=True")
            # Honor the fields list rather than answering everything: a
            # field dropped from the production call (employment_type,
            # end_time) must come back missing here too, or the mutation
            # ships green and the try/except converts it to permanent
            # silence in production.
            source = (
                employee_row if doctype == "Employee"
                else (shift_types.get(name) or {})
            )
            return {field: source.get(field) for field in (fields or [])}

        def fake_holiday(*, company, start, end):
            case.assertEqual(company, "Dewey", "the punching employee's company")
            case.assertEqual(str(start), str(end), "a single-day window")
            if holiday and str(start) == day:
                return {day: {"description": "Holiday"}}
            return {}

        def fake_overlap(*, employee, start, end):
            case.assertLessEqual(str(start), day, "window must reach back past the day")
            case.assertLessEqual(day, str(end), "window must reach forward past the day")
            return roster_active

        stack = ExitStack()
        stack.enter_context(patch.object(notify.frappe, "get_all", return_value=punches))
        stack.enter_context(
            patch.object(notify.frappe.db, "get_value", side_effect=db_get_value)
        )
        stack.enter_context(
            patch.object(
                notify, "get_shift_assignment",
                side_effect=lambda *, employee, attendance_date:
                    assignments.get(str(attendance_date)),
            )
        )
        stack.enter_context(
            patch.object(notify, "holiday_by_date_for_company", side_effect=fake_holiday)
        )
        stack.enter_context(
            patch.object(notify, "has_assignment_overlapping", side_effect=fake_overlap)
        )
        return stack

    def test_the_days_first_arrival_states_the_shift_window(self):
        first = _punch("P0", "2026-08-17 07:58:00")
        with self._env(punches=[first]):
            direction, meaning = notify._receipt_for("E1", first)
        self.assertEqual(direction, "IN")
        self.assertEqual(
            meaning, ("វេន 7:00 AM – 5:00 PM", "Shift 7:00 AM – 5:00 PM")
        )

    def test_a_cleanly_paired_departure_states_the_so_far_figure(self):
        day = [_punch("P0", "2026-08-17 07:58:00"), _punch("P1", "2026-08-17 12:01:00")]
        with self._env(punches=day):
            direction, meaning = notify._receipt_for("E1", day[1])
        self.assertEqual(direction, "OUT")
        self.assertEqual(
            meaning, ("ថ្ងៃនេះ គិតត្រឹមពេលនេះ 4 ម៉ោង 3 នាទី", "So far today 4h 3m")
        )

    def test_a_holiday_silences_every_line(self):
        # Above the assignment check, per the map: assignments are generated
        # with no holiday awareness, so on Khmer New Year the roster still
        # says 07:00-17:00 -- and an hours figure there is a pay claim.
        first = _punch("P0", "2026-08-17 07:58:00")
        with self._env(punches=[first], holiday=True):
            self.assertIsNone(notify._receipt_for("E1", first)[1])
        day = [_punch("P0", "2026-08-17 07:58:00"), _punch("P1", "2026-08-17 12:01:00")]
        with self._env(punches=day, holiday=True):
            self.assertIsNone(notify._receipt_for("E1", day[1])[1])

    def test_no_roster_claims_off_the_scheduled_population(self):
        # A rotating hourly teacher's unrostered day IS their contract; a
        # blank employment type is nobody-classified-them. Neither may be
        # told anything about a roster.
        first = _punch("P0", "2026-08-17 07:58:00")
        for employment_type in ("Casual", ""):
            with self._env(punches=[first], employment_type=employment_type):
                self.assertIsNone(notify._receipt_for("E1", first)[1])

    def test_hours_still_flow_to_the_clock_based(self):
        # The so-far figure is punch arithmetic, not a roster claim -- for
        # clock-based staff it is the most useful line of all.
        day = [_punch("P0", "2026-08-17 07:58:00"), _punch("P1", "2026-08-17 12:01:00")]
        with self._env(punches=day, employment_type="Casual", assignments={}):
            direction, meaning = notify._receipt_for("E1", day[1])
        self.assertEqual(meaning[1], "So far today 4h 3m")

    def test_an_unrostered_day_speaks_only_when_the_roster_has_opined(self):
        # The predicate is overlap-in-a-window, not a MIN/MAX envelope: an
        # interior generation gap, a lapsed horizon, a never-scheduled
        # employee, and a new hire ahead of their roster all answer False
        # from the same probe, so one boolean carries all four silences.
        first = _punch("P0", "2026-08-17 07:58:00")
        with self._env(punches=[first], assignments={}, roster_active=True):
            self.assertEqual(
                notify._receipt_for("E1", first)[1], notify.receipt.NO_ROSTER_LINES
            )
        with self._env(punches=[first], assignments={}, roster_active=False):
            self.assertIsNone(notify._receipt_for("E1", first)[1])

    def test_the_opinion_window_brackets_the_day_on_both_sides(self):
        # Two probes, one per side, each a week deep. A single centred
        # window was tried first and spoke at exactly the wrong moments:
        # for a week past a lapsed block's end, and for the week before a
        # new hire's roster begins.
        with patch.object(notify, "has_assignment_overlapping",
                          return_value=True) as overlap:
            self.assertTrue(notify._roster_opined_around("E1", "2026-08-17"))
        windows = [
            (call.kwargs["employee"], call.kwargs["start"], call.kwargs["end"])
            for call in overlap.call_args_list
        ]
        self.assertEqual(
            windows,
            [
                ("E1", "2026-08-10", "2026-08-17"),
                ("E1", "2026-08-17", "2026-08-24"),
            ],
        )

    def test_one_sided_roster_activity_stays_silent(self):
        # The two regressions the centred window shipped, pinned shut. A
        # block that lapsed keeps assignments BEHIND the day only; a roster
        # that has not started yet has them AHEAD only. Both must answer
        # "the roster has not opined", so the no-roster line stays unsent.
        first = _punch("P0", "2026-08-17 07:58:00")

        def only_behind(*, employee, start, end):
            return str(end) == "2026-08-17"

        def only_ahead(*, employee, start, end):
            return str(start) == "2026-08-17"

        for side in (only_behind, only_ahead):
            with self._env(punches=[first], assignments={}), \
                 patch.object(notify, "has_assignment_overlapping", side_effect=side):
                self.assertIsNone(notify._receipt_for("E1", first)[1])

    def test_no_roster_line_stays_off_the_ineligible_even_when_the_roster_opined(self):
        # The one path that emits NO_ROSTER_LINES, exercised with the one
        # population that must never receive it. Before this test, moving
        # the eligible check inside the shift-window branch shipped green.
        first = _punch("P0", "2026-08-17 07:58:00")
        for employment_type in ("Casual", ""):
            with self._env(punches=[first], assignments={},
                           roster_active=True, employment_type=employment_type):
                self.assertIsNone(notify._receipt_for("E1", first)[1])

    def test_a_broken_shift_type_says_nothing_rather_than_unscheduled(self):
        first = _punch("P0", "2026-08-17 07:58:00")
        with self._env(punches=[first], shift_types={"DAY": {"start_time": None, "end_time": None}}):
            self.assertIsNone(notify._receipt_for("E1", first)[1])

    def test_an_overnight_shift_suppresses_everything(self):
        # Today's roster says 21:00-06:00: the calendar-day replay cannot
        # see across midnight, so neither line may be computed from it --
        # the arrival's window line AND the paired departure's hours line.
        # The OUT leg is what makes _day_context's is_overnight flag
        # load-bearing: on the IN leg the assignment's presence already
        # blocks every line, so a deleted overnight branch shipped green
        # until this test drove the departure.
        first = _punch("P0", "2026-08-17 21:02:00")
        with self._env(punches=[first], shift_types={"DAY": self.NIGHT_SHIFT}):
            self.assertIsNone(notify._receipt_for("E1", first)[1])
        evening_pair = [
            _punch("P0", "2026-08-17 21:02:00"),
            _punch("P1", "2026-08-17 23:50:00"),
        ]
        with self._env(punches=evening_pair, shift_types={"DAY": self.NIGHT_SHIFT}):
            direction, meaning = notify._receipt_for("E1", evening_pair[1])
        self.assertEqual(direction, "OUT")
        self.assertIsNone(meaning)

    def test_yesterdays_overnight_shift_silences_the_hours_figure_too(self):
        # The night worker's 01:00-out / 01:30-in meal break lands on a
        # fresh calendar date and pairs cleanly there. A "so far today"
        # computed from it measures the break -- or, for the 06:02 exit and
        # a 14:00 errand return, the gap spent at home. The IN branch
        # refused this frame from day one; the OUT branch used to print it.
        break_pair = [
            _punch("P0", "2026-08-17 01:00:00"),
            _punch("P1", "2026-08-17 01:30:00"),
        ]
        with self._env(
            punches=break_pair,
            assignments={"2026-08-16": {"shift_type": "NIGHT"}},
            shift_types={"NIGHT": self.NIGHT_SHIFT},
        ):
            direction, meaning = notify._receipt_for("E1", break_pair[1])
        self.assertEqual(direction, "OUT")
        self.assertIsNone(meaning)

    def test_yesterdays_overnight_shift_silences_the_morning(self):
        # 06:02 on the 17th is punch #1 of a fresh date to the replay, but it
        # belongs to the shift that started at 21:00 on the 16th. Announcing
        # today's shift window under it would frame the wrong day entirely.
        first = _punch("P0", "2026-08-17 06:02:00")
        with self._env(
            punches=[first],
            assignments={"2026-08-17": {"shift_type": "DAY"},
                         "2026-08-16": {"shift_type": "NIGHT"}},
            shift_types={"DAY": self.DAY_SHIFT, "NIGHT": self.NIGHT_SHIFT},
        ):
            self.assertIsNone(notify._receipt_for("E1", first)[1])

    def test_a_neutral_verb_carries_no_meaning_line(self):
        # A line interpreting a punch whose direction the verb just declined
        # to claim would be the claim by the back door.
        day = [
            _punch("P0", "2026-08-17 07:58:00", branch="DIS Iconic"),
            _punch("P1", "2026-08-17 17:00:00", branch="DIS Iconic"),
            _punch("P2", "2026-08-17 17:04:00", branch="DIU"),
        ]
        with self._env(punches=day):
            direction, meaning = notify._receipt_for("E1", day[2])
        self.assertEqual(direction, "")
        self.assertIsNone(meaning)

    def test_a_labelled_first_punch_still_gets_its_shift_window(self):
        # _receipt_for's documented departure from direction_of: a label
        # settles the VERB with no replay, but the meaning line still needs
        # the day's aggregates -- restoring direction_of's short-circuit
        # here would silently kill every meaning line the day a device
        # firmware update starts writing log_type.
        first = _punch("P0", "2026-08-17 07:58:00", log_type="IN")
        with self._env(punches=[first]):
            direction, meaning = notify._receipt_for("E1", first)
        self.assertEqual(direction, "IN")
        self.assertEqual(
            meaning, ("វេន 7:00 AM – 5:00 PM", "Shift 7:00 AM – 5:00 PM")
        )

    def test_the_window_reads_identically_early_or_late(self):
        # THE constraint. The 6:40 arrival and the 8:34 arrival get the
        # same sentence, byte for byte -- any "early"/"late" annotation
        # sneaking into one of them is a verdict, and this comparison is
        # what makes that unshippable rather than unnoticed.
        early = _punch("P0", "2026-08-17 06:40:00")
        late = _punch("P0", "2026-08-17 08:34:00")
        with self._env(punches=[early]):
            early_meaning = notify._receipt_for("E1", early)[1]
        with self._env(punches=[late]):
            late_meaning = notify._receipt_for("E1", late)[1]
        self.assertEqual(early_meaning, late_meaning)
        self.assertIsNotNone(early_meaning)

    def test_a_meaning_fault_costs_the_line_never_the_receipt(self):
        # The verb IS the service. A bug anywhere in the gates -- here, a
        # roster lookup that raises -- must degrade to a plain receipt and
        # an Error Log entry, not a dead notification queue.
        first = _punch("P0", "2026-08-17 07:58:00")
        with self._env(punches=[first]), \
             patch.object(notify, "get_shift_assignment",
                          side_effect=RuntimeError("half-migrated column")), \
             patch.object(notify.frappe, "log_error") as log_error:
            direction, meaning = notify._receipt_for("E1", first)
        self.assertEqual(direction, "IN")
        self.assertIsNone(meaning)
        log_error.assert_called_once()

    def test_a_lunch_return_gets_no_line(self):
        # Not the first punch, not a departure: nothing to say, on purpose.
        day = [
            _punch("P0", "2026-08-17 07:58:00"),
            _punch("P1", "2026-08-17 12:01:00"),
            _punch("P2", "2026-08-17 12:58:00"),
        ]
        with self._env(punches=day):
            direction, meaning = notify._receipt_for("E1", day[2])
        self.assertEqual(direction, "IN")
        self.assertIsNone(meaning)

    def test_end_to_end_the_meaning_rides_below_the_verb(self):
        # Push previews truncate to the leading line: the verb line must come
        # first, the meaning after, in the message actually sent. A link with
        # no language field (every row from before it existed) reads as Khmer.
        # `_checkin` hands back a DATETIME (Datetime column + passthrough
        # get_datetime in this harness); the replay rows stay strings.
        first = _punch("CKIN-1", "2026-08-17 07:58:00")
        checkin_row = {**first, "time": datetime(2026, 8, 17, 7, 58)}
        with self._env(punches=[first]), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "L1"}), \
             patch.object(notify, "_checkin", return_value=checkin_row), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT) as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        lines = send.call_args[0][1].split("\n")
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("បានចូល"))
        self.assertEqual(lines[1], "វេន 7:00 AM – 5:00 PM")

    def test_end_to_end_the_links_language_travels_to_both_lines(self):
        # The stored preference must reach the meaning line too, not just the
        # verb -- a message that switched verbs but kept a Khmer shift line
        # would be exactly the half-translated shape the chooser exists to end.
        first = _punch("CKIN-1", "2026-08-17 07:58:00")
        checkin_row = {**first, "time": datetime(2026, 8, 17, 7, 58)}
        with self._env(punches=[first]), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for",
                          return_value={"chat_id": "77702", "name": "L1",
                                        "language": "en"}), \
             patch.object(notify, "_checkin", return_value=checkin_row), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT) as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        lines = send.call_args[0][1].split("\n")
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("Checked in"))
        self.assertEqual(lines[1], "Shift 7:00 AM – 5:00 PM")
        self.assertNotIn("បានចូល", send.call_args[0][1])
        self.assertNotIn("វេន", send.call_args[0][1])


class TestSendTestNotification(unittest.TestCase):
    """Proving the message works without moving a branch to LIVE.

    Rollout exists so a branch can be watched before its employees are told
    anything. It also means the notification cannot be proven until the moment
    it starts going to everyone, so a wording or binding fault is discovered
    on the day of the flip.
    """

    def _hr(self):
        return patch("dewey_time.attendance_engine.hr_calendar._require_hr_role")

    def _me(self, employee="HR-EMP-00042"):
        return patch("dewey_time.attendance_engine.hr_calendar._employee_linked_to_user",
                     return_value=employee)

    def test_it_sends_the_real_message_for_the_latest_punch(self):
        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "L1"}), \
             patch.object(notify.frappe.db, "get_value", return_value={
                 "name": "CKIN-9", "log_type": "OUT",
                 "time": datetime(2026, 8, 17, 17, 6), "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT) as send:
            result = notify.send_test_notification()

        self.assertEqual(result["result"], notify.transport.SENT)
        self.assertEqual(send.call_args[0][0], "77702")
        # The text comes back so the wording can be reviewed from the response
        # rather than from the phone that happens to be linked -- and it is
        # the link's OWN language, Khmer here, exactly what the phone gets.
        self.assertIn("បានចេញ", result["text"])
        self.assertNotIn("Checked out", result["text"])
        self.assertIn("DIS Iconic", result["text"])

    def test_it_honours_the_links_language_like_the_real_path(self):
        # The endpoint exists to prove the real message; a test message that
        # ignored the preference would review wording nobody will receive.
        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for",
                          return_value={"chat_id": "77702", "name": "L1",
                                        "language": "en"}), \
             patch.object(notify.frappe.db, "get_value", return_value={
                 "name": "CKIN-9", "log_type": "OUT",
                 "time": datetime(2026, 8, 17, 17, 6), "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT):
            result = notify.send_test_notification()

        self.assertIn("Checked out", result["text"])
        self.assertNotIn("បានចេញ", result["text"])

    def test_it_returns_the_text_so_wording_can_be_checked_without_a_phone(self):
        # What this still does that a punch cannot: fire on demand and hand
        # the text back. Eleven Khmer strings are unreviewed, and they cannot
        # be read by anyone who is not holding the linked account otherwise.
        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "L1"}), \
             patch.object(notify.frappe.db, "get_value", return_value={
                 "name": "CKIN-9", "log_type": "IN",
                 "time": datetime(2026, 8, 17, 7, 58), "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify.transport, "send_message", return_value=notify.transport.SENT):
            result = notify.send_test_notification()

        self.assertIn("បានចូល", result["text"])
        self.assertEqual(result["checkin"], "CKIN-9")

    def test_every_other_gate_still_reports_honestly(self):
        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=False):
            self.assertEqual(notify.send_test_notification()["result"], "disabled")

        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value=None):
            self.assertEqual(notify.send_test_notification()["result"], "unlinked")

        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "7", "name": "L1"}), \
             patch.object(notify.frappe.db, "get_value", return_value=None):
            self.assertEqual(notify.send_test_notification()["result"], "no-checkin")

    def test_a_stale_punch_test_message_never_carries_a_day_claim(self):
        # The map's hazard on this endpoint: it fires against whatever the
        # most recent punch is, and "So far today 4h 3m" about last Tuesday
        # is a fresh-looking claim about a stale day. The verb is safe on
        # any date; the meaning line is computed only for today -- and the
        # roster must not even be consulted for a stale one.
        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "7", "name": "L1"}), \
             patch.object(notify.frappe.db, "get_value", return_value={
                 "name": "CKIN-9", "log_type": "OUT",
                 "time": datetime(2026, 8, 12, 17, 6), "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify, "nowdate", return_value="2026-08-19"), \
             patch.object(notify, "get_shift_assignment",
                          side_effect=AssertionError("a stale day must not consult the roster")), \
             patch.object(notify.transport, "send_message", return_value=notify.transport.SENT):
            result = notify.send_test_notification()

        self.assertEqual(len(result["text"].split("\n")), 1)
        self.assertNotIn("So far", result["text"])
        self.assertNotIn("Shift", result["text"])
        self.assertNotIn("វេន", result["text"])
        self.assertNotIn("គិតត្រឹមពេលនេះ", result["text"])

    def test_a_same_day_punch_test_message_is_the_real_receipt(self):
        # The endpoint's whole reason to exist: the REAL message, meaning
        # line included, reviewable from the response without a phone.
        latest = {"name": "CKIN-9", "log_type": "",
                  "time": datetime(2026, 8, 17, 7, 58),
                  "custom_device_branch": "DIS Iconic"}

        def db_get_value(doctype, *args, **kwargs):
            if doctype == "Employee Checkin":
                return dict(latest)
            if doctype == "Employee":
                return {"company": "Dewey", "employment_type": "Full-time"}
            if doctype == "Shift Type":
                return {"start_time": "07:00:00", "end_time": "17:00:00"}
            return None

        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "7", "name": "L1"}), \
             patch.object(notify.frappe.db, "get_value", side_effect=db_get_value), \
             patch.object(notify.frappe, "get_all", return_value=[
                 _punch("CKIN-9", "2026-08-17 07:58:00")]), \
             patch.object(notify, "nowdate", return_value="2026-08-17"), \
             patch.object(notify, "get_shift_assignment",
                          return_value={"shift_type": "DAY"}), \
             patch.object(notify, "holiday_by_date_for_company", return_value={}), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT):
            result = notify.send_test_notification()

        self.assertIn("វេន 7:00 AM – 5:00 PM", result["text"])
        self.assertNotIn("Shift", result["text"])

    def test_a_blocked_link_is_reported_but_not_disabled(self):
        # send_checkin_notification disables a blocked link, correctly. Doing
        # it from a TEST would let HR switch off an employee's notifications
        # by checking whether they work.
        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "L1"}), \
             patch.object(notify.frappe.db, "get_value", return_value={
                 "name": "CKIN-9", "log_type": "IN",
                 "time": datetime(2026, 8, 17, 7, 58), "custom_device_branch": None}), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.BLOCKED), \
             patch.object(notify, "_disable_link") as disable:
            result = notify.send_test_notification()

        self.assertEqual(result["result"], notify.transport.BLOCKED)
        disable.assert_not_called()

    def test_it_refuses_rather_than_guessing_whose_record_to_use(self):
        with self._hr(), \
             patch("dewey_time.attendance_engine.hr_calendar._employee_linked_to_user",
                   return_value=None):
            with self.assertRaises(Exception):
                notify.send_test_notification()


class TestLinkQueryShape(unittest.TestCase):
    """The one query where the stored preference enters the message path.

    Every send-path test patches _link_for with a hand-built dict, so none of
    them can notice the real select dropping the language column -- that
    mutant left the whole suite green until this class existed. The feature
    would be 100% inert in production (everyone Khmer forever) with CI green.
    """

    def test_the_link_query_asks_for_the_language_column(self):
        with patch.object(notify.frappe.db, "has_column", return_value=True) as has_column, \
             patch.object(notify.frappe.db, "get_value", return_value=None) as get_value:
            notify._link_for("HR-EMP-00042")
        has_column.assert_called_once_with(notify.LINK_DT, "language")
        args, kwargs = get_value.call_args
        self.assertEqual(args[0], notify.LINK_DT)
        self.assertEqual(args[1], {"employee": "HR-EMP-00042", "enabled": 1})
        self.assertEqual(args[2], ["name", "chat_id", "language"])
        self.assertTrue(kwargs["as_dict"])

    def test_a_missing_column_is_left_out_of_the_select_not_crashed_into(self):
        # Deploy without Migrate. Unguarded, this query dies with "Unknown
        # column" inside the enqueued job -- one dead job per punch, a total
        # notification outage from a mistake this site has actually made.
        # Guarded, the dict simply has no language key and .get() reads None,
        # which _language_index already folds to Khmer: the documented default.
        with patch.object(notify.frappe.db, "has_column", return_value=False), \
             patch.object(notify.frappe.db, "get_value", return_value=None) as get_value:
            notify._link_for("HR-EMP-00042")
        self.assertEqual(get_value.call_args[0][2], ["name", "chat_id"])

    def test_delivery_gates_names_the_missing_column(self):
        # The guard must not HIDE the missed Migrate -- that is the recorded
        # failure mode of has_column guards on this site. The gates report is
        # where "everyone gets Khmer and taps refuse" becomes one glance.
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify.frappe.db, "count", return_value=3), \
             patch.object(notify.rollout, "phases_configured", return_value=True), \
             patch.object(notify.frappe.db, "has_column", return_value=False):
            gates = notify.delivery_gates()
        self.assertFalse(gates["language_column"])

        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify.frappe.db, "count", return_value=3), \
             patch.object(notify.rollout, "phases_configured", return_value=True), \
             patch.object(notify.frappe.db, "has_column", return_value=True):
            gates = notify.delivery_gates()
        self.assertTrue(gates["language_column"])
