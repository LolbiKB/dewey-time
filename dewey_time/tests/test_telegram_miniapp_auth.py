import contextlib
import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import miniapp_auth  # noqa: E402

BOT_TOKEN = "123456:TEST-TOKEN"


class Rejected(Exception):
    """Marker raised in place of _reject().

    Load-bearing. assertRaises(Exception) cannot tell OUR guard firing from an
    incidental blow-up further down: with the hash check removed,
    hmac.compare_digest(expected, None) raises TypeError, and a test that only
    asserts "something raised" stays green. Every guard test below asserts
    THIS type, so only a real rejection satisfies it.
    """


def sign(fields: dict, token: str = BOT_TOKEN) -> str:
    """Build a correctly signed initData string, the way Telegram does."""
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    digest = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": digest})


def valid_fields(user_id=55501, auth_date=None):
    return {
        "auth_date": str(int(auth_date if auth_date is not None else time.time())),
        "query_id": "AAF",
        "user": json.dumps({"id": user_id, "first_name": "Test"}),
    }


@contextlib.contextmanager
def only_the_guard_can_raise(employee="HR-EMP-00001"):
    """Patch the bot token AND make the binding succeed unconditionally.

    Load-bearing, not convenience. `employee_for_telegram_user` refuses an
    unknown account by raising, so a rejection test that leaves it unpatched
    passes whether or not the guard under test ran at all -- the binding's own
    refusal masks every earlier check. Mutation testing proved it: deleting the
    signature check, the freshness check, and the absent-hash branch each left
    the whole suite green.

    With the binding forced to succeed, the ONLY thing that can raise is the
    guard being tested.
    """
    with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN), \
         patch.object(miniapp_auth, "_reject", side_effect=Rejected), \
         patch.object(miniapp_auth.binding, "employee_for_telegram_user",
                      return_value=employee) as resolve:
        yield resolve


class TestSignature(unittest.TestCase):
    def test_a_correctly_signed_payload_resolves_to_its_employee(self):
        with only_the_guard_can_raise() as resolve:
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(valid_fields())),
                "HR-EMP-00001",
            )
        self.assertEqual(resolve.call_args[0][0], "55501")

    def test_the_resolved_id_is_the_one_that_was_signed(self):
        # A distinct id, so hardcoding or defaulting the lookup argument
        # cannot pass. The test above alone left that mutation alive.
        with only_the_guard_can_raise() as resolve:
            miniapp_auth.employee_from_init_data(sign(valid_fields(user_id=7788990)))
        self.assertEqual(resolve.call_args[0][0], "7788990")

    def test_a_tampered_field_is_rejected(self):
        forged = sign(valid_fields(user_id=55501)).replace("55501", "99999")
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(forged)

    def test_a_payload_signed_with_another_token_is_rejected(self):
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(valid_fields(), token="999:OTHER"))

    def test_an_absent_hash_is_rejected_not_skipped(self):
        # The classic bypass shape. Missing must reject, never fall through.
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(urlencode(valid_fields()))

    def test_an_empty_init_data_is_rejected(self):
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data("")


class TestRealWorldPayloadShape(unittest.TestCase):
    """Guards against a whole class of failure the other tests cannot see.

    Every fixture above is a payload I invented. Real initData carries fields
    those do not -- notably `signature`, which Telegram added for third-party
    Ed25519 validation and now sends on real launches.

    Per Telegram's spec the HMAC data-check-string is "a chain of all received
    fields, sorted alphabetically" with only `hash` removed; `signature` is
    excluded solely from the separate Ed25519 path. So `signature` MUST stay in
    the HMAC input. Had this been implemented the other way, every real launch
    would have failed authentication while the entire suite stayed green,
    because no fixture emitted the field.
    """

    def test_a_payload_carrying_signature_still_validates(self):
        fields = valid_fields()
        fields["signature"] = "gpUmvpwCzUmYqCLNZ2f6nHy2xt9tvJm9Y8FLZ0Kk"
        fields["chat_type"] = "sender"
        fields["chat_instance"] = "-3788442525382237900"
        with only_the_guard_can_raise() as resolve:
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(fields)), "HR-EMP-00001"
            )
        self.assertEqual(resolve.call_args[0][0], "55501")

    def test_tampering_with_signature_invalidates_the_payload(self):
        # The corollary: because `signature` is inside the HMAC input, editing
        # it breaks the hash. If it were excluded this would silently pass.
        fields = valid_fields()
        fields["signature"] = "original"
        signed = sign(fields).replace("signature=original", "signature=tampered")
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(signed)

    def test_an_unknown_future_field_does_not_break_validation(self):
        # Telegram has added fields before and will again. Anything new is
        # covered by the hash and must simply flow through the sort.
        fields = valid_fields()
        fields["some_field_telegram_adds_in_2027"] = "whatever"
        with only_the_guard_can_raise():
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(fields)), "HR-EMP-00001"
            )


class TestFreshness(unittest.TestCase):
    def test_stale_init_data_is_rejected(self):
        # Without this, captured initData is a permanent credential. It is the
        # one failure that is invisible when missing: the app works, and every
        # other test still passes.
        old = time.time() - miniapp_auth.MAX_AUTH_AGE_SECONDS - 60
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(valid_fields(auth_date=old)))

    def test_recent_init_data_is_accepted(self):
        with only_the_guard_can_raise():
            self.assertEqual(
                miniapp_auth.employee_from_init_data(
                    sign(valid_fields(auth_date=time.time() - 60))
                ),
                "HR-EMP-00001",
            )

    def test_a_missing_auth_date_is_rejected(self):
        fields = valid_fields()
        del fields["auth_date"]
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(fields))


class TestUserField(unittest.TestCase):
    def test_a_payload_with_no_user_is_rejected(self):
        fields = valid_fields()
        del fields["user"]
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(fields))

    def test_unparseable_user_json_is_rejected(self):
        fields = valid_fields()
        fields["user"] = "{not json"
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(fields))

    def test_the_binding_still_decides_whose_record_it_is(self):
        # The one test that deliberately lets the binding refuse: a valid
        # signature proves the id came from Telegram and authorizes nobody.
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN), \
             patch.object(miniapp_auth.binding, "employee_for_telegram_user",
                          side_effect=Exception("Not permitted")):
            # Plain Exception, not Rejected: _reject is deliberately NOT
            # patched here, because the binding itself is the thing refusing.
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(sign(valid_fields()))


class TestMalleability(unittest.TestCase):
    """The credential must be ONE string, not a family of equivalent ones.

    A signature that keeps holding while the message changes is a signature
    over a different message than the one being acted on. Nothing downstream
    reads a field beyond `user` and `auth_date` today, so neither case here is
    exploitable as it stands -- which is precisely why they are worth pinning
    before somebody reads a `start_param` out of these pairs and inherits a
    value that survived validation.
    """

    def test_an_appended_empty_field_does_not_keep_the_signature(self):
        # `parse_qsl` drops empty-valued fields by default, so the check string
        # was built from a SHORTER message than the one that arrived: an
        # attacker could staple arbitrary keys onto a captured launch and the
        # hash still matched. Measured before the fix: it validated.
        signed = sign(valid_fields())
        tampered = signed.replace("&hash=", "&injected=&hash=")
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(tampered)

    def test_a_field_telegram_signed_as_empty_still_validates(self):
        # The same change, in the direction that matters for availability.
        # Telegram excludes exactly one field from its check string -- `hash` --
        # so a field it sends empty is a field it SIGNED empty. Dropping it
        # here built a different string and rejected a legitimate launch.
        fields = valid_fields()
        fields["start_param"] = ""
        with only_the_guard_can_raise() as resolve:
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(fields)), "HR-EMP-00001"
            )
        self.assertEqual(resolve.call_args[0][0], "55501")


class TestDuplicateKeys(unittest.TestCase):
    """One signature must certify one pair set, not a family of them.

    `dict(parse_qsl(...))` is last-wins, so a duplicate key is silently
    discarded before the check string is built: prefixing a captured launch
    with a second copy of any field leaves the check string byte-identical and
    the signature valid. This function's own last-wins read lands on the
    genuine value, so nothing here is fooled -- but anything that re-parses
    the same string with FIRST-wins semantics sees the attacker's copy, and
    first-wins is the common default (`new URLSearchParams(s).get("user")`).
    """

    def test_a_prepended_duplicate_field_is_rejected(self):
        signed = sign(valid_fields(user_id=55501))
        forged = "user=%7B%22id%22%3A+99999%7D&" + signed
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(forged)

    def test_a_prepended_duplicate_hash_is_rejected(self):
        # `pairs.pop("hash")` collapses these too, so a junk hash in front of a
        # genuine one validated -- the shape most likely to confuse whoever is
        # reading a log of a rejected launch.
        signed = sign(valid_fields())
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data("hash=deadbeef&" + signed)

    def test_the_genuine_launch_still_validates(self):
        # The inversion: a duplicate check that rejected everything would pass
        # both tests above.
        with only_the_guard_can_raise() as resolve:
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(valid_fields())),
                "HR-EMP-00001",
            )
        self.assertEqual(resolve.call_args[0][0], "55501")


class TestANonAsciiHashIsRefusedNotRaised(unittest.TestCase):
    """`hmac.compare_digest` REFUSES two str arguments unless both are ASCII.

    It raises TypeError rather than returning False, so `hash=%C3%A9` made
    this boundary -- whose whole contract is "an Employee id or
    PermissionError" -- answer with a TypeError instead. It never granted
    anything. It stopped being the refusal it is written as, which is a
    different failure from the one every other test here pins.
    """

    def test_a_non_ascii_hash_rejects_rather_than_blowing_up(self):
        fields = valid_fields()
        forged = urlencode({**fields, "hash": "é" * 64})
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(forged)
