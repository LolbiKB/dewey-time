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
        text = notify.compose("OUT", datetime(2026, 8, 14, 17, 2), "ISBB")
        self.assertIn("out", text.lower())

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
        self.assertIn("Checked in", send.call_args[0][1])


class TestBilingualNotification(unittest.TestCase):
    """Khmer and English in one message, rather than a guess between them.

    Telegram reports a client language, but that is the language of someone's
    PHONE — frequently English for people who read Khmer. Employee carries no
    language field. Guessing wrong sends an unreadable message to the person
    least able to say so, and this message is two short lines either way.
    """

    def test_both_languages_are_present_for_each_direction(self):
        arrived = notify.compose("IN", datetime(2026, 8, 14, 7, 58), "DIS Iconic")
        self.assertIn("បានចូល", arrived)
        self.assertIn("Checked in", arrived)

        left = notify.compose("OUT", datetime(2026, 8, 14, 17, 2), "DIS Iconic")
        self.assertIn("បានចេញ", left)
        self.assertIn("Checked out", left)

    def test_khmer_leads(self):
        # The English line can be inferred from the numbers beside it; the
        # Khmer one is the reason this is bilingual at all.
        text = notify.compose("IN", datetime(2026, 8, 14, 7, 58), None)
        lines = text.split("\n")
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("បានចូល"))
        self.assertTrue(lines[1].startswith("Checked in"))

    def test_in_and_out_are_never_the_same_words(self):
        # A copy-paste that left both directions saying "arrived" would be
        # invisible in either language alone.
        arrived = notify.compose("IN", datetime(2026, 8, 14, 7, 58), None)
        left = notify.compose("OUT", datetime(2026, 8, 14, 17, 2), None)
        self.assertNotIn("បានចេញ", arrived)
        self.assertNotIn("បានចូល", left)

    def test_both_lines_carry_the_same_time_and_branch(self):
        # Two lines describing one punch. A stamp that differed between them
        # would be a bug nobody reading only their own language could see.
        text = notify.compose("OUT", datetime(2026, 8, 14, 17, 6), "DIS Iconic")
        for line in text.split("\n"):
            self.assertIn("5:06 PM", line)
            self.assertIn("DIS Iconic", line)


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
        self.assertIn("Checked out", message)
        self.assertIn("បានចេញ", message)
        self.assertNotIn("Checked in", message)

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
        self.assertIn("Recorded", message)
        self.assertIn("បានកត់ត្រា", message)
        self.assertNotIn("Checked in", message)
        self.assertNotIn("Checked out", message)
        self.assertNotIn("បានចូល", message)
        self.assertNotIn("បានចេញ", message)
        # Still a receipt: the time and the place survive.
        self.assertIn("5:04 PM", message)
        self.assertIn("DIU", message)

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
        # rather than from the phone that happens to be linked.
        self.assertIn("Checked out", result["text"])
        self.assertIn("បានចេញ", result["text"])
        self.assertIn("DIS Iconic", result["text"])

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
        self.assertIn("Checked in", result["text"])
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
