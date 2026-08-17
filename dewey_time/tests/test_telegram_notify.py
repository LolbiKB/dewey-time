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

    def test_no_send_when_the_branch_is_not_live(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "1", "name": "1"}), \
             patch.object(notify, "_checkin", return_value=_row()), \
             patch.object(notify.rollout, "phase_for_employee", return_value="TESTING"), \
             patch.object(notify.transport, "send_message") as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        send.assert_not_called()

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


class TestDirectionIsResolvedNotAssumed(unittest.TestCase):
    """`log_type` is an OPTIONAL Select and nothing in this app writes it.

    The rule was "anything that is not OUT is an arrival", so on a device that
    reports only timestamps every departure announced itself as "Checked in /
    បានចូល" -- telling someone they had arrived as they walked out of the
    building. The Mini App's status chip had the identical bug and is fixed
    the same way: the message and the app must not describe one punch two
    different ways.
    """

    def test_an_explicit_label_is_believed(self):
        self.assertEqual(notify.direction_of("E1", {"log_type": "OUT", "time": "2026-08-17 17:06:00"}), "OUT")
        self.assertEqual(notify.direction_of("E1", {"log_type": "in", "time": "2026-08-17 07:58:00"}), "IN")

    def test_an_unlabelled_punch_is_paired_against_the_day(self):
        # Fourth punch of the day is a departure; third is a return.
        with patch.object(notify.frappe.db, "count", return_value=4):
            self.assertEqual(
                notify.direction_of("E1", {"log_type": "", "time": "2026-08-17 17:06:00"}), "OUT"
            )
        with patch.object(notify.frappe.db, "count", return_value=3):
            self.assertEqual(
                notify.direction_of("E1", {"log_type": None, "time": "2026-08-17 12:58:00"}), "IN"
            )

    def test_the_count_is_bounded_at_this_punch_not_at_now(self):
        # The job is queued, so by the time it runs the employee may have
        # punched again. Counting "today so far" would let a later punch flip
        # what THIS message says.
        with patch.object(notify.frappe.db, "count", return_value=1) as count:
            notify.direction_of("E1", {"log_type": "", "time": "2026-08-17 07:58:00"})
        window = count.call_args[0][1]["time"]
        self.assertEqual(window[0], "between")
        self.assertEqual(window[1][1], "2026-08-17 07:58:00")

    def test_a_checkout_on_an_unlabelled_stream_says_checked_out(self):
        # The whole point, end to end: the words an employee actually reads.
        with patch.object(notify.frappe.db, "count", return_value=4):
            direction = notify.direction_of("E1", {"log_type": "", "time": "2026-08-17 17:06:00"})
        message = notify.compose(direction, datetime(2026, 8, 17, 17, 6), "DIS Iconic")
        self.assertIn("Checked out", message)
        self.assertIn("បានចេញ", message)
        self.assertNotIn("Checked in", message)


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

    def test_the_rollout_phase_is_never_consulted(self):
        # The entire point. If this asked, it would refuse for exactly the
        # branches that most need testing.
        with self._hr(), self._me(), \
             patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "L1"}), \
             patch.object(notify.frappe.db, "get_value", return_value={
                 "name": "CKIN-9", "log_type": "IN",
                 "time": datetime(2026, 8, 17, 7, 58), "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify.rollout, "phase_for_employee",
                          side_effect=AssertionError("must not be consulted")), \
             patch.object(notify.transport, "send_message", return_value=notify.transport.SENT):
            result = notify.send_test_notification()
        self.assertTrue(result["rollout_phase_ignored"])

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
